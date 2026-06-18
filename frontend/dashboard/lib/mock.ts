import type {
  ArbiterState,
  AuditEntry,
  CasefileEntry,
  HandshakeEvent,
  Participant,
} from "@/dashboard/lib/api";
import { PHASES_WITH_IDLE, type PhaseWithIdle } from "@/dashboard/lib/phases";

/*
  Dev-only mock harness. Drives the console through every phase deterministically
  WITHOUT the gateway, so all seven scenes (plus the long-investigating ambient
  state and an error/stall state) can be rendered and screenshotted.

  Usage: /app/live?chat_id=demo&mock=recruiting  (any MockPhase below, or "error")
         The console route needs a chat_id to mount; mock then overrides the
         live gateway data. Without chat_id the page shows the claim picker.
*/

// A mock phase is any console state, including "idle" — the canonical PhaseWithIdle.
export type MockPhase = PhaseWithIdle;

// The demo paths (mirrors ClaimPreset["id"] in api.ts). The phase scaffolding
// (audit/casefile/handshake) is shared; only the recruited specialist and the
// discovery/evidence framing differ. "no_domain" classifies to no domain — the
// Case Coordinator decides itself and recruits nobody.
export type MockPreset = "property" | "medical" | "legal" | "no_domain";

const CHAT_ID = "demo-4471-a9f3c2e1";
const BAND_URL = "https://band.dev/rooms/demo-4471-a9f3c2e1";

const MERIDIAN = "Insurance Provider";
const PROPERTY_ORG = "Property Group";
const MEDICAL_ORG = "Medical Group";
const LEGAL_ORG = "Legal Group";

const P_INTAKE: Participant = {
  name: "Intake & Coverage",
  org: MERIDIAN,
  framework: "Pydantic AI",
  model: "AI/ML API",
  mentioned: false,
};
const P_EVIDENCE: Participant = {
  name: "Evidence Analyst",
  org: MERIDIAN,
  framework: "Pydantic AI",
  model: "Featherless · vision",
  mentioned: false,
};
const P_ADJ: Participant = {
  name: "Case Coordinator",
  org: MERIDIAN,
  framework: "LangGraph",
  model: "AI/ML API",
  mentioned: false,
};
const P_HUMAN: Participant = {
  name: "Human Reviewer",
  org: MERIDIAN,
  framework: "Human",
  model: "-",
  mentioned: false,
  type: "human",
};
const P_LEGAL: Participant = {
  name: "Legal Review",
  org: LEGAL_ORG,
  framework: "CrewAI",
  model: "Featherless",
  mentioned: false,
};

/*
  Per-preset domain bits. The phase scaffolding (audit/casefile/handshake skeleton)
  is shared; this table holds only what changes between paths: the specialist that
  gets recruited, the discovery framing, and the directory candidates SeamScene shows.
  "no_domain" has spec: null — the claim classifies to no domain, so the Case
  Coordinator decides itself and no specialist crosses the boundary.
*/
type PresetSpec = NonNullable<ArbiterState["specialist"]>;
type PresetCandidate = NonNullable<NonNullable<ArbiterState["discovery"]>["candidates"]>[number];

type PresetDescriptor = {
  // The recruited specialist (null on the clean path — nobody is recruited).
  spec: Omit<PresetSpec, "risk"> | null;
  // The cross-org participant for the recruited specialist (null on the clean path).
  participant: Participant | null;
  capability_tag: string;
  recruited_handle: string | null;
  recruited_name: string | null;
  partner_org: string;
  // Directory peers the Case Coordinator weighed (SeamScene preview).
  candidates: PresetCandidate[];
  // Domain-specific finding copy.
  evidence_summary: string;
  evidence_signals: string[];
  recruiting_summary: string;
  recruiting_score: number;
  verdict_summary: string;
  verdict_label: string;
  verdict_confidence: number;
  verdict_risk: string;
  // The specialist's own approve/deny call and written rationale, relayed verbatim.
  verdict_recommendation: "approve" | "deny" | null;
  verdict_explanation: string;
};

