"use client";

import type { AuditEntry, CasefileEntry, Specialist } from "@/dashboard/lib/api";
import { Field, OrgGlyph, SceneHead } from "@/dashboard/components/scenes/parts";

/*
  SCENE: investigating — THE LONG POLE.
  CrewAI on Featherless can run a while. This scene must feel ALIVE during a
  long, quiet stretch: a breathing specialist glyph, a scanline "working" sweep,
  and the live thought/tool stream so dead air never reads as frozen. The
  specialist (property / medical / legal) is whoever the Case Coordinator recruited.
*/

export function InvestigatingScene({
  casefile,
  audit,
  specialist,
}: {
  casefile: CasefileEntry[];
  audit: AuditEntry[];
  specialist: Specialist | null;
}) {
  const specialistName = specialist?.name ?? "The specialist";
  const specialistOrg = specialist?.org ?? "the partner org";

  // The recruited specialist's live working chatter. Match on its actual name;
  // fall back to "any non-Insurance Provider sender" so a renamed agent still streams.
  // accept-both: live Band names may be old or new; mock data uses new
  const meridian = new Set(["Intake+Coverage", "Intake & Coverage", "Intake", "Adjudicator", "Case Coordinator", "Human Adjuster", "Adjuster", "Human Reviewer"]);
  const specialistWork = audit
    .filter((e) => {
      const fromSpecialist = specialist
        ? e.sender === specialist.name
        : Boolean(e.sender) && !meridian.has(e.sender as string);
      return (
        fromSpecialist &&
        (e.type === "thought" || e.type === "tool_call" || e.type === "tool_result" || e.type === "text")
      );
    })
    .slice(-5);

  // KNOWN DRIFT (see casefileSchema.ts): the live recruiting event carries no
  // `signals` — that field exists only in mock data, so `sig` is empty live. Explicit
  // escape-hatch cast off the typed result, kept visible here rather than hidden in a
  // structural cast; not part of the RecruitingResult contract.
  const recruited = casefile.find((c) => c.stage === "recruiting");
  const sig = (recruited?.result as { signals?: string[] } | undefined)?.signals ?? [];

  return (
    <div className="relative">
      <SceneHead
        kicker="04 · Investigation"
        title={`${specialistOrg} works the claim, privately.`}
        status={
          <span className="badge" style={{ background: "var(--org-b-subtle)", color: "var(--org-b)" }}>
            <span className="pulse-dot" style={{ background: "currentColor" }} />
            Investigating
          </span>
        }
      />

      <div className="mt-8 grid gap-5 md:grid-cols-[auto_1fr]">
        {/* Working glyph */}
        <div className="scanning flex flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-[var(--org-b-subtle)] bg-[var(--surface)] p-6">
          <OrgGlyph org="b" lit working size={76} />
          <p className="text-center font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.16em] text-[var(--org-b)]">
            open-weight model
          </p>
          <p className="max-w-[12rem] text-center text-[11px] leading-snug text-[var(--text-faint)]">
            Sensitive claim data never touches a frontier vendor.
          </p>
        </div>

        {/* Live working stream + what it's checking */}
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider" value={specialist?.provider ?? "-"} tone="var(--org-b)" />
            <Field label="Framework" value={specialist?.framework ?? "-"} tone="var(--org-b)" />
          </div>

          {sig.length > 0 && (
            <div className="mt-4">
              <p className="label">Signals under review</p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {sig.map((s) => (
                  <span
                    key={s}
                    className="rounded-[var(--radius-sm)] border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-2 py-1 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-[var(--accent-strong)]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--line-faint)] bg-[var(--surface)] p-3">
            <p className="label mb-2">Live trace</p>
            {specialistWork.length === 0 ? (
              <p className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-faint)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="pulse-dot" style={{ background: "var(--org-b)" }} />
                  {specialistName} spinning up…
                </span>
              </p>
            ) : (
              <ul className="space-y-1.5">
                {specialistWork.map((e, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--text-soft)]"
                  >
                    <span
                      className="mt-0.5 shrink-0 text-[9px] uppercase"
                      style={{ color: e.type === "thought" ? "var(--text-faint)" : "var(--warning)" }}
                    >
                      {e.type === "thought" ? "··" : "›"}
                    </span>
                    <span className="min-w-0">{e.content}</span>
                  </li>
                ))}
                <li className="flex items-center gap-1.5 pt-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--org-b)]">
                  <span className="pulse-dot" style={{ background: "var(--org-b)" }} />
                  working…
                </li>
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
