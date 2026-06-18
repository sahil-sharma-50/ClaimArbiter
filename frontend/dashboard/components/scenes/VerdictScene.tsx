"use client";

import { useState } from "react";
import type { CasefileEntry, Decision, Specialist } from "@/dashboard/lib/api";
import { postApproval, reportPdfUrl, verifySeal } from "@/dashboard/lib/api";
import { getStoredKeys } from "@/dashboard/lib/storage";
import { Field, SceneHead } from "@/dashboard/components/scenes/parts";
import { findStageResult, stageResult } from "@/dashboard/lib/casefileSchema";
import { ConflictScene } from "@/dashboard/components/scenes/ConflictScene";

// A specialist verdict's confidence can arrive as 0–1 or as a 0–100 percentage
// (free-form LLM JSON). Normalize to 0–1 so the Gauge never overflows its track.
function normConfidence(value: number): number {
  if (value > 1) return Math.min(1, value / 100);
  return Math.max(0, value);
}

/*
  SCENE: escalated / signed — THE PAYOFF.
  The verdict and the human sign-off, brought to CENTER STAGE (not a side
  panel). The judge watches a decision get made. The verdict shown is whichever
  specialist the Case Coordinator recruited (property / medical / legal), or — for a
  claim that classified to no domain — the Case Coordinator's own call. The
  specialist decides approve/deny and writes an explanation; the Coordinator
  relays both verbatim, and we surface that written rationale here. In mock mode
  the buttons are inert (no chatId), so the scene still renders both pending and
  signed states.
*/

// A high-risk verdict reads as an alarm (red); medium/low reads calmer (amber).
function riskTone(risk?: string | null): string {
  if (risk === "high") return "var(--danger)";
  if (risk === "medium") return "var(--warning)";
  if (risk === "low") return "var(--success)";
  return "var(--danger)";
}

