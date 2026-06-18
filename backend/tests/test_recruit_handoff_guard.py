"""Regression tests for the recruited-but-silent specialist bug.

Live trap (claim CLM-2026-0042): the Case Coordinator recruited the Property Agent,
then escalated with a self-authored DENY ("no suitable expert was available") and
dismissed the specialist — all in the same turn — without ever @mentioning the
specialist. The specialist therefore never got a turn and posted no
specialist_verdict, yet Discover showed it joined. Two deterministic guardrails fix
the two failure points:

  1. recruit() itself @mentions the specialist to request the investigation, so the
     handoff can't be skipped by the LLM (mirrors the deterministic recruit handshake).
  2. escalate_to_human() refuses when a specialist was recruited but no
     specialist_verdict exists yet — the Coordinator must wait for the verdict.
"""

from __future__ import annotations

import asyncio
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import case_coordinator as cc  # noqa: E402
from agents.shared.casefile_schema import build_stage_metadata  # noqa: E402

SPECIALIST = {
    "id": "prop-1",
    "name": "Property Agent",
    "handle": "sahilatfau/property-agent",
    "type": "Agent",
}
HUMAN = {"id": "human-1", "name": "Sahil Sharma", "handle": "sahilatfau", "type": "User"}
COORDINATOR = {
    "id": "coord-1",
    "name": "Case Coordinator",
    "handle": "sahilatfau/case-coordinator",
    "type": "Agent",
}


def run(coro):
    return asyncio.run(coro)


class FakeRecruitClient:
    """BandClient stand-in for recruit(): clean approve path, records messages."""

    def __init__(self, key):
        self.added_participants = []
        self.messages = []
        self.events = []

    async def list_peers(self, not_in_chat=None):
        return [SPECIALIST]

    async def list_participants(self, chat_id):
        return [COORDINATOR, HUMAN]  # specialist not yet in the room

    async def add_contact(self, handle, message=None):
        return {"status": "approved"}

    async def list_contact_requests(self, sent_status="pending"):
        return {"sent": [{"to_handle": "@sahilatfau/property-agent"}]}

    async def add_participant(self, chat_id, participant_id, role="member"):
        self.added_participants.append(participant_id)
        return {"id": participant_id}

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        self.events.append((content, message_type, metadata))
        return {"id": "evt", "metadata": metadata}

    async def send_message(self, chat_id, content, mentions=None):
        self.messages.append((content, mentions))
        return {"id": "msg"}


class TestRecruitMentionsSpecialist(unittest.TestCase):
    """recruit() must deterministically hand off to the specialist via @mention."""

    def test_recruit_mentions_specialist_to_request_investigation(self):
        def _factory(key):
            self.client = FakeRecruitClient(key)
            return self.client

        with mock.patch.object(cc, "load_env"), \
             mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "key")), \
             mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"), \
             mock.patch.object(cc, "BandClient", _factory):
            run(cc.recruit.coroutine("property-damage"))

        # The specialist joined AND was @mentioned to do the investigation.
        self.assertEqual(self.client.added_participants, ["prop-1"])
        self.assertEqual(len(self.client.messages), 1, "recruit must mention the specialist")
        content, mentions = self.client.messages[0]
        self.assertTrue(mentions, "mention must target the specialist")
        self.assertEqual(mentions[0]["id"], "prop-1")


class FakeEscalateClient:
    """BandClient stand-in for escalate_to_human() with a scripted room transcript."""

    def __init__(self, messages):
        self._messages = messages
        self.events = []
        self.posted_messages = []

    async def list_participants(self, chat_id):
        return [COORDINATOR, HUMAN]

    async def get_context(self, chat_id, limit=100):
        return self._messages

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        self.events.append((content, message_type, metadata))
        return {"id": "evt"}

    async def send_message(self, chat_id, content, mentions=None):
        self.posted_messages.append((content, mentions))
        return {"id": "msg"}


def _msg(stage, **fields):
    from agents.shared.casefile_schema import (
        RecruitingPayload,
        SpecialistVerdictPayload,
    )

    if stage == "recruiting":
        meta = build_stage_metadata(
            "recruiting",
            RecruitingPayload(specialist_handle="@sahilatfau/property-agent",
                              specialist_name="Property Agent"),
            result={"handle": "@sahilatfau/property-agent", "name": "Property Agent", "joined": True},
        )
    elif stage == "specialist_verdict":
        meta = build_stage_metadata(
            "specialist_verdict",
            SpecialistVerdictPayload(specialty="property", risk="low",
                                     recommendation="approve", explanation="covered peril"),
        )
    else:
        meta = {"stage": stage}
    return {"sender_name": fields.get("sender", "Case Coordinator"),
            "message_type": "task", "content": fields.get("content", ""), "metadata": meta}


class TestEscalateGuardsRecruitedClaim(unittest.TestCase):
    def _run(self, client):
        with mock.patch.object(cc, "load_env"), \
             mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "key")), \
             mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"), \
             mock.patch.object(cc, "BandClient", lambda key: client):
            return run(cc.escalate_to_human.coroutine("deny", "no suitable expert was available"))

    def test_blocks_escalation_when_recruited_but_no_verdict(self):
        # The live bug: a recruiting event exists but no specialist_verdict.
        client = FakeEscalateClient([_msg("recruiting")])
        out = self._run(client)
        self.assertIn("specialist", out.lower())
        # Nothing escalated: no escalation event, no human mention posted.
        self.assertEqual(client.events, [])
        self.assertEqual(client.posted_messages, [])

    def test_allows_escalation_when_verdict_present(self):
        client = FakeEscalateClient([_msg("recruiting"), _msg("specialist_verdict")])
        out = self._run(client)
        self.assertIn("Escalated", out)
        self.assertEqual(len(client.events), 1)
        self.assertEqual(client.events[0][2]["stage"], "escalation")

    def test_allows_escalation_on_no_match_path(self):
        # No specialist was recruited (no recruiting event) — Coordinator decides itself.
        client = FakeEscalateClient([])
        out = self._run(client)
        self.assertIn("Escalated", out)
        self.assertEqual(len(client.events), 1)


if __name__ == "__main__":
    unittest.main()
