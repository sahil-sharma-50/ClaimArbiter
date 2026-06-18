"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { fetchClaims, type ClaimSummary } from "@/dashboard/lib/api";
import { refreshSessionPhases } from "@/dashboard/lib/sessions";
import {
  getSessions,
  SESSIONS_CHANGED_EVENT,
  type SessionRecord,
} from "@/dashboard/lib/storage";
import type { PlatformSync } from "@/dashboard/lib/usePlatformSync";

export type PageSyncState = {
  /** True while the active page is refreshing from the gateway. */
  syncing: boolean;
  /** ISO timestamp of the page's last successful sync, or null. */
  lastSyncedAt: string | null;
};

export type RouteTelemetrySlot = {
  key: string;
  value: string;
} | null;

/** Shared claims/sessions sync — one instance for the whole /app shell. */
export const PlatformSyncDataContext = createContext<PlatformSync | null>(null);

type PlatformSyncContextValue = PageSyncState & {
  gatewayOk: boolean | null;
  keysRequired: boolean;
  liveActive: boolean;
  routeSlot: RouteTelemetrySlot;
  setPageSync: (state: PageSyncState) => void;
  setLiveActive: (active: boolean) => void;
  setRouteSlot: (slot: RouteTelemetrySlot) => void;
};

const PlatformSyncContext = createContext<PlatformSyncContextValue | null>(null);

function readCachedSessions(): SessionRecord[] {
  if (typeof window === "undefined") return [];
  return getSessions();
}

/**
 * Single gateway sync loop for the platform shell. State survives route changes
 * so tab switches don't reset claims to empty while refetching.
 */
function usePlatformSyncEngine(): PlatformSync {
  const [sessions, setSessions] = useState<SessionRecord[]>(readCachedSessions);
  const [claims, setClaims] = useState<ClaimSummary[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [hydrated, setHydrated] = useState(() => typeof window !== "undefined");
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const cached = getSessions();
    setSessions(cached);

    setSyncing(true);
    setError(null);
    try {
      const [liveClaims] = await Promise.all([
        fetchClaims(),
        cached.length === 0
          ? Promise.resolve(cached)
          : refreshSessionPhases(cached).then((refreshed) => {
              setSessions(refreshed);
              return refreshed;
            }),
      ]);
      setClaims(liveClaims);
      setLastSyncedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the gateway");
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    setSessions(getSessions());
    setHydrated(true);
    void refresh();
    const t = setInterval(() => {
      void refresh();
    }, 5000);
    const onSessionsChanged = () => setSessions(getSessions());
    window.addEventListener(SESSIONS_CHANGED_EVENT, onSessionsChanged);
    return () => {
      clearInterval(t);
      window.removeEventListener(SESSIONS_CHANGED_EVENT, onSessionsChanged);
    };
  }, [refresh]);

  return { sessions, claims, syncing, hydrated, lastSyncedAt, error, refresh };
}

export function PlatformSyncProvider({
  gatewayOk,
  keysRequired = false,
  children,
}: {
  gatewayOk: boolean | null;
  keysRequired?: boolean;
  children: React.ReactNode;
}) {
  const syncData = usePlatformSyncEngine();
  const [pageSync, setPageSync] = useState<PageSyncState>({
    syncing: false,
    lastSyncedAt: null,
  });
  const [liveActive, setLiveActive] = useState(false);
  const [routeSlot, setRouteSlot] = useState<RouteTelemetrySlot>(null);

  // Keep the telemetry rail in sync with the shared gateway poll.
  useEffect(() => {
    setPageSync({
      syncing: syncData.syncing,
      lastSyncedAt: syncData.lastSyncedAt,
    });
  }, [syncData.syncing, syncData.lastSyncedAt]);

  const value = useMemo<PlatformSyncContextValue>(
    () => ({
      ...pageSync,
      gatewayOk,
      keysRequired,
      liveActive,
      routeSlot,
      setPageSync,
      setLiveActive,
      setRouteSlot,
    }),
    [pageSync, gatewayOk, keysRequired, liveActive, routeSlot],
  );

  return (
    <PlatformSyncDataContext.Provider value={syncData}>
      <PlatformSyncContext.Provider value={value}>{children}</PlatformSyncContext.Provider>
    </PlatformSyncDataContext.Provider>
  );
}

export function usePlatformSyncState(): PlatformSyncContextValue {
  const ctx = useContext(PlatformSyncContext);
  if (!ctx) {
    return {
      syncing: false,
      lastSyncedAt: null,
      gatewayOk: null,
      keysRequired: false,
      liveActive: false,
      routeSlot: null,
      setPageSync: () => {},
      setLiveActive: () => {},
      setRouteSlot: () => {},
    };
  }
  return ctx;
}

/**
 * Publish a page's live sync state to the telemetry rail. Prefer the shared
 * provider poll; use this only when a page has its own sync loop.
 */
export function usePublishSync(syncing: boolean, lastSyncedAt: string | null): void {
  const { setPageSync } = usePlatformSyncState();
  useEffect(() => {
    setPageSync({ syncing, lastSyncedAt });
  }, [syncing, lastSyncedAt, setPageSync]);
}

export function usePublishLiveActive(active: boolean): void {
  const { setLiveActive } = usePlatformSyncState();
  useEffect(() => {
    setLiveActive(active);
    return () => setLiveActive(false);
  }, [active, setLiveActive]);
}

export function usePublishRouteSlot(key: string, value: string | null): void {
  const { setRouteSlot } = usePlatformSyncState();
  useEffect(() => {
    setRouteSlot(value ? { key, value } : null);
    return () => setRouteSlot(null);
  }, [key, value, setRouteSlot]);
}
