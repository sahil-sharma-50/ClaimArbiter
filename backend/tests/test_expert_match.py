"""Tests for LLM-based expert matching."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.expert_match import (  # noqa: E402
    ExpertMatchDecision,
    _domain_fallback_match,
    _validate_decision,
    gather_claim_context,
    match_expert_with_llm,
)


def _msg(sender, stage, content="", **meta):
    md = {"stage": stage}
    md.update(meta)
    return {"sender_name": sender, "message_type": "task", "content": content, "metadata": md}


MEDICAL_CLAIM = {
    "claim_id": "CLM-1",
    "domain": "medical",
    "treatment": {"reported_injury": "Neck strain from rear-end collision"},
    "review_signals": ["treatment_injury_mismatch"],
}


class TestGatherClaimContext(unittest.TestCase):
    def test_builds_context_from_casefile_and_json(self):
        messages = [
            _msg("Intake Coverage", "intake", result={"claim_id": "CLM-1", "domain": "medical"}),
            _msg("Intake Coverage", "coverage", result={"covered": True, "note": "In force"}),
            _msg(
                "Evidence Analyst",
                "evidence_analysis",
                result={"signals": ["treatment_injury_mismatch"], "suggested_domain": "medical"},
            ),
            {
                "sender_name": "Intake Coverage",
                "message_type": "text",
                "content": f"Handoff ```json\n{json.dumps(MEDICAL_CLAIM)}\n```",
                "metadata": {},
            },
        ]
        ctx = gather_claim_context(messages)
        self.assertEqual(ctx["claim_id"], "CLM-1")
        self.assertEqual(ctx["suggested_domain"], "medical")
        self.assertIn("treatment_injury_mismatch", ctx["signals"])


class TestValidateDecision(unittest.TestCase):
    def test_rejects_unknown_handle(self):
        candidates = [{"handle": "@med/agent", "name": "Medical Review", "tags": ["medical-review"]}]
        raw = ExpertMatchDecision(matched=True, handle="@fake/agent", capability_tag="medical-review")
        out = _validate_decision(raw, candidates)
        self.assertFalse(out.matched)

    def test_accepts_known_handle(self):
        candidates = [{"handle": "@med/agent", "name": "Medical Review", "tags": ["medical-review"]}]
        raw = ExpertMatchDecision(matched=True, handle="@med/agent", capability_tag="medical-review", rationale="fit")
        out = _validate_decision(raw, candidates)
        self.assertTrue(out.matched)
        self.assertEqual(out.handle, "@med/agent")


class TestDomainFallback(unittest.TestCase):
    def test_matches_medical_peer_by_tag(self):
        ctx = {"suggested_domain": "medical", "signals": []}
        peers = [{"handle": "@m/agent", "name": "Medical Review", "tags": ["medical-review"]}]
        out = _domain_fallback_match(ctx, peers)
        self.assertTrue(out.matched)
        self.assertEqual(out.capability_tag, "medical-review")

    def test_no_domain_returns_no_match(self):
        ctx = {"suggested_domain": None, "domain": "unknown", "signals": []}
        peers = [{"handle": "@m/agent", "name": "Medical Review", "tags": ["medical-review"]}]
        out = _domain_fallback_match(ctx, peers)
        self.assertFalse(out.matched)


class TestMatchExpertWithLlm(unittest.TestCase):
    def test_llm_match_selects_peer(self):
        ctx = {"suggested_domain": "medical", "narrative": "Neck injury billing review"}
        candidates = [
            {"handle": "@p/agent", "name": "Property Assessment", "tags": ["property-damage"]},
            {"handle": "@m/agent", "name": "Medical Review", "tags": ["medical-review"]},
        ]
        llm_response = mock.Mock()
        llm_response.content = json.dumps(
            {
                "matched": True,
                "handle": "@m/agent",
                "capability_tag": "medical-review",
                "rationale": "Medical injury claim.",
            }
        )
        with mock.patch("agents.shared.expert_match.aiml_llm") as aiml:
            aiml.return_value.invoke.return_value = llm_response
            out = match_expert_with_llm(ctx, candidates)
        self.assertTrue(out.matched)
        self.assertEqual(out.handle, "@m/agent")

    def test_empty_directory(self):
        out = match_expert_with_llm({"narrative": "test"}, [])
        self.assertFalse(out.matched)


if __name__ == "__main__":
    unittest.main()
