"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { HANDSHAKE } from "@/landing-page/lib/flow";
import { useInView } from "@/landing-page/lib/useInView";

function subscribeReduceMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/*
  The hero's live wire. NOT a boxed product preview in fake browser chrome —
  a full-width transmission band: Insurance Provider anchored at the left edge, the
  recruited domain specialist at the right, a live wire carrying a packet between
  them. The dispatch readout and the spec numbers live inline on the band itself,
  so there is no separate stat-card strip (the hero-metric cliché) anywhere on the page.

  This is a ZOOM into steps 04→05 of the canonical flow (see lib/flow.ts). It
  reads the same beats the seven-step list uses and surfaces the master step
  number, so the two views never disagree. The loop pauses when the band scrolls
  out of view, so it never runs at the same time as the architecture diagram.
*/

const DISPATCH = HANDSHAKE;

// Fine hash-marks between the major beat ticks, so the full-width rail reads
// as a measured instrument scale rather than a long empty line.
const MINOR_TICKS = 24;

const SPECS = [
  ["< 3 min", "intake to recommendation"],
  ["4 orgs", "one shared Band network"],
  ["3 frameworks", "no shared codebase"],
] as const;

export function TransmissionBand() {
  const reduceMotion = useSyncExternalStore(subscribeReduceMotion, getReduceMotion, () => false);
  const [i, setI] = useState(0);
  // When the loop wraps (last beat → first), the packet must jump back to the
  // start WITHOUT a transition — otherwise it glides backward across the whole
  // rail, which reads as a bug. `snap` disables the transition for that one
  // reset frame; every forward beat keeps the smooth glide.
  const [snap, setSnap] = useState(false);
  const [paused, setPaused] = useState(false);
  const { ref, inView } = useInView<HTMLDivElement>();

  useEffect(() => {
    if (paused || !inView || reduceMotion) return;
    const advance = () =>
      setI((s) => {
        const next = (s + 1) % DISPATCH.length;
        setSnap(next === 0); // reset beat snaps; forward beats glide
        return next;
      });
    // Kick the first beat almost immediately so the wire is visibly live the
    // moment the page loads, instead of resting at frame 0 for a full interval.
    const kick = setTimeout(advance, 250);
    const t = setInterval(advance, 1800);
    return () => {
      clearTimeout(kick);
      clearInterval(t);
    };
  }, [paused, inView, reduceMotion]);

  // Reduced-motion users see the completed round-trip, not frame zero forever.
  const frame = reduceMotion ? DISPATCH.length - 1 : i;
  const sentinelLive = frame >= 2;
  const progress = frame / (DISPATCH.length - 1);
  // Composited transforms only (no left/width). Snap → instant reset, no glide.
  const moveTransition = snap ? "none" : "transform 650ms var(--ease-out)";

  return (
    <div
      ref={ref}
      className="transmission-band border-y border-[var(--line)] py-7"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setPaused(false);
      }}
    >
      {/* status row */}
      <div className="transmission-band-inner mb-5 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
          <span className="pulse-dot bg-[var(--success)]" aria-hidden />
          Live
        </span>
        <span className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] tabular text-[var(--text-faint)]">
          <span className="text-[var(--accent-strong)]">{DISPATCH[frame].code}</span>
          step {String(DISPATCH[frame].step).padStart(2, "0")}
        </span>
      </div>

      {/* the wire — min-w-0 keeps the rail from forcing horizontal clip on narrow viewports */}
      <div className="transmission-band-inner flex min-w-0 items-center gap-3 sm:gap-5">
        <Node label="Insurance Provider" shortLabel="Insurer" sub="Insurer" org="a" live />
        <div
          className="relative h-16 min-w-[5.5rem] flex-1 sm:min-w-[8rem]"
          style={{ containerType: "inline-size" }}
        >
          {/* base rail, vertically centered in the taller track */}
          <div className="absolute inset-x-0 top-[26px] h-[2px] bg-[var(--line)]" />
          {/* progress fill — scaleX (composited) instead of animating width */}
          <div
            className="absolute left-0 top-[26px] h-[2px] w-full origin-left"
            style={{
              transform: `scaleX(${progress})`,
              transition: moveTransition,
              background: "linear-gradient(90deg, var(--org-a), var(--org-b))",
            }}
          />
          {/* fine minor hash-marks fill the long run so the rail reads as a
              measured instrument scale, not an empty gap */}
          {Array.from({ length: MINOR_TICKS + 1 }).map((_, n) => (
            <span
              key={`minor-${n}`}
              className="absolute top-[22px] h-2 w-px"
              style={{
                left: `${(n / MINOR_TICKS) * 100}%`,
                background: "var(--line-strong)",
                opacity: 0.5,
              }}
              aria-hidden
            />
          ))}
          {/* major ticks + stage codes, one per dispatch beat */}
          {DISPATCH.map((d, n) => {
            const reached = n <= frame;
            return (
              <div
                key={`major-${n}`}
                className="absolute top-[18px] flex -translate-x-1/2 flex-col items-center gap-1"
                style={{ left: `${(n / (DISPATCH.length - 1)) * 100}%` }}
                aria-hidden
              >
                <span
                  className="h-4 w-px"
                  style={{ background: reached ? "var(--accent-strong)" : "var(--line-strong)" }}
                />
                <span
                  className="font-[family-name:var(--font-mono)] text-[9px] font-semibold tracking-[0.12em]"
                  style={{ color: reached ? "var(--accent-strong)" : "var(--text-ghost)" }}
                >
                  {d.code}
                </span>
              </div>
            );
          })}
          {/* travelling packet — translateX over the rail (composited), not left */}
          <span
            aria-hidden
            className="absolute left-0 top-[26px] flex h-7 w-7 items-center justify-center rounded-full border-2 font-[family-name:var(--font-mono)] text-[10px] font-bold will-change-transform"
            style={{
              transform: `translate(calc(${progress} * 100cqw - 50%), -50%)`,
              transition: moveTransition,
              borderColor: sentinelLive ? "var(--org-b)" : "var(--accent-strong)",
              background: "var(--canvas)",
              color: sentinelLive ? "var(--org-b)" : "var(--accent-strong)",
            }}
          >
            {sentinelLive ? "S" : "M"}
          </span>
        </div>
        <Node label="Specialist Group" shortLabel="Specialist" sub="Domain reviewer" org="b" live={sentinelLive} align="end" />
      </div>

      {/* dispatch readout — fixed min-height reserves space so the rotating
          line (which varies in length) doesn't shift the specs below it (CLS). */}
      <p
        aria-live="polite"
        className="transmission-band-inner mt-5 min-h-[2.75rem] font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-[var(--text-soft)]"
      >
        <span className="text-[var(--accent-strong)]">{DISPATCH[frame].code} </span>
        {DISPATCH[frame].text}
      </p>

      {/* inline specs — numbers as readouts on the band, not a card grid */}
      <div className="transmission-band-inner mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-[var(--line)] pt-5">
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {SPECS.map(([n, label], idx) => (
            <div key={n} className="flex items-baseline gap-2">
              {idx > 0 && <span aria-hidden className="mr-4 text-[var(--line-strong)]">/</span>}
              <dt className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight tabular text-[var(--text)]">
                {n}
              </dt>
              <dd className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-faint)]">{label}</dd>
            </div>
          ))}
        </dl>
        <a
          href="#how-step-4"
          className="transmission-band-link group font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--accent-strong)] transition-colors hover:text-[var(--text)]"
        >
          See full sequence
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </div>
    </div>
  );
}

