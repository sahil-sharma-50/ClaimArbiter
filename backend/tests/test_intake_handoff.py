"""Behavioral test for the Intake agent's deterministic coverage + handoff tool.

Guards the live fraud-trap failure end to end at the tool level: when Intake runs,
it must (a) emit a structured ``intake`` event (fixes the empty Intake bar),
(b) emit a structured ``coverage`` event, and (c) hand off by @mentioning the
Evidence Analyst's real handle — never the Case Coordinator.
"""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer.intake_coverage import record_coverage_and_handoff  # noqa: E402

ROOM = [
    {"id": "827c26de", "name": "Intake Coverage", "handle": "sahilatfau/intake-coverage"},
    {"id": "91ee0392", "name": "Evidence Analyst", "handle": "sahilatfau/evidence-analyst"},
    {"id": "955efd0a", "name": "Case Coordinator", "handle": "sahilatfau/case-coordinator"},
]

CLAIM = {
    "claim_id": "CLM-2026-0042",
    "domain": "property",
    "policy_id": "POL-MER-8812",
    "deductible": 500,
    "narrative": "Sudden supply-line burst flooded the kitchen subfloor.",
    "parties": {"claimant": {"name": "Jordan Reyes"}},
    "damage": {"description": "water damage to kitchen subfloor",
               "photos": ["a.jpg", "b.jpg", "c.jpg"]},
    "supporting_document": "plumber_report.pdf",
}


class RecordingDeps:
    """AgentToolsProtocol stand-in that records send_event / send_message calls."""

    def __init__(self, participants):
        self._participants = participants
        self.events = []    # list[(content, message_type, metadata)]
        self.messages = []  # list[(content, mentions)]

    @property
    def participants(self):
        return list(self._participants)

    async def get_participants(self):
        return self._participants

    async def send_event(self, content, message_type, metadata=None):
        self.events.append((content, message_type, metadata))
        return {"id": "evt"}

    async def send_message(self, content, mentions=None):
        self.messages.append((content, mentions))
        return {"id": "msg"}


class _Ctx:
    def __init__(self, deps):
        self.deps = deps


def run(coro):
    return asyncio.run(coro)


class TestIntakeHandoff(unittest.TestCase):
    def _run_tool(self, deps, covered=True, domain="property", claim=None):
        return run(
            record_coverage_and_handoff(
                _Ctx(deps),
                json.dumps(claim if claim is not None else CLAIM),
                domain,
                covered,
                "Policy in force; within limits.",
            )
        )

    def test_emits_intake_and_coverage_events(self):
        deps = RecordingDeps(ROOM)
        self._run_tool(deps)
        stages = [meta.get("stage") for _, _, meta in deps.events]
        self.assertIn("intake", stages)     # fixes the empty Intake bar
        self.assertIn("coverage", stages)

    def test_intake_event_carries_claim_fields(self):
        deps = RecordingDeps(ROOM)
        self._run_tool(deps)
        intake = next(meta["result"] for _, _, meta in deps.events if meta.get("stage") == "intake")
        self.assertEqual(intake["claim_id"], "CLM-2026-0042")
        self.assertEqual(intake["domain"], "property")
        self.assertEqual(intake["docs"], 4)  # 3 photos + 1 plumber report

    def test_hands_off_to_evidence_analyst_not_coordinator(self):
        """The core fraud-trap fix: the handoff mention targets the Evidence Analyst."""
        deps = RecordingDeps(ROOM)
        self._run_tool(deps)
        self.assertEqual(len(deps.messages), 1)
        content, mentions = deps.messages[0]
        self.assertEqual(mentions, ["sahilatfau/evidence-analyst"])
        self.assertNotIn("case-coordinator", json.dumps(mentions))
        # The claim JSON rides along so the analyst has its input.
        self.assertIn("CLM-2026-0042", content)

    def test_coverage_excluded_still_hands_off(self):
        deps = RecordingDeps(ROOM)
        self._run_tool(deps, covered=False)
        coverage = next(meta["result"] for _, _, meta in deps.events if meta.get("stage") == "coverage")
        self.assertFalse(coverage["covered"])
        self.assertEqual(len(deps.messages), 1)  # evidence still analyzed even if excluded

    def test_no_analyst_in_room_does_not_crash(self):
        deps = RecordingDeps([p for p in ROOM if p["id"] != "91ee0392"])
        result = self._run_tool(deps)
        self.assertEqual(len(deps.messages), 0)
        self.assertIn("no Evidence Analyst", result)


class TestIntakeDomainDetection(unittest.TestCase):
    """The detected domain must flow into BOTH the intake event AND the handoff JSON.

    The form no longer pins a domain (build_claim sets "unknown"); Intake classifies
    it. The Case Coordinator reads `domain` to pick a capability tag, so the value the
    tool records is the contract.
    """

    def _run(self, deps, claim, domain):
        return run(
            record_coverage_and_handoff(
                _Ctx(deps), json.dumps(claim), domain, True, "Covered."
            )
        )

    def _intake_domain(self, deps):
        return next(
            meta["result"]["domain"]
            for _, _, meta in deps.events
            if meta.get("stage") == "intake"
        )

    def test_valid_llm_domain_is_recorded_and_stamped_into_handoff(self):
        deps = RecordingDeps(ROOM)
        claim = {"claim_id": "CLM-P", "domain": "unknown",
                 "narrative": "Sudden supply-line burst flooded the kitchen subfloor.",
                 "damage": {"photos": ["a.jpg"]}}
        self._run(deps, claim, "property")
        # Recorded in the structured intake event...
        self.assertEqual(self._intake_domain(deps), "property")
        # ...and stamped into the claim JSON handed to the Evidence Analyst, so the
        # downstream Case Coordinator reads the detected domain, not "unknown".
        content, _ = deps.messages[0]
        handoff_claim = json.loads(content.split("```json")[1].split("```")[0])
        self.assertEqual(handoff_claim["domain"], "property")

    def test_unknown_llm_domain_is_rederived_from_narrative(self):
        """A blank/'unknown'/junk domain from the LLM falls back to the classifier."""
        deps = RecordingDeps(ROOM)
        claim = {"claim_id": "CLM-M", "domain": "unknown",
                 "narrative": "Neck strain after a rear-end collision; billed for a "
                              "lumbar MRI and physical therapy sessions.",
                 "treatment": {"reported_injury": "neck strain"}}
        self._run(deps, claim, "unknown")  # LLM failed to classify
        self.assertEqual(self._intake_domain(deps), "medical")

    def test_invalid_llm_domain_string_is_rederived(self):
        deps = RecordingDeps(ROOM)
        claim = {"claim_id": "CLM-L", "domain": "unknown",
                 "narrative": "Outside counsel retained for liability defense; "
                              "itemized attorney fees for the covered lawsuit.",
                 "parties": {"counsel": {"firm": "Doe & Partners LLP"}}}
        self._run(deps, claim, "not-a-domain")
        self.assertEqual(self._intake_domain(deps), "legal")


if __name__ == "__main__":
    unittest.main()
