"""Tests for the evidence media endpoint (serves images + PDF page-1 previews)."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from gateway.main import app  # noqa: E402

client = TestClient(app)

# Golden assets that ship in the repo (resolver falls back to these when a chat has
# no uploads), so the endpoint is testable with no Band room.
GOLDEN_IMG = "damage_front.jpg"
GOLDEN_PDF = "police_report.pdf"


class TestEvidenceEndpoint(unittest.TestCase):
    def test_serves_golden_image(self):
        r = client.get(f"/api/evidence/anychat/{GOLDEN_IMG}")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.headers["content-type"].startswith("image/"))
        self.assertGreater(len(r.content), 100)

    def test_pdf_preview_returns_png(self):
        r = client.get(f"/api/evidence/anychat/{GOLDEN_PDF}", params={"preview": 1})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "image/png")
        self.assertTrue(r.content.startswith(b"\x89PNG"))

    def test_pdf_without_preview_returns_raw_pdf(self):
        r = client.get(f"/api/evidence/anychat/{GOLDEN_PDF}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "application/pdf")
        self.assertTrue(r.content.startswith(b"%PDF"))

    def test_missing_file_404(self):
        r = client.get("/api/evidence/anychat/does_not_exist_12345.jpg")
        self.assertEqual(r.status_code, 404)

    def test_path_traversal_is_blocked(self):
        r = client.get("/api/evidence/anychat/..%2f..%2f..%2fetc%2fpasswd")
        self.assertIn(r.status_code, (400, 404))


if __name__ == "__main__":
    unittest.main()
