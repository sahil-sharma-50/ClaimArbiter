"use client";

import { useEffect, useRef } from "react";
import type { AuditEntry } from "@/dashboard/lib/api";
import { filterAuditTrail } from "@/dashboard/lib/auditFilter";
import { viewAuditContent } from "@/dashboard/lib/auditContent";
import { AuditContentBody } from "@/dashboard/components/AuditContentBody";
import { senderTone } from "@/dashboard/lib/eventStyle";
import { agentIcon } from "@/dashboard/lib/agentIcon";
import { Icon } from "@/dashboard/components/ui/Icon";

/*
  The live record of the room, rebuilt as a readable TIMELINE rather than a
  stack of mono badges. Each event is a node on a rail: an org-tinted sender,
  a relative timestamp, a quiet verb chip, and the content rendered as prose
  (or a monospace command line for tool calls). Reinforces "Band is the system
  of record" — every line here came from the room. Auto-scrolls to newest.
*/

export function AuditTicker({
  entries,
  chatId,
  bandUrl,
}: {
  entries: AuditEntry[];
  chatId: string | null;
  bandUrl: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const filtered = filterAuditTrail(entries);
  // Keep the 40 most recent events, then show them NEWEST-FIRST so the latest
  // handoff is always at the top of the trail (slice keeps the tail in chronological
  // order; reverse flips it for display).
  const visible = filtered.slice(-40).reverse();

  // Newest is on top, so reveal the top of the feed when new events arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, [entries.length]);

  return (
    <section className="panel audit-panel flex h-full min-h-0 w-full flex-col">
      <header className="panel-header shrink-0">
        <div>
          <h2 className="panel-title">Audit trail</h2>
          <p className="panel-desc flex items-center gap-1.5">
            {chatId ? (
              <>
                <span className="pulse-dot" style={{ background: "var(--success)" }} />
                {visible.length} handoff messages
                {entries.length > visible.length && (
                  <span className="text-[var(--text-ghost)]"> · {entries.length} total in Band</span>
                )}
              </>
            ) : (
              "no room yet"
            )}
          </p>
        </div>
        {bandUrl && (
          <a
            href={bandUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary shrink-0 px-2.5 py-1.5 text-[11px]"
          >
            <ExternalIcon />
            Open in Band
          </a>
        )}
      </header>

      <div className="panel-body flex min-h-0 flex-1 flex-col pt-0">
        <div
          ref={scrollRef}
          className="audit-scroll scroll-thin"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {visible.length === 0 ? (
            <p className="audit-empty">Events stream here, sourced live from the Band room.</p>
          ) : (
            <ol className="audit-feed">
              {visible.map((e, idx) => {
                const tone = senderTone(e.sender);
                const view = viewAuditContent(e.content, e.type);
                // Newest-first ordering: the latest event is the first row. Phase
                // group dividers are intentionally omitted — in reverse order they'd
                // read against the workflow sequence.
                const isLatest = idx === 0;
                return (
                  <li key={idx} className="contents">
                    <div className="audit-item audit-item--compact animate-enter" data-latest={isLatest || undefined}>
                        <span className="audit-rail" aria-hidden>
                          <span className="audit-av" style={{ background: `color-mix(in oklch, ${tone} 18%, transparent)`, color: tone }}>
                            <Icon as={agentIcon(e.sender)} size={15} />
                          </span>
                        </span>
                        <div className="audit-content">
                          <div className="audit-meta">
                            <span className="audit-sender" style={{ color: tone }}>{e.sender ?? "system"}</span>
                            {isLatest && <span className="audit-new-badge">NEW</span>}
                            {e.ts && (
                              <time className="audit-time" dateTime={e.ts}>{clock(e.ts)}</time>
                            )}
                          </div>
                          <div className="audit-body">
                            <AuditContentBody view={view} />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

function clock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ExternalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
