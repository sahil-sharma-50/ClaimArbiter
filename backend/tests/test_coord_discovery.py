"""BUG 9 regression: REAL directory discovery — match the claim's capability tag
against peers' Band directory tags in Python, with a name/handle fallback.

Previously recruit(handle) trusted the LLM to pass the right handle and nothing
matched the claim's capability_tag against the directory. Now recruit(capability_tag)
lists peers, reads each agent's `tags`, and SELECTS the specialist advertising that
tag (tag path). If no peer exposes the tag (tags are set in the Band UI and are often
absent from the API), it falls back to matching by name/handle (fallback path) so the
demo never breaks. A structured `discovery` event records the candidates + decision.
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

# Peers WITH Band directory tags configured (the genuine discovery path).
PEERS_TAGGED = [
    {"id": "u1", "name": "Sahil Sharma", "handle": "sahil", "type": "User"},
    {"id": "a-fraud", "name": "Sentinel", "handle": "partner/sentinel",
     "type": "Agent", "tags": ["fraud-investigation"]},
    {"id": "a-prop", "name": "Orion Assessors", "handle": "partner/orion",
     "type": "Agent", "tags": ["property-damage"]},
    {"id": "a-med", "name": "ClinicCheck", "handle": "partner/cliniccheck",
     "type": "Agent", "tags": ["medical-review"]},
]

# Peers with NO tags at all (Band UI tags unset) — forces the name fallback.
PEERS_UNTAGGED = [
    {"id": "u1", "name": "Sahil Sharma", "handle": "sahil", "type": "User"},
    {"id": "a-fraud", "name": "Fraud Agent", "handle": "sahilatfau/fraud-agent", "type": "Agent"},
    {"id": "a-prop", "name": "Property Agent", "handle": "sahilatprop/property-agent", "type": "Agent"},
    {"id": "a-med", "name": "Medical Agent", "handle": "sahilatmed/medical-agent", "type": "Agent"},
]


class TestSelectSpecialistByTag(unittest.TestCase):
    def test_tag_path_selects_advertised_specialist(self):
        peer, path, cands = cc._select_specialist_by_tag(PEERS_TAGGED, "property-damage")
        self.assertEqual(path, "tag")
        self.assertEqual(peer["handle"], "partner/orion")
        # Candidates exclude the human user and carry each agent's tags.
        names = {c["name"] for c in cands}
        self.assertNotIn("Sahil Sharma", names)  # user filtered out
        self.assertIn("Orion Assessors", names)

    def test_tag_path_is_case_insensitive(self):
        peer, path, _ = cc._select_specialist_by_tag(PEERS_TAGGED, "Fraud-Investigation")
        self.assertEqual(path, "tag")
        self.assertEqual(peer["id"], "a-fraud")

    def test_fallback_path_when_no_tags(self):
        peer, path, cands = cc._select_specialist_by_tag(PEERS_UNTAGGED, "medical-review")
        self.assertEqual(path, "fallback")
        self.assertEqual(peer["id"], "a-med")
        # All considered candidates report empty tags in this scenario.
        self.assertTrue(all(c["tags"] == [] for c in cands))

    def test_tag_wins_over_name_when_both_present(self):
        # A peer tagged property-damage but named "fraud" must be chosen for the
        # property tag (tags are authoritative), proving it's not just name-matching.
        peers = [
            {"id": "x", "name": "Fraud Squad", "handle": "p/fraud-squad",
             "type": "Agent", "tags": ["property-damage"]},
        ]
        peer, path, _ = cc._select_specialist_by_tag(peers, "property-damage")
        self.assertEqual(path, "tag")
        self.assertEqual(peer["id"], "x")

    def test_no_match_returns_none(self):
        peers = [{"id": "x", "name": "Weather Bot", "handle": "p/weather", "type": "Agent", "tags": ["weather"]}]
        peer, path, _ = cc._select_specialist_by_tag(peers, "fraud-investigation")
        self.assertIsNone(peer)
        self.assertEqual(path, "none")

    def test_user_peers_never_selected(self):
        # Even if a human user somehow carried the tag, users are excluded (tags are
        # agents-only in Band; a specialist is always an agent).
        peers = [{"id": "u", "name": "Person", "handle": "person", "type": "User", "tags": ["fraud-investigation"]}]
        peer, path, _ = cc._select_specialist_by_tag(peers, "fraud-investigation")
        self.assertIsNone(peer)
        self.assertEqual(path, "none")


class _FakeClient:
    """BandClient stand-in for the full recruit() flow."""

    def __init__(self, key, peers):
        self._peers = peers
        self.added_participants = []
        self.events = []

    async def list_peers(self, not_in_chat=None):
        return self._peers

    async def list_participants(self, chat_id):
        return []  # specialist not yet in the room

    async def add_contact(self, handle, message=None):
        return {"status": "approved"}

    async def list_contact_requests(self, sent_status="pending"):
        return {"sent": []}

    async def add_participant(self, chat_id, participant_id, role="member"):
        self.added_participants.append(participant_id)
        return {"id": participant_id}

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        self.events.append(metadata or {})
        return {"id": "evt", "metadata": metadata}


def _run_recruit(arg, peers):
    holder = {}

    def _factory(key):
        holder["client"] = _FakeClient(key, peers)
        return holder["client"]

    with mock.patch.object(cc, "get_agent_credentials", lambda a: ("id", "key")), \
         mock.patch.object(cc, "read_active_chat_id", lambda: "chat-x"), \
         mock.patch.object(cc, "BandClient", _factory):
        result = asyncio.run(cc.recruit.coroutine(arg))
    return result, holder["client"]


class TestRecruitDiscovery(unittest.TestCase):
    def test_recruit_by_tag_discovers_and_recruits(self):
        result, client = _run_recruit("fraud-investigation", PEERS_TAGGED)
        self.assertIn("Recruited", result)
        self.assertEqual(client.added_participants, ["a-fraud"])
        # A discovery event AND a recruiting event were emitted.
        stages = [e.get("stage") for e in client.events]
        self.assertIn("discovery", stages)
        self.assertIn("recruiting", stages)
        disc = next(e for e in client.events if e.get("stage") == "discovery")
        self.assertEqual(disc["match_path"], "tag")
        self.assertEqual(disc["capability_tag"], "fraud-investigation")
        self.assertEqual(disc["selected_handle"], "partner/sentinel")
        self.assertTrue(disc["candidates"])  # candidate set captured
        recruiting = next(e for e in client.events if e.get("stage") == "recruiting")
        self.assertEqual(recruiting["match_path"], "tag")
        self.assertEqual(recruiting["capability_tag"], "fraud-investigation")

    def test_recruit_falls_back_to_name_when_untagged(self):
        result, client = _run_recruit("medical-review", PEERS_UNTAGGED)
        self.assertIn("Recruited", result)
        self.assertEqual(client.added_participants, ["a-med"])
        disc = next(e for e in client.events if e.get("stage") == "discovery")
        self.assertEqual(disc["match_path"], "fallback")

    def test_recruit_no_match_returns_coordinator_fallback(self):
        peers = [{"id": "x", "name": "Weather Bot", "handle": "p/weather", "type": "Agent", "tags": ["weather"]}]
        result, client = _run_recruit("fraud-investigation", peers)
        self.assertTrue(result.startswith("NO_MATCH"))
        self.assertEqual(client.added_participants, [])
        disc = next(e for e in client.events if e.get("stage") == "discovery")
        self.assertEqual(disc["match_path"], "none")

    def test_literal_handle_still_recruits_backward_compatible(self):
        # An explicit handle (legacy call style) bypasses discovery and recruits it.
        result, client = _run_recruit("@sahilatfau/fraud-agent", PEERS_UNTAGGED)
        self.assertIn("Recruited", result)
        self.assertEqual(client.added_participants, ["a-fraud"])
        # No discovery event on the handle path.
        self.assertNotIn("discovery", [e.get("stage") for e in client.events])
        recruiting = next(e for e in client.events if e.get("stage") == "recruiting")
        self.assertEqual(recruiting["match_path"], "handle")


class TestDiscoveryPayloadGateway(unittest.TestCase):
    """The gateway must surface the discovery candidates + decision to the dashboard."""

    def test_payload_includes_candidates_tag_and_recruited(self):
        from gateway.projection import _discovery_payload

        messages = [
            {
                "sender_name": "Case Coordinator",
                "message_type": "thought",
                "content": "Directory discovery for capability 'fraud-investigation': matched Sentinel.",
                "metadata": {
                    "stage": "discovery",
                    "capability_tag": "fraud-investigation",
                    "match_path": "tag",
                    "candidates": [
                        {"name": "Sentinel", "handle": "partner/sentinel", "tags": ["fraud-investigation"]},
                        {"name": "Orion", "handle": "partner/orion", "tags": ["property-damage"]},
                    ],
                    "selected_handle": "partner/sentinel",
                    "selected_name": "Sentinel",
                },
            },
            {
                "sender_name": "Case Coordinator",
                "message_type": "task",
                "content": "Recruited Sentinel across the org boundary.",
                "metadata": {
                    "stage": "recruiting",
                    "specialist_handle": "@partner/sentinel",
                    "specialist_name": "Sentinel",
                    "match_path": "tag",
                    "capability_tag": "fraud-investigation",
                },
            },
        ]
        payload = _discovery_payload(messages)
        self.assertEqual(payload["recruited_handle"], "@partner/sentinel")
        self.assertEqual(payload["recruited_name"], "Sentinel")
        self.assertEqual(payload["capability_tag"], "fraud-investigation")
        self.assertEqual(payload["match_path"], "tag")
        self.assertEqual(len(payload["candidates"]), 2)


if __name__ == "__main__":
    unittest.main()
