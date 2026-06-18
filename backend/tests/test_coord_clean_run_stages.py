"""BUG 6 (backend half): a clean/excluded run must not fabricate skipped stages.

When a claim goes coverage -> escalation with NOBODY recruited (score below the
threshold), the frontend stepper must not light up Handoff / Investigate / Conflict.
The backend's job is to feed truthful per-stage data:
  * parse_casefile_entries must emit entries ONLY for stages that actually happened —
    never synthesize a recruiting / specialist_verdict / conflict entry.
  * infer_phase must report the genuine furthest phase reached (escalated here),
    which is correct: nobody recruited, the coordinator escalated.

This documents, for the frontend agent, exactly which casefile stages EXIST vs DO
NOT in a clean run, so the stepper can gate each stage on real content.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.casefile import infer_phase, parse_casefile_entries  # noqa: E402


def _evt(sender, stage, content="", mtype="task", **meta):
    md = {"stage": stage}
    md.update(meta)
    return {"sender_name": sender, "message_type": mtype, "content": content, "metadata": md}


# A clean auto claim: intake -> coverage -> evidence_analysis -> escalation -> signoff.
# No recruiting, no specialist_verdict, no conflict (score was below threshold).
CLEAN_RUN = [
    {"sender_name": "Case Coordinator", "message_type": "text",
     "content": "@Intake New auto-insurance claim filed. claim_id CLM-CLEAN-1", "metadata": {}},
    _evt("Intake Coverage", "intake", "Intake recorded."),
    _evt("Intake Coverage", "coverage", "Coverage confirmed: collision in force.", covered=True),
    _evt("Evidence Analyst", "evidence_analysis", "No damage attachments; empty analysis.",
         result={"signals": [], "suggested_domain": "auto"}),
    _evt("Case Coordinator", "escalation",
         "Score 0.45 below threshold; recommend APPROVE. @Human Reviewer please proceed."),
    _evt("Case Coordinator", "signoff", "Human Reviewer decision: APPROVE [signed]",
         decision="approve", authored_by="agent_on_behalf_of_human"),
]

# The stages that MUST NOT appear as casefile entries in a clean run.
_SKIPPED_STAGES = {"discovery", "recruiting", "specialist_verdict", "fraud_verdict", "conflict"}


class TestCleanRunStages(unittest.TestCase):
    def test_no_fabricated_skipped_stages(self):
        entries = parse_casefile_entries(CLEAN_RUN)
        present_stages = {e.get("stage") for e in entries}
        # The stages that did happen are present...
        self.assertIn("intake", present_stages)
        self.assertIn("coverage", present_stages)
        self.assertIn("evidence_analysis", present_stages)
        self.assertIn("signoff", present_stages)
        # ...and the skipped ones are emphatically NOT synthesized.
        leaked = _SKIPPED_STAGES & present_stages
        self.assertEqual(leaked, set(), f"clean run fabricated skipped stage(s): {leaked}")

    def test_entry_count_matches_real_events_only(self):
        # parse_casefile_entries reflects messages 1:1 for stage-bearing/event msgs;
        # the plain kickoff text has no stage and is not a task/thought/tool_result,
        # so it is not an entry. Exactly the 5 structured events become entries.
        entries = parse_casefile_entries(CLEAN_RUN)
        self.assertEqual(len(entries), 5)

    def test_infer_phase_reports_truthful_furthest_phase(self):
        # Signed wins because the decision is recorded. Without the signoff, the
        # furthest truthful phase is "escalated" — NOT investigating/conflict.
        self.assertEqual(infer_phase(CLEAN_RUN), "signed")
        self.assertEqual(infer_phase(CLEAN_RUN[:-1]), "escalated")

    def test_coverage_only_rests_at_coverage(self):
        # Earlier still: intake + coverage only, before evidence/escalation.
        partial = CLEAN_RUN[:3]
        self.assertEqual(infer_phase(partial), "coverage")


if __name__ == "__main__":
    unittest.main()
