"""Deterministic, Band-native handoffs between the insurer's agents.

The insurer pipeline (Intake → Evidence Analyst → Case Coordinator) advances by
@mentioning the next agent in a Band message: Band delivers that mention as the
next agent's turn. Letting the LLM type the @mention proved unreliable — Intake
mentioned the Case Coordinator (the display name that happened to resolve)
instead of the Evidence Analyst, whose Band name ("Evidence Analyst") never
matched the prompt's "@EvidenceAnalyst". Evidence analysis was skipped and the
fraud trap never sprang.

These helpers keep Band as the coordinator (it still carries the message and
schedules the turn) but make the *target* deterministic: the next agent is
resolved from the room's actual participants and mentioned by its real handle,
which Band's mention resolver matches by handle → name → id.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

# Tool-side deps (band.core.protocols.AgentToolsProtocol). Typed as Any to avoid
# coupling this pure-logic module to the SDK import at module load.
Deps = Any


def parse_claim(claim_json: str) -> dict[str, Any] | None:
    """Parse a claim object from a tool arg that may be raw JSON or fenced prose.

    The LLM passes the claim in several shapes, so this is deliberately tolerant:
      * a clean JSON object string;
      * a *double-encoded* JSON string (a JSON string whose content is the JSON
        object) — pydantic-ai string args frequently arrive this way, and a single
        json.loads yields a str, not a dict;
      * JSON with raw (unescaped) control characters in string values — gpt-4o emits
        literal newlines inside e.g. the narrative, which strict json.loads rejects;
        we parse with strict=False so those don't drop the whole claim;
      * a chunk of transcript with a ```json fenced block or a bare {...} object.
    Returns the dict, or None if no object can be recovered.
    """
    # Try a direct parse, unwrapping up to one layer of string-encoding. strict=False
    # tolerates raw control chars (literal newlines/tabs) inside string values.
    value: Any = claim_json
    for _ in range(2):
        try:
            value = json.loads(value, strict=False)
        except (json.JSONDecodeError, TypeError):
            break
        if isinstance(value, dict):
            return value
        if not isinstance(value, str):
            break  # parsed to a non-dict, non-str (list/number) — not a claim

    # Fall back to extracting a fenced or bare {...} object from prose.
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", claim_json or "")
    raw = fence.group(1) if fence else (claim_json or "")
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        obj = json.loads(raw[start : end + 1], strict=False)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        return None


def _match(participants: list[dict[str, Any]], needles: tuple[str, ...]) -> dict[str, Any] | None:
    for p in participants:
        name = (p.get("name") or "").lower()
        handle = (p.get("handle") or "").lower()
        if any(n in name or n in handle for n in needles):
            return p
    return None


def _normalize(participants: Any) -> list[dict[str, Any]]:
    """Coerce a participant list (dicts or Fern models) to plain dicts."""
    out: list[dict[str, Any]] = []
    items = participants if isinstance(participants, list) else getattr(participants, "data", []) or []
    for p in items:
        if isinstance(p, dict):
            out.append(p)
        else:
            out.append(
                {
                    "id": getattr(p, "id", None),
                    "name": getattr(p, "name", None),
                    "handle": getattr(p, "handle", None),
                }
            )
    return out


async def resolve_participant(deps: Deps, *needles: str) -> dict[str, Any] | None:
    """Return the first room participant whose name or handle contains a needle.

    Reads the cached participant snapshot first; if the target isn't there (it may
    have joined after the snapshot), refreshes once from the platform. Returns the
    participant dict (so the caller can mention by handle and display the name), or
    None when no participant matches.
    """
    needles_l = tuple(n.lower() for n in needles)
    hit = _match(_normalize(deps.participants), needles_l)
    if hit:
        return hit
    try:
        refreshed = await deps.get_participants()
    except Exception:  # noqa: BLE001 — a refresh failure must not crash the handoff
        return None
    return _match(_normalize(refreshed), needles_l)


def mention_of(participant: dict[str, Any]) -> str:
    """The resolvable mention string for a participant (handle preferred)."""
    return participant.get("handle") or participant.get("name") or ""


def mention_record(participant: dict[str, Any]) -> dict[str, str]:
    """Band REST mention object (id + handle + name) for send_message."""
    return {
        "id": str(participant.get("id") or ""),
        "handle": participant.get("handle") or "",
        "name": participant.get("name") or "",
    }


def display_of(participant: dict[str, Any]) -> str:
    """The human-readable name for a participant (for message text)."""
    return participant.get("name") or participant.get("handle") or "the next agent"


def _human_reviewer_user_id() -> str | None:
    value = (os.environ.get("HUMAN_REVIEWER_USER_ID") or "").strip()
    return value or None


def _is_user_participant(participant: dict[str, Any]) -> bool:
    ptype = str(
        participant.get("type") or participant.get("participant_type") or ""
    ).strip().lower()
    return ptype == "user"


def resolve_human_reviewer(participants: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Return the human reviewer from a room participant list.

    Prefers ``HUMAN_REVIEWER_USER_ID`` when configured, then the sole User-type
    participant, then a user whose name/handle suggests human review. Agents
    (e.g. Medical Claims Reviewer) are never selected.
    """
    normalized = _normalize(participants)
    human_id = _human_reviewer_user_id()
    if human_id:
        for p in normalized:
            if str(p.get("id")) == human_id:
                return p

    users = [p for p in normalized if _is_user_participant(p)]
    if len(users) == 1:
        return users[0]

    for p in users:
        hay = f"{p.get('name') or ''} {p.get('handle') or ''}".lower()
        if any(n in hay for n in ("human", "adjuster", "reviewer")):
            return p

    return users[0] if users else None
