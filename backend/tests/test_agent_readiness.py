"""Readiness-based agent boot: the supervisor polls for markers, not a fixed sleep.

The old behaviour was a blind ``asyncio.sleep(BOOT_SECONDS)`` after spawning the
agent process group — a fixed ~6s tax on every cold demo start regardless of how
fast the agents actually connected. These cover the replacement: each agent drops
a readiness marker when its WebSocket connects, and ``ensure_running`` returns as
soon as all expected markers appear, using BOOT_SECONDS only as a timeout ceiling.
"""

import os
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared import readiness  # noqa: E402
from gateway import agent_runner  # noqa: E402


@contextmanager
def env(**values):
    keys = list(values)
    saved = {k: os.environ.get(k) for k in keys}
    for k, v in values.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    try:
        yield
    finally:
        for k in keys:
            if saved[k] is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = saved[k]


@contextmanager
def temp_ready_dir():
    with tempfile.TemporaryDirectory() as d:
        original = readiness.READY_DIR
        readiness.READY_DIR = Path(d)
        try:
            yield Path(d)
        finally:
            readiness.READY_DIR = original


class TestReadinessMarkers(unittest.TestCase):
    def test_mark_and_query_roundtrip(self):
        with temp_ready_dir():
            self.assertEqual(readiness.ready_names(["a", "b"]), set())
            readiness.mark_ready("a")
            self.assertEqual(readiness.ready_names(["a", "b"]), {"a"})

    def test_reset_clears_stale_markers(self):
        with temp_ready_dir():
            readiness.mark_ready("a")
            readiness.mark_ready("b")
            readiness.reset(["a", "b"])
            self.assertEqual(readiness.ready_names(["a", "b"]), set())


class TestSupervisorReadinessPoll(unittest.IsolatedAsyncioTestCase):
    async def test_returns_as_soon_as_all_markers_present(self):
        """ensure_running should poll for markers and return early, not sleep BOOT_SECONDS."""
        names = ("agent_one", "agent_two")
        sleeps: list[float] = []

        class FakePopen:
            def __init__(self, argv, cwd=None, env=None):
                self.pid = 1234
                # Agents come online "immediately" — both markers exist before the
                # first poll, so the supervisor should not wait the full ceiling.
                for n in names:
                    readiness.mark_ready(n)

            def poll(self):
                return None  # alive

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        sup = agent_runner.AgentSupervisor()
        with temp_ready_dir(), env(
            AIML_API_KEY="k", FEATHERLESS_API_KEY="k",
        ):
            with mock.patch.object(agent_runner, "AGENT_READY_NAMES", names), \
                 mock.patch.object(agent_runner.subprocess, "Popen", FakePopen), \
                 mock.patch.object(agent_runner.asyncio, "sleep", new=fake_sleep):
                await sup.ensure_running("k", "k", "m", "m")

        # All markers present on the first check → at most the poll interval slept,
        # never the full BOOT_SECONDS ceiling.
        self.assertTrue(all(s <= agent_runner.READY_POLL_SECONDS for s in sleeps))
        self.assertLess(sum(sleeps), agent_runner.BOOT_SECONDS)

    async def test_raises_if_process_dies_during_boot(self):
        class DeadPopen:
            def __init__(self, argv, cwd=None, env=None):
                self.pid = 1234

            def poll(self):
                return 1  # exited

        sup = agent_runner.AgentSupervisor()
        with temp_ready_dir(), env(AIML_API_KEY="k", FEATHERLESS_API_KEY="k"):
            with mock.patch.object(agent_runner, "AGENT_READY_NAMES", ("a",)), \
                 mock.patch.object(agent_runner.subprocess, "Popen", DeadPopen), \
                 mock.patch.object(agent_runner.asyncio, "sleep", new=mock.AsyncMock()):
                with self.assertRaises(RuntimeError):
                    await sup.ensure_running("k", "k", "m", "m")


class TestWarmReseedSkipsValidation(unittest.IsolatedAsyncioTestCase):
    """The slow provider-key validation must be skipped when the agent group is
    already live with the same keys — that's the dominant cost of a repeat seed."""

    async def test_is_running_with_matches_only_on_alive_and_same_keys(self):
        class AlivePopen:
            pid = 1
            def poll(self):
                return None

        sup = agent_runner.AgentSupervisor()
        # Not running yet → must validate.
        self.assertFalse(sup.is_running_with("a", "f", "m", "fm"))

        sup._proc = AlivePopen()
        sup._keys = ("a", "f", "m", "fm")
        self.assertTrue(sup.is_running_with("a", "f", "m", "fm"))
        # Different key → not a match (must re-validate + respawn).
        self.assertFalse(sup.is_running_with("a2", "f", "m", "fm"))

    async def test_start_run_skips_validation_when_warm(self):
        from gateway import main as g

        validated: list[str] = []

        async def fake_validate(provider, key):
            validated.append(provider)

        with env(AIML_API_KEY="a", FEATHERLESS_API_KEY="f"):
            with mock.patch.object(g.supervisor, "is_running_with", return_value=True), \
                 mock.patch.object(g.supervisor, "ensure_running", new=mock.AsyncMock()), \
                 mock.patch.object(g, "_validate_provider_key", new=fake_validate):
                await g._start_run(None, None)

        self.assertEqual(validated, [])  # warm → no provider pings

    async def test_start_run_validates_when_cold(self):
        from gateway import main as g

        validated: list[str] = []

        async def fake_validate(provider, key):
            validated.append(provider)

        with env(AIML_API_KEY="a", FEATHERLESS_API_KEY="f"):
            with mock.patch.object(g.supervisor, "is_running_with", return_value=False), \
                 mock.patch.object(g.supervisor, "ensure_running", new=mock.AsyncMock()), \
                 mock.patch.object(g, "_validate_provider_key", new=fake_validate):
                await g._start_run(None, None)

        self.assertEqual(sorted(validated), ["aiml", "featherless"])


if __name__ == "__main__":
    unittest.main()
