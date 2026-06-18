"""Tests for the typed casefile payload schema.

Each stage's payload is parsed from a payload shaped exactly as its real producer
emits it (cross-checked against the emit sites), covering both field layouts:
  * result-bearing stages   → fields under metadata["result"]
  * sibling-bearing stages  → fields as siblings of result in metadata
plus the graceful-degradation contract: JSON-string metadata, partial/legacy events,
and garbage input never raise — they parse what they can or return None.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.casefile_schema import (  # noqa: E402
    ConflictResult,
    CoverageResult,
    DiscoveryPayload,
    EscalationResult,
    IntakeResult,
    RecruitingPayload,
    SignoffPayload,
    SpecialistVerdictPayload,
    build_stage_metadata,
    model_for_stage,
    parse_stage_metadata,
)


class TestResultBearingStages(unittest.TestCase):
    """Stages whose payload lives under metadata["result"]."""

    def test_intake(self):
        # Shape from intake_coverage.record_coverage_and_handoff (stage="intake").
        meta = {
            "stage": "intake",
            "result": {"claim_id": "CLM-2026-0042", "domain": "auto",
                       "subject": "Jane Doe", "docs": 5},
        }
        p = parse_stage_metadata("intake", meta)
        self.assertIsInstance(p, IntakeResult)
        self.assertEqual(p.claim_id, "CLM-2026-0042")
        self.assertEqual(p.domain, "auto")
        self.assertEqual(p.docs, 5)

    def test_coverage(self):
        # Shape from intake_coverage.record_coverage_and_handoff (stage="coverage").
        meta = {
            "stage": "coverage",
            "result": {"covered": True, "policy": "POL-MER-8812",
                       "deductible": 500, "domain": "auto", "note": "In force."},
        }
        p = parse_stage_metadata("coverage", meta)
        self.assertIsInstance(p, CoverageResult)
        self.assertIs(p.covered, True)
        self.assertEqual(p.policy, "POL-MER-8812")
        self.assertEqual(p.deductible, 500)

    def test_escalation(self):
        # Shape from CASE_COORDINATOR_PROMPT step 5a (stage="escalation").
        meta = {"stage": "escalation",
                "result": {"recommendation": "deny", "rationale": "Two strong signals."}}
        p = parse_stage_metadata("escalation", meta)
        self.assertIsInstance(p, EscalationResult)
        self.assertEqual(p.recommendation, "deny")
        self.assertEqual(p.rationale, "Two strong signals.")

    def test_conflict(self):
        # Shape from case_coordinator.cross_check (stage="conflict").
        meta = {"stage": "conflict",
                "result": {"status": "conflict",
                           "reasons": ["Evidence raised signals but specialist said low risk."],
                           "needs_human": True}}
        p = parse_stage_metadata("conflict", meta)
        self.assertIsInstance(p, ConflictResult)
        self.assertEqual(p.status, "conflict")
        self.assertEqual(len(p.reasons), 1)
        self.assertIs(p.needs_human, True)

    def test_evidence_analysis_reuses_evidence_report(self):
        # evidence_analysis reuses EvidenceReport (single source of truth);
        # producer = evidence_analyst.run_evidence_analysis → report.model_dump().
        from agents.shared.evidence import EvidenceReport

        self.assertIs(model_for_stage("evidence_analysis"), EvidenceReport)
        meta = {
            "stage": "evidence_analysis",
            "result": {
                "observations": [
                    {"filename": "damage_front.jpg", "severity_band": "minor",
                     "consistent_with_narrative": "no", "confidence": "high"}
                ],
                "signals": ["severity_gap", "evidence_discrepancy"],
                "suggested_domain": "auto",
                "vision_model": "google/gemma-3-27b-it",
                "degraded": False,
            },
        }
        p = parse_stage_metadata("evidence_analysis", meta)
        self.assertIsInstance(p, EvidenceReport)
        self.assertEqual(p.signals, ["severity_gap", "evidence_discrepancy"])
        self.assertEqual(p.suggested_domain, "auto")
        self.assertEqual(len(p.observations), 1)
        self.assertEqual(p.observations[0].filename, "damage_front.jpg")


class TestSiblingBearingStages(unittest.TestCase):
    """Stages whose authoritative fields are siblings of result in metadata."""

    def test_discovery(self):
        # Shape from case_coordinator.recruit discovery event (no "result" object).
        meta = {
            "stage": "discovery",
            "capability_tag": "fraud-investigation",
            "match_path": "tag",
            "candidates": [{"name": "Fraud Agent", "handle": "@iu/fraud", "tags": ["fraud-investigation"]}],
            "selected_handle": "@iu/fraud",
            "selected_name": "Fraud Agent",
        }
        p = parse_stage_metadata("discovery", meta)
        self.assertIsInstance(p, DiscoveryPayload)
        self.assertEqual(p.capability_tag, "fraud-investigation")
        self.assertEqual(p.match_path, "tag")
        self.assertEqual(p.selected_handle, "@iu/fraud")
        self.assertEqual(len(p.candidates), 1)

    def test_recruiting(self):
        # Shape from case_coordinator.recruit recruiting event — sibling keys are
        # authoritative (the gateway reads specialist_handle / specialist_name).
        meta = {
            "stage": "recruiting",
            "specialist_handle": "@iu/fraud",
            "specialist_name": "Fraud Agent",
            "match_path": "tag",
            "capability_tag": "fraud-investigation",
            "result": {"handle": "@iu/fraud", "name": "Fraud Agent", "joined": True},
        }
        p = parse_stage_metadata("recruiting", meta)
        self.assertIsInstance(p, RecruitingPayload)
        self.assertEqual(p.specialist_handle, "@iu/fraud")
        self.assertEqual(p.specialist_name, "Fraud Agent")

    def test_specialist_verdict(self):
        # Shape from the specialist LLM contract (prompts.py): specialty + risk are
        # siblings; result is free-form.
        meta = {
            "stage": "specialist_verdict",
            "specialty": "auto",
            "risk": "high",
            "result": {"verdict": "likely_fraud", "confidence": 0.88},
        }
        p = parse_stage_metadata("specialist_verdict", meta)
        self.assertIsInstance(p, SpecialistVerdictPayload)
        self.assertEqual(p.specialty, "auto")
        self.assertEqual(p.risk, "high")
        self.assertEqual(p.result["verdict"], "likely_fraud")

    def test_fraud_verdict_legacy_alias(self):
        # Pre-multi-specialist rooms used stage="fraud_verdict"; it parses identically.
        meta = {"stage": "fraud_verdict", "specialty": "auto", "risk": "high"}
        p = parse_stage_metadata("fraud_verdict", meta)
        self.assertIsInstance(p, SpecialistVerdictPayload)
        self.assertEqual(p.risk, "high")

    def test_signoff(self):
        # Shape from gateway.post_approve agent-fallback event (main.py).
        meta = {
            "stage": "signoff",
            "decision": "approve",
            "note": "looks good",
            "authored_by": "agent_on_behalf_of_human",
        }
        p = parse_stage_metadata("signoff", meta)
        self.assertIsInstance(p, SignoffPayload)
        self.assertEqual(p.decision, "approve")
        self.assertEqual(p.note, "looks good")
        self.assertEqual(p.authored_by, "agent_on_behalf_of_human")


class TestGracefulDegradation(unittest.TestCase):
    """The reader contract: never raise on partial / legacy / malformed Band data."""

    def test_unknown_stage_returns_none(self):
        self.assertIsNone(parse_stage_metadata("not_a_stage", {"result": {}}))

    def test_missing_stage_returns_none(self):
        self.assertIsNone(parse_stage_metadata(None, {"result": {}}))
        self.assertIsNone(parse_stage_metadata("", {"result": {}}))

    def test_json_string_metadata_is_coerced(self):
        # Band sometimes serializes metadata as a JSON string.
        meta = json.dumps({"stage": "coverage",
                            "result": {"covered": False, "policy": "POL-1"}})
        p = parse_stage_metadata("coverage", meta)
        self.assertIsInstance(p, CoverageResult)
        self.assertIs(p.covered, False)
        self.assertEqual(p.policy, "POL-1")

    def test_garbage_metadata_does_not_raise(self):
        for junk in (None, "not json at all", 42, [], "{bad json"):
            p = parse_stage_metadata("coverage", junk)
            # Lenient model with all-optional fields parses {} to an empty payload;
            # the point is simply that it never raises.
            self.assertIsInstance(p, CoverageResult)
            self.assertIsNone(p.covered)

    def test_partial_payload_fills_defaults(self):
        # A legacy intake event missing newer fields still parses; absent fields
        # take their declared defaults rather than blowing up.
        p = parse_stage_metadata("intake", {"stage": "intake", "result": {"claim_id": "X"}})
        self.assertEqual(p.claim_id, "X")
        self.assertEqual(p.docs, 0)
        self.assertIsNone(p.domain)

    def test_legacy_signoff_without_provenance_defaults_to_agent(self):
        # Older signoff events omit authored_by; we never silently claim a human posted.
        p = parse_stage_metadata("signoff", {"stage": "signoff", "decision": "deny"})
        self.assertEqual(p.decision, "deny")
        self.assertEqual(p.authored_by, "agent_on_behalf_of_human")

    def test_extra_fields_are_preserved(self):
        # A newer producer field an older schema hasn't named is kept, not dropped.
        meta = {"stage": "coverage",
                "result": {"covered": True, "policy": "P", "new_field": "kept"}}
        p = parse_stage_metadata("coverage", meta)
        self.assertEqual(p.model_dump().get("new_field"), "kept")

    def test_result_bearing_tolerates_flattened_payload(self):
        # If a producer flattened a result-bearing stage (fields at top level instead
        # of under "result"), the parser falls back to the whole metadata dict.
        meta = {"stage": "coverage", "covered": True, "policy": "POL-FLAT"}
        p = parse_stage_metadata("coverage", meta)
        self.assertIs(p.covered, True)
        self.assertEqual(p.policy, "POL-FLAT")


class TestBuildStageMetadata(unittest.TestCase):
    """The producer-side helper emits the SAME wire bytes the dict literals did,
    and round-trips back through the reader."""

    def test_intake_bytes_match_old_literal(self):
        meta = build_stage_metadata("intake", IntakeResult(
            claim_id="CLM-2026-0042", domain="auto", subject="Jane Doe", docs=5))
        # Exactly the dict intake_coverage.py emitted before the rewire.
        self.assertEqual(meta, {
            "stage": "intake",
            "result": {"claim_id": "CLM-2026-0042", "domain": "auto",
                       "subject": "Jane Doe", "docs": 5},
        })

    def test_coverage_bytes_match_old_literal(self):
        meta = build_stage_metadata("coverage", CoverageResult(
            covered=True, policy="POL-MER-8812", deductible=500,
            domain="auto", note="In force."))
        self.assertEqual(meta, {
            "stage": "coverage",
            "result": {"covered": True, "policy": "POL-MER-8812", "deductible": 500,
                       "domain": "auto", "note": "In force."},
        })

    def test_discovery_bytes_match_old_literal(self):
        cands = [{"name": "Sentinel", "handle": "@iu/fraud", "tags": ["fraud-investigation"]}]
        meta = build_stage_metadata("discovery", DiscoveryPayload(
            capability_tag="fraud-investigation", match_path="tag",
            candidates=cands, selected_handle="@iu/fraud", selected_name="Sentinel"))
        self.assertEqual(meta, {
            "stage": "discovery",
            "capability_tag": "fraud-investigation",
            "match_path": "tag",
            "candidates": cands,
            "selected_handle": "@iu/fraud",
            "selected_name": "Sentinel",
        })

    def test_recruiting_bytes_match_old_literal_incl_result(self):
        # recruiting carries siblings AND a duplicating result sub-object the gateway
        # and dashboard read — both must survive byte-for-byte.
        result = {"handle": "@iu/fraud", "name": "Sentinel", "joined": True,
                  "match_path": "tag", "capability_tag": "fraud-investigation"}
        meta = build_stage_metadata(
            "recruiting",
            RecruitingPayload(specialist_handle="@iu/fraud", specialist_name="Sentinel",
                              match_path="tag", capability_tag="fraud-investigation"),
            result=result,
        )
        self.assertEqual(meta, {
            "stage": "recruiting",
            "specialist_handle": "@iu/fraud",
            "specialist_name": "Sentinel",
            "match_path": "tag",
            "capability_tag": "fraud-investigation",
            "result": result,
        })

    def test_signoff_bytes_match_old_literal(self):
        meta = build_stage_metadata("signoff", SignoffPayload(
            decision="approve", note="ok", authored_by="agent_on_behalf_of_human"))
        self.assertEqual(meta, {
            "stage": "signoff",
            "decision": "approve",
            "note": "ok",
            "authored_by": "agent_on_behalf_of_human",
        })

    def test_round_trip_result_bearing(self):
        # build → parse yields a payload equal to the one we started with.
        original = CoverageResult(covered=False, policy="P", deductible=750,
                                  domain="medical", note="excluded")
        meta = build_stage_metadata("coverage", original)
        parsed = parse_stage_metadata("coverage", meta)
        self.assertEqual(parsed.model_dump(), original.model_dump())

    def test_round_trip_sibling_bearing(self):
        original = DiscoveryPayload(capability_tag="medical-review", match_path="fallback",
                                    candidates=[], selected_handle="@mg/med",
                                    selected_name="ClinicCheck")
        meta = build_stage_metadata("discovery", original)
        parsed = parse_stage_metadata("discovery", meta)
        self.assertEqual(parsed.model_dump(), original.model_dump())

    def test_extra_keys_placed_at_top_level(self):
        meta = build_stage_metadata("intake", IntakeResult(claim_id="C"),
                                    extra={"mentions": [{"id": "u1", "name": "x"}]})
        self.assertEqual(meta["mentions"], [{"id": "u1", "name": "x"}])
        self.assertEqual(meta["stage"], "intake")


if __name__ == "__main__":
    unittest.main()
