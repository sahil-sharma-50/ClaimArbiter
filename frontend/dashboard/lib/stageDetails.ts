import type {
  ArbiterState,
  AuditEntry,
  CasefileEntry,
  HandshakeEvent,
} from "@/dashboard/lib/api";
import { isReadableTextMessage } from "@/dashboard/lib/auditFilter";
import { PHASES, type Phase } from "@/dashboard/lib/phases";

/*
  Derives, for each step of the canonical flow, a readable detail bundle the
  StageDetailCard renders when an operator clicks a step in the PhaseStepper.

  Every step gets real content: the structured casefile finding(s) the agents
  wrote for that step, plus the live audit lines attributable to it. Steps with
  no casefile entry (investigation, sign-off) lean on sender-attributed audit so
  the panel is never empty once the step has been reached.
*/

// The stepper's steps are the six operator milestones (dashboard/lib/phases.ts
// STEPPER_PHASES). Backend phases conflict/escalated still exist for Band but are
// folded into Investigate / Sign-off in the UI.
export type StageKey = Phase;

export type StageStatus = "done" | "current" | "skipped" | "upcoming";

export type StageDetail = {
  key: StageKey;
  label: string;
  /** One-line description of what happens in this step. */
  blurb: string;
  /** Owning org, for tinting (a = Insurance Provider, b = specialist's partner org). */
  org: "a" | "b";
  /** Primary agent / actor for the step. */
  agent: string;
  status: StageStatus;
  findings: CasefileEntry[];
  events: AuditEntry[];
  handshake: HandshakeEvent[];
};

type StageConfig = {
  label: string;
  blurb: string;
  org: "a" | "b";
  agent: string;
  /** casefile.stage values that belong to this step. */
  casefileStages: string[];
  /** audit senders whose lines we surface for this step. */
  eventSenders: string[];
  handshake?: boolean;
};

const STAGE_CONFIG: Record<StageKey, StageConfig> = {
  intake: {
    label: "Intake",
    blurb: "Documents and photos arrive; the intake agent extracts a structured claim.",
    org: "a",
    agent: "Intake & Coverage",
    casefileStages: ["intake"],
    eventSenders: [],
  },
  coverage: {
    label: "Coverage",
    blurb: "The policy is checked: in force, perils covered, deductible confirmed.",
    org: "a",
    agent: "Intake & Coverage",
    casefileStages: ["coverage"],
    eventSenders: [],
  },
  evidence: {
    label: "Evidence",
    blurb: "Uploaded photos are analyzed on open-weight vision; findings feed scoring.",
    org: "a",
    agent: "Evidence Analyst",
    casefileStages: ["evidence_analysis"],
    eventSenders: [],
  },
  recruiting: {
    label: "Discover",
    blurb: "The Case Coordinator scores the claim, then discovers and recruits the right specialist across the org boundary.",
    org: "a",
    agent: "Case Coordinator",
    casefileStages: ["recruiting"],
    eventSenders: [],
    handshake: true,
  },
  investigating: {
    label: "Investigate",
    blurb: "Specialist investigation on an open-weight model, or the Case Coordinator decides directly when no expert joins.",
    org: "b",
    agent: "Specialist",
    casefileStages: ["recruiting", "discovery", "specialist_verdict", "fraud_verdict"],
    eventSenders: [],
  },
  conflict: {
    label: "Conflict",
    blurb: "When evidence and verdict disagree, the Case Coordinator challenges or escalates to human.",
    org: "a",
    agent: "Case Coordinator",
    casefileStages: ["conflict"],
    eventSenders: [],
  },
  escalated: {
    label: "Escalate",
    blurb: "The Case Coordinator weighs coverage against the verdict and drafts a recommendation.",
    org: "a",
    agent: "Case Coordinator",
    casefileStages: ["specialist_verdict", "fraud_verdict", "escalation"],
    eventSenders: [],
  },
  signed: {
    label: "Sign-off",
    blurb: "The Case Coordinator escalates with a recommendation; the Human Reviewer signs the final decision back to the room.",
    org: "a",
    agent: "Human Reviewer",
    casefileStages: ["escalation", "conflict"],
    // accept-both: live Band names may be old or new; mock data uses new
    eventSenders: ["Human Adjuster", "Human Reviewer"],
  },
};

// The canonical claim-phase ordering (dashboard/lib/phases.ts). The stepper renders
// exactly these eight steps, in this order.
export const STAGE_ORDER: readonly StageKey[] = PHASES;

/**
 * Which step the stepper treats as active. When the gateway reports `escalated`,
 * AI coordination is finished and the human sign-off screen is showing — highlight
 * Sign-off, not Escalate.
 */
export function stepperActivePhase(phase: string): StageKey | null {
  if (phase === "escalated") return "signed";
  if (phase === "conflict") return "investigating";
  return STAGE_ORDER.includes(phase as StageKey) ? (phase as StageKey) : null;
}

/** Active step index in STAGE_ORDER, -1 when idle/unknown. */
function phaseIndex(phase: string): number {
  const active = stepperActivePhase(phase);
  return active ? STAGE_ORDER.indexOf(active) : -1;
}

const MERIDIAN_SENDERS = new Set([
  "Intake+Coverage",
  "Intake & Coverage",
  "Intake Coverage",
  "Intake",
  "Evidence Analyst",
  "Adjudicator",
  "Case Coordinator",
  "Human Adjuster",
  "Adjuster",
  "Human Reviewer",
  "system",
]);

