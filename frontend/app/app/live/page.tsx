"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { History, TriangleAlert } from "lucide-react";
import type { ArbiterState } from "@/dashboard/lib/api";
import { usePublishLiveActive, usePublishRouteSlot, usePlatformSyncState } from "@/dashboard/components/platform/PlatformSyncContext";
import { useArbiterState } from "@/dashboard/lib/useArbiterState";
import { Stage } from "@/dashboard/components/Stage";
import { OrgRail } from "@/dashboard/components/OrgRail";
import { AuditTicker } from "@/dashboard/components/AuditTicker";
import { ClaimPicker } from "@/dashboard/components/platform/ClaimPicker";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { PlatformPageKicker } from "@/dashboard/components/platform/PlatformPageKicker";
import { PlatformPageLoading } from "@/dashboard/components/platform/PlatformPageLoading";
import { Icon } from "@/dashboard/components/ui/Icon";
import { usePlatformSync } from "@/dashboard/lib/usePlatformSync";
import { ReplayPlayer } from "@/dashboard/components/replay/ReplayPlayer";
import type { Replay } from "@/dashboard/lib/replay";
import { stageStatus, stepperActivePhase, type StageKey } from "@/dashboard/lib/stageDetails";
import { STEPPER_PHASES } from "@/dashboard/lib/phases";

// The one canned replay (a property-claim run) lives as a static public asset, so
// the scrub works even when the gateway is down. The asset is produced by a
// separate capture task; a missing file is handled gracefully below.
const REPLAY_ID = "property";
const REPLAY_ASSET = "/replays/property.json";

// Stepper steps come from the canonical phase ordering (dashboard/lib/phases.ts);
// only the short stepper labels are local to this view.
const STEP_LABELS: Record<StageKey, string> = {
  intake: "Intake",
  coverage: "Coverage",
  evidence: "Evidence",
  recruiting: "Handoff",
  investigating: "Investigate",
  conflict: "Conflict",
  escalated: "Escalate",
  signed: "Sign-off",
};
const FLOW = STEPPER_PHASES.map((key) => ({ key, label: STEP_LABELS[key] }));

const PHASE_LABELS: Record<string, string> = {
  idle: "Standby",
  intake: "Intake",
  coverage: "Coverage",
  evidence: "Analyzing evidence",
  recruiting: "Recruiting specialist",
  investigating: "Investigating",
  conflict: "Resolving conflict",
  escalated: "Awaiting your decision",
  signed: "Decision signed",
};

function LiveClaimContent() {
  const params = useSearchParams();
  const chatIdParam = params.get("chat_id");
  const replayParam = params.get("replay");

  // Quiet demo-day safety net: `?replay=property` short-circuits the live path
  // entirely and scrubs a recorded run from a static asset (works gateway-down).
  if (replayParam === REPLAY_ID) {
    return <ReplayView />;
  }

  // No claim selected: show the picker instead of an empty console.
  if (!chatIdParam) {
    return <ClaimPicker />;
  }

  return <LiveConsole key={chatIdParam} chatIdParam={chatIdParam} />;
}

/**
 * Loads the static replay asset client-side and scrubs it via ReplayPlayer (no
 * autoLoop, so the Transport shows). The asset is a public file produced by a
 * later capture task — until it exists the fetch 404s, which we render as a
 * quiet notice rather than crashing.
 */
function ReplayView() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(REPLAY_ASSET)
      .then((r) => {
        if (!r.ok) throw new Error(`replay asset ${r.status}`);
        return r.json() as Promise<Replay>;
      })
      .then((data) => {
        if (!cancelled) setReplay(data);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative text-[var(--text)]">
      {missing ? (
        <div className="platform-empty">
          <p className="platform-empty-title">No replay recorded yet</p>
          <p className="platform-empty-body">
            The canned walkthrough hasn&apos;t been captured. Run a live claim, or
            check back once a recording is published.
          </p>
        </div>
      ) : replay ? (
        <ReplayPlayer replay={replay} />
      ) : (
        <p className="platform-notice">Loading replay…</p>
      )}
    </div>
  );
}

