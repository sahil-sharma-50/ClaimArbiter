"""Regression tests: PydanticAI custom tools must be registrable by Band's adapter.

Band's PydanticAIAdapter registers every ``additional_tools`` entry via
``agent.tool(fn)`` (the context-taking variant), which requires the function's
first parameter to be ``ctx: RunContext[...]``. A tool that omits it raises
``pydantic_ai.exceptions.UserError`` at agent-startup — crashing the agent
process before it ever connects to Band. The Evidence Analyst regressed exactly
this way and silently stalled every claim at Coverage, so these tests assert the
tool registers the same way the live adapter would.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pydantic_ai import Agent  # noqa: E402
from pydantic_ai.models.test import TestModel  # noqa: E402

from agents.insurer.evidence_analyst import run_evidence_analysis  # noqa: E402


class TestPydanticAIToolRegistration(unittest.TestCase):
    def test_evidence_analysis_tool_registers(self):
        """run_evidence_analysis must register via agent.tool() (as the adapter does)."""
        # This is the exact call PydanticAIAdapter._create_agent makes for each
        # additional_tools entry. It raises UserError if the first parameter is
        # not annotated RunContext[...] — the production crash we are guarding.
        agent = Agent(TestModel())
        agent.tool(run_evidence_analysis)  # must not raise


if __name__ == "__main__":
    unittest.main()
