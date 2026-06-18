"""Case Coordinator agent (LangGraph, Org A / AI-ML API) — discovery-driven orchestrator.

The Case Coordinator decides *whether* a claim needs investigation (a domain-aware
review score) and *whom* to bring in (it discovers specialists through Band's peer
directory and matches on capability tag). The LLM does the deciding — score the
claim, reason about which specialist fits, pick the handle — but the brittle,
multi-step recruit mechanics run in deterministic Python via the ``recruit`` tool,
so the live demo never depends on the model executing a 5-step tool sequence in
order. ``recruit`` reuses the same standalone BandClient path that ``seed`` uses,
because custom LangGraph tools receive only their validated args (no room context
or room-bound platform tools).
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from band.adapters import LangGraphAdapter

from agents.insurer.bootstrap import AgentSpec, run_agent
from agents.shared.config import (
    get_agent_credentials,
    load_env,
    read_active_chat_id,
)
from agents.shared.prompts import CASE_COORDINATOR_PROMPT
from agents.shared.casefile_schema import (
    DiscoveryPayload,
    EscalationResult,
    RecruitingPayload,
    ReviewScorePayload,
    build_stage_metadata,
)
from agents.shared.expert_match import ExpertMatchDecision, gather_claim_context, match_expert_with_llm
from agents.shared.handoff import mention_record, resolve_human_reviewer
from agents.shared.providers import aiml_llm
from agents.shared.registry import capability_tag_for_domain, needles_for_tag
from agents.shared.scoring import FRAUD_THRESHOLD, score_signals
from gateway.band_client import BandClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arbiter.case_coordinator")

# How long the deterministic recruit waits for the specialist's CALLBACK
# auto-approval before giving up. Approval is near-instant in practice.
_APPROVE_POLL_ATTEMPTS = 12
_APPROVE_POLL_SECONDS = 1.0


# --------------------------------------------------------------------------- #
# CoordinatorRoom — the one seam every tool crosses to reach Band.
#
# A custom LangGraph tool receives only its LLM-supplied args (see the module
# docstring), so the active claim room cannot be a tool parameter. Instead each
# tool's pure logic takes a CoordinatorRoom explicitly, and the @tool shim
# resolves the live one via ``CoordinatorRoom.current()``. Production resolves
# chat_id + the Coordinator's key from the environment and wraps a BandClient;
# tests build the room from an in-memory fake. The Band I/O preamble that was
# copy-pasted into all six async tools now lives here once.
#
# ``current()`` deliberately reads through the module globals load_env /
# get_agent_credentials / read_active_chat_id / BandClient so the existing tool
# tests, which patch those names, drive the real room unchanged.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class CoordinatorRoom:
    """The active claim room, scoped to the Case Coordinator's Band identity.

    ``client`` is authed as the Coordinator. ``evidence_client`` is authed as the
    Evidence Analyst — a second key, because Band's /context is mention-scoped and
    the Coordinator cannot see the Analyst's author-scoped events (see
    :meth:`evidence_report`). Both are injectable so a test builds the room by hand.
    """

    chat_id: str
    client: Any  # a BandClient (or test fake) authed as the Coordinator
    evidence_client: Any = None  # authed as the Evidence Analyst; lazily resolved

    @classmethod
    async def current(cls) -> "CoordinatorRoom | None":
        """Resolve the live room, or None when no claim room is active.

        Only the Coordinator client is built here; the second (Analyst) key is
        resolved lazily by :meth:`evidence_report`, so the five tools that never
        read evidence pay for one client, not two.
        """
        load_env()
        _, adj_key = get_agent_credentials("case_coordinator")
        chat_id = read_active_chat_id()
        if not chat_id:
            return None
        return cls(chat_id=chat_id, client=BandClient(adj_key))

    def _analyst_client(self) -> Any:
        """The Evidence-Analyst-scoped client — injected for tests, else resolved."""
        if self.evidence_client is not None:
            return self.evidence_client
        _, evidence_key = get_agent_credentials("evidence_analyst")
        return BandClient(evidence_key)

    async def context(self) -> list[dict]:
        return await self.client.get_context(self.chat_id)

    async def peers(self, *, not_in_chat: str | None = None) -> list[dict]:
        return await self.client.list_peers(not_in_chat=not_in_chat)

    async def participants(self) -> list[dict]:
        return await self.client.list_participants(self.chat_id)

    async def add_participant(self, participant_id: str) -> dict:
        return await self.client.add_participant(self.chat_id, participant_id)

    async def remove_participant(self, participant_id: str) -> dict:
        return await self.client.remove_participant(self.chat_id, participant_id)

    async def add_contact(self, handle: str, message: str | None = None) -> dict:
        return await self.client.add_contact(handle, message=message)

    async def approved_contacts(self) -> list[dict]:
        reqs = await self.client.list_contact_requests(sent_status="approved")
        return reqs.get("sent", [])

    async def post_event(
        self, content: str, *, message_type: str = "task", metadata: dict | None = None
    ) -> dict:
        return await self.client.send_event(
            self.chat_id, content, message_type=message_type, metadata=metadata
        )

    async def send_message(self, content: str, *, mentions: list[dict] | None = None) -> dict:
        return await self.client.send_message(self.chat_id, content, mentions=mentions)

    async def evidence_report(self) -> "EvidenceSignals | None":
        """Read the Evidence Analyst's latest findings (deterministic).

        Band's /context is mention-scoped, so the Coordinator's own key cannot
        see the Analyst's author-scoped evidence_analysis event. This reads with
        the Analyst's OWN key — the author always sees its own events — then
        parses through the typed casefile seam. The two-key quirk is hidden here
        so no tool has to juggle a second BandClient.

        Returns None on no active room / fetch error / no-or-unreadable evidence;
        callers fall back to scoring on paper alone rather than on garbage.
        """
        from agents.shared.casefile import parse_casefile_entries
        from agents.shared.casefile_schema import parse_stage_metadata

        try:
            messages = await self._analyst_client().get_context(self.chat_id)
        except Exception as exc:  # noqa: BLE001 — never hard-stall scoring on a fetch error
            logger.warning("evidence_report: context fetch failed: %s", exc)
            return EvidenceSignals(note=f"fetch error: {exc}")

        entries = parse_casefile_entries(messages)
        evidence = next(
            (e for e in reversed(entries) if e.get("stage") == "evidence_analysis"), None
        )
        if not evidence:
            return EvidenceSignals(note="no evidence yet")
        report = parse_stage_metadata("evidence_analysis", {"result": evidence.get("result")})
        if report is None:
            return EvidenceSignals(note="unreadable evidence")
        return EvidenceSignals(
            signals=list(report.signals),
            suggested_domain=report.suggested_domain,
            degraded=report.degraded,
        )


@dataclass(frozen=True)
class EvidenceSignals:
    """The Evidence Analyst's findings, parsed off the transcript."""

    signals: list[str] | None = None
    suggested_domain: str | None = None
    degraded: bool | None = None
    note: str | None = None

    @property
    def found(self) -> bool:
        return self.signals is not None


