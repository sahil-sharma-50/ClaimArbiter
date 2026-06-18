"""Regression test for recruit()'s handling of an already-connected specialist.

Once any prior claim has crossed the org boundary, Band's /contacts/add returns
409 Conflict for that specialist. The live trap reached recruiting and then failed
with "issue recruiting ... due to a conflict" — recruit() treated the 409 as fatal
and escalated without the specialist. A 409 means consent already exists, so recruit
must proceed to add the specialist to the room.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import case_coordinator as cc  # noqa: E402

FRAUD = {"id": "29e7b765", "name": "Fraud Agent", "handle": "sahilatfau/fraud-agent"}


def _http_409():
    req = httpx.Request("POST", "https://app.band.ai/api/v1/agent/contacts/add")
    resp = httpx.Response(409, request=req)
    return httpx.HTTPStatusError("409", request=req, response=resp)


class FakeClient:
    """BandClient stand-in: add_contact 409s (already a contact); rest succeeds."""

    def __init__(self, key):
        self.added_participants = []

    async def list_participants(self, chat_id):
        return []  # specialist not yet in the room

    async def add_contact(self, handle, message=None):
        raise _http_409()

    async def list_contact_requests(self, sent_status="pending"):
        return {"sent": [{"to_handle": "@sahilatfau/fraud-agent"}]}

    async def list_peers(self, not_in_chat=None):
        return [FRAUD]

    async def add_participant(self, chat_id, participant_id, role="member"):
        self.added_participants.append(participant_id)
        return {"id": participant_id}

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        return {"id": "evt", "metadata": metadata}


class TestRecruit409(unittest.TestCase):
    def test_recruit_proceeds_when_already_contact(self):
        created = {}

        def _factory(key):
            created["client"] = FakeClient(key)
            return created["client"]

        with mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "key")), \
             mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"), \
             mock.patch.object(cc, "BandClient", _factory):
            result = asyncio.run(cc.recruit.coroutine("@sahilatfau/fraud-agent"))

        # The specialist was added to the room despite the 409 (not escalated away).
        self.assertEqual(created["client"].added_participants, ["29e7b765"])
        self.assertIn("Recruited", result)


if __name__ == "__main__":
    unittest.main()
