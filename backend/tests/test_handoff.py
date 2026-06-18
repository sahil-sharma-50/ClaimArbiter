"""Tests for the deterministic Band-native handoff helpers.

The live failure these guard: Intake's LLM mentioned the Case Coordinator instead
of the Evidence Analyst (whose Band name never matched "@EvidenceAnalyst"), so
evidence analysis was skipped and the fraud trap never sprang. resolve_participant
must find the Evidence Analyst by a robust needle and mention it by its real
handle — the value Band's resolver matches.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.handoff import (  # noqa: E402
    display_of,
    mention_of,
    mention_record,
    parse_claim,
    resolve_human_reviewer,
    resolve_participant,
)

# The real room from the live run: handles are "<user>/<agent-name>", display
# names have spaces. "@EvidenceAnalyst" matches NEITHER — that was the bug.
ROOM = [
    {"id": "827c26de", "name": "Intake Coverage", "handle": "sahilatfau/intake-coverage"},
    {"id": "91ee0392", "name": "Evidence Analyst", "handle": "sahilatfau/evidence-analyst"},
    {"id": "955efd0a", "name": "Case Coordinator", "handle": "sahilatfau/case-coordinator"},
    {"id": "d19689a7", "name": "Sahil Sharma", "handle": "sahilatfau", "type": "User"},
]


class FakeDeps:
    """Minimal AgentToolsProtocol stand-in: a participant snapshot + refresh."""

    def __init__(self, participants, refreshed=None):
        self._participants = participants
        self._refreshed = refreshed
        self.refresh_calls = 0

    @property
    def participants(self):
        return list(self._participants)

    async def get_participants(self):
        self.refresh_calls += 1
        return self._refreshed if self._refreshed is not None else self._participants


def run(coro):
    return asyncio.run(coro)


class TestResolveParticipant(unittest.TestCase):
    def test_finds_evidence_analyst_not_coordinator(self):
        """The exact live bug: 'evidence' must resolve to the Evidence Analyst."""
        p = run(resolve_participant(FakeDeps(ROOM), "evidence"))
        self.assertIsNotNone(p)
        self.assertEqual(p["id"], "91ee0392")
        # And the mention we'd send is the real handle Band can resolve.
        self.assertEqual(mention_of(p), "sahilatfau/evidence-analyst")
        self.assertEqual(display_of(p), "Evidence Analyst")

    def test_finds_case_coordinator(self):
        p = run(resolve_participant(FakeDeps(ROOM), "coordinat", "adjud"))
        self.assertIsNotNone(p)
        self.assertEqual(p["id"], "955efd0a")

    def test_refreshes_when_target_absent_from_snapshot(self):
        """If the target isn't in the cached snapshot yet, refresh once and find it."""
        snapshot = [p for p in ROOM if p["id"] != "91ee0392"]  # evidence not joined yet
        deps = FakeDeps(snapshot, refreshed=ROOM)
        p = run(resolve_participant(deps, "evidence"))
        self.assertIsNotNone(p)
        self.assertEqual(p["id"], "91ee0392")
        self.assertEqual(deps.refresh_calls, 1)

    def test_returns_none_when_no_match(self):
        deps = FakeDeps(ROOM)
        self.assertIsNone(run(resolve_participant(deps, "nonexistent-agent")))

    def test_refresh_failure_does_not_crash(self):
        class BrokenDeps(FakeDeps):
            async def get_participants(self):
                raise RuntimeError("network down")

        deps = BrokenDeps([p for p in ROOM if p["id"] != "91ee0392"])
        self.assertIsNone(run(resolve_participant(deps, "evidence")))


class TestResolveHumanReviewer(unittest.TestCase):
    def test_finds_user_by_id(self):
        with unittest.mock.patch.dict(
            "os.environ", {"HUMAN_REVIEWER_USER_ID": "d19689a7"}
        ):
            human = resolve_human_reviewer(ROOM)
        self.assertIsNotNone(human)
        self.assertEqual(human["name"], "Sahil Sharma")

    def test_finds_sole_user_when_id_unset(self):
        with unittest.mock.patch.dict("os.environ", {}, clear=False):
            os.environ.pop("HUMAN_REVIEWER_USER_ID", None)
        human = resolve_human_reviewer(ROOM)
        self.assertEqual(human["name"], "Sahil Sharma")

    def test_does_not_match_agent_named_reviewer(self):
        room = [p for p in ROOM if p["id"] != "d19689a7"] + [
            {"id": "x", "name": "Medical Claims Reviewer", "type": "Agent",
             "handle": "org/medical-review"},
        ]
        with unittest.mock.patch.dict("os.environ", {}, clear=False):
            os.environ.pop("HUMAN_REVIEWER_USER_ID", None)
        self.assertIsNone(resolve_human_reviewer(room))


class TestMentionRecord(unittest.TestCase):
    def test_builds_band_mention_dict(self):
        rec = mention_record(ROOM[3])
        self.assertEqual(rec["id"], "d19689a7")
        self.assertEqual(rec["name"], "Sahil Sharma")
        self.assertEqual(rec["handle"], "sahilatfau")


class TestParseClaim(unittest.TestCase):
    def test_parses_raw_json(self):
        self.assertEqual(parse_claim('{"claim_id": "X"}'), {"claim_id": "X"})

    def test_parses_double_encoded_json(self):
        """pydantic-ai string args often arrive double-encoded — must unwrap once."""
        import json as _json
        doubly = _json.dumps('{"claim_id": "CLM-2026-0042", "domain": "auto"}')
        parsed = parse_claim(doubly)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["claim_id"], "CLM-2026-0042")

    def test_does_not_unwrap_to_non_dict(self):
        import json as _json
        self.assertIsNone(parse_claim(_json.dumps("just a string")))
        self.assertIsNone(parse_claim("[1, 2, 3]"))

    def test_parses_json_with_raw_control_characters(self):
        """gpt-4o emits literal newlines inside string values; strict json rejects them.

        This was the live regression: a fully-valid-looking claim returned None
        because the narrative contained a raw newline.
        """
        # A real newline inside the narrative value (not the escape sequence \\n).
        raw = '{"claim_id": "CLM-2026-0042", "narrative": "line one\nline two"}'
        parsed = parse_claim(raw)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["claim_id"], "CLM-2026-0042")
        self.assertIn("line two", parsed["narrative"])

    def test_parses_double_encoded_json_with_control_characters(self):
        """The exact live shape: double-encoded AND containing a raw control char."""
        import json as _json
        inner = '{"claim_id": "X", "narrative": "a\nb"}'  # raw newline inside
        doubly = _json.dumps(inner)
        parsed = parse_claim(doubly)
        self.assertIsNotNone(parsed)
        self.assertEqual(parsed["claim_id"], "X")

    def test_parses_fenced_json_in_prose(self):
        text = 'Here is the claim:\n```json\n{"claim_id": "Y", "domain": "auto"}\n```\nthanks'
        self.assertEqual(parse_claim(text)["claim_id"], "Y")

    def test_parses_bare_object_in_prose(self):
        self.assertEqual(parse_claim('blah {"a": 1} blah')["a"], 1)

    def test_returns_none_on_garbage(self):
        self.assertIsNone(parse_claim("no json here"))


if __name__ == "__main__":
    unittest.main()
