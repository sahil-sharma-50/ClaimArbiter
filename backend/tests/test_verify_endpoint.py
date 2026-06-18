"""Tests for GET /api/claims/{chat_id}/verify.

The endpoint recomputes the audit seal from a *live* Band fetch and reports
whether it matches a seal the caller already holds (from the PDF). This is the
"delete the gateway, the seal still verifies from Band" demo beat.
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient  # noqa: E402
from gateway import main as gateway_main  # noqa: E402
from gateway.audit_seal import compute_seal  # noqa: E402
from gateway.main import app  # noqa: E402

client = TestClient(app)


def _msgs():
    return [
        {"id": "m1", "message_type": "task", "sender_name": "Intake",
         "inserted_at": "2026-06-15T10:00:00Z", "content": "intake",
         "metadata": {"stage": "intake"}},
        {"id": "m2", "message_type": "task", "sender_name": "Case Coordinator",
         "inserted_at": "2026-06-15T10:01:00Z", "content": "DENY [signed]",
         "metadata": {"stage": "signoff"}},
    ]


class TestVerifyEndpoint(unittest.TestCase):
    def test_returns_seal_and_count(self):
        async def fake_union(cid):
            return _msgs()

        with mock.patch.object(gateway_main, "_union_room_messages", side_effect=fake_union):
            r = client.get("/api/claims/chat-1/verify")

        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["seal"], compute_seal(_msgs()))
        self.assertEqual(body["message_count"], 2)
        # With no ?seal= supplied, there's nothing to match against.
        self.assertIsNone(body["match"])

    def test_match_true_when_seal_param_correct(self):
        seal = compute_seal(_msgs())

        async def fake_union(cid):
            return _msgs()

        with mock.patch.object(gateway_main, "_union_room_messages", side_effect=fake_union):
            r = client.get(f"/api/claims/chat-1/verify?seal={seal}")

        self.assertTrue(r.json()["match"])

    def test_match_false_when_seal_param_wrong(self):
        async def fake_union(cid):
            return _msgs()

        with mock.patch.object(gateway_main, "_union_room_messages", side_effect=fake_union):
            r = client.get("/api/claims/chat-1/verify?seal=sha256:deadbeef")

        self.assertFalse(r.json()["match"])

    def test_404_when_room_empty(self):
        async def fake_union(cid):
            return []

        with mock.patch.object(gateway_main, "_union_room_messages", side_effect=fake_union):
            r = client.get("/api/claims/missing/verify")

        self.assertEqual(r.status_code, 404)


if __name__ == "__main__":
    unittest.main()
