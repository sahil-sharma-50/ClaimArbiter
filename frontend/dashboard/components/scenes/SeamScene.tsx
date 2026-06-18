"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type {
  CasefileEntry,
  Discovery,
  DiscoveryCandidate,
  HandshakeEvent,
  Specialist,
} from "@/dashboard/lib/api";
import { SceneHead } from "@/dashboard/components/scenes/parts";
import { resolveHandshakeStep, handshakeStepMarker } from "@/dashboard/lib/handshake";
import { SPECIALIST_DIRECTORY, type SpecialistDirectoryEntry } from "@/dashboard/lib/registry";

/*
  SCENE: recruiting — THE NORTH STAR (directory reveal).

  The Case Coordinator doesn't know up front who can help. It queries Band's peer
  directory (lookup_peers), sees the specialists available across the trust
  boundary, REASONS about which one this claim needs, and recruits that one live.
  This scene makes that choice visible: three capability-tagged specialist cards,
  a spotlight that lands on the matched one, the Case Coordinator's printed reasoning,
  and the chosen card crossing the boundary into the room.

  A clean claim recruits nobody — the directory still appears, but the reasoning
  concludes no specialist is warranted and the flow returns to Insurance Provider.
*/

// The static specialist directory (the candidates lookup_peers surfaces). Which
// one lights up is dynamic; the roster itself is the platform's offering. Sourced
// from the Specialist Registry so it can't drift from the backend roster.
const DIRECTORY = SPECIALIST_DIRECTORY;

const HS_STEPS = [
  { key: "request", label: "Request", hint: "Insurance Provider asks" },
  { key: "consent", label: "Consent", hint: "crossing boundary" },
  { key: "approved", label: "Approved", hint: "specialist agrees" },
  { key: "joined", label: "Joined", hint: "in the room" },
] as const;

function stepFromEvents(events: HandshakeEvent[], casefile: CasefileEntry[], specialistJoined: boolean): number {
  return resolveHandshakeStep(events, casefile, { specialistJoined });
}

