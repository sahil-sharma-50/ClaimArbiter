"""Project a Band room transcript into the dashboard's normalized state.

The gateway has two planes: an I/O plane (poll Band, cache, serve HTTP — `main.py`)
and a projection plane (turn raw Band messages + participants into the `ArbiterState`
the dashboard renders — this module). They were tangled in one 1163-line `main.py`,
so the projection logic — the part with all the domain rules — could only be tested by
importing `main.py`'s privates and standing up FastAPI.

This module is that projection plane, behind one pure interface:

    project_state(messages, participants_raw, *, chat_id) -> dict

Pure: messages in, state out — no Band calls, no cache, no HTTP, no global mutable
state. That makes the interface the test surface (`test_projection.py` feeds a fixture
transcript and asserts the whole state dict — no Band, no app), and concentrates every
"how a Band event becomes dashboard state" rule in one place.

`main.py` keeps the I/O: it fetches the messages + participants from Band, calls
`project_state`, and caches the result.
"""

from __future__ import annotations

import json
import os
from typing import Any

from agents.shared.casefile import (
    infer_phase,
    parse_casefile_entries,
    resolve_mentions,
)
from agents.shared.registry import SPECIALISTS

# Role key → org / framework / model shown in the dashboard's agent lanes. The
# projection enriches each participant with this so the UI is data-driven, not a
# hardcoded roster. The Insurance Provider (home org) and human rows live here — they
# are not specialists; the specialist rows are folded in from the Specialist Registry
# below so org/framework/model can't drift from the rest of the roster.
AGENT_META = {
    "intake": {"org": "Insurance Provider", "framework": "Pydantic AI", "model": "AI/ML API"},
    "evidence": {"org": "Insurance Provider", "framework": "Pydantic AI", "model": "Featherless · vision"},
    "case_coordinator": {"org": "Insurance Provider", "framework": "LangGraph", "model": "AI/ML API"},
    "human_reviewer": {"org": "Insurance Provider", "framework": "Human", "model": "—"},
    **{
        s.key: {"org": s.org, "framework": s.framework, "model": s.model}
        for s in SPECIALISTS
    },
}

# Specialist domains the Case Coordinator can recruit. Each entry drives both
# participant classification and the dashboard's specialist descriptor, so the UI
# is fully domain-agnostic — it renders whichever specialist actually joined.
#
# Derived from the Specialist Registry — the single source of specialist identity —
# so the gateway's view of the roster cannot drift from the agent plane's. The dict
# shape (matches / specialty / capability_tag / role / verdict_label) is preserved
# verbatim so _classify_participant and _specialist_descriptor are unchanged. Note
# specialty == key and role == the exact Band display name (the @mention target).
SPECIALIST_KINDS = {
    s.key: {
        "matches": s.needles,
        "specialty": s.key,
        "capability_tag": s.capability_tag,
        "role": s.band_name,
        "verdict_label": s.verdict_label,
    }
    for s in SPECIALISTS
}


def _classify_participant(name: str) -> str:
    lower = name.lower()
    for key, spec in SPECIALIST_KINDS.items():
        if any(m in lower for m in spec["matches"]):
            return key
    if "coordinat" in lower or "adjud" in lower:
        return "case_coordinator"
    if "evidence" in lower:
        return "evidence"
    if "intake" in lower or "coverage" in lower:
        return "intake"
    if "human" in lower or "adjust" in lower:
        return "human_reviewer"
    return "other"


def _human_reviewer_user_id() -> str | None:
    """The Band user UUID of the seeded human reviewer, if configured."""
    value = os.environ.get("HUMAN_REVIEWER_USER_ID")
    return value.strip() if value and value.strip() else None


def _is_user_participant(p: dict[str, Any]) -> bool:
    """True if Band marks this participant as a human user (not an agent).

    Band's participants API returns a ``type`` enum of "User" | "Agent"
    (ChatParticipantType). Compare case-insensitively, and accept the legacy
    ``participant_type`` key as a fallback.
    """
    ptype = str(p.get("type") or p.get("participant_type") or "").strip().lower()
    return ptype == "user"