@tool
async def compute_review_score(domain: str, present_signals: list[str]) -> str:
    """Score a claim's concern signals and flag that expert matching should run.

    Every claim attempts LLM-based expert matching after evidence analysis. The score
    is advisory for the audit trail; ``recruit`` is True whenever matching should be
    attempted (always, once evidence is in). When no expert matches, the Coordinator
    decides approve/deny itself.

    Args:
        domain: the claim's domain hint from evidence — "property", "medical", "legal",
            or "" / "unknown" / "none" / "null" when unclear.
        present_signals: the signal keys actually present on the claim.

    Returns JSON with score, threshold, recruit (always True after evidence), and the
    suggested capability_tag when a domain hint exists (may be empty).
    """
    score = score_signals(present_signals)
    dom = (domain or "").strip().lower()
    has_domain = dom not in ("", "unknown", "none", "null")
    recruit = True
    capability_tag = capability_tag_for_domain(dom) if has_domain else ""

    # Emit the deterministic routing decision as a structured Band event so the
    # projection / live view can surface the REAL score (it was previously only
    # returned to the LLM as a JSON string and never posted to the room). Best-effort:
    # a missing room / fetch error must never block the LLM's scoring step.
    try:
        room = await CoordinatorRoom.current()
        if room is not None:
            await room.post_event(
                "Computed review score",
                message_type="thought",
                metadata=build_stage_metadata(
                    "review_score",
                    ReviewScorePayload(
                        score=score,
                        threshold=FRAUD_THRESHOLD,
                        recruit=recruit,
                        domain=dom if has_domain else None,
                        present_signals=present_signals,
                    ),
                ),
            )
    except Exception as exc:  # noqa: BLE001 — surfacing the score must never break scoring
        logger.warning("compute_review_score: could not post review_score event: %s", exc)

    return json.dumps(
        {
            "domain": dom if has_domain else None,
            "score": score,
            "threshold": FRAUD_THRESHOLD,
            "recruit": recruit,
            "capability_tag": capability_tag,
            "present_signals": present_signals,
            "rationale": (
                "Always attempt LLM expert matching after evidence; if no agent fits, "
                "the Case Coordinator decides the claim itself. Score is advisory only."
            ),
        }
    )


