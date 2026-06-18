"""Typed schema for the structured payloads agents exchange through Band.

Agents coordinate by posting ``band_send_event`` messages whose ``metadata`` carries
a ``stage`` discriminator and a stage-specific payload. Band is the system of record;
the gateway and dashboard rebuild everything from these events. Until now the payload
shape lived in *no* module — each producer built a bare dict inline and each reader
re-guessed the shape with its own ``isinstance``/``.get`` ladder (the Case
Coordinator's ``read_evidence_signals``, the gateway's ``_specialist_descriptor`` /
``_discovery_payload`` / ``_human_decision``, and six dashboard scenes). A key renamed
in one place silently became ``None`` everywhere else, in either language.

This module is the single typed seam for that contract. One Pydantic model per stage
captures the fields, and :func:`parse_stage_metadata` is the deep interface that hides
*where* each stage keeps its fields — because the layout genuinely differs:

* intake, coverage, evidence_analysis, escalation, conflict
      carry their payload under ``metadata["result"]``.
* discovery, recruiting, specialist_verdict, signoff
      carry their authoritative fields as **siblings** of ``result`` in ``metadata``
      (e.g. ``metadata["risk"]``, ``metadata["decision"]``, ``metadata["candidates"]``).

The reader contract is **graceful degradation**: the gateway must rebuild from
arbitrary, partial, or legacy Band state and never crash. So every parse tolerates
missing/extra fields, accepts a JSON-string ``metadata`` (Band sometimes serializes it
that way), and returns ``None`` rather than raising when the shape is too far gone —
letting callers fall back to the raw dict exactly as they do today.

The models are deliberately lenient (defaults everywhere, ``extra="allow"``) because
they describe data already committed to Band, not a request being validated at an API
edge. Their job is to give readers a typed, single-source-of-truth view — not to
reject history.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# Stage discriminator values, mirroring agents.shared.casefile._PHASE_BY_STAGE.
# "fraud_verdict" is the pre-multi-specialist alias for "specialist_verdict" and is
# still honored when reading historical rooms.
Stage = Literal[
    "intake",
    "coverage",
    "evidence_analysis",
    "review_score",
    "discovery",
    "recruiting",
    "specialist_verdict",
    "fraud_verdict",  # legacy alias for specialist_verdict
    "conflict",
    "escalation",
    "signoff",
]


class _StagePayload(BaseModel):
    """Base for every stage payload: lenient, forward-compatible, never strict.

    These describe data already in Band, so unknown fields are kept (``extra="allow"``)
    rather than rejected — a newer producer can add a field without breaking an older
    reader, and a reader can still see fields this schema hasn't named yet.
    """

    model_config = ConfigDict(extra="allow")


# --- result-bearing stages -------------------------------------------------
# These four keep their payload under metadata["result"]; see the producer sites:
#   intake/coverage  → intake_coverage.record_coverage_and_handoff
#   evidence_analysis → evidence_analyst.run_evidence_analysis (EvidenceReport.model_dump)
#   escalation       → case_coordinator step 5 / CASE_COORDINATOR_PROMPT


class IntakeResult(_StagePayload):
    """metadata.result of the ``intake`` event (intake_coverage.py)."""

    claim_id: str | None = None
    domain: str | None = None
    subject: str | None = None
    docs: int = 0


class CoverageResult(_StagePayload):
    """metadata.result of the ``coverage`` event (intake_coverage.py)."""

    covered: bool | None = None
    policy: str | None = None
    deductible: int | None = None
    domain: str | None = None
    note: str = ""


class EscalationResult(_StagePayload):
    """metadata.result of the ``escalation`` event (case_coordinator).

    The Coordinator's recommendation is ``approve`` | ``deny`` with a rationale; this
    is the AI recommendation, distinct from the human's :class:`SignoffPayload`.
    """

    recommendation: Literal["approve", "deny"] | None = None
    rationale: str = ""


class ConflictResult(_StagePayload):
    """metadata.result of the ``conflict`` event (case_coordinator.cross_check)."""

    status: Literal["agree", "conflict"] | None = None
    reasons: list[str] = Field(default_factory=list)
    needs_human: bool | None = None


# --- sibling-bearing stages -------------------------------------------------
# These keep their authoritative fields as SIBLINGS of result in metadata, because
# they're emitted by tools/endpoints/LLMs that set top-level metadata keys directly:
#   discovery / recruiting    → case_coordinator.recruit
#   specialist_verdict        → specialist LLM (prompts.py contract)
#   signoff                   → gateway post_approve endpoint
# Each model is constructed from the WHOLE metadata dict, not metadata["result"].


class ReviewScorePayload(_StagePayload):
    """The ``review_score`` event's deterministic routing decision (case_coordinator).

    Fields live at metadata top level (score, threshold, recruit, domain,
    present_signals) — there is no ``result`` sub-object on this event. This is the
    real routing score the Coordinator computes; surfacing it as a structured event
    lets the live view show the actual score instead of a canned value.
    """

    score: float | None = None
    threshold: float | None = None
    recruit: bool | None = None
    domain: str | None = None
    present_signals: list[str] = Field(default_factory=list)


class DiscoveryPayload(_StagePayload):
    """The ``discovery`` event's directory-match decision (case_coordinator.recruit).

    Fields live at metadata top level (capability_tag, match_path, candidates,
    selected_handle/name) — there is no ``result`` sub-object on this event.
    """

    capability_tag: str | None = None
    match_path: str | None = None
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    selected_handle: str | None = None
    selected_name: str | None = None


class RecruitingPayload(_StagePayload):
    """The ``recruiting`` event (case_coordinator.recruit).

    Carries the recruited specialist as metadata siblings AND duplicates them inside a
    ``result`` object. The sibling keys are the authoritative read (the gateway's
    ``_discovery_payload`` reads ``specialist_handle`` / ``specialist_name``).
    """

    specialist_handle: str | None = None
    specialist_name: str | None = None
    match_path: str | None = None
    capability_tag: str | None = None


class SpecialistVerdictPayload(_StagePayload):
    """The ``specialist_verdict`` event (specialist LLMs; prompts.py contract).

    ``specialty`` and ``risk`` are metadata siblings; ``result`` is a free-form object
    the LLM fills (the gateway reads ``specialty``/``risk`` from the top level). Accept
    the ``fraud_verdict`` legacy stage transparently via :func:`parse_stage_metadata`.

    ``recommendation`` and ``explanation`` are the specialist's own approve/deny call and
    its written rationale, emitted as siblings alongside ``specialty``/``risk`` (NOT inside
    ``result``). The Case Coordinator relays both verbatim to the human reviewer. They are
    optional with defaults so historical/legacy verdicts that predate the relay model still
    parse — a missing recommendation reads as ``None`` rather than crashing the rebuild.
    """

    specialty: str | None = None
    risk: Literal["high", "medium", "low"] | None = None
    recommendation: Literal["approve", "deny"] | None = None
    explanation: str = ""
    result: dict[str, Any] = Field(default_factory=dict)


class SignoffPayload(_StagePayload):
    """The ``signoff`` event written by the gateway approve endpoint (main.py).

    ``decision`` / ``note`` / ``authored_by`` are metadata siblings. ``authored_by``
    defaults to the honest agent-fallback value when a legacy event omits it (mirrors
    gateway._human_decision), so the UI never silently claims a human posted.
    """

    decision: Literal["approve", "deny"] | None = None
    note: str = ""
    authored_by: Literal["human", "agent_on_behalf_of_human"] = "agent_on_behalf_of_human"


# Stages whose payload lives under metadata["result"]. Everything else in
# _MODEL_BY_STAGE is built from the whole metadata dict (sibling-bearing).
_RESULT_BEARING: frozenset[str] = frozenset(
    {"intake", "coverage", "evidence_analysis", "escalation", "conflict"}
)

# Map each stage discriminator to its payload model. evidence_analysis reuses the
# existing EvidenceReport (single source of truth) — imported lazily so this module
# stays light for callers that only need the cheap models. fraud_verdict aliases
# specialist_verdict so historical rooms parse the same way.
_MODEL_BY_STAGE: dict[str, type[BaseModel]] = {
    "intake": IntakeResult,
    "coverage": CoverageResult,
    "escalation": EscalationResult,
    "conflict": ConflictResult,
    "review_score": ReviewScorePayload,
    "discovery": DiscoveryPayload,
    "recruiting": RecruitingPayload,
    "specialist_verdict": SpecialistVerdictPayload,
    "fraud_verdict": SpecialistVerdictPayload,  # legacy alias
    "signoff": SignoffPayload,
}


def _coerce_metadata(metadata: Any) -> dict[str, Any]:
    """Normalize Band metadata to a dict (it is sometimes a JSON string)."""
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except json.JSONDecodeError:
            return {}
    return metadata if isinstance(metadata, dict) else {}


def model_for_stage(stage: str | None) -> type[BaseModel] | None:
    """The payload model for a stage discriminator, or None if the stage is untyped."""
    if not stage:
        return None
    if stage == "evidence_analysis":
        # Reuse the Evidence Analyst's own report model rather than re-declaring it,
        # so the evidence contract has exactly one definition. Lazy import keeps the
        # heavy provider/vision chain out of callers that never touch evidence.
        from agents.shared.evidence import EvidenceReport

        return EvidenceReport
    return _MODEL_BY_STAGE.get(stage)


def parse_stage_metadata(stage: str | None, metadata: Any) -> BaseModel | None:
    """Parse a Band event's metadata into its typed stage payload.

    This is the deep interface: callers pass the event's ``stage`` and raw
    ``metadata`` and get back a typed model, without needing to know *where* the stage
    keeps its fields — result-bearing stages are parsed from ``metadata["result"]``,
    sibling-bearing stages from the whole metadata dict.

    Graceful by contract — this reads data already committed to Band, so it never
    raises:

    * a JSON-string ``metadata`` is coerced to a dict;
    * an unknown/missing ``stage`` returns ``None`` (caller keeps the raw dict);
    * a payload that can't satisfy even the lenient model returns ``None``.

    A ``None`` return is the caller's signal to fall back to the raw metadata exactly
    as it did before this seam existed.
    """
    model = model_for_stage(stage)
    if model is None:
        return None

    meta = _coerce_metadata(metadata)
    if stage in _RESULT_BEARING:
        payload = meta.get("result")
        # Band can serialize the nested result as a JSON string just like the outer
        # metadata; coerce it so a stringified payload still parses.
        if isinstance(payload, str):
            payload = _coerce_metadata(payload)
        # Result-bearing events normally nest the payload under "result"; tolerate a
        # producer that flattened it by falling back to the whole metadata dict.
        source = payload if isinstance(payload, dict) else meta
    else:
        # Sibling-bearing stages parse from the whole metadata, minus the "stage"
        # discriminator itself — it identifies the payload, it is not part of it (and
        # with extra="allow" it would otherwise be absorbed as a stray field).
        source = {k: v for k, v in meta.items() if k != "stage"}

    try:
        return model.model_validate(source)
    except Exception:  # noqa: BLE001 — never raise on historical/partial Band data
        return None


def build_stage_metadata(
    stage: str,
    payload: BaseModel,
    *,
    result: dict[str, Any] | None = None,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a Band event's ``metadata`` dict from a typed stage payload.

    The symmetric inverse of :func:`parse_stage_metadata`: producers construct the
    stage's model and hand it here, and the result-vs-sibling placement lives in ONE
    place for both writing and reading. A wrong-shaped payload becomes impossible to
    emit because it can't be constructed in the first place.

    The wire bytes are unchanged from a hand-written literal: the model is
    ``model_dump()``'d (``None`` values kept, since the literals always emitted every
    key), and the layout follows the stage's contract:

    * result-bearing stages → ``{"stage": stage, "result": <dump>, **extra}``
    * sibling-bearing stages → ``{"stage": stage, **<dump>, **extra}``

    ``result`` overrides the auto-placed payload for the few sibling-bearing stages
    that ALSO carry a duplicating ``result`` sub-object on the wire (recruiting emits
    both sibling keys and ``result={handle, name, joined, ...}``, read downstream).
    ``extra`` carries any non-payload metadata keys the producer sets alongside the
    stage (e.g. mentions), placed at the top level.
    """
    dump = payload.model_dump()
    meta: dict[str, Any] = {"stage": stage}
    if stage in _RESULT_BEARING:
        meta["result"] = dump
    else:
        meta.update(dump)
    if result is not None:
        meta["result"] = result
    if extra:
        meta.update(extra)
    return meta
