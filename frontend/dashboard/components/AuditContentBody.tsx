"use client";

import { useState, type ReactNode } from "react";
import { ChevronsUpDown } from "lucide-react";
import type { AuditContentView, AuditPayload } from "@/dashboard/lib/auditContent";
import { AuditProseBlock } from "@/dashboard/components/AuditProse";
import { Icon } from "@/dashboard/components/ui/Icon";

let tokenId = 0;

function highlightJson(formatted: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = formatted.split("\n");
  const re =
    /("(?:[^"\\]|\\.)*")\s*(?=:)|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)/g;

  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) nodes.push("\n");
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(line)) !== null) {
      if (match.index > last) nodes.push(line.slice(last, match.index));
      const id = tokenId++;
      if (match[1]) nodes.push(<span key={id} className="audit-json-key">{match[1]}</span>);
      else if (match[2]) nodes.push(<span key={id} className="audit-json-str">{match[2]}</span>);
      else if (match[3]) nodes.push(<span key={id} className="audit-json-num">{match[3]}</span>);
      else if (match[4]) nodes.push(<span key={id} className="audit-json-bool">{match[4]}</span>);
      else if (match[5]) nodes.push(<span key={id} className="audit-json-null">{match[5]}</span>);
      last = match.index + match[0].length;
    }
    if (last < line.length) nodes.push(line.slice(last));
  });

  return nodes;
}

function PayloadPanel({ label, detail, preview, formatted }: AuditPayload) {
  const [expanded, setExpanded] = useState(false);
  const toggleLabel = expanded ? "Collapse JSON" : "Expand full JSON";
  const sub = preview || detail;

  return (
    <div className="audit-payload">
      <div className="audit-payload-head">
        <div className="audit-payload-head-copy">
          <span className="audit-payload-label">{label}</span>
          {sub ? <span className="audit-payload-detail">{sub}</span> : null}
        </div>
        <button
          type="button"
          className="audit-payload-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          <Icon
            as={ChevronsUpDown}
            size={14}
            className={expanded ? "audit-payload-toggle-icon is-expanded" : "audit-payload-toggle-icon"}
          />
        </button>
      </div>

      <pre className={`audit-payload-code scroll-thin${expanded ? " is-expanded" : ""}`}>
        <code>{highlightJson(formatted)}</code>
      </pre>
    </div>
  );
}

export function AuditContentBody({ view }: { view: AuditContentView }) {
  switch (view.kind) {
    case "code":
      return <code className="audit-code">{view.text}</code>;
    case "payload":
      return <PayloadPanel {...view.payload} />;
    case "mixed":
      return (
        <>
          {view.lead ? <AuditProseBlock text={view.lead} /> : null}
          <PayloadPanel {...view.payload} />
          {view.tail ? <AuditProseBlock text={view.tail} /> : null}
        </>
      );
    default:
      return <AuditProseBlock text={view.text} />;
  }
}
