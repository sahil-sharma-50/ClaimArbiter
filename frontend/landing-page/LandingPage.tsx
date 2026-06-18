"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState, Component, type ReactNode } from "react";
import { Brandmark } from "@/landing-page/components/Brandmark";
import { BrandLockup } from "@/landing-page/components/BrandLockup";
import { LandingGridBackdrop } from "@/landing-page/components/LandingGridBackdrop";
import { TransmissionBand } from "@/landing-page/components/TransmissionBand";
import { FLOW } from "@/landing-page/lib/flow";
import { useReveal } from "@/landing-page/lib/useReveal";
import { useScrollSpy } from "@/landing-page/lib/useScrollSpy";
import { isManagedLandingHash, scrollToLandingHash } from "@/landing-page/lib/landingHash";
import { LandingMobileMenu } from "@/landing-page/components/LandingMobileMenu";
/*
  Landing = the POWER-ON BRIEFING that funnels into the live terminal (/app).
  Near-single-viewport hero + live preview, then one compressed scrolly strip
  (problem · flow · architecture · why-band · payoff) below the fold. Same
  mission-control language as the console — they read as one product.

  The architecture diagram is the heaviest interactive block on the page and
  lives well below the fold, so it's code-split out of the initial bundle.
*/
const ArchitectureDiagram = dynamic(
  () => import("@/landing-page/components/ArchitectureDiagram").then((m) => m.ArchitectureDiagram),
  {
    ssr: false,
    loading: () => (
      <div
        className="surface-card flex min-h-[22rem] flex-col items-center justify-center gap-3"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="label">Loading diagram</span>
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-ghost)]">
          Cross-org wiring loads on demand
        </span>
      </div>
    ),
  },
);

function ArchitectureDiagramFallback() {
  return (
    <div
      className="surface-card flex min-h-[22rem] flex-col items-center justify-center gap-4 p-6 text-center"
      role="alert"
    >
      <p className="max-w-[40ch] text-[0.95rem] leading-relaxed text-[var(--text-soft)]">
        The architecture diagram did not load. Your connection may have dropped while the page was open.
      </p>
      <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
        Reload page
      </button>
    </div>
  );
}

class ArchitectureDiagramBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <ArchitectureDiagramFallback />;
    return this.props.children;
  }
}

const SECTIONS = [
  { id: "problem", label: "Problem" },
  { id: "how", label: "Flow" },
  { id: "architecture", label: "Architecture" },
  { id: "why-band", label: "Why Band" },
  { id: "payoff", label: "Payoff" },
] as const;

const PRIMARY_CTA = "Watch the live adjudication";
const PAYOFF_CTA_LINES = [
  "Live Band state from intake to recommendation.",
  "You approve or deny. It posts to the audit trail.",
] as const;

