"""Shared boot sequence for the Insurance Provider's own agents.

Intake+Coverage, the Evidence Analyst, and the Case Coordinator each opened with the
same seven-step dance — load env, resolve provider config, look up Band credentials,
fetch the Band URLs, build an adapter, ``Agent.create`` with the standard
``SessionConfig``, ``agent.run`` — differing only in the adapter they build, their
credential name, and a log line. Copied three times, a fix to (say) the retry policy
had to be made in three places or silently drift.

This mirrors the specialist side's ``run_specialist(SpecialistSpec)``: the Band wiring
lives here once, and each insurer agent becomes a thin :class:`AgentSpec` + a call to
:func:`run_agent`. The one genuinely per-agent step — building the adapter — is passed
as a factory callback, because the adapter type itself varies (Intake/Evidence use
``PydanticAIAdapter``, the Coordinator uses ``LangGraphAdapter``) and is built from the
resolved provider config. The bootstrap treats the adapter as opaque: it only hands it
to ``Agent.create``.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from band import Agent
from band.runtime.types import SessionConfig

from agents.shared.config import (
    ProviderConfig,
    get_agent_credentials,
    get_band_urls,
    get_provider_config,
    load_env,
)
from agents.shared.readiness import serve


@dataclass(frozen=True)
class AgentSpec:
    """The per-agent identity of an Insurance Provider agent."""

    credential_name: str  # key in agent_config.yaml, e.g. "evidence_analyst"
    build_adapter: Callable[[ProviderConfig], Any]  # cfg -> a Band adapter
    logger: logging.Logger  # the agent's own logger (e.g. "arbiter.intake")
    log_line: str  # what the agent logs once it's running
    configure_env: Callable[[ProviderConfig], Any] | None = None
    # Optional pre-adapter env setup (Intake/Evidence call configure_aiml_env so the
    # OpenAI-compatible env vars are set before the adapter is built; the Coordinator
    # builds its LLM client directly and needs none).


async def run_agent(spec: AgentSpec) -> None:
    """Boot an Insurance Provider agent and run it until shutdown.

    Same shape as ``run_specialist``: resolve config + credentials, build the adapter
    via the spec's factory, create the Band agent with the standard session config, and
    run. The retry policy and connection wiring live here once, so they can't drift
    between the three agents.
    """
    load_env()
    cfg = get_provider_config()
    if spec.configure_env is not None:
        spec.configure_env(cfg)
    agent_id, api_key = get_agent_credentials(spec.credential_name)
    urls = get_band_urls()

    adapter = spec.build_adapter(cfg)

    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=urls.ws_url,
        rest_url=urls.rest_url,
        session_config=SessionConfig(max_message_retries=2),
    )

    spec.logger.info(spec.log_line)
    # serve() == agent.run(), but publishes a readiness marker the instant the
    # WebSocket connects so the gateway can poll for liveness instead of sleeping.
    await serve(agent, spec.credential_name)
