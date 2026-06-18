"""Evidence Analyst agent (Pydantic AI, Org A / AI-ML API trigger, Featherless vision).

Perception → structured evidence_analysis event → hand off to Case Coordinator.
The LLM only orchestrates the deterministic ``run_evidence_analysis`` tool.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from band.adapters import PydanticAIAdapter
from band.core.protocols import AgentToolsProtocol
from pydantic_ai import RunContext

from agents.insurer.bootstrap import AgentSpec, run_agent
from agents.shared.casefile_schema import build_stage_metadata
from agents.shared.config import read_active_chat_id, upload_dir
from agents.shared.evidence import (
    analyze,
    preset_attachment_resolver,
    upload_attachment_resolver,
)
from agents.shared.handoff import display_of, mention_of, parse_claim, resolve_participant
from agents.shared.prompts import EVIDENCE_ANALYST_PROMPT
from agents.shared.providers import configure_aiml_env

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arbiter.evidence_analyst")

GOLDEN_CLAIM_DIR = Path(__file__).resolve().parents[2] / "seed" / "golden_claim"


def _has_attachments(claim: dict | None) -> bool:
    """True if the claim references any analyzable evidence (photos or a document).

    A fabricated/summary object the LLM invents typically has neither, so this is the
    signal to prefer the authoritative claim recovered from the room.
    """
    if not claim:
        return False
    photos = (claim.get("damage") or {}).get("photos") or []
    document = claim.get("supporting_document") or claim.get("police_report")
    return bool(photos or document)


async def _recover_claim_from_room(deps, *, prefer_claim_id: str | None = None) -> dict | None:
    """Recover the authoritative claim object from the room.

    The kickoff message AND Intake's handoff message both embed the full claim as a
    ```json``` block carrying ``damage.photos`` + ``supporting_document``, and this
    agent is @mentioned in the handoff, so they are in its own (mention-scoped)
    context. The attachments are the load-bearing data, so this prefers, in order:

      1. a claim that HAS attachments and matches ``prefer_claim_id`` (when given);
      2. any claim that HAS attachments (newest-first);
      3. a claim matching ``prefer_claim_id`` even without attachments;
      4. any parseable claim with a claim_id (newest-first) — last resort.

    Crucially, an attachment-bearing claim outranks an attachment-less one (the LLM's
    fabricated arg, echoed into the room as a tool_call, parses but has no photos).
    Best-effort: returns None if the room can't be read or nothing matches.
    """
    try:
        from agents.shared.config import get_agent_credentials, read_active_chat_id
        from gateway.band_client import BandClient

        _, key = get_agent_credentials("evidence_analyst")
        chat_id = read_active_chat_id()
        if not chat_id:
            return None
        messages = await BandClient(key).get_context(chat_id)
    except Exception as exc:  # noqa: BLE001 — recovery is best-effort
        logger.warning("claim recovery: room fetch failed: %s", exc)
        return None

    # Collect every parseable claim, newest-first, so the first hit in each
    # preference tier is also the most recent one.
    candidates: list[dict] = []
    for msg in reversed(messages):
        candidate = parse_claim(msg.get("content") or "")
        if candidate and candidate.get("claim_id"):
            candidates.append(candidate)

    def _pick(predicate) -> dict | None:
        return next((c for c in candidates if predicate(c)), None)

    chosen = (
        (_pick(lambda c: _has_attachments(c) and c.get("claim_id") == prefer_claim_id)
         if prefer_claim_id else None)
        or _pick(_has_attachments)
        or (_pick(lambda c: c.get("claim_id") == prefer_claim_id) if prefer_claim_id else None)
        or (candidates[0] if candidates else None)
    )
    if chosen is not None:
        logger.info(
            "Recovered claim %s from room context (attachments=%s)",
            chosen.get("claim_id"), _has_attachments(chosen),
        )
    return chosen


async def run_evidence_analysis(ctx: RunContext[AgentToolsProtocol], claim_json: str) -> str:
    """Analyze the claim's evidence, record findings, and hand off to the Case Coordinator.

    Call this ONCE with the claim JSON. It runs Featherless vision + deterministic
    signal derivation, then does the demo-critical mechanics deterministically so the
    pipeline never depends on the model emitting the right event or @mentioning the
    right agent:

      1. Runs evidence analysis (vision on uploads + PDF-vs-narrative signals).
      2. Emits the structured ``evidence_analysis`` event (observations, signals).
      3. Posts a Band message @mentioning the Case Coordinator — resolved from the
         room's actual participants — so Band schedules its turn next. Band still
         coordinates; only the target is made reliable.

    Args:
        claim_json: the full claim object as a JSON string (from the case-file).

    The leading ``ctx`` is required by Band's PydanticAIAdapter, which registers
    every custom tool via ``agent.tool()`` (the context-taking variant); a tool
    without it fails pydantic-ai schema generation and crashes the agent at startup.
    """
    deps = ctx.deps
    arg_claim = parse_claim(claim_json)
    # The attachments are the load-bearing data, and Band — not the LLM — is the
    # system of record for them: the kickoff message and Intake's handoff both embed
    # the full claim as a ```json``` block with the real damage.photos +
    # supporting_document the gateway wrote to disk. The LLM's arg, by contrast, is
    # unreliable: it has fabricated summary objects with no attachments, and can
    # invent filenames. So we ALWAYS cross-check against the room and PREFER a
    # room-recovered claim that has attachments, using the arg's claim_id only to
    # disambiguate when several claims are present. The arg is the fallback, used only
    # when the room yields nothing better (e.g. unit tests with no room, or a preset
    # where the arg already equals the authoritative claim).
    prefer_id = (arg_claim or {}).get("claim_id")
    recovered = await _recover_claim_from_room(deps, prefer_claim_id=prefer_id)
    if recovered is not None and _has_attachments(recovered):
        claim = recovered  # authoritative, has the real uploaded attachments
    elif _has_attachments(arg_claim):
        claim = arg_claim  # arg carries attachments and the room had nothing better
    else:
        claim = recovered or arg_claim  # neither has attachments; keep what we can
    if not claim:
        return json.dumps(
            {"error": "Could not parse claim JSON. Pass the verbatim claim object "
                      "from the Intake handoff message as claim_json."}
        )

    # Resolve uploaded attachments (custom claims) first, then golden assets
    # (presets). Both live under the shared state volume / baked-in seed dir.
    golden = preset_attachment_resolver(GOLDEN_CLAIM_DIR)
    chat_id = read_active_chat_id()
    resolver = (
        upload_attachment_resolver(upload_dir(chat_id), golden) if chat_id else golden
    )
    report = await asyncio.to_thread(analyze, claim, resolver)

    # Structured evidence event — authoritative input to the Case Coordinator's score.
    summary = (
        f"Evidence analysis complete: signals={report.signals or 'none'}; "
        f"{len(report.observations)} photo(s)"
        + (" (vision degraded)" if report.degraded else "")
    )
    await deps.send_event(summary, "task", build_stage_metadata("evidence_analysis", report))

    # Deterministic handoff to the Case Coordinator (the scorer). Band's /context is
    # mention-scoped, so the Coordinator never saw the kickoff or Intake's handoff
    # (it wasn't @mentioned in them) — i.e. it has no copy of the claim JSON. So we
    # carry the detected domain explicitly in this message AND in the evidence_analysis
    # event's suggested_domain (read_evidence_signals returns it), giving the
    # Coordinator a reliable domain to pick its capability tag from.
    coordinator = await resolve_participant(deps, "coordinat", "adjud")
    if coordinator:
        signal_line = ", ".join(report.signals) if report.signals else "no concern signals"
        # Mention via the mentions array only — Band embeds @[[uuid]] in content;
        # also prefixing @name in the text duplicates the display after resolution.
        await deps.send_message(
            f"Evidence analyzed — domain={report.suggested_domain}; "
            f"{signal_line}. Ready for scoring.",
            [mention_of(coordinator)],
        )
    return report.model_dump_json()


SPEC = AgentSpec(
    credential_name="evidence_analyst",
    build_adapter=lambda cfg: PydanticAIAdapter(
        model=f"openai:{cfg.aiml_model}",
        custom_section=EVIDENCE_ANALYST_PROMPT,
        additional_tools=[run_evidence_analysis],
        enable_execution_reporting=True,
    ),
    configure_env=configure_aiml_env,
    logger=logger,
    log_line="Evidence Analyst running (Pydantic AI trigger / Featherless vision tool)",
)


async def main() -> None:
    await run_agent(SPEC)


if __name__ == "__main__":
    asyncio.run(main())