function LiveConsole({ chatIdParam }: { chatIdParam: string }) {
  const router = useRouter();
  const { sessions, hydrated } = usePlatformSync();
  const { liveActive } = usePlatformSyncState();
  const { state, phase, conn, chatId, degraded, notFound, runDemo, refresh, downloadReplay } =
    useArbiterState(chatIdParam);

  // A stale/dead room id in the URL (Band 404) can't be acted on — sending a
  // sign-off there is what 422'd the gateway. Drop the bad chat_id and fall back to
  // the claim picker instead of rendering a console for a room that doesn't exist.
  useEffect(() => {
    if (notFound) router.replace("/app/live");
  }, [notFound, router]);

  const sessionLabel = hydrated
    ? (sessions.find((s) => s.chatId === chatIdParam)?.label ?? `Claim ${chatIdParam.slice(0, 8)}`)
    : "Live coordination";

  const seeding = conn === "seeding";
  const started = phase !== "idle" || seeding;
  const readOnly = phase === "signed";
  const heat = heatFor(phase);

  // The header wave only animates while the claim is actively progressing. It
  // freezes (static, dim) when idle, awaiting the human, signed, or the gateway
  // is unreachable/degraded.
  const isWorking =
    conn !== "error" && !degraded &&
    !["idle", "escalated", "signed"].includes(phase);

  usePublishLiveActive(isWorking || (started && phase !== "signed"));
  usePublishRouteSlot("PHASE", PHASE_LABELS[phase] ?? phase);

  // Which stage the operator has clicked to view in the Stage card (null = none).
  const [viewing, setViewing] = useState<StageKey | null>(null);

  // Keep the audit rail the same height as Stage + Agent band (left column).
  const leftColRef = useRef<HTMLDivElement>(null);
  const [leftColHeight, setLeftColHeight] = useState<number | null>(null);
  const [wideLayout, setWideLayout] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const syncLayout = () => setWideLayout(mq.matches);
    syncLayout();
    mq.addEventListener("change", syncLayout);
    return () => mq.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    const el = leftColRef.current;
    if (!el || !wideLayout) {
      setLeftColHeight(null);
      return;
    }
    const sync = () => setLeftColHeight(Math.round(el.getBoundingClientRect().height));
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wideLayout, started, viewing, phase, state?.participants?.length, state?.audit?.length]);

  // Redirecting away from a dead room — show a quiet notice rather than a console
  // hydrated with empty/stale data for the one frame before the route changes.
  if (notFound) {
    return (
      <div className="platform-notice" role="status">
        This claim room is no longer available. Returning to your claims…
      </div>
    );
  }

  return (
    <div
      className="relative text-[var(--text)]"
      style={{ ["--heat" as string]: heat }}
    >
      <div className="aura absolute inset-0 pointer-events-none" aria-hidden />
      <div className={`live-wave${isWorking ? "" : " is-frozen"}`} aria-hidden>
        {Array.from({ length: 24 }).map((_, n) => (
          <span key={n} style={{ animationDelay: `${(n * 0.06).toFixed(2)}s` }} />
        ))}
      </div>

      <div className="relative z-10">
        <header className="live-claim-header">
          <div className="live-claim-title-row">
            <div className="live-claim-title-block">
              <PlatformPageKicker live={liveActive}>Live</PlatformPageKicker>
              <h1 className="live-claim-title">{sessionLabel}</h1>
              <p className="live-claim-room">
                Room {chatIdParam.slice(0, 12)}…
                {started && <ClaimTimer state={state} phase={phase} />}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* Capture-only: present solely when opened with ?capture=1 (dev/demo).
                  Exports the recorded frames to replay-<id>.json — rename to
                  property.json and drop into frontend/public/replays/. */}
              {downloadReplay && (
                <button
                  type="button"
                  className="btn btn-secondary live-claim-replay"
                  onClick={downloadReplay}
                  title="Download captured replay JSON"
                >
                  <Icon as={History} size={14} /> Save capture
                </button>
              )}
            </div>
          </div>

          {readOnly && <div className="live-console-notice" aria-hidden />}
        </header>

        {conn === "error" && !degraded && (
          <p
            className="mb-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--danger-subtle)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--danger)]"
            role="alert"
          >
            <WarnIcon />
            <span>Can&apos;t reach the gateway. Make sure the backend is running.</span>
          </p>
        )}

        <div className="grid gap-5 md:grid-cols-12 md:items-start">
          <div ref={leftColRef} className="space-y-5 md:col-span-8">
            <div className="live-stage-stack">
              <PhaseStepper
                phase={phase}
                state={state}
                openStage={viewing}
                onSelect={(k) =>
                  // Sign-off IS the decision screen — selecting it closes any open
                  // stage detail and returns there (it replaces the old "Back to
                  // decision" button). Every other tab toggles its detail card.
                  setViewing((cur) => (k === "signed" || cur === k ? null : k))
                }
              />
              <Stage
                state={state}
                phase={phase}
                chatId={chatId}
                degraded={degraded}
                onRun={() => void runDemo()}
                seeding={seeding}
                onAction={refresh}
                readOnly={readOnly}
                viewing={viewing}
              />
            </div>
            {started && <OrgRail participants={state?.participants ?? []} />}
          </div>
          <div className="md:col-span-4">
            <div
              className="live-audit-rail md:sticky md:top-6"
              style={wideLayout && leftColHeight ? { height: leftColHeight } : undefined}
            >
              <AuditTicker
                entries={state?.audit ?? []}
                chatId={chatId}
                bandUrl={state?.band_url ?? null}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LiveClaimPage() {
  return (
    <Suspense fallback={<PlatformPageLoading label="Loading console…" />}>
      <LivePageShell />
    </Suspense>
  );
}

