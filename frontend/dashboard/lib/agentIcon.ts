import {
  ClipboardList,
  ScanSearch,
  Network,
  UserRound,
  Home,
  Stethoscope,
  Scale,
  Bot,
  Cog,
  type LucideIcon,
} from "lucide-react";

/*
  One source of truth for which lucide glyph represents an agent. Shared by the
  Agent band (OrgRail, which has the gateway-stamped `role`) and the Audit trail
  (which has only a sender name), so a given agent reads with the SAME icon in both
  places. Prefers the explicit role key; falls back to matching the display name so
  callers without a role (audit senders, mock participants) still resolve correctly.
*/

/** Per-role avatar glyph — each agent reads at a glance instead of bare initials. */
const ROLE_ICON: Record<string, LucideIcon> = {
  intake: ClipboardList,
  evidence: ScanSearch,
  case_coordinator: Network,
  human_reviewer: UserRound,
  property: Home,
  medical: Stethoscope,
  legal: Scale,
};

/** Resolve an icon from a display name alone (no role available). */
function iconFromName(name: string | undefined): LucideIcon {
  const n = (name ?? "").toLowerCase();
  if (!n || n === "system") return Cog;
  if (n.includes("human") || n.includes("reviewer") || n.includes("adjuster")) return UserRound;
  if (n.includes("intake") || n.includes("coverage")) return ClipboardList;
  if (n.includes("evidence")) return ScanSearch;
  if (n.includes("coordinat") || n.includes("adjud")) return Network;
  if (n.includes("legal")) return Scale;
  if (n.includes("medical") || n.includes("clinic")) return Stethoscope;
  if (n.includes("property") || n.includes("assessor") || n.includes("orion")) return Home;
  return Bot;
}

/**
 * The icon for an agent. Prefers the gateway-stamped `role`; falls back to name
 * matching so callers with only a sender name (the audit trail) or no role (mock
 * participants) still get the right glyph.
 */
export function agentIcon(name: string | undefined, role?: string): LucideIcon {
  const fromRole = role ? ROLE_ICON[role] : undefined;
  return fromRole ?? iconFromName(name);
}
