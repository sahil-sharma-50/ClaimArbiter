"use client";

import { Standby } from "@/dashboard/components/scenes/parts";

/*
  SCENE: idle — the powered-down terminal. A briefing card + the run control.
  This is the "power-on" state the landing funnels into.
*/

const STEPS = [
  { t: "Intake & coverage", d: "Insurance Provider reads the claim and checks the policy", org: "a" },
  { t: "Score & route", d: "The Case Coordinator scores risk and picks the right specialist", org: "a" },
  { t: "Discover & investigate", d: "The matched specialist joins and digs into the claim", org: "b" },
  { t: "Verdict & sign-off", d: "A verdict returns; you approve or deny", org: "a" },
] as const;

export function IdleScene({ onRun, seeding }: { onRun: () => void; seeding: boolean }) {
  return (
    <Standby>
      <div className="grid w-full max-w-4xl gap-8 md:grid-cols-[1.05fr_1fr] md:text-left">
        <div className="text-left">
          <span className="eyebrow">Standby</span>
          <h2 className="mt-3 font-[family-name:var(--font-display)] text-[1.9rem] font-bold leading-[1.05] tracking-tight text-[var(--text)]">
            Take one claim all the way to verdict.
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--text-soft)]">
            A claim arrives at Insurance Provider. Its agents check coverage, weigh the evidence, and
            when the claim warrants it, pull in the right specialist across the org boundary. A
            verdict comes back, and you sign the final decision.
          </p>
          <button
            type="button"
            onClick={onRun}
            disabled={seeding}
            className="btn btn-primary mt-6 px-5 py-3 text-[13px]"
          >
            {seeding ? <Spinner /> : <PlayIcon />}
            {seeding ? "Starting…" : "Run demo claim"}
          </button>
          <p className="mt-3 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-ghost)]">
            under a minute · everything you see is live Band state
          </p>
        </div>

        <ol className="space-y-1 text-left">
          {STEPS.map((s, i) => (
            <li
              key={s.t}
              className="flex gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-[var(--inset)]"
            >
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-[family-name:var(--font-mono)] text-[11px] font-bold"
                style={{
                  background: s.org === "b" ? "var(--org-b-subtle)" : "var(--accent-subtle)",
                  color: s.org === "b" ? "var(--org-b)" : "var(--accent-strong)",
                }}
              >
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--text)]">{s.t}</p>
                <p className="text-[12px] text-[var(--text-faint)]">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Standby>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7 5.5v13a1 1 0 001.5.86l11-6.5a1 1 0 000-1.72l-11-6.5A1 1 0 007 5.5z" />
    </svg>
  );
}
function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
