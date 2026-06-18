"""Shared builder for ARBITER specialist investigators (CrewAI / Featherless).

All three specialists — property, medical, legal — are identical except for their
domain role/goal/backstory/prompt. The Band wiring the recruit depends on (the
CALLBACK auto-approve contact handler that consents to the Case Coordinator's cross-org
request) lives here once, so it can't drift between specialists. Each specialist
module is a thin dataclass + a call to ``run_specialist``.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass

# CrewAI ships OpenTelemetry tracing that POSTs to an external collector on every
# LLM call. When the collector is unreachable, this floods the logs with harmless
# export errors. Disable it before crewai is imported.
os.environ.setdefault("CREWAI_DISABLE_TELEMETRY", "true")
os.environ.setdefault("OTEL_SDK_DISABLED", "true")

from band import Agent
from band.adapters import CrewAIAdapter
from band.platform.event import ContactEvent, ContactRequestReceivedEvent
from band.runtime.contact_tools import ContactTools
from band.runtime.types import ContactEventConfig, ContactEventStrategy, SessionConfig

from agents.shared.config import get_agent_credentials, get_band_urls, get_provider_config, load_env
from agents.shared.providers import configure_featherless_env, featherless_model_name
from agents.shared.readiness import serve


@dataclass(frozen=True)
class SpecialistSpec:
    """The per-domain identity of a specialist investigator."""

    credential_name: str  # key in agent_config.yaml, e.g. "property_agent"
    log_name: str         # short logger suffix, e.g. "property"
    role: str             # CrewAI role
    goal: str             # CrewAI goal
    backstory: str        # CrewAI backstory
    prompt: str           # the system prompt (from agents.shared.prompts)


def _make_auto_approve(logger: logging.Logger):
    async def auto_approve(event: ContactEvent, tools: ContactTools) -> None:
        # Deterministic, no LLM: consent to any inbound contact request so the
        # Case Coordinator's cross-org recruit completes immediately.
        if isinstance(event, ContactRequestReceivedEvent):
            logger.info(
                "Auto-approving contact request from %s",
                getattr(event.payload, "from_handle", "unknown"),
            )
            await tools.respond_contact_request("approve", request_id=event.payload.id)

    return auto_approve


async def run_specialist(spec: SpecialistSpec) -> None:
    """Boot a specialist investigator agent and run it until shutdown."""
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(f"arbiter.{spec.log_name}")

    load_env()
    configure_featherless_env()
    cfg = get_provider_config()
    agent_id, api_key = get_agent_credentials(spec.credential_name)
    urls = get_band_urls()

    adapter = CrewAIAdapter(
        model=featherless_model_name(cfg),
        role=spec.role,
        goal=spec.goal,
        backstory=spec.backstory,
        custom_section=spec.prompt,
        enable_execution_reporting=True,
        verbose=False,
        max_iter=20,
    )

    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=urls.ws_url,
        rest_url=urls.rest_url,
        session_config=SessionConfig(max_message_retries=2),
        contact_config=ContactEventConfig(
            strategy=ContactEventStrategy.CALLBACK,
            on_event=_make_auto_approve(logger),
            broadcast_changes=True,
        ),
    )

    logger.info(
        "%s specialist running (CrewAI / Featherless, CALLBACK auto-approve)", spec.log_name
    )
    # serve() == agent.run(), but publishes a readiness marker the instant the
    # WebSocket connects so the gateway can poll for liveness instead of sleeping.
    await serve(agent, spec.credential_name)


def main_for(spec: SpecialistSpec) -> None:
    asyncio.run(run_specialist(spec))