export default function Landing() {
  useReveal();
  const { active, scrolled } = useScrollSpy(SECTIONS.map((s) => s.id));
  const [mobileCtaVisible, setMobileCtaVisible] = useState(true);

  // Keep the active mobile section pill visible in the horizontal rail.
  useEffect(() => {
    if (!active) return;
    document
      .querySelector<HTMLElement>(`.section-pill[href="#${active}"]`)
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "auto" });
  }, [active]);

  // Tuck the sticky mobile CTA away once the footer is on screen so it does not cover credits.
  useEffect(() => {
    const footer = document.querySelector<HTMLElement>("main footer");
    if (!footer) return;
    const io = new IntersectionObserver(
      ([entry]) => setMobileCtaVisible(!entry.isIntersecting),
      { rootMargin: "0px 0px -72px 0px", threshold: 0.08 },
    );
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  // In-page anchors that target collapsed panels (e.g. #how-step-4 from the hero band).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href^='#']");
      if (!anchor) return;
      const hash = anchor.getAttribute("href") ?? "";
      if (!isManagedLandingHash(hash)) return;
      e.preventDefault();
      scrollToLandingHash(hash);
      window.history.pushState(null, "", hash);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* heat:0 keeps the ambient field cool cobalt/teal. The warm decision-flare
          belongs to the live console, not the calm landing. */}
      <div className="aura" aria-hidden style={{ ["--heat" as string]: 0 }} />

      {/* ── Nav: full-bleed sticky bar (no boxed border, so it never reads as a
            fixed-width page); inner content stays aligned to the page column ── */}
      <header className="site-header">
        <div className="landing-wrap landing-header-row py-3.5">
          <BrandLockup
            href="/"
            size={32}
            wordmarkClassName="text-[clamp(1.15rem,4vw,1.55rem)]"
            ariaLabel="ClaimArbiter, scroll to top"
            onClick={() => {
              if (window.location.pathname === "/") {
                const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
              }
            }}
          />
          <nav aria-label="Page sections" className="hidden items-center gap-1 md:flex">
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="nav-link"
                aria-current={active === s.id ? "true" : undefined}
              >
                {s.label}
              </a>
            ))}
          </nav>
          <div className="landing-header-actions">
            <LandingMobileMenu sections={SECTIONS} activeSection={active} />
            <Link href="/app" className="btn btn-accent group">
              <span className="btn-label-full">Open console</span>
              <span className="btn-label-short">Console</span>
              <Arrow />
            </Link>
          </div>
        </div>
      </header>

      {/* Desktop sticky mini-TOC, appears once you scroll past the hero */}
      <nav
        aria-label="Section quick navigation"
        className={`mini-toc ${scrolled ? "is-visible" : ""}`}
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            aria-current={active === s.id ? "true" : undefined}
            aria-label={s.label}
          >
            <span className="toc-label">{s.label}</span>
            <span className="toc-dot" aria-hidden />
          </a>
        ))}
      </nav>

      <LandingGridBackdrop>
      <main id="main">
        {/* ── Hero — centered power-on briefing ── */}
        <section id="hero" className="landing-snap-section pb-20 pt-24 md:pb-28 md:pt-36">
          <div className="landing-wrap">
            <div className="relative">
              <div className="hero-wave" aria-hidden>
                {Array.from({ length: 15 }).map((_, n) => (
                  <span key={n} />
                ))}
              </div>
              <div className="relative z-10 mx-auto flex max-w-[72ch] flex-col items-center text-center">
              <h1 className="font-[family-name:var(--font-display)] text-[clamp(2.7rem,7vw,5.2rem)] font-bold leading-[0.95] tracking-[-0.04em] text-[var(--text)]">
                <span className="hero-line" style={{ display: "block", animationDelay: "0.05s" }}>
                  From a filed claim
                </span>
                <span className="hero-line" style={{ display: "block", animationDelay: "0.13s" }}>
                  to a <span className="text-[var(--accent-strong)]">signed verdict</span>
                </span>
                <span
                  className="hero-line mt-5 font-[family-name:var(--font-mono)] text-[clamp(1.1rem,2.4vw,1.65rem)] font-medium uppercase tracking-[0.04em] text-[var(--text-faint)]"
                  style={{ display: "block", animationDelay: "0.21s" }}
                >
                  in minutes, not days
                </span>
              </h1>

              <p className="reveal reveal-3 mx-auto mt-8 max-w-[52ch] text-[clamp(1.05rem,1.5vw,1.18rem)] leading-relaxed text-[var(--text-soft)]">
                AI agents take in each claim, auto-classify its domain, recruit the matching specialist from a partner org, and deliver a clear approve-or-deny verdict for a human reviewer to sign, all coordinated on Band.
              </p>

              <div className="reveal reveal-3 mt-10 flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
                <Link href="/app" className="btn btn-accent group px-5 py-3 text-[13px]">
                  <span className="btn-label-full">Open console</span>
                  <span className="btn-label-short">Console</span>
                  <Arrow />
                </Link>
                <a href="#how" className="btn btn-secondary px-5 py-3 text-[13px]">
                  How it works
                </a>
              </div>

              <a
                href="#architecture"
                className="reveal reveal-3 mt-4 font-[family-name:var(--font-mono)] text-[12px] text-[var(--text-faint)] underline decoration-[var(--line-strong)] decoration-1 underline-offset-4 transition-colors hover:text-[var(--text)]"
              >
                Technical brief: architecture &amp; wiring
              </a>
              </div>
            </div>

            <div className="reveal reveal-4 transmission-band-shell mt-12 md:mt-14">
              <TransmissionBand />
            </div>
          </div>
        </section>

        {/* ── Below the fold: narrative strip (always open) ── */}

        <section id="problem" className="relative z-10 landing-snap-section landing-section-odd">
          <div className="landing-wrap">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-20 xl:gap-28">
            <div className="on-scroll">
              <SectionHead
                index={1}
                eyebrow="The coordination gap"
                title="Insurers don&rsquo;t employ the specialists they depend on."
              />
              <p className="mt-5 max-w-[65ch] leading-relaxed text-[var(--text-soft)]">
                Every claim needs outside expertise. Property assessors, medical reviewers, and legal reviewers work at partner firms, not on payroll. Today that means email chains, phone tag, and days of waiting with no shared record of who said what. ClaimArbiter is built for this gap: intake auto-classifies the claim, agents at the insurer recruit the matching specialist across an org boundary, work together in one Band room, and return a verdict a human can sign in minutes.
              </p>
            </div>
            <div className="flex flex-col justify-center gap-4">
              <BigStat n="3 to 5 days" label="Typical manual investigation cycle" delay={1} />
              <BigStat n="Under 3 minutes" label="ClaimArbiter intake to signed verdict" accent delay={2} />
            </div>
          </div>
          </div>
        </section>

        <section id="how" className="relative z-10 landing-snap-section landing-section-even">
          <div className="landing-wrap">
          <header className="on-scroll">
            <SectionHead
              index={2}
              eyebrow="The flow"
              title="One claim, seven moves, the right specialist recruited."
            />
            <p className="mt-5 max-w-[65ch] text-[0.95rem] leading-relaxed text-[var(--text-soft)]">
              Seven steps from intake to human sign-off. The hero band zooms into 04→05.
            </p>
          </header>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-5">
            {FLOW.map((s, i) => (
              <li
                key={s.title}
                id={`how-step-${s.n}`}
                className="surface-card on-scroll flex flex-col gap-3 p-5 transition-[border-color,box-shadow] duration-300"
                data-delay={((i % 3) + 1) as 1 | 2 | 3}
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--inset)] font-[family-name:var(--font-mono)] text-sm font-bold tabular text-[var(--accent-strong)]">
                    {String(s.n).padStart(2, "0")}
                  </span>
                  <span
                    className="font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: s.cross ? "var(--accent-strong)" : "var(--text-ghost)" }}
                  >
                    {s.org}
                  </span>
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--text)]">
                  {s.title}
                </h3>
                <p className="text-[0.9rem] leading-snug text-[var(--text-soft)]">{s.body}</p>
              </li>
            ))}
          </ol>
          </div>
        </section>

        <section id="architecture" className="landing-snap-section landing-section-odd relative z-10">
          <div className="landing-wrap">
            <header className="on-scroll">
              <SectionHead
                index={3}
                eyebrow="Architecture"
                title="Genuinely cross-framework, genuinely cross-org."
              />
              <p className="mt-5 max-w-[65ch] text-[0.95rem] leading-relaxed text-[var(--text-soft)]">
                Four orgs, three frameworks, two model providers, one Band room. Each org runs its own stack; coordination, consent, and audit live only in Band.
              </p>
            </header>
            <div className="mt-8">
              <ArchitectureDiagramBoundary>
                <ArchitectureDiagram />
              </ArchitectureDiagramBoundary>
            </div>
          </div>
        </section>

        <section id="why-band" className="landing-snap-section landing-section-even relative z-10">
          <div className="landing-wrap">
            <header className="on-scroll">
              <SectionHead
                index={4}
                eyebrow="Why Band"
                title="Band is the only thing all four orgs share."
              />
              <p className="mt-5 max-w-[65ch] text-[0.95rem] leading-relaxed text-[var(--text-soft)]">
                Five capabilities this demo would have to fake without Band underneath.
              </p>
            </header>
            <div className="on-scroll mt-6">
              <Link
                href="https://band.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex items-center gap-2 font-[family-name:var(--font-mono)] text-[12px] uppercase tracking-[0.12em] text-[var(--accent-strong)] underline decoration-[var(--accent-muted)] decoration-1 underline-offset-4 transition-colors hover:text-[var(--text)]"
              >
                Band platform
                <Arrow />
              </Link>
            </div>
            <ol className="capability-grid mt-8">
              {CAPABILITIES.map((c, i) => (
                <CapabilityCell key={c.claim} {...c} index={i} />
              ))}
            </ol>
          </div>
        </section>

        <section id="payoff" className="relative z-10 landing-snap-section landing-section-odd">
          <div className="landing-wrap">
          <header className="on-scroll max-w-[72ch] xl:max-w-[80ch]">
            <SectionHead
              index={5}
              eyebrow="The payoff"
              title="A signed verdict, with the full trail behind it."
            />
            <p className="mt-5 max-w-[65ch] leading-relaxed text-[var(--text-soft)]">
              Agents coordinate across org boundaries; a Human Reviewer signs the decision back to Band, auditable from intake.
            </p>
          </header>

          <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1.08fr)_1fr] lg:gap-14 xl:items-center">
            <ClosureRecord />
            <div className="on-scroll flex flex-col gap-8" data-delay={2}>
              <div>
                <p className="label">Your turn</p>
                <ol className="landing-closure-steps mt-4">
                  {CLOSURE_STEPS.map((step, i) => (
                    <ClosureStep key={step.title} {...step} index={i} />
                  ))}
                </ol>
              </div>
              <PayoffCta className="hidden lg:flex lg:w-full" align="center" />
            </div>
          </div>

          <PayoffCta className="on-scroll mx-auto mt-10 lg:hidden" align="center" dataDelay={2} />
          </div>
        </section>

        <footer className="relative z-10 landing-wrap pb-[calc(7rem+env(safe-area-inset-bottom,0px))] md:pb-10">
          <div className="flex flex-col gap-4 border-t border-[var(--line)] pt-8 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wide text-[var(--text-ghost)]">
              <Mark small /> ClaimArbiter · Band of Agents Hackathon
            </span>
            <span className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-[var(--text-faint)]">
              <span className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
                Built with
              </span>
              <FooterLink href="https://band.ai">Band</FooterLink>
              <FooterLink href="https://aimlapi.com">AI/ML API</FooterLink>
              <FooterLink href="https://featherless.ai">Featherless</FooterLink>
            </span>
          </div>
        </footer>
      </main>
      </LandingGridBackdrop>

      {/* Mobile-only sticky primary action */}
      <div
        className={`landing-mobile-cta fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[color-mix(in_oklab,var(--canvas)_88%,transparent)] px-4 py-3 backdrop-blur-md md:hidden ${mobileCtaVisible ? "" : "is-dismissed"}`}
      >
        <Link href="/app" className="btn btn-accent group w-full justify-center py-3 text-[13px]">
          {PRIMARY_CTA}
          <Arrow />
        </Link>
      </div>
    </div>
  );
}

