"""Tests for the tamper-evident audit seal.

The seal is a pure function of the Band room transcript: the gateway stores
nothing authoritative, so recomputing the seal from a fresh Band fetch must
reproduce the value printed on the PDF. These tests pin that contract.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.audit_seal import compute_seal, verify_seal  # noqa: E402


def _msg(mid, content, stage=None, sender="Case Coordinator", mtype="task",
         ts="2026-06-15T10:00:00Z"):
    md = {"stage": stage} if stage else {}
    return {
        "id": mid,
        "message_type": mtype,
        "sender_name": sender,
        "content": content,
        "inserted_at": ts,
        "metadata": md,
    }


def _claim():
    return [
        _msg("m1", "Claim #ARB-1 intake complete", stage="intake", sender="Intake"),
        _msg("m2", "Coverage confirmed", stage="coverage", sender="Intake"),
        _msg("m3", "Evidence analyzed", stage="evidence_analysis", sender="Evidence Analyst"),
        _msg("m4", "DENY [signed]", stage="signoff"),
    ]


class TestComputeSeal(unittest.TestCase):
    def test_returns_sha256_prefixed_hex(self):
        seal = compute_seal(_claim())
        self.assertTrue(seal.startswith("sha256:"))
        self.assertEqual(len(seal), len("sha256:") + 64)  # 64 hex chars
        int(seal.split(":", 1)[1], 16)  # parses as hex (raises if not)

    def test_deterministic_same_input_same_seal(self):
        self.assertEqual(compute_seal(_claim()), compute_seal(_claim()))

    def test_stable_regardless_of_fetch_order(self):
        """Union of agent views may return messages in different order / with dupes.

        The seal canonicalizes (dedupe by id, deterministic order), so a shuffled,
        duplicated fetch produces the SAME seal — this is what lets a fresh Band
        pull verify the value baked into the PDF.
        """
        base = _claim()
        shuffled = [base[2], base[0], base[3], base[1], base[0]]  # reordered + dupe
        self.assertEqual(compute_seal(base), compute_seal(shuffled))

    def test_tamper_changing_content_changes_seal(self):
        base = _claim()
        tampered = _claim()
        tampered[3]["content"] = "APPROVE [signed]"  # flip the verdict
        self.assertNotEqual(compute_seal(base), compute_seal(tampered))

    def test_tamper_changing_stage_changes_seal(self):
        base = _claim()
        tampered = _claim()
        tampered[1]["metadata"]["stage"] = "tampered"
        self.assertNotEqual(compute_seal(base), compute_seal(tampered))

    def test_removing_a_message_changes_seal(self):
        base = _claim()
        fewer = base[:-1]
        self.assertNotEqual(compute_seal(base), compute_seal(fewer))

    def test_empty_transcript_still_seals(self):
        seal = compute_seal([])
        self.assertTrue(seal.startswith("sha256:"))


class TestVerifySeal(unittest.TestCase):
    def test_match_true_for_recomputed_seal(self):
        msgs = _claim()
        seal = compute_seal(msgs)
        result = verify_seal(msgs, seal)
        self.assertTrue(result["match"])
        self.assertEqual(result["seal"], seal)
        self.assertEqual(result["message_count"], 4)

    def test_match_false_when_transcript_tampered(self):
        seal = compute_seal(_claim())
        tampered = _claim()
        tampered[3]["content"] = "APPROVE [signed]"
        result = verify_seal(tampered, seal)
        self.assertFalse(result["match"])
        self.assertNotEqual(result["seal"], seal)

    def test_match_false_against_wrong_seal(self):
        result = verify_seal(_claim(), "sha256:deadbeef")
        self.assertFalse(result["match"])


if __name__ == "__main__":
    unittest.main()
