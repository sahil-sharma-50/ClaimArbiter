"use client";

import { usePlatformSyncState } from "@/dashboard/components/platform/PlatformSyncContext";

/**
 * The single sync surface in the header. Syncing happens silently in the
 * background: the chip rests on "Live" and only changes when something really
 * happens — the gateway going offline. No per-poll "Syncing" flicker, no
 * relative-time readout that ticks on every fetch.
 */
export function SyncIndicator() {
  const { gatewayOk } = usePlatformSyncState();

  const offline = gatewayOk === false;
  const state = offline ? "off" : "ok";
  const label = offline ? "Offline" : "Live";
  const detail = offline ? "cached" : null;

  return (
    <span
      className="platform-status-pill"
      data-state={state}
      data-variant="sync"
      aria-live="polite"
    >
      <span className="platform-status-dot" aria-hidden />
      <span className="platform-status-label">{label}</span>
      {detail && <span className="platform-status-detail">{detail}</span>}
    </span>
  );
}
