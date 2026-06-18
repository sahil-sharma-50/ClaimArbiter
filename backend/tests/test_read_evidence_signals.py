"""Tests for case_coordinator.read_evidence_signals — the deterministic score input.

This path feeds the Case Coordinator's score (signals + suggested_domain read from
the Evidence Analyst's event) and was previously untested. It now reads through the
typed casefile schema seam; these tests pin the behavior the old hand-rolled
json.loads/isinstance/.get ladder provided, so the rewire is provably behavior-preserving.
"""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import case_coordinator as cc  # noqa: E402


def _evidence_event(result):
    """A Band evidence_analysis event whose metadata.result is `result`."""
    return {
        "message_type": "task",
        "sender_name": "Evidence Analyst",
        "content": "Evidence analysis complete.",
        "metadata": {"stage": "evidence_analysis", "result": result},
    }


class _ClientWithMessages:
    """BandClient stand-in returning a fixed transcript from get_context."""

    def __init__(self, messages):
        self._messages = messages

    def __call__(self, _key):  # BandClient(evidence_key)
        return self

    async def get_context(self, _chat_id):
        return self._messages


def _run_read(messages):
    client = _ClientWithMessages(messages)
    with mock.patch.object(cc, "BandClient", client), \
         mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "ev-key")), \
         mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"), \
         mock.patch.object(cc, "load_env", lambda: None):
        # read_evidence_signals is a langchain @tool; call its underlying coroutine.
        return asyncio.run(cc.read_evidence_signals.coroutine())


class TestReadEvidenceSignals(unittest.TestCase):
    def test_reads_signals_and_domain_from_typed_payload(self):
        out = json.loads(_run_read([_evidence_event(
            {"signals": ["severity_gap", "evidence_discrepancy"],
             "suggested_domain": "property", "degraded": False}
        )]))
        self.assertEqual(out["signals"], ["severity_gap", "evidence_discrepancy"])
        self.assertEqual(out["suggested_domain"], "property")
        self.assertIs(out["degraded"], False)

    def test_result_as_json_string_is_parsed(self):
        # Band can serialize the nested result as a JSON string; the seam coerces it,
        # preserving what the old isinstance(result, str) branch did by hand.
        payload = json.dumps({"signals": ["severity_gap"], "suggested_domain": "auto"})
        out = json.loads(_run_read([_evidence_event(payload)]))
        self.assertEqual(out["signals"], ["severity_gap"])
        self.assertEqual(out["suggested_domain"], "auto")

    def test_no_evidence_event_returns_empty(self):
        out = json.loads(_run_read([
            {"message_type": "task", "sender_name": "Intake",
             "content": "x", "metadata": {"stage": "intake", "result": {"claim_id": "C"}}}
        ]))
        self.assertEqual(out["signals"], [])
        self.assertIsNone(out["suggested_domain"])
        self.assertEqual(out["note"], "no evidence yet")

    def test_empty_signals_when_clean(self):
        out = json.loads(_run_read([_evidence_event(
            {"signals": [], "suggested_domain": "auto", "degraded": False}
        )]))
        self.assertEqual(out["signals"], [])
        self.assertEqual(out["suggested_domain"], "auto")

    def test_latest_evidence_event_wins(self):
        # Two evidence events present → the most recent one's signals are used.
        out = json.loads(_run_read([
            _evidence_event({"signals": ["severity_gap"], "suggested_domain": "auto"}),
            _evidence_event({"signals": ["water_source_ambiguous"], "suggested_domain": "property"}),
        ]))
        self.assertEqual(out["signals"], ["water_source_ambiguous"])
        self.assertEqual(out["suggested_domain"], "property")

    def test_no_active_room_returns_empty(self):
        with mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "ev-key")), \
             mock.patch.object(cc, "read_active_chat_id", lambda: None), \
             mock.patch.object(cc, "load_env", lambda: None):
            out = json.loads(asyncio.run(cc.read_evidence_signals.coroutine()))
        self.assertEqual(out["signals"], [])
        self.assertEqual(out["note"], "no active room")


if __name__ == "__main__":
    unittest.main()