@tool
async def read_evidence_signals() -> str:
    """Read the Evidence Analyst's findings from the active claim room (deterministic).

    Returns the latest evidence_analysis event's derived signals + suggested domain —
    so scoring does not depend on the LLM re-parsing nested JSON out of the transcript.
    Returns an empty signal list if no evidence event is present yet (the claim then
    scores on paper alone).

    Reads with the Evidence Analyst's OWN key (see CoordinatorRoom.evidence_report):
    Band's /context is mention-scoped, so the Coordinator's key cannot see the
    evidence_analysis event.
    """
    room = await CoordinatorRoom.current()
    if room is None:
        return json.dumps({"signals": [], "suggested_domain": None, "note": "no active room"})
    report = await room.evidence_report()
    if report is None or not report.found:
        note = report.note if report is not None else "no evidence yet"
        return json.dumps({"signals": [], "suggested_domain": None, "note": note})
    return json.dumps(
        {
            "signals": report.signals,
            "suggested_domain": report.suggested_domain,
            "degraded": report.degraded,
        }
    )


def _recruited_without_verdict(messages: list[dict]) -> bool:
    """True when a specialist was recruited but has not yet posted its verdict.

    Distinguishes the three escalation paths from the room transcript:
      * no ``recruiting`` event  → no specialist; the Coordinator decides itself  → False
      * ``recruiting`` + ``specialist_verdict`` → specialist spoke; relay it       → False
      * ``recruiting`` but NO ``specialist_verdict`` → recruited-but-silent (bug)   → True

    Reads the structured casefile stages, so it is robust to JSON-string metadata and
    the legacy ``fraud_verdict`` alias.
    """
    from agents.shared.casefile import parse_casefile_entries

    stages = {e.get("stage") for e in parse_casefile_entries(messages)}
    recruited = "recruiting" in stages
    has_verdict = bool(stages & {"specialist_verdict", "fraud_verdict"})
    return recruited and not has_verdict


def _norm_handle(handle: str) -> str:
    h = (handle or "").strip()
    return h if h.startswith("@") else f"@{h}"


def _peer_matches(peer: dict, handle: str) -> bool:
    target = _norm_handle(handle).lower()
    ph = _norm_handle(peer.get("handle", "")).lower()
    if ph == target:
        return True
    # Fall back to a name match on the handle's agent segment (after the slash).
    seg = target.split("/")[-1].lstrip("@").replace("-", " ")
    return seg and seg in (peer.get("name") or "").lower()


