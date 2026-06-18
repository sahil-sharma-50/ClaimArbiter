"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { useInView } from "@/landing-page/lib/useInView";
import { landingScrollBehavior, revealOnScrollIn } from "@/landing-page/lib/landingHash";

const HS_STEPS = [
  { key: "request", label: "Request", hint: "Insurance Provider asks" },
  { key: "consent", label: "Consent", hint: "Crossing boundary" },
  { key: "approved", label: "Approved", hint: "Specialist's org agrees" },
  { key: "joined", label: "Joined", hint: "Agent in room" },
] as const;

type HsStep = (typeof HS_STEPS)[number]["key"];

type DiagramNode = {
  id: string;
  label: string;
  sub: string;
  howStep: number;
  org: "a" | "b" | "band";
};

/* Case Coordinator is split into its two real responsibilities: it classifies the
   claim and routes the matching specialist (master step 03) and, after the verdict
   returns, relays the recommendation (master step 06). The Evidence Analyst runs
   ahead of it, reading photos and documents (master step 02). The right side is the
   specialist network the Case Coordinator discovers through Band — property is the
   worked example that animates; medical and legal are the other domains it routes to. */
const NODES: DiagramNode[] = [
  { id: "intake", label: "Intake + Coverage", sub: "Pydantic AI", howStep: 1, org: "a" },
  { id: "evidence", label: "Evidence Analyst", sub: "Pydantic AI · vision", howStep: 2, org: "a" },
  { id: "adjudicator", label: "Case Coordinator · classify & route", sub: "LangGraph", howStep: 3, org: "a" },
  { id: "recommend", label: "Case Coordinator · relay verdict", sub: "LangGraph", howStep: 6, org: "a" },
  { id: "human", label: "Human Reviewer", sub: "In the loop", howStep: 7, org: "a" },
  { id: "consent", label: "Contact consent", sub: "CALLBACK approve", howStep: 4, org: "band" },
  { id: "property", label: "Property · Property Group", sub: "CrewAI · matched", howStep: 5, org: "b" },
  { id: "medical", label: "Medical · Medical Group", sub: "CrewAI · available", howStep: 5, org: "b" },
  { id: "legal", label: "Legal · Legal Group", sub: "CrewAI · available", howStep: 5, org: "b" },
];

let liveRegion: HTMLElement | null = null;
function announce(message: string) {
  if (typeof document === "undefined") return;
  if (!liveRegion) {
    liveRegion = document.createElement("div");
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("role", "status");
    liveRegion.className = "sr-only";
    document.body.appendChild(liveRegion);
  }
  // Clear then set so repeated identical messages are still announced.
  liveRegion.textContent = "";
  window.setTimeout(() => {
    if (liveRegion) liveRegion.textContent = message;
  }, 60);
}

export function highlightHowStep(step: number, title?: string) {
  const el = document.getElementById(`how-step-${step}`);
  if (!el) return;
  el.scrollIntoView({ behavior: landingScrollBehavior(), block: "center" });
  el.classList.add("how-step-highlight");
  window.setTimeout(() => el.classList.remove("how-step-highlight"), 2000);
  const section = el.closest("section");
  if (section) revealOnScrollIn(section);
  announce(`Jumped to flow step ${String(step).padStart(2, "0")}${title ? `, ${title}` : ""}.`);
}

function subscribeReduceMotion(onStoreChange: () => void) {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}

function getReduceMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ArchitectureDiagram() {
  const [hsStep, setHsStep] = useState(0);
  const reduceMotion = useSyncExternalStore(subscribeReduceMotion, getReduceMotion, () => false);
  const effectiveHsStep = reduceMotion ? HS_STEPS.length - 1 : hsStep;
  const { ref, inView } = useInView<HTMLElement>();
  const headingId = useId();
  const summaryId = useId();
  const gridRef = useRef<HTMLDivElement>(null);

  // Loop whenever on-screen and motion is allowed. This is an AMBIENT diagram,
  // not an interactive control: it must keep stepping while the user rests the
  // cursor on it to read it. Pausing on hover/focus froze it exactly when the
  // user was looking, which read as "broken". Clicking a node still works (it
  // jumps to that flow step) without halting the loop.
  useEffect(() => {
    if (reduceMotion || !inView) return;
    const advance = () => setHsStep((s) => (s + 1) % HS_STEPS.length);
    // Step in quickly on entry so the handshake reads as live right away.
    const kick = window.setTimeout(advance, 250);
    const id = window.setInterval(advance, 1500);
    return () => {
      window.clearTimeout(kick);
      window.clearInterval(id);
    };
  }, [reduceMotion, inView]);

  const activeKey = HS_STEPS[effectiveHsStep].key;

  const onNodeClick = useCallback((howStep: number, title?: string) => {
    highlightHowStep(howStep, title);
  }, []);

  // Roving keyboard nav: arrow keys move focus between agent nodes.
  const onGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    const grid = gridRef.current;
    if (!grid) return;
    const nodes = Array.from(grid.querySelectorAll<HTMLButtonElement>("[data-arch-node]"));
    const idx = nodes.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;
    e.preventDefault();
    let next = idx;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = (idx + 1) % nodes.length;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = (idx - 1 + nodes.length) % nodes.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = nodes.length - 1;
    nodes[next]?.focus();
  }, []);

  const meridianNodes = NODES.filter((n) => n.org === "a");
  const bandNodes = NODES.filter((n) => n.org === "band");
  const sentinelNodes = NODES.filter((n) => n.org === "b");

  const boundaryLit = activeKey === "consent" || activeKey === "approved" || activeKey === "joined";
  const joined = activeKey === "joined" || reduceMotion;

  return (
    <section
      ref={ref}
      role="region"
      aria-labelledby={headingId}
      aria-describedby={summaryId}
      className="surface-card p-5 md:p-7"
    >
      <h3 id={headingId} className="sr-only">
        Cross-organization architecture
      </h3>
      <p id={summaryId} className="sr-only">
        Insurance Provider and a network of specialist orgs coordinate entirely through Band.
        Insurance Provider&rsquo;s intake, Case Coordinator, and Human Reviewer run on AI/ML API. Intake
        auto-classifies each claim and the Case Coordinator discovers the matching specialist through
        Band&rsquo;s directory &mdash; a property assessor at Property Group, a medical reviewer at Medical Group,
        or a legal reviewer at Legal Group, all running on open-weight models via Featherless. A bilateral
        consent step on Band gates contact across the trust boundary before the matched specialist joins the
        shared room and returns an approve-or-deny verdict. Use the arrow keys
        to move between agents; activate one to jump to its step in the flow.
      </p>

      <div
        ref={gridRef}
        onKeyDown={onGridKeyDown}
        className="grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-stretch md:gap-2 lg:gap-3"
      >
        <OrgColumn
          title="Insurance Provider"
          sub="Insurer · AI/ML API"
          tone="var(--org-a)"
          provider="gpt-4o"
          nodes={meridianNodes}
          onNodeClick={onNodeClick}
          activeKey={activeKey}
        />

        <Connector dir="forward" label="consent request" lit={boundaryLit} animate={inView && !reduceMotion} />

        <BandColumn activeKey={activeKey} nodes={bandNodes} onNodeClick={onNodeClick} />

        <Connector dir="back" label="verdict returns" lit={joined} animate={inView && !reduceMotion} tone="var(--org-b)" />

        <OrgColumn
          title="Specialist network"
          sub="Discovered via Band · Featherless"
          tone="var(--org-b)"
          provider="open-weight"
          nodes={sentinelNodes}
          onNodeClick={onNodeClick}
          activeKey={activeKey}
          joined={joined}
        />
      </div>

      {/* Trust-boundary control — a real, full-width labelled button on its own row */}
      <button
        type="button"
        onClick={() => onNodeClick(4, "Bring in the specialist")}
        className="press mt-3 flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border bg-[var(--inset)] px-4 py-2.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] transition-colors hover:text-[var(--text)]"
        style={{
          borderColor: boundaryLit ? "var(--accent-muted)" : "var(--line)",
          color: boundaryLit ? "var(--accent-strong)" : "var(--text-faint)",
        }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: boundaryLit ? "var(--accent-strong)" : "var(--line-strong)" }}
          aria-hidden
        />
        Trust boundary · bring in the specialist (step 04)
      </button>

      {/* Handshake step indicator — the inside of master step 04, bringing in the specialist */}
      <div className="mt-6 border-t border-[var(--line)] pt-5">
        <p className="mb-3 text-center font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
          Step 04 · inside the specialist handoff
        </p>
        <ol className="flex flex-wrap items-center justify-center gap-2">
          {HS_STEPS.map((s, i) => (
            <li
              key={s.key}
              className="flex items-center gap-2 rounded-full border px-3 py-1.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.1em] transition-colors duration-500"
              style={{
                borderColor: i === effectiveHsStep ? "var(--accent-muted)" : "var(--line)",
                background: i === effectiveHsStep ? "var(--accent-subtle)" : "transparent",
                color: i === effectiveHsStep ? "var(--accent-strong)" : "var(--text-ghost)",
              }}
            >
              {s.label}
            </li>
          ))}
        </ol>
      </div>

      <p className="mt-4 text-center font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
        Click any agent to jump to that step in the flow
      </p>
    </section>
  );
}

/* A connector cell between two columns. Horizontal on desktop (arrow points
   forward or back along the wire), rotated vertical when the grid stacks on
   mobile. Pure SVG, no coordinate math; the flex cell handles placement. */
