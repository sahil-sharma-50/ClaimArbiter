"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  archiveSession,
  filterByPhase,
  filterFromQuery,
  filterSessions,
  filterToQuery,
  mergeClaimsWithSessions,
  PHASE_LABELS,
  phaseFromQuery,
  searchSessions,
  type SessionFilter,
} from "@/dashboard/lib/sessions";
import { usePlatformSync } from "@/dashboard/lib/usePlatformSync";
import { usePublishLiveActive, usePublishRouteSlot } from "@/dashboard/components/platform/PlatformSyncContext";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { PlatformPageLoading } from "@/dashboard/components/platform/PlatformPageLoading";
import { SessionFilters } from "@/dashboard/components/platform/SessionFilters";
import { SessionTable } from "@/dashboard/components/platform/SessionTable";
import { ConfirmDialog } from "@/dashboard/components/platform/ConfirmDialog";

function SessionsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filter = filterFromQuery(searchParams.get("filter"));
  // Exact-phase deep-link from the dashboard pipeline. When present it takes
  // precedence over the bucket chips (you came here for one specific phase).
  const phase = phaseFromQuery(searchParams.get("phase"));

  const { sessions, claims, syncing, refresh } = usePlatformSync();

  const [query, setQuery] = useState("");
  const [localSessions, setLocalSessions] = useState<string[]>([]);
  const [removing, setRemoving] = useState<string | null>(null);
  // chatId the user clicked "Remove" on, awaiting confirmation in the dialog.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // The gateway's live claims are the authoritative list; local SessionRecords
  // only lend the human-friendly label/startedAt. Synthesize SessionRecord-shaped
  // rows so the filter/search helpers and SessionTable keep their contracts.
  const mergedSessions = useMemo(
    () => mergeClaimsWithSessions(claims, sessions),
    [claims, sessions],
  );

  // Removed chatIds tracked locally so a remove reflects instantly without a refetch.
  const visibleSessions = mergedSessions.filter((s) => !localSessions.includes(s.chatId));
  const openCount = visibleSessions.filter((s) => s.phase !== "signed" && s.phase !== "idle").length;

  usePublishLiveActive(openCount > 0);
  usePublishRouteSlot("OPEN", `${openCount} open`);

  const scoped = phase
    ? filterByPhase(visibleSessions, phase)
    : filterSessions(visibleSessions, filter);
  const filtered = searchSessions(scoped, query);

  const setFilter = useCallback(
    (next: SessionFilter) => {
      // Choosing a bucket chip clears any exact-phase deep-link.
      const q = filterToQuery(next);
      router.replace(q ? `${pathname}?filter=${q}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // Clear the exact-phase scope, returning to the bucket-chip view.
  const clearPhase = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // A row's "Remove" opens the confirm dialog; the destructive work waits for it.
  function handleRemove(chatId: string) {
    if (removing) return;
    setPendingDelete(chatId);
  }

  async function confirmRemove() {
    const chatId = pendingDelete;
    if (!chatId) return;

    setRemoving(chatId);
    // Optimistic: hide immediately, then archive in Band + gateway.
    setLocalSessions((prev) => [...prev, chatId]);
    try {
      await archiveSession(chatId);
      await refresh();
    } finally {
      setRemoving(null);
      setPendingDelete(null);
    }
  }

  // Human-friendly label for the claim awaiting deletion (for the dialog copy).
  const pendingLabel = pendingDelete
    ? (visibleSessions.find((s) => s.chatId === pendingDelete)?.label ??
      `Claim ${pendingDelete.slice(0, 8)}`)
    : null;

  const filteredEmpty =
    filtered.length === 0 &&
    visibleSessions.length > 0 &&
    (query.trim() !== "" || phase !== null || filter !== "all");

  return (
    <div className="platform-page">
      <PlatformPageBrief
        kicker="Sessions"
        live={syncing}
        title="Claim history"
        sub="Every claim this browser has touched, synced from the gateway. Open any session in the live view or archive ones you are done with."
      />
      <div className="platform-toolbar">
        {phase ? (
          <button
            type="button"
            className="session-phase-pill"
            onClick={clearPhase}
            aria-label={`Clear phase filter: ${PHASE_LABELS[phase]}`}
          >
            <span className="session-phase-pill-label">Phase</span>
            {PHASE_LABELS[phase]}
            <span className="session-phase-pill-x" aria-hidden>
              ×
            </span>
          </button>
        ) : (
          <SessionFilters active={filter} onChange={setFilter} />
        )}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by label or id"
          className="platform-search"
          aria-label="Search sessions"
        />
        <button
          type="button"
          className="btn btn-secondary platform-toolbar-action"
          onClick={() => void refresh()}
          disabled={syncing}
          aria-label="Refresh session status"
        >
          {syncing ? "Syncing…" : "Refresh"}
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {filtered.length} {filtered.length === 1 ? "session" : "sessions"}
      </p>

      <SessionTable
        sessions={filtered}
        onRemove={handleRemove}
        removingChatId={removing}
        syncing={syncing}
        filteredEmpty={filteredEmpty}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this claim?"
        body={
          <>
            <strong>{pendingLabel}</strong> will be archived in Band and cleared from the
            console. The audit trail is preserved. This only removes it from your active
            list.
          </>
        }
        meta={pendingDelete ? `Room ${pendingDelete}` : undefined}
        confirmLabel="Remove claim"
        busyLabel="Removing…"
        busy={removing !== null}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default function SessionsPage() {
  return (
    <Suspense fallback={<PlatformPageLoading label="Loading sessions…" />}>
      <SessionsContent />
    </Suspense>
  );
}