def _peer_is_agent(peer: dict) -> bool:
    """True unless Band explicitly marks this peer as a human user.

    Band's Peer.type is "User" | "Agent"; tags are agents-only. Treat a missing
    type as an agent (older/edge responses) so we never skip a taggable specialist.
    """
    return str(peer.get("type") or "").strip().lower() != "user"


def _peer_tags(peer: dict) -> list[str]:
    raw = peer.get("tags") or []
    return [str(t).strip().lower() for t in raw if str(t).strip()]


def _select_specialist_by_tag(
    peers: list[dict], capability_tag: str
) -> tuple[dict | None, str, list[dict]]:
    """Discover the specialist whose Band directory tags match the claim's tag.

    Returns (selected_peer, path, candidates) where:
      * selected_peer — the chosen agent peer, or None if nothing matched.
      * path — "tag" when a real Band tag matched, "fallback" when no peer exposed
        tags and we matched on name/handle needles instead, "none" when neither hit.
      * candidates — a compact, audit-friendly view of the agent peers considered
        (name, handle, tags), for the discovery event / dashboard.

    Tag-matching is genuine: it reads each agent peer's ``tags`` (Band Peer schema,
    agents-only) and selects the one advertising ``capability_tag``. The fallback
    exists because tags are configured in the Band UI and are frequently absent from
    the API payload — without it the demo would break whenever tags aren't set.
    """
    tag = (capability_tag or "").strip().lower()
    agent_peers = [p for p in peers if _peer_is_agent(p)]
    candidates = [
        {"name": p.get("name"), "handle": p.get("handle"), "tags": _peer_tags(p)}
        for p in agent_peers
    ]

    # 1) Genuine tag match against the Band directory.
    if tag:
        for p in agent_peers:
            if tag in _peer_tags(p):
                return p, "tag", candidates

    # 2) Graceful fallback: no peer advertised the tag (tags unset in the Band UI),
    #    so match on the conventional specialist name/handle needles for this tag.
    #    Needles come from the Specialist Registry (single source of roster identity).
    needles = needles_for_tag(tag)
    if needles:
        for p in agent_peers:
            hay = f"{p.get('name') or ''} {p.get('handle') or ''}".lower()
            if any(n in hay for n in needles):
                return p, "fallback", candidates

    return None, "none", candidates


async def _emit_discovery(
    room: CoordinatorRoom,
    *,
    capability_tag: str | None,
    match_path: str,
    candidates: list[dict],
    selected: dict | None,
    content: str,
) -> None:
    await room.post_event(
        content,
        message_type="thought",
        metadata=build_stage_metadata(
            "discovery",
            DiscoveryPayload(
                capability_tag=capability_tag,
                match_path=match_path,
                candidates=candidates,
                selected_handle=(selected or {}).get("handle"),
                selected_name=(selected or {}).get("name"),
            ),
        ),
    )


