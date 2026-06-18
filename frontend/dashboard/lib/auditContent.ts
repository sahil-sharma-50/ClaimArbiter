import type { EventKind } from "@/dashboard/lib/eventStyle";

export type AuditPayload = {
  label: string;
  detail?: string;
  preview?: string;
  formatted: string;
};

export type AuditContentView =
  | { kind: "prose"; text: string }
  | { kind: "code"; text: string }
  | { kind: "payload"; payload: AuditPayload }
  | { kind: "mixed"; lead?: string; payload: AuditPayload; tail?: string };

type ToolCallPayload = {
  name?: string;
  args?: unknown;
  tool_call_id?: string;
};

function normalizeContent(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "object") {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const value = JSON.parse(trimmed);
    if (typeof value === "object" && value !== null) return value;
    if (Array.isArray(value)) return value;
    return null;
  } catch {
    return null;
  }
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function extractFencedJson(text: string): { lead?: string; json: string; tail?: string } | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match || match.index == null) return null;
  const parsed = tryParseJson(match[1]);
  if (!parsed) return null;
  const lead = text.slice(0, match.index).trim();
  const tail = text.slice(match.index + match[0].length).trim();
  return {
    lead: lead || undefined,
    json: formatJson(parsed),
    tail: tail || undefined,
  };
}

function extractBareJson(text: string): { lead?: string; json: string; tail?: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start || end - start < 2) return null;
  const parsed = tryParseJson(text.slice(start, end + 1));
  if (!parsed) return null;
  const lead = text.slice(0, start).trim();
  const tail = text.slice(end + 1).trim();
  return {
    lead: lead || undefined,
    json: formatJson(parsed),
    tail: tail || undefined,
  };
}

function payloadLabel(type: EventKind): string {
  if (type === "tool_result") return "Response";
  if (type === "tool_call") return "Tool call";
  return "Payload";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseToolCallContent(content: unknown): ToolCallPayload | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (!trimmed.startsWith("{")) return null;
    const parsed = tryParseJson(trimmed);
    return asRecord(parsed) as ToolCallPayload | null;
  }
  return asRecord(content) as ToolCallPayload | null;
}

function normalizeToolCallArgs(args: unknown): unknown {
  if (typeof args === "string") {
    const inner = tryParseJson(args);
    return inner ?? args;
  }
  return args;
}

function formatToolCall(payload: ToolCallPayload): string {
  return formatJson({
    ...payload,
    args: normalizeToolCallArgs(payload.args),
  });
}

function toolCallPreview(args: unknown): string | undefined {
  const normalized = normalizeToolCallArgs(args);
  const record = asRecord(normalized);
  if (record) {
    for (const key of ["content", "summary", "message", "query", "text"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  if (typeof args === "string" && args.trim() && !args.trim().startsWith("{")) {
    return args.trim();
  }
  return undefined;
}

function humanizeToolName(name: string): string {
  const stripped = name.replace(/^band_/, "").replace(/_/g, " ").trim();
  if (!stripped) return "Tool call";
  return stripped.replace(/\b\w/g, (char) => char.toUpperCase());
}

function toolCallDetail(name: string, callId?: string): string {
  const parts = [name];
  if (callId) parts.push(`…${callId.slice(-6)}`);
  return parts.join(" · ");
}

function jsonPreview(formatted: string): string | undefined {
  const parsed = tryParseJson(formatted);
  const record = asRecord(parsed);
  if (typeof record?.claim_id === "string") return String(record.claim_id);
  if (typeof record?.name === "string") return String(record.name);
  if (record) {
    const keys = Object.keys(record).slice(0, 4);
    if (keys.length) return `{ ${keys.join(", ")} }`;
  }
  return undefined;
}

function makePayload(
  formatted: string,
  type: EventKind,
  overrides?: Partial<AuditPayload>,
): AuditPayload {
  return {
    label: payloadLabel(type),
    formatted,
    preview: jsonPreview(formatted),
    ...overrides,
  };
}

function viewToolCall(content: unknown): AuditContentView {
  const payload = parseToolCallContent(content);
  if (payload?.name) {
    const callId = typeof payload.tool_call_id === "string" ? payload.tool_call_id : undefined;
    return {
      kind: "payload",
      payload: {
        label: humanizeToolName(payload.name),
        detail: toolCallDetail(payload.name, callId),
        preview: toolCallPreview(payload.args),
        formatted: formatToolCall(payload),
      },
    };
  }
  return { kind: "code", text: normalizeContent(content) };
}

function viewStructuredJson(content: unknown, type: EventKind): AuditContentView {
  const formatted =
    typeof content === "object" && content !== null
      ? normalizeContent(content)
      : formatJson(tryParseJson(normalizeContent(content)) ?? normalizeContent(content));

  return {
    kind: "payload",
    payload: makePayload(formatted, type),
  };
}

/** Classify audit line content for rendering (prose, command, or structured JSON). */
export function viewAuditContent(content: unknown, type: EventKind): AuditContentView {
  if (type === "tool_call") {
    return viewToolCall(content);
  }

  if (typeof content === "object" && content !== null) {
    return viewStructuredJson(content, type);
  }

  const text = normalizeContent(content);

  const fenced = extractFencedJson(text);
  if (fenced) {
    const payload = makePayload(fenced.json, type, { label: "Claim JSON" });
    if (fenced.lead || fenced.tail) {
      return { kind: "mixed", lead: fenced.lead, payload, tail: fenced.tail };
    }
    return { kind: "payload", payload };
  }

  const whole = tryParseJson(text);
  if (whole) {
    return { kind: "payload", payload: makePayload(formatJson(whole), type) };
  }

  const bare = extractBareJson(text);
  if (bare) {
    const payload = makePayload(bare.json, type, { label: "Payload" });
    if (bare.lead || bare.tail) {
      return { kind: "mixed", lead: bare.lead, payload, tail: bare.tail };
    }
    return { kind: "payload", payload };
  }

  return { kind: "prose", text };
}
