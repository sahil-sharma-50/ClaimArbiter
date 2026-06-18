"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { Icon } from "@/dashboard/components/ui/Icon";
import { useFocusTrap } from "@/dashboard/lib/useFocusTrap";

/**
 * In-app confirmation modal — the styled replacement for window.confirm.
 *
 * Controlled by the parent via `open`: the parent owns the "which item / is it
 * in flight" state, this component owns presentation, focus trapping, Escape /
 * backdrop dismissal, and the accessible dialog semantics. `tone="danger"`
 * paints the confirm button as destructive (the default for delete actions).
 */
export function ConfirmDialog({
  open,
  title,
  body,
  meta,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busyLabel = "Removing…",
  tone = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  /** Optional small monospace line under the body, e.g. a record id. */
  meta?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  busyLabel?: string;
  tone?: "danger" | "default";
  /** While true the confirm button shows an in-flight state and is disabled. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);

  // Escape dismisses (unless an action is mid-flight). Bound at the window so it
  // works regardless of where focus currently sits inside the trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className="confirm-overlay"
      role="presentation"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="confirm-panel"
        data-tone={tone}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-head">
          {tone === "danger" && (
            <span className="confirm-icon" data-tone="danger" aria-hidden>
              <Icon as={AlertTriangle} size={20} />
            </span>
          )}
          <h2 id="confirm-title" className="confirm-title">
            {title}
          </h2>
        </div>

        <div id="confirm-body" className="confirm-body">
          {body}
          {meta && <p className="confirm-meta">{meta}</p>}
        </div>

        <div className="confirm-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
