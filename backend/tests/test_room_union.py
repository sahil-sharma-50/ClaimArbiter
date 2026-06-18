"""Test the gateway's per-agent context-view union.

Band's /context is mention-scoped, so no single agent key sees every structured
event. _union_room_messages merges all agent views and dedupes by id; this guards
that the union surfaces intake/coverage/evidence_analysis (authored by agents the
Coordinator was never mentioned by) and orders the result chronologically.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import asyncio  # noqa: E402

from gateway import main as gw  # noqa: E402

# Each agent key returns only the events it authored (mention-scoped reality).
VIEWS = {
    "intake_coverage": [
        {"id": "m1", "inserted_at": "t1", "metadata": {"stage": "intake"}},
        {"id": "m2", "inserted_at": "t2", "metadata": {"stage": "coverage"}},
    ],
    "evidence_analyst": [
        {"id": "m3", "inserted_at": "t3", "metadata": {"stage": "evidence_analysis"}},
        # m2 also visible to evidence (it was mentioned) — must dedupe, not double.
        {"id": "m2", "inserted_at": "t2", "metadata": {"stage": "coverage"}},
    ],
    "case_coordinator": [
        {"id": "m4", "inserted_at": "t4", "metadata": {"stage": "recruiting"}},
    ],
    "fraud_agent": [
        {"id": "m5", "inserted_at": "t5", "metadata": {"stage": "specialist_verdict"}},
    ],
    "property_agent": [],
    "medical_agent": [],
}


class FakeClient:
    def __init__(self, key):
        self._key = key

    async def get_context(self, chat_id):
        return VIEWS.get(self._key, [])


class TestRoomUnion(unittest.TestCase):
    def setUp(self):
        # The sticky per-chat store is module-global; isolate each test.
        gw._room_messages.clear()

    def test_union_surfaces_all_stages_deduped_and_ordered(self):
        with mock.patch.object(gw, "get_agent_credentials", lambda a: (a, a)), \
             mock.patch.object(gw, "BandClient", FakeClient):
            msgs = asyncio.run(gw._union_room_messages("chat-x"))

        ids = [m["id"] for m in msgs]
        self.assertEqual(ids, ["m1", "m2", "m3", "m4", "m5"])  # chronological, deduped
        stages = {m["metadata"]["stage"] for m in msgs}
        self.assertEqual(
            stages,
            {"intake", "coverage", "evidence_analysis", "recruiting", "specialist_verdict"},
        )

    def test_one_agent_failure_does_not_blank_room(self):
        class FlakyClient(FakeClient):
            async def get_context(self, chat_id):
                if self._key == "case_coordinator":
                    raise RuntimeError("403 for this key")
                return VIEWS.get(self._key, [])

        with mock.patch.object(gw, "get_agent_credentials", lambda a: (a, a)), \
             mock.patch.object(gw, "BandClient", FlakyClient):
            msgs = asyncio.run(gw._union_room_messages("chat-x"))

        ids = {m["id"] for m in msgs}
        # Coordinator view dropped (m4), but all other agents' events still present.
        self.assertEqual(ids, {"m1", "m2", "m3", "m5"})

    def test_sticky_retains_messages_after_key_404s(self):
        """Once seen, a dismissed agent's events persist even when its key later 404s.

        Models the dismiss flow: intake/evidence post events, then the Coordinator
        removes them and their keys return nothing. The dashboard must keep the
        earlier phases.
        """
        # Round 1: every key returns its events.
        with mock.patch.object(gw, "get_agent_credentials", lambda a: (a, a)), \
             mock.patch.object(gw, "BandClient", FakeClient):
            first = asyncio.run(gw._union_room_messages("chat-x"))
        self.assertEqual({m["id"] for m in first}, {"m1", "m2", "m3", "m4", "m5"})

        # Round 2: intake + evidence have been dismissed → their keys see nothing.
        class DismissedClient(FakeClient):
            async def get_context(self, chat_id):
                if self._key in ("intake_coverage", "evidence_analyst", "fraud_agent"):
                    return []  # removed from room → 404-equivalent empty view
                return VIEWS.get(self._key, [])

        with mock.patch.object(gw, "get_agent_credentials", lambda a: (a, a)), \
             mock.patch.object(gw, "BandClient", DismissedClient):
            second = asyncio.run(gw._union_room_messages("chat-x"))

        # intake (m1), coverage (m2), evidence (m3), specialist_verdict (m5) all retained.
        self.assertEqual({m["id"] for m in second}, {"m1", "m2", "m3", "m4", "m5"})


if __name__ == "__main__":
    unittest.main()
