"""BUG 8 regression: the human sign-off records ACCURATE provenance.

The /me/* human API is Enterprise-gated, so clicking Approve usually falls back to
writing the decision as the Case Coordinator AGENT. That fallback must be HONEST:
the signoff event metadata and the /api/approve response must carry
`authored_by: "agent_on_behalf_of_human"` when an agent recorded it, and
`authored_by: "human"` only when a real human user key actually posted via /me/*.
`_human_decision` (read by the dashboard from /api/state) must surface the same.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gateway import main as gw  # noqa: E402
from gateway.projection import _human_decision  # noqa: E402


class _RecordingAgentClient:
    """BandClient stand-in capturing the signoff event metadata."""

    last_event_metadata: dict | None = None

    def __init__(self, key):
        self.key = key

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        type(self).last_event_metadata = metadata
        return {"id": "evt", "metadata": metadata}


class _WorkingUserClient:
    """UserBandClient stand-in whose /me/* post succeeds (Enterprise plan)."""

    posted: list[str] = []

    def __init__(self, key):
        self.key = key

    async def send_message(self, chat_id, content):
        type(self).posted.append(content)
        return {"id": "msg"}


class _Forbidden403UserClient:
    """UserBandClient stand-in whose /me/* post 403s (typical non-Enterprise)."""

    def __init__(self, key):
        self.key = key

    async def send_message(self, chat_id, content):
        raise RuntimeError("403 Forbidden /me/chats/.../messages")


class _Failing422AgentClient:
    """BandClient stand-in whose agent /events post 422s (e.g. a stale/dead room).

    Mirrors the live crash: the user /me/* post 403s, the code falls back to the
    Coordinator agent recording the signoff event, and THAT 422s because the chat
    id no longer accepts events. The endpoint must surface a clean error, not 500.
    """

    def __init__(self, key):
        self.key = key

    async def send_event(self, chat_id, content, *, message_type="task", metadata=None):
        raise RuntimeError("422 Unprocessable Entity /agent/chats/.../events")


def _approve(body_decision="approve", note="", header_key=None, env_key=None):
    body = gw.ApprovalBody(decision=body_decision, note=note)
    env = {}
    if env_key is not None:
        env["HUMAN_REVIEWER_USER_API_KEY"] = env_key
    else:
        env["HUMAN_REVIEWER_USER_API_KEY"] = ""  # ensure unset
    with mock.patch.dict(os.environ, env), \
         mock.patch.object(gw, "get_agent_credentials", lambda a: ("id", "agent-key")), \
         mock.patch.object(gw, "read_active_chat_id", lambda: "chat-x"):
        return asyncio.run(
            gw.post_approve(body, chat_id="chat-x", x_human_reviewer_api_key=header_key)
        )


class TestSignoffProvenance(unittest.TestCase):
    def setUp(self):
        _RecordingAgentClient.last_event_metadata = None
        _WorkingUserClient.posted = []

    def test_agent_fallback_marks_authored_by_agent(self):
        # No user key at all → agent records the signoff → provenance must say so.
        with mock.patch.object(gw, "BandClient", _RecordingAgentClient):
            resp = _approve()
        self.assertEqual(resp["decision"], "approve")
        self.assertEqual(resp["authored_by"], "agent_on_behalf_of_human")
        meta = _RecordingAgentClient.last_event_metadata
        self.assertIsNotNone(meta)
        self.assertEqual(meta["stage"], "signoff")
        self.assertEqual(meta["authored_by"], "agent_on_behalf_of_human")

    def test_user_key_403_falls_back_to_agent_provenance(self):
        # A user key is present but the /me/* post 403s → graceful fallback to agent,
        # and provenance must NOT claim a human posted.
        with mock.patch.object(gw, "BandClient", _RecordingAgentClient), \
             mock.patch.object(gw, "UserBandClient", _Forbidden403UserClient):
            resp = _approve(env_key="user-key-that-403s")
        self.assertEqual(resp["authored_by"], "agent_on_behalf_of_human")
        self.assertEqual(
            _RecordingAgentClient.last_event_metadata["authored_by"],
            "agent_on_behalf_of_human",
        )

    def test_working_user_key_marks_authored_by_human(self):
        # A real human user key that posts successfully → authored_by "human", and
        # NO agent fallback event is written.
        with mock.patch.object(gw, "BandClient", _RecordingAgentClient), \
             mock.patch.object(gw, "UserBandClient", _WorkingUserClient):
            resp = _approve(header_key="real-human-key", note="looks good")
        self.assertEqual(resp["authored_by"], "human")
        self.assertEqual(len(_WorkingUserClient.posted), 1)
        self.assertIn("[signed]", _WorkingUserClient.posted[0])
        # Agent fallback must not have fired.
        self.assertIsNone(_RecordingAgentClient.last_event_metadata)

    def test_agent_fallback_event_failure_returns_clean_error(self):
        # The agent-fallback signoff event 422s (stale/dead room). The endpoint must
        # raise a clean HTTPException (502), not let the error escape as a 500.
        from fastapi import HTTPException

        with mock.patch.object(gw, "BandClient", _Failing422AgentClient):
            with self.assertRaises(HTTPException) as ctx:
                _approve()
        self.assertEqual(ctx.exception.status_code, 502)

    def test_deny_flows_through_with_provenance(self):
        with mock.patch.object(gw, "BandClient", _RecordingAgentClient):
            resp = _approve(body_decision="deny", note="insufficient evidence")
        self.assertEqual(resp["decision"], "deny")
        self.assertEqual(resp["authored_by"], "agent_on_behalf_of_human")
        self.assertEqual(_RecordingAgentClient.last_event_metadata["decision"], "deny")


class TestHumanDecisionProvenance(unittest.TestCase):
    def test_agent_authored_metadata_surfaces_provenance(self):
        msgs = [
            {
                "content": "Human Reviewer decision: APPROVE [signed]",
                "message_type": "task",
                "metadata": {
                    "stage": "signoff",
                    "decision": "approve",
                    "note": "ok",
                    "authored_by": "agent_on_behalf_of_human",
                },
            }
        ]
        d = _human_decision(msgs)
        self.assertEqual(d["decision"], "approve")
        self.assertEqual(d["authored_by"], "agent_on_behalf_of_human")
        self.assertEqual(d["note"], "ok")

    def test_legacy_metadata_without_provenance_defaults_to_agent(self):
        # Older signoff events have no authored_by; the safe default is the agent
        # path (we never silently claim a human posted).
        msgs = [{"content": "x", "metadata": {"decision": "deny"}}]
        d = _human_decision(msgs)
        self.assertEqual(d["decision"], "deny")
        self.assertEqual(d["authored_by"], "agent_on_behalf_of_human")

    def test_human_posted_text_message_attributed_to_human(self):
        # The real-human path posts a plain "[signed]" text message with no decision
        # metadata; it must be attributed to the human.
        msgs = [
            {
                "content": "@Case Coordinator Human Reviewer decision: APPROVE [signed]",
                "message_type": "text",
                "metadata": {},
            }
        ]
        d = _human_decision(msgs)
        self.assertEqual(d["decision"], "approve")
        self.assertEqual(d["authored_by"], "human")


if __name__ == "__main__":
    unittest.main()
