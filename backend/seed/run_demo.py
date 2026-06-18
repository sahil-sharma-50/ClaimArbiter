"""Seed a golden claim into a fresh Band room and kick off the ARBITER flow."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agents.shared.config import (  # noqa: E402
    get_agent_credentials,
    load_env,
    write_active_chat_id,
)
from gateway.band_client import BandClient  # noqa: E402

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("arbiter.seed")

GOLDEN_CLAIM_DIR = Path(__file__).resolve().parent / "golden_claim"

# Preset claims selectable from the dashboard. Each maps to a claim_<key>.json.
# Intake classifies the domain from the narrative and the Case Coordinator recruits
# the matching specialist (property/medical/legal).
PRESET_CLAIMS = {
    "property": "claim_property.json",
    "medical": "claim_medical.json",
    "legal": "claim_legal.json",
}
DEFAULT_CLAIM_TYPE = "property"

# Human-readable domain label for the kickoff message, by claim domain.
_DOMAIN_LABEL = {
    "property": "property",
    "medical": "medical",
    "legal": "legal",
}


def _load_claim(claim_type: str = DEFAULT_CLAIM_TYPE) -> dict:
    filename = PRESET_CLAIMS.get(claim_type)
    if filename is None:
        raise FileNotFoundError(f"Unknown claim_type {claim_type!r}; expected one of {sorted(PRESET_CLAIMS)}")
    return json.loads((GOLDEN_CLAIM_DIR / filename).read_text())


def _format_claim_message(claim: dict) -> str:
    domain = claim.get("domain", "property")
    label = _DOMAIN_LABEL.get(domain, "insurance")
    photos = claim.get("damage", {}).get("photos") or []
    report = claim.get("supporting_document") or claim.get("police_report")
    attachments = [*photos]
    if report:
        attachments.append(report)
    attach_line = (
        f"Attachments referenced: {', '.join(attachments)}.\n"
        if attachments
        else ""
    )
    return (
        f"@Intake New {label} claim filed.\n\n"
        f"```json\n{json.dumps(claim, indent=2)}\n```\n\n"
        f"{attach_line}Please confirm coverage, then hand off to the Evidence Analyst "
        f"for attachment analysis (mention @EvidenceAnalyst with the claim JSON)."
    )


def build_claim(inp: dict) -> dict:
    """Map validated UI/form input into the canonical claim shape (domain auto-detected).

    Mirrors seed/golden_claim/claim_property.json in *shape*, but does NOT pin a
    domain: instead of a dropdown, the agents classify the domain from the narrative
    and evidence. So ``domain`` is left as the neutral ``"unknown"`` placeholder and
    ``claim_type`` as ``"custom-claim"`` (deliberately domain-free so it can't bias
    classification) — the Intake agent stamps the detected domain onto the
    claim before handing off, and the Evidence Analyst's suggested_domain confirms it.
    The narrative and damage.description are preserved verbatim from the form, because
    they carry the real story the classifier and vision read.

    The claimant form no longer self-reports fraud flags: suspicion now comes from the
    uploaded evidence (vision/document discrepancy) and the specialists' judgment, so
    ``review_signals`` starts empty and is populated downstream by the Evidence Analyst.
    Fields the form does not collect get safe defaults: golden photo filenames and
    police_report.pdf.

    Detail-only fields the form collects (category, incident location/time, claimant
    email/address/DOB, currency, other insurance, declaration) are preserved on the
    claim AND folded into the narrative the agents read, so they inform classification
    and investigation without expanding the structured scoring surface.

    Uploaded attachments: when the caller supplies ``uploaded_photos`` /
    ``uploaded_document`` (filenames the gateway has written to this claim's upload
    dir), they REPLACE the golden defaults so the Evidence Analyst reads the real
    files. Absent uploads, the golden filenames keep the preset demo working.
    """
    uploaded_photos = inp.get("uploaded_photos") or []
    photos = uploaded_photos or ["damage_front.jpg", "damage_rear.jpg", "damage_detail.jpg"]
    supporting_document = inp.get("uploaded_document") or "police_report.pdf"

    claimant_in = inp.get("claimant") or {}
    narrative = inp.get("narrative", "")

    # Fold detail-only fields into the narrative the agents read. These add context for
    # domain classification and investigation but never feed the deterministic score.
    context_lines: list[str] = []
    if inp.get("category"):
        context_lines.append(f"Claimant-selected category: {inp['category']}")
    if inp.get("incident_location"):
        context_lines.append(f"Incident location: {inp['incident_location']}")
    if inp.get("incident_time"):
        context_lines.append(f"Time of incident: {inp['incident_time']}")
    if inp.get("other_insurance"):
        context_lines.append(f"Other insurance: {inp['other_insurance']}")
    if context_lines:
        narrative = f"{narrative}\n\n[Additional detail]\n" + "\n".join(context_lines)

    return {
        "claim_id": inp["claim_id"],
        # Domain is auto-detected downstream (Intake classifies, Evidence confirms);
        # "unknown" is the neutral placeholder the Intake tool replaces.
        "domain": "unknown",
        "claim_type": "custom-claim",
        "category": inp.get("category") or None,
        "policy_id": inp.get("policy_id", "POL-MER-8812"),
        "incident_date": inp["incident_date"],
        "reported_date": inp["reported_date"],
        "incident_location": inp.get("incident_location") or "",
        "incident_time": inp.get("incident_time") or "",
        "parties": {
            "claimant": {
                "name": claimant_in.get("name", ""),
                "phone": claimant_in.get("phone", ""),
                "email": claimant_in.get("email", ""),
                "address": claimant_in.get("address", ""),
                "dob": claimant_in.get("dob", ""),
            },
        },
        "damage": {
            "description": inp["damage"].get("description", ""),
            "photos": photos,
            "estimated_repair": inp["damage"].get("estimated_repair", 0),
        },
        "currency": inp.get("currency", "USD"),
        "loss_amount": inp["loss_amount"],
        "deductible": inp.get("deductible", 500),
        "other_insurance": inp.get("other_insurance") or "",
        "supporting_document": supporting_document,
        "review_signals": [],
        "signal_detail": {},
        "declaration": bool(inp.get("declaration")),
        "narrative": narrative,
    }


def _find_peer(peers: list[dict], *, name_substring: str | tuple[str, ...]) -> dict | None:
    needles = (name_substring,) if isinstance(name_substring, str) else name_substring
    needles = tuple(n.lower() for n in needles)
    for peer in peers:
        name = (peer.get("name") or "").lower()
        if any(n in name for n in needles):
            return peer
    return None


async def seed_demo(claim: dict | None = None, claim_type: str = DEFAULT_CLAIM_TYPE) -> str:
    load_env()
    intake_id, intake_key = get_agent_credentials("intake_coverage")
    adj_id, adj_key = get_agent_credentials("case_coordinator")
    human_reviewer_user_id = os.environ.get("HUMAN_REVIEWER_USER_ID")

    # The Case Coordinator OWNS the room (creates it). Only the room owner can
    # remove participants, and the Coordinator is the orchestrator that lives through
    # the whole claim — so it can prune single-shot agents (Intake, Evidence, the
    # specialist) once their phase is done, taking them out of Band's @mention flow.
    # This is what keeps the room from devolving into cross-mention chatter.
    client = BandClient(adj_key)
    claim = claim if claim is not None else _load_claim(claim_type)

    room = await client.create_chat(title=f"ARBITER Claim {claim['claim_id']}")
    chat_id = room["id"]
    logger.info("Created room %s (owned by Case Coordinator)", chat_id)

    peers = await client.list_peers(not_in_chat=chat_id)

    # The Coordinator created the room, so it is already a participant (owner).
    # Add the other Insurance Provider agents it will hand work to.
    evidence = _find_peer(peers, name_substring="evidence")
    intake = _find_peer(peers, name_substring="intake") or {"id": intake_id}

    if intake.get("id"):
        await client.add_participant(chat_id, intake["id"])
        logger.info("Added intake participant")

    if evidence:
        await client.add_participant(chat_id, evidence["id"])
        logger.info("Added evidence analyst participant")

    if human_reviewer_user_id:
        try:
            await client.add_participant(chat_id, human_reviewer_user_id)
            logger.info("Added human reviewer participant")
        except Exception as exc:
            logger.warning("Could not add human reviewer user: %s", exc)

    # Refining the mention via the live participant list is best-effort: we already
    # hold the intake peer from add_participant above, and _find_peer falls back to it.
    # A transient Band 500 here must not abort the whole seed before kickoff is sent.
    try:
        participants = await client.list_participants(chat_id)
    except Exception as exc:
        logger.warning("Could not list participants (using known intake peer): %s", exc)
        participants = []
    intake_peer = _find_peer(participants, name_substring="intake") or intake
    mention = {
        "id": intake_peer.get("id", intake_id),
        "handle": intake_peer.get("handle", "intake"),
        "name": intake_peer.get("name", "Intake"),
    }

    # Kickoff is sent by the Coordinator (the owner), @mentioning Intake. The
    # Coordinator is a participant but not mentioned here, so it won't self-trigger,
    # and Band rejects self-mentions anyway.
    await client.send_message(chat_id, _format_claim_message(claim), mentions=[mention])
    logger.info("Posted golden claim, @mentioning Intake")

    write_active_chat_id(chat_id)
    return chat_id


async def _main_async() -> None:
    chat_id = await seed_demo()
    print(chat_id)


def main() -> None:
    asyncio.run(_main_async())


if __name__ == "__main__":
    main()
