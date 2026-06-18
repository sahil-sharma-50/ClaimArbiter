"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { seedDemo, CLAIM_PRESETS, type ClaimPreset } from "@/dashboard/lib/api";
import { PHASE_LABELS, recordSession } from "@/dashboard/lib/sessions";
import { missingRequiredKeys } from "@/dashboard/lib/settings";
import { usePlatformSync } from "@/dashboard/lib/usePlatformSync";
import { usePlatformSyncState } from "@/dashboard/components/platform/PlatformSyncContext";

/**
 * Shown on /app/live when no chat_id is selected. Presents the preset
 * claims as pick-to-run cards (each routes a different claim domain so the
 * Case Coordinator recruits a different specialist — property, medical, or legal),
 * plus a lean list of recent sessions to resume.
 */
export function ClaimPicker() {
  const router = useRouter();
  const { sessions, claims, syncing, hydrated, lastSyncedAt, error: syncError } = usePlatformSync();
  const { gatewayOk, keysRequired } = usePlatformSyncState();

  const [seeding, setSeeding] = useState<ClaimPreset["id"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offline = gatewayOk === false;
  const recent = useMemo(() => {
    // After a successful gateway sync, only list sessions the server still knows about.
    if (lastSyncedAt && !syncError) {
      const liveIds = new Set(claims.map((c) => c.chat_id));
      return sessions.filter((s) => liveIds.has(s.chatId)).slice(0, 6);
    }
    return sessions.slice(0, 6);
  }, [sessions, claims, lastSyncedAt, syncError]);

  async function handleStart(claimType: ClaimPreset["id"]) {
    // When the server has no fallback keys, a visitor must bring AI/ML + Featherless
    // keys (stored in this browser) before a run can spawn agents.
    const keyError = missingRequiredKeys(keysRequired);
    if (keyError) {
      setError(keyError);
      return;
    }
    setSeeding(claimType);
    setError(null);
    try {
      const { chat_id } = await seedDemo(claimType);
      recordSession(chat_id);
      router.push(`/app/live?chat_id=${encodeURIComponent(chat_id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start demo");
      setSeeding(null);
    }
  }

  const presetGrid = (
    <div className="claim-preset-grid stagger">
      {CLAIM_PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className="claim-preset-card"
          onClick={() => void handleStart(preset.id)}
          disabled={seeding !== null || offline}
          data-recruits="yes"
        >
          <span className="claim-preset-domain">{preset.domain}</span>
          <span className="claim-preset-label">{preset.label}</span>
          <span className="claim-preset-blurb">{preset.blurb}</span>
          <span className="claim-preset-outcome">
            {seeding === preset.id ? "Starting…" : preset.outcome}
            <span className="platform-cta-arrow" aria-hidden> →</span>
          </span>
        </button>
      ))}
    </div>
  );

  if (hydrated && sessions.length === 0) {
    return (
      <div className="claim-picker">
        {offline && (
          <p className="platform-error" role="status">
            Gateway offline. Start a demo once the backend is reachable.
          </p>
        )}
        {error && (
          <p className="platform-error" role="alert">
            {error}
          </p>
        )}
        {presetGrid}
      </div>
    );
  }

  return (
    <div className="claim-picker">
      {offline && (
        <p className="platform-error" role="status">
          Gateway offline. Cached sessions are still readable; presets are disabled.
        </p>
      )}
      {error && (
        <p className="platform-error" role="alert">
          {error}
        </p>
      )}

      {presetGrid}

      {recent.length > 0 && (
        <>
          <p className="claim-picker-sub" style={{ marginTop: "1.5rem" }}>
            Resume a recent session
          </p>
          <ul className="claim-picker-list stagger">
            {recent.map((s) => (
              <li key={s.chatId}>
                <button
                  type="button"
                  className="claim-picker-row"
                  onClick={() => router.push(`/app/live?chat_id=${encodeURIComponent(s.chatId)}`)}
                >
                  <span className="claim-picker-row-main">
                    <span className="session-link-title">{s.label}</span>
                    <span className="session-link-id">{s.chatId.slice(0, 10)}…</span>
                  </span>
                  <span className="claim-picker-row-phase">{PHASE_LABELS[s.phase] ?? s.phase}</span>
                  <span className="platform-cta-arrow" aria-hidden>
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Link href="/app/sessions" className="platform-text-link">
        View all sessions
      </Link>
    </div>
  );
}