const PROPERTY_CANDIDATES: PresetCandidate[] = [
  { name: "Property Assessment", handle: "@property-group/property-agent", tags: ["property-damage", "water"] },
  { name: "Medical Review", handle: "@medical-group/medical-agent", tags: ["medical-review"] },
  { name: "Legal Review", handle: "@legal-group/legal-agent", tags: ["legal-review"] },
];
const MEDICAL_CANDIDATES: PresetCandidate[] = [
  { name: "Medical Review", handle: "@medical-group/medical-agent", tags: ["medical-review", "injury"] },
  { name: "Property Assessment", handle: "@property-group/property-agent", tags: ["property-damage"] },
  { name: "Legal Review", handle: "@legal-group/legal-agent", tags: ["legal-review"] },
];
const LEGAL_CANDIDATES: PresetCandidate[] = [
  { name: "Legal Review", handle: "@legal-group/legal-agent", tags: ["legal-review", "litigation"] },
  { name: "Property Assessment", handle: "@property-group/property-agent", tags: ["property-damage"] },
  { name: "Medical Review", handle: "@medical-group/medical-agent", tags: ["medical-review"] },
];

const PRESETS: Record<MockPreset, PresetDescriptor> = {
  property: {
    spec: {
      type: "property",
      name: "Property Assessment",
      org: PROPERTY_ORG,
      framework: "CrewAI",
      provider: "Featherless",
      tag: "property-damage",
      verdict_label: "damage assessed",
    },
    participant: {
      name: "Property Assessment",
      org: PROPERTY_ORG,
      framework: "CrewAI",
      model: "Featherless",
      mentioned: false,
    },
    capability_tag: "property-damage",
    recruited_handle: "@property-group/property-agent",
    recruited_name: "Property Assessment",
    partner_org: PROPERTY_ORG,
    candidates: PROPERTY_CANDIDATES,
    evidence_summary:
      "Vision read: water staining on drywall and warped flooring, but the moisture line pre-dates the reported burst. Derived signals: ambiguous_source, pre_existing_moisture.",
    evidence_signals: ["ambiguous_source", "pre_existing_moisture"],
    recruiting_summary:
      "Intake classified the claim as PROPERTY. Recruiting the Property Group assessor to decide approve/deny.",
    recruiting_score: 0.82,
    verdict_summary:
      "Property Group verdict: DENY. The staining pattern shows gradual seepage that pre-dates the reported pipe burst — a maintenance/wear issue, not a sudden & accidental loss. Pre-existing moisture is excluded under the policy.",
    verdict_label: "gradual seepage",
    verdict_confidence: 0.79,
    verdict_risk: "medium",
    verdict_recommendation: "deny",
    verdict_explanation:
      "The damage is consistent with long-term seepage that pre-dates the reported burst pipe. Gradual water intrusion and pre-existing moisture are maintenance issues excluded from cover; only sudden & accidental discharge would qualify. Denied.",
  },
  medical: {
    spec: {
      type: "medical",
      name: "Medical Review",
      org: MEDICAL_ORG,
      framework: "CrewAI",
      provider: "Featherless",
      tag: "medical-review",
      verdict_label: "necessity reviewed",
    },
    participant: {
      name: "Medical Review",
      org: MEDICAL_ORG,
      framework: "CrewAI",
      model: "Featherless",
      mentioned: false,
    },
    capability_tag: "medical-review",
    recruited_handle: "@medical-group/medical-agent",
    recruited_name: "Medical Review",
    partner_org: MEDICAL_ORG,
    candidates: MEDICAL_CANDIDATES,
    evidence_summary:
      "Document read: the billed lumbar MRI and twelve-week PT course are consistent with the documented disc injury and billed at standard rates. No mismatch signals derived.",
    evidence_signals: [],
    recruiting_summary:
      "Intake classified the claim as MEDICAL. Recruiting the Medical Group reviewer to decide approve/deny.",
    recruiting_score: 0.74,
    verdict_summary:
      "Medical Group verdict: APPROVE. Imaging and physical-therapy frequency are medically necessary for the documented lumbar disc injury and billed at standard rates. Treatment is consistent with the reported mechanism of injury.",
    verdict_label: "medically necessary",
    verdict_confidence: 0.86,
    verdict_risk: "low",
    verdict_recommendation: "approve",
    verdict_explanation:
      "The MRI, twelve-week PT course, and lumbar brace are medically necessary and consistent with the reported slip-and-fall disc injury, billed at standard rates with no duplicate or cosmetic procedures. Approved.",
  },
  legal: {
    spec: {
      type: "legal",
      name: "Legal Review",
      org: LEGAL_ORG,
      framework: "CrewAI",
      provider: "Featherless",
      tag: "legal-review",
      verdict_label: "coverage reviewed",
    },
    participant: P_LEGAL,
    capability_tag: "legal-review",
    recruited_handle: "@legal-group/legal-agent",
    recruited_name: "Legal Review",
    partner_org: LEGAL_ORG,
    candidates: LEGAL_CANDIDATES,
    evidence_summary:
      "Document read: attorney invoice and engagement letter describe a commercial contract dispute with a supplier. Derived signals: business_dispute, excluded_matter.",
    evidence_signals: ["business_dispute", "excluded_matter"],
    recruiting_summary:
      "Intake classified the claim as LEGAL. Recruiting the Legal Group reviewer to decide approve/deny.",
    recruiting_score: 0.8,
    verdict_summary:
      "Legal Group verdict: DENY. The attorney fees are for a business/contract dispute with a supplier — a matter excluded from the legal-expenses policy, which covers liability defense and covered disputes only.",
    verdict_label: "excluded matter",
    verdict_confidence: 0.84,
    verdict_risk: "medium",
    verdict_recommendation: "deny",
    verdict_explanation:
      "The legal costs arise from a commercial contract dispute with a supplier, which falls outside the policy's covered proceedings (liability defense and covered disputes). Business and contract disputes are excluded matters. Denied.",
  },
  no_domain: {
    spec: null,
    participant: null,
    capability_tag: "",
    recruited_handle: null,
    recruited_name: null,
    partner_org: "",
    candidates: [
      ...PROPERTY_CANDIDATES,
    ],
    evidence_summary:
      "Document read: the narrative describes a lost-luggage reimbursement request that maps to no property/medical/legal specialty. No discrepancy signals derived.",
    evidence_signals: [],
    recruiting_summary:
      "Intake could not classify the claim into property, medical, or legal. No specialist warranted; the Case Coordinator decides it alone and escalates to the human.",
    recruiting_score: 0,
    verdict_summary: "",
    verdict_label: "",
    verdict_confidence: 0,
    verdict_risk: "low",
    verdict_recommendation: null,
    verdict_explanation: "",
  },
};

