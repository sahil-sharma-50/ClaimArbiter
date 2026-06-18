"""Read and parse Band room context as the shared case-file."""

from __future__ import annotations

import json
import re
from typing import Any

import httpx

from agents.shared.config import BandUrls, get_band_urls

# Band embeds @mentions in message content as opaque @[[<participant-uuid>]]
# tokens; the human-readable name lives in metadata.mentions. Resolve them so the
# dashboard shows "@case-coordinator" instead of "@[[955efd0a-…]]".
_MENTION_RE = re.compile(r"@\[\[([0-9a-fA-F-]+)\]\]")


def _coerce_metadata(metadata: Any) -> dict[str, Any]:
    """Band sometimes serializes metadata as a JSON string; normalize to a dict."""
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
    return metadata if isinstance(metadata, dict) else {}


def resolve_mentions(content: Any, metadata: Any) -> str:
    """Replace @[[uuid]] tokens with @name using the message's mentions metadata.

    Tolerates a non-string ``content`` (Band content is normally a chat string, but
    callers pass ``msg.get("content")`` straight through; a stray scalar/dict would
    otherwise raise on the ``in`` check and bubble up as a 500 from the PDF endpoint).
    """
    if not isinstance(content, str):
        content = str(content) if content else ""
    if not content or "@[[" not in content:
        return content
    meta = _coerce_metadata(metadata)
    names: dict[str, str] = {}
    for m in meta.get("mentions", []) or []:
        if isinstance(m, dict) and m.get("id"):
            names[str(m["id"])] = m.get("name") or m.get("handle") or "someone"

    def _sub(match: re.Match[str]) -> str:
        return f"@{names.get(match.group(1), 'someone')}"

    return _MENTION_RE.sub(_sub, content)


