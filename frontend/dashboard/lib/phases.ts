/**
 * The single canonical claim-phase ordering for the console.
 *
 * The gateway reports `state.phase` as one of these strings (it is the forward
 * ordering of the backend's casefile `_PHASE_PRIORITY`, which lists furthest-along
 * first). This ordering previously lived copy-pasted in six places — live/page's
 * FLOW, stageDetails' STAGE_ORDER, mock's MOCK_PHASE_SEQUENCE, sessions'
 * PHASE_SEQUENCE, parts' PHASE_ORDER, and mock's MockPhase union — so adding or
 * reordering a phase meant six edits, and `phase` being a bare `string` meant a typo
 * was invisible. This module is the one source: change the order here and every
 * importer follows.
 *
 * Two views, because the console genuinely needs both:
 *   - PHASES         the eight claim phases, in order (what a claim moves through).
 *   - PHASES_WITH_IDLE  the same, prefixed with "idle" — the console's resting state
 *                       before any claim is loaded. Not a claim outcome, so analytics
 *                       and the stepper use PHASES; the live view and mock harness,
 *                       which render the standby screen, use PHASES_WITH_IDLE.
 *
 * Keep in lockstep with backend/agents/shared/casefile.py `_PHASE_PRIORITY`.
 */

/** The eight claim phases, earliest → latest. Excludes the non-claim "idle" state. */
export const PHASES = [
  "intake",
  "coverage",
  "evidence",
  "recruiting",
  "investigating",
  "conflict",
  "escalated",
  "signed",
] as const;

/**
 * Operator stepper steps — the six milestones an adjuster tracks. ``conflict`` and
 * ``escalated`` remain backend phases (Band casefile) but are omitted here:
 * conflict is conditional and almost always skipped; escalation is folded into
 * Sign-off because that is when the human decides.
 */
export const STEPPER_PHASES = [
  "intake",
  "coverage",
  "evidence",
  "recruiting",
  "investigating",
  "signed",
] as const;

export type StepperPhase = (typeof STEPPER_PHASES)[number];

/** A claim phase reported by the gateway in `state.phase`. */
export type Phase = (typeof PHASES)[number];

/** The console's resting state before a claim is loaded — not a claim outcome. */
export const IDLE = "idle";

/** PHASES prefixed with "idle" — the full set of console states the UI can show. */
export const PHASES_WITH_IDLE = [IDLE, ...PHASES] as const;

/** A console state: a claim Phase, or "idle". */
export type PhaseWithIdle = (typeof PHASES_WITH_IDLE)[number];

/**
 * Index of a phase in PHASES_WITH_IDLE (so "idle" is 0 and the claim phases follow).
 * Unknown/blank phases clamp to 0 (idle), matching the prior PHASE_ORDER behavior.
 */
export function phaseIndex(p: string): number {
  const i = (PHASES_WITH_IDLE as readonly string[]).indexOf(p);
  return i < 0 ? 0 : i;
}

/** True if `v` is one of the eight claim phases. */
export function isPhase(v: string): v is Phase {
  return (PHASES as readonly string[]).includes(v);
}
