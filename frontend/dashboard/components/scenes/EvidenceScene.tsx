"use client";

import type { CasefileEntry, RoutingScore } from "@/dashboard/lib/api";
import { evidenceUrl } from "@/dashboard/lib/api";
import { Field, Gauge, SceneHead } from "@/dashboard/components/scenes/parts";
import { findStageResult } from "@/dashboard/lib/casefileSchema";

/*
  SCENE: evidence — what the photos actually depict.
  After coverage confirms the policy is in force, the Evidence Analyst's
  Featherless vision read shows whether the evidence matches the narrative.
*/

export function EvidenceScene({
  casefile,
  routingScore,
  chatId,
}: {
  casefile: CasefileEntry[];
  routingScore?: RoutingScore | null;
  chatId?: string | null;
}) {
  const result = findStageResult(casefile, "evidence_analysis");

  const observations = result.observations ?? [];
  const signals = result.signals ?? [];
  // Show the REAL vision model; "-" when the backend didn't report one (never a
  // fabricated model id). The badge label degrades to a plain "Vision" when absent.
  const model = result.vision_model ?? null;
  const modelShort = model ? model.split("/").pop() : "-";

  // KNOWN DRIFT (see casefileSchema.ts): neither the live evidence_analysis nor the
  // live recruiting event carries a `score` — only mock data does. So `realScore` is
  // null live and this scene always falls through to the local estimate below. These
  // two reads are explicit escape-hatch casts off the typed result, NOT fields in the
  // contract, so the schema stays honest and the drift is visible right here. (Fixing
  // the score source — gateway should surface the Case Coordinator's review score — is
  // out of scope for the typing pass.)
  const evidenceScore = (result as { score?: number }).score;
  const recruiting = casefile.find((c) => c.stage === "recruiting");
  const recruitScore = (recruiting?.result as { score?: number } | undefined)?.score;
  // A present live routing score (the Case Coordinator's exact review score, when
  // surfaced by the gateway) wins. The escape-hatch reads below
  // remain as fallback so this stays correct even when routing_score is absent.
  const realScore =
    typeof routingScore?.score === "number"
      ? routingScore.score
      : typeof evidenceScore === "number"
        ? evidenceScore
        : typeof recruitScore === "number"
          ? recruitScore
          : null;
  const SIGNAL_WEIGHTS: Record<string, number> = {
    severity_gap: 0.45,
    evidence_discrepancy: 0.4,
  };
  const estimatedScore = Math.min(
    1,
    Number(signals.reduce((sum, s) => sum + (SIGNAL_WEIGHTS[s] ?? 0.4), 0).toFixed(2)),
  );
  const score = realScore ?? estimatedScore;
  const scoreIsEstimate = realScore === null;

  return (
    <div className="relative">
      <SceneHead
        kicker="03 · Evidence"
        title="Clean on paper. Now look at the photo."
        status={
          <span className="badge" style={{ background: "var(--accent-subtle)", color: "var(--accent-strong)" }}>
            <span className="pulse-dot" style={{ background: "currentColor" }} />
            {model ? `Featherless · ${modelShort}` : "Vision"}
          </span>
        }
      />

      {result.degraded && (
        <p className="mt-4 rounded-[var(--radius-md)] border border-[var(--warning-subtle)] bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-4 py-2 text-sm text-[var(--warning)]">
          Vision degraded. Scoring falls back to paper signals only.
        </p>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-2">
        {observations.length === 0 ? (
          <p className="text-sm text-[var(--text-soft)]">No photo attachments on this claim.</p>
        ) : (
          observations.map((obs, i) => (
            <div
              key={obs.filename ?? `obs-${i}`}
              className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-faint)] bg-[var(--surface)]"
            >
              <div className="border-b border-[var(--line-faint)] px-4 py-2">
                <p className="label">{obs.filename}</p>
              </div>
              {chatId && obs.filename && (
                <figure className="m-0 p-4 pb-0">
                  <div className={`ev-media${obs.filename.toLowerCase().endsWith(".pdf") ? " ev-media-pdf" : ""}`}>
                    <img
                      src={evidenceUrl(chatId, obs.filename, {
                        preview: obs.filename.toLowerCase().endsWith(".pdf"),
                      })}
                      alt={obs.filename}
                      loading="lazy"
                    />
                    {obs.filename.toLowerCase().endsWith(".pdf") && <span className="ev-prev">PDF · pg 1</span>}
                  </div>
                </figure>
              )}
              <div className="grid grid-cols-2 gap-3 p-4">
                <Field label="Severity" value={obs.severity_band ?? "-"} tone="var(--warning)" />
                <Field
                  label="vs narrative"
                  value={obs.consistent_with_narrative ?? "-"}
                  tone={
                    obs.consistent_with_narrative === "no"
                      ? "var(--danger)"
                      : obs.consistent_with_narrative === "yes"
                        ? "var(--success)"
                        : "var(--text-soft)"
                  }
                />
                <Field label="Location" value={obs.damage_location ?? "-"} mono={false} />
                <Field label="Confidence" value={obs.confidence ?? "-"} />
              </div>
              {obs.narrative_reason && (
                <p className="border-t border-[var(--line-faint)] px-4 py-3 text-[12px] text-[var(--text-soft)]">
                  {obs.narrative_reason}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {signals.length > 0 && (
        <div className="mt-6 rounded-[var(--radius-lg)] border border-[var(--line-faint)] bg-[var(--surface)] p-5">
          <Gauge value={score} threshold={0.7} label="Evidence-weighted concern" hot />
          <div className="mt-3 flex flex-wrap gap-2">
            {signals.map((s) => (
              <span
                key={s}
                className="rounded-[var(--radius-sm)] border border-[var(--flare-subtle)] bg-[color-mix(in_oklch,var(--flare)_12%,transparent)] px-2 py-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-[var(--flare)]"
              >
                {s}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[12px] text-[var(--text-faint)]">
            {scoreIsEstimate
              ? "Estimated from the vision signals shown. The Case Coordinator's exact score sets routing."
              : "Derived deterministically from vision observations. Routing is reproducible."}
          </p>
        </div>
      )}

      {result.pdf_excerpt && (
        <blockquote className="mt-4 rounded-[var(--radius-md)] border border-[var(--line-faint)] bg-[var(--surface)] px-4 py-3 text-[12px] leading-relaxed text-[var(--text-soft)]">
          <span className="label block mb-1">Document excerpt</span>
          {String(result.pdf_excerpt).slice(0, 400)}
        </blockquote>
      )}
    </div>
  );
}