def _classify_participant_record(p: dict[str, Any]) -> str:
    """Classify a live Band participant to an internal role key (id/type aware).

    Prefers reliable identity signals over brittle name substrings (BUG 7 — a real
    reviewer named e.g. "Sahil Sharma" matches none of the name needles):
      1. If the participant's id is the configured HUMAN_REVIEWER_USER_ID, it is the
         human reviewer — definitive.
      2. Otherwise fall back to name-string classification (handles all agents and
         the conventional "Human Reviewer"/"Adjuster" names).
      3. If the name yields no role ("other") but Band marks the participant as a
         human ``type == "User"``, treat it as the human reviewer: a human in an
         ARBITER claim room is the Insurance Provider's reviewer, never a specialist.
    """
    pid = str(p.get("id") or "")
    human_id = _human_reviewer_user_id()
    if human_id and pid == human_id:
        return "human_reviewer"

    key = _classify_participant(p.get("name") or p.get("display_name") or "")
    if key == "other" and _is_user_participant(p):
        return "human_reviewer"
    return key


def _normalize_participants(raw: list[dict[str, Any]], messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    mentioned_names: set[str] = set()
    for msg in messages[-5:]:
        meta = msg.get("metadata") or {}
        for m in meta.get("mentions", []) if isinstance(meta, dict) else []:
            if isinstance(m, dict) and m.get("name"):
                mentioned_names.add(m["name"].lower())

    out: list[dict[str, Any]] = []
    for p in raw:
        name = p.get("name") or p.get("display_name") or "Unknown"
        key = _classify_participant_record(p)
        meta = AGENT_META.get(key, {"org": "Unknown", "framework": "—", "model": "—"})
        # kind is the dashboard-facing role identity ("human"/"agent") the OrgRail
        # relies on to label the human reviewer's lane — derived from the resolved
        # role, not from a name substring. Band's raw "User"/"Agent" enum is kept
        # in band_type for completeness.
        kind = "human" if key == "human_reviewer" else "agent"
        out.append(
            {
                "name": name,
                "role": key,
                "org": meta["org"],
                "framework": meta["framework"],
                "model": meta["model"],
                "mentioned": name.lower() in mentioned_names,
                "active": True,
                "type": kind,
                "band_type": p.get("type") or p.get("participant_type"),
            }
        )
    return out


def _participant_from_role(name: str, role: str, *, active: bool, mentioned: bool = False) -> dict[str, Any]:
    meta = AGENT_META.get(role, {"org": "Unknown", "framework": "—", "model": "—"})
    kind = "human" if role == "human_reviewer" else "agent"
    return {
        "name": name,
        "role": role,
        "org": meta["org"],
        "framework": meta["framework"],
        "model": meta["model"],
        "mentioned": mentioned,
        "active": active,
        "type": kind,
    }


def _enrich_participants_with_history(
    current: list[dict[str, Any]], messages: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Merge live room participants with agents that already contributed but were dismissed.

    After escalation the Case Coordinator removes finished agents from Band, but the
    Agent band graph should still show everyone who worked the claim.
    """
    by_name: dict[str, dict[str, Any]] = {p["name"].lower(): p for p in current}

    role_order: dict[str, int] = {
        "intake": 0,
        "evidence": 1,
        "case_coordinator": 2,
        "human_reviewer": 99,
    }
    for i, key in enumerate(SPECIALIST_KINDS):
        role_order[key] = 3 + i

    def remember(name: str, role: str, *, active: bool) -> None:
        if not name or role == "other":
            return
        key = name.lower()
        if key in by_name:
            return
        by_name[key] = _participant_from_role(name, role, active=active)

    for msg in messages:
        sender = (msg.get("sender_name") or "").strip()
        if sender and sender.lower() != "system":
            remember(sender, _classify_participant(sender), active=False)

        meta = _coerce_meta(msg.get("metadata"))
        if meta.get("stage") == "recruiting":
            result = meta.get("result") if isinstance(meta.get("result"), dict) else {}
            spec_name = meta.get("specialist_name") or result.get("name")
            if isinstance(spec_name, str) and spec_name.strip():
                remember(spec_name.strip(), _classify_participant(spec_name), active=False)

    def sort_key(p: dict[str, Any]) -> tuple[int, str]:
        role = str(p.get("role") or "other")
        return (role_order.get(role, 50), str(p.get("name") or "").lower())

    return sorted(by_name.values(), key=sort_key)


def _build_audit(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    audit: list[dict[str, Any]] = []
    for msg in messages:
        meta = _coerce_meta(msg.get("metadata"))
        stage = meta.get("stage") if isinstance(meta, dict) else None
        audit.append(
            {
                "type": msg.get("message_type", "text"),
                "sender": msg.get("sender_name"),
                "content": resolve_mentions(msg.get("content", ""), msg.get("metadata")),
                "ts": msg.get("inserted_at"),
                "stage": stage if isinstance(stage, str) else None,
            }
        )
    return audit


def _human_decision(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The Human Reviewer's actual approve/deny sign-off, if one exists.

    Read from the latest signoff event the approve endpoint wrote (structured
    metadata.decision), falling back to parsing the "[signed]" message content.
    This is the human's verdict — distinct from the Case Coordinator's AI
    recommendation — so the UI can render what the operator actually decided.
    """
    decision: dict[str, Any] | None = None
    for msg in messages:
        metadata = msg.get("metadata")
        if isinstance(metadata, str):
            try:
                metadata = json.loads(metadata)
            except json.JSONDecodeError:
                metadata = {}
        meta = metadata if isinstance(metadata, dict) else {}
        raw = str(meta.get("decision") or "").lower()
        if raw in {"approve", "deny"}:
            # The agent-authored fallback carries explicit provenance in metadata.
            decision = {
                "decision": raw,
                "note": meta.get("note", ""),
                "authored_by": meta.get("authored_by", "agent_on_behalf_of_human"),
            }
            continue
        content = (msg.get("content") or "")
        if "[signed]" in content.lower():
            # A "[signed]" text message with no structured decision metadata is the
            # real-human path (posted via the /me/* user API); attribute it honestly.
            lower = content.lower()
            if "approve" in lower:
                decision = {"decision": "approve", "note": "", "authored_by": "human"}
            elif "deny" in lower:
                decision = {"decision": "deny", "note": "", "authored_by": "human"}
    return decision


def _classify_handshake_step(msg: dict[str, Any]) -> str | None:
    """Map a Band message to a handshake step key, or None if unrelated."""
    content = (msg.get("content") or "").lower()
    meta = _coerce_meta(msg.get("metadata"))
    stage = meta.get("stage")
    raw_result = meta.get("result")
    result = raw_result if isinstance(raw_result, dict) else {}

    is_handshake = (
        stage in {"recruiting", "discovery"}
        or "contact request" in content
        or "recruited" in content
        or "trust boundary" in content
        or "crossing" in content
        or "cross-org" in content
    )
    if not is_handshake:
        return None

    if result.get("joined") or "joined the room" in content or "joined room" in content:
        return "joined"
    if "approved" in content or "auto-approve" in content:
        return "approved"
    if "recruited" in content and (result.get("handle") or result.get("name")):
        return "joined" if result.get("joined") else "approved"
    if "contact request" in content or (stage == "discovery" and "match" in content):
        return "request"
    if "crossing" in content or "trust boundary" in content:
        return "consent"
    if stage == "recruiting":
        return "consent"
    return "request"


def _handshake_events(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for msg in messages:
        step = _classify_handshake_step(msg)
        if not step:
            continue
        events.append(
            {
                "step": step,
                "sender": msg.get("sender_name"),
                "content": msg.get("content", ""),
                "ts": msg.get("inserted_at"),
            }
        )
    return events


def _coerce_meta(metadata: Any) -> dict[str, Any]:
    if isinstance(metadata, str):
        try:
            return json.loads(metadata)
        except json.JSONDecodeError:
            return {}
    return metadata if isinstance(metadata, dict) else {}


# How sure a verdict is, derived from its risk band when the specialist returned no
# numeric confidence. These are deliberate, auditable heuristics — NOT fabricated
# precision: a high-risk deny is a high-conviction call, a low-risk one is softer.
# Surfaced with confidence_source="derived" so the UI can label it honestly.
_RISK_DERIVED_CONFIDENCE = {"high": 0.9, "medium": 0.75, "low": 0.6}


def _normalize_confidence(value: Any) -> float | None:
    """Coerce a model-supplied confidence to 0–1, or None if not a usable number.

    Free-form LLM JSON may give 0–1 or a 0–100 percentage; both normalize to 0–1.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    num = float(value)
    if num > 1:
        num = num / 100
    if num <= 0:
        return None
    return min(1.0, num)


def _verdict_confidence(
    verdict_result: dict[str, Any], risk: str | None, recommendation: str | None
) -> tuple[float | None, str | None]:
    """The specialist's confidence and its provenance.

    Returns (confidence, source) where source is:
      * "model"   — the specialist returned a real numeric confidence (preferred).
      * "derived" — no model number, but a verdict exists, so we derive a transparent
                    score from its risk band. Labelled derived; never passed off as
                    the model's own number.
      * None      — no verdict at all (recruited-but-silent / clean claim): no score
                    is invented. confidence is None too.
    """
    model = _normalize_confidence(verdict_result.get("confidence"))
    if model is not None:
        return model, "model"
    # A verdict exists only if the specialist actually produced risk or a recommendation.
    if risk or recommendation:
        return _RISK_DERIVED_CONFIDENCE.get((risk or "").lower(), 0.7), "derived"
    return None, None


def _specialist_descriptor(
    participants: list[dict[str, Any]], messages: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """One domain-agnostic descriptor of the specialist on this claim.

    Every scene reads this instead of hard-coding a single domain. It is derived
    from (a) whichever specialist participant (property / medical / legal) actually
    joined the room and (b) the structured specialist_verdict event's risk,
    recommendation, and explanation. Returns None when the claim classified to no
    domain and the Coordinator decided alone — the UI then shows the "no specialist"
    path.
    """
    # Which specialist (if any) is a participant in the room? Prefer the role the
    # normalizer already resolved; fall back to name classification so this helper
    # still works if handed raw participant dicts.
    joined_key: str | None = None
    joined_name: str | None = None
    for p in participants:
        key = p.get("role") or _classify_participant(p.get("name") or "")
        if key in SPECIALIST_KINDS:
            joined_key = key
            joined_name = p.get("name")
            break

    # The structured verdict carries the authoritative specialty + risk, plus the
    # specialist's own approve/deny call and the written explanation the Case
    # Coordinator relays verbatim to the human reviewer (siblings on the verdict event;
    # see SpecialistVerdictPayload). "fraud_verdict" is the legacy stage alias.
    verdict_specialty: str | None = None
    risk: str | None = None
    recommendation: str | None = None
    explanation: str = ""
    verdict_result: dict[str, Any] = {}
    for msg in messages:
        meta = _coerce_meta(msg.get("metadata"))
        if meta.get("stage") in {"specialist_verdict", "fraud_verdict"}:
            verdict_specialty = meta.get("specialty") or verdict_specialty
            risk = meta.get("risk") or risk
            rec = str(meta.get("recommendation") or "").lower()
            if rec in {"approve", "deny"}:
                recommendation = rec
            if meta.get("explanation"):
                explanation = str(meta.get("explanation"))
            # The model's free-form verdict object — where a numeric confidence,
            # if any, lives. Confidence may also sit at the metadata top level.
            res = meta.get("result")
            if isinstance(res, dict):
                verdict_result = res
            if meta.get("confidence") is not None and "confidence" not in verdict_result:
                verdict_result = {**verdict_result, "confidence": meta.get("confidence")}

    key = joined_key or (
        next((k for k, s in SPECIALIST_KINDS.items() if s["specialty"] == verdict_specialty), None)
    )
    if not key:
        return None

    spec = SPECIALIST_KINDS[key]
    meta = AGENT_META.get(key, {})
    confidence, confidence_source = _verdict_confidence(verdict_result, risk, recommendation)
    return {
        "type": spec["specialty"],
        "name": joined_name or spec["role"],
        "org": meta.get("org", "Unknown"),
        "framework": meta.get("framework", "—"),
        "provider": meta.get("model", "—"),
        "tag": spec["capability_tag"],
        "verdict_label": spec["verdict_label"],
        "risk": risk,
        # The specialist's own decision + rationale, relayed verbatim to the human
        # reviewer. None / "" until the specialist has returned its verdict.
        "recommendation": recommendation,
        "explanation": explanation,
        # Confidence (0–1) and its provenance. "model" when the specialist returned a
        # real number; "derived" when we computed it from the verdict's risk band (and
        # labelled it so); both None when there is no verdict to be confident about.
        # Never a fabricated constant — the integrity guarantee the UI relies on.
        "confidence": confidence,
        "confidence_source": confidence_source,
    }


def _discovery_payload(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """What the Case Coordinator saw and decided when assembling the team.

    Feeds the directory-reveal scene with the REAL discovery trace now that
    recruit() does deterministic tag-matching:
      * reasoning — the Coordinator's thought messages while choosing.
      * recruited_handle / recruited_name — who it ultimately recruited (from the
        recruiting event).
      * candidates — the agent peers considered during directory discovery, each
        with its Band tags (from the structured "discovery" event).
      * capability_tag — the claim's capability tag that discovery matched on.
      * match_path — "tag" (a real Band directory tag matched), "fallback" (matched
        by name because tags were unset), or "handle"/None (literal handle path).
    The full specialist directory cards are static UI — only the *choice* is dynamic.
    """
    reasoning: list[dict[str, Any]] = []
    recruited_handle: str | None = None
    recruited_name: str | None = None
    candidates: list[dict[str, Any]] = []
    capability_tag: str | None = None
    match_path: str | None = None
    for msg in messages:
        meta = _coerce_meta(msg.get("metadata"))
        sender = (msg.get("sender_name") or "")
        # accept-both: live Band sender may be the new "Case Coordinator" or the legacy "Adjudicator"
        if msg.get("message_type") == "thought" and ("coordinat" in sender.lower() or "adjud" in sender.lower()):
            reasoning.append(
                {"content": resolve_mentions(msg.get("content", ""), meta), "ts": msg.get("inserted_at")}
            )
        stage = meta.get("stage")
        if stage == "discovery":
            cands = meta.get("candidates")
            if isinstance(cands, list):
                candidates = cands
            capability_tag = meta.get("capability_tag") or capability_tag
            match_path = meta.get("match_path") or match_path
        if stage == "recruiting":
            recruited_handle = meta.get("specialist_handle") or recruited_handle
            recruited_name = meta.get("specialist_name") or recruited_name
            capability_tag = meta.get("capability_tag") or capability_tag
            match_path = meta.get("match_path") or match_path
    return {
        "reasoning": reasoning,
        "recruited_handle": recruited_handle,
        "recruited_name": recruited_name,
        "candidates": candidates,
        "capability_tag": capability_tag,
        "match_path": match_path,
    }


def _is_archived(messages: list[dict[str, Any]]) -> bool:
    """True if any message carries the soft-delete marker (metadata.archived).

    Band has no delete-room API, so deletion is a soft-delete: the delete endpoint
    posts an {"archived": True} event to the room. Because that marker lives in Band
    itself — not in the gateway's ephemeral caches — it survives a gateway restart or
    a re-poll that rehydrates the room. The read path checks it so an archived claim
    stays gone instead of resurfacing on the next sync.
    """
    for msg in messages:
        if _coerce_meta(msg.get("metadata")).get("archived") is True:
            return True
    return False


def _review_score_payload(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Latest review_score event surfaced for the live view (None if never computed)."""
    latest: dict[str, Any] | None = None
    for msg in messages:
        meta = _coerce_meta(msg.get("metadata"))
        if meta.get("stage") == "review_score":
            latest = {
                "score": meta.get("score"),
                "threshold": meta.get("threshold"),
                "recruit": meta.get("recruit"),
                "domain": meta.get("domain"),
                "present_signals": meta.get("present_signals") or [],
            }
    return latest


def project_state(
    messages: list[dict[str, Any]],
    participants_raw: list[dict[str, Any]],
    *,
    chat_id: str,
) -> dict[str, Any]:
    """Project a room transcript + participants into the dashboard's ArbiterState.

    The one deep interface for the projection plane: given the raw Band messages
    (already unioned across agent views by the caller) and the raw participants, return
    the full normalized state dict the dashboard consumes. Pure — no Band calls, no
    cache, no HTTP — so it is exercised directly in tests with a fixture transcript.

    `band_url` is Band's per-chat deep link, derived from chat_id (/chat/{id}
    singular; /chats/{id} 404s).
    """
    participants = _enrich_participants_with_history(
        _normalize_participants(participants_raw, messages), messages
    )
    return {
        "chat_id": chat_id,
        "participants": participants,
        "casefile": parse_casefile_entries(messages),
        "audit": _build_audit(messages),
        "handshake": _handshake_events(messages),
        "phase": infer_phase(messages),
        # The specialist on this claim (domain-agnostic spine every scene reads),
        # and what the Case Coordinator saw/decided when assembling the team. None /
        # empty for a clean claim where nobody was recruited.
        "specialist": _specialist_descriptor(participants, messages),
        "discovery": _discovery_payload(messages),
        # The Case Coordinator's deterministic routing score (the real number behind
        # the recruit decision). None until it has been computed for this claim.
        "routing_score": _review_score_payload(messages),
        # The Human Reviewer's actual sign-off (approve/deny), distinct from the
        # Case Coordinator's AI recommendation. None until a decision is signed.
        "decision": _human_decision(messages),
        # Soft-delete marker (durable in Band): when True the claim has been archived
        # by the Human Reviewer and the read path (/api/claims) excludes it, so a
        # deleted claim does not come back after a refresh rehydrates the room.
        "archived": _is_archived(messages),
        "band_url": f"https://app.band.ai/chat/{chat_id}",
    }
