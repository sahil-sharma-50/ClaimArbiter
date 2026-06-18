"""LLM-based expert matching — pick the best specialist for a claim from the Band directory.

The Case Coordinator always attempts to match a claim to an available expert agent.
When the LLM finds a genuine fit, recruitment proceeds. When no agent matches, the
Coordinator keeps the claim and decides approve/deny itself.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field, ValidationError

from agents.shared.casefile import parse_casefile_entries
from agents.shared.providers import aiml_llm
from agents.shared.registry import SPECIALISTS, by_tag

logger = logging.getLogger("arbiter.expert_match")

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


class ExpertMatchDecision(BaseModel):
    """Structured LLM output for expert selection."""

    matched: bool = False
    handle: str | None = None
    capability_tag: str | None = None
    rationale: str = ""


def _extract_claim_json(messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Best-effort claim object from a handoff ```json block in the room."""
    for msg in messages:
        content = msg.get("content") or ""
        if not isinstance(content, str) or "claim_id" not in content:
            continue
        match = _JSON_FENCE.search(content)
        raw = match.group(1) if match else content
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            continue
        try:
            obj = json.loads(raw[start : end + 1])
            if isinstance(obj, dict) and obj.get("claim_id"):
                return obj
        except json.JSONDecodeError:
            continue
    return None


def _claim_narrative(claim: dict[str, Any]) -> str:
    """Compact narrative for the matcher prompt."""
    parts: list[str] = []
    if claim.get("claim_id"):
        parts.append(f"claim_id={claim['claim_id']}")
    if claim.get("domain"):
        parts.append(f"domain={claim['domain']}")
    if claim.get("claim_type"):
        parts.append(f"type={claim['claim_type']}")
    treatment = claim.get("treatment")
    if isinstance(treatment, dict):
        injury = treatment.get("reported_injury") or treatment.get("injury")
        if injury:
            parts.append(f"injury/treatment: {injury}")
        billed = treatment.get("billed_items")
        if billed:
            parts.append(f"billed: {', '.join(str(x) for x in billed[:6])}")
    damage = claim.get("damage")
    if isinstance(damage, dict):
        desc = damage.get("description") or damage.get("narrative")
        if desc:
            parts.append(f"damage: {desc}")
    legal = claim.get("legal")
    if isinstance(legal, dict):
        matter = legal.get("matter") or legal.get("description")
        if matter:
            parts.append(f"legal matter: {matter}")
    signals = claim.get("review_signals")
    if signals:
        parts.append(f"review_signals: {', '.join(str(s) for s in signals)}")
    return "; ".join(parts) if parts else json.dumps(claim, default=str)[:1200]


