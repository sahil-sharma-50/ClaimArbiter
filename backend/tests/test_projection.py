"""Tests for the gateway projection plane (gateway.projection).

project_state() is pure — raw Band messages + participants in, the dashboard's
ArbiterState out — so the whole projection is exercised here through its one front-door
interface, with no FastAPI app and no Band calls. This is the seam candidate #2 created:
before, this logic could only be tested by importing main.py's privates.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.projection import project_state  # noqa: E402


def _msg(sender, mtype, content, *, metadata=None, ts="2026-06-16T10:00:00Z", mid=None):
    m = {
        "sender_name": sender,
        "message_type": mtype,
        "content": content,
        "inserted_at": ts,
    }
    if metadata is not None:
        m["metadata"] = metadata
    if mid is not None:
        m["id"] = mid
    return m


class TestProjectStateShape(unittest.TestCase):
    def test_empty_transcript_yields_intake_phase_and_stable_keys(self):
        state = project_state([], [], chat_id="chat-abc")
        # The state contract every dashboard consumer relies on.
        self.assertEqual(
            set(state),
            {
                "chat_id", "participants", "casefile", "audit", "handshake",
                "phase", "specialist", "discovery", "routing_score", "decision",
                "band_url", "archived",
            },
        )
        self.assertEqual(state["chat_id"], "chat-abc")
        self.assertEqual(state["phase"], "intake")  # default with no events
        self.assertIsNone(state["specialist"])      # nobody recruited
        self.assertIsNone(state["decision"])         # not signed
        self.assertEqual(state["band_url"], "https://app.band.ai/chat/chat-abc")

    def test_participants_are_normalized_with_org_and_role(self):
        raw = [
            {"name": "Case Coordinator", "type": "Agent"},
            {"name": "Legal Review", "type": "Agent"},
        ]
        state = project_state([], raw, chat_id="c")
        by_name = {p["name"]: p for p in state["participants"]}
        self.assertEqual(by_name["Case Coordinator"]["role"], "case_coordinator")
        self.assertEqual(by_name["Case Coordinator"]["org"], "Insurance Provider")
        self.assertEqual(by_name["Legal Review"]["role"], "legal")
        self.assertEqual(by_name["Legal Review"]["org"], "Legal Group")


class TestProjectStateArchive(unittest.TestCase):
    """An archive event soft-deletes a room: deletion is durable because the
    marker lives in Band, so a refresh that rehydrates the room from Band still
    sees it as archived and the read path can exclude it."""

    def test_no_archive_event_yields_not_archived(self):
        state = project_state([], [], chat_id="c")
        self.assertIn("archived", state)
        self.assertFalse(state["archived"])

    def test_archive_event_marks_state_archived(self):
        msg = _msg("Case Coordinator", "task",
                   "Session archived by the Human Reviewer.",
                   metadata={"archived": True}, mid="m1")
        state = project_state([msg], [], chat_id="c")
        self.assertTrue(state["archived"])

    def test_string_metadata_archive_is_honored(self):
        # Band may hand metadata back as a JSON string; the projection coerces it.
        msg = _msg("Case Coordinator", "task", "archived",
                   metadata='{"archived": true}', mid="m1")
        state = project_state([msg], [], chat_id="c")
        self.assertTrue(state["archived"])


class TestProjectStateFullFraudRun(unittest.TestCase):
    """A representative specialist transcript (legal) drives every part of the state."""

    def _transcript(self):
        return [
            _msg("Intake & Coverage", "task", "Intake parsed claim CLM-42 (legal).",
                 metadata={"stage": "intake",
                           "result": {"claim_id": "CLM-42", "domain": "legal",
                                      "subject": "J. Okafor", "docs": 5}}, mid="m1"),
            _msg("Intake & Coverage", "task", "Coverage confirmed.",
                 metadata={"stage": "coverage",
                           "result": {"covered": True, "policy": "POL-1",
                                      "deductible": 500, "domain": "legal", "note": "in force"}}, mid="m2"),
            _msg("Evidence Analyst", "task", "Evidence analysis complete: signals=severity_gap.",
                 metadata={"stage": "evidence_analysis",
                           "result": {"signals": ["severity_gap", "evidence_discrepancy"],
                                      "suggested_domain": "legal", "observations": [], "degraded": False}}, mid="m3"),
            _msg("Case Coordinator", "thought", "Domain is legal → I need the legal specialist.",
                 metadata={}, mid="m4"),
            _msg("Case Coordinator", "thought", "Directory discovery for 'legal-review': matched Legal Review.",
                 metadata={"stage": "discovery", "capability_tag": "legal-review",
                           "match_path": "tag",
                           "candidates": [{"name": "Legal Review", "handle": "@lg/legal", "tags": ["legal-review"]}],
                           "selected_handle": "@lg/legal", "selected_name": "Legal Review"}, mid="m5"),
            _msg("Case Coordinator", "task", "Recruited Legal Review (@lg/legal) across the org boundary.",
                 metadata={"stage": "recruiting", "specialist_handle": "@lg/legal",
                           "specialist_name": "Legal Review", "match_path": "tag",
                           "capability_tag": "legal-review",
                           "result": {"handle": "@lg/legal", "name": "Legal Review", "joined": True}}, mid="m6"),
            _msg("Legal Review", "task", "Verdict: deny.",
                 metadata={"stage": "specialist_verdict", "specialty": "legal", "risk": "high",
                           "result": {"verdict": "deny", "confidence": 0.88}}, mid="m7"),
            _msg("Case Coordinator", "task", "Recommendation: deny.",
                 metadata={"stage": "escalation",
                           "result": {"recommendation": "deny", "rationale": "legal verdict"}}, mid="m8"),
        ]

    def test_participants_include_historical_senders_after_dismiss(self):
        raw = [
            {"name": "Case Coordinator", "type": "Agent"},
            {"name": "Human Reviewer", "type": "User"},
        ]
        state = project_state(self._transcript(), raw, chat_id="c")
        names = {p["name"] for p in state["participants"]}
        self.assertIn("Intake & Coverage", names)
        self.assertIn("Evidence Analyst", names)
        self.assertIn("Legal Review", names)
        inactive = [p for p in state["participants"] if not p.get("active")]
        self.assertGreaterEqual(len(inactive), 3)
        active = {p["name"] for p in state["participants"] if p.get("active")}
        self.assertEqual(active, {"Case Coordinator", "Human Reviewer"})

    def test_phase_advances_to_investigating(self):
        state = project_state(self._transcript(), [], chat_id="c")
        # Furthest-along structured stage present is the specialist_verdict → investigating
        # (escalation prose advances via signed/escalated only when a [signed] / decision lands).
        self.assertIn(state["phase"], {"investigating", "escalated"})

    def test_specialist_descriptor_is_derived_from_verdict(self):
        state = project_state(self._transcript(), [], chat_id="c")
        spec = state["specialist"]
        self.assertIsNotNone(spec)
        self.assertEqual(spec["type"], "legal")
        self.assertEqual(spec["org"], "Legal Group")
        self.assertEqual(spec["risk"], "high")

    def test_confidence_uses_model_value_when_present(self):
        # The fixture verdict carries result.confidence == 0.88 → surfaced as-is,
        # tagged as a model-produced score (never fabricated).
        spec = project_state(self._transcript(), [], chat_id="c")["specialist"]
        self.assertAlmostEqual(spec["confidence"], 0.88)
        self.assertEqual(spec["confidence_source"], "model")

    def test_confidence_normalizes_percentage_scale(self):
        tx = self._transcript()
        # Replace the verdict with a 0–100 style confidence (free-form LLM JSON).
        tx[6] = _msg("Legal Review", "task", "Verdict: deny.",
                     metadata={"stage": "specialist_verdict", "specialty": "legal",
                               "risk": "high",
                               "result": {"verdict": "deny", "confidence": 88}}, mid="m7")
        spec = project_state(tx, [], chat_id="c")["specialist"]
        self.assertAlmostEqual(spec["confidence"], 0.88)
        self.assertEqual(spec["confidence_source"], "model")

    def test_confidence_derived_from_risk_when_model_omits_it(self):
        tx = self._transcript()
        # A verdict with NO numeric confidence (the common live case): the score is
        # DERIVED from risk and labelled as such — present, honest, never blank.
        tx[6] = _msg("Legal Review", "task", "Verdict: deny.",
                     metadata={"stage": "specialist_verdict", "specialty": "legal",
                               "risk": "high",
                               "result": {"verdict": "deny"}}, mid="m7")
        spec = project_state(tx, [], chat_id="c")["specialist"]
        self.assertIsInstance(spec["confidence"], float)
        self.assertGreater(spec["confidence"], 0.0)
        self.assertLessEqual(spec["confidence"], 1.0)
        self.assertEqual(spec["confidence_source"], "derived")

    def test_confidence_absent_when_no_verdict(self):
        # Specialist recruited but never returned a verdict: no risk, no recommendation
        # → confidence stays None rather than inventing one.
        raw = [{"name": "Legal Review", "type": "Agent"}]
        spec = project_state([], raw, chat_id="c")["specialist"]
        self.assertIsNotNone(spec)
        self.assertIsNone(spec["confidence"])
        self.assertIsNone(spec["confidence_source"])

    def test_discovery_trace_captures_candidates_and_recruit(self):
        disc = project_state(self._transcript(), [], chat_id="c")["discovery"]
        self.assertEqual(disc["capability_tag"], "legal-review")
        self.assertEqual(disc["match_path"], "tag")
        self.assertEqual(disc["recruited_handle"], "@lg/legal")
        self.assertEqual(disc["recruited_name"], "Legal Review")
        self.assertEqual(len(disc["candidates"]), 1)
        self.assertTrue(disc["reasoning"])  # coordinator thoughts captured

    def test_casefile_and_audit_cover_every_message(self):
        tx = self._transcript()
        state = project_state(tx, [], chat_id="c")
        self.assertEqual(len(state["audit"]), len(tx))  # one audit row per message
        stages = {e["stage"] for e in state["casefile"]}
        self.assertTrue({"intake", "coverage", "evidence_analysis", "specialist_verdict"} <= stages)

    def test_handshake_marks_recruiting_as_joined(self):
        state = project_state(self._transcript(), [], chat_id="c")
        steps = [e["step"] for e in state["handshake"]]
        self.assertIn("joined", steps)

    def test_signed_decision_surfaces_when_human_signs(self):
        tx = self._transcript()
        tx.append(_msg("Case Coordinator", "task", "Human Reviewer decision: DENY [signed]",
                       metadata={"stage": "signoff", "decision": "deny", "note": "fraud",
                                 "authored_by": "agent_on_behalf_of_human"}, mid="m9"))
        state = project_state(tx, [], chat_id="c")
        self.assertEqual(state["phase"], "signed")
        self.assertEqual(state["decision"]["decision"], "deny")
        self.assertEqual(state["decision"]["authored_by"], "agent_on_behalf_of_human")


if __name__ == "__main__":
    unittest.main()
