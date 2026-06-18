"use client";

import { type ReactNode } from "react";

/** Inline emphasis, mentions, and claim ids inside audit prose. */
function formatInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  // Mention = "@" + a name of at most two words (e.g. "@Legal Review"); the
  // bounded form stops at the first non-name token so it can't swallow the rest
  // of a sentence (the prompts @mention a specialist and then describe the work).
  const re =
    /(\*\*(.+?)\*\*)|(@\[\[[^\]]+\]\])|(@[\w][\w-]*(?: [\w][\w-]*)?)|(\bCLM-\d{4}-\d+\b)/g;
  let last = 0;
  let n = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2]) {
      parts.push(
        <strong key={n++} className="audit-prose-strong">
          {match[2]}
        </strong>,
      );
    } else if (match[3] || match[4]) {
      const mention = (match[3] || match[4] || "").replace(/^@\[\[[^\]]+\]\]$/, "@…");
      parts.push(
        <span key={n++} className="audit-prose-mention">
          {mention}
        </span>,
      );
    } else if (match[5]) {
      parts.push(
        <span key={n++} className="audit-prose-claim">
          {match[5]}
        </span>,
      );
    }
    last = match.index + match[0].length;
  }

  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

function headingLevel(line: string): { level: number; text: string } | null {
  const m = line.match(/^(#{1,4})\s+(.+)$/);
  if (!m) return null;
  return { level: m[1].length, text: m[2] };
}

function listItem(line: string): { depth: number; text: string } | null {
  const m = line.match(/^(\s*)[-*•]\s+(.+)$/);
  if (!m) return null;
  const depth = Math.floor(m[1].length / 2);
  return { depth, text: m[2] };
}

/** Readable layout for agent handoffs — headers, bullets, mentions, bold. */
export function AuditProse({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let listBuffer: { depth: number; text: string }[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    nodes.push(
      <ul key={key} className="audit-prose-ul">
        {listBuffer.map((item, i) => (
          <li
            key={i}
            className="audit-prose-li"
            style={item.depth > 0 ? { marginLeft: `${item.depth * 0.75}rem` } : undefined}
          >
            {formatInline(item.text)}
          </li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushList(`list-${i}`);
      return;
    }

    const head = headingLevel(line.trim());
    if (head) {
      flushList(`list-${i}`);
      const Tag = head.level <= 2 ? "h3" : "h4";
      nodes.push(
        <Tag key={`h-${i}`} className="audit-prose-h">
          {formatInline(head.text)}
        </Tag>,
      );
      return;
    }

    const item = listItem(line);
    if (item) {
      listBuffer.push(item);
      return;
    }

    flushList(`list-${i}`);
    nodes.push(
      <p key={`p-${i}`} className="audit-prose-p">
        {formatInline(line.trim())}
      </p>,
    );
  });

  flushList("list-end");

  return <div className="audit-prose">{nodes}</div>;
}

/** Wrap plain string segments that may contain multiple paragraphs. */
export function AuditProseBlock({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <div className="audit-message-card">
      <AuditProse text={text} />
    </div>
  );
}