function isInvestigationText(entry: AuditEntry, specialistName?: string | null): boolean {
  if (!isReadableTextMessage(entry)) return false;
  const sender = entry.sender ?? "";
  const content = (entry.content ?? "").toLowerCase();

  if (specialistName && sender === specialistName) return true;
  if (sender && !MERIDIAN_SENDERS.has(sender)) return true;

  if (sender === "Case Coordinator" || sender === "Adjudicator") {
    return /recruit|escalat|recommend|investigat|verdict|specialist|review this claim|relay|expert match|no expert match|unable to recruit/.test(
      content,
    );
  }

  return false;
}

const INVESTIGATION_STAGES = new Set([
  "recruiting",
  "discovery",
  "review_score",
  "specialist_verdict",
  "fraud_verdict",
  "escalation",
]);

function isInvestigationAuditEntry(entry: AuditEntry, specialistName?: string | null): boolean {
  if (entry.type === "tool_call" || entry.type === "tool_result") return false;

  const stage = entry.stage?.trim();
  if (stage && INVESTIGATION_STAGES.has(stage)) return true;

  if (entry.type === "text") return isInvestigationText(entry, specialistName);

  if (entry.type === "task" || entry.type === "thought") {
    const content = (entry.content ?? "").toLowerCase();
    return /recruit|escalat|specialist|expert match|no expert|verdict|unable to recruit|no_match|across the org boundary/.test(
      content,
    );
  }

  return false;
}

/**
 * Gather the concrete detail items (findings / sender-attributed audit /
 * handshake) a stage owns, given the current state. Shared by the inspector and
 * the truthfulness check below so "has content" means the same thing everywhere.
 */
function gatherStageItems(key: StageKey, state: ArbiterState | null) {
  const cfg = STAGE_CONFIG[key];
  const casefile = state?.casefile ?? [];
  const audit = state?.audit ?? [];
  const handshake = state?.handshake ?? [];

  const findings = casefile.filter((c) => cfg.casefileStages.includes(c.stage));
  const events: AuditEntry[] = cfg.eventSenders.length
    ? audit.filter((e) => cfg.eventSenders.includes(e.sender ?? ""))
    : [];
  // Investigation: milestone tasks plus human text handoffs — matches what Band shows.
  if (key === "investigating") {
    const picked = audit.filter((e) => isInvestigationAuditEntry(e, state?.specialist?.name));
    picked.sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
    events.push(...picked.slice(-12));
  }
  // Sign-off also closes with a system "lifecycle complete" line worth surfacing.
  if (key === "signed") {
    const closing = audit.filter(
      (e) => e.sender === "system" && /complete/i.test(e.content),
    );
    events.push(...closing);
  }

  const stageHandshake = cfg.handshake ? handshake : [];
  return { findings, events, handshake: stageHandshake };
}

// Steps that only run when the Case Coordinator recruits a specialist. On the
// recruit-FALSE path (Coordinator scores below threshold and decides directly)
// these are genuinely bypassed; on every other path they are prerequisites the
// claim must have passed through to reach a later step.
const RECRUIT_DEPENDENT_STAGES = new Set<StageKey>(["recruiting", "investigating", "conflict"]);

/**
 * Status of a step. The stepper reads strictly left-to-right: every step BEFORE
 * the active one is "done" (ticked), the active one is "current", later ones are
 * "upcoming". A passed step is the green check by default — reaching a later phase
 * proves the earlier ones ran, even when their content is invisible to this
 * projection (Band's per-agent /context is mention-scoped, so Evidence/Handoff
 * lines the Coordinator was never @mentioned in don't reach us — see memory).
 *
 * The ONLY exception is a genuine branch: when the Coordinator decided directly
 * without recruiting (`routing_score.recruit === false`), the recruit-dependent
 * steps (Handoff / Investigate / Conflict) really were skipped, so they render
 * "skipped" rather than a fabricated check. We key that on the positive recruit=false
 * signal, never on absence-of-content, so a real prerequisite is never down-ranked.
 *
 * `state` is optional: callers without state get the index-only behaviour
 * (passed ⇒ done), the right fallback before any state has loaded.
 */
export function stageStatus(key: StageKey, phase: string, state?: ArbiterState | null): StageStatus {
  const active = phaseIndex(phase);
  const here = STAGE_ORDER.indexOf(key);
  if (active < 0) return "upcoming";
  if (here === active) return "current";
  if (here > active) return "upcoming";
  // here < active → the flow has moved past this step. It is "done" unless it was
  // genuinely bypassed on the recruit-FALSE branch.
  const recruitedNobody = state?.routing_score?.recruit === false;
  if (recruitedNobody && RECRUIT_DEPENDENT_STAGES.has(key)) return "skipped";
  return "done";
}

export function buildStageDetail(key: StageKey, state: ArbiterState | null, phase: string): StageDetail {
  const cfg = STAGE_CONFIG[key];
  const { findings, events, handshake } = gatherStageItems(key, state);

  return {
    key,
    label: cfg.label,
    blurb: cfg.blurb,
    org: cfg.org,
    agent: cfg.agent,
    status: stageStatus(key, phase, state),
    findings,
    events,
    handshake,
  };
}

/** Count of concrete detail items a step currently has (for the stepper badge). */
export function stageItemCount(detail: StageDetail): number {
  return detail.findings.length + detail.events.length + detail.handshake.length;
}
