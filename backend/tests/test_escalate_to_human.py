"""Tests for case_coordinator.escalate_to_human — deterministic human escalation."""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import case_coordinator as cc  # noqa: E402

HUMAN = {"id": "d19689a7", "name": "Sahil Sharma", "handle": "sahilatfau", "type": "User"}
COORDINATOR = {
    "id": "955efd0a",
    "name": "Case Coordinator",
    "handle": "sahilatfau/case-coordinator",
    "type": "Agent",
}


class FakeBandClient:
    def __init__(self):
        self.events = []
        self.messages = []

    async def list_participants(self, chat_id):
        return [COORDINATOR, HUMAN]

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        self.events.append((content, message_type, metadata))
        return {"id": "evt"}

    async def send_message(self, chat_id, content, mentions=None):
        self.messages.append((content, mentions))
        return {"id": "msg"}


def run(coro):
    return asyncio.run(coro)


class TestEscalateToHuman(unittest.TestCase):
    def _run_escalate(self, client, recommendation, rationale):
        patches = (
            mock.patch.object(cc, "load_env"),
            mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "key")),
            mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"),
            mock.patch.object(cc, "BandClient", lambda key: client),
        )
        for p in patches:
            p.start()
        try:
            return run(cc.escalate_to_human.coroutine(recommendation, rationale))
        finally:
            for p in patches:
                p.stop()

    def test_posts_escalation_event_and_mentions_human_by_id(self):
        client = FakeBandClient()
        out = self._run_escalate(client, "deny", "evidence_discrepancy and severity_gap")
        self.assertIn("Sahil Sharma", out)
        self.assertEqual(len(client.events), 1)
        self.assertEqual(client.events[0][2]["stage"], "escalation")
        self.assertEqual(client.events[0][2]["result"]["recommendation"], "deny")
        self.assertEqual(len(client.messages), 1)
        content, mentions = client.messages[0]
        self.assertNotIn("Human Reviewer", content)
        self.assertNotIn("@Sahil", content)
        self.assertEqual(mentions[0]["id"], "d19689a7")
        self.assertEqual(mentions[0]["name"], "Sahil Sharma")

    def test_rejects_invalid_recommendation(self):
        client = FakeBandClient()
        out = self._run_escalate(client, "maybe", "x")
        self.assertIn("ERROR", out)
        self.assertEqual(len(client.events), 0)


if __name__ == "__main__":
    unittest.main()