@tool
async def match_expert() -> str:
    """Match this claim to the best expert agent using LLM (deterministic tool).

    Reads the claim context from the room, lists agent peers in the Band directory,
    and uses an LLM to pick the specialist whose expertise genuinely fits. Returns
    JSON with matched (bool), handle, capability_tag, and rationale.

    When matched is True, call recruit() with the returned capability_tag or handle.
    When matched is False, do NOT recruit — decide approve/deny yourself and escalate.
    """
    room = await CoordinatorRoom.current()
    if room is None:
        return json.dumps({"matched": False, "rationale": "no active claim room"})

    try:
        messages = await room.context()
    except Exception as exc:  # noqa: BLE001
        logger.warning("match_expert: context fetch failed: %s", exc)
        return json.dumps({"matched": False, "rationale": f"context fetch failed: {exc}"})

    claim_context = gather_claim_context(messages)
    peers_all = await room.peers()
    agent_peers = [p for p in peers_all if _peer_is_agent(p)]
    candidates = [
        {"name": p.get("name"), "handle": p.get("handle"), "tags": _peer_tags(p)}
        for p in agent_peers
    ]

    decision = match_expert_with_llm(claim_context, candidates)

    selected: dict | None = None
    match_path = "llm" if decision.matched else "none"
    if decision.matched and decision.handle:
        handle_l = decision.handle.strip().lower()
        selected = next(
            (p for p in agent_peers if _norm_handle(p.get("handle", "")).lower() == _norm_handle(handle_l).lower()),
            None,
        )
        if not selected:
            selected = next(
                (p for p in agent_peers if handle_l in (p.get("handle") or "").lower()),
                None,
            )

    # A match only counts if we resolved it to a real directory peer — otherwise
    # the Coordinator would be told to recruit a handle discovery can't find.
    resolved = bool(decision.matched and selected)
    if decision.matched and not selected:
        match_path = "none"

    summary = (
        f"Expert match: {selected.get('name')} ({selected.get('handle')}). {decision.rationale}"
        if resolved
        else f"No expert match. {decision.rationale}"
    )
    await _emit_discovery(
        room,
        capability_tag=decision.capability_tag if resolved else None,
        match_path=match_path,
        candidates=candidates,
        selected=selected,
        content=summary,
    )

    return json.dumps(
        {
            "matched": resolved,
            "handle": (selected or {}).get("handle") if resolved else None,
            "capability_tag": decision.capability_tag if resolved else None,
            "rationale": decision.rationale,
            "claim_context": claim_context,
        }
    )