function ts(secondsAgo: number): string {
  // Fixed base time so screenshots are deterministic (no Date.now()).
  const base = Date.parse("2026-06-13T15:42:00Z");
  return new Date(base + secondsAgo * 1000).toISOString();
}

// ── Casefile findings, accumulated as the claim advances ──
function cfIntake(d: PresetDescriptor): CasefileEntry {
  const domain = d.spec?.type ?? "unclassified";
  return {
    stage: "intake",
    summary: `Claim #4471 parsed and classified as ${domain.toUpperCase()}. Policyholder J. Reyes. Documents and evidence attached. Structured claim extracted.`,
    result: { claim_id: "4471", domain, docs: 3 },
    sender: "Intake & Coverage",
    ts: ts(2),
    message_type: "finding",
  };
}
const CF_COVERAGE: CasefileEntry = {
  stage: "coverage",
  summary:
    "Coverage confirmed. Policy POL-77120 active, deductible $500. No lapse. Policy in force for the classified domain.",
  result: { policy: "POL-77120", deductible: 500, covered: true },
  sender: "Intake & Coverage",
  ts: ts(9),
  message_type: "finding",
};
function cfEvidence(d: PresetDescriptor): CasefileEntry {
  const consistent = d.evidence_signals.length > 0 ? "no" : "yes";
  return {
    stage: "evidence_analysis",
    summary: d.evidence_summary,
    result: {
      vision_model: "google/gemma-3-27b-it",
      signals: d.evidence_signals,
      observations: [
        {
          filename: "evidence_01.jpg",
          severity_band: "moderate",
          consistent_with_narrative: consistent,
          damage_location: "documented loss site",
          confidence: "high",
        },
      ],
      degraded: false,
    },
    sender: "Evidence Analyst",
    ts: ts(12),
    message_type: "finding",
  };
}
function cfRecruiting(d: PresetDescriptor): CasefileEntry {
  return {
    stage: "recruiting",
    summary: d.recruiting_summary,
    result: {
      handle: d.recruited_handle,
      name: d.recruited_name,
      joined: Boolean(d.recruited_handle),
      capability_tag: d.capability_tag || null,
    },
    sender: "Case Coordinator",
    ts: ts(16),
    message_type: "finding",
  };
}
function cfVerdict(d: PresetDescriptor): CasefileEntry {
  return {
    stage: "specialist_verdict",
    summary: d.verdict_summary,
    // recommendation + explanation are SIBLINGS of result (per the backend
    // contract), so they live on the metadata dict, not inside result.
    recommendation: d.verdict_recommendation,
    explanation: d.verdict_explanation,
    result: {
      specialty: d.spec?.type ?? null,
      risk: d.verdict_risk,
      verdict: d.verdict_label,
      confidence: d.verdict_confidence,
    },
    sender: d.recruited_name ?? "Case Coordinator",
    ts: ts(58),
    message_type: "finding",
  } as CasefileEntry;
}
function cfConflict(d: PresetDescriptor): CasefileEntry {
  return {
    stage: "conflict",
    summary:
      "Coverage reads the policy as in-force, but the evidence signals contradict the claim narrative. Flagged for human review before sign-off.",
    result: {
      reasons: [
        "Vision flagged narrative inconsistency; coverage still shows the policy in force.",
        `Evidence-derived signals (${d.evidence_signals.join(", ")}) conflict with the stated loss.`,
      ],
      needs_human: true,
    },
    sender: "Case Coordinator",
    ts: ts(62),
    message_type: "finding",
  };
}
function cfEscalation(d: PresetDescriptor): CasefileEntry {
  const rec = d.verdict_recommendation ?? "deny";
  const word = rec.toUpperCase();
  const source = d.spec
    ? `${d.spec.org} ${d.spec.type} reviewer recommends ${word}`
    : "the Case Coordinator's own coverage assessment recommends review";
  return {
    stage: "escalation",
    // The Coordinator relays the specialist's recommendation + explanation verbatim.
    summary: `Recommendation: ${word}. Relaying ${source}: ${d.verdict_explanation || "see verdict."} Escalated to the human reviewer for final sign-off.`,
    result: { recommendation: rec, rationale: d.verdict_explanation },
    sender: "Case Coordinator",
    ts: ts(64),
    message_type: "finding",
  };
}

