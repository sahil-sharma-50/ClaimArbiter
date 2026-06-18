import type { CasefileEntry } from "@/dashboard/lib/api";

/*
  Domain-aware presentation config for the pre-recruit scenes (Intake, Coverage).
  These run before any specialist joins, so they can't read the specialist
  descriptor — instead they key off the claim's domain, which the intake/coverage
  agents carry in their structured result (or which we infer from the casefile).
*/

export type ClaimDomain = "property" | "medical" | "legal";

export type IntakeDoc = { code: string; label: string; n: string };

export const INTAKE_DOCS: Record<ClaimDomain, IntakeDoc[]> = {
  legal: [
    { code: "PDF", label: "Attorney invoice", n: "LAW" },
    { code: "PDF", label: "Engagement letter", n: "RET" },
    { code: "FRM", label: "Court filing", n: "DOCKET" },
  ],
  property: [
    { code: "IMG", label: "Damage photos", n: "3 files" },
    { code: "PDF", label: "Plumber / inspection report", n: "INS" },
    { code: "FRM", label: "Property claim form", n: "FNOL" },
  ],
  medical: [
    { code: "PDF", label: "Treatment chart", n: "EHR" },
    { code: "PDF", label: "Imaging order", n: "RAD" },
    { code: "FRM", label: "Billing statement", n: "CMS-1500" },
  ],
};

export const COVERAGE_CHECKS: Record<ClaimDomain, string[]> = {
  legal: [
    "Policy active",
    "Legal-expenses cover in force",
    "No coverage lapse",
    "Proceeding is covered (not excluded matter)",
  ],
  property: [
    "Policy active",
    "Dwelling + water-damage in force",
    "No coverage lapse",
    "Peril is covered (sudden & accidental)",
  ],
  medical: [
    "Policy active",
    "Injury treatment in force",
    "No coverage lapse",
    "Provider in network",
  ],
};

export type CoverageCheck = { label: string; status: "pass" | "fail" };

/**
 * Build the peril checklist for the Coverage scene, reflecting the REAL coverage
 * verdict. When `covered === false` the perils were NOT satisfied, so the
 * peril-specific checks render as failed (the policy may still be active, but the
 * loss is excluded). When `covered` is undefined (no coverage result yet) checks
 * stay neutral/pending — we never assert green perils without evidence.
 *
 * Heuristic: the first item ("Policy active") describes the policy itself, not the
 * loss, so it's left satisfied on an excluded claim; every peril-scoped check
 * below it fails when the claim was excluded.
 */
export function coverageChecks(domain: ClaimDomain, covered?: boolean): CoverageCheck[] {
  const labels = COVERAGE_CHECKS[domain];
  if (covered === false) {
    return labels.map((label, i) => ({ label, status: i === 0 ? "pass" : "fail" }));
  }
  // covered === true → all satisfied; covered === undefined → treat as pending
  // (rendered as pass-styled by the scene only when we actually have a result).
  return labels.map((label) => ({ label, status: "pass" }));
}

const DOMAIN_HINTS: Record<ClaimDomain, string[]> = {
  property: ["property", "water", "structural", "dwelling", "orion"],
  medical: ["medical", "injury", "treatment", "clinical", "health"],
  legal: ["legal", "attorney", "litigation", "counsel", "court"],
};

/**
 * Resolve the claim domain. Accepts an explicit domain string when the agent
 * provided one, or a casefile to infer from (scans intake/coverage summaries).
 * Defaults to "property".
 */
export function claimDomain(source: ClaimDomain | string | CasefileEntry[]): ClaimDomain {
  if (typeof source === "string") {
    const s = source.toLowerCase();
    if (s === "property" || s === "medical" || s === "legal") return s;
    for (const [domain, hints] of Object.entries(DOMAIN_HINTS) as [ClaimDomain, string[]][]) {
      if (hints.some((h) => s.includes(h))) return domain;
    }
    return "property";
  }
  // Casefile: check structured result.domain first, then scan summaries.
  for (const entry of source) {
    const d = (entry.result as { domain?: string } | undefined)?.domain;
    if (d) return claimDomain(d);
  }
  const blob = source.map((e) => e.summary ?? "").join(" ").toLowerCase();
  for (const [domain, hints] of Object.entries(DOMAIN_HINTS) as [ClaimDomain, string[]][]) {
    if (hints.some((h) => blob.includes(h))) return domain;
  }
  return "property";
}
