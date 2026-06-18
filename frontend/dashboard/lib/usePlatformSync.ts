"use client";

import { useContext } from "react";
import type { ClaimSummary } from "@/dashboard/lib/api";
import type { SessionRecord } from "@/dashboard/lib/storage";
import { PlatformSyncDataContext } from "@/dashboard/components/platform/PlatformSyncContext";

export type PlatformSync = {
  /** Sessions for this browser. Painted instantly from localStorage, then refreshed. */
  sessions: SessionRecord[];
  /**
   * Authoritative live claims from the gateway (phase/specialist/counts). The
   * source of truth for the home + sessions UIs; localStorage `SessionRecord`s
   * only contribute the human-friendly label/startedAt for claims this browser
   * started. Defaults to [] and is preserved across a failed refresh.
   */
  claims: ClaimSummary[];
  /** True only while a gateway refresh is in flight. */
  syncing: boolean;
  /** False until localStorage has been read. Drives cold-load skeletons. */
  hydrated: boolean;
  /** ISO timestamp of the last successful gateway refresh, or null if none yet. */
  lastSyncedAt: string | null;
  /** Set when the gateway refresh fails. Does NOT clear cached sessions or claims. */
  error: string | null;
  /** Re-run the gateway refresh. */
  refresh: () => Promise<void>;
};

const FALLBACK: PlatformSync = {
  sessions: [],
  claims: [],
  syncing: false,
  hydrated: false,
  lastSyncedAt: null,
  error: null,
  refresh: async () => {},
};

/** Read shared gateway sync state (lifted to PlatformShell so it survives tab changes). */
export function usePlatformSync(): PlatformSync {
  const ctx = useContext(PlatformSyncDataContext);
  return ctx ?? FALLBACK;
}
