"""Regression tests for case-file phase inference.

Agents rarely emit the structured band_send_event(metadata.stage=...) the prompts
ask for; they post plain text/thought messages with free-form wording. So
infer_phase() must derive the phase from message *content + sender*. These cases
are real transcripts captured from live Band runs (sender names + representative
content) where the old keyword-only matcher got stuck in "recruiting".

Run: .venv/bin/python -m unittest tests/test_infer_phase.py -v
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.casefile import infer_phase  # noqa: E402


def _msg(sender: str, content: str, mtype: str = "text") -> dict:
    return {"sender_name": sender, "message_type": mtype, "content": content, "metadata": {}}


# Live transcript that the OLD matcher handled (fraud agent happened to say
# "recommend DENYING"). Must still resolve to escalated/signed.
TRANSCRIPT_LUCKY = [
    _msg("adjudicator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0042"),
    _msg("fraud_agent", "I've reviewed the claim details and investigated the prior claim match and photo metadata."),
    _msg("adjudicator", "Fraud score computed: 0.85, which exceeds the threshold of 0.7.", "thought"),
    _msg("fraud_agent", "Based on the analysis, I recommend DENYING the claim CLM-2026-0042 due to prior claim match."),
    _msg("adjudicator", "Received fraud verdict from the Fraud Agent. Preparing to draft the final recommendation.", "thought"),
]

# Live transcript that the OLD matcher got STUCK on: the verdict and escalation
# are phrased without the narrow keywords, so phase never left "recruiting".
TRANSCRIPT_STUCK = [
    _msg("adjudicator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0042"),
    _msg("intake_coverage", "@adjudicator A fraud agent has been added to assist with potential fraud indicators."),
    _msg("adjudicator", "Received the claim details and fraud signals. Preparing to compute the fraud score.", "thought"),
    _msg("adjudicator", "Fraud score computed with a result of 0.85, which exceeds the threshold of 0.7. Initiating THE HERO recruit sequence.", "thought"),
    _msg("adjudicator", "@fraud_agent, the fraud score for claim CLM-2026-0042 is 0.85, which is above the threshold. Please proceed with a detailed investigation."),
    _msg("fraud_agent", "@adjudicator I will review the claim CLM-2026-0042 for prior claim patterns, photo metadata mismatches, and inconsistent timelines."),
    _msg("fraud_agent", "@adjudicator I found a prior claim match and a photo metadata mismatch in the claim CLM-2026-0042. This suggests a high risk of fraud."),
    _msg("adjudicator", "Fraud agent has confirmed the presence of prior claim match and photo metadata mismatch, indicating a high risk of fraud. Preparing to draft a recommendation.", "thought"),
    _msg("adjudicator", "Attempted to escalate to an adjuster, but the participant was not found. Need to verify the correct participant handle for escalation.", "error"),
]


class TestInferPhase(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(infer_phase([]), "intake")

    def test_structured_stage_wins(self):
        msgs = [{"content": "x", "metadata": {"stage": "fraud_verdict"}}]
        self.assertEqual(infer_phase(msgs), "investigating")

    def test_specialist_verdict_stage_is_investigating(self):
        # The domain-neutral structured stage that all specialists now emit.
        msgs = [{"content": "x", "metadata": {"stage": "specialist_verdict"}}]
        self.assertEqual(infer_phase(msgs), "investigating")

    def test_structured_stage_trusted_even_with_plain_prose(self):
        # The rail: a recruited specialist emits a STRUCTURED specialist_verdict.
        # Its prose carries none of the fraud keywords, yet the phase must still
        # advance — proving non-fraud claims no longer silently freeze.
        msgs = [
            _msg("adjudicator", "@Intake New property claim filed. claim_id CLM-2026-0099"),
            {"sender_name": "property_agent", "message_type": "task",
             "content": "Assessment complete for CLM-2026-0099.",
             "metadata": {"stage": "specialist_verdict", "risk": "low"}},
        ]
        self.assertEqual(infer_phase(msgs), "investigating")

    def test_signed_detected_from_signoff(self):
        msgs = TRANSCRIPT_STUCK + [
            _msg("adjudicator", "Human adjuster decision: APPROVE [signed]", "task"),
        ]
        self.assertEqual(infer_phase(msgs), "signed")

    def test_lucky_transcript_reaches_escalated(self):
        # The fraud verdict + a drafted recommendation => at least escalated.
        self.assertEqual(infer_phase(TRANSCRIPT_LUCKY), "escalated")

    def test_stuck_transcript_reaches_escalated(self):
        # THE regression: a real run whose verdict/escalation used different
        # wording must still advance past "recruiting" to "escalated".
        phase = infer_phase(TRANSCRIPT_STUCK)
        self.assertEqual(
            phase,
            "escalated",
            f"expected 'escalated' once a verdict is in and escalation is attempted, got {phase!r}",
        )

    def test_recruiting_before_verdict(self):
        # Up to and including recruiting, but before any verdict, stays recruiting.
        partial = TRANSCRIPT_STUCK[:5]  # through "please proceed with investigation"
        self.assertEqual(infer_phase(partial), "recruiting")

    def test_nonfraud_specialist_content_fallback_advances(self):
        # A property specialist whose verdict was posted as free-form text (no
        # structured stage). The domain-neutral, specialist-sender-gated fallback
        # must still advance past recruiting — the old "fraud"-gated matcher would
        # have frozen here. This is the core anti-freeze regression for Phase 1.
        transcript = [
            _msg("adjudicator", "@Intake New property claim filed. claim_id CLM-2026-0099"),
            _msg("intake_coverage", "@adjudicator Coverage confirmed: peril is covered, policy in force."),
            _msg("adjudicator", "@property_agent please proceed with a detailed investigation of the water damage."),
            _msg("property_agent", "@adjudicator I found inconsistent moisture readings; I recommend DENY on CLM-2026-0099."),
            _msg("adjudicator", "Final recommendation drafted. @adjuster please review and proceed.", "thought"),
        ]
        phase = infer_phase(transcript)
        self.assertEqual(
            phase, "escalated",
            f"non-fraud specialist verdict must advance past recruiting, got {phase!r}",
        )

    def test_medical_specialist_verdict_not_frozen(self):
        # Same guarantee for a medical specialist with its own vocabulary.
        transcript = [
            _msg("adjudicator", "@Intake New medical claim filed. claim_id CLM-2026-0123"),
            _msg("medical_agent", "@adjudicator Investigation report: treatment is consistent with the injury; risk level low."),
        ]
        self.assertEqual(infer_phase(transcript), "investigating")

    def test_clean_claim_no_recruit_stays_coverage(self):
        # The "clean" preset: coverage confirmed, score below threshold, NOBODY
        # recruited. Must rest at coverage (or escalate once the adjudicator
        # drafts a recommendation) — never invent an investigation phase.
        transcript = [
            _msg("adjudicator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0200"),
            _msg("intake_coverage", "@adjudicator Coverage findings: collision in force, claim within limits."),
        ]
        self.assertEqual(infer_phase(transcript), "coverage")

    def test_seeded_claim_json_does_not_false_advance(self):
        # The kickoff message embeds the claim JSON (prior_claim_match,
        # photo_metadata_mismatch, fraud_signals). Posted by the adjudicator and
        # echoed by intake, it must NOT trip fraud_verdict/escalation — only the
        # fraud agent's own findings should. Otherwise the console would jump to
        # "awaiting decision" the instant a claim is filed.
        claim_json = (
            '@Intake New auto-insurance claim filed.\n\n```json\n'
            '{"claim_id":"CLM-2026-0042","prior_claim_match":true,'
            '"photo_metadata_mismatch":true,"fraud_signals":'
            '{"prior_claim_match":{"note":"same VIN"},'
            '"photo_metadata_mismatch":{"note":"EXIF predates incident"}}}\n```'
        )
        self.assertEqual(infer_phase([_msg("adjudicator", claim_json)]), "intake")
        self.assertEqual(infer_phase([_msg("intake_coverage", claim_json)]), "intake")

    def test_new_names_reach_escalation(self):
        # Case Coordinator escalates to @Human Reviewer using the NEW names.
        msgs = [
            _msg("case_coordinator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0042"),
            _msg("intake_coverage", "@case_coordinator Coverage confirmed: peril covered, policy in force."),
            _msg("fraud_agent", "@case_coordinator Investigation report: I found high risk; recommend DENY on CLM-2026-0042."),
            # Final message escalates ONLY via the is_adjud (coordinat) sender gate
            # + the @human reviewer mention — no sender-independent phrase — so this
            # test genuinely gates Edit 1 and Edit 3.
            _msg("case_coordinator", "@Human Reviewer please proceed.", "thought"),
        ]
        self.assertEqual(infer_phase(msgs), "escalated")

    def test_legacy_names_still_reach_escalation(self):
        # Accept-both: the OLD names must still resolve (Band not yet renamed).
        msgs = [
            _msg("adjudicator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0042"),
            _msg("intake_coverage", "@adjudicator Coverage confirmed: peril covered, policy in force."),
            _msg("fraud_agent", "@adjudicator Investigation report: high risk; recommend DENY on CLM-2026-0042."),
            # Legacy path: is_adjud (adjud) sender gate + @adjuster mention, no
            # sender-independent phrase — gates the accept-both legacy substrings.
            _msg("adjudicator", "@adjuster please proceed.", "thought"),
        ]
        self.assertEqual(infer_phase(msgs), "escalated")

    def test_recruit_false_direct_recommendation_reaches_escalated(self):
        # THE regression from the property/bed-bug verification run: score below
        # threshold, NOBODY recruited, and the Coordinator posts its recommendation
        # to the human BY REAL NAME ("@Sahil Sharma … I recommend proceeding with
        # the claim") — without the literal words "escalate" or "@human reviewer"
        # and without an approve/deny keyword. The claim must still advance to
        # "escalated" so it reaches the human sign-off screen instead of hanging at
        # the prior phase. Gates the recruit-FALSE fallback (recommend+proceed /
        # "direct decision").
        msgs = [
            _msg("case_coordinator", "@Intake New insurance claim filed. claim_id CLM-2026-2035"),
            _msg("intake_coverage", "@case_coordinator Coverage excluded: pest infestation is not a covered peril."),
            {"sender_name": "Evidence Analyst", "message_type": "task",
             "content": "Evidence analysis complete: signals=['severity_gap']; 3 photo(s)",
             "metadata": {"stage": "evidence_analysis", "result": {"signals": ["severity_gap"], "suggested_domain": "property"}}},
            _msg("Case Coordinator", "The review score is 0.45, below the threshold. I will proceed to make a direct decision.", "thought"),
            _msg("Case Coordinator", "@Sahil Sharma The claim has been reviewed and scored. I recommend proceeding with the claim as it stands without further specialist intervention."),
        ]
        phase = infer_phase(msgs)
        self.assertEqual(
            phase, "escalated",
            f"a recruit-FALSE direct recommendation to the human (by real name) must reach 'escalated', got {phase!r}",
        )

    def test_recommend_recruiting_does_not_false_escalate(self):
        # Guard the gate added above: a mid-flow "recommend recruiting" / score
        # thought must NOT be read as an escalation. A recruit-TRUE claim that has
        # only reached the recruiting message must stay at "recruiting", not jump to
        # "escalated" (which would skip the specialist verdict).
        msgs = [
            _msg("case_coordinator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0042"),
            _msg("intake_coverage", "@case_coordinator Coverage confirmed: collision in force."),
            _msg("case_coordinator", "Score 0.85 exceeds threshold; I recommend recruiting a specialist.", "thought"),
            _msg("case_coordinator", "@fraud_agent please proceed with a detailed investigation of the claim."),
        ]
        phase = infer_phase(msgs)
        self.assertEqual(
            phase, "recruiting",
            f"a recruit-TRUE claim awaiting the specialist verdict must stay 'recruiting', got {phase!r}",
        )

    def test_verdict_with_recommendation_auto_escalates(self):
        # THE stuck-at-investigate regression (live property run): the specialist
        # emitted a structured specialist_verdict with recommendation="approve", but
        # the Case Coordinator never relayed it (no escalation event). Once a concrete
        # approve/deny verdict is in, the human's turn has arrived — the claim must
        # advance to 'escalated' so the stepper reaches Sign-off and the timer freezes,
        # rather than hanging at 'investigating' forever.
        msgs = [
            _msg("case_coordinator", "@Intake New property claim filed. claim_id CLM-2026-0099"),
            _msg("intake_coverage", "@case_coordinator Coverage confirmed: peril covered, policy in force."),
            _msg("case_coordinator", "@property_agent please proceed with the assessment."),
            {"sender_name": "Property Agent", "message_type": "task",
             "content": "Assessment complete: the loss is consistent with a covered sudden-loss event.",
             "metadata": {"stage": "specialist_verdict", "specialty": "property",
                          "risk": "high", "recommendation": "approve"}},
        ]
        phase = infer_phase(msgs)
        self.assertEqual(
            phase, "escalated",
            f"a specialist_verdict with a concrete recommendation must auto-escalate, got {phase!r}",
        )

    def test_conflict_with_recommended_verdict_still_escalates(self):
        # THE conflict-deadlock regression (live property run): the Coordinator's
        # cross_check raised a "conflict" and re-mentioned the specialist to
        # reconcile — but the specialist is single-shot (SPECIALIST_DISCIPLINE says
        # "post EXACTLY ONCE, then STOP"), so it never replies and the claim hangs in
        # 'conflict' forever. Since a concrete approve/deny verdict already exists, the
        # human must still receive it (the prompt: "even on conflict you still relay
        # the specialist's final recommendation"). So a recommended verdict escalates
        # even under conflict — the conflict is flagged to the human, not a dead end.
        msgs = [
            _msg("case_coordinator", "@Intake New property claim filed. claim_id CLM-2026-0099"),
            {"sender_name": "Property Agent", "message_type": "task",
             "content": "Assessment complete.",
             "metadata": {"stage": "specialist_verdict", "specialty": "property",
                          "risk": "high", "recommendation": "approve"}},
            {"sender_name": "Case Coordinator", "message_type": "task",
             "content": "Cross-check found a contradiction with the evidence.",
             "metadata": {"stage": "conflict"}},
        ]
        self.assertEqual(infer_phase(msgs), "escalated")

    def test_conflict_without_recommended_verdict_stays_conflict(self):
        # Guard: a conflict with NO concrete approve/deny verdict yet (e.g. the
        # cross_check fired on a verdict carrying only a risk level) has nothing to
        # relay, so it must rest at 'conflict' until a recommendation exists.
        msgs = [
            _msg("case_coordinator", "@Intake New property claim filed. claim_id CLM-2026-0099"),
            {"sender_name": "Property Agent", "message_type": "task",
             "content": "Assessment in progress.",
             "metadata": {"stage": "specialist_verdict", "risk": "high"}},
            {"sender_name": "Case Coordinator", "message_type": "task",
             "content": "Cross-check found a contradiction.",
             "metadata": {"stage": "conflict"}},
        ]
        self.assertEqual(infer_phase(msgs), "conflict")

    def test_verdict_without_recommendation_stays_investigating(self):
        # The auto-escalate rule keys on a CONCRETE approve/deny recommendation. A
        # verdict carrying only a risk level (no recommendation) must still rest at
        # 'investigating' — it is not yet the human's turn.
        msgs = [
            _msg("case_coordinator", "@Intake New property claim filed. claim_id CLM-2026-0099"),
            {"sender_name": "Property Agent", "message_type": "task",
             "content": "Assessment in progress.",
             "metadata": {"stage": "specialist_verdict", "risk": "low"}},
        ]
        self.assertEqual(infer_phase(msgs), "investigating")

    def test_coordinator_high_risk_prose_not_misread_as_verdict(self):
        # The Case Coordinator routinely says "high risk" / "I found" when
        # explaining the score. Edit 2 puts "coordinat" in is_meridian so the
        # coordinator's OWN prose is not misclassified as a specialist verdict —
        # which would wrongly jump the phase to "investigating" before any
        # specialist has actually reported. Gates Edit 2.
        msgs = [
            _msg("case_coordinator", "@Intake New auto-insurance claim filed. claim_id CLM-2026-0042"),
            _msg("intake_coverage", "@case_coordinator Coverage confirmed: peril covered, policy in force."),
            _msg("case_coordinator", "Fraud score computed: 0.85, indicating high risk. I found the prior-claim match concerning.", "thought"),
        ]
        # Only the intake message contributes a signal (coverage); the coordinator's
        # high-risk prose must contribute NOTHING. If Edit 2 regresses, that prose
        # trips specialist_verdict and this lands on "investigating" instead.
        self.assertEqual(infer_phase(msgs), "coverage")


if __name__ == "__main__":
    unittest.main()