// ── Handshake events (cross-org consent) ──
function handshakeEvents(d: PresetDescriptor): {
  request: HandshakeEvent;
  consent: HandshakeEvent;
  approved: HandshakeEvent;
  joined: HandshakeEvent;
} {
  const handle = d.recruited_handle ?? "@property-group/property-agent";
  return {
    request: {
      step: "contact_request",
      sender: "Case Coordinator",
      content: `Insurance Provider requests contact with ${handle} across the org boundary.`,
      ts: ts(17),
    },
    consent: {
      step: "recruiting",
      sender: "system",
      content: `Contact request crossing trust boundary to ${d.partner_org}…`,
      ts: ts(19),
    },
    approved: {
      step: "approved",
      sender: d.partner_org,
      content: `${d.partner_org} auto-approves via CALLBACK contact handler. Trust boundary opened.`,
      ts: ts(21),
    },
    joined: {
      step: "joined",
      sender: d.recruited_name ?? d.partner_org,
      content: `${handle} joined the live claim room.`,
      ts: ts(23),
    },
  };
}

// ── Audit stream (typed events that flow the ticker) ──
function auditUpTo(phase: MockPhase, d: PresetDescriptor): AuditEntry[] {
  const handle = d.recruited_handle ?? "@property-group/property-agent";
  const specName = d.recruited_name ?? "the specialist";
  const domain = d.spec?.type ?? "unclassified";
  const signals = d.evidence_signals.join(" + ");
  const log: AuditEntry[] = [
    { type: "task", sender: "system", content: "Claim #4471 seeded into Band room.", ts: ts(0) },
    { type: "text", sender: "Intake & Coverage", content: "Parsing claim documents and evidence.", ts: ts(1) },
    { type: "tool_call", sender: "Intake & Coverage", content: "extract_claim(documents=3)", ts: ts(2) },
    { type: "tool_result", sender: "Intake & Coverage", content: `Structured claim extracted; classified domain = ${domain}.`, ts: ts(3) },
  ];
  if (["coverage", "evidence", "recruiting", "investigating", "conflict", "escalated", "signed"].includes(phase)) {
    log.push(
      { type: "tool_call", sender: "Intake & Coverage", content: "check_coverage(policy=POL-77120)", ts: ts(8) },
      { type: "tool_result", sender: "Intake & Coverage", content: "Coverage active. Deductible $500.", ts: ts(9) },
    );
  }
  if (["evidence", "recruiting", "investigating", "conflict", "escalated", "signed"].includes(phase)) {
    log.push(
      { type: "tool_call", sender: "Evidence Analyst", content: "run_evidence_analysis(claim=4471)", ts: ts(11) },
      {
        type: "tool_result",
        sender: "Evidence Analyst",
        content: signals ? `${signals} derived from vision.` : "No discrepancy signals derived from vision.",
        ts: ts(12),
      },
    );
  }
  // The no-domain path recruits nobody, so it never crosses the org boundary.
  if (d.recruited_handle && ["recruiting", "investigating", "conflict", "escalated", "signed"].includes(phase)) {
    log.push(
      { type: "thought", sender: "Case Coordinator", content: `Intake classified this claim as ${domain}. I always recruit the matching specialist.`, ts: ts(15) },
      { type: "thought", sender: "Case Coordinator", content: `lookup_peers(tag=#${d.capability_tag}) → matched ${handle} across the org boundary.`, ts: ts(16) },
      { type: "tool_call", sender: "Case Coordinator", content: `recruit(${handle})`, ts: ts(17) },
      { type: "text", sender: "system", content: "Contact request crossing trust boundary…", ts: ts(19) },
      { type: "tool_result", sender: d.partner_org, content: "Consent granted (CALLBACK). Boundary opened.", ts: ts(21) },
      { type: "task", sender: specName, content: `${handle} joined the room.`, ts: ts(23) },
    );
  }
  if (d.spec && ["investigating", "conflict", "escalated", "signed"].includes(phase)) {
    log.push(
      { type: "text", sender: specName, content: "Reviewing on open-weight model (data stays out of frontier vendors).", ts: ts(26) },
      { type: "tool_call", sender: specName, content: `assess_${d.spec.type}_evidence(claim=4471)`, ts: ts(32) },
      { type: "thought", sender: specName, content: `Applying ${d.spec.type} policy stance → ${d.verdict_label}.`, ts: ts(41) },
    );
  }
  if (d.spec && ["conflict", "escalated", "signed"].includes(phase)) {
    log.push(
      { type: "task", sender: "Case Coordinator", content: "CONFLICT: evidence vs verdict, challenging specialist.", ts: ts(60) },
    );
  }
  if (["escalated", "signed"].includes(phase)) {
    const rec = (d.verdict_recommendation ?? "deny").toUpperCase();
    if (d.spec) {
      log.push({ type: "tool_result", sender: specName, content: `Verdict: ${rec} — ${d.verdict_label} (confidence ${d.verdict_confidence}).`, ts: ts(58) });
    }
    log.push({ type: "text", sender: "Case Coordinator", content: `Relaying specialist recommendation: ${rec}. Escalating to the human reviewer.`, ts: ts(64) });
  }
  if (phase === "signed") {
    const rec = (d.verdict_recommendation ?? "deny").toUpperCase();
    log.push(
      { type: "task", sender: "Human Reviewer", content: `Decision: ${rec} signed and posted back to the Band room.`, ts: ts(78) },
      { type: "tool_result", sender: "system", content: "Claim lifecycle complete. Fully traceable.", ts: ts(79) },
    );
  }
  return log;
}

