"""Tests for the branded PDF case-report builder."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway.report import _fmt_ts, build_case_report_pdf  # noqa: E402


def _msg(stage, content, result=None, sender="Case Coordinator", mtype="task"):
    return {
        "id": f"{stage}-1",
        "message_type": mtype,
        "sender_name": sender,
        "content": content,
        "inserted_at": "2026-06-15T10:00:00Z",
        "metadata": {"stage": stage, **({"result": result} if result is not None else {})},
    }


class TestBuildReport(unittest.TestCase):
    def test_returns_pdf_bytes_for_fraud_claim_with_photos(self):
        messages = [
            _msg("intake", "Claim #ARB-1 intake complete",
                 result={"claim_id": "ARB-1", "domain": "auto"}, sender="Intake"),
            _msg("coverage", "Coverage confirmed",
                 result={"covered": True, "policy": "POL-1", "deductible": 500}, sender="Intake"),
            _msg("evidence_analysis", "Evidence analyzed",
                 result={
                     "vision_model": "google/gemma-4-31B-it",
                     "observations": [{
                         "filename": "damage_front.jpg", "severity_band": "minor",
                         "consistent_with_narrative": "no", "damage_location": "front bumper",
                         "confidence": "high", "narrative_reason": "Scuff, not severe crush.",
                     }],
                     "signals": ["severity_gap", "evidence_discrepancy"],
                 }, sender="Evidence Analyst"),
            _msg("signoff", "Human Reviewer decision: DENY [signed]",
                 result={"decision": "deny", "note": "Inconsistent.", "authored_by": "human"}),
        ]
        pdf = build_case_report_pdf("chat-abc12345", messages, "2026-06-15 10:05 UTC")
        self.assertIsInstance(pdf, bytes)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(len(pdf), 1000)

    def test_medical_claim_without_photos_does_not_crash(self):
        messages = [
            _msg("intake", "Medical claim", result={"claim_id": "MED-1", "domain": "medical"}, sender="Intake"),
            _msg("evidence_analysis", "Evidence analyzed",
                 result={"vision_model": "x", "observations": [], "signals": []}, sender="Evidence Analyst"),
        ]
        pdf = build_case_report_pdf("chat-med", messages)
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_special_characters_in_narrative_do_not_break_build(self):
        messages = [
            _msg("intake", "Claim with <tags> & ampersands",
                 result={"claim_id": "X&<>", "domain": "auto"}, sender="Intake"),
        ]
        pdf = build_case_report_pdf("chat-esc", messages)
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_missing_image_file_degrades_to_text(self):
        messages = [
            _msg("evidence_analysis", "Evidence analyzed",
                 result={"vision_model": "x", "observations": [{
                     "filename": "does_not_exist_12345.jpg", "severity_band": "moderate",
                     "consistent_with_narrative": "unclear", "confidence": "low",
                 }], "signals": []}, sender="Evidence Analyst"),
        ]
        pdf = build_case_report_pdf("chat-missing", messages)
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_audit_ledger_handles_all_event_types_and_truncation(self):
        # Mix every message_type the ledger maps a verb for, plus >40 rows so the
        # truncation-note branch runs, plus a non-ISO timestamp for the _fmt_ts
        # fallback — the whole audit table must render without raising.
        kinds = ["text", "task", "thought", "tool_call", "tool_result", "error"]
        messages = [
            {
                "id": str(i),
                "message_type": kinds[i % len(kinds)],
                "sender_name": "Case Coordinator" if i % 2 else "Evidence Analyst",
                "content": f"event {i} with <markup> & symbols",
                "inserted_at": "2026-06-15T10:00:00Z" if i else "not-a-timestamp",
                "metadata": {},
            }
            for i in range(45)
        ]
        pdf = build_case_report_pdf("chat-audit", messages, "2026-06-15 10:05 UTC")
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_audit_ledger_tolerates_non_string_content(self):
        # Band content is normally a string, but the builder passes msg["content"]
        # straight through; a stray scalar/dict must not 500 the report endpoint.
        messages = [
            {"id": "a", "message_type": "text", "sender_name": "S",
             "inserted_at": "2026-06-15T10:00:00Z", "content": 5, "metadata": {}},
            {"id": "b", "message_type": "task", "sender_name": None,
             "inserted_at": "2026-06-15T10:00:01Z", "content": None, "metadata": {}},
            {"id": "c", "message_type": "thought", "sender_name": "S",
             "inserted_at": "2026-06-15T10:00:02Z", "content": {"k": "v"}, "metadata": {}},
        ]
        pdf = build_case_report_pdf("chat-scalar", messages)
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_fmt_ts_formats_iso_and_falls_back(self):
        # ISO-8601 (with trailing Z) → compact 'Mon DD · HH:MM:SS'.
        self.assertEqual(_fmt_ts("2026-06-15T10:02:48Z"), "Jun 15 · 10:02:48")
        # Empty / unparseable inputs degrade gracefully, never raise.
        self.assertEqual(_fmt_ts(""), "—")
        self.assertEqual(_fmt_ts(None), "—")
        self.assertEqual(_fmt_ts("not-a-date"), "not-a-date"[:16])


if __name__ == "__main__":
    unittest.main()
