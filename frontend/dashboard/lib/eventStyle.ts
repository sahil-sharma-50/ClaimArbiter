/*
  One vocabulary for audit event types, shared by the StageDetailCard and the
  redesigned audit timeline. Raw types ("tool_call", "tool_result") read as
  machine noise; these map them to a human verb + a tone + whether the line is a
  monospace "code" line (tool calls) or prose (everything else).
*/

export type EventKind = "text" | "task" | "thought" | "tool_call" | "tool_result" | "error" | string;

const VERB: Record<string, string> = {
  text: "Says",
  task: "Event",
  thought: "Reasons",
  tool_call: "Calls",
  tool_result: "Returns",
  error: "Error",
};

const TONE: Record<string, string> = {
  text: "var(--text-soft)",
  task: "var(--accent-strong)",
  thought: "var(--text-faint)",
  tool_call: "var(--info)",
  tool_result: "var(--success)",
  error: "var(--danger)",
};

export function eventVerb(type: EventKind): string {
  return VERB[type] ?? "Event";
}

export function eventTone(type: EventKind): string {
  return TONE[type] ?? "var(--text-faint)";
}

/** Tool calls render as monospace command lines; the rest as prose. */
export function isCodeEvent(type: EventKind): boolean {
  return type === "tool_call";
}

/** A short org tint for a sender name, so the timeline reads two-sided. */
export function senderTone(sender?: string): string {
  if (!sender) return "var(--text-faint)";
  if (
    sender === "Property Assessment" ||
    sender === "Medical Review" ||
    sender === "Legal Review" ||
    sender === "Property Group" ||
    sender === "Medical Group" ||
    sender === "Legal Group"
  ) {
    return "var(--org-b)";
  }
  if (sender === "system") return "var(--text-ghost)";
  // accept-both: live Band names may be old or new; mock data uses new
  if (sender === "Human Adjuster" || sender === "Human Reviewer") return "var(--accent-strong)";
  return "var(--org-a)";
}
