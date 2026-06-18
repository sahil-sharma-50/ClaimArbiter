"""Tests for evidence signal derivation and evidence phase inference."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.casefile import _content_signals, infer_phase  # noqa: E402
from agents.shared.evidence import (  # noqa: E402
    ImageObservation,
    classify_domain,
    derive_signals,
)
from agents.shared.scoring import score_signals, signal_source  # noqa: E402


class TestDeriveSignals(unittest.TestCase):
    def test_severity_gap_when_narrative_severe_photo_minor(self):
        claim = {
            "narrative": "High-speed rear-end collision with extensive rear crush",
            "loss_amount": 12500,
            "damage": {"description": "Severe rear quarter panel crush", "estimated_repair": 12500},
        }
        obs = [
            ImageObservation(
                filename="damage_front.jpg",
                severity_band="minor",
                consistent_with_narrative="no",
                confidence="high",
            )
        ]
        signals = derive_signals(claim, obs, "")
        self.assertIn("severity_gap", signals)
        self.assertIn("evidence_discrepancy", signals)

    def test_pdf_contradiction_adds_discrepancy(self):
        claim = {"narrative": "Severe high-speed collision with extensive damage"}
        signals = derive_signals(
            claim,
            [],
            "Minor rear contact. Small scuff on front bumper. No structural damage.",
        )
        self.assertIn("evidence_discrepancy", signals)

    def test_clean_claim_no_signals(self):
        claim = {
            "narrative": "Minor parking lot tap",
            "damage": {"description": "Front bumper scuff", "estimated_repair": 1800},
            "loss_amount": 1800,
        }
        obs = [
            ImageObservation(
                filename="damage_front.jpg",
                severity_band="minor",
                consistent_with_narrative="yes",
                confidence="high",
            )
        ]
        self.assertEqual(derive_signals(claim, obs, ""), [])

    def test_pdf_discrepancy_survives_low_confidence_vision(self):
        """The trap must spring on the PDF alone even when every photo reads low."""
        claim = {
            "narrative": "High-speed rear-end collision; extensive rear crush, total loss",
            "loss_amount": 12500,
        }
        obs = [
            ImageObservation(filename="damage_front.jpg", confidence="low"),
            ImageObservation(filename="damage_rear.jpg", confidence="low", error="vision timeout"),
        ]
        pdf = "Minor rear contact. Small scuff on front bumper. No structural damage."
        signals = derive_signals(claim, obs, pdf)
        # Both signals come from the deterministic document path → clears 0.7.
        self.assertIn("evidence_discrepancy", signals)
        self.assertIn("severity_gap", signals)

    def test_clean_claim_with_consistent_pdf_stays_clean(self):
        claim = {"narrative": "Minor parking lot tap; front bumper scuff", "loss_amount": 1800}
        pdf = "Minor low-speed contact in a parking lot. Small scuff. Consistent accounts."
        self.assertEqual(derive_signals(claim, [], pdf), [])

    def test_string_loss_amount_does_not_crash(self):
        """A formatted loss like '$12,500' must not raise (degraded-fallback guarantee)."""
        claim = {"narrative": "rear damage", "loss_amount": "$12,500"}
        # Should classify as severe via loss>=8000 without raising.
        self.assertIsInstance(derive_signals(claim, [], ""), list)


class TestClassifyDomain(unittest.TestCase):
    """Domain is auto-detected from the claim STORY (narrative + descriptions +
    structural shape), not echoed from the now-neutral input domain field."""

    def test_legal_from_litigation_narrative(self):
        claim = {
            "domain": "unknown",
            "narrative": "Outside counsel retained for liability defense in a covered "
                         "lawsuit; itemized attorney fees for depositions and the hearing.",
            "damage": {"description": "legal costs for the proceeding"},
        }
        self.assertEqual(classify_domain(claim), "legal")

    def test_property_from_water_narrative(self):
        claim = {
            "domain": "unknown",
            "narrative": "Sudden kitchen supply-line burst caused extensive water "
                         "damage to the subfloor and cabinets.",
            "damage": {"description": "water damage to kitchen subfloor and drywall"},
        }
        self.assertEqual(classify_domain(claim), "property")

    def test_medical_from_injury_narrative(self):
        claim = {
            "domain": "unknown",
            "narrative": "Soft-tissue neck strain; billed for cervical X-ray, lumbar "
                         "MRI, and physical therapy sessions.",
            "treatment": {"reported_injury": "neck strain"},
        }
        self.assertEqual(classify_domain(claim), "medical")

    def test_narrative_overrides_misleading_neutral_domain(self):
        """The live bed-bug case: form-shaped as auto, but the story is a rental
        property issue — classification must follow the narrative."""
        claim = {
            "domain": "unknown",
            "claim_type": "custom-claim",
            "narrative": "Severe bed bug infestation across my rental apartment; "
                         "mattresses and drywall affected.",
            "damage": {"description": "infestation damage in the bedroom"},
        }
        self.assertEqual(classify_domain(claim), "property")

    def test_structural_hint_breaks_silence(self):
        """A terse narrative still classifies via the claim's shape (a treatment
        block ⇒ medical, a counsel block ⇒ legal)."""
        self.assertEqual(
            classify_domain({"domain": "unknown", "narrative": "claim",
                             "treatment": {"reported_injury": "strain"}}),
            "medical",
        )
        self.assertEqual(
            classify_domain({"domain": "unknown", "narrative": "claim",
                             "parties": {"counsel": {"firm": "Doe & Partners LLP"}}}),
            "legal",
        )

    def test_pdf_text_contributes_to_classification(self):
        claim = {"domain": "unknown", "narrative": ""}
        pdf = "Plumber report: corroded supply line; long-term water leak under sink."
        self.assertEqual(classify_domain(claim, pdf), "property")

    def test_unclassifiable_yields_no_domain(self):
        # Nothing points anywhere → None (the Coordinator then decides with no
        # specialist). This replaces the old "fall back to auto" behavior.
        self.assertIsNone(classify_domain({"domain": "unknown", "narrative": ""}))

    def test_explicit_preset_domain_preserved_when_no_keywords(self):
        """A preset that carries a real domain but a sparse narrative keeps it."""
        self.assertEqual(
            classify_domain({"domain": "property", "narrative": "filed"}), "property"
        )

    def test_golden_presets_classify_to_their_stated_domain(self):
        gc = Path(__file__).resolve().parents[1] / "seed" / "golden_claim"
        import json as _json
        for fname, expected in [
            ("claim_property.json", "property"),
            ("claim_medical.json", "medical"),
            ("claim_legal.json", "legal"),
        ]:
            claim = _json.loads((gc / fname).read_text())
            self.assertEqual(classify_domain(claim), expected, f"{fname} misclassified")


class TestEvidencePhase(unittest.TestCase):
    def test_evidence_analysis_stage(self):
        msgs = [{"content": "x", "metadata": {"stage": "evidence_analysis"}}]
        self.assertEqual(infer_phase(msgs), "evidence")

    def test_conflict_outranks_investigating(self):
        msgs = [
            {"content": "x", "metadata": {"stage": "specialist_verdict"}},
            {"content": "y", "metadata": {"stage": "conflict"}},
        ]
        self.assertEqual(infer_phase(msgs), "conflict")

    def test_evidence_outranks_coverage(self):
        msgs = [
            {"content": "x", "metadata": {"stage": "coverage"}},
            {"content": "y", "metadata": {"stage": "evidence_analysis"}},
        ]
        self.assertEqual(infer_phase(msgs), "evidence")

    def test_evidence_analyst_prose_not_treated_as_verdict(self):
        """The analyst's handoff ('high risk … inconsistent') must NOT trip
        specialist_verdict — it is an insurer-side sender, not a specialist."""
        signals = _content_signals(
            "Evidence shows high risk; photos inconsistent with the narrative.",
            "Evidence Analyst",
        )
        self.assertNotIn("specialist_verdict", signals)


class TestScoring(unittest.TestCase):
    def test_two_evidence_signals_clear_threshold(self):
        self.assertEqual(score_signals(["severity_gap", "evidence_discrepancy"]), 0.85)

    def test_single_signal_below_threshold(self):
        self.assertLess(score_signals(["severity_gap"]), 0.7)

    def test_signal_source_distinguishes_vision_and_paper(self):
        self.assertEqual(signal_source("severity_gap"), "vision")
        self.assertEqual(signal_source("prior_claim_match"), "paper")


if __name__ == "__main__":
    unittest.main()