@tool
async def recruit(capability_tag: str) -> str:
    """Discover and recruit the specialist whose Band tags match the claim (deterministic).

    Pass the ``capability_tag`` returned by compute_review_score (e.g.
    "property-damage", "medical-review", "legal-review"). This performs REAL
    directory discovery in Python — it lists peers, reads each agent's Band directory
    tags, and SELECTS the one advertising that capability_tag — then runs the full
    cross-org handshake in one call: send the contact request, wait for the
    specialist's consent (its CALLBACK auto-approve), add it to the room, and record
    both a structured ``discovery`` event (candidates + decision) and the recruiting
    step. You do NOT pick the handle — discovery does. If no peer advertises the tag
    (tags unset in the Band UI), it falls back to matching the specialist by name.

    Backward compatible: a literal handle (starts with "@" or contains "/") is
    accepted and recruited directly, so older flows still work.
    """
    room = await CoordinatorRoom.current()
    if room is None:
        return "ERROR: no active claim room; cannot recruit."

    arg = (capability_tag or "").strip()

    # Accept a literal handle for backward compatibility; otherwise treat the arg as
    # a capability tag and discover the matching specialist from the Band directory.
    discovery_path = "handle"
    candidates: list[dict] = []
    matched_tag: str | None = None
    if arg.startswith("@") or "/" in arg:
        handle = _norm_handle(arg)
    else:
        matched_tag = arg
        peers_all = await room.peers()
        selected, discovery_path, candidates = _select_specialist_by_tag(peers_all, arg)
        await _emit_discovery(
            room,
            capability_tag=arg,
            match_path=discovery_path,
            candidates=candidates,
            selected=selected,
            content=(
                f"Directory discovery for capability '{arg}': "
                + (
                    f"matched {selected.get('name')} ({selected.get('handle')}) via {discovery_path}."
                    if selected
                    else "no matching specialist found."
                )
            ),
        )
        if not selected:
            return (
                f"NO_MATCH: no specialist in the directory advertises capability '{arg}' "
                "(checked tags and name fallback). Case Coordinator should decide this claim."
            )
        handle = _norm_handle(selected.get("handle") or "")
        logger.info(
            "recruit: discovery matched %s for tag '%s' via %s path",
            handle, arg, discovery_path,
        )

    # Idempotency: if the specialist is already in the room, don't re-recruit.
    participants = await room.participants()
    if any(_peer_matches(p, handle) for p in participants):
        logger.info("recruit: %s already a participant", handle)
        return f"{handle} is already in the room."

    # 1) Cross-org contact request (the consent boundary).
    # A 409 Conflict means a contact / request already exists with this specialist
    # (e.g. a prior claim already crossed the boundary). That is not a failure — the
    # consent already happened, so treat it as approved and proceed to add them.
    try:
        req = await room.add_contact(handle, message="Need specialist review on this claim")
        status = (req or {}).get("status", "pending")
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 409:
            logger.info("recruit: %s already a contact (409); treating as approved", handle)
            status = "approved"
        else:
            logger.exception("recruit: add_contact failed")
            return f"ERROR: contact request to {handle} failed: {exc}"
    except Exception as exc:  # noqa: BLE001
        logger.exception("recruit: add_contact failed")
        return f"ERROR: contact request to {handle} failed: {exc}"

    # 2) Wait for consent (specialist auto-approves via its CALLBACK handler).
    for _ in range(_APPROVE_POLL_ATTEMPTS):
        if status == "approved":
            break
        approved = await room.approved_contacts()
        if any(_norm_handle(s.get("to_handle", "")) == handle for s in approved):
            status = "approved"
            break
        await asyncio.sleep(_APPROVE_POLL_SECONDS)
    if status != "approved":
        return f"ERROR: {handle} did not approve the contact request in time."

    # 3) Add the now-trusted specialist to the room.
    peers = await room.peers(not_in_chat=room.chat_id)
    peer = next((p for p in peers if _peer_matches(p, handle)), None)
    if not peer:
        return f"ERROR: {handle} approved but could not be located in the peer directory."
    await room.add_participant(peer["id"])

    # 4) Record the recruiting step as an authoritative structured event. Carry the
    #    discovery provenance (which path matched, the tag) so the audit trail shows
    #    the full directory-discovery → recruit chain, not just the final handle.
    await room.post_event(
        f"Recruited {peer.get('name', handle)} ({handle}) across the org boundary.",
        message_type="task",
        # recruiting carries its fields as metadata siblings AND a duplicating result
        # sub-object that the gateway/dashboard read — keep emitting both, byte-for-byte.
        metadata=build_stage_metadata(
            "recruiting",
            RecruitingPayload(
                specialist_handle=handle,
                specialist_name=peer.get("name"),
                match_path=discovery_path,
                capability_tag=matched_tag,
            ),
            result={
                "handle": handle,
                "name": peer.get("name"),
                "joined": True,
                "match_path": discovery_path,
                "capability_tag": matched_tag,
            },
        ),
    )
    logger.info("recruit: %s joined room %s (path=%s)", handle, room.chat_id, discovery_path)

    # 5) Deterministically hand off to the specialist by @mentioning it. Letting the
    #    LLM type this mention proved unreliable: in the live trap (CLM-2026-0042) the
    #    Coordinator recruited the Property Agent, then escalated + dismissed it in the
    #    same turn WITHOUT ever mentioning it — so the specialist never got a turn and
    #    posted no specialist_verdict, yet the Coordinator self-authored a "no suitable
    #    expert available" DENY. The mention IS the specialist's turn in Band, so we
    #    post it here (mirroring the deterministic recruit handshake) rather than trust
    #    the model to do it. Best-effort: a mention failure must not undo the recruit.
    try:
        await room.send_message(
            f"Please investigate claim and return your specialist_verdict — {peer.get('name', handle)}.",
            mentions=[mention_record(peer)],
        )
    except Exception as exc:  # noqa: BLE001 — recruit already succeeded; surface to the LLM
        logger.warning("recruit: handoff mention to %s failed: %s", handle, exc)
        return (
            f"Recruited {peer.get('name', handle)} into the room, but the handoff mention "
            f"failed ({exc}). Mention them yourself to request the investigation."
        )
    return (
        f"Recruited {peer.get('name', handle)} and requested the investigation. "
        "Wait for their specialist_verdict before escalating — do NOT decide this claim yourself."
    )


