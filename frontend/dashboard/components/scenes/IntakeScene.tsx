"use client";

import type { CasefileEntry } from "@/dashboard/lib/api";
import { Field, SceneHead } from "@/dashboard/components/scenes/parts";
import { stageResult } from "@/dashboard/lib/casefileSchema";
import { claimDomain, INTAKE_DOCS } from "@/dashboard/lib/domains";

/*
  SCENE: intake — the claim materializing. Documents land, the structured
  claim is extracted. Calm/cool (no heat yet). The documents shown reflect the
  claim's domain (auto / property / medical).
*/

export function IntakeScene({ casefile }: { casefile: CasefileEntry[] }) {
  const intake = casefile.find((c) => c.stage === "intake");
  const result = stageResult(intake, "intake");
  const domain = claimDomain(result.domain ?? casefile);
  const realDocs = Array.isArray((result as { attachments?: { code?: string; label?: string; n?: string }[] }).attachments)
    ? (result as { attachments: { code?: string; label?: string; n?: string }[] }).attachments
    : null;
  const docs = realDocs && realDocs.length > 0
    ? realDocs.map((d) => ({ code: d.code ?? "DOC", label: d.label ?? "Document", n: d.n ?? "" }))
    : INTAKE_DOCS[domain];
  const docsAreReal = Boolean(realDocs && realDocs.length > 0);

  return (
    <div className="relative">
      <SceneHead
        kicker="01 · Intake"
        title="A claim arrives at Insurance Provider."
        status={
          <span className="badge" style={{ background: "var(--org-a)", color: "var(--accent-ink)" }}>
            <span className="pulse-dot" style={{ background: "currentColor" }} />
            Parsing
          </span>
        }
      />

      <div className="mt-8 grid gap-5 md:grid-cols-[1fr_1fr]">
        {/* Incoming documents */}
        <div className="space-y-2.5">
          <p className="label">Incoming documents</p>
          <p className="label" style={{ opacity: 0.7 }}>
            {docsAreReal ? "from claim upload" : "platform default · no attachments parsed"}
          </p>
          {docs.map((d, i) => (
            <div
              key={d.code}
              className="animate-enter flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--line-faint)] bg-[var(--surface)] px-3.5 py-3"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="flex h-9 w-11 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--inset)] font-[family-name:var(--font-mono)] text-[10px] font-bold text-[var(--accent-strong)]">
                {d.code}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text)]">{d.label}</p>
                <p className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-faint)]">
                  {d.n}
                </p>
              </div>
              <CheckDot />
            </div>
          ))}
        </div>

        {/* Extracted structured claim */}
        <div className="rounded-[var(--radius-lg)] border border-[var(--line-faint)] bg-[var(--surface)] p-4">
          <p className="label mb-3">Structured claim</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Claim ID" value={result.claim_id != null ? `#${result.claim_id}` : "-"} />
            <Field label="Domain" value={domain} mono={false} />
            <Field
              label="Documents"
              value={typeof result.docs === "number" ? `${result.docs} attached` : "-"}
            />
          </div>
          <p className="mt-4 border-t border-[var(--line-faint)] pt-3 text-[12px] leading-relaxed text-[var(--text-soft)]">
            {intake?.summary ??
              "The intake agent extracts a structured claim from the submitted documents, ready for coverage."}
          </p>
        </div>
      </div>
    </div>
  );
}

function CheckDot() {
  return (
    <span
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
      style={{ background: "var(--success-subtle)", color: "var(--success)" }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