export function SeamScene({
  handshake,
  casefile,
  specialist,
  discovery,
}: {
  handshake: HandshakeEvent[];
  casefile: CasefileEntry[];
  specialist: Specialist | null;
  discovery: Discovery | null;
}) {
  const step = stepFromEvents(handshake, casefile, Boolean(specialist));
  const recruitEvt = casefile.find((c) => c.stage === "recruiting");
  // The chosen specialty: prefer the descriptor, else infer from the recruited
  // handle. null + a recruiting signal that named no one ⇒ the clean path.
  const chosenType: Specialist["type"] | null =
    specialist?.type ??
    DIRECTORY.find((d) => discovery?.recruited_handle?.toLowerCase().includes(d.type))?.type ??
    null;
  const recruitedSomeone = Boolean(chosenType) || step >= 1;
  const cleanPath = !recruitedSomeone && (handshake.length > 0 || Boolean(recruitEvt));

  const reasoning = discovery?.reasoning ?? [];
  const headRef = useRef<HTMLDivElement>(null);

  // Live discovery candidates from Band's peer directory (lookup_peers). When the
  // gateway has surfaced real peers we render those; otherwise we fall back to the
  // static platform offering (the registry roster) shown at idle / in mock mode.
  const liveCandidates = discovery?.candidates ?? [];
  const matchedTag = discovery?.capability_tag ?? null;
  const matchPath = discovery?.match_path ?? null;
  const recruitedHandle = discovery?.recruited_handle ?? null;
  const usingLive = liveCandidates.length > 0;

  // Spotlight settle + chosen-card cross-in, interruptible & reduced-motion-safe.
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = headRef.current;
    if (!el || reduce) return;
    const cards = el.querySelectorAll<HTMLElement>("[data-spec-card]");
    const tween = gsap.fromTo(
      cards,
      { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: 0.45, stagger: 0.08, ease: "power2.out", overwrite: "auto" },
    );
    return () => {
      tween.kill();
    };
  }, []);

  // The chosen card crosses the trust boundary into the room when a peer is
  // recruited. Keyed on the recruited handle so it replays only on a new choice.
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = headRef.current;
    if (!el || reduce) return;
    const chosen = el.querySelector<HTMLElement>('[data-spec-card][data-state="chosen"]');
    if (!chosen) return;
    const tween = gsap.fromTo(
      chosen,
      { x: 40, opacity: 0.4, filter: "saturate(0.4)" },
      { x: 0, opacity: 1, filter: "saturate(1)", duration: 0.55, ease: "power2.out", overwrite: "auto" },
    );
    return () => {
      tween.kill();
    };
  }, [recruitedHandle]);

  return (
    <div ref={headRef} className="relative">
      <SceneHead
        kicker="03 · Discovery"
        title={
          cleanPath
            ? "No specialist needed. Insurance Provider decides."
            : "Finding the right specialist for this claim."
        }
        status={
          <span
            className="badge"
            style={
              step >= 3
                ? { background: "var(--success-subtle)", color: "var(--success)" }
                : { background: "var(--accent-subtle)", color: "var(--accent-strong)" }
            }
          >
            <span className="pulse-dot" style={{ background: "currentColor" }} />
            {step >= 3 ? "In the room" : cleanPath ? "Cleared directory" : "lookup_peers"}
          </span>
        }
      />

      {/* The specialist directory — three candidates across the boundary */}
      <div className="seam-directory mt-8">
        <div className="seam-dir-rail" aria-hidden>
          <span className="seam-dir-boundary-label">trust boundary · consent required</span>
        </div>
        <div className="seam-dir-grid">
          {(usingLive ? liveCandidates : DIRECTORY).map((entry, i) => {
            const isLive = usingLive;
            const name = isLive
              ? ((entry as DiscoveryCandidate).name ?? (entry as DiscoveryCandidate).handle ?? "Unknown peer")
              : (entry as SpecialistDirectoryEntry).org;
            const role = isLive
              ? ((entry as DiscoveryCandidate).handle ?? "")
              : (entry as SpecialistDirectoryEntry).role;
            const tags = isLive
              ? ((entry as DiscoveryCandidate).tags ?? [])
              : [(entry as SpecialistDirectoryEntry).tag];
            const handle = isLive ? ((entry as DiscoveryCandidate).handle ?? null) : null;
            const chosen = isLive
              ? Boolean(recruitedHandle && handle && recruitedHandle.toLowerCase() === handle.toLowerCase())
              : (entry as SpecialistDirectoryEntry).type === chosenType;
            const state = chosen
              ? "chosen"
              : usingLive || recruitedSomeone || cleanPath
                ? "dim"
                : "idle";
            return (
              <div
                key={handle ?? name ?? i}
                data-spec-card
                data-state={state}
                className="seam-spec-card"
              >
                <span className="seam-spec-org">{name}</span>
                {role && <span className="seam-spec-role">{role}</span>}
                <div className="seam-spec-tags">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="filter-chip"
                      data-matched={matchedTag === t ? "yes" : undefined}
                    >
                      #{t}
                    </span>
                  ))}
                </div>
                {chosen && step >= 3 && (
                  <span className="seam-spec-joined">✓ joined the room</span>
                )}
                {chosen && step < 3 && step >= 0 && (
                  <span className="seam-spec-chosen-mark">▲ matched</span>
                )}
              </div>
            );
          })}
        </div>
        {usingLive && matchPath && (
          <p className="seam-matchpath label">
            matched by {matchPath === "tag" ? `capability tag #${matchedTag}` : matchPath}
          </p>
        )}
      </div>

      {/* The Case Coordinator's reasoning — the visible "why this one" */}
      <div className="seam-reasoning mt-7">
        <p className="label" style={{ color: "var(--accent-strong)" }}>
          Case Coordinator reasoning
        </p>
        {reasoning.length > 0 ? (
          <ol className="seam-reasoning-list">
            {reasoning.slice(-4).map((r, i) => (
              <li key={i} className="seam-reasoning-line">
                {r.content}
              </li>
            ))}
          </ol>
        ) : (
          <p className="seam-reasoning-line" style={{ opacity: 0.7 }}>
            {cleanPath
              ? "Score below threshold. No specialist warranted. Deciding from coverage directly."
              : "Reading the claim and scanning the specialist directory…"}
          </p>
        )}
      </div>

      {/* Handshake progress — only meaningful when someone is being recruited */}
      {!cleanPath && (
        <ol className="mt-8 grid grid-cols-4 gap-2">
          {HS_STEPS.map((s, i) => {
            const active = i <= step;
            const current = i === step && step < 3;
            const advanced = i < step; // transition to the next step is complete
            return (
              <li key={s.key} className="relative flex flex-col items-center gap-1.5 text-center">
                {/* Directional connector toward the next step */}
                {i < HS_STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-[14px] box-border flex w-full -translate-y-1/2 items-center px-[18px]"
                  >
                    <span
                      className="h-[2px] flex-1 transition-colors duration-500"
                      style={{ background: advanced ? "var(--accent-strong)" : "var(--line)" }}
                    />
                    <span
                      className="-ml-px text-[9px] leading-none transition-colors duration-500"
                      style={{ color: advanced ? "var(--accent-strong)" : "var(--line)" }}
                    >
                      ▶
                    </span>
                  </span>
                )}
                <span
                  className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 font-[family-name:var(--font-mono)] text-[11px] font-bold transition-all duration-500"
                  style={
                    active
                      ? {
                          borderColor: "var(--accent-strong)",
                          background: "var(--accent-subtle)",
                          color: "var(--accent-strong)",
                          boxShadow: current ? "0 0 0 4px var(--accent-subtle)" : "none",
                          transform: current ? "scale(1.12)" : "scale(1)",
                        }
                      : { borderColor: "var(--line)", background: "var(--inset)", color: "var(--text-ghost)" }
                  }
                >
                  {handshakeStepMarker(i, step)}
                </span>
                <span
                  className="font-[family-name:var(--font-mono)] text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: active ? "var(--text-soft)" : "var(--text-ghost)" }}
                >
                  {s.label}
                </span>
                <span className="text-[9px] leading-tight text-[var(--text-ghost)]">{s.hint}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
