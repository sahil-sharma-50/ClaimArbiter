"use client";

import type { ClaimSummary } from "@/dashboard/lib/api";
import {
  agreementStat,
  approvalMatrix,
  specialistUsage,
} from "@/dashboard/lib/analytics";
import { SectionHead } from "@/dashboard/components/platform/StatCard";

/**
 * The overview analytics row: three live instruments derived purely from the
 * enriched claim list — outcome mix by domain, AI/human agreement, and which
 * specialists get recruited most. All three share one honest empty state: when
 * no claim carries the relevant data yet, the card says so rather than drawing a
 * zeroed chart. Sits between the claim-load gauge and the recent-sessions table.
 */
export function OverviewAnalytics({
  claims,
  loading,
}: {
  claims: ClaimSummary[];
  loading: boolean;
}) {
  const matrix = approvalMatrix(claims);
  const agreement = agreementStat(claims);
  const usage = specialistUsage(claims);

  return (
    <section className="platform-section dash-analytics" aria-label="Claim analytics">
      <SectionHead title="Claim analytics" />
      <div className="analytics-grid">
        <ApprovalCard matrix={matrix} loading={loading} />
        <AgreementCard stat={agreement} loading={loading} />
        <UsageCard usage={usage} loading={loading} />
      </div>
    </section>
  );
}

function AnalyticsCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="analytics-card">
      <div className="analytics-card-head">
        <span className="analytics-card-title">{title}</span>
        {hint && <span className="analytics-card-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function CardEmpty({ children }: { children: React.ReactNode }) {
  return <p className="analytics-empty">{children}</p>;
}

function CardSkeleton() {
  return (
    <div className="analytics-skeleton" aria-hidden>
      <span />
      <span />
      <span />
    </div>
  );
}

/* ── Approval / denial by domain ── one stacked bar per recruited specialist
   domain, split approved / denied / pending, so the outcome mix reads at a
   glance instead of as a grid of numbers. A shared legend names the tones. */
function ApprovalCard({
  matrix,
  loading,
}: {
  matrix: ReturnType<typeof approvalMatrix>;
  loading: boolean;
}) {
  const hint =
    !loading && matrix.hasData
      ? `${matrix.approved} approved · ${matrix.denied} denied`
      : undefined;

  return (
    <AnalyticsCard title="Approvals by domain" hint={hint}>
      {loading ? (
        <CardSkeleton />
      ) : !matrix.hasData ? (
        <CardEmpty>No specialist claims resolved yet.</CardEmpty>
      ) : (
        <div className="domain-mix">
          <ul className="domain-mix-list">
            {matrix.rows.map((row) => {
              const segs = [
                { key: "approve", value: row.approved, tone: "var(--success)" },
                { key: "deny", value: row.denied, tone: "var(--danger)" },
                { key: "pending", value: row.pending, tone: "var(--text-ghost)" },
              ].filter((s) => s.value > 0);
              return (
                <li key={row.type} className="domain-mix-row">
                  <span className="domain-mix-label">{row.domain}</span>
                  <span
                    className="domain-mix-bar"
                    role="img"
                    aria-label={`${row.domain}: ${row.approved} approved, ${row.denied} denied, ${row.pending} pending`}
                  >
                    {segs.map((s) => (
                      <span
                        key={s.key}
                        className="domain-mix-seg"
                        style={{ flexGrow: s.value, background: s.tone }}
                      />
                    ))}
                  </span>
                  <span className="domain-mix-total tabular">{row.total}</span>
                </li>
              );
            })}
          </ul>
          <ul className="mix-legend" aria-hidden>
            <li>
              <span className="mix-legend-dot" style={{ background: "var(--success)" }} />
              Approved
            </li>
            <li>
              <span className="mix-legend-dot" style={{ background: "var(--danger)" }} />
              Denied
            </li>
            <li>
              <span className="mix-legend-dot" style={{ background: "var(--text-ghost)" }} />
              Pending
            </li>
          </ul>
        </div>
      )}
    </AnalyticsCard>
  );
}

/* ── AI / human agreement ── a single headline rate plus an override readout. */
function AgreementCard({
  stat,
  loading,
}: {
  stat: ReturnType<typeof agreementStat>;
  loading: boolean;
}) {
  return (
    <AnalyticsCard title="AI / human agreement">
      {loading ? (
        <CardSkeleton />
      ) : stat.rate === null ? (
        <CardEmpty>No decided claims to compare yet.</CardEmpty>
      ) : (
        <div className="agreement">
          <div className="agreement-head">
            <p className="agreement-rate tabular" style={{ color: "var(--success)" }}>
              {stat.rate}
              <span className="agreement-rate-unit">%</span>
            </p>
            <p className="agreement-sub">
              agreed on <strong className="tabular">{stat.agreed}</strong> of{" "}
              <strong className="tabular">{stat.decided}</strong> decided claim
              {stat.decided === 1 ? "" : "s"}
            </p>
          </div>
          <span
            className="agreement-meter"
            role="img"
            aria-label={`${stat.rate}% agreement across ${stat.decided} decided claims`}
          >
            <span
              className="agreement-meter-fill"
              style={{ width: `${stat.rate ?? 0}%` }}
            />
          </span>
          <p className="agreement-override">
            {stat.overrode === 0 ? (
              "No human overrides."
            ) : (
              <>
                <span className="agreement-override-dot" aria-hidden />
                <strong className="tabular">{stat.overrode}</strong> human override
                {stat.overrode === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
      )}
    </AnalyticsCard>
  );
}

/* ── Most used specialists ── ranked bars of recruited cross-org agents. */
function UsageCard({
  usage,
  loading,
}: {
  usage: ReturnType<typeof specialistUsage>;
  loading: boolean;
}) {
  const max = usage.reduce((m, u) => Math.max(m, u.count), 0);

  return (
    <AnalyticsCard title="Most used specialists">
      {loading ? (
        <CardSkeleton />
      ) : usage.length === 0 ? (
        <CardEmpty>No specialists recruited yet.</CardEmpty>
      ) : (
        <ul className="usage-list">
          {usage.map((u) => (
            <li key={u.type} className="usage-row">
              <span className="usage-label">
                <span className="usage-dot" style={{ background: u.tone }} aria-hidden />
                {u.title}
              </span>
              <span className="usage-bar-track" aria-hidden>
                <span
                  className="usage-bar-fill"
                  style={{ width: `${max ? (u.count / max) * 100 : 0}%`, background: u.tone }}
                />
              </span>
              <span className="usage-count tabular">{u.count}</span>
            </li>
          ))}
        </ul>
      )}
    </AnalyticsCard>
  );
}
