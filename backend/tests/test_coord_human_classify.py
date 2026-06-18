"""BUG 7 regression: classify the human reviewer by id/type, not name substrings.

A real reviewer named e.g. "Sahil Sharma" matches none of the name needles, so the
old name-only `_classify_participant` returned "other" → org "Unknown", and the
dashboard rendered the human as a "Specialist" in org "Unknown". The id/type-aware
`_classify_participant_record` / `_normalize_participants` must instead resolve such a
participant to the human reviewer (org "Insurance Provider", framework "Human",
type "human"), using either the configured HUMAN_REVIEWER_USER_ID or Band's
participant `type == "User"`.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.projection import (  # noqa: E402
    _classify_participant_record,
    _normalize_participants,
)

HUMAN_UUID = "11111111-2222-3333-4444-555555555555"


class TestHumanClassifyByType(unittest.TestCase):
    def test_named_human_user_type_resolves_to_reviewer(self):
        # No name match ("Sahil Sharma"), but Band marks them type=User → reviewer.
        p = {"id": "abc", "name": "Sahil Sharma", "type": "User"}
        self.assertEqual(_classify_participant_record(p), "human_reviewer")

    def test_user_type_is_case_insensitive(self):
        p = {"id": "abc", "name": "Jane Doe", "type": "user"}
        self.assertEqual(_classify_participant_record(p), "human_reviewer")

    def test_legacy_participant_type_key_also_works(self):
        p = {"id": "abc", "name": "Jane Doe", "participant_type": "User"}
        self.assertEqual(_classify_participant_record(p), "human_reviewer")

    def test_agent_named_other_stays_other(self):
        # An *agent* (type=Agent) whose name matches nothing must NOT be turned into
        # the human reviewer — only human-typed participants get that treatment.
        p = {"id": "abc", "name": "Mystery Bot", "type": "Agent"}
        self.assertEqual(_classify_participant_record(p), "other")

    def test_known_agent_names_still_classify_by_name(self):
        # Type=Agent + a recognizable name still classifies normally.
        self.assertEqual(
            _classify_participant_record({"id": "1", "name": "Legal Review", "type": "Agent"}),
            "legal",
        )
        self.assertEqual(
            _classify_participant_record({"id": "2", "name": "Case Coordinator", "type": "Agent"}),
            "case_coordinator",
        )

    def test_specialist_user_typed_is_not_overridden(self):
        # A name that classifies to a specialist wins even if type=User somehow —
        # the "other"+User rule only fires when the NAME yielded nothing.
        p = {"id": "x", "name": "Medical Review", "type": "User"}
        self.assertEqual(_classify_participant_record(p), "medical")


class TestHumanClassifyById(unittest.TestCase):
    def test_id_match_wins_even_with_unhelpful_name(self):
        with mock.patch.dict(os.environ, {"HUMAN_REVIEWER_USER_ID": HUMAN_UUID}):
            p = {"id": HUMAN_UUID, "name": "Sahil Sharma", "type": "Agent"}
            # Even mislabeled as Agent, the configured reviewer id is definitive.
            self.assertEqual(_classify_participant_record(p), "human_reviewer")

    def test_id_match_ignores_whitespace_in_env(self):
        with mock.patch.dict(os.environ, {"HUMAN_REVIEWER_USER_ID": f"  {HUMAN_UUID}  "}):
            p = {"id": HUMAN_UUID, "name": "Anyone"}
            self.assertEqual(_classify_participant_record(p), "human_reviewer")


class TestNormalizeParticipantsHuman(unittest.TestCase):
    def test_human_emits_insurance_provider_org_and_human_type(self):
        raw = [{"id": "abc", "name": "Sahil Sharma", "type": "User"}]
        out = _normalize_participants(raw, [])
        self.assertEqual(len(out), 1)
        rec = out[0]
        self.assertEqual(rec["role"], "human_reviewer")
        self.assertEqual(rec["org"], "Insurance Provider")
        self.assertEqual(rec["framework"], "Human")
        self.assertEqual(rec["type"], "human")          # dashboard-facing kind
        self.assertEqual(rec["band_type"], "User")       # raw Band enum preserved
        # The bug symptom (org "Unknown") must be gone.
        self.assertNotEqual(rec["org"], "Unknown")

    def test_agents_emit_agent_type_and_their_org(self):
        raw = [
            {"id": "1", "name": "Case Coordinator", "type": "Agent"},
            {"id": "2", "name": "Legal Review", "type": "Agent"},
        ]
        out = _normalize_participants(raw, [])
        by_role = {r["role"]: r for r in out}
        self.assertEqual(by_role["case_coordinator"]["org"], "Insurance Provider")
        self.assertEqual(by_role["case_coordinator"]["type"], "agent")
        self.assertEqual(by_role["legal"]["org"], "Legal Group")
        self.assertEqual(by_role["legal"]["type"], "agent")


if __name__ == "__main__":
    unittest.main()
