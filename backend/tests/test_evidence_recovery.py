"""Tests for the Evidence Analyst's claim recovery and attachment preference.

The live BUG 1: a premature @mention triggered the Evidence Analyst early, its LLM
then called run_evidence_analysis with a FABRICATED arg (wrong shape, no
damage.photos, invented filenames), so the real uploaded photos/PDF were never
analyzed. The fix makes the analyst ALWAYS cross-check against the room and prefer a
recovered claim that HAS attachments — the room is the system of record for the real
files the gateway wrote to disk. _has_attachments is the signal; _recover_claim_from_room
ranks candidates; run_evidence_analysis wires the preference.
"""

from __future__ import annotations

import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.insurer import evidence_analyst as ea  # noqa: E402
from agents.insurer.evidence_analyst import _has_attachments  # noqa: E402

# The real, authoritative claim (the shape the kickoff + Intake handoff embed).
REAL_CLAIM = {
    "claim_id": "CLM-2026-0042",
    "domain": "auto",
    "narrative": "High-speed rear-end collision; extensive rear crush.",
    "damage": {"photos": ["damage_front.jpg", "damage_rear.jpg", "damage_detail.jpg"]},
    "supporting_document": "police_report.pdf",
}

# The fabricated arg the LLM passed live: parses fine, but wrong shape — no
# damage.photos, invented attachment filenames under a non-load-bearing key.
FABRICATED_ARG = {
    "claim_id": "CLM-2026-0042",
    "type": "auto_insurance",
    "incident_description": "Bed bug...",
    "attachments": [{"file_name": "rental_agreement.pdf"}],
}


def _msg(content: str) -> dict:
    return {"content": content, "message_type": "text"}


def _json_block(claim: dict) -> str:
    return f"@Evidence Analyst Coverage confirmed.\n\n```json\n{json.dumps(claim)}\n```"


class FakeBandClient:
    """BandClient stand-in returning a fixed room context (newest LAST, like Band)."""

    def __init__(self, key, messages):
        self._messages = messages

    async def get_context(self, chat_id, *, limit=100):
        return list(self._messages)


def _patch_room(messages):
    """Patch the three names _recover_claim_from_room imports inside its body."""
    from agents.shared import config as cfg
    from gateway import band_client as bc

    return (
        mock.patch.object(cfg, "get_agent_credentials", lambda a: ("id", "key")),
        mock.patch.object(cfg, "read_active_chat_id", lambda: "chat-x"),
        mock.patch.object(bc, "BandClient", lambda key: FakeBandClient(key, messages)),
    )


def run(coro):
    return asyncio.run(coro)


class TestHasAttachments(unittest.TestCase):
    def test_real_claim_with_photos(self):
        self.assertTrue(_has_attachments({"damage": {"photos": ["a.jpg"]}}))

    def test_real_claim_with_supporting_document(self):
        self.assertTrue(_has_attachments({"supporting_document": "police_report.pdf"}))

    def test_real_claim_with_legacy_police_report(self):
        self.assertTrue(_has_attachments({"police_report": "pr.pdf"}))

    def test_fabricated_summary_object_has_none(self):
        # The exact live fabrication shape.
        self.assertFalse(
            _has_attachments({"claim_id": "X", "coverage": "confirmed", "reason": "hit-and-run"})
        )
        # The other live fabrication: attachments under the wrong key, no damage.photos.
        self.assertFalse(_has_attachments(FABRICATED_ARG))

    def test_empty_or_none(self):
        self.assertFalse(_has_attachments(None))
        self.assertFalse(_has_attachments({}))
        self.assertFalse(_has_attachments({"damage": {"photos": []}}))


class TestRecoverClaimFromRoom(unittest.TestCase):
    def test_prefers_claim_with_attachments_over_attachmentless(self):
        """An attachment-bearing claim outranks a newer attachment-less one."""
        # Newest message (last) is the fabricated, attachment-less claim; the real
        # claim is older. Recovery must still pick the real one.
        messages = [_msg(_json_block(REAL_CLAIM)), _msg(json.dumps(FABRICATED_ARG))]
        p1, p2, p3 = _patch_room(messages)
        with p1, p2, p3:
            recovered = run(ea._recover_claim_from_room(object()))
        self.assertIsNotNone(recovered)
        self.assertEqual(recovered["claim_id"], "CLM-2026-0042")
        self.assertTrue(_has_attachments(recovered))

    def test_prefers_matching_claim_id_among_attachment_bearing(self):
        other = {**REAL_CLAIM, "claim_id": "CLM-OTHER"}
        messages = [_msg(_json_block(other)), _msg(_json_block(REAL_CLAIM))]
        p1, p2, p3 = _patch_room(messages)
        with p1, p2, p3:
            recovered = run(
                ea._recover_claim_from_room(object(), prefer_claim_id="CLM-OTHER")
            )
        self.assertEqual(recovered["claim_id"], "CLM-OTHER")

    def test_returns_none_when_no_chat_id(self):
        from agents.shared import config as cfg

        with mock.patch.object(cfg, "get_agent_credentials", lambda a: ("id", "key")), \
             mock.patch.object(cfg, "read_active_chat_id", lambda: None):
            self.assertIsNone(run(ea._recover_claim_from_room(object())))