function LivePageShell() {
  const router = useRouter();
  const params = useSearchParams();
  const chatId = params.get("chat_id");
  const replay = params.get("replay");
  const { liveActive } = usePlatformSyncState();
  const { sessions, hydrated } = usePlatformSync();

  const hasRecent = hydrated && sessions.length > 0;
  const sessionLabel = chatId
    ? (sessions.find((s) => s.chatId === chatId)?.label ?? `Claim ${chatId.slice(0, 8)}`)
    : null;

  let title: string;
  let sub: string;
  let actions: ReactNode;

  if (replay === REPLAY_ID) {
    title = "Replay a recorded run";
    sub = "Scrub a captured property-claim demo. Works even when the gateway is down.";
    actions = (
      <button type="button" className="btn btn-secondary" onClick={() => router.push("/app/live")}>
        Exit replay
      </button>
    );
  } else if (chatId) {
    title = sessionLabel ?? "Live coordination";
    sub = `Room ${chatId.slice(0, 12)}…`;
    actions = undefined;
  } else {
    title = "Run a claim";
    sub = hasRecent
      ? "Pick a preset to start a fresh run, or resume a recent session below."
      : "Pick a preset. Each routes to a different specialist (or none), live through Band.";
    actions = undefined;
  }

  return (
    <div className={`platform-page live-page${chatId ? " live-page--active" : ""}`}>
      {!chatId && (
        <PlatformPageBrief
          kicker="Live"
          live={liveActive}
          title={title}
          sub={sub}
          actions={actions}
        />
      )}
      <LiveClaimContent />
    </div>
  );
}

function heatFor(phase: string): number {
  switch (phase) {
    case "recruiting":
      return 1;
    case "conflict":
      return 0.95;
    case "investigating":
      return 0.8;
    case "evidence":
      return 0.55;
    case "escalated":
      return 0.6;
    case "signed":
      return 0.3;
    case "coverage":
      return 0.15;
    default:
      return 0;
  }
}

