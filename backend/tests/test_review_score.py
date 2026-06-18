import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gateway.projection import project_state  # noqa: E402


def _msg(sender, content, mtype="task", metadata=None):
    return {
        "sender_name": sender,
        "content": content,
        "message_type": mtype,
        "metadata": metadata or {},
        "inserted_at": "2026-06-16T12:00:00Z",
    }


class TestReviewScoreProjection(unittest.TestCase):
    def test_routing_score_surfaced_from_event(self):
        messages = [
            _msg(
                "Case Coordinator",
                "Computed review score",
                metadata={
                    "stage": "review_score",
                    "score": 0.85,
                    "threshold": 0.7,
                    "recruit": True,
                    "domain": "auto",
                    "present_signals": ["severity_gap", "evidence_discrepancy"],
                },
            )
        ]
        state = project_state(messages, [], chat_id="chat-x")
        self.assertIn("routing_score", state)
        rs = state["routing_score"]
        self.assertEqual(rs["score"], 0.85)
        self.assertEqual(rs["threshold"], 0.7)
        self.assertTrue(rs["recruit"])

    def test_routing_score_absent_when_no_event(self):
        state = project_state([], [], chat_id="chat-x")
        self.assertIn("routing_score", state)
        self.assertIsNone(state["routing_score"])


if __name__ == "__main__":
    unittest.main()