const CLOSURE_STEPS = [
  {
    title: "Pick a claim",
    body: "Property, medical, or legal: intake auto-classifies the narrative and routes to the right specialist.",
  },
  {
    title: "Watch it adjudicate",
    body: "Live agents weigh the evidence, recruit the matching specialist across the boundary, and relay an approve-or-deny verdict.",
  },
  {
    title: "Sign the verdict",
    body: "Approve or deny with your note. The decision posts to the same Band room the agents used.",
  },
] as const;

function PayoffCta({
  className = "",
  dataDelay,
  align = "start",
}: {
  className?: string;
  dataDelay?: 1 | 2 | 3;
  align?: "start" | "center";
}) {
  const centered = align === "center";
  return (
    <div
      className={`landing-payoff-cta flex flex-col ${centered ? "items-center" : "items-start"} ${className}`.trim()}
      {...(dataDelay ? { "data-delay": dataDelay } : {})}
    >
      <Link href="/app" className="btn btn-accent group px-5 py-3 text-[13px]">
        {PRIMARY_CTA}
        <Arrow />
      </Link>
      <p
        className={`landing-payoff-cta-copy mt-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--text-ghost)] ${centered ? "text-center" : ""}`}
      >
        <span className="block">{PAYOFF_CTA_LINES[0]}</span>
        <span className="block">{PAYOFF_CTA_LINES[1]}</span>
      </p>
    </div>
  );
}