function Connector({
  dir,
  label,
  lit,
  animate,
  tone = "var(--accent-strong)",
}: {
  dir: "forward" | "back";
  label: string;
  lit: boolean;
  animate: boolean;
  tone?: string;
}) {
  const color = lit ? tone : "var(--line-strong)";
  return (
    <div
      className="flex items-center justify-center py-2 md:w-10 md:py-0"
      aria-hidden
      title={label}
    >
      <svg
        viewBox="0 0 40 12"
        className="h-3 w-16 rotate-90 md:w-10 md:rotate-0"
        style={{ transform: dir === "back" ? "scaleX(-1)" : undefined }}
        preserveAspectRatio="none"
      >
        <line
          x1="1"
          y1="6"
          x2="33"
          y2="6"
          stroke={color}
          strokeWidth="1.5"
          className={animate && lit ? "flow-dash" : undefined}
        />
        <path
          d="M31 2 L37 6 L31 10"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function OrgColumn({
  title,
  sub,
  tone,
  provider,
  nodes,
  onNodeClick,
  activeKey,
  joined,
}: {
  title: string;
  sub: string;
  tone: string;
  provider: string;
  nodes: DiagramNode[];
  onNodeClick: (step: number, title?: string) => void;
  activeKey: HsStep;
  joined?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span
          className="font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: tone }}
        >
          {sub}
        </span>
        <h4 className="mt-1 font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--text)]">
          {title}
        </h4>
        <span className="mt-1 inline-block rounded-full border border-[var(--line)] bg-[var(--inset)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-faint)]">
          {provider}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {nodes.map((n) => (
          <DiagramNodeButton
            key={n.id}
            node={n}
            tone={tone}
            onClick={() => onNodeClick(n.howStep, n.label)}
            pulse={
              (n.id === "adjudicator" && (activeKey === "request" || activeKey === "consent")) ||
              (n.id === "property" && (activeKey === "approved" || activeKey === "joined")) ||
              (n.id === "property" && joined)
            }
            // Medical/legal are available-but-not-matched in this worked example.
            dim={n.id === "medical" || n.id === "legal"}
          />
        ))}
      </div>
    </div>
  );
}

function BandColumn({
  activeKey,
  nodes,
  onNodeClick,
}: {
  activeKey: HsStep;
  nodes: DiagramNode[];
  onNodeClick: (step: number, title?: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:min-w-[9rem]">
      <div className="text-center lg:text-left">
        <span className="font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
          Band platform
        </span>
        <h4 className="mt-1 font-[family-name:var(--font-display)] text-lg font-bold tracking-[-0.01em] text-[var(--text)]">
          Shared room
        </h4>
      </div>
      <div
        className="flex flex-1 flex-col gap-2 rounded-[var(--radius-md)] border p-3 transition-colors duration-500"
        style={{
          borderColor: activeKey === "joined" ? "var(--accent-muted)" : "var(--line)",
          background: "color-mix(in oklab, var(--surface) 60%, transparent)",
        }}
      >
        {["Case-file memory", "Task state", "Audit trail"].map((item) => (
          <span
            key={item}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--inset)] px-2.5 py-1.5 text-center font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-faint)] lg:text-left"
          >
            {item}
          </span>
        ))}
        {nodes.map((n) => (
          <DiagramNodeButton
            key={n.id}
            node={n}
            tone="var(--accent-strong)"
            onClick={() => onNodeClick(n.howStep, n.label)}
            pulse={activeKey === "consent" || activeKey === "approved"}
          />
        ))}
      </div>
    </div>
  );
}

function DiagramNodeButton({
  node,
  tone,
  onClick,
  pulse,
  dim,
}: {
  node: DiagramNode;
  tone: string;
  onClick: () => void;
  pulse?: boolean;
  dim?: boolean;
}) {
  return (
    <button
      type="button"
      data-arch-node
      onClick={onClick}
      className="press group flex min-h-11 w-full flex-col justify-center rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--inset)] px-3 py-2.5 text-left hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
      style={
        pulse
          ? {
              // Pulse via border + a single soft ring; no heavy multi-node
              // box-shadow churn (keeps it cheap when several could light up).
              borderColor: "var(--accent-muted)",
              boxShadow: "0 0 0 1px var(--accent-muted)",
            }
          : dim
            ? { opacity: 0.5 }
            : undefined
      }
      aria-label={`${node.label}, ${node.sub}. Jump to flow step ${String(node.howStep).padStart(2, "0")}.`}
    >
      <span className="block font-[family-name:var(--font-display)] text-[13px] font-semibold leading-tight text-[var(--text)]">
        {node.label}
      </span>
      <span className="mt-0.5 block font-[family-name:var(--font-mono)] text-[11px]" style={{ color: tone }}>
        {node.sub}
      </span>
    </button>
  );
}
