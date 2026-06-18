"""Regression tests for participant classification after the agent rename.

_classify_participant maps a live Band participant's display name to an internal
role key. It must (a) recognize the NEW names (Case Coordinator / Human Reviewer),
(b) still recognize the OLD names (accept-both, so the demo survives a not-yet-
renamed Band agent), and (c) NEVER misclassify the "Medical Review" specialist as
the human — which is why the human matcher is "human", never "review".
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.projection import _classify_participant  # noqa: E402


class TestClassifyParticipant(unittest.TestCase):
    def test_new_coordinator_name(self):
        self.assertEqual(_classify_participant("Case Coordinator"), "case_coordinator")

    def test_legacy_adjudicator_name(self):
        self.assertEqual(_classify_participant("Adjudicator"), "case_coordinator")

    def test_new_human_reviewer_name(self):
        self.assertEqual(_classify_participant("Human Reviewer"), "human_reviewer")

    def test_legacy_adjuster_name(self):
        self.assertEqual(_classify_participant("Adjuster"), "human_reviewer")

    def test_medical_review_is_not_human(self):
        # "Medical Review" contains "review" — must classify as the medical
        # specialist, NOT the human. This is why the human matcher is "human".
        self.assertEqual(_classify_participant("Medical Review"), "medical")

    def test_specialists_unchanged(self):
        self.assertEqual(_classify_participant("Legal Review"), "legal")
        self.assertEqual(_classify_participant("Property Assessment"), "property")

    def test_intake_and_evidence_unchanged(self):
        self.assertEqual(_classify_participant("Intake"), "intake")
        self.assertEqual(_classify_participant("Evidence Analyst"), "evidence")

    def test_unknown(self):
        self.assertEqual(_classify_participant("Random Person"), "other")

    def test_real_intake_plus_coverage_name(self):
        # The name Band actually registers (run_all.py) is "Intake+Coverage".
        self.assertEqual(_classify_participant("Intake+Coverage"), "intake")

    def test_property_adjuster_resolves_to_specialist_not_human(self):
        # "Property Adjuster" contains "adjust" but the SPECIALIST_KINDS loop runs
        # first, so ordering (not luck) classifies it as the property specialist.
        self.assertEqual(_classify_participant("Property Adjuster"), "property")