async def fetch_chat_context(
    chat_id: str,
    api_key: str,
    *,
    urls: BandUrls | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    base = (urls or get_band_urls()).rest_url
    messages: list[dict[str, Any]] = []
    cursor: str | None = None

    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            params: dict[str, Any] = {"limit": limit}
            if cursor:
                params["cursor"] = cursor
            response = await client.get(
                f"{base}/api/v1/agent/chats/{chat_id}/context",
                headers={"X-API-Key": api_key},
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
            batch = payload.get("data", [])
            messages.extend(batch)
            metadata = payload.get("metadata", {})
            if not metadata.get("has_more"):
                break
            cursor = metadata.get("next_cursor")
            if not cursor:
                break

    return messages


def parse_casefile_entries(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for msg in messages:
        msg_type = msg.get("message_type", "")
        metadata = _coerce_metadata(msg.get("metadata"))

        stage = metadata.get("stage")
        if msg_type in {"task", "thought", "tool_result"} or stage:
            entries.append(
                {
                    "stage": stage or msg_type,
                    "summary": resolve_mentions(msg.get("content", ""), metadata),
                    "result": metadata.get("result", metadata),
                    "ts": msg.get("inserted_at"),
                    "sender": msg.get("sender_name"),
                    "message_type": msg_type,
                }
            )
    return entries


# Stage name → workflow phase. Both structured metadata.stage values and the
# content-signal fallbacks resolve through this map. "fraud_verdict" is kept as
# a legacy alias for the now domain-neutral "specialist_verdict".
_PHASE_BY_STAGE = {
    "signoff": "signed",
    "escalation": "escalated",
    "conflict": "conflict",
    "specialist_verdict": "investigating",
    "fraud_verdict": "investigating",  # legacy alias (pre-multi-specialist)
    "recruiting": "recruiting",
    "evidence_analysis": "evidence",
    "coverage": "coverage",
    "intake": "intake",
}

# Furthest-along phase wins. A claim only ever moves forward, so when several
# stages are present we report the latest one reached.
_PHASE_PRIORITY = (
    "signed",
    "escalated",
    "conflict",
    "investigating",
    "recruiting",
    "evidence",
    "coverage",
    "intake",
)


def _content_signals(content: str, sender: str = "") -> set[str]:
    """Infer pipeline stages from a message's text — a *fallback* only.

    Agents emit structured band_send_event entries with metadata.stage, and
    infer_phase() treats those as authoritative. This content-sniffing runs only
    when a transcript carries no structured stage at all, so it must never freeze
    a non-fraud claim. It is therefore kept domain-neutral: it keys on generic
    workflow vocabulary (coverage / recruit / verdict / recommend), not on the
    word "fraud" or auto-collision signals.

    Safety against the seeded claim JSON (which mentions fraud_signals /
    prior_claim_match): verdict phrasing is gated on a *specialist* sender — any
    sender that is not a known Insurance Provider role — and the seed message is posted by
    intake/Case Coordinator, so it can never be mistaken for a verdict. Phrases are
    also kept off the claim JSON's own vocabulary.
    """
    c = content.lower()
    s = (sender or "").lower()
    is_adjud = "coordinat" in s or "adjud" in s  # Insurance Provider's orchestrator (domain-neutral role)
    # Insurance Provider's own agents — intake, evidence analyst, Case Coordinator, Human Reviewer.
    # The Evidence Analyst MUST be here: its handoff prose ("high risk … inconsistent")
    # would otherwise be read as a specialist verdict and jump the phase past evidence.
    # Keep BOTH new ("coordinat"/"human") and legacy ("adjud"/"adjust") spellings: the Band
    # agents may not all be renamed yet, so a sender can still arrive as "Adjudicator"/"Adjuster".
    # NOTE: "adjuster" does NOT contain "adjud" — do not drop "adjust", or an adjuster-named
    # sender would be misclassified as a specialist and its prose could trip a false verdict.
    is_meridian = any(role in s for role in ("intake", "evidence", "coordinat", "adjud", "human", "adjust"))
    # A recruited investigator from any partner org (Investigators Unit, Property Group, MedCare…).
    is_specialist = bool(s) and not is_meridian
    signals: set[str] = set()

    # COVERAGE — intake/coverage agent confirms the policy is in force.
    if "coverage confirmation" in c or "coverage findings" in c or (
        "coverage" in c and ("confirm" in c or "covered" in c or "in force" in c)
    ):
        signals.add("coverage")

    # RECRUITING — a specialist is being pulled into the room across the org
    # boundary (the Case Coordinator's recruit step). Domain-neutral phrasing.
    if (
        "added for further investigation" in c
        or "recruiting" in c
        or "joined the room" in c
        or "joins the room" in c
        or ("specialist" in c and "added" in c)
        or (is_adjud and "proceed" in c and "investigat" in c)
    ):
        signals.add("recruiting")

    # SPECIALIST_VERDICT — a recruited investigator returns its findings. Generic
    # report phrasing, plus a specialist-sender gate so claim-JSON signals from
    # intake/Case Coordinator never trip it.
    if (
        "investigation report" in c
        or "verdict" in c
        or "risk level" in c
        or (
            is_specialist
            and (
                "i found" in c
                or "high risk" in c
                or "red flag" in c
                or ("recommend" in c and ("deny" in c or "approve" in c))
            )
        )
    ):
        signals.add("specialist_verdict")

    # ESCALATION — the Case Coordinator drafts an approve/deny recommendation and
    # hands the claim to the Human Reviewer (or tries to).
    if (
        "recommendation is to" in c
        or "please review and proceed" in c
        or ("recommend" in c and ("deny" in c or "approve" in c) and "claim" in c)
        or (
            is_adjud
            and (
                "escalat" in c
                or "@human reviewer" in c
                or "@adjuster" in c
                or "final recommendation" in c
                or ("draft" in c and "recommendation" in c)
                or "sign-off" in c
                or "sign off" in c
                # The recruit-FALSE path: the Coordinator scores below threshold and
                # posts a direct recommendation to the human — often by their real
                # name ("@Sahil Sharma … I recommend proceeding with the claim"),
                # without the literal words "escalate"/"human reviewer". Recognize a
                # Coordinator's final recommendation so a clean/excluded claim still
                # advances to sign-off instead of hanging at "investigating".
                # Gated to a recommendation/decision verb so it can't fire on the
                # "recommend recruiting" mid-flow message or the score thought (which
                # would wrongly jump a recruit-TRUE claim past investigating).
                or ("recommend" in c and "proceed" in c)
                or "direct decision" in c
            )
        )
    ):
        signals.add("escalation")

    return signals


def infer_phase(messages: list[dict[str, Any]]) -> str:
    """Resolve the workflow phase, trusting structured metadata.stage first.

    Structured stages emitted via band_send_event are authoritative: a recruited
    specialist that emits a structured "specialist_verdict" advances the phase no
    matter how its prose reads. The content-signal fallback is layered on top as a
    safety net for the transitions an LLM posts as free-form text instead of a
    structured event (the original code noted "LLMs rarely comply"). Because those
    signals are now domain-neutral and specialist-sender-gated, they can only push
    the phase forward and can never be tripped by the seeded claim JSON — so the
    union is strictly safer than either source alone. Furthest-along phase wins.

    Auto-escalate safety net: a structured specialist_verdict maps to "investigating"
    on its own, because reaching the human's sign-off normally requires the Case
    Coordinator to relay the verdict (an "escalation" event). That relay is an LLM
    turn that can silently fail to fire (a missed re-trigger, or the model just not
    calling escalate_to_human) — leaving a claim with a finished approve/deny verdict
    hung at "investigating" forever (the live CLM-2026-0099 bug). So once a verdict
    carries a CONCRETE approve/deny recommendation, the human's turn has genuinely
    arrived: advance to "escalated" deterministically.

    This fires even under a cross-check "conflict". The conflict loop asks the
    Coordinator to re-mention the specialist to reconcile, but the specialist is
    single-shot (SPECIALIST_DISCIPLINE: "post EXACTLY ONCE, then STOP"), so it never
    replies and the claim would hang in "conflict" forever. Since a recommendation
    already exists, the human must still receive it — the prompt itself says "even on
    conflict you still relay the specialist's final recommendation". "escalated"
    outranks "conflict" in _PHASE_PRIORITY, so the conflict is flagged to the human
    (the ConflictScene still renders) rather than being a dead end. A conflict with NO
    recommendation yet has nothing to relay, so it correctly rests at "conflict".
    """
    stages: set[str] = set()
    signed = False
    verdict_recommended = False

    for msg in messages:
        metadata = _coerce_metadata(msg.get("metadata"))
        stage = metadata.get("stage")
        if stage:
            stages.add(stage)
        # A structured verdict carrying a concrete approve/deny recommendation means
        # the specialist has finished and the human's turn has arrived.
        if stage in {"specialist_verdict", "fraud_verdict"} and str(
            metadata.get("recommendation") or ""
        ).lower() in {"approve", "deny"}:
            verdict_recommended = True
        # Layer the safe content fallback on top of any structured stage.
        stages |= _content_signals(msg.get("content") or "", msg.get("sender_name", ""))
        lower = (msg.get("content") or "").lower()
        # The approve endpoint posts "Final decision: ... [signed]"; also accept
        # "signed off" phrasing and a structured decision in metadata.
        if "[signed]" in lower or "signed off" in lower or "final decision:" in lower or (
            metadata.get("decision") in {"approve", "deny"}
        ):
            signed = True

    # Auto-escalate a recommended verdict so it never hangs at "investigating" (nor
    # deadlocks in "conflict" against a single-shot specialist). "escalated" outranks
    # "conflict", so a pending conflict is flagged to the human, not a dead end.
    if verdict_recommended:
        stages.add("escalation")

    if signed:
        return "signed"
    phases = {_PHASE_BY_STAGE.get(s) for s in stages}
    phases.discard(None)
    for phase in _PHASE_PRIORITY:
        if phase in phases:
            return phase
    return "intake"


def format_context_for_prompt(messages: list[dict[str, Any]], limit: int = 40) -> str:
    lines: list[str] = []
    for msg in messages[-limit:]:
        sender = msg.get("sender_name", "unknown")
        msg_type = msg.get("message_type", "text")
        content = msg.get("content", "")
        lines.append(f"[{msg_type}] {sender}: {content}")
    return "\n".join(lines)
