"use client";

import { UserRound } from "lucide-react";
import type { Participant } from "@/dashboard/lib/api";
import { Icon } from "@/dashboard/components/ui/Icon";
import { agentIcon } from "@/dashboard/lib/agentIcon";
import { MERIDIAN } from "@/dashboard/components/scenes/parts";

/*
  Constant supporting rail: the home org (Insurance Provider) facing the specialist's org
  across the trust boundary. The right lane is whichever org the Case Coordinator
  recruited — Property Group (property), Medical Group (medical), or Legal Group (legal) —
  so it stays general. It's empty (the "network") until a specialist joins.

  The HUMAN reviewer belongs to the home org, NOT the specialist lane — we key off
  `participant.type` ("human"/"human_reviewer") so the reviewer is never mislabeled
  as a "Specialist". The check is defensive (optional chaining + a framework
  fallback) so it holds whether or not the backend has stamped `type` yet.
*/

/** Drop the org-type suffix for a compact column header. */
function shortOrg(org: string): string {
  return (
    org.replace(/\s+(Investigations|Adjusters|Partners|Insurance|Group|Services)$/i, "").trim() ||
    org
  );
}

/**
 * True for the human reviewer. Prefers the explicit `type` the backend stamps
 * ("human" / "human_reviewer"); falls back to framework "Human" so it still works
 * before that backend change lands.
 */
function isHuman(p: Participant): boolean {
  const t = p.type?.toLowerCase();
  return t === "human" || t === "human_reviewer" || p.framework === "Human";
}

export function OrgRail({ participants }: { participants: Participant[] }) {
  // Home lane: the home org PLUS the human reviewer (defensive — should already be
  // home-org, but never let the reviewer fall into the specialist lane).
  const a = participants.filter((p) => p.org === MERIDIAN || isHuman(p));
  // Specialist lane: anyone across the boundary who is NOT the human reviewer.
  const b = participants.filter((p) => p.org !== MERIDIAN && !isHuman(p));
  const bOrg = b[0]?.org;
  const hasSpecialist = b.length > 0;
  const orgNames = new Set(participants.map((p) => p.org).filter(Boolean));
  const orgCount = orgNames.size;
  const activeCount = participants.filter((p) => p.active !== false).length;

  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h2 className="panel-title">Agent band</h2>
          <p className="panel-desc">{orgCount} {orgCount === 1 ? "org" : "orgs"} · one Band network</p>
        </div>
        <span className="badge" style={{ background: "var(--surface-2)", color: "var(--text-soft)" }}>
          {participants.length} in claim · {activeCount} active
        </span>
      </header>

      <div className="panel-body grid gap-4 md:grid-cols-[1fr_auto_1fr]">
        <OrgColumn label="Insurance Provider" sub="Insurer" org="a" items={a} side="left" />

        <div aria-hidden className="flex flex-col items-center gap-2 py-1 md:hidden">
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--line-strong)] to-transparent" />
          <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--text-ghost)]">
            trust boundary
          </span>
          <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--line-strong)] to-transparent" />
        </div>

        <div aria-hidden className="hidden flex-col items-center gap-2 px-1 md:flex">
          <div className="w-px flex-1 bg-gradient-to-b from-transparent via-[var(--line-strong)] to-transparent" />
          <span className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--text-ghost)] [writing-mode:vertical-rl]">
            trust boundary
          </span>
          <div className="w-px flex-1 bg-gradient-to-b from-transparent via-[var(--line-strong)] to-transparent" />
        </div>

        <OrgColumn
          label={hasSpecialist && bOrg ? shortOrg(bOrg) : "Network"}
          sub={hasSpecialist ? "Specialist" : "discovered via Band"}
          org="b"
          items={b}
          side="right"
          emptyLabel={hasSpecialist ? undefined : "no specialist recruited"}
        />
      </div>
    </section>
  );
}

function OrgColumn({
  label,
  sub,
  org,
  items,
  side,
  emptyLabel,
}: {
  label: string;
  sub: string;
  org: "a" | "b";
  items: Participant[];
  side: "left" | "right";
  /** Overrides the default empty-state copy (e.g. "no specialist recruited"). */
  emptyLabel?: string;
}) {
  const tone = org === "a" ? "var(--org-a)" : "var(--org-b)";
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: tone }}
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: tone }}>
          {label}
        </p>
        <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-ghost)]">
          {sub}
        </span>
      </div>
      <ul className="space-y-2 stagger" role="list">
        {items.length === 0 ? (
          <li className="rounded-[var(--radius-md)] border border-dashed border-[var(--line)] px-3 py-7 text-center font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-faint)]">
            {emptyLabel ?? (side === "right" ? "joins after consent" : "appears at intake")}
          </li>
        ) : (
          items.map((p) => {
            const inactive = p.active === false;
            return (
            <li
              key={p.name}
              className={`group flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 transition-all duration-300 ${
                p.mentioned
                  ? "border-[var(--accent-muted)] bg-[var(--accent-subtle)]"
                  : inactive
                    ? "border-[var(--line-faint)] bg-[var(--inset)] opacity-70"
                    : "border-[var(--line)] bg-[var(--inset)]"
              } ${side === "right" ? "animate-slide-in" : ""}`}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)]"
                style={{
                  background: `color-mix(in oklch, ${tone} 22%, var(--inset))`,
                  color: tone,
                }}
              >
                <Icon as={isHuman(p) ? UserRound : agentIcon(p.name, p.role)} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text)]">{p.name}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--accent-strong)]">
                    {isHuman(p) ? "Human reviewer" : p.framework}
                  </span>
                  {!isHuman(p) && p.model !== "-" && (
                    <span className="font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-faint)]">
                      · {p.model}
                    </span>
                  )}
                </div>
              </div>
              {p.mentioned ? (
                <span
                  className="flex items-center gap-1 font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--accent-strong)" }}
                >
                  <span className="pulse-dot" style={{ background: "var(--accent-strong)" }} />
                  active
                </span>
              ) : inactive ? (
                <span className="font-[family-name:var(--font-mono)] text-[9px] font-bold uppercase tracking-wide text-[var(--text-ghost)]">
                  used
                </span>
              ) : null}
            </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