export function VerdictScene({
  casefile,
  phase,
  chatId,
  decision,
  specialist,
  onAction,
  readOnly = false,
}: {
  casefile: CasefileEntry[];
  phase: string;
  chatId: string | null;
  decision?: Decision | null;
  specialist: Specialist | null;
  onAction: () => void;
  readOnly?: boolean;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const signed = phase === "signed";
  // Accept the new domain-neutral stage and the legacy fraud_verdict alias.
  const verdict = casefile.find(
    (c) => c.stage === "specialist_verdict" || c.stage === "fraud_verdict",
  );
  const escalation = casefile.find((c) => c.stage === "escalation");

  // Typed reads through the casefile schema seam (see casefileSchema.ts) — same
  // fields, same fallbacks as the old inline casts, now checked against one contract.
  const verdictResult = stageResult(verdict, "specialist_verdict");
  const escalationResult = stageResult(escalation, "escalation");
  const coverageResult = findStageResult(casefile, "coverage");
  const intakeResult = findStageResult(casefile, "intake");

  // Confidence is REAL or DERIVED — never a fabricated constant. The gateway
  // surfaces a number whenever a verdict exists: the specialist's own score when it
  // returned one ("model"), otherwise a transparent score computed from the verdict's
  // risk band ("derived"), which we label as such. Prefer the specialist descriptor
  // (carries provenance); fall back to the raw casefile result for legacy transcripts.
  // `conf` is null only when there is no verdict to be confident about.
  const rawConf =
    typeof specialist?.confidence === "number"
      ? specialist.confidence
      : verdictResult.confidence;
  const conf = typeof rawConf === "number" ? normConfidence(rawConf) : null;
  const confDerived = specialist?.confidence_source === "derived";

  // Recommendation defaults to a neutral "pending" — we don't invent DENY when no
  // recommendation exists yet. The specialist owns the approve/deny call now and
  // the Coordinator relays it; prefer the specialist's, falling back to the
  // escalation entry for legacy/clean-path runs.
  const recommendation =
    specialist?.recommendation ?? escalationResult.recommendation ?? "pending";
  // The specialist's OWN written rationale — the only text we may present as
  // "relayed verbatim" from the specialist. Empty unless a specialist verdict
  // actually carried an explanation.
  const specialistExplanation = specialist?.explanation || "";
  // The Case Coordinator's own rationale from the escalation event. This is the
  // Coordinator speaking (e.g. the no-expert-match fallback), NOT the specialist —
  // so it must never be labelled as a specialist's verbatim explanation.
  const coordinatorRationale =
    (escalationResult as { rationale?: string }).rationale || "";
  // A specialist participant joined the room but never returned a verdict: Discover
  // shows a recruit, yet there is no specialist_verdict / explanation. We surface
  // this honestly instead of passing off the Coordinator's fallback as the
  // specialist's words (the Featherless turn likely failed — see CONTEXT).
  const specialistJoinedButSilent =
    Boolean(specialist) && !verdict && !specialistExplanation && !specialist?.recommendation;
  // What to display in the rationale block, with its true source.
  const explanation = specialistExplanation || coordinatorRationale;
  const explanationFromSpecialist = Boolean(specialistExplanation);

  // Coverage verdict (boolean) from the real coverage casefile entry. undefined
  // when coverage hasn't been decided; drives the "Coverage Valid/Excluded" field.
  const covered = coverageResult.covered;
  const coverageWord = covered === false ? "Excluded" : covered === true ? "Valid" : "-";
  const coverageTone = covered === false ? "var(--danger)" : "var(--success)";

  const claimId =
    intakeResult.claim_id != null ? String(intakeResult.claim_id) : null;

  // Descriptor-driven labels — the scene no longer assumes "fraud / Investigators Unit".
  const hasSpecialist = Boolean(specialist) || Boolean(verdict);
  const verdictSource = specialist
    ? `${specialist.org} verdict · ${specialist.framework} on ${specialist.provider}`
    : "Case Coordinator review";
  const verdictLabel = specialist?.verdict_label ?? "coverage assessment";
  const risk = specialist?.risk ?? null;
  const tone = hasSpecialist ? riskTone(risk) : "var(--success)";

  async function decide(decision: "approve" | "deny") {
    if (!chatId || readOnly) return;
    setBusy(decision);
    setError(null);
    try {
      const humanReviewerKey = getStoredKeys()?.humanReviewerApiKey;
      await postApproval(decision, chatId, note, humanReviewerKey);
      onAction();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(null);
    }
  }

  // Closed case: a resolved RECORD, not the live alarm. Lead with the HUMAN'S
  // decision (approve/deny) — distinct from the AI recommendation, which is
  // demoted to supporting evidence. Fall back to the recommendation only if no
  // signed decision was captured (e.g. a session signed outside the dashboard).
  if (signed) {
    const outcome = decision?.decision ?? recommendation;
    return (
      <>
        <SignedRecord
          outcome={outcome}
          recommendation={recommendation}
          conf={conf}
          authoredBy={decision?.authored_by}
          verdictSummary={verdict?.summary}
          explanation={explanation}
          explanationFromSpecialist={explanationFromSpecialist}
          claimId={claimId}
          chatId={chatId}
          note={decision?.note || (escalationResult as { note?: string }).note}
          verdictSource={hasSpecialist ? verdictSource : null}
          verdictLabel={verdictLabel}
          coverageWord={coverageWord}
          coverageTone={coverageTone}
          tone={tone}
        />
        {/* A conflict is part of the closed-case record — the escalated/signed
            phase outranks "conflict", so it must surface here too, not only in
            the brief conflict phase. */}
        <ConflictScene casefile={casefile} />
      </>
    );
  }

  return (
    <div className="relative">
      <SceneHead
        kicker="05 · Human sign-off"
        title="Your call closes the loop."
        status={
          <span
            className="badge"
            style={{ background: "var(--warning-subtle)", color: "var(--warning)" }}
          >
            <span className="pulse-dot" style={{ background: "currentColor" }} />
            Awaiting decision
          </span>
        }
      />

      {/* Verdict card — clean raised plate with a thin risk-tinted top accent
          (replaces the heavy 2px alarm frame on a near-black well). */}
      <div
        className="mt-7 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--line-faint)] bg-[var(--surface)] border-t-2"
        style={{ borderTopColor: `color-mix(in oklch, ${tone} 60%, var(--line))` }}
      >
        <div className="flex items-center justify-between border-b border-[var(--line-faint)] px-5 py-3">
          <span className="label" style={{ color: "var(--org-b)" }}>
            {verdictSource}
          </span>
          <span
            className="font-[family-name:var(--font-mono)] text-[11px] font-bold uppercase tracking-wide rounded-full px-2 py-0.5"
            style={
              risk === "high"
                ? { background: "var(--danger-subtle)", color: "var(--danger)" }
                : risk === "medium"
                  ? { background: "var(--warning-subtle)", color: "var(--warning)" }
                  : { background: "var(--success-subtle)", color: "var(--success)" }
            }
          >
            {risk ? `${risk} risk · ${verdictLabel}` : verdictLabel}
          </span>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-[1fr_1.2fr]">
          {conf != null ? (
            <div>
              <span className="label">
                {confDerived ? "Confidence (risk-derived)" : "Specialist confidence"}
              </span>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-3xl font-bold" style={{ color: "var(--metric)" }}>
                {conf.toFixed(2)}
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--metric-track)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.round(conf * 100)}%`, background: "linear-gradient(90deg, var(--warning), var(--danger))" }} />
              </div>
              {confDerived && (
                <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                  Derived from the verdict’s risk band — the specialist returned no numeric score.
                </p>
              )}
            </div>
          ) : (
            <div>
              <span className="label">Confidence</span>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-2xl font-bold text-[var(--text-faint)]">
                n/a
              </p>
              <p className="mt-1 text-[11px] text-[var(--text-faint)]">
                No specialist score on this claim.
              </p>
            </div>
          )}
          <p className="text-[13px] leading-relaxed text-[var(--text-soft)]">
            {verdict?.summary ??
              (specialistJoinedButSilent
                ? `${specialist?.org ?? "The specialist"} joined the room but did not return a verdict. The Case Coordinator decided the claim itself.`
                : hasSpecialist
                  ? `${specialist?.org ?? "The specialist"} returned its assessment. Review the findings and sign the decision.`
                  : "The claim classified to no specialist domain. The Case Coordinator weighed coverage and drafted the recommendation itself.")}
          </p>
        </div>
        {explanation && (
          <div className="border-t border-[var(--line-faint)] px-5 py-4">
            <span className="label" style={{ color: explanationFromSpecialist ? "var(--org-b)" : "var(--text-faint)" }}>
              {explanationFromSpecialist
                ? "Specialist explanation · relayed verbatim"
                : "Case Coordinator rationale"}
            </span>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-soft)]">
              {explanation}
            </p>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 border-t border-[var(--line-faint)] bg-[var(--inset)] px-5 py-3.5">
          <Field label="Coverage" value={coverageWord} tone={coverageTone} />
          <Field
            label={hasSpecialist ? "Specialist verdict" : "Investigation"}
            value={hasSpecialist ? (conf != null ? conf.toFixed(2) : "-") : "Not needed"}
            tone="var(--metric)"
          />
          <Field
            label="Recommendation"
            value={recommendation.toUpperCase()}
            tone={
              recommendation === "deny"
                ? "var(--danger)"
                : recommendation === "approve"
                  ? "var(--success)"
                  : "var(--text-soft)"
            }
          />
        </div>
      </div>

      {/* Conflict (if any) — shown above sign-off so the human sees the
          evidence-vs-verdict disagreement before deciding. */}
      <ConflictScene casefile={casefile} />

      {/* Sign-off */}
      {chatId && (
        <div className="mt-4">
          <a
            href={reportPdfUrl(chatId)}
            className="btn btn-secondary inline-flex items-center gap-2 text-sm"
            download
          >
            Download case report (PDF)
          </a>
          <p className="mt-1.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-ghost)]">
            Rebuilt from Band. Survives cache clear
          </p>
        </div>
      )}
      {readOnly ? (
        <div className="mt-6 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--inset)] px-4 py-3 text-sm text-[var(--text-soft)]">
          Sign-off was completed for this session. Controls are disabled in read-only view.
        </div>
      ) : (
        <div className="mt-6">
          <label className="block">
            <span className="label">Review note (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for the decision…"
              rows={2}
              disabled={busy !== null}
              className="input mt-1.5 resize-none disabled:opacity-50"
            />
          </label>
          <p className="mt-3 mb-2 text-[12px] leading-relaxed text-[var(--text-faint)]">
            Approve pays the claim · Deny rejects it. Your decision is signed to the
            Band room and closes the case.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide("approve")}
              className="decide-btn decide-approve"
            >
              <span className="decide-ic">{busy === "approve" ? <Spinner /> : <CheckIcon />}</span>
              <span className="decide-tx"><span className="w">Approve</span><span className="s">Pay the claim</span></span>
              {recommendation === "approve" && <span className="decide-rec" aria-label="Recommended by AI">AI rec</span>}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => decide("deny")}
              className="decide-btn decide-deny"
            >
              <span className="decide-ic">{busy === "deny" ? <Spinner /> : <XIcon />}</span>
              <span className="decide-tx"><span className="w">Deny</span><span className="s">Reject the claim</span></span>
              {recommendation === "deny" && <span className="decide-rec" aria-label="Recommended by AI">AI rec</span>}
            </button>
          </div>
          {(recommendation === "approve" || recommendation === "deny") && (
            <p className="mt-2 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-wide text-[var(--text-ghost)]">
              AI recommends <span style={{ color: recommendation === "deny" ? "var(--danger)" : "var(--success)" }}>{recommendation}</span>. The other choice overrides it.
            </p>
          )}
          {!chatId && (
            <p className="mt-2.5 font-[family-name:var(--font-mono)] text-[10px] text-[var(--text-ghost)]">
              preview mode · sign-off posts to the live room during a real run
            </p>
          )}
          {error && (
            <p
              className="mt-2.5 flex items-start gap-1.5 rounded-[var(--radius-md)] border border-[var(--danger-subtle)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-3 py-2 text-xs text-[var(--danger)]"
              role="alert"
            >
              <span className="mt-px shrink-0">⚠</span>
              <span>{error}</span>
            </p>
          )}
          <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--inset)] px-3 py-2 text-[11px] leading-relaxed text-[var(--text-faint)]">
            On non-Enterprise Band plans your decision is recorded in the room as a
            Case&nbsp;Coordinator event on your behalf (provenance is tracked). Set
            <code className="mx-1 font-[family-name:var(--font-mono)] text-[var(--text-soft)]">HUMAN_REVIEWER_USER_API_KEY</code>
            to post it as a human message instead.
          </p>
        </div>
      )}
    </div>
  );
}

/*
  SIGNED — a resolved case RECORD. The decision is the hero; the specialist
  verdict that drove it is demoted to calm evidence. Reads as a closed, archived
  file, visually distinct from the live red "awaiting decision" alarm.
*/
function SignedRecord({
  outcome,
  recommendation,
  conf,
  authoredBy,
  verdictSummary,
  explanation,
  explanationFromSpecialist,
  claimId,
  chatId,
  note,
  verdictSource,
  verdictLabel,
  coverageWord,
  coverageTone,
  tone,
}: {
  /** The Human Reviewer's actual decision — drives the hero outcome. */
  outcome: string;
  /** The Case Coordinator's AI recommendation — shown as supporting evidence. */
  recommendation: string;
  /** Real specialist confidence (0–1), or null when none was produced. */
  conf: number | null;
  /** Who authored the sign-off in Band — drives honest provenance wording. */
  authoredBy?: "human" | "agent_on_behalf_of_human";
  verdictSummary?: string;
  /** The rationale to show; either the specialist's or the Coordinator's. "" when none. */
  explanation?: string;
  /** True when `explanation` is the specialist's own words (relayed verbatim);
   *  false when it is the Case Coordinator's own rationale. */
  explanationFromSpecialist?: boolean;
  claimId: string | null;
  chatId: string | null;
  note?: string;
  /** Which specialist produced the verdict; null when nobody was recruited. */
  verdictSource: string | null;
  verdictLabel: string;
  /** Coverage verdict word ("Valid" / "Excluded" / "—") from the real coverage entry. */
  coverageWord: string;
  coverageTone: string;
  tone: string;
}) {
  const denied = outcome === "deny";
  const approved = outcome === "approve";
  // Honest tone: only green for a real approve, red for a real deny, neutral for
  // an unknown/pending outcome — never assert "Approved" by default.
  const outcomeTone = denied ? "var(--danger)" : approved ? "var(--success)" : "var(--text-soft)";
  const outcomeWord = denied ? "Denied" : approved ? "Approved" : "Pending";
  // Flag when the human overrode the AI's recommendation — a meaningful audit
  // fact. Only meaningful when BOTH sides are concrete approve/deny values.
  const concrete = (o: string) => o === "approve" || o === "deny";
  const overrode = concrete(outcome) && concrete(recommendation) && outcome !== recommendation;

  return (
    <div className="signed-record">
      <header className="signed-record-head">
        <span className="signed-record-claim">
          {claimId ? `Claim #${claimId}` : "Claim resolved"}
        </span>
        <span className="signed-record-closed">
          <CheckIcon />
          Closed
        </span>
      </header>

      {/* Outcome hero */}
      <div className="signed-outcome">
        <span className="signed-outcome-rule" style={{ background: outcomeTone }} aria-hidden />
        <div>
          <p className="signed-outcome-label">Final decision</p>
          <p className="signed-outcome-word" style={{ color: outcomeTone }}>
            {outcomeWord}
          </p>
          <p className="signed-outcome-by">
            {authoredBy === "agent_on_behalf_of_human"
              ? "Recorded on behalf of the Human Reviewer (Band Human API unavailable) · in the Band audit trail"
              : "Signed by the Human Reviewer · posted to the Band audit trail"}
            {overrode && (
              <>
                {" · "}
                <span style={{ color: "var(--warning)" }}>
                  overrode AI recommendation to {recommendation.toUpperCase()}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {note && (
        <blockquote className="signed-note">
          <span className="signed-note-label">Reviewer note</span>
          {note}
        </blockquote>
      )}

      {/* Evidence — calm, not alarming */}
      <div className="signed-evidence">
        <span className="signed-evidence-label">What the decision rests on</span>
        <dl className="signed-evidence-grid">
          <EvidenceRow term="Coverage" value={coverageWord} tone={coverageTone} />
          {verdictSource ? (
            <EvidenceRow
              term={verdictSource}
              value={verdictLabel}
              tone={tone}
              meta={conf != null ? `confidence ${conf.toFixed(2)}` : undefined}
            />
          ) : (
            <EvidenceRow
              term="Investigation"
              value="Not warranted"
              tone="var(--success)"
              meta="below threshold"
            />
          )}
          <EvidenceRow
            term="AI recommendation"
            value={recommendation.toUpperCase()}
            tone={
              recommendation === "deny"
                ? "var(--danger)"
                : recommendation === "approve"
                  ? "var(--success)"
                  : "var(--text-soft)"
            }
          />
        </dl>
        {explanation ? (
          <p className="signed-evidence-summary">
            <span className="signed-evidence-label" style={{ display: "block", marginBottom: 4 }}>
              {explanationFromSpecialist
                ? "Specialist explanation · relayed verbatim"
                : "Case Coordinator rationale"}
            </span>
            {explanation}
          </p>
        ) : (
          verdictSummary && <p className="signed-evidence-summary">{verdictSummary}</p>
        )}
      </div>

      {chatId && (
        <a
          href={reportPdfUrl(chatId)}
          download
          className="btn btn-secondary mt-1 inline-flex items-center gap-2 self-start text-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
          </svg>
          Download case report (PDF)
        </a>
      )}
      {chatId && <AuditSeal chatId={chatId} />}
      <p className="signed-foot">
        Fully traceable. Wipe the cache and this record rebuilds straight from the room.
      </p>
    </div>
  );
}

/*
  AUDIT SEAL — the tamper-evident proof. A SHA-256 over the ordered Band
  transcript, recomputed LIVE from Band when the judge hits "Verify". Because the
  gateway stores no authoritative state, a MATCH proves the sealed packet still
  reflects the room of record — delete the gateway and the seal still verifies.
*/
function AuditSeal({ chatId }: { chatId: string }) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; seal: string; match: boolean | null }
    | { status: "error"; message: string }
  >({ status: "idle" });

  async function runVerify() {
    setState({ status: "loading" });
    try {
      // First call returns the current seal; re-feed it to get a MATCH verdict —
      // both reads hit Band fresh, so a match proves the room is unchanged.
      const current = await verifySeal(chatId);
      const confirmed = await verifySeal(chatId, current.seal);
      setState({ status: "done", seal: confirmed.seal, match: confirmed.match });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : "Verify failed" });
    }
  }

  return (
    <div className="audit-seal">
      <div className="audit-seal-head">
        <span className="label" style={{ color: "var(--org-b)" }}>
          Tamper-evident seal · SHA-256 over the Band transcript
        </span>
        <button
          type="button"
          onClick={runVerify}
          disabled={state.status === "loading"}
          className="btn btn-secondary text-xs"
        >
          {state.status === "loading" ? "Verifying…" : "Verify from Band"}
        </button>
      </div>
      {state.status === "done" && (
        <>
          <p className="audit-seal-hash font-[family-name:var(--font-mono)]">{state.seal}</p>
          {state.match === true && (
            <p
              className="audit-seal-verdict font-[family-name:var(--font-mono)]"
              style={{ color: "var(--success)" }}
            >
              ✓ MATCH — recomputed live from Band. The sealed packet is intact.
            </p>
          )}
          {state.match === false && (
            <p
              className="audit-seal-verdict font-[family-name:var(--font-mono)]"
              style={{ color: "var(--danger)" }}
            >
              ✗ MISMATCH — the room no longer hashes to this seal.
            </p>
          )}
        </>
      )}
      {state.status === "error" && (
        <p className="audit-seal-verdict font-[family-name:var(--font-mono)]" style={{ color: "var(--danger)" }}>
          {state.message}
        </p>
      )}
      {state.status === "idle" && (
        <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
          The gateway stores no authoritative state. Recompute the seal directly from
          the Band room and confirm this packet matches the system of record.
        </p>
      )}
    </div>
  );
}

function EvidenceRow({
  term,
  value,
  tone,
  meta,
}: {
  term: string;
  value: string;
  tone: string;
  meta?: string;
}) {
  return (
    <div className="signed-evidence-row">
      <dt className="signed-evidence-term">{term}</dt>
      <dd className="signed-evidence-value">
        <span className="signed-evidence-dot" style={{ background: tone }} aria-hidden />
        <span style={{ color: tone }}>{value}</span>
        {meta && <span className="signed-evidence-meta">{meta}</span>}
      </dd>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon({ large }: { large?: boolean }) {
  const s = large ? 18 : 14;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
