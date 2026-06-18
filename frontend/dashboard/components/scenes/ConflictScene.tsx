"use client";

import type { CasefileEntry } from "@/dashboard/lib/api";
import { Field, SceneHead } from "@/dashboard/components/scenes/parts";
import { stageResult } from "@/dashboard/lib/casefileSchema";

/** Surfaces CONFLICT events when evidence and verdict disagree. */
export function ConflictScene({ casefile }: { casefile: CasefileEntry[] }) {
  const conflict = casefile.find((c) => c.stage === "conflict");
  if (!conflict) return null;

  const result = stageResult(conflict, "conflict");
  const reasons = result.reasons ?? [];

  return (
    <div className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border-2 border-[var(--danger-subtle)] bg-[color-mix(in_oklch,var(--danger)_6%,var(--inset))]">
      <div className="border-b border-[var(--danger-subtle)] px-5 py-3">
        <SceneHead
          kicker="Conflict"
          title="Evidence and verdict disagree."
          status={
            <span className="badge" style={{ background: "var(--danger-subtle)", color: "var(--danger)" }}>
              CONFLICT
            </span>
          }
        />
      </div>
      <div className="space-y-2 p-5">
        {reasons.length === 0 ? (
          <p className="text-sm text-[var(--text-soft)]">{conflict.summary}</p>
        ) : (
          reasons.map((r, i) => (
            <p key={`${i}-${r}`} className="text-sm text-[var(--text-soft)]">
              · {r}
            </p>
          ))
        )}
        <Field
          label="Resolution path"
          value={result.needs_human ? "Human review required" : "Specialist challenged to reconcile"}
          tone="var(--warning)"
        />
      </div>
    </div>
  );
}