@tool
def cross_check(evidence_json: str, verdict_json: str, coverage_json: str) -> str:
    """Compare evidence findings, specialist verdict, and coverage for conflicts.

    Args:
        evidence_json: JSON from evidence_analysis.result (signals, observations).
        verdict_json: JSON from specialist_verdict.result (risk, recommendation, etc.).
        coverage_json: JSON from coverage.result (covered flag, etc.).

    Returns JSON with status (agree|conflict), reasons[], and needs_human bool.
    """
    try:
        evidence = json.loads(evidence_json) if evidence_json else {}
        verdict = json.loads(verdict_json) if verdict_json else {}
        coverage = json.loads(coverage_json) if coverage_json else {}
    except json.JSONDecodeError as exc:
        return json.dumps({"status": "agree", "reasons": [f"parse error: {exc}"], "needs_human": False})

    reasons: list[str] = []

    # Specialists emit `risk` as a SIBLING of `result` (metadata.risk), but the
    # LLM is told to pass specialist_verdict.result — so the field may arrive at
    # the top level or nested under "result". Read either shape so the conflict
    # check is robust to how the args were assembled. Same for evidence.signals
    # and coverage.covered.
    def _dig(obj: dict, key: str, default: Any = None) -> Any:
        if key in obj:
            return obj[key]
        inner = obj.get("result")
        if isinstance(inner, dict) and key in inner:
            return inner[key]
        return default

    signals = _dig(evidence, "signals", []) or []
    risk = str(_dig(verdict, "risk", "") or "").lower()
    covered = _dig(coverage, "covered", True)

    if signals and risk == "low":
        reasons.append("Evidence raised concern signals but specialist reported low risk.")
    if "evidence_discrepancy" in signals and risk in {"low", "medium"}:
        reasons.append("Vision flagged narrative inconsistency; verdict understates the conflict.")
    if covered is False and signals:
        reasons.append("Coverage excluded but evidence signals suggest active damage.")

    observations = _dig(evidence, "observations", []) or []
    for obs in observations:
        if obs.get("consistent_with_narrative") == "no" and risk == "low":
            reasons.append(
                f"Photo {obs.get('filename', '?')} inconsistent with narrative; verdict is low risk."
            )

    status = "conflict" if reasons else "agree"
    needs_human = status == "conflict"
    return json.dumps({"status": status, "reasons": reasons, "needs_human": needs_human})


@tool
async def escalate_to_human(recommendation: str, rationale: str) -> str:
    """Escalate the claim to the human reviewer for final sign-off (deterministic).

    Call this ONCE after you have decided approve or deny. Posts the structured
    ``escalation`` event and @mentions the human reviewer by their real Band
    identity (display name / handle from the room — never the role label
    "Human Reviewer"). Do NOT separately call band_send_event or band_send_message
    for escalation.

    Args:
        recommendation: exactly ``approve`` or ``deny``.
        rationale: one concise sentence explaining the recommendation.
    """
    rec = (recommendation or "").strip().lower()
    if rec not in {"approve", "deny"}:
        return "ERROR: recommendation must be 'approve' or 'deny'."

    room = await CoordinatorRoom.current()
    if room is None:
        return "ERROR: no active claim room; cannot escalate."

    # Guard: if a specialist was recruited but has NOT yet returned its verdict, the
    # Coordinator must not escalate — it would relay a self-authored decision over a
    # specialist that never spoke (the live CLM-2026-0042 bug). The recruit() mention
    # is the specialist's turn; ending this turn lets Band schedule it, and the
    # specialist_verdict re-triggers the Coordinator to relay the real recommendation.
    try:
        context = await room.context()
    except Exception as exc:  # noqa: BLE001 — never hard-stall escalation on a fetch error
        logger.warning("escalate_to_human: context fetch failed: %s", exc)
        context = []
    if _recruited_without_verdict(context):
        return (
            "WAIT: a specialist was recruited but has not returned its specialist_verdict "
            "yet. Do NOT escalate or decide this claim yourself — end your turn now and let "
            "the specialist respond. Relay its recommendation verbatim once the verdict arrives."
        )

    try:
        participants = await room.participants()
    except Exception as exc:  # noqa: BLE001
        logger.warning("escalate_to_human: list_participants failed: %s", exc)
        return f"ERROR: could not list room participants: {exc}"

    human = resolve_human_reviewer(participants)
    if not human:
        return (
            "ERROR: no human reviewer in the room. "
            "Set HUMAN_REVIEWER_USER_ID and seed the claim with that user added."
        )

    await room.post_event(
        f"Escalating to human reviewer with recommendation: {rec.upper()}.",
        message_type="task",
        metadata=build_stage_metadata(
            "escalation",
            EscalationResult(recommendation=rec, rationale=(rationale or "").strip()),
        ),
    )

    # Mention via the mentions array only — do not also write @name in the body.
    body = (
        f"Please review this claim. My recommendation is to {rec}"
        f"{'' if not rationale else f' — {rationale.strip()}'}"
    )
    await room.send_message(body, mentions=[mention_record(human)])
    name = human.get("name") or human.get("handle") or "human reviewer"
    logger.info("escalate_to_human: escalated to %s with recommendation %s", name, rec)
    return f"Escalated to {name} with recommendation {rec.upper()}."