function ClosureRecord() {
  return (
    <div className="landing-closure-card on-scroll surface-card p-6 md:p-7" data-delay={1}>
      <header className="signed-record-head">
        <span className="signed-record-claim">Claim #4471-A9F3</span>
        <span className="signed-record-closed">
          <CheckIcon />
          Closed
        </span>
      </header>

      <div className="signed-outcome is-stacked mt-5">
        <p className="signed-outcome-mark" style={{ color: "var(--success)" }}>
          <span className="signed-outcome-mark-dot" style={{ background: "var(--success)" }} aria-hidden />
          Final decision
        </p>
        <p className="signed-outcome-word text-[clamp(2.25rem,5vw,3.25rem)]" style={{ color: "var(--success)" }}>
          Approved
        </p>
        <p className="signed-outcome-by">
          Signed by the Human Reviewer · posted to the Band audit trail
        </p>
      </div>

      <blockquote className="signed-note mt-5">
        <span className="signed-note-label">Reviewer note</span>
        Coverage confirmed and the property assessor&rsquo;s rationale holds. Straightforward approve.
      </blockquote>

      <div className="signed-evidence mt-5">
        <span className="signed-evidence-label">What the decision rests on</span>
        <dl className="outcome-list">
          <ClosureEvidenceRow label="Coverage" value="Valid" tone="var(--success)" />
          <ClosureEvidenceRow label="Specialist" value="Property Group · matched" tone="var(--text-soft)" />
          <ClosureEvidenceRow label="Specialist verdict" value="Approve" tone="var(--success)" />
        </dl>
      </div>

      <div className="landing-closure-trail mt-5 border-t border-[var(--line-faint)] pt-5">
        <p className="label">Audit trail excerpt</p>
        <ol className="mt-3 space-y-2.5">
          {CLOSURE_TRAIL.map((entry) => (
            <li
              key={entry.actor}
              className="flex gap-3 font-[family-name:var(--font-mono)] text-[11px] leading-snug"
            >
              <span className="shrink-0 tabular text-[var(--text-ghost)]">{entry.t}</span>
              <span className="text-[var(--accent-strong)]">{entry.actor}</span>
              <span className="min-w-0 text-[var(--text-faint)]">{entry.event}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

const CLOSURE_TRAIL = [
  { t: "00:12", actor: "Intake & Coverage", event: "Structured claim extracted · classified property · policy in force" },
  { t: "00:48", actor: "Property Group", event: "Specialist verdict: APPROVE · rationale relayed to coordinator" },
  { t: "01:22", actor: "Human Reviewer", event: "Decision: APPROVE signed and posted back to the Band room" },
] as const;

function ClosureEvidenceRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="outcome-row">
      <span className="outcome-label">
        <span className="outcome-dot" style={{ background: tone }} aria-hidden />
        {label}
      </span>
      <span className="outcome-value" style={{ color: tone }}>
        {value}
      </span>
    </div>
  );
}

function ClosureStep({
  title,
  body,
  index,
}: {
  title: string;
  body: string;
  index: number;
}) {
  return (
    <li className="landing-closure-step">
      <span className="landing-closure-step-num" aria-hidden>
        {String(index + 1).padStart(2, "0")}
      </span>
      <div>
        <p className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold tracking-[-0.01em] text-[var(--text)]">
          {title}
        </p>
        <p className="mt-1 text-[0.9rem] leading-relaxed text-[var(--text-soft)]">{body}</p>
      </div>
    </li>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type ChipTone = "accent" | "a" | "b" | "neutral";

const CAPABILITIES: {
  claim: string;
  proof: string;
  chips: { label: string; tone: ChipTone }[];
  span: 4 | 5 | 7;
  featured?: boolean;
}[] = [
  {
    claim: "Framework-agnostic",
    proof: "Pydantic AI, LangGraph, and CrewAI share one room via Band adapters.",
    chips: [
      { label: "Pydantic AI", tone: "neutral" },
      { label: "LangGraph", tone: "neutral" },
      { label: "CrewAI", tone: "neutral" },
    ],
    span: 4,
  },
  {
    claim: "Provider- and API-agnostic",
    proof: "Frontier models at the insurer; open-weight models at recruited specialists.",
    chips: [
      { label: "AI/ML API · gpt-4o", tone: "a" },
      { label: "Featherless · Llama-3.1-8B", tone: "b" },
    ],
    span: 4,
  },
  {
    claim: "Discovery-driven cross-org recruiting",
    proof: "Case Coordinator classifies the claim, looks up the matching peer, recruits across a consent boundary.",
    chips: [
      { label: "lookup_peers", tone: "accent" },
      { label: "Bilateral consent", tone: "accent" },
    ],
    span: 4,
    featured: true,
  },
  {
    claim: "One shared system of record",
    proof: "Memory, task state, and audit trail live in Band, not inside any one agent.",
    chips: [
      { label: "Memory", tone: "accent" },
      { label: "Task state", tone: "accent" },
      { label: "Audit trail", tone: "accent" },
    ],
    span: 7,
  },
  {
    claim: "Humans are first-class participants",
    proof: "Human Reviewer signs the verdict back into the same room and audit trail.",
    chips: [{ label: "Human-in-the-loop", tone: "accent" }],
    span: 5,
  },
];

function CapabilityCell({
  claim,
  proof,
  chips,
  index,
  span,
  featured,
}: {
  claim: string;
  proof: string;
  chips: { label: string; tone: ChipTone }[];
  index: number;
  span: 4 | 5 | 7;
  featured?: boolean;
}) {
  const spanClass = span === 7 ? "span-7" : span === 5 ? "span-5" : "span-4";
  return (
    <li
      className={`capability-cell on-scroll ${featured ? "is-featured" : ""} ${spanClass}`}
      data-delay={((index % 3) + 1) as 1 | 2 | 3}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-[family-name:var(--font-mono)] text-[12px] font-bold tabular text-[var(--accent-strong)]">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="font-[family-name:var(--font-display)] text-[1.2rem] font-bold leading-tight tracking-[-0.015em] text-[var(--text)] xl:text-[1.35rem]">
          {claim}
        </h3>
      </div>
      <p className="text-[0.9rem] leading-snug text-[var(--text-soft)]">{proof}</p>
      {chips.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {chips.map((chip) => (
            <Chip key={chip.label} {...chip} />
          ))}
        </div>
      )}
    </li>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[var(--text-soft)] underline decoration-[var(--line-strong)] decoration-1 underline-offset-2 transition-colors hover:text-[var(--text)]"
    >
      {children}
    </a>
  );
}

function Chip({ label, tone }: { label: string; tone: ChipTone }) {
  const color =
    tone === "a"
      ? "var(--org-a)"
      : tone === "b"
        ? "var(--org-b)"
        : tone === "accent"
          ? "var(--accent-strong)"
          : "var(--text-soft)";
  return (
    <span
      className="inline-flex items-center rounded-full border bg-[var(--inset)] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[11px]"
      style={{
        color,
        borderColor:
          tone === "neutral"
            ? "var(--line)"
            : `color-mix(in oklch, ${color} 40%, var(--line))`,
      }}
    >
      {label}
    </span>
  );
}

function SectionHead({
  index,
  eyebrow,
  title,
}: {
  index: number;
  eyebrow: string;
  title: ReactNode;
}) {
  return (
    <>
      <p className="landing-section-eyebrow">
        <span className="landing-section-num">{String(index).padStart(2, "0")}</span>
        <span className="landing-section-label">{eyebrow}</span>
      </p>
      <h2 className="landing-section-title">{title}</h2>
    </>
  );
}

function BigStat({ n, label, accent, delay }: { n: string; label: string; accent?: boolean; delay?: 1 | 2 | 3 }) {
  return (
    <div className={`surface-card on-scroll p-6 ${accent ? "is-accent" : ""}`} data-delay={delay}>
      <p
        className="font-[family-name:var(--font-display)] text-[clamp(1.6rem,3vw,2.2rem)] font-bold leading-none tracking-[-0.02em] tabular"
        style={{ color: accent ? "var(--accent-strong)" : "var(--text)" }}
      >
        {n}
      </p>
      <p className="mt-3 max-w-[40ch] text-sm leading-snug text-[var(--text-soft)]">{label}</p>
    </div>
  );
}

function Mark({ small }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center justify-center" aria-hidden>
      <Brandmark size={small ? 22 : 30} />
    </span>
  );
}

function Arrow() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden className="transition-transform duration-300 group-hover:translate-x-1">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
