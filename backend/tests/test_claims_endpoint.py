import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient  # noqa: E402
from gateway import main as gateway_main  # noqa: E402
from gateway.main import _ai_recommendation, app  # noqa: E402

client = TestClient(app)


class TestClaimsEndpoint(unittest.TestCase):
    def test_claims_endpoint_returns_list(self):
        r = client.get("/api/claims")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_claim_summary_shape(self):
        r = client.get("/api/claims")
        for item in r.json():
            self.assertIn("chat_id", item)
            self.assertIn("phase", item)


class TestAiRecommendation(unittest.TestCase):
    def test_reads_escalation_result(self):
        casefile = [
            {"stage": "coverage", "result": {"covered": True}},
            {"stage": "escalation", "result": {"recommendation": "deny", "rationale": "x"}},
        ]
        self.assertEqual(_ai_recommendation(casefile), "deny")

    def test_normalizes_case_and_ignores_other_stages(self):
        self.assertEqual(
            _ai_recommendation([{"stage": "escalation", "result": {"recommendation": "APPROVE"}}]),
            "approve",
        )

    def test_none_when_no_escalation(self):
        self.assertIsNone(_ai_recommendation([{"stage": "intake", "result": {}}]))

    def test_none_for_unknown_recommendation_value(self):
        self.assertIsNone(
            _ai_recommendation([{"stage": "escalation", "result": {"recommendation": "maybe"}}])
        )


class TestEnrichedClaimSummary(unittest.TestCase):
    """The enriched summary carries the four analytics fields, derived from the
    per-claim state list_claims already fetches."""

    def test_summary_includes_analytics_fields(self):
        fake_state = {
            "phase": "signed",
            "specialist": {"org": "Legal Group", "type": "legal", "risk": "high"},
            "participants": [{"name": "Case Coordinator"}, {"name": "Legal Review"}],
            "decision": {"decision": "approve"},
            "casefile": [{"stage": "escalation", "result": {"recommendation": "deny"}}],
            "band_url": "https://app.band.ai/chat/abc",
        }

        async def fake_fetch_state(cid, *, use_cache=True):
            return fake_state

        with mock.patch.object(gateway_main, "read_active_chat_id", return_value="abc"), \
                mock.patch.object(gateway_main, "_fetch_state", side_effect=fake_fetch_state):
            r = client.get("/api/claims")

        self.assertEqual(r.status_code, 200)
        body = r.json()
        # Select our mocked claim by chat_id: the module-global _room_messages cache
        # can leak rooms from earlier tests in the same process, so don't assume the
        # list has exactly one entry (pre-existing shared-state pollution).
        item = next(c for c in body if c["chat_id"] == "abc")
        self.assertEqual(item["specialist"], "Legal Group")
        self.assertEqual(item["specialist_type"], "legal")
        self.assertEqual(item["risk"], "high")
        self.assertEqual(item["recommendation"], "deny")
        self.assertEqual(item["decision"], "approve")

    def test_clean_claim_has_null_specialist_fields(self):
        fake_state = {
            "phase": "signed",
            "specialist": None,
            "participants": [{"name": "Case Coordinator"}],
            "decision": {"decision": "approve"},
            "casefile": [],
            "band_url": "https://app.band.ai/chat/def",
        }

        async def fake_fetch_state(cid, *, use_cache=True):
            return fake_state

        with mock.patch.object(gateway_main, "read_active_chat_id", return_value="def"), \
                mock.patch.object(gateway_main, "_fetch_state", side_effect=fake_fetch_state):
            body = client.get("/api/claims").json()
            item = next(c for c in body if c["chat_id"] == "def")

        self.assertIsNone(item["specialist"])
        self.assertIsNone(item["specialist_type"])
        self.assertIsNone(item["risk"])
        self.assertIsNone(item["recommendation"])
        self.assertEqual(item["decision"], "approve")


class TestArchivedClaimExcluded(unittest.TestCase):
    """A soft-deleted claim must not reappear in the active console after a refresh.

    Band has no delete-room API, so a re-poll rehydrates an archived room's in-memory
    store; the durable archive marker (state.archived) is what keeps it out of
    /api/claims. Regression for "removed claim comes back on refresh".
    """

    def test_archived_claim_is_omitted(self):
        fake_state = {
            "phase": "signed",
            "archived": True,
            "specialist": None,
            "participants": [{"name": "Case Coordinator"}],
            "decision": None,
            "casefile": [],
            "band_url": "https://app.band.ai/chat/gone",
        }

        async def fake_fetch_state(cid, *, use_cache=True):
            return fake_state

        with mock.patch.object(gateway_main, "read_active_chat_id", return_value="gone"), \
                mock.patch.object(gateway_main, "_fetch_state", side_effect=fake_fetch_state):
            body = client.get("/api/claims").json()

        self.assertFalse(any(c["chat_id"] == "gone" for c in body))


if __name__ == "__main__":
    unittest.main()