class _Ctx:
    def __init__(self, deps):
        self.deps = deps


class RecordingDeps:
    """AgentToolsProtocol stand-in recording the event the analyst emits."""

    def __init__(self, participants):
        self._participants = participants
        self.events = []
        self.messages = []

    @property
    def participants(self):
        return list(self._participants)

    async def get_participants(self):
        return self._participants

    async def send_event(self, content, message_type, metadata=None):
        self.events.append((content, message_type, metadata))
        return {"id": "evt"}

    async def send_message(self, content, mentions=None):
        self.messages.append((content, mentions))
        return {"id": "msg"}


ROOM = [
    {"id": "91ee0392", "name": "Evidence Analyst", "handle": "sahilatfau/evidence-analyst"},
    {"id": "955efd0a", "name": "Case Coordinator", "handle": "sahilatfau/case-coordinator"},
]


class TestRunEvidenceAnalysisPrefersRealClaim(unittest.TestCase):
    """End-to-end at the tool level: a fabricated arg must NOT defeat analysis when
    the room carries the real attachment-bearing claim."""

    def test_fabricated_arg_is_replaced_by_room_claim_with_attachments(self):
        deps = RecordingDeps(ROOM)
        captured = {}

        def fake_analyze(claim, resolver, *, skip_vision=False):
            captured["claim"] = claim
            # Return a minimal report so the tool can finish without real vision.
            return ea_report_stub(claim)

        # The room has the real claim; the LLM passed the fabricated arg.
        messages = [_msg(_json_block(REAL_CLAIM))]
        p1, p2, p3 = _patch_room(messages)
        with p1, p2, p3, \
             mock.patch.object(ea, "analyze", fake_analyze), \
             mock.patch.object(ea, "read_active_chat_id", lambda: "chat-x"), \
             mock.patch.object(ea, "upload_dir", lambda c: Path("/tmp/does-not-matter")):
            run(ea.run_evidence_analysis(_Ctx(deps), json.dumps(FABRICATED_ARG)))

        # analyze() saw the REAL claim (with the genuine photos), not the fabrication.
        self.assertEqual(captured["claim"]["claim_id"], "CLM-2026-0042")
        self.assertEqual(
            captured["claim"]["damage"]["photos"],
            ["damage_front.jpg", "damage_rear.jpg", "damage_detail.jpg"],
        )
        # And it emitted the structured evidence_analysis event.
        stages = [m.get("stage") for _, _, m in deps.events]
        self.assertIn("evidence_analysis", stages)

    def test_arg_with_attachments_used_when_room_has_nothing(self):
        """Presets / unit scenarios: a good arg is honored when recovery is empty."""
        deps = RecordingDeps(ROOM)
        captured = {}

        def fake_analyze(claim, resolver, *, skip_vision=False):
            captured["claim"] = claim
            return ea_report_stub(claim)

        p1, p2, p3 = _patch_room([])  # empty room → recovery yields nothing
        with p1, p2, p3, \
             mock.patch.object(ea, "analyze", fake_analyze), \
             mock.patch.object(ea, "read_active_chat_id", lambda: "chat-x"), \
             mock.patch.object(ea, "upload_dir", lambda c: Path("/tmp/does-not-matter")):
            run(ea.run_evidence_analysis(_Ctx(deps), json.dumps(REAL_CLAIM)))

        self.assertEqual(captured["claim"]["claim_id"], "CLM-2026-0042")


def ea_report_stub(claim):
    """Build a real EvidenceReport so model_dump()/model_dump_json() work."""
    from agents.shared.evidence import EvidenceReport

    return EvidenceReport(vision_model="test", suggested_domain=claim.get("domain", "auto"))


if __name__ == "__main__":
    unittest.main()
