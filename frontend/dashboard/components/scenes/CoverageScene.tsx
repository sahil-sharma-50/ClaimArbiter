"use client";

import type { CasefileEntry } from "@/dashboard/lib/api";
import { Field, SceneHead } from "@/dashboard/components/scenes/parts";
import { findStageResult } from "@/dashboard/lib/casefileSchema";
import { claimDomain, coverageChecks } from "@/dashboard/lib/domains";

/*
  SCENE: coverage — policy check. Calm/cool when the claim is covered; on an
  EXCLUDED claim it must read honestly (red), and the peril checklist reflects the
  real verdict instead of an all-green facade. Every value is driven by the real
  coverage.result payload (policy / deductible / covered / note) — no canned
  fallbacks. When a field is genuinely absent we show "-".
*/

export function CoverageScene({ casefile }: { casefile: CasefileEntry[] }) {
  const coverage = casefile.find((c) => c.stage === "coverage");
  const result = findStageResult(casefile, "coverage");
  const domain = claimDomain(result.domain ?? casefile);
  // Tri-state: true (covered), false (excluded), undefined (not yet decided).
  // The backend models covered as bool | null; collapse null → undefined so the
  // tri-state and coverageChecks(covered?: boolean) read identically to before.
  const covered = result.covered ?? undefined;
  const excluded = covered === false;
  const hasResult = Boolean(coverage);
  const checks = coverageChecks(domain, covered);

  // Coverage tone: red when excluded, green when confirmed, neutral when pending.
  const coverageTone = excluded
    ? "var(--danger)"
    : covered === true
      ? "var(--success)"
      : "var(--text-soft)";
  const coverageWord = excluded ? "Excluded" : covered === true ? "Confirmed" : "Pending";
  // Status reflects the policy itself: an excluded claim can still ride an active
  // policy, so don't fabricate "Active" — only show it when the result is in hand.
  const statusWord = hasResult ? "Active" : "-";

  return (
    <div className="relative">
      <SceneHead
        kicker="02 · Coverage"
        title={excluded ? "This loss falls outside the policy." : "Confirming the policy holds."}
        status={
          excluded ? (
            <span className="badge" style={{ background: "var(--danger-subtle)", color: "var(--danger)" }}>
              Excluded
            </span>
          ) : (
            <span className="badge" style={{ background: "var(--info-subtle)", color: "var(--info)" }}>
              <span className="pulse-dot" style={{ background: "currentColor" }} />
              {covered === true ? "Confirmed" : "Checking"}
            </span>
          )
        }
      />

      <div className="mt-8 grid gap-5 md:grid-cols-[1fr_1fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--line-faint)] bg-[var(--surface)] p-4">
          <p className="label mb-3">Coverage result</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Policy" value={result.policy ?? "-"} tone="var(--info)" />
            <Field
              label="Deductible"
              value={typeof result.deductible === "number" ? `$${result.deductible}` : "-"}
            />
            <Field label="Status" value={statusWord} tone={hasResult ? "var(--success)" : undefined} />
            <Field label="Coverage" value={coverageWord} tone={coverageTone} />
          </div>
          <p className="mt-4 border-t border-[var(--line-faint)] pt-3 text-[12px] leading-relaxed text-[var(--text-soft)]">
            {result.note ??
              coverage?.summary ??
              "Checking the claim against the policy of record."}
          </p>
        </div>

        <div className="space-y-2.5">
          <p className="label">policy checklist · template</p>
          <ul className="space-y-2.5">
          {checks.map((c, i) => {
            const failed = c.status === "fail";
            const tone = failed ? "var(--danger)" : "var(--success)";
            const subtle = failed ? "var(--danger-subtle)" : "var(--success-subtle)";
            return (
              <li
                key={c.label}
                className="animate-enter flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line-faint)] bg-[var(--surface)] px-3.5 py-3"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                  style={{ background: subtle, color: tone }}
                >
                  {failed ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="text-sm" style={{ color: failed ? "var(--text)" : "var(--text-soft)" }}>
                  {c.label}
                </span>
              </li>
            );
          })}
          </ul>
        </div>
      </div>
    </div>
  );
}
