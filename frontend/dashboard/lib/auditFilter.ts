import type { AuditEntry } from "@/dashboard/lib/api";

/** Structured stages worth surfacing in the operator audit rail. */
const MILESTONE_STAGES = new Set([
  "intake",
  "coverage",
  "evidence_analysis",
  "review_score",
  "discovery",
  "recruiting",
  "specialist_verdict",
  "fraud_verdict",
  "conflict",
  "escalation",
  "signoff",
]);

const NOISE_TYPES = new Set(["tool_call", "tool_result", "thought"]);

/** Insurance Provider agents whose Band text handoffs are worth surfacing. */
const MERIDIAN_AGENTS = new Set([
  "Intake",
  "Intake Coverage",
  "Intake & Coverage",
  "Intake+Coverage",
  "Evidence Analyst",
  "Case Coordinator",
  "Adjudicator",
  "Human Reviewer",
  "Human Adjuster",
  "Adjuster",
]);

function isMeridianAgent(sender?: string | null): boolean {
  return Boolean(sender && MERIDIAN_AGENTS.has(sender));
}

function isSpecialistAgent(sender?: string | null): boolean {
  return Boolean(sender && sender !== "system" && !MERIDIAN_AGENTS.has(sender));
}

function stripJsonBlocks(text: string): string {
  return text
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*"claim_id"[\s\S]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text: string, max = 140): string {
  const clean = stripJsonBlocks(text);
  if (!clean) return "";
  const match = clean.match(/^[^.!?]+[.!?]?/);
  const line = (match?.[0] ?? clean).trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** True when an audit line is worth showing in the compact operator trail. */
export function isImportantAuditEntry(entry: AuditEntry): boolean {
  if (NOISE_TYPES.has(entry.type)) return false;
  if (entry.type === "error") return true;

  const stage = entry.stage?.trim();
  if (stage && MILESTONE_STAGES.has(stage)) return true;

  const content = entry.content ?? "";
  const lower = content.toLowerCase();

  const hasEmbeddedJson =
    content.includes("```json") || (content.includes('"claim_id"') && content.includes("{"));
  if (hasEmbeddedJson) {
    if (entry.type === "text" && (isMeridianAgent(entry.sender) || isSpecialistAgent(entry.sender))) {
      return true;
    }
    return false;
  }

  if (entry.sender === "system") return true;

  if (lower.includes("[signed]")) return true;
  if (lower.includes("seeded")) return true;
  if (lower.includes("recruited") && lower.includes("boundary")) return true;
  if (lower.includes("joined the room")) return true;
  if (lower.includes("escalat")) return true;
  if (lower.includes("please review")) return true;
  if (lower.startsWith("conflict:")) return true;
  if (lower.includes("decision:")) return true;
  if (lower.includes("verdict:")) return true;
  if (lower.includes("expert match:")) return true;
  if (lower.includes("no expert match")) return true;

  if (entry.type === "text") {
    if (lower.includes("parsing claim")) return false;
    if (lower.includes("reviewing on open-weight")) return false;
    // Room-visible agent prose — the @mention handoffs Band shows in full.
    if ((isMeridianAgent(entry.sender) || isSpecialistAgent(entry.sender)) && isReadableTextMessage(entry)) {
      return true;
    }
    if (/recommend|approve|deny|verdict|relaying specialist/i.test(content) && content.length < 320) {
      return true;
    }
    return false;
  }

  if (entry.type === "task") {
    return content.length > 0 && content.length < 400;
  }

  return false;
}

const STAGE_LABEL: Record<string, string> = {
  intake: "Intake recorded",
  coverage: "Coverage decision",
  evidence_analysis: "Evidence analyzed",
  review_score: "Routing score computed",
  discovery: "Expert matched",
  recruiting: "Specialist recruited",
  specialist_verdict: "Specialist verdict",
  fraud_verdict: "Specialist verdict",
  conflict: "Conflict flagged",
  escalation: "Escalated to human",
  signoff: "Human signed off",
};

/** Readable body for the audit rail — fuller than a one-line digest. */
export function auditTrailBody(entry: AuditEntry, max = 360): string {
  const stage = entry.stage?.trim();
  const body = displayTextMessage(entry.content ?? "", max);

  if (stage && STAGE_LABEL[stage]) {
    if (!body) return STAGE_LABEL[stage];
    if (entry.type === "text" && body.length > 48) return body;
    if (body.toLowerCase().startsWith(STAGE_LABEL[stage].toLowerCase())) return body;
    return `${STAGE_LABEL[stage]} — ${displayTextMessage(entry.content ?? "", 140)}`;
  }

  return body || firstSentence(entry.content ?? "", max);
}

/** @deprecated use auditTrailBody — kept for callers that expect a short label */
export function compactAuditSummary(entry: AuditEntry): string {
  return auditTrailBody(entry, 140);
}

/** Human-readable line for stage detail activity (no JSON/tool noise). */
export function compactEventText(content: string, max = 180): string {
  let text = stripJsonBlocks(content);
  text = text.replace(/@\[\[[^\]]+\]\]/g, "").replace(/@\S+/g, "").trim();
  if (/^band_/i.test(text) || text.includes('"participants"')) return "";
  return firstSentence(text, max);
}

/** Full prose for verdict bodies — strips JSON/mentions but keeps the narrative. */
export function humanizeProse(content: string, max = 600): string {
  let text = stripJsonBlocks(content);
  text = text.replace(/@\[\[[^\]]+\]\]/g, "").replace(/@\S+/g, "").replace(/\s+/g, " ").trim();
  if (/^band_/i.test(text) || text.includes('"participants"')) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Text messages for stage detail — drop JSON/tool noise, keep readable prose. */
export function displayTextMessage(content: string, max = 480): string {
  let text = stripJsonBlocks(content).replace(/\s+/g, " ").trim();
  if (/^band_/i.test(text) || text.includes('"participants"')) return "";
  if (/^\s*[\[{]/.test(text)) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** True when an audit line is a human text message worth showing in stage detail. */
export function isReadableTextMessage(entry: AuditEntry): boolean {
  if (entry.type !== "text") return false;
  return Boolean(displayTextMessage(entry.content ?? ""));
}

/** Filter to milestone lines and dedupe back-to-back identical summaries. */
export function filterAuditTrail(entries: AuditEntry[]): AuditEntry[] {
  const out: AuditEntry[] = [];
  let prevKey = "";

  for (const entry of entries) {
    if (!isImportantAuditEntry(entry)) continue;
    const summary = auditTrailBody(entry);
    if (!summary) continue;
    const key = `${entry.sender ?? ""}|${entry.ts ?? ""}|${summary.slice(0, 96)}`;
    if (key === prevKey) continue;
    prevKey = key;
    out.push(entry);
  }

  return out;
}
