"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, UserRound } from "lucide-react";
import { fetchAgents, type DirectoryAgent } from "@/dashboard/lib/api";
import { usePublishRouteSlot } from "@/dashboard/components/platform/PlatformSyncContext";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { MERIDIAN } from "@/dashboard/components/scenes/parts";
import { SectionHead } from "@/dashboard/components/platform/StatCard";
import { Icon } from "@/dashboard/components/ui/Icon";
import { SPECIALIST_DIRECTORY } from "@/dashboard/lib/registry";

/**
 * Map a live Band agent to a known specialist domain (property/medical/legal),
 * so its card can deep-link to that domain's approve/deny policy. We match on the
 * partner org from the registry — a human (the Human Reviewer) never maps. Returns
 * null for the home org and any agent without a registered specialty.
 */
function specialistDomain(agent: DirectoryAgent): SpecialistDirectoryEntry["type"] | null {
  if (agent.type === "human" || agent.org === MERIDIAN) return null;
  return SPECIALIST_DIRECTORY.find((s) => s.org === agent.org)?.type ?? null;
}

type SpecialistDirectoryEntry = (typeof SPECIALIST_DIRECTORY)[number];

type LoadState = "loading" | "ready" | "error";

/*
  The org's Band agents, live from the gateway's /api/agents proxy (which reads
  Band's peer directory). Nothing here is hardcoded — the roster, names, and
  handles are whatever Band reports. Each agent is grouped under its org and
  tinted home (Insurance Provider, violet) vs partner (teal), matching OrgRail.
*/
export default function AgentsPage() {
  const [agents, setAgents] = useState<DirectoryAgent[]>([]);
  const [load, setLoad] = useState<LoadState>("loading");
  // Bumped to re-trigger the fetch effect on a manual refresh.
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const next = await fetchAgents();
        if (!cancelled) {
          setAgents(next);
          setLoad("ready");
        }
      } catch {
        if (!cancelled) setLoad("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  // Manual refresh: show the spinner, then re-run the effect via the nonce.
  const refresh = () => {
    setLoad("loading");
    setNonce((n) => n + 1);
  };

  usePublishRouteSlot(
    "PEERS",
    load === "ready" ? `${agents.length} peers` : load === "loading" ? "Scanning" : "Offline",
  );

  // Group by org, home org first, so the directory reads as "us, then partners".
  const orgs = Array.from(new Set(agents.map((a) => a.org))).sort((x, y) => {
    if (x === MERIDIAN) return -1;
    if (y === MERIDIAN) return 1;
    return x.localeCompare(y);
  });

  return (
    <div className="platform-page">
      <PlatformPageBrief
        kicker="Agents"
        live={load === "loading"}
        title="Band agent directory"
        sub="Agents registered on the shared Band network. Insurance Provider first, then partner orgs. Names and handles come live from Band's peer directory."
      />
      <div className="platform-toolbar">
        <p className="platform-toolbar-status" role="status" aria-live="polite">
          {load === "ready"
            ? `${agents.length} ${agents.length === 1 ? "agent" : "agents"} · ${orgs.length} ${orgs.length === 1 ? "org" : "orgs"}`
            : load === "loading"
              ? "Loading from Band…"
              : "Couldn't reach the agent directory"}
        </p>
        <button
          type="button"
          className="btn btn-secondary platform-toolbar-action"
          onClick={() => void refresh()}
          disabled={load === "loading"}
          aria-label="Refresh agent directory"
        >
          {load === "loading" ? "Syncing…" : "Refresh"}
        </button>
      </div>

      {load === "error" ? (
        <div className="platform-empty">
          <p className="platform-empty-title">Agent directory unavailable</p>
          <p className="platform-empty-body">
            The gateway couldn&apos;t read Band&apos;s peer directory. Make sure the backend is
            running and the Case Coordinator&apos;s Band key is configured.
          </p>
        </div>
      ) : load === "ready" && agents.length === 0 ? (
        <div className="platform-empty">
          <p className="platform-empty-title">No agents found</p>
          <p className="platform-empty-body">Band reported no peers for this account.</p>
        </div>
      ) : (
        <div className="agent-directory">
          {orgs.map((org) => (
            <section key={org} className="platform-section agent-org-column">
              <SectionHead title={org} />
              <div className="agent-grid">
                {agents
                  .filter((a) => a.org === org)
                  .map((a) => (
                    <AgentCard key={`${a.org}:${a.name}`} agent={a} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: DirectoryAgent }) {
  const tone = agent.org === MERIDIAN ? "var(--org-a)" : "var(--org-b)";
  const domain = specialistDomain(agent);
  const inner = (
    <>
      <div className="agent-card-head">
        <span
          className="agent-card-av"
          style={{ background: `color-mix(in oklch, ${tone} 22%, var(--inset))`, color: tone }}
          aria-hidden
        >
          {initials(agent.name)}
        </span>
        <div className="min-w-0">
          <p className="agent-card-name">{agent.name}</p>
          {agent.handle && <p className="agent-card-handle">@{agent.handle}</p>}
        </div>
        {agent.type === "human" && (
          <span className="agent-card-tag inline-flex items-center gap-1">
            <Icon as={UserRound} size={11} />
            Human
          </span>
        )}
      </div>
      <dl className="agent-card-meta">
        <Meta label="Role" value={agent.role} />
        <Meta label="Org" value={agent.org} />
        <Meta label="Framework" value={agent.framework} />
        <Meta label="Model" value={agent.model} />
      </dl>
      {domain && (
        <span className="agent-card-policy">
          View policy
          <Icon as={ArrowRight} size={11} />
        </span>
      )}
    </>
  );

  // Specialist (partner-org) cards deep-link to their approve/deny policy; the
  // home org and the human reviewer stay as plain cards.
  if (domain) {
    return (
      <Link
        href={`/app/agents/${domain}`}
        className="agent-card"
        aria-label={`View ${agent.name} approve and deny policy`}
      >
        {inner}
      </Link>
    );
  }
  return <article className="agent-card">{inner}</article>;
}

function Meta({ label, value }: { label: string; value: string }) {
  // Don't render a row for a field Band left blank — show only what's real.
  if (!value) return null;
  return (
    <div className="agent-card-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "··"
  );
}
