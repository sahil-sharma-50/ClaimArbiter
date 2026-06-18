"""FastAPI gateway: polls Band REST and serves normalized state to the dashboard."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, ValidationError

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.shared.casefile_schema import SignoffPayload, build_stage_metadata  # noqa: E402
from agents.shared.policies import policies_payload  # noqa: E402
from agents.shared.config import (  # noqa: E402
    clear_active_chat_id,
    get_agent_credentials,
    load_env,
    read_active_chat_id,
    upload_dir,
)
from gateway.agent_runner import supervisor  # noqa: E402
from gateway.band_client import BandClient, UserBandClient  # noqa: E402
from gateway.audit_seal import compute_seal, verify_seal  # noqa: E402
from gateway.report import build_case_report_pdf, evidence_resolver  # noqa: E402
from seed.run_demo import build_claim, seed_demo  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arbiter.gateway")

# The gateway polls Band's REST API every POLL_SECONDS, so httpx and uvicorn's
# access log would otherwise spam one line per poll (the 404s are expected while
# a chat's context warms up). Keep our own logs at INFO; silence the pollers.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

load_env()
POLL_SECONDS = float(os.environ.get("GATEWAY_POLL_SECONDS", "1.5"))
SEED_CAP_PER_HOUR = int(os.environ.get("SEED_CAP_PER_HOUR", "30"))

# Serializes whole claim runs. Band allows one live connection per agent
# identity, so the agent group (and therefore a run) is a global singleton: a
# second concurrent run would fight the first over the same Band identities.
_run_lock = asyncio.Lock()


def _server_key(name: str) -> str | None:
    value = os.environ.get(name)
    return value.strip() if value and value.strip() else None


# Defaults MUST match .env.example (and config.py) so a run with no model env vars
# resolves to the same models the server advertises. gpt-4o, not -mini: the insurer
# agents (Intake / Evidence / Coordinator) run multi-step tool sequences, and
# gpt-4o-mini loops on them (re-mentioning peers with acknowledgements). Band's own
# docs flag gpt-4o-mini for this; gpt-4o holds. Featherless powers the specialist
# investigators on an open-weight Llama 3.1 model.
DEFAULT_AIML_MODEL = "gpt-4o"
DEFAULT_FEATHERLESS_MODEL = "meta-llama/Meta-Llama-3.1-8B-Instruct"


def resolve_keys(aiml: str | None, featherless: str | None) -> tuple[str, str]:
    """The visitor's own key if they supplied one, else the server .env key. 400 if
    neither. Visitor-wins (per provider) so a visitor who pastes their key in Settings
    runs on THAT key — the host is not billed for their run. A visitor who brings just
    one key falls back to the server for the other. The resolved key is still validated
    by _validate_provider_key before any run, so a bad visitor key fails loudly rather
    than silently falling through to the server key."""
    aiml_resolved = (aiml or "").strip() or _server_key("AIML_API_KEY")
    feath_resolved = (featherless or "").strip() or _server_key("FEATHERLESS_API_KEY")
    if not aiml_resolved:
        raise HTTPException(
            status_code=400,
            detail="No AI/ML API key. Add one in Settings, or configure a server key.",
        )
    if not feath_resolved:
        raise HTTPException(
            status_code=400,
            detail="No Featherless API key. Add one in Settings, or configure a server key.",
        )
    return aiml_resolved, feath_resolved


def resolve_model(aiml: str | None, featherless: str | None) -> tuple[str, str]:
    """The visitor's model if they supplied one, else the server .env model, else the
    default. Mirrors resolve_keys: a visitor's key may only have access to specific
    models, so their model field wins alongside their key."""
    aiml_resolved = (
        (aiml or "").strip() or _server_key("AIML_MODEL") or DEFAULT_AIML_MODEL
    )
    feath_resolved = (
        (featherless or "").strip()
        or _server_key("FEATHERLESS_MODEL")
        or DEFAULT_FEATHERLESS_MODEL
    )
    return aiml_resolved, feath_resolved


def _provider_base_urls() -> dict[str, str]:
    """Base URLs only — never touches the (possibly absent) server provider keys."""
    return {
        "aiml": os.environ.get("AIML_BASE_URL", "https://api.aimlapi.com/v1"),
        "featherless": os.environ.get(
            "FEATHERLESS_BASE_URL", "https://api.featherless.ai/v1"
        ),
    }


async def _validate_provider_key(provider: str, api_key: str) -> None:
    """Validate a provider key by making it actually authenticate.

    A minimal /chat/completions ping, NOT /models: AI/ML API's /models endpoint
    is public (returns 200 with no key at all), so probing it rubber-stamps any
    string. Only an auth-gated call distinguishes a real key from a bad one. We
    treat 401/403 as a key rejection; any other status (incl. a model 400/404,
    or a 200) means the key authenticated, so we don't false-negative on an
    unrelated model-name problem.
    """
    base_url = _provider_base_urls()[provider].rstrip("/")
    model = _server_key("AIML_MODEL" if provider == "aiml" else "FEATHERLESS_MODEL") or (
        DEFAULT_AIML_MODEL if provider == "aiml" else DEFAULT_FEATHERLESS_MODEL
    )
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 1,
                },
            )
    except Exception as exc:  # noqa: BLE001 — network/timeout, not a key verdict
        raise HTTPException(
            status_code=400, detail=f"{provider.upper()} key check failed: {exc}"
        ) from exc

    if r.status_code in (401, 403):
        raise HTTPException(
            status_code=400,
            detail=f"{provider.upper()} rejected the key ({r.status_code}).",
        )


async def _start_run(
    aiml: str | None,
    featherless: str | None,
    aiml_model: str | None = None,
    featherless_model: str | None = None,
) -> None:
    """Resolve + validate provider config and bring the agent group online."""
    aiml_key, feath_key = resolve_keys(aiml, featherless)
    aiml_mdl, feath_mdl = resolve_model(aiml_model, featherless_model)
    # Validation fires a real inference ping at each provider — Featherless cold-loads
    # the model and can take 15s+. Skip it entirely on a warm reseed: if the agent group
    # is already live with these exact keys, they were validated when it was first
    # spawned and proven good. This is the dominant cost on repeat "Run demo" clicks.
    if not supervisor.is_running_with(aiml_key, feath_key, aiml_mdl, feath_mdl):
        # Independent providers, no shared state → validate concurrently so a serial
        # pair can't stack two timeouts. Each raises HTTPException on rejection.
        await asyncio.gather(
            _validate_provider_key("aiml", aiml_key),
            _validate_provider_key("featherless", feath_key),
        )
    await supervisor.ensure_running(aiml_key, feath_key, aiml_mdl, feath_mdl)

app = FastAPI(title="ARBITER Gateway", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Per-chat cache: chat_id -> {fetched_at, payload}
_state_cache: dict[str, dict[str, Any]] = {}
_cache_lock = asyncio.Lock()

# Per-IP seed rate limiting (timestamps within rolling hour)
_seed_timestamps: dict[str, list[float]] = defaultdict(list)
_seed_lock = asyncio.Lock()

# The pure message->state projection plane lives in gateway.projection; main.py keeps
# the I/O (Band fetch, cache, routes) and calls project_state(). It also uses the
# classifier + AGENT_META directly for the /api/agents directory route.
from gateway.projection import (  # noqa: E402
    AGENT_META,
    _classify_participant_record,
    project_state,
)


# The insurer + specialist agents whose context views are unioned to rebuild the
# full room. Band's /context is mention-scoped (an agent sees only messages it sent
# or was @mentioned in), and band_send_event posts are author-scoped (no mentions),
# so the Case Coordinator key alone never sees the intake / coverage /
# evidence_analysis / specialist_verdict events authored by other agents. Reading
# each agent's view and merging by message id reconstructs what a human would see.
# The three live specialist domains are property / medical / legal. "fraud_agent" is
# kept for reading historical rooms seeded under the old model — its key may be absent
# from agent_config, in which case _view() tolerates the failure and contributes nothing.
_ROOM_VIEW_AGENTS = (
    "case_coordinator",
    "intake_coverage",
    "evidence_analyst",
    "property_agent",
    "medical_agent",
    "legal_agent",
    "fraud_agent",  # legacy rooms only; harmless if the key is unconfigured
)


# Sticky per-chat message store: once a message is observed in ANY agent's view it
# is retained here forever (for the gateway's lifetime). The Case Coordinator
# dismisses single-shot agents at escalation, after which their key 404s on
# /context — but their already-posted intake / coverage / evidence_analysis events
# must still drive the dashboard. Stickiness makes the union monotonic: dismissal
# can never blank a phase the gateway already saw.
_room_messages: dict[str, dict[Any, dict[str, Any]]] = {}


async def _union_room_messages(chat_id: str) -> list[dict[str, Any]]:
    """Merge every agent's mention-scoped context view into the full room transcript.

    Fetches each agent's /context concurrently and dedupes by message id (falling
    back to a content composite when an id is absent), then orders chronologically.
    Per-agent failures (a key not in the room, a 403/404 after dismissal) are
    tolerated, and results accumulate in a sticky per-chat store so a dismissed
    agent's earlier events persist even once its key can no longer read the room.
    """

    async def _view(agent: str) -> list[dict[str, Any]]:
        try:
            _, key = get_agent_credentials(agent)
            return await BandClient(key).get_context(chat_id)
        except Exception as exc:  # noqa: BLE001 — one agent's view is best-effort
            logger.debug("room view for %s failed: %s", agent, exc)
            return []

    views = await asyncio.gather(*(_view(a) for a in _ROOM_VIEW_AGENTS))

    merged = _room_messages.setdefault(chat_id, {})
    for view in views:
        for msg in view:
            key = msg.get("id") or (
                msg.get("sender_name"),
                msg.get("inserted_at"),
                msg.get("content"),
            )
            # Keep the first occurrence; identical ids carry identical payloads.
            merged.setdefault(key, msg)

    return sorted(merged.values(), key=lambda m: m.get("inserted_at") or "")


def _invalidate_cache(chat_id: str) -> None:
    # Drop only the short-lived state cache; the sticky message store persists so the
    # dashboard keeps earlier phases after agents are dismissed. The store is cleared
    # explicitly on session delete (_forget_room).
    _state_cache.pop(chat_id, None)


def _forget_room(chat_id: str) -> None:
    """Fully forget a chat: state cache AND the sticky message store."""
    _state_cache.pop(chat_id, None)
    _room_messages.pop(chat_id, None)


async def _fetch_state(chat_id: str, *, use_cache: bool = True) -> dict[str, Any]:
    async with _cache_lock:
        entry = _state_cache.get(chat_id)
        now = time.time()
        if (
            use_cache
            and entry
            and entry.get("payload")
            and now - float(entry.get("fetched_at", 0)) < POLL_SECONDS
        ):
            return entry["payload"]

    _, coordinator_key = get_agent_credentials("case_coordinator")
    client = BandClient(coordinator_key)

    # I/O: union every agent's mention-scoped view so structured events authored by
    # the Intake / Evidence / specialist agents (which the Coordinator was not mentioned
    # in) are visible to the dashboard. Participants still come from one key.
    messages = await _union_room_messages(chat_id)
    participants_raw = await client.list_participants(chat_id)

    # Projection: turn the raw transcript + participants into dashboard state. All the
    # normalization rules live behind this one pure interface (gateway.projection).
    payload = project_state(messages, participants_raw, chat_id=chat_id)

    async with _cache_lock:
        _state_cache[chat_id] = {"fetched_at": time.time(), "payload": payload}

    return payload


async def _check_seed_rate(client_ip: str) -> None:
    async with _seed_lock:
        now = time.time()
        window_start = now - 3600
        recent = [t for t in _seed_timestamps[client_ip] if t > window_start]
        _seed_timestamps[client_ip] = recent
        if len(recent) >= SEED_CAP_PER_HOUR:
            raise HTTPException(
                status_code=429,
                detail=f"Seed rate limit exceeded ({SEED_CAP_PER_HOUR}/hour). Try again later.",
            )
        _seed_timestamps[client_ip].append(now)


class ApprovalBody(BaseModel):
    decision: str  # approve | deny
    note: str = ""


class SeedBody(BaseModel):
    # Which preset claim to seed: property | medical | legal.
    # Defaults to the property hero claim when omitted.
    claim_type: str | None = None
    aiml_api_key: str | None = None
    featherless_api_key: str | None = None
    aiml_model: str | None = None
    featherless_model: str | None = None


class ClaimInput(BaseModel):
    claim_id: str
    policy_id: str = "POL-MER-8812"
    # Claimant-selected category (property/medical/accident/other). Informational
    # only — Intake still classifies the domain from the narrative, never this field.
    category: str | None = None
    incident_date: str
    reported_date: str
    incident_location: str | None = None
    incident_time: str | None = None
    claimant: dict[str, str]
    other_driver: dict[str, str] = {}
    damage: dict[str, Any]
    currency: str = "USD"
    loss_amount: float
    deductible: float = 500
    other_insurance: str | None = None
    narrative: str
    # The claimant's truth-and-completeness declaration (signed in the form).
    declaration: bool = False
    # Optional visitor-supplied provider config (visitor's key wins; server .env is fallback).
    aiml_api_key: str | None = None
    featherless_api_key: str | None = None
    aiml_model: str | None = None
    featherless_model: str | None = None


class KeyTestBody(BaseModel):
    provider: str  # aiml | featherless
    api_key: str


@app.get("/api/health")
async def health() -> dict[str, Any]:
    # keys_required tells the UI whether a visitor MUST paste provider keys.
    # False when the server has both fallback keys (judges can Run with zero setup).
    has_aiml = _server_key("AIML_API_KEY") is not None
    has_featherless = _server_key("FEATHERLESS_API_KEY") is not None
    return {
        "ok": True,
        "gateway": True,
        "keys_required": not (has_aiml and has_featherless),
        "server_keys": {"aiml": has_aiml, "featherless": has_featherless},
    }


@app.get("/api/config")
async def get_config() -> dict[str, Any]:
    # Defaults the run resolves to, plus which slots the host .env locks. The
    # Settings page prefills model boxes from *_model and badges locked fields.
    server_aiml_model = _server_key("AIML_MODEL")
    server_feath_model = _server_key("FEATHERLESS_MODEL")
    return {
        "aiml_model": server_aiml_model or DEFAULT_AIML_MODEL,
        "featherless_model": server_feath_model or DEFAULT_FEATHERLESS_MODEL,
        "server_keys": {
            "aiml": _server_key("AIML_API_KEY") is not None,
            "featherless": _server_key("FEATHERLESS_API_KEY") is not None,
        },
        "server_models": {
            "aiml": server_aiml_model is not None,
            "featherless": server_feath_model is not None,
        },
    }


@app.get("/api/state")
async def get_state(
    chat_id: str | None = Query(default=None),
    refresh: bool = Query(default=False),
) -> dict[str, Any]:
    resolved = chat_id or read_active_chat_id()
    if not resolved:
        return {
            "chat_id": None,
            "participants": [],
            "casefile": [],
            "audit": [],
            "handshake": [],
            "phase": "idle",
            "specialist": None,
            "discovery": {
                "reasoning": [],
                "recruited_handle": None,
                "recruited_name": None,
                "candidates": [],
                "capability_tag": None,
                "match_path": None,
            },
            "routing_score": None,
            "decision": None,
            "band_url": None,
        }
    try:
        return await _fetch_state(resolved, use_cache=not refresh)
    except httpx.HTTPStatusError as exc:
        # Band rejected the room (unknown/invalid chat_id, or no access). Surface a
        # clean 4xx instead of leaking a 500 — the dashboard shows "can't reach".
        status = exc.response.status_code
        detail = (
            f"Chat {resolved} not found in Band."
            if status == 404
            else f"Band rejected the request for chat {resolved} ({status})."
        )
        raise HTTPException(status_code=404 if status == 404 else 502, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail=f"Could not reach Band for chat {resolved}: {exc}"
        ) from exc


@app.get("/api/claims")
async def list_claims() -> list[dict[str, Any]]:
    """Enumerate known claims (no DB): the active chat + any rooms already
    projected this session. Light summary for the home network."""
    known: dict[str, dict[str, Any]] = {}
    active = read_active_chat_id()
    chat_ids: list[str] = []
    if active:
        chat_ids.append(active)
    async with _cache_lock:
        chat_ids.extend(cid for cid in _room_messages.keys() if cid not in chat_ids)
    for cid in chat_ids:
        try:
            state = await _fetch_state(cid, use_cache=True)
        except Exception:  # noqa: BLE001 — skip a room Band can no longer serve
            continue
        # Soft-deleted claims stay deleted. Band has no delete-room API, so a re-poll
        # rehydrates an archived room's in-memory store; the archive marker (durable in
        # Band) is what keeps it out of the active console after a refresh.
        if state.get("archived"):
            continue
        specialist = state.get("specialist") or None
        decision = state.get("decision") or None
        known[cid] = {
            "chat_id": cid,
            "phase": state.get("phase", "idle"),
            "specialist": specialist.get("org") if specialist else None,
            # The recruited specialist's domain key ("property"|"medical"|"legal"),
            # and the assessed risk — both None when the claim classified to no
            # domain and the Coordinator decided alone. Drives per-domain analytics.
            "specialist_type": specialist.get("type") if specialist else None,
            "risk": specialist.get("risk") if specialist else None,
            # The Case Coordinator's AI recommendation (approve|deny) vs the Human
            # Reviewer's actual signed decision. Either may be None (not yet
            # escalated / not yet signed). Kept distinct so the UI can compare them.
            "recommendation": _ai_recommendation(state.get("casefile") or []),
            "decision": decision.get("decision") if decision else None,
            "participant_count": len(state.get("participants") or []),
            "band_url": state.get("band_url"),
        }
    return list(known.values())


def _ai_recommendation(casefile: list[dict[str, Any]]) -> str | None:
    """The Case Coordinator's approve/deny recommendation from the escalation entry.

    Read from the structured `escalation` stage's result (the same field the
    VerdictScene reads via casefileSchema). This is the AI recommendation —
    distinct from the human's signed decision. None until the claim escalates.
    """
    for entry in casefile:
        if entry.get("stage") != "escalation":
            continue
        result = entry.get("result")
        if isinstance(result, dict):
            rec = str(result.get("recommendation") or "").lower()
            if rec in {"approve", "deny"}:
                return rec
    return None


@app.post("/api/seed")
async def post_seed(request: Request, body: SeedBody | None = None) -> dict[str, str]:
    client_ip = request.client.host if request.client else "unknown"
    await _check_seed_rate(client_ip)

    aiml = body.aiml_api_key if body else None
    featherless = body.featherless_api_key if body else None
    aiml_model = body.aiml_model if body else None
    featherless_model = body.featherless_model if body else None
    claim_type = (body.claim_type if body else None) or "property"

    if _run_lock.locked():
        raise HTTPException(status_code=409, detail="A demo run is already in progress. Try again shortly.")

    async with _run_lock:
        await _start_run(aiml, featherless, aiml_model, featherless_model)
        try:
            chat_id = await seed_demo(claim_type=claim_type)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=422, detail=f"Unknown claim_type: {claim_type}") from exc
        except Exception as exc:
            logger.exception("Seed failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    async with _cache_lock:
        _invalidate_cache(chat_id)

    return {"chat_id": chat_id}


@app.post("/api/claim")
async def post_claim(request: Request, body: ClaimInput) -> dict[str, str]:
    client_ip = request.client.host if request.client else "unknown"
    await _check_seed_rate(client_ip)

    if _run_lock.locked():
        raise HTTPException(status_code=409, detail="A demo run is already in progress. Try again shortly.")

    # Provider config is run config, not claim data — strip before building the claim.
    payload = body.model_dump()
    aiml = payload.pop("aiml_api_key", None)
    featherless = payload.pop("featherless_api_key", None)
    aiml_model = payload.pop("aiml_model", None)
    featherless_model = payload.pop("featherless_model", None)

    async with _run_lock:
        await _start_run(aiml, featherless, aiml_model, featherless_model)
        claim = build_claim(payload)
        try:
            chat_id = await seed_demo(claim=claim)
        except Exception as exc:
            logger.exception("Custom claim seed failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    async with _cache_lock:
        _invalidate_cache(chat_id)

    return {"chat_id": chat_id}


# Upload guardrails for the custom-claim attachment path (public demo).
_MAX_UPLOAD_BYTES = 8 * 1024 * 1024  # 8 MB per file
_MAX_PHOTOS = 6
_ALLOWED_IMAGE = {"image/jpeg", "image/png", "image/webp"}
_ALLOWED_DOC = {"application/pdf"}


def _persist_upload(dest_dir: Path, upload: UploadFile, data: bytes) -> str:
    """Write one uploaded file under dest_dir, returning its safe basename."""
    name = Path(upload.filename or "upload").name or "upload"
    (dest_dir / name).write_bytes(data)
    return name


@app.post("/api/claim/upload")
async def post_claim_upload(
    request: Request,
    claim: str = Form(...),
    photos: list[UploadFile] = File(default=[]),
    document: UploadFile | None = File(default=None),
    aiml_api_key: str | None = Form(default=None),
    featherless_api_key: str | None = Form(default=None),
    aiml_model: str | None = Form(default=None),
    featherless_model: str | None = Form(default=None),
) -> dict[str, str]:
    """Create a custom claim with uploaded image/PDF evidence (multipart).

    Mirrors /api/claim but accepts attachments. Band has no file store, so files are
    written to this claim's folder under the shared state volume (no database) and the
    Evidence Analyst — same container, same volume — resolves them by name. The claim
    body is the same JSON the JSON endpoint takes, sent as the ``claim`` form field.
    """
    client_ip = request.client.host if request.client else "unknown"
    await _check_seed_rate(client_ip)

    if _run_lock.locked():
        raise HTTPException(status_code=409, detail="A demo run is already in progress. Try again shortly.")

    try:
        claim_payload = json.loads(claim)
        body = ClaimInput(**claim_payload)
    except (json.JSONDecodeError, ValidationError) as exc:
        raise HTTPException(status_code=422, detail=f"Invalid claim payload: {exc}") from exc

    # Validate attachments before doing any work.
    photos = [p for p in (photos or []) if p and p.filename]
    if len(photos) > _MAX_PHOTOS:
        raise HTTPException(status_code=422, detail=f"At most {_MAX_PHOTOS} photos.")
    have_doc = document is not None and document.filename
    photo_bytes: list[tuple[UploadFile, bytes]] = []
    for p in photos:
        data = await p.read()
        if len(data) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=422, detail=f"{p.filename} exceeds 8 MB.")
        if p.content_type not in _ALLOWED_IMAGE:
            raise HTTPException(status_code=422, detail=f"{p.filename}: unsupported image type {p.content_type}.")
        photo_bytes.append((p, data))
    doc_bytes: bytes | None = None
    if have_doc:
        doc_bytes = await document.read()
        if len(doc_bytes) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=422, detail="Document exceeds 8 MB.")
        if document.content_type not in _ALLOWED_DOC:
            raise HTTPException(status_code=422, detail=f"Document must be PDF, got {document.content_type}.")

    payload = body.model_dump()
    aiml = aiml_api_key or payload.pop("aiml_api_key", None)
    featherless = featherless_api_key or payload.pop("featherless_api_key", None)
    a_model = aiml_model or payload.pop("aiml_model", None)
    f_model = featherless_model or payload.pop("featherless_model", None)
    payload.pop("aiml_api_key", None)
    payload.pop("featherless_api_key", None)
    payload.pop("aiml_model", None)
    payload.pop("featherless_model", None)

    # Name the attachments now so the claim references the real uploaded files.
    payload["uploaded_photos"] = [Path(p.filename).name for p, _ in photo_bytes]
    if have_doc:
        payload["uploaded_document"] = Path(document.filename).name

    async with _run_lock:
        await _start_run(aiml, featherless, a_model, f_model)
        claim_obj = build_claim(payload)
        try:
            chat_id = await seed_demo(claim=claim_obj)
        except Exception as exc:
            logger.exception("Custom claim (upload) seed failed")
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        # Persist the files where the Evidence Analyst will resolve them. This
        # happens after the room exists but before the Evidence Analyst's turn (it
        # runs only after Intake's coverage round-trip), so the files are in place.
        dest = upload_dir(chat_id)
        for p, data in photo_bytes:
            _persist_upload(dest, p, data)
        if have_doc and doc_bytes is not None:
            _persist_upload(dest, document, doc_bytes)
        logger.info("Stored %d photo(s)%s for claim %s", len(photo_bytes),
                    " + document" if have_doc else "", chat_id)

    async with _cache_lock:
        _invalidate_cache(chat_id)

    return {"chat_id": chat_id}


@app.post("/api/approve")
async def post_approve(
    body: ApprovalBody,
    chat_id: str | None = Query(default=None),
    x_human_reviewer_api_key: str | None = Header(default=None, alias="X-Human-Reviewer-Api-Key"),
) -> dict[str, Any]:
    resolved = chat_id or read_active_chat_id()
    if not resolved:
        raise HTTPException(status_code=400, detail="chat_id is required")

    decision = body.decision.lower()
    if decision not in {"approve", "deny"}:
        raise HTTPException(status_code=422, detail="decision must be approve or deny")

    content = f"Human Reviewer decision: {decision.upper()}"
    if body.note:
        content += f" — {body.note}"
    content += " [signed]"

    # Provenance (BUG 8 — honesty): record WHO actually authored the sign-off so the
    # UI never claims a human posted when an agent did on their behalf.
    #   "human"                    — a real human user key posted via the /me/* API
    #   "agent_on_behalf_of_human" — the Case Coordinator agent recorded it (the
    #                                graceful fallback when no human key / a 403)
    # Band's Human API (/me/*) is Enterprise-gated, so a user key 403s on most plans;
    # the agent /events endpoints are not gated. Either path writes the real audit
    # trail, survives cache-clear, and flips infer_phase() to "signed".
    authored_by = "agent_on_behalf_of_human"
    user_key = x_human_reviewer_api_key or os.environ.get("HUMAN_REVIEWER_USER_API_KEY")
    if user_key:
        try:
            await UserBandClient(user_key).send_message(
                resolved, f"@Case Coordinator {content}"
            )
            authored_by = "human"
        except Exception as exc:  # noqa: BLE001 — fall back to agent event below
            logger.info("User sign-off unavailable (%s); recording as agent event", exc)
            user_key = None

    if not user_key:
        _, coordinator_key = get_agent_credentials("case_coordinator")
        try:
            await BandClient(coordinator_key).send_event(
                resolved,
                content,
                message_type="task",
                metadata=build_stage_metadata("signoff", SignoffPayload(
                    decision=decision,
                    note=body.note,
                    authored_by=authored_by,
                )),
            )
        except Exception as exc:  # noqa: BLE001 — never 500 the sign-off on a Band error
            # The user /me/* path is Enterprise-gated (403s on most plans), so this
            # agent /events fallback is the ONLY way the decision lands. If Band
            # rejects it too — e.g. a 422 because the chat id is stale/dead — return
            # a clean error the UI can show instead of crashing with a 500.
            logger.warning("Sign-off agent event failed for %s: %s", resolved, exc)
            raise HTTPException(
                status_code=502,
                detail=(
                    "Could not record the sign-off in Band. The claim room may be "
                    "stale or closed — reload the live console and retry."
                ),
            ) from exc

    async with _cache_lock:
        _invalidate_cache(resolved)

    return {"status": "ok", "decision": decision, "authored_by": authored_by}


@app.post("/api/keys/test")
async def test_key(body: KeyTestBody) -> dict[str, Any]:
    provider = body.provider.lower()
    if provider not in {"aiml", "featherless"}:
        raise HTTPException(status_code=422, detail="provider must be aiml or featherless")
    await _validate_provider_key(provider, body.api_key)
    return {"ok": True}


@app.get("/api/report/{chat_id}")
async def get_report(chat_id: str) -> Response:
    """Stream a PDF case report rebuilt from the FULL Band room transcript."""
    from datetime import datetime, timezone

    try:
        # Union every agent's mention-scoped view (same as the dashboard) so the
        # report sees intake / coverage / evidence_analysis / specialist_verdict
        # events the Coordinator was never @mentioned in. A single key's /context
        # would miss exactly the content the report is built to feature.
        messages = await _union_room_messages(chat_id)
    except httpx.HTTPStatusError as exc:
        status = 404 if exc.response.status_code == 404 else 502
        detail = "Claim not found in Band" if status == 404 else f"Could not fetch Band context: {exc}"
        raise HTTPException(status_code=status, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch Band context: {exc}") from exc

    if not messages:
        raise HTTPException(status_code=404, detail="Claim not found in Band")

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    # ReportLab build() is synchronous CPU work; keep it off the event loop.
    pdf_bytes = await asyncio.to_thread(
        build_case_report_pdf, chat_id, messages, generated_at
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="claimarbiter-{chat_id[:8]}.pdf"'},
    )


@app.get("/api/claims/{chat_id}/verify")
async def verify_claim_seal(chat_id: str, seal: str | None = Query(default=None)) -> dict[str, Any]:
    """Recompute the audit seal from a LIVE Band fetch and report integrity.

    The gateway stores nothing authoritative: this pulls the room transcript fresh
    from Band and hashes it. If the caller passes the ``seal`` printed on their PDF,
    ``match`` says whether the room still hashes to that value (tamper-evident). With
    no ``seal`` param, ``match`` is null and we just return the current seal.
    """
    try:
        messages = await _union_room_messages(chat_id)
    except httpx.HTTPStatusError as exc:
        status = 404 if exc.response.status_code == 404 else 502
        detail = "Claim not found in Band" if status == 404 else f"Could not fetch Band context: {exc}"
        raise HTTPException(status_code=status, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not fetch Band context: {exc}") from exc

    if not messages:
        raise HTTPException(status_code=404, detail="Claim not found in Band")

    if seal:
        result = verify_seal(messages, seal)
        return {"chat_id": chat_id, **result}
    return {
        "chat_id": chat_id,
        "seal": compute_seal(messages),
        "expected": None,
        "match": None,
        "message_count": len(messages),
    }


_EVIDENCE_IMAGE_EXT = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


@app.get("/api/evidence/{chat_id}/{filename}")
async def get_evidence(chat_id: str, filename: str, preview: int = Query(default=0)) -> Response:
    """Serve a claim's evidence file: an image as-is, or a PDF's page 1 as PNG (preview).

    Resolves bytes via the same chain the Evidence Analyst + report use (uploads first,
    then golden assets), with basename-only filenames (no path traversal). Read-only;
    a missing/corrupt file is a 404, never a 500.
    """
    safe = Path(str(filename)).name  # strip any directory components
    if not safe or safe in {".", ".."}:
        raise HTTPException(status_code=400, detail="Invalid filename")
    try:
        raw = evidence_resolver(chat_id)(safe)
    except Exception as exc:  # noqa: BLE001 — an unreadable file is a 404, never a 500
        logger.warning("evidence read failed for %s: %s", safe, exc)
        raise HTTPException(status_code=404, detail="Evidence file not found") from exc
    if not raw:
        raise HTTPException(status_code=404, detail="Evidence file not found")

    ext = Path(safe).suffix.lower()
    if ext == ".pdf":
        if not preview:
            return Response(content=raw, media_type="application/pdf")
        try:
            import fitz  # PyMuPDF

            def _render() -> bytes:
                doc = fitz.open(stream=raw, filetype="pdf")
                try:
                    if doc.page_count == 0:
                        return b""
                    pix = doc[0].get_pixmap(dpi=110)
                    return pix.tobytes("png")
                finally:
                    doc.close()

            png = await asyncio.to_thread(_render)
            if not png:
                raise HTTPException(status_code=404, detail="Empty PDF")
            return Response(content=png, media_type="image/png",
                            headers={"Cache-Control": "private, max-age=300"})
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 — never 500 on a bad PDF
            logger.warning("PDF preview failed for %s: %s", safe, exc)
            raise HTTPException(status_code=404, detail="Could not render PDF preview") from exc

    media = _EVIDENCE_IMAGE_EXT.get(ext)
    if not media:
        raise HTTPException(status_code=404, detail="Unsupported evidence type")
    return Response(content=raw, media_type=media,
                    headers={"Cache-Control": "private, max-age=300"})


@app.post("/api/cache/clear")
async def clear_cache(chat_id: str | None = Query(default=None)) -> dict[str, str]:
    async with _cache_lock:
        if chat_id:
            _invalidate_cache(chat_id)
        else:
            _state_cache.clear()
    return {"status": "cleared"}


@app.delete("/api/session")
async def delete_session(chat_id: str = Query(...)) -> dict[str, Any]:
    """Archive a claim's Band room and clear all server-side state for it.

    Band exposes no delete-room endpoint, so we follow its soft-delete model:
    post a closing 'archived' event to the room (authored by the room-owning
    Case Coordinator agent, whose /agent endpoints are not Enterprise-gated), then
    drop our cache and the active-chat pointer. The audit trail is preserved;
    the room simply stops being an active session. Idempotent: a room we can no
    longer reach is still treated as archived locally.
    """
    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id is required")

    archived_in_band = False
    try:
        _, coordinator_key = get_agent_credentials("case_coordinator")
        await BandClient(coordinator_key).send_event(
            chat_id,
            "Session archived by the Human Reviewer. Claim removed from the active console.",
            message_type="task",
            metadata={"archived": True},
        )
        archived_in_band = True
    except Exception as exc:  # noqa: BLE001 — local cleanup must still proceed
        logger.info("Band archive event failed for %s (%s); clearing locally", chat_id, exc)

    async with _cache_lock:
        _forget_room(chat_id)
    clear_active_chat_id(chat_id)

    return {"status": "archived", "chat_id": chat_id, "band": archived_in_band}


@app.get("/api/agents")
async def list_agents() -> dict[str, Any]:
    """The org's Band agents, live from Band's peer directory.

    Reads /api/v1/agent/peers with the Case Coordinator's key (the same key that
    owns claim rooms), so the list is whatever Band actually reports — never a
    hardcoded roster. Each peer is enriched with the org / framework / model it
    maps to via the same classifier the dashboard uses for room participants, so
    a Band-renamed or newly added agent still lands in the right org lane.
    """
    try:
        _, coordinator_key = get_agent_credentials("case_coordinator")
        peers = await BandClient(coordinator_key).list_peers()
    except Exception as exc:  # noqa: BLE001 — surface a clean 502 to the UI
        logger.info("list_peers failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not reach Band for the agent directory.") from exc

    agents: list[dict[str, Any]] = []
    for p in peers:
        name = p.get("name") or p.get("display_name") or "Unknown"
        key = _classify_participant_record(p)
        meta = AGENT_META.get(key, {"org": "Unknown", "framework": "—", "model": "—"})
        agents.append(
            {
                "name": name,
                "handle": p.get("handle"),
                "role": key,
                "org": meta["org"],
                "framework": meta["framework"],
                "model": meta["model"],
                "type": "human" if key == "human_reviewer" else "agent",
            }
        )

    # Stable, readable order: group by org, then by name, so the directory doesn't
    # reshuffle between Band's paginated responses.
    agents.sort(key=lambda a: (a["org"], a["name"]))
    return {"agents": agents}


@app.get("/api/policies")
async def list_policies() -> list[dict[str, Any]]:
    """The approve/deny policy each domain specialist enforces.

    Returns the three domain policies (property → medical → legal) from
    agents.shared.policies — the single source of truth shared with the specialist
    prompts. Static, derived data (no Band call), so the dashboard's Policy card and
    per-agent pages render the same rules the specialists actually apply.
    """
    return policies_payload()


@app.on_event("shutdown")
async def _shutdown() -> None:
    await supervisor.stop()


def main() -> None:
    import uvicorn

    port = int(os.environ.get("GATEWAY_PORT", "8080"))
    uvicorn.run("gateway.main:app", host="0.0.0.0", port=port, reload=False)


if __name__ == "__main__":
    main()
