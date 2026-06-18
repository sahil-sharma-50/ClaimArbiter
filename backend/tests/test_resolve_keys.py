"""Provider key/model precedence: the visitor's own key wins, server .env is fallback.

These cover the inversion of the original "server-wins" rule. A visitor who pastes
their own AIML / Featherless key in Settings runs on THAT key (and their own model),
so the host is not billed for their run. The server .env key only fills a slot the
visitor left blank. Per-provider: a visitor can bring just one key and fall back to
the server for the other.
"""

import os
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import HTTPException  # noqa: E402

from gateway import agent_runner  # noqa: E402
from gateway.main import (  # noqa: E402
    DEFAULT_AIML_MODEL,
    DEFAULT_FEATHERLESS_MODEL,
    resolve_keys,
    resolve_model,
)


@contextmanager
def env(**values):
    """Temporarily set/clear env vars, restoring the prior state on exit."""
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


class TestResolveKeys(unittest.TestCase):
    def test_visitor_key_wins_over_server(self):
        with env(AIML_API_KEY="server-aiml", FEATHERLESS_API_KEY="server-feath"):
            aiml, feath = resolve_keys("visitor-aiml", "visitor-feath")
        self.assertEqual(aiml, "visitor-aiml")
        self.assertEqual(feath, "visitor-feath")

    def test_server_key_is_fallback_when_visitor_absent(self):
        with env(AIML_API_KEY="server-aiml", FEATHERLESS_API_KEY="server-feath"):
            aiml, feath = resolve_keys(None, "")
        self.assertEqual(aiml, "server-aiml")
        self.assertEqual(feath, "server-feath")

    def test_per_provider_mix(self):
        # Visitor brings only AIML; Featherless falls back to the server key.
        with env(AIML_API_KEY="server-aiml", FEATHERLESS_API_KEY="server-feath"):
            aiml, feath = resolve_keys("visitor-aiml", None)
        self.assertEqual(aiml, "visitor-aiml")
        self.assertEqual(feath, "server-feath")

    def test_visitor_key_used_when_no_server_key(self):
        with env(AIML_API_KEY=None, FEATHERLESS_API_KEY=None):
            aiml, feath = resolve_keys("visitor-aiml", "visitor-feath")
        self.assertEqual(aiml, "visitor-aiml")
        self.assertEqual(feath, "visitor-feath")

    def test_whitespace_only_visitor_key_falls_back(self):
        with env(AIML_API_KEY="server-aiml", FEATHERLESS_API_KEY="server-feath"):
            aiml, feath = resolve_keys("   ", "  ")
        self.assertEqual(aiml, "server-aiml")
        self.assertEqual(feath, "server-feath")

    def test_no_aiml_anywhere_raises_400(self):
        with env(AIML_API_KEY=None, FEATHERLESS_API_KEY="server-feath"):
            with self.assertRaises(HTTPException) as ctx:
                resolve_keys(None, None)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("AI/ML", ctx.exception.detail)

    def test_no_featherless_anywhere_raises_400(self):
        with env(AIML_API_KEY="server-aiml", FEATHERLESS_API_KEY=None):
            with self.assertRaises(HTTPException) as ctx:
                resolve_keys("visitor-aiml", None)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Featherless", ctx.exception.detail)


class TestResolveModel(unittest.TestCase):
    def test_visitor_model_wins_over_server(self):
        with env(AIML_MODEL="server-model", FEATHERLESS_MODEL="server-fmodel"):
            aiml, feath = resolve_model("visitor-model", "visitor-fmodel")
        self.assertEqual(aiml, "visitor-model")
        self.assertEqual(feath, "visitor-fmodel")

    def test_server_model_is_fallback_when_visitor_absent(self):
        with env(AIML_MODEL="server-model", FEATHERLESS_MODEL="server-fmodel"):
            aiml, feath = resolve_model(None, "")
        self.assertEqual(aiml, "server-model")
        self.assertEqual(feath, "server-fmodel")

    def test_hardcoded_default_when_neither_present(self):
        with env(AIML_MODEL=None, FEATHERLESS_MODEL=None):
            aiml, feath = resolve_model(None, None)
        self.assertEqual(aiml, DEFAULT_AIML_MODEL)
        self.assertEqual(feath, DEFAULT_FEATHERLESS_MODEL)

    def test_visitor_model_used_over_default_when_no_server_model(self):
        with env(AIML_MODEL=None, FEATHERLESS_MODEL=None):
            aiml, feath = resolve_model("visitor-model", "visitor-fmodel")
        self.assertEqual(aiml, "visitor-model")
        self.assertEqual(feath, "visitor-fmodel")


class TestAgentRunnerEnvInjection(unittest.IsolatedAsyncioTestCase):
    """The resolved key must reach the agent subprocess even when the on-disk .env
    already set a value. The subprocess calls load_dotenv(override=False), so the
    gateway must FORCE the resolved key into the child env (not setdefault) for the
    visitor's key to win there too."""

    async def test_resolved_key_overrides_existing_env_value(self):
        captured = {}

        class FakePopen:
            def __init__(self, argv, cwd=None, env=None):
                captured.update(env or {})
                self.pid = 4242

            def poll(self):
                return None  # alive

        sup = agent_runner.AgentSupervisor()
        with env(AIML_API_KEY="server-aiml", FEATHERLESS_API_KEY="server-feath",
                 AIML_MODEL="server-model", FEATHERLESS_MODEL="server-fmodel"):
            with mock.patch.object(agent_runner.subprocess, "Popen", FakePopen), \
                 mock.patch.object(agent_runner.asyncio, "sleep", new=mock.AsyncMock()):
                await sup.ensure_running(
                    "visitor-aiml", "visitor-feath", "visitor-model", "visitor-fmodel"
                )

        self.assertEqual(captured["AIML_API_KEY"], "visitor-aiml")
        self.assertEqual(captured["FEATHERLESS_API_KEY"], "visitor-feath")
        self.assertEqual(captured["AIML_MODEL"], "visitor-model")
        self.assertEqual(captured["FEATHERLESS_MODEL"], "visitor-fmodel")


if __name__ == "__main__":
    unittest.main()
