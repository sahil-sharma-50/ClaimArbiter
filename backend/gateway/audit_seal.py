"""Tamper-evident audit seal for a claim's Band transcript.

The gateway holds no authoritative state — Band is the system of record. The seal
is therefore a *pure function of the room transcript*: a SHA-256 over the ordered,
canonicalized set of message identities + the stage each one advanced. Recomputing
it from a fresh Band pull reproduces the value printed on the PDF, which is the
whole point — delete the gateway and the seal still verifies from Band.

Canonicalization matters: the dashboard/report fetch a *union* of every agent's
mention-scoped view (`_union_room_messages`), so the same message can arrive more
than once and in different orders across fetches. We dedupe by message id and sort
deterministically before hashing, so a shuffled/duplicated fetch yields the same
seal as the original.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

_ALGO = "sha256"


def _canonical_records(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Reduce messages to the minimal identity fields, deduped by id, deterministic.

    Only fields that define *what happened* are sealed: the message id (Band's
    immutable identity), who sent it, when, its type, the stage it carried, and its
    content. Reordering or duplication across agent views can't change the result.
    """
    by_id: dict[str, dict[str, str]] = {}
    for i, msg in enumerate(messages):
        # Fall back to a positional key only when Band omitted an id (shouldn't happen
        # for real events, but keeps empty/synthetic transcripts hashable).
        mid = str(msg.get("id") or f"__noid_{i}")
        metadata = msg.get("metadata")
        stage = ""
        if isinstance(metadata, dict):
            stage = str(metadata.get("stage") or "")
        by_id[mid] = {
            "id": mid,
            "type": str(msg.get("message_type") or "text"),
            "sender": str(msg.get("sender_name") or ""),
            "ts": str(msg.get("inserted_at") or ""),
            "stage": stage,
            "content": str(msg.get("content") or ""),
        }
    return [by_id[k] for k in sorted(by_id)]


def compute_seal(messages: list[dict[str, Any]]) -> str:
    """Return ``sha256:<hex>`` over the canonicalized transcript."""
    records = _canonical_records(messages)
    payload = json.dumps(records, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    digest = hashlib.new(_ALGO, payload.encode("utf-8")).hexdigest()
    return f"{_ALGO}:{digest}"


def verify_seal(messages: list[dict[str, Any]], expected_seal: str) -> dict[str, Any]:
    """Recompute the seal from ``messages`` and compare to ``expected_seal``."""
    recomputed = compute_seal(messages)
    return {
        "seal": recomputed,
        "expected": expected_seal,
        "match": recomputed == expected_seal,
        "message_count": len(_canonical_records(messages)),
    }
