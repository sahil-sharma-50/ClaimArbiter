import { getStoredKeys } from "@/dashboard/lib/storage";

/** Gateway error carrying the HTTP status, so callers can tell a dead room
 *  (404/502 — Band can't serve it) from a transient failure worth retrying. */
export class GatewayError extends Error {
  constructor(public status: number) {
    super(`Gateway error: ${status}`);
    this.name = "GatewayError";
  }
}

export type Participant = {
  name: string;
  org: string;
  framework: string;
  model: string;
  mentioned: boolean;
  type?: string;
  /** Internal role key stamped by the gateway: "intake" | "evidence" |
   *  "case_coordinator" | "human_reviewer" | "property" | "medical" | "legal" |
   *  "other". Drives the per-role avatar icon. */
  role?: string;
  /** False when the agent contributed but was dismissed from the Band room. */
  active?: boolean;
};

export type CasefileEntry = {
  stage: string;
  summary: string;
  result: unknown;
  ts?: string;
  sender?: string;
  message_type?: string;
};

export type AuditEntry = {
  type: string;
  sender?: string;
  content: string;
  ts?: string;
  /** Structured casefile stage when the Band message carried one. */
  stage?: string | null;
};

export type HandshakeEvent = {
  step: string;
  sender?: string;
  content: string;
  ts?: string;
};

/** The Human Reviewer's signed verdict — distinct from the AI recommendation. */
export type Decision = {
  decision: "approve" | "deny";
  note?: string;
  /**
   * Who actually authored the sign-off in Band. "human" when a real human user
   * key posted it via Band's /me API; "agent_on_behalf_of_human" when that API
   * was unavailable (e.g. 403 on non-Enterprise plans) and the gateway recorded
   * the human's decision as a Case Coordinator agent event instead. Drives honest
   * provenance text — we never claim a human posted when an agent did.
   */
  authored_by?: "human" | "agent_on_behalf_of_human";
};

/**
 * The specialist on this claim — the domain-agnostic spine every scene reads
 * instead of hard-coding a single specialty. null when the claim classified to no
 * domain and the Case Coordinator decided itself.
 */
export type Specialist = {
  type: "property" | "medical" | "legal";
  name: string;
  org: string;
  framework: string;
  provider: string;
  tag: string;
  verdict_label: string;
  risk?: string | null;
  /** The specialist's own approve/deny call, relayed verbatim to the human. null until verdict. */
  recommendation?: "approve" | "deny" | null;
  /** The specialist's written rationale for that call, relayed verbatim. "" until verdict. */
  explanation?: string;
  /** Confidence in the call (0–1), or null when there is no verdict to be sure of. */
  confidence?: number | null;
  /** Provenance of `confidence`: "model" (specialist returned a number), "derived"
   *  (computed from the verdict's risk band, labelled as such), or null (no verdict).
   *  Never a fabricated constant. */
  confidence_source?: "model" | "derived" | null;
};

/**
 * The approve/deny stance a domain specialist enforces — mirrors
 * backend/agents/shared/policies.py (DomainPolicy.as_payload). Fetched from
 * /api/policies and rendered on the dashboard's Policy card.
 */
export type Policy = {
  domain: "property" | "medical" | "legal";
  title: string;
  org: string;
  summary: string;
  approve: string[];
  deny: string[];
};

export type DiscoveryCandidate = {
  name?: string;
  handle?: string;
  tags?: string[];
};

/** What the Case Coordinator saw and decided when assembling the team. */
export type Discovery = {
  reasoning: { content: string; ts?: string }[];
  recruited_handle: string | null;
  recruited_name: string | null;
  candidates?: DiscoveryCandidate[];
  capability_tag?: string | null;
  match_path?: string | null;
};

export type RoutingScore = {
  score: number | null;
  threshold: number | null;
  recruit: boolean | null;
  domain: string | null;
  present_signals: string[];
};

export type ArbiterState = {
  chat_id: string | null;
  participants: Participant[];
  casefile: CasefileEntry[];
  audit: AuditEntry[];
  handshake: HandshakeEvent[];
  phase: string;
  specialist?: Specialist | null;
  discovery?: Discovery;
  routing_score?: RoutingScore | null;
  decision?: Decision | null;
  /** Soft-delete marker (durable in Band): true once the claim is archived. The
   *  gateway excludes archived claims from /api/claims so a removed claim does not
   *  reappear after a refresh rehydrates the room. */
  archived?: boolean;
  band_url: string | null;
};

/** A selectable preset claim shown in the demo picker. */
export type ClaimPreset = {
  id: "property" | "medical" | "legal";
  label: string;
  domain: string;
  outcome: string;
  blurb: string;
};