// The canonical console-state ordering (dashboard/lib/phases.ts), idle-first.
const MOCK_PHASE_SEQUENCE: readonly MockPhase[] = PHASES_WITH_IDLE;

function participantsFor(phase: MockPhase, d: PresetDescriptor): Participant[] {
  const idx = MOCK_PHASE_SEQUENCE.indexOf(phase);
  const atHumanReview = phase === "escalated" || phase === "signed";
  const a = { ...P_INTAKE, mentioned: phase === "intake" || phase === "coverage", active: !atHumanReview };
  const ev = { ...P_EVIDENCE, mentioned: phase === "evidence", active: !atHumanReview };
  const adj = { ...P_ADJ, mentioned: phase === "recruiting" || phase === "escalated" || phase === "conflict", active: true };
  const human = { ...P_HUMAN, mentioned: phase === "escalated", active: true };
  const out: Participant[] = [];
  if (idx >= 1) out.push(a, ev, adj, human);
  // Only the recruited specialist joins, and only once recruiting has happened.
  if (idx >= 4 && d.participant) {
    out.push({
      ...d.participant,
      mentioned: phase === "investigating" || phase === "conflict",
      active: phase === "investigating" || phase === "conflict",
    });
  }
  return out;
}

function casefileFor(phase: MockPhase, d: PresetDescriptor): CasefileEntry[] {
  const out: CasefileEntry[] = [];
  const idx = MOCK_PHASE_SEQUENCE.indexOf(phase);
  if (idx >= 1) out.push(cfIntake(d));
  if (idx >= 2) out.push(CF_COVERAGE);
  if (idx >= 3) out.push(cfEvidence(d));
  if (idx >= 4) out.push(cfRecruiting(d));
  // No specialist on the clean path → no verdict / conflict entries.
  if (idx >= 5 && d.spec) out.push(cfVerdict(d));
  if (idx >= 6 && d.spec) out.push(cfConflict(d));
  if (idx >= 7) out.push(cfEscalation(d));
  return out;
}

