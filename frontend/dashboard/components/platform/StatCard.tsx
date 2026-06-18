import type { ReactNode } from "react";

const TONE_DOT: Record<string, string> = {
  default: "var(--text-faint)",
  info: "var(--info)",
  warning: "var(--warning)",
  success: "var(--success)",
};

export function StatCard({
  label,
  value,
  tone = "default",
  suffix,
  hint,
  href,
  navLabel,
  loading = false,
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "info";
  suffix?: string;
  /** Short context line under the value, e.g. "60% of all claims". */
  hint?: string;
  /** When set, the card becomes a navigation link. */
  href?: string;
  /** Accessible name for the link, e.g. "View 3 in-progress sessions". */
  navLabel?: string;
  /** Cold-load skeleton: show a shimmer instead of the value. */
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="stat-card-top">
        <span className="stat-card-dot" style={{ background: TONE_DOT[tone] }} aria-hidden />
        <span className="stat-card-label">{label}</span>
        {href && (
          <span className="stat-card-arrow" aria-hidden>
            ›
          </span>
        )}
      </div>
      {loading ? (
        <>
          <p className="stat-card-value stat-card-skeleton" aria-hidden />
          <p className="stat-card-hint stat-card-hint-skeleton" aria-hidden />
        </>
      ) : (
        <>
          <p className="stat-card-value tabular">
            {value}
            {suffix && <span className="stat-card-suffix">{suffix}</span>}
          </p>
          {hint && <p className="stat-card-hint">{hint}</p>}
        </>
      )}
    </>
  );

  if (href) {
    return (
      <a className="stat-card is-clickable" href={href} aria-label={navLabel ?? `${label}: ${value}`}>
        {body}
      </a>
    );
  }

  return <div className="stat-card">{body}</div>;
}

export function SectionHead({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="platform-section-head">
      <h2>{title}</h2>
      {action}
    </div>
  );
}
