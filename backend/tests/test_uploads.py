"""Tests for the custom-claim upload path (no-database attachment storage)."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.evidence import preset_attachment_resolver, upload_attachment_resolver  # noqa: E402
from seed.run_demo import build_claim  # noqa: E402

BASE_INPUT = {
    "claim_id": "CLM-X",
    "incident_date": "2026-01-01",
    "reported_date": "2026-01-02",
    "claimant": {"name": "A"},
    "damage": {"description": "d"},
    "loss_amount": 100,
    "narrative": "n",
}


class TestBuildClaimUploads(unittest.TestCase):
    def test_uses_uploaded_attachment_names(self):
        claim = build_claim(
            {**BASE_INPUT, "uploaded_photos": ["my_front.jpg", "my_rear.png"],
             "uploaded_document": "my_report.pdf"}
        )
        self.assertEqual(claim["damage"]["photos"], ["my_front.jpg", "my_rear.png"])
        self.assertEqual(claim["supporting_document"], "my_report.pdf")

    def test_falls_back_to_golden_names_without_uploads(self):
        claim = build_claim(BASE_INPUT)
        self.assertEqual(
            claim["damage"]["photos"], ["damage_front.jpg", "damage_rear.jpg", "damage_detail.jpg"]
        )
        self.assertEqual(claim["supporting_document"], "police_report.pdf")


class TestUploadResolver(unittest.TestCase):
    def test_prefers_upload_then_falls_back(self):
        with tempfile.TemporaryDirectory() as d:
            up = Path(d) / "up"; up.mkdir()
            gold = Path(d) / "gold"; gold.mkdir()
            (up / "x.jpg").write_bytes(b"UP")
            (gold / "g.jpg").write_bytes(b"GOLD")
            resolve = upload_attachment_resolver(up, preset_attachment_resolver(gold))
            self.assertEqual(resolve("x.jpg"), b"UP")     # upload wins
            self.assertEqual(resolve("g.jpg"), b"GOLD")    # fallback to golden
            self.assertIsNone(resolve("missing.jpg"))

    def test_path_traversal_is_contained(self):
        with tempfile.TemporaryDirectory() as d:
            up = Path(d) / "up"; up.mkdir()
            secret = Path(d) / "secret.txt"; secret.write_bytes(b"SECRET")
            resolve = upload_attachment_resolver(up, lambda _n: None)
            # basename-only: "../secret.txt" becomes "secret.txt" inside up/, which
            # does not exist — the real sibling file is never reachable.
            self.assertIsNone(resolve("../secret.txt"))


if __name__ == "__main__":
    unittest.main()