/**
 * Live "intake → verdict" clock. Measures the wall-clock the cross-org
 * coordination actually took: it starts at the earliest casefile timestamp
 * (intake) and freezes the moment the specialist verdict lands — so the number
 * is the AI coordination time, not the human's deliberation that follows.
 *
 * While the claim is still working it ticks once a second off the wall clock
 * (state already re-polls every 1.5s; this just keeps the seconds digit moving
 * between polls). Once frozen it renders a static elapsed value.
 */
function ClaimTimer({ state, phase }: { state: ArbiterState | null; phase: string }) {
  const startMs = useMemo(() => {
    const stamps = (state?.casefile ?? [])
      .map((e) => (e.ts ? Date.parse(e.ts) : NaN))
      .filter((n) => !Number.isNaN(n));
    return stamps.length ? Math.min(...stamps) : null;
  }, [state?.casefile]);

  // The verdict timestamp freezes the clock. Prefer the specialist verdict
  // event; fall back to the latest casefile stamp once the claim has settled.
  const endMs = useMemo(() => {
    const cf = state?.casefile ?? [];
    const verdict = cf.find(
      (e) => e.stage === "specialist_verdict" || e.stage === "fraud_verdict",
    );
    if (verdict?.ts) return Date.parse(verdict.ts);
    if (phase === "escalated" || phase === "signed") {
      const stamps = cf.map((e) => (e.ts ? Date.parse(e.ts) : NaN)).filter((n) => !Number.isNaN(n));
      return stamps.length ? Math.max(...stamps) : null;
    }
    return null;
  }, [state?.casefile, phase]);

  const frozen = endMs != null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (frozen) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [frozen]);

  if (startMs == null) return null;
  const elapsed = Math.max(0, (frozen ? (endMs as number) : now) - startMs);

  return (
    <span
      className="live-claim-timer"
      data-frozen={frozen || undefined}
      title={frozen ? "Intake → verdict (cross-org coordination time)" : "Elapsed since intake"}
    >
      <span className="live-claim-timer-dot" aria-hidden />
      {formatElapsed(elapsed)}
    </span>
  );
}

/** "2m 14s" / "48s" — compact elapsed-duration formatting. */
function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m ${secs.toString().padStart(2, "0")}s` : `${secs}s`;
}

function PhaseStepper({
  phase,
  state,
  openStage,
  onSelect,
}: {
  phase: string;
  state: ArbiterState | null;
  openStage: StageKey | null;
  onSelect: (key: StageKey) => void;
}) {
  const activeKey = stepperActivePhase(phase);
  const activeIdx = activeKey ? FLOW.findIndex((f) => f.key === activeKey) : -1;

  return (
    <nav className="stepper stepper--wide" aria-label="Claim progress">
      <ol className="stepper-track">
        {FLOW.map((f, i) => {
          const status = stageStatus(f.key as StageKey, phase, state);
          const done = status === "done";
          const current = status === "current";
          const skipped = status === "skipped";
          const isOpen = openStage === f.key;
          const aria = done
            ? "complete"
            : current
              ? "in progress"
              : skipped
                ? "skipped"
                : "not started";
          return (
            <li key={f.key} className="stepper-item">
              <button
                type="button"
                className="stepper-step"
                data-status={status}
                data-open={isOpen || undefined}
                aria-pressed={isOpen}
                aria-label={`${f.label}, ${aria}. Show detail.`}
                onClick={() => onSelect(f.key as StageKey)}
              >
                <span className="stepper-marker" aria-hidden>
                  {done ? (
                    <CheckMark />
                  ) : current ? (
                    <span className="stepper-pulse" />
                  ) : skipped ? (
                    <SkipMark />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="stepper-label">{f.label}</span>
              </button>
              {i < FLOW.length - 1 && (
                <span className="stepper-link" data-filled={activeIdx > i || undefined} aria-hidden />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function CheckMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
/** A dash glyph for a skipped step — distinct from the green check of a real one. */
function SkipMark() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 12h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function WarnIcon() {
  return <TriangleAlert size={16} strokeWidth={1.8} className="mt-px shrink-0" aria-hidden />;
}
