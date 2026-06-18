"use client";

import type { ReactNode } from "react";

/* Shared scene primitives — the instrument vocabulary every scene draws from. */

export const MERIDIAN = "Insurance Provider";

// Phase ordering moved to the single canonical source (dashboard/lib/phases.ts).
// Re-exported here under the historical names so scenes keep their existing imports.
export {
  PHASES_WITH_IDLE as PHASE_ORDER,
  phaseIndex,
  type PhaseWithIdle as Phase,
} from "@/dashboard/lib/phases";

/** Scene heading: mono kicker + display title + optional status chip. */
export function SceneHead({
  kicker,
  title,
  status,
}: {
  kicker: string;
  title: string;
  status?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="label" style={{ color: "var(--accent-strong)" }}>
          {kicker}
        </p>
        <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-[1.5rem] font-bold leading-tight tracking-tight text-[var(--text)] md:text-[1.75rem]">
          {title}
        </h2>
      </div>
      {status}
    </div>
  );
}

/** A labelled data readout (mono label over a value). */
export function Field({
  label,
  value,
  tone,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  tone?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="label">{label}</p>
      <p
        className={`mt-1 truncate text-sm font-semibold ${mono ? "font-[family-name:var(--font-mono)]" : ""}`}
        style={{ color: tone ?? "var(--text)" }}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </p>
    </div>
  );
}

/** A org node (Insurance Provider / Property Group / Medical Group / Legal Group) used in the seam + rails. */
export function OrgGlyph({
  org,
  lit,
  size = 56,
  working = false,
}: {
  org: "a" | "b";
  lit: boolean;
  size?: number;
  working?: boolean;
}) {
  const tone = org === "a" ? "var(--org-a)" : "var(--org-b)";
  const letter = org === "a" ? "M" : "S";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[var(--radius-md)] border-2 font-[family-name:var(--font-display)] font-bold transition-all duration-500 ${working ? "breathe" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        borderColor: lit ? tone : "var(--line)",
        background: lit
          ? `color-mix(in oklch, ${tone} 18%, var(--inset))`
          : "var(--inset)",
        color: lit ? tone : "var(--text-ghost)",
      }}
    >
      {letter}
    </span>
  );
}

/** Big animated numeric readout (e.g. a confidence score). */
export function Gauge({
  value,
  max = 1,
  threshold,
  label,
  hot,
}: {
  value: number;
  max?: number;
  threshold?: number;
  label: string;
  hot?: boolean;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const thrPct = threshold != null ? (threshold / max) * 100 : null;
  // "hot" = high-risk magnitude → flares crimson; glow reserved for this beat only.
  const tone = hot ? "var(--flare)" : "var(--info)";
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label">{label}</span>
        <span
          className="tabular font-[family-name:var(--font-mono)] text-2xl font-bold"
          style={{ color: tone }}
        >
          {value.toFixed(2)}
        </span>
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--inset)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, color-mix(in oklch, ${tone} 60%, var(--inset)), ${tone})`,
            boxShadow: hot ? `0 0 12px ${tone}` : "none",
          }}
        />
        {thrPct != null && (
          <span
            className="absolute inset-y-0 w-px bg-[var(--text-faint)]"
            style={{ left: `${thrPct}%` }}
            aria-hidden
          />
        )}
      </div>
      {thrPct != null && (
        <p className="mt-1 text-right font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-faint)]">
          threshold {threshold?.toFixed(2)}
        </p>
      )}
    </div>
  );
}

/** Degraded / reconnecting overlay shown when state stalls or errors. */
export function DegradedOverlay({ message }: { message?: string }) {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] bg-[color-mix(in_oklch,var(--canvas)_72%,transparent)] backdrop-blur-[2px]"
      role="status"
    >
      <span className="pulse-dot" style={{ background: "var(--warning)" }} />
      <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.18em] text-[var(--warning)]">
        {message ?? "Reconnecting to Band…"}
      </p>
      <p className="max-w-xs text-center text-[12px] text-[var(--text-faint)]">
        Holding the last known good state. The room is the source of truth, so this
        view rebuilds the moment the gateway responds.
      </p>
    </div>
  );
}

/** Centered empty/standby block. */
export function Standby({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[min(56vh,440px)] flex-col items-center justify-center gap-5 text-center">
      {children}
    </div>
  );
}