# Roles that are single-shot: once their phase is done they have no further part in
# the claim, so the Case Coordinator (room owner) removes them when it escalates.
# This takes them out of Band's @mention flow so a stray mention can't re-trigger a
# back-and-forth. The Human Reviewer and the Coordinator itself are never dismissed.
_DISMISS_ROLE_NEEDLES = ("intake", "evidence", "property", "medical", "legal", "assessor", "review", "counsel", "attorney")
_KEEP_ROLE_NEEDLES = ("coordinat", "adjud", "human", "adjust", "sahil")


@tool
async def dismiss_finished_agents() -> str:
    """Remove agents whose work is done from the claim room (deterministic cleanup).

    Call this ONCE right after you escalate to the Human Reviewer. By then Intake,
    the Evidence Analyst, and any recruited specialist have delivered their structured
    output and have no further role — leaving them in the room only invites stray
    @mention chatter. As the room owner you can remove them; the Human Reviewer and you
    remain. Returns a summary of who was dismissed.
    """
    room = await CoordinatorRoom.current()
    if room is None:
        return "No active claim room; nothing to dismiss."
    try:
        participants = await room.participants()
    except Exception as exc:  # noqa: BLE001 — cleanup is best-effort, never hard-fail
        logger.warning("dismiss: list_participants failed: %s", exc)
        return f"Could not list participants: {exc}"

    dismissed: list[str] = []
    for p in participants:
        name = (p.get("name") or "").lower()
        ptype = (p.get("type") or p.get("participant_type") or "").lower()
        if ptype == "user" or any(k in name for k in _KEEP_ROLE_NEEDLES):
            continue  # never remove the human or the coordinator
        if any(n in name for n in _DISMISS_ROLE_NEEDLES):
            try:
                await room.remove_participant(p["id"])
                dismissed.append(p.get("name") or p["id"])
            except Exception as exc:  # noqa: BLE001 — one failure must not abort the rest
                logger.info("dismiss: could not remove %s: %s", p.get("name"), exc)

    if not dismissed:
        return "No finished agents to dismiss."
    logger.info("dismiss: removed %s from room %s", dismissed, room.chat_id)
    return f"Dismissed finished agents: {', '.join(dismissed)}."


SPEC = AgentSpec(
    credential_name="case_coordinator",
    build_adapter=lambda cfg: LangGraphAdapter(
        llm=aiml_llm(cfg, temperature=0),
        checkpointer=InMemorySaver(),
        additional_tools=[read_evidence_signals, compute_review_score, match_expert, recruit, cross_check, escalate_to_human, dismiss_finished_agents],
        custom_section=CASE_COORDINATOR_PROMPT,
    ),
    logger=logger,
    log_line="Case Coordinator agent running (LangGraph / AI-ML API, discovery + deterministic recruit)",
)


async def main() -> None:
    await run_agent(SPEC)


if __name__ == "__main__":
    asyncio.run(main())
