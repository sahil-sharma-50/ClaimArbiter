import { deleteSession, fetchState, GatewayError, type ClaimSummary } from "@/dashboard/lib/api";
import { PHASES } from "@/dashboard/lib/phases";
import { getSessions, saveSessions, type SessionRecord } from "@/dashboard/lib/storage";

export const PHASE_LABELS: Record<string, string> = {
  idle: "Standby",
  intake: "Intake",
  coverage: "Coverage",
  evidence: "Evidence",
  recruiting: "Handoff",
  investigating: "Investigating",
  conflict: "Conflict",
  escalated: "Awaiting sign-off",
  signed: "Completed",
};

/**
 * Canonical phase order (excludes "idle", which isn't a claim outcome). Analytics
 * buckets iterate this so every possible session phase maps to exactly one bucket
 * and the counts reconcile to the total. The ordering is the single source in
 * dashboard/lib/phases.ts; re-exported here under its historical name.
 */
export const PHASE_SEQUENCE = PHASES;

/**
 * Phases that mean the claim ACTUALLY went through investigation. A claim can
 * reach "escalated"/"signed" without ever investigating (excluded coverage or a
 * clean claim that recruited nobody), so those are deliberately excluded — only
 * an in-flight investigation or a verdict-driven conflict proves it happened.
 */
export const INVESTIGATED_PHASES: ReadonlySet<string> = new Set(["investigating", "conflict"]);

export type SessionStats = {
  total: number;
  inProgress: number;
  awaitingSignOff: number;
  completed: number;
};

export function isInProgress(phase: string): boolean {
  return phase !== "idle" && phase !== "signed";
}

/** Compact "2m ago" style stamp for at-a-glance session recency. */
export function relativeTime(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function computeStats(sessions: SessionRecord[]): SessionStats {
  return {
    total: sessions.length,
    inProgress: sessions.filter((s) => isInProgress(s.phase)).length,
    awaitingSignOff: sessions.filter((s) => s.phase === "escalated").length,
    completed: sessions.filter((s) => s.phase === "signed").length,
  };
}

/** Partitioned live stats for the overview claim-load gauge. */
export type LiveStats = {
  total: number;
  inFlight: number;
  awaitingSignOff: number;
  completed: number;
};

export function computeLiveStatsFromRecords(records: SessionRecord[]): LiveStats {
  const completed = records.filter((s) => s.phase === "signed").length;
  const awaitingSignOff = records.filter((s) => s.phase === "escalated").length;
  return {
    total: records.length,
    completed,
    awaitingSignOff,
    inFlight: records.length - completed - awaitingSignOff,
  };
}

/** Merge a gateway claim with an optional local SessionRecord for table display. */
export function claimToSessionRecord(claim: ClaimSummary, local?: SessionRecord): SessionRecord {
  return {
    chatId: claim.chat_id,
    label: local?.label ?? `Claim ${claim.chat_id.slice(0, 8)}`,
    startedAt: local?.startedAt ?? local?.lastSyncedAt ?? new Date(0).toISOString(),
    phase: claim.phase,
    lastSyncedAt: local?.lastSyncedAt ?? new Date().toISOString(),
    decision: claim.decision ?? null,
  };
}

/**
 * Build the session list for tables. Uses gateway claims when available; falls
 * back to locally cached sessions while the first sync is pending or after an
 * error so tab switches don't flash empty.
 */
export function mergeClaimsWithSessions(
  claims: ClaimSummary[],
  sessions: SessionRecord[],
): SessionRecord[] {
  const localByChatId = new Map(sessions.map((s) => [s.chatId, s]));
  if (claims.length > 0) {
    return claims.map((c) => claimToSessionRecord(c, localByChatId.get(c.chat_id)));
  }
  return sessions;
}

export function recordSession(chatId: string): SessionRecord {
  const sessions = getSessions();
  const existing = sessions.find((s) => s.chatId === chatId);
  if (existing) return existing;

  const now = new Date().toISOString();
  const record: SessionRecord = {
    chatId,
    label: `Claim #${sessions.length + 1}`,
    startedAt: now,
    phase: "intake",
    lastSyncedAt: now,
  };
  saveSessions([record, ...sessions]);
  return record;
}

export function updateSessionPhase(chatId: string, phase: string): void {
  const sessions = getSessions();
  const idx = sessions.findIndex((s) => s.chatId === chatId);
  if (idx === -1) return;
  const now = new Date().toISOString();
  sessions[idx] = { ...sessions[idx], phase, lastSyncedAt: now };
  saveSessions(sessions);
}

export function removeSession(chatId: string): void {
  saveSessions(getSessions().filter((s) => s.chatId !== chatId));
}

export type ArchiveResult = {
  /** True when the gateway confirmed the Band room was archived too. */
  band: boolean;
};

/**
 * Archive a session everywhere: tell the gateway to close the Band room and
 * clear its state, then drop the local record. The local record is removed
 * regardless of the gateway result (an unreachable room is treated as gone),
 * but the returned `band` flag lets the UI flag a Band-side failure.
 */
export async function archiveSession(chatId: string): Promise<ArchiveResult> {
  let band = false;
  try {
    ({ band } = await deleteSession(chatId));
  } catch {
    band = false;
  } finally {
    removeSession(chatId);
  }
  return { band };
}

export async function refreshSessionPhases(
  sessions: SessionRecord[],
  concurrency = 5,
): Promise<SessionRecord[]> {
  if (sessions.length === 0) return [];

  const phaseById = new Map<string, Pick<SessionRecord, "phase" | "lastSyncedAt">>();
  // Rooms the gateway reports as gone (404/502 — Band can't serve them). These
  // are stale local records (e.g. from an older build) that will 502 forever if
  // we keep polling them, so we self-evict them from storage.
  const dead = new Set<string>();

  for (let i = 0; i < sessions.length; i += concurrency) {
    const batch = sessions.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (session) => {
        try {
          const state = await fetchState(session.chatId, false);
          phaseById.set(session.chatId, {
            phase: state.phase,
            lastSyncedAt: new Date().toISOString(),
          });
        } catch (err) {
          // A dead room (404/502) is pruned; any other error keeps last phase.
          if (err instanceof GatewayError && (err.status === 404 || err.status === 502)) {
            dead.add(session.chatId);
          }
        }
      }),
    );
  }

  // Re-read storage so a concurrent archive/delete is not overwritten.
  const current = getSessions();
  const refreshed = current
    .filter((session) => !dead.has(session.chatId))
    .map((session) => {
      const patch = phaseById.get(session.chatId);
      return patch ? { ...session, ...patch } : session;
    });
  saveSessions(refreshed);
  return refreshed;
}

