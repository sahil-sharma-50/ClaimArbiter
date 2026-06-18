/**
 * Specialist Registry — the dashboard's mirror of the backend roster.
 *
 * A Specialist is a recruited reviewer from a partner org (Property Group /
 * Medical Group / Legal Group). Their presentation-facing identity — org,
 * practitioner title, and Band capability tag — is the single source of truth in the
 * backend at `backend/agents/shared/registry.py`. This file mirrors the columns the
 * dashboard renders, so the directory cards in the recruiting scene and the handoff
 * detail read ONE roster instead of each hardcoding its own copy.
 *
 * No codegen (kept out of the demo build), so `backend/tests/test_registry_contract.py`
 * is the drift guard: it asserts every row's identity fields (type / org / tag) match
 * the Python registry. The same no-codegen-mirror + contract-test pattern as
 * `casefileSchema.ts`.
 *
 * Scope note: `role` here is the practitioner *title* the card shows ("Property
 * Assessor"), which intentionally differs from the agent's Band display name
 * ("Property Assessment", the @mention target the backend uses). The contract test
 * checks the stable identity fields, not this presentational title.
 *
 * This is the static platform *offering* (every specialty available across the trust
 * boundary), shown at idle and in mock mode before any run. Which one is actually
 * recruited on a given claim still comes live from Band via the projected
 * `specialist` / `discovery` state — Band remains the system of record.
 */
import type { Specialist } from "@/dashboard/lib/api";

export type SpecialistDirectoryEntry = {
  type: Specialist["type"];
  org: string;
  role: string;
  tag: string;
};

export const SPECIALIST_DIRECTORY: SpecialistDirectoryEntry[] = [
  { type: "property", org: "Property Group", role: "Property Assessor", tag: "property-damage" },
  { type: "medical", org: "Medical Group", role: "Medical Reviewer", tag: "medical-review" },
  { type: "legal", org: "Legal Group", role: "Legal Reviewer", tag: "legal-review" },
];
