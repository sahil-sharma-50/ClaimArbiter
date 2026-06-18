import type { ClaimSummary } from "@/dashboard/lib/api";

/**
 * Overview analytics — pure projections over the live claim list. No fetches and
 * no fabrication: every count is read straight from the enriched `ClaimSummary`
 * fields, and a claim that lacks a value (no recommendation / no decision / no
 * specialist) simply doesn't contribute to that tally. Mirrors the codebase's
 * "real or absent, never invented" rule.
 */

export type SpecialistType = "property" | "medical" | "legal";
export type Outcome = "approve" | "deny";

/** Display metadata for each recruited specialist domain, in rank-fallback order. */
export const SPECIALIST_META: Record<
  SpecialistType,
  { domain: string; title: string; org: string; tone: string }
> = {
  property: { domain: "Property", title: "Property Assessor", org: "Property Group", tone: "var(--info)" },
  medical: { domain: "Medical", title: "Medical Reviewer", org: "Medical Group", tone: "var(--accent-strong)" },
  legal: { domain: "Legal", title: "Legal Reviewer", org: "Legal Group", tone: "var(--warning)" },
};

const SPECIALIST_ORDER: SpecialistType[] = ["property", "medical", "legal"];

/** One row of the approval/denial-by-domain matrix. */
export type DomainOutcomeRow = {
  type: SpecialistType;
  domain: string;
  approved: number;
  denied: number;
  pending: number;
  total: number;
};

export type ApprovalMatrix = {
  rows: DomainOutcomeRow[];
  approved: number;
  denied: number;
  /** True when at least one claim recruited a specialist (otherwise nothing to show). */
  hasData: boolean;
};

/**
 * Approve/deny counts split by the recruited specialist's domain. A claim counts
 * toward a domain only if it recruited that specialist; the human `decision` is
 * the outcome (a recruited-but-not-yet-signed claim is "pending"). Domains with
 * zero claims are dropped so the matrix shows only what actually happened.
 */
export function approvalMatrix(claims: ClaimSummary[]): ApprovalMatrix {
  const byType = new Map<SpecialistType, DomainOutcomeRow>();
  for (const type of SPECIALIST_ORDER) {
    byType.set(type, {
      type,
      domain: SPECIALIST_META[type].domain,
      approved: 0,
      denied: 0,
      pending: 0,
      total: 0,
    });
  }

  for (const claim of claims) {
    const type = claim.specialist_type;
    if (!type || !byType.has(type)) continue;
    const row = byType.get(type)!;
    row.total += 1;
    if (claim.decision === "approve") row.approved += 1;
    else if (claim.decision === "deny") row.denied += 1;
    else row.pending += 1;
  }

  const rows = SPECIALIST_ORDER.map((t) => byType.get(t)!).filter((r) => r.total > 0);
  return {
    rows,
    approved: rows.reduce((n, r) => n + r.approved, 0),
    denied: rows.reduce((n, r) => n + r.denied, 0),
    hasData: rows.length > 0,
  };
}

export type AgreementStat = {
  /** Claims where BOTH an AI recommendation and a human decision exist. */
  decided: number;
  agreed: number;
  overrode: number;
  /** Agreement rate as a 0–100 integer percent, or null when nothing is decided. */
  rate: number | null;
};

/**
 * How often the human's signed decision matched the AI's recommendation. Only
 * claims that carry both a recommendation and a decision are comparable; a claim
 * missing either is excluded from the denominator (we never count an absent
 * value as agreement or disagreement).
 */
export function agreementStat(claims: ClaimSummary[]): AgreementStat {
  let decided = 0;
  let agreed = 0;
  for (const c of claims) {
    if (
      (c.recommendation === "approve" || c.recommendation === "deny") &&
      (c.decision === "approve" || c.decision === "deny")
    ) {
      decided += 1;
      if (c.recommendation === c.decision) agreed += 1;
    }
  }
  return {
    decided,
    agreed,
    overrode: decided - agreed,
    rate: decided > 0 ? Math.round((agreed / decided) * 100) : null,
  };
}

export type SpecialistUsage = {
  type: SpecialistType;
  title: string;
  org: string;
  tone: string;
  count: number;
};

/**
 * Recruited specialists ranked by how many claims each worked. The Case
 * Coordinator is on every claim, so it is deliberately excluded as noise — this
 * answers "which cross-org specialist gets pulled in most". Specialists never
 * recruited are dropped (count 0), so an empty result means none recruited yet.
 */
export function specialistUsage(claims: ClaimSummary[]): SpecialistUsage[] {
  const counts = new Map<SpecialistType, number>();
  for (const c of claims) {
    const type = c.specialist_type;
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return SPECIALIST_ORDER.filter((t) => (counts.get(t) ?? 0) > 0)
    .map((type) => ({
      type,
      title: SPECIALIST_META[type].title,
      org: SPECIALIST_META[type].org,
      tone: SPECIALIST_META[type].tone,
      count: counts.get(type)!,
    }))
    .sort((a, b) => b.count - a.count);
}
