"""Tests for CoordinatorRoom — the single seam every Case Coordinator tool crosses.

These exercise the room directly: a fake BandClient in, behaviour out. No LangGraph,
no module-global patching, no @tool .coroutine() indirection — the room's interface
IS the test surface. That is the point of the seam: the I/O preamble the six async
tools used to copy-paste now lives behind one adapter that a test can build by hand.

The companion tool tests (test_recruit, test_dismiss, test_read_evidence_signals,
test_escalate_to_human) still drive the @tool shims through patched globals, proving
the shims wire the room up the way production does.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer.case_coordinator import CoordinatorRoom, EvidenceSignals  # noqa: E402


def _evidence_event(result):
    return {
        "message_type": "task",
        "sender_name": "Evidence Analyst",
        "content": "Evidence analysis complete.",
        "metadata": {"stage": "evidence_analysis", "result": result},
    }


class FakeClient:
    """In-memory BandClient: records writes, replays a fixed context."""

    def __init__(self, *, context=None):
        self._context = context or []
        self.events: list[dict] = []
        self.messages: list[tuple] = []
        self.removed: list[str] = []

    async def get_context(self, chat_id):
        return self._context

    async def list_participants(self, chat_id):
        return [{"id": "h1", "name": "Sahil", "type": "User"}]

    async def remove_participant(self, chat_id, participant_id):
        self.removed.append(participant_id)
        return {"id": participant_id}

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        self.events.append({"chat_id": chat_id, "content": content,
                            "message_type": message_type, "metadata": metadata})
        return {"id": "evt"}

    async def send_message(self, chat_id, content, mentions=None):
        self.messages.append((chat_id, content, mentions))
        return {"id": "msg"}


def _run(coro):
    return asyncio.run(coro)


class TestCoordinatorRoom(unittest.TestCase):
    def test_post_event_scopes_to_the_rooms_chat_id(self):
        fake = FakeClient()
        room = CoordinatorRoom(chat_id="chat-42", client=fake)
        _run(room.post_event("hi", message_type="thought", metadata={"stage": "x"}))
        self.assertEqual(fake.events[0]["chat_id"], "chat-42")
        self.assertEqual(fake.events[0]["message_type"], "thought")

    def test_send_message_carries_mentions(self):
        fake = FakeClient()
        room = CoordinatorRoom(chat_id="chat-42", client=fake)
        _run(room.send_message("review please", mentions=[{"id": "h1"}]))
        self.assertEqual(fake.messages[0], ("chat-42", "review please", [{"id": "h1"}]))

    def test_remove_participant_uses_room_chat_id(self):
        fake = FakeClient()
        room = CoordinatorRoom(chat_id="chat-42", client=fake)
        _run(room.remove_participant("p9"))
        self.assertEqual(fake.removed, ["p9"])

    def test_evidence_report_reads_through_the_injected_analyst_client(self):
        # The Analyst-key read is a separate injectable client. Here we hand the room
        # an evidence_client whose context carries two evidence events; the latest wins
        # and the typed seam parses it — no second-key juggling leaks to the caller.
        analyst = FakeClient(context=[
            _evidence_event({"signals": ["severity_gap"], "suggested_domain": "auto"}),
            _evidence_event({"signals": ["water_source_ambiguous"], "suggested_domain": "property"}),
        ])
        room = CoordinatorRoom(chat_id="chat-42", client=FakeClient(), evidence_client=analyst)
        report = _run(room.evidence_report())
        self.assertTrue(report.found)
        self.assertEqual(report.signals, ["water_source_ambiguous"])
        self.assertEqual(report.suggested_domain, "property")

    def test_evidence_report_is_not_found_when_no_evidence_event(self):
        analyst = FakeClient(context=[
            {"message_type": "task", "sender_name": "Intake",
             "metadata": {"stage": "intake", "result": {"claim_id": "C"}}}
        ])
        room = CoordinatorRoom(chat_id="chat-42", client=FakeClient(), evidence_client=analyst)
        report = _run(room.evidence_report())
        self.assertFalse(report.found)
        self.assertEqual(report.note, "no evidence yet")

    def test_evidence_report_degrades_on_fetch_error(self):
        class Boom(FakeClient):
            async def get_context(self, chat_id):
                raise RuntimeError("band down")

        room = CoordinatorRoom(chat_id="chat-42", client=FakeClient(), evidence_client=Boom())
        report = _run(room.evidence_report())
        self.assertFalse(report.found)
        self.assertIn("fetch error", report.note)

    def test_evidence_signals_not_found_when_no_signals(self):
        self.assertFalse(EvidenceSignals(note="no evidence yet").found)
        self.assertIsNone(EvidenceSignals(note="no evidence yet").signals)


if __name__ == "__main__":
    unittest.main()
