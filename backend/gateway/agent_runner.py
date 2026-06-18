"""Supervises the ARBITER agent process group on behalf of the gateway.

The three agents are long-running Band WebSocket clients that build their LLM
client from environment variables *at startup*. To let a visitor bring their own
provider keys (with the server's .env as the fallback), the gateway is the sole
launcher: it (re)spawns the agent process group with the resolved keys injected
as env and keeps it alive across the interactive claim session.

Band allows only one live connection per agent identity, so there must never be
two agent sets connected at once. This supervisor enforces that invariant by
managing a single subprocess: a respawn always tears down the previous group
first. Re-running with the same keys reuses the live group instead of churning
connections.
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
import sys
from pathlib import Path

from agents.run_all import AGENT_READY_NAMES
from agents.shared import readiness

logger = logging.getLogger("arbiter.agent_runner")

ROOT = Path(__file__).resolve().parents[1]

# Agents open their Band WebSocket connections before the seed message is posted.
# Rather than sleep a fixed delay, the supervisor polls for the per-agent readiness
# markers each agent writes once connected, and returns the instant all are up.
# BOOT_SECONDS is now the *ceiling*: how long to wait before giving up and posting
# the kickoff anyway (the @mention is still delivered on connect, so a late agent
# is a smoothing miss, not a correctness failure).
BOOT_SECONDS = float(os.environ.get("AGENT_BOOT_SECONDS", "6"))
# How often to re-check the marker directory while waiting for agents to connect.
READY_POLL_SECONDS = float(os.environ.get("AGENT_READY_POLL_SECONDS", "0.25"))


class AgentSupervisor:
    """Owns the single agent process group and the keys it was started with."""

    def __init__(self) -> None:
        self._proc: subprocess.Popen[bytes] | None = None
        self._keys: tuple[str, str] | None = None
        self._lock = asyncio.Lock()

    def _alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    def is_running_with(
        self,
        aiml_key: str,
        featherless_key: str,
        aiml_model: str | None = None,
        featherless_model: str | None = None,
    ) -> bool:
        """True if a live agent group is already up with exactly this config.

        Lets the caller skip the (slow) provider-key validation on a warm reseed:
        if the group is alive with these keys, they were already validated and the
        keys proven good when it was first spawned."""
        return self._alive() and self._keys == (
            aiml_key,
            featherless_key,
            aiml_model,
            featherless_model,
        )

    async def ensure_running(
        self,
        aiml_key: str,
        featherless_key: str,
        aiml_model: str | None = None,
        featherless_model: str | None = None,
    ) -> None:
        """Guarantee an agent group is live with exactly this provider config."""
        async with self._lock:
            keys = (aiml_key, featherless_key, aiml_model, featherless_model)
            if self._alive() and self._keys == keys:
                logger.info("Agent group already running with the requested config")
                return

            await self._stop_locked()

            env = os.environ.copy()
            # The resolved value already encodes precedence (visitor key wins, server
            # .env is fallback — see gateway.main.resolve_keys). Force it into the child
            # env: the agent subprocess calls load_dotenv(override=False), which would
            # otherwise let an on-disk .env value shadow the visitor's key. Forcing the
            # already-resolved key makes the visitor's choice win in the subprocess too.
            env["AIML_API_KEY"] = aiml_key
            env["FEATHERLESS_API_KEY"] = featherless_key
            if aiml_model:
                env["AIML_MODEL"] = aiml_model
            if featherless_model:
                env["FEATHERLESS_MODEL"] = featherless_model

            # Clear any markers from a prior group so we can't read stale liveness.
            readiness.reset(AGENT_READY_NAMES)

            logger.info("Spawning agent process group")
            self._proc = subprocess.Popen(  # noqa: S603 — fixed argv, no shell
                [sys.executable, "-m", "agents.run_all"],
                cwd=str(ROOT),
                env=env,
            )
            self._keys = keys

            await self._await_ready()
            logger.info("Agent group online (pid=%s)", self._proc.pid)

    async def _await_ready(self) -> None:
        """Poll for agent readiness markers, returning as soon as all are up.

        Waits at most BOOT_SECONDS. If the process group dies during boot we fail
        loudly; if some agents simply connect slowly we proceed once the ceiling is
        hit (the kickoff @mention is still delivered to them on connect)."""
        waited = 0.0
        while waited < BOOT_SECONDS:
            if not self._alive():
                self._keys = None
                raise RuntimeError(
                    "Agent process group exited during startup — check provider keys and logs."
                )
            ready = readiness.ready_names(AGENT_READY_NAMES)
            if len(ready) >= len(AGENT_READY_NAMES):
                logger.info("All %d agents connected", len(AGENT_READY_NAMES))
                return
            await asyncio.sleep(READY_POLL_SECONDS)
            waited += READY_POLL_SECONDS

        # Ceiling hit: proceed with whatever connected, but make the shortfall visible.
        if not self._alive():
            self._keys = None
            raise RuntimeError(
                "Agent process group exited during startup — check provider keys and logs."
            )
        ready = readiness.ready_names(AGENT_READY_NAMES)
        logger.warning(
            "Proceeding after %.1fs with %d/%d agents connected: %s",
            BOOT_SECONDS,
            len(ready),
            len(AGENT_READY_NAMES),
            sorted(set(AGENT_READY_NAMES) - ready) or "all up",
        )

    async def _stop_locked(self) -> None:
        if self._proc is None:
            return
        if self._proc.poll() is None:
            logger.info("Stopping agent process group (pid=%s)", self._proc.pid)
            self._proc.terminate()
            try:
                await asyncio.to_thread(self._proc.wait, 10)
            except subprocess.TimeoutExpired:
                logger.warning("Agent group did not exit; killing")
                self._proc.kill()
                await asyncio.to_thread(self._proc.wait)
        self._proc = None
        self._keys = None

    async def stop(self) -> None:
        async with self._lock:
            await self._stop_locked()


supervisor = AgentSupervisor()