export const CLAIM_PRESETS: ClaimPreset[] = [
  {
    id: "property",
    label: "Property, water damage",
    domain: "Property",
    outcome: "Routes to the property assessor",
    blurb: "Ambiguous water source and pre-dating moisture route this to Property Group's covered-peril assessor.",
  },
  {
    id: "medical",
    label: "Medical, injury claim",
    domain: "Medical",
    outcome: "Routes to the medical reviewer",
    blurb: "Treatment-to-injury mismatch routes this to Medical Group's medical-necessity reviewer.",
  },
  {
    id: "legal",
    label: "Legal, excluded matter",
    domain: "Legal",
    outcome: "Routes to the legal reviewer",
    blurb: "Attorney fees for a business dispute outside the policy route to Legal Group — and are denied with a written rationale.",
  },
];

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:8080";

function seedBodyFromStorage(): Record<string, string> {
  const keys = getStoredKeys();
  const body: Record<string, string> = {};
  if (keys?.aimlApiKey) body.aiml_api_key = keys.aimlApiKey;
  if (keys?.featherlessApiKey) body.featherless_api_key = keys.featherlessApiKey;
  if (keys?.aimlModel) body.aiml_model = keys.aimlModel;
  if (keys?.featherlessModel) body.featherless_model = keys.featherlessModel;
  return body;
}