export type SessionFilter = "all" | "in_progress" | "escalated" | "completed";

export function filterSessions(sessions: SessionRecord[], filter: SessionFilter): SessionRecord[] {
  switch (filter) {
    case "in_progress":
      return sessions.filter((s) => isInProgress(s.phase));
    case "escalated":
      return sessions.filter((s) => s.phase === "escalated");
    case "completed":
      return sessions.filter((s) => s.phase === "signed");
    default:
      return sessions;
  }
}

export function searchSessions(sessions: SessionRecord[], query: string): SessionRecord[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter(
    (s) => s.label.toLowerCase().includes(q) || s.chatId.toLowerCase().includes(q),
  );
}

const FILTER_VALUES: readonly SessionFilter[] = ["all", "in_progress", "escalated", "completed"];

/** Parse a `?filter=` query value into a SessionFilter, defaulting to "all". */
export function filterFromQuery(param: string | null): SessionFilter {
  return FILTER_VALUES.includes(param as SessionFilter) ? (param as SessionFilter) : "all";
}

/** Serialize a SessionFilter for the URL. "all" is the default, so it returns undefined. */
export function filterToQuery(filter: SessionFilter): string | undefined {
  return filter === "all" ? undefined : filter;
}

/**
 * Exact-phase deep-link (`?phase=`), distinct from the lifecycle-bucket chips.
 * The dashboard pipeline links here so a stage drills into precisely the claims
 * sitting in that phase. Returns null for an unknown/absent value.
 */
export function phaseFromQuery(param: string | null): string | null {
  return param && param in PHASE_LABELS ? param : null;
}

/** Narrow to a single exact phase. */
export function filterByPhase(sessions: SessionRecord[], phase: string): SessionRecord[] {
  return sessions.filter((s) => s.phase === phase);
}
