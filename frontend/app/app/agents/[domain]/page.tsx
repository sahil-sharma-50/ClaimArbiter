"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban, Check } from "lucide-react";
import { fetchPolicies, type Policy } from "@/dashboard/lib/api";
import { usePublishRouteSlot } from "@/dashboard/components/platform/PlatformSyncContext";
import { PlatformPageBrief } from "@/dashboard/components/platform/PlatformPageBrief";
import { SectionHead } from "@/dashboard/components/platform/StatCard";
import { Icon } from "@/dashboard/components/ui/Icon";

type LoadState = "loading" | "ready" | "error";

const KNOWN_DOMAINS = ["property", "medical", "legal"] as const;
type Domain = (typeof KNOWN_DOMAINS)[number];

function isKnownDomain(value: string): value is Domain {
  return (KNOWN_DOMAINS as readonly string[]).includes(value);
}

/*
  The approve/deny stance for one domain specialist, live from the gateway's
  /api/policies proxy (which mirrors backend/agents/shared/policies.py). Nothing
  here is hardcoded — the title, org, summary, and the approve/deny bullets are
  whatever the backend policy module reports. Reached by clicking a specialist
  agent card on /app/agents.
*/
export default function AgentPolicyPage() {
  const params = useParams<{ domain: string }>();
  const rawDomain = typeof params?.domain === "string" ? params.domain : "";
  const known = isKnownDomain(rawDomain);

  const [policy, setPolicy] = useState<Policy | null>(null);
  const [load, setLoad] = useState<LoadState>("loading");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // Unknown domain never hits the network — go straight to not-found.
    if (!known) {
      setLoad("error");
      return;
    }
    let cancelled = false;
    setLoad("loading");
    (async () => {
      try {
        const all = await fetchPolicies();
        if (cancelled) return;
        const match = all.find((p) => p.domain === rawDomain) ?? null;
        setPolicy(match);
        setLoad("ready");
      } catch {
        if (!cancelled) setLoad("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawDomain, known, nonce]);

  const refresh = () => {
    setLoad("loading");
    setNonce((n) => n + 1);
  };

  usePublishRouteSlot(
    "POLICY",
    !known
      ? "Unknown"
      : load === "ready"
        ? policy
          ? policy.title
          : "Not found"
        : load === "loading"
          ? "Loading"
          : "Offline",
  );

  // Unknown segment in the URL — render a clean not-found, no fabricated stance.
  if (!known) {
    return (
      <div className="platform-page">
        <PlatformPageBrief
          kicker="Policy"
          title="Unknown specialty"
          sub="No domain specialist matches this address. Pick a specialist from the agent directory to read its approve/deny policy."
        />
        <div className="platform-empty">
          <p className="platform-empty-title">No policy for &ldquo;{rawDomain}&rdquo;</p>
          <p className="platform-empty-body">
            Policies exist for the property, medical, and legal specialists only.
          </p>
          <Link href="/app/agents" className="btn btn-secondary policy-back">
            <Icon as={ArrowLeft} size={14} />
            Back to agents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="platform-page">
      <PlatformPageBrief
        kicker="Policy"
        live={load === "loading"}
        title={policy ? policy.title : "Specialist policy"}
        sub={
          policy
            ? `The approve/deny stance ${policy.org}'s ${policy.title} enforces on every claim routed to this specialty. Live from Band's policy registry.`
            : "The approve/deny stance this domain specialist enforces on every claim routed to it. Live from Band's policy registry."
        }
      />

      <div className="platform-toolbar">
        <p className="platform-toolbar-status" role="status" aria-live="polite">
          {load === "ready"
            ? policy
              ? `${policy.org} · ${policy.approve.length} approve · ${policy.deny.length} deny`
              : "No matching policy"
            : load === "loading"
              ? "Loading from Band…"
              : "Couldn't reach the policy registry"}
        </p>
        <Link href="/app/agents" className="platform-text-link policy-back-link">
          ← All agents
        </Link>
        <button
          type="button"
          className="btn btn-secondary platform-toolbar-action"
          onClick={() => void refresh()}
          disabled={load === "loading"}
          aria-label="Refresh policy"
        >
          {load === "loading" ? "Syncing…" : "Refresh"}
        </button>
      </div>

      {load === "error" ? (
        <div className="platform-empty">
          <p className="platform-empty-title">Policy registry unavailable</p>
          <p className="platform-empty-body">
            The gateway couldn&apos;t read the policy registry. Make sure the backend is running.
          </p>
        </div>
      ) : load === "ready" && !policy ? (
        <div className="platform-empty">
          <p className="platform-empty-title">No policy found</p>
          <p className="platform-empty-body">
            Band reported no policy for the {rawDomain} specialist.
          </p>
        </div>
      ) : policy ? (
        <>
          <section className="platform-section">
            <SectionHead title="Summary" />
            <p className="policy-summary">{policy.summary}</p>
          </section>

          <section className="platform-section">
            <div className="policy-columns">
              <PolicyColumn tone="approve" title="Approves" items={policy.approve} />
              <PolicyColumn tone="deny" title="Denies" items={policy.deny} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function PolicyColumn({
  tone,
  title,
  items,
}: {
  tone: "approve" | "deny";
  title: string;
  items: string[];
}) {
  const color = tone === "approve" ? "var(--success)" : "var(--danger)";
  const Glyph = tone === "approve" ? Check : Ban;
  return (
    <div className="policy-column" data-tone={tone} style={{ ["--policy-tone" as string]: color }}>
      <div className="policy-column-head">
        <span className="policy-column-icon" aria-hidden>
          <Icon as={Glyph} size={14} />
        </span>
        <h3 className="policy-column-title">{title}</h3>
      </div>
      <ul className="policy-list">
        {items.map((item, i) => (
          <li key={i} className="policy-item">
            <span className="policy-item-mark" aria-hidden>
              <Icon as={Glyph} size={12} />
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