function handshakeFor(phase: MockPhase, d: PresetDescriptor): HandshakeEvent[] {
  const idx = MOCK_PHASE_SEQUENCE.indexOf(phase);
  // The clean path recruits nobody, so the trust boundary is never crossed.
  if (idx < 4 || !d.recruited_handle) return [];
  const hs = handshakeEvents(d);
  if (phase === "recruiting") return [hs.request, hs.consent, hs.approved];
  return [hs.request, hs.consent, hs.approved, hs.joined];
}

/**
 * Synthesize a full ArbiterState for `phase`. `preset` selects the demo path:
 * "property" (default) / "medical" / "legal" recruit the matching cross-org
 * specialist, who decides approve/deny and writes an explanation the Coordinator
 * relays; "no_domain" classifies to no domain so nobody is recruited (specialist
 * null, no handshake) and the Case Coordinator decides itself.
 */
export function mockState(
  phase: MockPhase,
  preset: MockPreset = "property",
): ArbiterState {
  if (phase === "idle") {
    return {
      chat_id: null,
      participants: [],
      casefile: [],
      audit: [],
      handshake: [],
      phase: "idle",
      band_url: null,
    };
  }
  const d = PRESETS[preset];
  const idx = MOCK_PHASE_SEQUENCE.indexOf(phase);
  // Specialist appears once recruited (idx >= 4); null on the no-domain path. Its
  // recommendation + explanation resolve once the verdict lands (idx >= 5).
  const hasVerdict = idx >= 5;
  const specialist =
    idx >= 4 && d.spec
      ? {
          ...d.spec,
          risk: hasVerdict ? d.verdict_risk : null,
          recommendation: hasVerdict ? d.verdict_recommendation : null,
          explanation: hasVerdict ? d.verdict_explanation : "",
          // Mirror the gateway contract: a real preset confidence is "model"-sourced;
          // null (and source null) before the verdict lands.
          confidence: hasVerdict ? d.verdict_confidence : null,
          confidence_source: hasVerdict ? ("model" as const) : null,
        }
      : null;
  // Discovery candidates are always available to the SeamScene preview; the
  // recruited handle/name only resolve once recruiting has happened on a path
  // that recruits someone.
  const recruited = idx >= 4 && d.recruited_handle;
  const discovery: NonNullable<ArbiterState["discovery"]> = {
    reasoning: recruited
      ? [
          { content: `Intake classified this claim as ${d.spec?.type ?? ""} → recruiting the #${d.capability_tag} specialist.`, ts: ts(16) },
          { content: `lookup_peers → matched ${d.recruited_handle} across the org boundary.`, ts: ts(16) },
        ]
      : [],
    recruited_handle: recruited ? d.recruited_handle : null,
    recruited_name: recruited ? d.recruited_name : null,
    candidates: d.candidates,
    capability_tag: d.capability_tag,
    match_path: recruited ? `lookup_peers(tag=${d.capability_tag}) → ${d.recruited_handle}` : null,
  };

  return {
    chat_id: CHAT_ID,
    participants: participantsFor(phase, d),
    casefile: casefileFor(phase, d),
    audit: auditUpTo(phase, d),
    handshake: handshakeFor(phase, d),
    phase,
    specialist,
    discovery,
    // The signed mock mirrors the human upholding the specialist's recommendation.
    decision:
      phase === "signed"
        ? { decision: d.verdict_recommendation ?? "deny", note: "" }
        : null,
    band_url: BAND_URL,
  };
}

