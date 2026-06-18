import type { CasefileEntry, HandshakeEvent } from "@/dashboard/lib/api";

/** Highest handshake step reached (0=request … 3=joined). */
export function handshakeStepFromEvents(events: HandshakeEvent[]): number {
  return events.reduce((acc, e) => {
    const s = e.step.toLowerCase();
    const c = e.content.toLowerCase();
    if (s.includes("join") || c.includes("joined the room") || c.includes("joined room")) {
      return Math.max(acc, 3);
    }
    if (s.includes("approv") || c.includes("approved") || c.includes("auto-approv")) {
      return Math.max(acc, 2);
    }
    if (
      s.includes("recruit") ||
      s.includes("consent") ||
      c.includes("crossing") ||
      c.includes("trust boundary")
    ) {
      return Math.max(acc, 1);
    }
    if (s.includes("contact") || s.includes("request") || c.includes("contact request")) {
      return Math.max(acc, 0);
    }
    return acc;
  }, 0);
}

function recruitingFinding(findings: CasefileEntry[]): CasefileEntry | undefined {
  return findings.find((c) => c.stage === "recruiting");
}

/** Infer progress from the authoritative recruiting casefile entry. */
export function handshakeStepFromCasefile(findings: CasefileEntry[]): number {
  const rec = recruitingFinding(findings);
  if (!rec) return 0;
  const result = rec.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    const joined = (result as Record<string, unknown>).joined;
    if (joined === true) return 3;
    if ((result as Record<string, unknown>).handle || (result as Record<string, unknown>).name) {
      return 2;
    }
  }
  if (rec.summary && /recruited/i.test(rec.summary)) return 3;
  return 1;
}

/**
 * Resolve the handshake stepper position from handshake events, casefile, and
 * whether a specialist participant is present in the room.
 */
export function resolveHandshakeStep(
  handshake: HandshakeEvent[],
  findings: CasefileEntry[],
  opts?: { specialistJoined?: boolean },
): number {
  let step = Math.max(handshakeStepFromEvents(handshake), handshakeStepFromCasefile(findings));
  if (opts?.specialistJoined) step = Math.max(step, 3);
  return step;
}

/** Step marker: check when complete, number when pending/current. */
export function handshakeStepMarker(index: number, step: number): string {
  const completed = step >= 3 ? 4 : step;
  return index < completed ? "✓" : String(index + 1);
}
