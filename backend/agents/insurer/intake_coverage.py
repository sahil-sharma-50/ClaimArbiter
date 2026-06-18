"""Intake + Coverage agent (Pydantic AI, Org A / AI-ML API)."""

from __future__ import annotations

import asyncio
import json
import logging

from band.adapters import PydanticAIAdapter
from band.core.protocols import AgentToolsProtocol
from pydantic_ai import RunContext

from agents.insurer.bootstrap import AgentSpec, run_agent
from agents.shared.casefile_schema import CoverageResult, IntakeResult, build_stage_metadata
from agents.shared.evidence import classify_domain
from agents.shared.handoff import display_of, mention_of, parse_claim, resolve_participant
from agents.shared.prompts import INTAKE_PROMPT
from agents.shared.providers import configure_aiml_env

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arbiter.intake")

# Domains the Case Coordinator can recruit a specialist for. Intake classifies the
# claim into one of these; the value flows to the Coordinator via the intake event AND
# the claim JSON it re-posts on handoff, where the Coordinator reads `domain` to pick a
# capability tag. A claim that fits NONE of these resolves to None — the Coordinator
# then decides it directly with no specialist.
_VALID_DOMAINS = ("property", "medical", "legal")


def _resolve_domain(claim: dict, llm_domain: str) -> str | None:
    """Settle the claim's domain: trust the LLM's classification when it's valid.

    The Intake LLM is asked to classify the domain from the narrative; if it returns
    a known value (property/medical/legal) we trust it. Otherwise (blank, "unknown",
    or junk) we re-derive deterministically from the claim's story with the shared
    classifier. That classifier returns None when nothing points to a domain, and we
    propagate that None: the form no longer supplies a real domain (it defaults to
    "unknown"), so this is the single point where the claim's domain — or its absence
    — is decided.
    """
    candidate = (llm_domain or "").strip().lower()
    if candidate in _VALID_DOMAINS:
        return candidate
    return classify_domain(claim)


async def record_coverage_and_handoff(
    ctx: RunContext[AgentToolsProtocol],
    claim_json: str,
    domain: str,
    covered: bool,
    coverage_note: str,
) -> str:
    """Record structured intake + coverage findings and hand off to the Evidence Analyst.

    Call this ONCE after you have parsed the claim, classified its domain, and decided
    coverage. It does the brittle, demo-critical mechanics deterministically so the
    pipeline never depends on the model emitting the right structured events or
    @mentioning the right agent:

      1. Settles the claim domain (your ``domain`` if valid, else re-derived from the
         narrative) and writes it into the claim, so every downstream reader — the
         intake event, the handoff JSON, and ultimately the Case Coordinator — sees
         the SAME detected domain instead of the form's neutral placeholder.
      2. Emits the structured ``intake`` event (claim id, domain, parties, doc count)
         so the dashboard's Intake step shows the real claim.
      3. Emits the structured ``coverage`` event (covered flag + your note).
      4. Posts a Band message @mentioning the Evidence Analyst — resolved from the
         room's actual participants — with the (domain-corrected) claim JSON, so Band
         schedules the Evidence Analyst's turn next. Band still does the coordination;
         only the target is made reliable.

    Args:
        claim_json: the full claim object as a JSON string.
        domain: the claim's domain you determined — "property", "medical", or "legal".
        covered: whether the policy covers this loss (your coverage decision).
        coverage_note: one concise sentence explaining the coverage finding.
    """
    deps = ctx.deps
    claim = parse_claim(claim_json) or {}
    # Decide the domain once and stamp it onto the claim so the handoff JSON (which
    # the Case Coordinator reads to pick a capability tag) carries the detected value,
    # not the form's "unknown" placeholder.
    domain = _resolve_domain(claim, domain)
    claim["domain"] = domain
    domain_label = domain or "no specialist domain"
    parties = claim.get("parties") or {}
    photos = list((claim.get("damage") or {}).get("photos") or [])
    docs = len(photos) + (1 if (claim.get("supporting_document") or claim.get("police_report")) else 0)

    # 1) Structured intake event — gives the dashboard's Intake step real data.
    #    Built from the typed IntakeResult so the payload shape can't drift from what
    #    the gateway/dashboard read; build_stage_metadata emits the same wire bytes.
    await deps.send_event(
        f"Intake parsed claim {claim.get('claim_id', '?')} ({domain_label}).",
        "task",
        build_stage_metadata("intake", IntakeResult(
            claim_id=claim.get("claim_id"),
            domain=domain,
            subject=(parties.get("claimant") or {}).get("name"),
            docs=docs,
        )),
    )

    # 2) Structured coverage event — authoritative coverage finding.
    await deps.send_event(
        f"Coverage {'confirmed' if covered else 'excluded'}: {coverage_note}",
        "task",
        build_stage_metadata("coverage", CoverageResult(
            covered=covered,
            policy=claim.get("policy_id"),
            deductible=claim.get("deductible"),
            domain=domain,
            note=coverage_note,
        )),
    )

    # 3) Deterministic handoff: mention the Evidence Analyst by its real handle.
    analyst = await resolve_participant(deps, "evidence")
    if not analyst:
        return (
            "Recorded intake + coverage, but no Evidence Analyst is in the room to "
            "hand off to. Coverage is on record."
        )
    await deps.send_message(
        f"Coverage {'confirmed' if covered else 'excluded'}. "
        f"Please analyze the attached evidence for this claim.\n\n"
        f"```json\n{json.dumps(claim, indent=2)}\n```",
        [mention_of(analyst)],
    )
    return f"Recorded intake + coverage and handed off to {display_of(analyst)}."


SPEC = AgentSpec(
    credential_name="intake_coverage",
    build_adapter=lambda cfg: PydanticAIAdapter(
        model=f"openai:{cfg.aiml_model}",
        custom_section=INTAKE_PROMPT,
        additional_tools=[record_coverage_and_handoff],
        enable_execution_reporting=True,
    ),
    configure_env=configure_aiml_env,
    logger=logger,
    log_line="Intake+Coverage agent running (Pydantic AI / AI-ML API)",
)


async def main() -> None:
    await run_agent(SPEC)


if __name__ == "__main__":
    asyncio.run(main())
