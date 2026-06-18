"""Tests for the shared insurer agent bootstrap (agents.insurer.bootstrap).

run_agent(AgentSpec) is the insurer-side mirror of run_specialist: the Band boot
sequence (config → creds → urls → adapter → Agent.create → run) lives here once. These
tests exercise that sequence with Band stubbed out — no live connection — asserting the
spec's adapter factory and optional env step are invoked, and the agent is created with
the standard SessionConfig and run exactly once.

They also pin the wiring of the three real specs (intake / evidence / coordinator) so a
future edit can't silently drop a credential name or the pre-adapter env step.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import bootstrap  # noqa: E402
from agents.insurer.bootstrap import AgentSpec, run_agent  # noqa: E402


@dataclass
class _FakeAgent:
    """Duck-typed Band Agent: run_agent now drives the lifecycle via serve()
    (start → publish readiness marker → run_forever → stop), not a single run()."""

    created_kwargs: dict
    started: bool = False
    ran: bool = False
    stopped: bool = False

    async def start(self):
        self.started = True

    async def run_forever(self):
        # `ran` keeps its original meaning: the agent reached its serve loop.
        self.ran = True

    async def stop(self, timeout=None):
        self.stopped = True


class TestRunAgent(unittest.TestCase):
    def _run(self, spec):
        """Run run_agent(spec) with all Band/config touchpoints stubbed.

        Returns (calls, created_kwargs, agent) for assertions.
        """
        calls: list[str] = []
        created: dict = {}
        made: dict = {}

        class _Cfg:
            aiml_model = "gpt-4o"

        def fake_create(**kwargs):
            calls.append("create")
            created.update(kwargs)
            agent = _FakeAgent(created_kwargs=kwargs)
            made["agent"] = agent
            return agent

        class _Urls:
            ws_url = "wss://band/ws"
            rest_url = "https://band/rest"

        with mock.patch.object(bootstrap, "load_env", lambda: calls.append("load_env")), \
             mock.patch.object(bootstrap, "get_provider_config", lambda: (calls.append("cfg"), _Cfg())[1]), \
             mock.patch.object(bootstrap, "get_agent_credentials",
                               lambda name: (calls.append(f"creds:{name}"), ("agent-id", "api-key"))[1]), \
             mock.patch.object(bootstrap, "get_band_urls", lambda: _Urls()), \
             mock.patch.object(bootstrap.Agent, "create", staticmethod(fake_create)):
            asyncio.run(run_agent(spec))
        return calls, created, made["agent"]

    def test_boot_sequence_invokes_factory_and_runs(self):
        built_with: list = []
        spec = AgentSpec(
            credential_name="evidence_analyst",
            build_adapter=lambda cfg: built_with.append(cfg) or "ADAPTER",
            logger=mock.MagicMock(),
            log_line="running",
        )
        calls, created, agent = self._run(spec)

        # Adapter factory was called with the resolved config, and its result was
        # handed verbatim to Agent.create.
        self.assertEqual(len(built_with), 1)
        self.assertEqual(created["adapter"], "ADAPTER")
        # Standard wiring: the resolved creds + urls reach Agent.create.
        self.assertEqual(created["agent_id"], "agent-id")
        self.assertEqual(created["api_key"], "api-key")
        self.assertEqual(created["ws_url"], "wss://band/ws")
        self.assertEqual(created["rest_url"], "https://band/rest")
        # Standard session config (max_message_retries=2) — the policy that used to be
        # copy-pasted into all three agents.
        self.assertEqual(created["session_config"].max_message_retries, 2)
        # Creds looked up by the spec's credential name; the agent ran once.
        self.assertIn("creds:evidence_analyst", calls)
        self.assertTrue(agent.ran)
        spec.logger.info.assert_called_once_with("running")

    def test_configure_env_runs_before_adapter_when_present(self):
        order: list[str] = []
        spec = AgentSpec(
            credential_name="intake_coverage",
            build_adapter=lambda cfg: order.append("adapter") or "A",
            configure_env=lambda cfg: order.append("configure_env"),
            logger=mock.MagicMock(),
            log_line="x",
        )
        self._run(spec)
        # The pre-adapter env hook fires, and before the adapter is built.
        self.assertEqual(order, ["configure_env", "adapter"])

    def test_no_configure_env_is_fine(self):
        spec = AgentSpec(
            credential_name="case_coordinator",
            build_adapter=lambda cfg: "A",
            logger=mock.MagicMock(),
            log_line="x",
        )
        calls, created, agent = self._run(spec)  # must not raise
        self.assertTrue(agent.ran)


class TestRealSpecsWiring(unittest.TestCase):
    """Pin the three real insurer specs so their identity can't silently drift."""

    def test_intake_spec(self):
        from agents.insurer.intake_coverage import SPEC
        self.assertEqual(SPEC.credential_name, "intake_coverage")
        self.assertIsNotNone(SPEC.configure_env)  # PydanticAI needs OpenAI env set

    def test_evidence_spec(self):
        from agents.insurer.evidence_analyst import SPEC
        self.assertEqual(SPEC.credential_name, "evidence_analyst")
        self.assertIsNotNone(SPEC.configure_env)

    def test_coordinator_spec(self):
        from agents.insurer.case_coordinator import SPEC
        self.assertEqual(SPEC.credential_name, "case_coordinator")
        # The Coordinator builds its LLM client directly; no pre-adapter env step.
        self.assertIsNone(SPEC.configure_env)


if __name__ == "__main__":
    unittest.main()
