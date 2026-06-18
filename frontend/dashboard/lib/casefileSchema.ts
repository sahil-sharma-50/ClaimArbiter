/**
 * TypeScript mirror of the backend casefile payload schema.
 *
 * The gateway normalizes each Band event into a `CasefileEntry` whose `result` is
 * the stage-specific payload (gateway sets `result = metadata.get("result", metadata)`).
 * Until now every scene re-declared that payload's shape with its own inline
 * `(entry?.result ?? {}) as {…}` cast, so the same stage was described differently in
 * six places and could drift from what the backend actually emits — with nothing to
 * catch it.
 *
 * This is the single typed view of that contract, mirroring
 * backend/agents/shared/casefile_schema.py. `stageResult(entry)` is the typed
 * accessor: given a CasefileEntry it returns the payload narrowed to the stage's
 * type. The Python↔TS contract test (backend/tests/test_ts_casefile_contract.py)
 * fails if the result-bearing models here drift from the Pydantic ones.
 *
 * Mirrors the Python contract exactly:
 *  - result-bearing stages (intake, coverage, evidence_analysis, escalation,
 *    conflict) carry their fields under metadata.result — which is precisely what
 *    the gateway puts in CasefileEntry.result, so these types describe `result` 1:1.
 *  - "fraud_verdict" is the legacy alias for "specialist_verdict".
 *
 * All fields are optional/nullable: this describes data already committed to Band
 * (possibly partial or legacy), not a request validated at an edge. A reader gets a
 * typed view, never a guarantee a field is present.
 */
import type { CasefileEntry } from "@/dashboard/lib/api";

export type StageName =
  | "intake"
  | "coverage"
  | "evidence_analysis"
  | "review_score"
  | "discovery"
  | "recruiting"
  | "specialist_verdict"
  | "fraud_verdict" // legacy alias for specialist_verdict
  | "conflict"
  | "escalation"
  | "signoff";

/** metadata.result of the `intake` event (intake_coverage.py → IntakeResult). */
export type IntakeResult = {
  claim_id?: string | null;
  domain?: string | null;
  subject?: string | null;
  docs?: number;
};

/** metadata.result of the `coverage` event (intake_coverage.py → CoverageResult). */
export type CoverageResult = {
  covered?: boolean | null;
  policy?: string | null;
  deductible?: number | null;
  domain?: string | null;
  note?: string;
};

/** One image observation inside an evidence report (evidence.py → ImageObservation). */
export type ImageObservation = {
  filename: string;
  damage_location?: string;
  severity_band?: "none" | "minor" | "moderate" | "severe";
  consistent_with_narrative?: "yes" | "no" | "unclear";
  narrative_reason?: string;
  confidence?: "low" | "medium" | "high";
  error?: string | null;
};

/** metadata.result of the `evidence_analysis` event (evidence.py → EvidenceReport). */
export type EvidenceAnalysisResult = {
  observations?: ImageObservation[];
  pdf_excerpt?: string;
  signals?: string[];
  suggested_domain?: string;
  vision_model?: string;
  degraded?: boolean;
};

/** metadata.result of the `escalation` event (case_coordinator → EscalationResult). */
export type EscalationResult = {
  recommendation?: "approve" | "deny" | null;
  rationale?: string;
};

/** metadata.result of the `conflict` event (case_coordinator.cross_check → ConflictResult). */
export type ConflictResult = {
  status?: "agree" | "conflict" | null;
  reasons?: string[];
  needs_human?: boolean | null;
};

/**
 * The `recruiting` event's result sub-object (case_coordinator.recruit).
 *
 * NOTE — this is the REAL shape the gateway emits, not the mock's
 * `{ score, signals, threshold }`. The scenes historically read score/signals off
 * recruiting.result; those fields exist only in mock data. Typing it truthfully
 * surfaces that drift at compile time instead of silently rendering nothing live.
 */
export type RecruitingResult = {
  handle?: string;
  name?: string;
  joined?: boolean;
  match_path?: string;
  capability_tag?: string | null;
};

/**
 * Sibling-bearing stages keep their authoritative fields as siblings of result in
 * metadata, so the gateway's CasefileEntry.result for these is the whole metadata
 * dict. Modeled here for completeness; the scenes mostly read these via the
 * higher-level `discovery` / `specialist` spines on ArbiterState.
 */
export type DiscoveryPayload = {
  capability_tag?: string | null;
  match_path?: string | null;
  candidates?: { name?: string; handle?: string; tags?: string[] }[];
  selected_handle?: string | null;
  selected_name?: string | null;
};

export type SpecialistVerdictResult = {
  specialty?: string | null;
  risk?: "high" | "medium" | "low" | null;
  // The specialist's own approve/deny call and written rationale, relayed verbatim
  // to the human. These are SIBLINGS of result in the metadata (see the Python
  // contract), surfaced here so a reader of the verdict payload sees them.
  recommendation?: "approve" | "deny" | null;
  explanation?: string;
  // result here is the LLM's free-form verdict object.
  verdict?: string;
  confidence?: number;
};

export type SignoffResult = {
  decision?: "approve" | "deny" | null;
  note?: string;
  authored_by?: "human" | "agent_on_behalf_of_human";
};

/** Maps each stage to the type of its CasefileEntry.result. */
export type StageResultMap = {
  intake: IntakeResult;
  coverage: CoverageResult;
  evidence_analysis: EvidenceAnalysisResult;
  escalation: EscalationResult;
  conflict: ConflictResult;
  recruiting: RecruitingResult;
  discovery: DiscoveryPayload;
  specialist_verdict: SpecialistVerdictResult;
  fraud_verdict: SpecialistVerdictResult;
  signoff: SignoffResult;
};

/**
 * Typed accessor: the payload of a casefile entry, narrowed to its stage's type.
 *
 * Replaces the per-scene `(entry?.result ?? {}) as {…}` casts with one place that
 * knows the shape. Returns an empty object for a missing/absent result, so callers
 * read fields with optional chaining exactly as before — the win is that the field
 * set is now checked against this module, not re-invented inline.
 *
 * `stage` is load-bearing: if the entry's own stage doesn't match the requested one
 * (a caller passed the wrong entry), the result is treated as absent rather than
 * read under the wrong type.
 *
 * @example
 *   const cov = stageResult(casefile.find((c) => c.stage === "coverage"), "coverage");
 *   cov.covered; // boolean | null | undefined — typed, not `any`
 */
export function stageResult<S extends keyof StageResultMap>(
  entry: CasefileEntry | undefined,
  stage: S,
): StageResultMap[S] {
  const result = entry?.stage === stage ? entry?.result : undefined;
  return (result && typeof result === "object" ? result : {}) as StageResultMap[S];
}

/** Find an entry by stage and return its typed result in one step. */
export function findStageResult<S extends keyof StageResultMap>(
  casefile: CasefileEntry[],
  stage: S,
): StageResultMap[S] {
  return stageResult(
    casefile.find((c) => c.stage === stage),
    stage,
  );
}