export const MOCK_PHASES: MockPhase[] = MOCK_PHASE_SEQUENCE.filter((p) => p !== "idle");

/**
 * Reads ?mock= from the URL. Returns null when not in mock mode.
 *
 * The mock harness is a DEV-ONLY screenshot/storybook aid. `process.env.NODE_ENV`
 * is inlined client-side by Next at build time ("production" for `next build` /
 * `next start`, "development" for `next dev`), so this hard-gates the param off in
 * production builds — a `?mock=` URL can never override live gateway state for a
 * real visitor — while leaving the documented `next dev` workflow untouched.
 */
export function readMockParam(): MockPhase | "error" | null {
  if (typeof window === "undefined") return null;
  if (process.env.NODE_ENV === "production") return null;
  const v = new URLSearchParams(window.location.search).get("mock");
  if (!v) return null;
  if (v === "error") return "error";
  return (MOCK_PHASES as string[]).includes(v) ? (v as MockPhase) : null;
}

const MOCK_PRESETS: readonly MockPreset[] = ["property", "medical", "legal", "no_domain"];

/**
 * Reads ?preset= from the URL so `?mock=investigating&preset=legal` previews a
 * specific domain path. Defaults to "property" and is gated off in production
 * exactly like {@link readMockParam}, so it can never alter live state for a real
 * visitor.
 */
export function readMockPreset(): MockPreset {
  if (typeof window === "undefined") return "property";
  if (process.env.NODE_ENV === "production") return "property";
  const v = new URLSearchParams(window.location.search).get("preset");
  return v && (MOCK_PRESETS as string[]).includes(v) ? (v as MockPreset) : "property";
}