export async function fetchState(
  chatId?: string | null,
  refresh = false,
): Promise<ArbiterState> {
  const params = new URLSearchParams();
  if (chatId) params.set("chat_id", chatId);
  if (refresh) params.set("refresh", "true");
  const qs = params.toString();
  const res = await fetch(`${GATEWAY_URL}/api/state${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new GatewayError(res.status);
  return res.json();
}

export async function seedDemo(
  claimType: ClaimPreset["id"] = "property",
): Promise<{ chat_id: string }> {
  const body: Record<string, string> = { ...seedBodyFromStorage(), claim_type: claimType };
  const res = await fetch(`${GATEWAY_URL}/api/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Seed failed: ${res.status}`);
  }
  return res.json();
}

export type ClaimInput = {
  claim_id: string;
  policy_id: string;
  /** Claimant-selected category (property/medical/accident/other) — informational;
   *  agents still classify the domain from the narrative. */
  category?: string;
  incident_date: string;
  reported_date: string;
  incident_location?: string;
  incident_time?: string;
  claimant: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
    dob?: string;
  };
  damage: { description: string; estimated_repair: number };
  currency?: string;
  loss_amount: number;
  deductible: number;
  /** Free-text note about any other policy covering part of the loss. */
  other_insurance?: string;
  narrative: string;
  /** The claimant's truth-and-completeness declaration. */
  declaration?: boolean;
};

export async function createClaim(
  input: ClaimInput,
): Promise<{ chat_id: string }> {
  // Provider keys ride along with the claim so the gateway spawns agents with them.
  const res = await fetch(`${GATEWAY_URL}/api/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, ...seedBodyFromStorage() }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Create claim failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Create a custom claim with uploaded image/PDF evidence (multipart).
 * Posts to /api/claim/upload: the claim travels as a JSON `claim` field alongside
 * the binary `photos`/`document` parts, plus any provider keys from storage.
 */
export async function createClaimWithFiles(
  input: ClaimInput,
  photos: File[],
  document: File | null,
): Promise<{ chat_id: string }> {
  const fd = new FormData();
  fd.append("claim", JSON.stringify(input));
  for (const photo of photos) fd.append("photos", photo);
  if (document) fd.append("document", document);
  for (const [k, v] of Object.entries(seedBodyFromStorage())) fd.append(k, v);

  // No Content-Type header: the browser sets the multipart boundary itself.
  const res = await fetch(`${GATEWAY_URL}/api/claim/upload`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Create claim failed: ${res.status}`);
  }
  return res.json();
}

export async function postApproval(
  decision: "approve" | "deny",
  chatId: string,
  note = "",
  humanReviewerKey?: string,
): Promise<void> {
  if (!chatId) throw new Error("chat_id is required for approval");

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = humanReviewerKey ?? getStoredKeys()?.humanReviewerApiKey;
  if (key) headers["X-Human-Reviewer-Api-Key"] = key;

  const res = await fetch(`${GATEWAY_URL}/api/approve?chat_id=${encodeURIComponent(chatId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ decision, note }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Approval failed: ${res.status}`);
  }
}

/**
 * Archive a session in Band and clear its gateway state. Band has no
 * delete-room API, so the gateway posts a closing event and drops its cache;
 * the audit trail is preserved. Returns whether the Band write succeeded so the
 * caller can warn if only the local copy was removed.
 */
export async function deleteSession(chatId: string): Promise<{ band: boolean }> {
  if (!chatId) throw new Error("chat_id is required to delete a session");
  const res = await fetch(
    `${GATEWAY_URL}/api/session?chat_id=${encodeURIComponent(chatId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Delete failed: ${res.status}`);
  }
  const data = (await res.json()) as { band?: boolean };
  return { band: Boolean(data.band) };
}

export type Health = {
  ok: boolean;
  gateway?: boolean;
  /** True when the server has no fallback keys, so a visitor MUST supply their own. */
  keys_required?: boolean;
  server_keys?: { aiml: boolean; featherless: boolean };
};

export function reportPdfUrl(chatId: string): string {
  return `${GATEWAY_URL}/api/report/${encodeURIComponent(chatId)}`;
}

/** Result of recomputing a claim's tamper-evident audit seal from live Band state. */
export type SealVerification = {
  chat_id: string;
  seal: string;
  expected: string | null;
  match: boolean | null;
  message_count: number;
};

/**
 * Recompute the audit seal from a LIVE Band fetch. With no `expected` seal the
 * gateway just returns the current seal (match=null); pass the seal from the PDF
 * to get a tamper-evident match verdict. Throws on a gateway/Band error.
 */
export async function verifySeal(
  chatId: string,
  expected?: string,
): Promise<SealVerification> {
  const qs = expected ? `?seal=${encodeURIComponent(expected)}` : "";
  const res = await fetch(
    `${GATEWAY_URL}/api/claims/${encodeURIComponent(chatId)}/verify${qs}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`Verify failed (${res.status})`);
  return res.json();
}

/** URL for a claim's evidence file. preview=true renders a PDF's page 1 as PNG. */
export function evidenceUrl(
  chatId: string,
  filename: string,
  opts: { preview?: boolean } = {},
): string {
  const qs = opts.preview ? "?preview=1" : "";
  return `${GATEWAY_URL}/api/evidence/${encodeURIComponent(chatId)}/${encodeURIComponent(filename)}${qs}`;
}

/** One row of the org's Band agent directory (live from /api/v1/agent/peers). */
export type DirectoryAgent = {
  name: string;
  handle: string | null;
  role: string;
  org: string;
  framework: string;
  model: string;
  type: "human" | "agent";
};

/**
 * The org's Band agents, live from the gateway's peer-directory proxy. Throws on
 * a gateway/Band error so the page can show a "can't reach" state rather than a
 * fabricated roster.
 */
export async function fetchAgents(): Promise<DirectoryAgent[]> {
  const res = await fetch(`${GATEWAY_URL}/api/agents`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
  const data = (await res.json()) as { agents?: DirectoryAgent[] };
  return data.agents ?? [];
}

/**
 * The three domain approve/deny policies, live from the gateway. Throws on a
 * gateway/Band error so the page can show a "can't reach" state rather than a
 * fabricated stance — mirrors fetchAgents/fetchClaims error handling.
 */
export async function fetchPolicies(): Promise<Policy[]> {
  const res = await fetch(`${GATEWAY_URL}/api/policies`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
  return res.json();
}

export type ClaimSummary = {
  chat_id: string;
  phase: string;
  /** The recruited specialist's org ("Property Group" / "Medical Group" / "Legal Group"), or null. */
  specialist: string | null;
  /** The recruited specialist's domain key, or null when no domain matched. */
  specialist_type?: "property" | "medical" | "legal" | null;
  /** The specialist's assessed risk, or null when none was produced. */
  risk?: "high" | "medium" | "low" | null;
  /** The Case Coordinator's AI recommendation, or null until escalated. */
  recommendation?: "approve" | "deny" | null;
  /** The Human Reviewer's signed decision, or null until signed. */
  decision?: "approve" | "deny" | null;
  participant_count: number;
  band_url: string | null;
};

export async function fetchClaims(): Promise<ClaimSummary[]> {
  const res = await fetch(`${GATEWAY_URL}/api/claims`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Gateway error: ${res.status}`);
  return res.json();
}

export async function fetchHealth(): Promise<Health> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/health`, { cache: "no-store" });
    if (!res.ok) return { ok: false };
    return res.json();
  } catch {
    return { ok: false };
  }
}

export type GatewayConfig = {
  /** Default model the run resolves to (server .env if set, else hardcoded). */
  aiml_model: string;
  featherless_model: string;
  /** True when the host .env provides this slot — used as a fallback when the visitor
   * leaves their own key blank. The Settings field stays editable (visitor key wins). */
  server_keys: { aiml: boolean; featherless: boolean };
  server_models: { aiml: boolean; featherless: boolean };
};

export async function fetchConfig(): Promise<GatewayConfig | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/config`, { cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function testProviderKey(
  provider: "aiml" | "featherless",
  apiKey: string,
): Promise<{ ok: boolean }> {
  const res = await fetch(`${GATEWAY_URL}/api/keys/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, api_key: apiKey }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Test failed: ${res.status}`);
  }
  return res.json();
}