function Node({
  label,
  shortLabel,
  sub,
  org,
  live,
  align = "start",
}: {
  label: string;
  shortLabel?: string;
  sub: string;
  org: "a" | "b";
  live: boolean;
  align?: "start" | "end";
}) {
  const tone = org === "a" ? "var(--org-a)" : "var(--org-b)";
  const compact = shortLabel ?? label;
  return (
    <div className={`flex max-w-[42%] shrink-0 items-center gap-2 sm:max-w-none sm:gap-2.5 ${align === "end" ? "flex-row-reverse text-right" : ""}`}>
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border-2 font-[family-name:var(--font-display)] text-base font-bold transition-all duration-500 sm:h-11 sm:w-11"
        style={{
          borderColor: live ? tone : "var(--line)",
          background: live ? `color-mix(in oklch, ${tone} 16%, var(--canvas))` : "var(--canvas)",
          color: live ? tone : "var(--text-ghost)",
        }}
      >
        {label[0]}
      </span>
      {/* On narrow screens use a shorter org name so the rail keeps breathing room. */}
      <div className="min-w-0">
        <p className="truncate text-[12px] font-bold leading-tight sm:text-[13px] sm:leading-none" style={{ color: live ? tone : "var(--text-faint)" }}>
          <span className="sm:hidden">{compact}</span>
          <span className="hidden sm:inline">{label}</span>
        </p>
        <p className="mt-1 hidden font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)] sm:block">
          {sub}
        </p>
      </div>
    </div>
  );
}
