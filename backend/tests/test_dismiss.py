"""Tests for dismiss_finished_agents — the Band-native room cleanup at escalation.

The Case Coordinator (room owner) removes single-shot agents (Intake, Evidence,
the recruited specialist) once it escalates, so Band's @mention flow can no longer
re-trigger them into a chatter loop. The Human Reviewer and the Coordinator must
never be removed.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import case_coordinator as cc  # noqa: E402

ROOM_PARTICIPANTS = [
    {"id": "i1", "name": "Intake Coverage", "type": "Agent"},
    {"id": "e1", "name": "Evidence Analyst", "type": "Agent"},
    {"id": "c1", "name": "Case Coordinator", "type": "Agent"},
    {"id": "f1", "name": "Legal Review", "type": "Agent"},
    {"id": "h1", "name": "Sahil Sharma", "type": "User"},
]


class FakeClient:
    def __init__(self, key):
        self.removed = []

    async def list_participants(self, chat_id):
        return list(ROOM_PARTICIPANTS)

    async def remove_participant(self, chat_id, participant_id):
        self.removed.append(participant_id)
        return {"id": participant_id}


class TestDismissFinishedAgents(unittest.TestCase):
    def _run(self):
        created = {}

        def _factory(key):
            created["client"] = FakeClient(key)
            return created["client"]

        with mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "key")), \
             mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"), \
             mock.patch.object(cc, "BandClient", _factory):
            result = asyncio.run(cc.dismiss_finished_agents.coroutine())
        return created["client"], result

    def test_removes_single_shot_agents_only(self):
        client, result = self._run()
        # Intake, Evidence, the recruited specialist removed; Coordinator + human kept.
        self.assertEqual(set(client.removed), {"i1", "e1", "f1"})
        self.assertNotIn("c1", client.removed)  # coordinator stays
        self.assertNotIn("h1", client.removed)  # human stays
        self.assertIn("Dismissed", result)

    def test_never_removes_human_user(self):
        client, _ = self._run()
        self.assertNotIn("h1", client.removed)


if __name__ == "__main__":
    unittest.main()
