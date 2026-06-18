import Link from "next/link";
import type { CSSProperties } from "react";
import { PHASE_LABELS } from "@/dashboard/lib/sessions";
import type { SessionRecord } from "@/dashboard/lib/storage";

function phaseBadgeStyle(phase: string): CSSProperties {
  if (phase === "signed") return { background: "var(--success-subtle)", color: "var(--success)" };
  if (phase === "escalated") return { background: "var(--warning-subtle)", color: "var(--warning)" };
  if (phase !== "idle") return { background: "var(--accent-subtle)", color: "var(--accent-strong)" };
  return { background: "var(--inset)", color: "var(--text-faint)" };
}

function resultBadgeStyle(decision: "approve" | "deny" | null | undefined): CSSProperties {
  if (decision === "approve") return { background: "var(--success-subtle)", color: "var(--success)" };
  if (decision === "deny") return { background: "var(--danger-subtle)", color: "var(--danger)" };
  return { background: "var(--inset)", color: "var(--text-faint)" };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className="badge" style={phaseBadgeStyle(phase)}>
      {PHASE_LABELS[phase] ?? phase}
    </span>
  );
}

function ResultBadge({ decision }: { decision: "approve" | "deny" | null | undefined }) {
  const label =
    decision === "approve" ? "Approved" : decision === "deny" ? "Denied" : "Pending";
  return (
    <span className="badge" style={resultBadgeStyle(decision)}>
      {label}
    </span>
  );
}

export function SessionTable({
  sessions,
  onRemove,
  removingChatId = null,
  compact = false,
  variant = "sessions",
  syncing = false,
  filteredEmpty = false,
}: {
  sessions: SessionRecord[];
  onRemove?: (chatId: string) => void;
  /** chatId currently being archived, so its row shows an in-flight state. */
  removingChatId?: string | null;
  compact?: boolean;
  variant?: "dashboard" | "sessions";
  /** Shows a refresh shimmer along the top edge while a background sync runs. */
  syncing?: boolean;
  /** True when filters/search returned zero rows but unfiltered sessions exist. */
  filteredEmpty?: boolean;
}) {
  if (sessions.length === 0) {
    if (filteredEmpty) {
      return (
        <div className="platform-empty">
          <p className="platform-empty-title">No matches</p>
          <p className="platform-empty-body">
            Try clearing filters or broadening your search.
          </p>
        </div>
      );
    }

    return (
      <div className="platform-empty">
        <p className="platform-empty-title">No sessions yet</p>
        <p className="platform-empty-body">
          {variant === "dashboard"
            ? "Start a claim to see activity here."
            : "Run a demo claim to start building history in this browser."}
        </p>
        <Link href="/app/new" className="btn btn-accent">
          New claim
        </Link>
      </div>
    );
  }

  return (
    <div className={`platform-table-wrap${syncing ? " is-syncing" : ""}`}>
      {/* Desktop / tablet: table */}
      <table className="session-table session-table-desktop w-full text-left text-sm">
        <thead>
          <tr>
            <th>Claim</th>
            <th>Status</th>
            <th>Result</th>
            <th>Started</th>
            {!compact && <th>Synced</th>}
            <th className="text-right"> </th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.chatId} className="session-row">
              <td>
                <Link
                  href={`/app/live?chat_id=${encodeURIComponent(s.chatId)}`}
                  className="session-link"
                >
                  <span className="session-link-title">{s.label}</span>
                  <span className="session-link-id">{s.chatId.slice(0, 10)}…</span>
                </Link>
              </td>
              <td>
                <PhaseBadge phase={s.phase} />
              </td>
              <td>
                <ResultBadge decision={s.decision} />
              </td>
              <td className="session-meta">{formatDate(s.startedAt)}</td>
              {!compact && <td className="session-meta">{formatDate(s.lastSyncedAt)}</td>}
              <td className="text-right">
                <div className="session-actions">
                  <Link
                    href={`/app/live?chat_id=${encodeURIComponent(s.chatId)}`}
                    className="session-action"
                  >
                    Live
                  </Link>
                  <a
                    href={`https://app.band.ai/chat/${s.chatId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="session-action"
                  >
                    Band
                  </a>
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(s.chatId)}
                      disabled={removingChatId === s.chatId}
                      className="session-action session-action-danger"
                      aria-label={`Remove ${s.label} and archive its Band room`}
                    >
                      {removingChatId === s.chatId ? "Removing…" : "Remove"}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: card list */}
      <ul className="session-card-list">
        {sessions.map((s) => (
          <li key={s.chatId} className="session-card">
            <Link
              href={`/app/live?chat_id=${encodeURIComponent(s.chatId)}`}
              className="session-card-main"
            >
              <span className="session-link-title">{s.label}</span>
              <div className="session-card-badges">
                <PhaseBadge phase={s.phase} />
                <ResultBadge decision={s.decision} />
              </div>
            </Link>
            <div className="session-card-meta">
              <span className="session-meta">{formatDate(s.startedAt)}</span>
              <span className="session-link-id">{s.chatId.slice(0, 10)}…</span>
            </div>
            <div className="session-card-actions">
              <Link
                href={`/app/live?chat_id=${encodeURIComponent(s.chatId)}`}
                className="session-action"
              >
                Live
              </Link>
              <a
                href={`https://app.band.ai/chat/${s.chatId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="session-action"
              >
                Band
              </a>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(s.chatId)}
                  disabled={removingChatId === s.chatId}
                  className="session-action session-action-danger"
                  aria-label={`Remove ${s.label} and archive its Band room`}
                >
                  {removingChatId === s.chatId ? "Removing…" : "Remove"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