def gather_claim_context(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize claim state from structured casefile entries and handoff JSON."""
    entries = parse_casefile_entries(messages)
    ctx: dict[str, Any] = {
        "claim_id": None,
        "domain": None,
        "suggested_domain": None,
        "signals": [],
        "coverage_covered": None,
        "coverage_note": "",
        "narrative": "",
    }
    for entry in entries:
        stage = entry.get("stage")
        result = entry.get("result") if isinstance(entry.get("result"), dict) else {}
        if stage == "intake":
            ctx["claim_id"] = result.get("claim_id")
            ctx["domain"] = result.get("domain")
        elif stage == "coverage":
            ctx["coverage_covered"] = result.get("covered")
            ctx["coverage_note"] = result.get("note") or entry.get("summary") or ""
            if result.get("domain"):
                ctx["domain"] = result.get("domain")
        elif stage == "evidence_analysis":
            ctx["signals"] = list(result.get("signals") or [])
            ctx["suggested_domain"] = result.get("suggested_domain")
            if entry.get("summary"):
                ctx["narrative"] = entry.get("summary")

    claim = _extract_claim_json(messages)
    if claim:
        ctx["narrative"] = ctx["narrative"] or _claim_narrative(claim)
        ctx["domain"] = ctx["domain"] or claim.get("domain")
        if not ctx["signals"]:
            ctx["signals"] = list(claim.get("review_signals") or [])

    if not ctx["narrative"]:
        ctx["narrative"] = (
            f"Domain hint: {ctx['suggested_domain'] or ctx['domain'] or 'unknown'}; "
            f"signals: {', '.join(ctx['signals']) or 'none'}; "
            f"coverage: {'covered' if ctx['coverage_covered'] else 'excluded' if ctx['coverage_covered'] is False else 'unknown'}"
        )
    return ctx


def _registry_blurb(handle: str, tags: list[str]) -> str:
    """Attach registry expertise text when a peer maps to a known specialist."""
    hay = f"{handle} {' '.join(tags)}".lower()
    for spec in SPECIALISTS:
        if spec.capability_tag in tags or any(n in hay for n in spec.needles):
            return f"{spec.card_title} — {spec.verdict_label} ({spec.org})"
    for spec in SPECIALISTS:
        if spec.capability_tag in tags:
            return f"{spec.card_title} — {spec.verdict_label} ({spec.org})"
    return ""


def _format_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    formatted: list[dict[str, Any]] = []
    for c in candidates:
        tags = [str(t) for t in (c.get("tags") or [])]
        formatted.append(
            {
                "handle": c.get("handle"),
                "name": c.get("name"),
                "tags": tags,
                "expertise": _registry_blurb(str(c.get("handle") or ""), tags),
            }
        )
    return formatted


def _parse_llm_json(text: str) -> ExpertMatchDecision | None:
    raw = text.strip()
    fence = _JSON_FENCE.search(raw)
    if fence:
        raw = fence.group(1).strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        return ExpertMatchDecision.model_validate(json.loads(raw[start : end + 1]))
    except (json.JSONDecodeError, ValidationError) as exc:
        logger.warning("expert_match: invalid LLM JSON: %s", exc)
        return None


_MATCH_SYSTEM = """You match insurance claims to expert agents in a cross-org directory.

Each candidate agent advertises capability tags and serves a specific domain:
- property-damage: building/dwelling damage, water, fire, structural loss
- medical-review: bodily injury, treatment, billing, diagnostics
- legal-review: attorney fees, litigation, liability defense, legal costs

Read the claim context and pick the ONE agent whose expertise genuinely fits.
Set matched=true only when the claim clearly belongs to that agent's domain.
Set matched=false when no candidate is appropriate — do not force-fit.

Respond with JSON only (no markdown):
{"matched": true|false, "handle": "@org/agent-handle or null", "capability_tag": "tag or null", "rationale": "one concise sentence"}"""


def _validate_decision(
    decision: ExpertMatchDecision, candidates: list[dict[str, Any]]
) -> ExpertMatchDecision:
    """Ensure the LLM picked a real candidate handle."""
    if not decision.matched:
        return ExpertMatchDecision(matched=False, rationale=decision.rationale or "No suitable expert.")
    handle = (decision.handle or "").strip().lower()
    if not handle:
        return ExpertMatchDecision(matched=False, rationale="LLM matched but gave no handle.")
    for c in candidates:
        ch = str(c.get("handle") or "").strip().lower()
        if not ch:
            # A peer with no handle can't be the match — skip it. Otherwise the
            # endswith("") suffix checks below would spuriously match every LLM
            # handle against this empty candidate.
            continue
        if ch == handle or handle.endswith(ch.lstrip("@")) or ch.endswith(handle.lstrip("@")):
            tag = decision.capability_tag or (c.get("tags") or [None])[0]
            return ExpertMatchDecision(
                matched=True,
                handle=c.get("handle"),
                capability_tag=str(tag) if tag else None,
                rationale=decision.rationale,
            )
    return ExpertMatchDecision(
        matched=False,
        rationale=f"LLM chose unknown handle {decision.handle}; no recruitment.",
    )


def match_expert_with_llm(
    claim_context: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> ExpertMatchDecision:
    """Use the AI/ML API to select the best expert, or return no match."""
    if not candidates:
        return ExpertMatchDecision(matched=False, rationale="No expert agents in the Band directory.")

    roster = _format_candidates(candidates)
    user = (
        "Claim context:\n"
        f"{json.dumps(claim_context, indent=2)}\n\n"
        "Available expert agents:\n"
        f"{json.dumps(roster, indent=2)}"
    )
    try:
        llm = aiml_llm(temperature=0)
        response = llm.invoke([SystemMessage(content=_MATCH_SYSTEM), HumanMessage(content=user)])
        text = response.content if isinstance(response.content, str) else str(response.content)
        parsed = _parse_llm_json(text)
        if parsed is None:
            return ExpertMatchDecision(matched=False, rationale="Expert matcher returned unreadable output.")
        return _validate_decision(parsed, candidates)
    except Exception as exc:  # noqa: BLE001 — fall back to deterministic tag match
        logger.warning("expert_match: LLM call failed (%s); using domain fallback", exc)
        return _domain_fallback_match(claim_context, candidates)


def _domain_fallback_match(
    claim_context: dict[str, Any],
    candidates: list[dict[str, Any]],
) -> ExpertMatchDecision:
    """When the LLM is unavailable, map suggested domain → capability tag → peer."""
    from agents.shared.registry import by_domain

    domain = (
        claim_context.get("suggested_domain")
        or claim_context.get("domain")
        or ""
    )
    dom = str(domain).strip().lower()
    if dom in ("", "unknown", "none", "null"):
        return ExpertMatchDecision(matched=False, rationale="No domain hint for fallback matching.")

    spec = by_domain(dom)
    if not spec:
        return ExpertMatchDecision(matched=False, rationale=f"No registry specialist for domain '{dom}'.")

    tag = spec.capability_tag
    for c in candidates:
        tags = [str(t).lower() for t in (c.get("tags") or [])]
        hay = f"{c.get('name') or ''} {c.get('handle') or ''}".lower()
        if tag in tags or any(n in hay for n in spec.needles):
            return ExpertMatchDecision(
                matched=True,
                handle=c.get("handle"),
                capability_tag=tag,
                rationale=f"Fallback match: {spec.card_title} for {dom} claim.",
            )
    return ExpertMatchDecision(
        matched=False,
        rationale=f"No directory peer advertises '{tag}' for this {dom} claim.",
    )
