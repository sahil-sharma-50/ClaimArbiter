"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  computeLiveStatsFromRecords,
  mergeClaimsWithSessions,
  type LiveStats,
} from "@/dashboard/lib/sessions";
import { usePlatformSync } from "@/dashboard/lib/usePlatformSync";
import { usePublishLiveActive, usePublishRouteSlot } from "@/dashboard/components/platform/PlatformSyncContext";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { SectionHead } from "@/dashboard/components/platform/StatCard";
import { SessionTable } from "@/dashboard/components/platform/SessionTable";
import { OverviewAnalytics } from "@/dashboard/components/platform/OverviewAnalytics";

export default function DashboardPage() {
  const { sessions, claims, syncing, hydrated, lastSyncedAt } = usePlatformSync();

  const merged = mergeClaimsWithSessions(claims, sessions);
  const stats = computeLiveStatsFromRecords(merged);
  const recent = merged.slice(0, 8);
  const loading = !lastSyncedAt && claims.length === 0 && sessions.length === 0;

  usePublishLiveActive(stats.inFlight > 0);
  usePublishRouteSlot(
    "QUEUE",
    !hydrated
      ? null
      : stats.awaitingSignOff > 0
        ? `${stats.awaitingSignOff} sign-off`
        : stats.inFlight > 0
          ? `${stats.inFlight} in flight`
          : stats.total > 0
            ? `${stats.total} tracked`
            : "All clear",
  );

  const brief = briefFor(stats, hydrated);

  return (
    <div className="platform-page dash-page">
      <PlatformPageBrief
        kicker={brief.kicker}
        title={brief.title}
        sub={brief.sub}
        tone={brief.tone}
        live={syncing}
        actions={brief.actions}
      />

      <OverviewAnalytics claims={claims} loading={loading} />

      <section className="platform-section dash-sessions">
        <SectionHead
          title="Recent sessions"
          action={
            <Link href="/app/sessions" className="platform-text-link">
              View all
            </Link>
          }
        />
        <SessionTable sessions={recent} variant="dashboard" syncing={syncing} compact />
      </section>
    </div>
  );
}

function briefFor(
  stats: LiveStats,
  hydrated: boolean,
): {
  tone: string;
  kicker: string;
  title: string;
  sub: string;
  actions: ReactNode;
} {
  if (stats.awaitingSignOff > 0) {
    return {
      tone: "var(--warning)",
      kicker: "Action needed",
      title: `${stats.awaitingSignOff} verdict${stats.awaitingSignOff === 1 ? "" : "s"} ready for sign-off`,
      sub: "Review the agent trail and post your decision back to the room.",
      actions: (
        <Link className="btn btn-accent" href="/app/sessions?filter=escalated">
          Review now
        </Link>
      ),
    };
  }
  if (stats.inFlight > 0) {
    return {
      tone: "var(--info)",
      kicker: "In progress",
      title: `${stats.inFlight} claim${stats.inFlight === 1 ? "" : "s"} moving through Band`,
      sub: "Agents are coordinating across orgs. Follow the live console if you want to watch.",
      actions: (
        <Link className="btn btn-secondary" href="/app/live">
          Open console
        </Link>
      ),
    };
  }
  if (hydrated && stats.total === 0) {
    return {
      tone: "var(--accent-strong)",
      kicker: "Get started",
      title: "No claims yet",
      sub: "Start a claim and watch Insurance Provider recruit the right specialist across the org boundary.",
      actions: (
        <>
          <Link className="btn btn-accent" href="/app/new">
            New claim
          </Link>
          <Link className="btn btn-secondary" href="/app/live">
            Run a demo
          </Link>
        </>
      ),
    };
  }
  return {
    tone: "var(--success)",
    kicker: "All clear",
    title: "Nothing waiting on you",
    sub: `${stats.completed} claim${stats.completed === 1 ? "" : "s"} signed and closed. Start another when you are ready.`,
    actions: (
      <Link className="btn btn-accent" href="/app/new">
        New claim
      </Link>
    ),
  };
}
