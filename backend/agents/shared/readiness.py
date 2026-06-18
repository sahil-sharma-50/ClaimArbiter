"""File-based readiness markers so the gateway can poll for agent liveness.

The gateway spawns the agent process group and then needs to know when the agents
have actually opened their Band WebSocket connections before posting the seed
message. There is no presence signal in the Band SDK or REST API, so each agent
drops a marker file the instant its connection is live, and the supervisor polls
the marker directory instead of sleeping a fixed boot delay.

The seam is precise: ``Agent.run()`` is ``start()`` (opens the WebSocket and
returns) followed by ``run_forever()`` (blocks). :func:`serve` runs ``start()``,
writes the marker, then blocks in ``run_forever()`` — so a marker means "this
agent's WebSocket is connected", not merely "the process is alive".
"""

from __future__ import annotations

import os
from pathlib import Path

# One directory holds one empty file per ready agent, named by credential_name.
# Configurable so the gateway and the subprocess group agree on the location
# (they share a filesystem); defaults under the backend tmp area.
READY_DIR = Path(
    os.environ.get("AGENT_READY_DIR", "/tmp/arbiter-agent-ready")  # noqa: S108
)

# Graceful-shutdown ceiling for agent.stop(), mirroring Band Agent.run()'s default.
SHUTDOWN_TIMEOUT = float(os.environ.get("AGENT_SHUTDOWN_TIMEOUT", "30"))


def _marker(name: str) -> Path:
    return READY_DIR / name


def reset(names: list[str] | tuple[str, ...]) -> None:
    """Clear stale markers before a (re)spawn so old files can't read as ready."""
    READY_DIR.mkdir(parents=True, exist_ok=True)
    for name in names:
        _marker(name).unlink(missing_ok=True)


def mark_ready(name: str) -> None:
    """Record that the agent identified by ``name`` is connected and listening."""
    READY_DIR.mkdir(parents=True, exist_ok=True)
    _marker(name).touch()


def ready_names(names: list[str] | tuple[str, ...]) -> set[str]:
    """Return the subset of ``names`` whose markers are present."""
    return {name for name in names if _marker(name).exists()}


async def serve(agent: object, name: str) -> None:
    """Start ``agent``, publish its readiness marker, then run until shutdown.

    ``agent`` is duck-typed to Band's ``Agent`` (``start`` / ``run_forever`` /
    ``stop`` coroutines); kept loose so this module has no hard SDK dependency and
    stays trivially unit-testable with a fake.
    """
    await agent.start()  # type: ignore[attr-defined]
    mark_ready(name)
    try:
        await agent.run_forever()  # type: ignore[attr-defined]
    finally:
        _marker(name).unlink(missing_ok=True)
        # Bound the wait like Band's own Agent.run() (which stops with a graceful
        # timeout) so a hung WebSocket close can't block teardown/reseed forever.
        await agent.stop(timeout=SHUTDOWN_TIMEOUT)  # type: ignore[attr-defined]
