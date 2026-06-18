"use client";

import { useState } from "react";
import type { StageDetail } from "@/dashboard/lib/stageDetails";
import { eventTone, eventVerb } from "@/dashboard/lib/eventStyle";
import { evidenceUrl } from "@/dashboard/lib/api";
import type { Specialist } from "@/dashboard/lib/api";
import { auditTrailBody, humanizeProse } from "@/dashboard/lib/auditFilter";
import { stageResult } from "@/dashboard/lib/casefileSchema";
import { resolveHandshakeStep, handshakeStepMarker } from "@/dashboard/lib/handshake";
import { SPECIALIST_DIRECTORY } from "@/dashboard/lib/registry";

/*
  In-card stage detail. Rendered INSIDE the Stage card (replacing the phase scene)
  when an operator clicks a stepper tab. "← Back to decision" returns to the scene.
  Same buildStageDetail data source as before.
*/
export function StageDetailCard({
  detail,
  chatId,
  specialist = null,
}: {
  detail: StageDetail;
  /** Reserved for the rich Evidence section's image/PDF URLs (Task D). */
  chatId: string | null;
  specialist?: Specialist | null;
}) {
  const tone = detail.org === "a" ? "var(--org-a)" : "var(--org-b)";
  const orgLabel = detail.org === "a" ? "Insurance Provider" : "Specialist org";
  const empty =
    detail.findings.length === 0 &&
    detail.events.length === 0 &&
    detail.handshake.length === 0;

  return (
    <div className="stage-detail" style={{ ["--stage-tone" as string]: tone }} role="region" aria-label={`${detail.label} detail`}>
      <header className="stage-detail-head">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="stage-detail-org" style={{ color: tone }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />
              {orgLabel}
            </span>
            <span className="stage-detail-status" data-status={detail.status}>
              {detail.status === "done" ? "Complete" : detail.status === "current" ? "In progress" : detail.status === "skipped" ? "Skipped" : "Not started"}
            </span>
          </div>
          <h3 className="stage-detail-title">{detail.label}</h3>
          <p className="stage-detail-blurb">{detail.blurb}</p>
        </div>
      </header>

      <div className="stage-detail-body">
        {detail.key === "evidence" ? (
          <EvidenceDetail detail={detail} chatId={chatId} />
        ) : detail.key === "recruiting" ? (
          <HandoffDetail detail={detail} />
        ) : detail.key === "investigating" ? (
          <InvestigateDetail detail={detail} specialist={specialist} />
        ) : empty ? (
          <p className="stage-detail-empty">
            {detail.status === "upcoming"
              ? "This step hasn't run yet. Findings appear here once the claim reaches it."
              : detail.status === "skipped"
                ? "This step was skipped. The claim's path didn't require it."
                : "No structured findings were recorded for this step."}
          </p>
        ) : (
          <>
            {detail.findings.map((f, i) => (
              <article key={`f-${i}`} className="stage-finding">
                <div className="stage-finding-meta">
                  <span className="stage-finding-author">{f.sender ?? detail.agent}</span>
                  {f.ts && <span className="stage-finding-time">{clock(f.ts)}</span>}
                </div>
                <p className="stage-finding-text">{f.summary}</p>
                <ResultChips result={f.result} />
              </article>
            ))}
            {detail.handshake.length > 0 && (
              <div className="stage-handshake">
                <span className="stage-sub-label">Cross-org consent</span>
                <ol className="stage-handshake-list">
                  {detail.handshake.map((h, i) => (
                    <li key={`h-${i}`}>
                      <span className="stage-handshake-step">{h.step.replace(/_/g, " ")}</span>
                      <span className="stage-handshake-text">{h.content}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {detail.events.length > 0 && (
              <div className="stage-events">
                <span className="stage-sub-label">Activity</span>
                <ul className="stage-event-list">
                  {detail.events.map((e, i) => (
                    <li key={`e-${i}`} className="stage-event">
                      <span className="stage-event-verb" style={{ color: eventTone(e.type) }}>{eventVerb(e.type)}</span>
                      <span className="stage-event-text">{e.content}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ResultChips({ result }: { result: unknown }) {
  if (!result || typeof result !== "object") return null;
  const entries = Object.entries(result as Record<string, unknown>).slice(0, 4);
  if (entries.length === 0) return null;
  return (
    <div className="stage-chips">
      {entries.map(([k, v]) => (
        <span key={k} className="stage-chip">
          <span className="stage-chip-k">{k.replace(/_/g, " ")}</span>
          <span className="stage-chip-v">{formatVal(v)}</span>
        </span>
      ))}
    </div>
  );
}
function formatVal(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x).replace(/_/g, " ")).join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}
function clock(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
type Obs = { filename?: string; severity_band?: string; consistent_with_narrative?: string; narrative_reason?: string; confidence?: string };

function EvidenceDetail({ detail, chatId }: { detail: StageDetail; chatId: string | null }) {
  const result = (detail.findings[0]?.result ?? {}) as { observations?: Obs[]; signals?: string[]; vision_model?: string; pdf_excerpt?: string };
  const obs = result.observations ?? [];
  const signals = result.signals ?? [];
  const model = result.vision_model?.split("/").pop() ?? "vision";
  const isPdf = (f?: string) => (f ?? "").toLowerCase().endsWith(".pdf");
  const photoCount = obs.filter((o) => !isPdf(o.filename)).length;
  // PDFs aren't vision observations — their extracted text lands in `pdf_excerpt`.
  // Count any PDF observations plus the extracted supporting document.
  const docCount = obs.filter((o) => isPdf(o.filename)).length + (result.pdf_excerpt ? 1 : 0);
  return (
    <>
      <div className="ev-summary">
        <span className="ev-sum-badge">{photoCount} photo{photoCount === 1 ? "" : "s"} · {docCount} doc{docCount === 1 ? "" : "s"}</span>
        <span className="ev-sum-txt">
          {signals.length ? (
            <>Flagged {signals.map((s) => <b key={s} style={{ color: "var(--danger)" }}>{s.replace(/_/g, " ")} </b>)}</>
          ) : (
            "No concern signals. Evidence consistent with the claim."
          )}
        </span>
      </div>
      {obs.length === 0 && <p className="stage-detail-empty">No image evidence on this claim.</p>}
      {obs.map((o, i) => (
        <EvidenceItem key={`${o.filename ?? "obs"}-${i}`} obs={o} chatId={chatId} model={model} isPdf={isPdf(o.filename)} />
      ))}
      {result.pdf_excerpt && (
        <div className="ev-item">
          <div className="ev-itemhead"><span className="ev-fn">document excerpt</span></div>
          <p className="ev-reason" style={{ margin: "12px 14px" }}>{String(result.pdf_excerpt).slice(0, 400)}</p>
        </div>
      )}
    </>
  );
}

/** One evidence observation: media (image or PDF preview) left, analysis right.
 *  Falls back to an "image unavailable" placeholder both when the URL can't be
 *  built (no chatId/filename) AND when the image 404s at runtime (onError). */
function EvidenceItem({ obs: o, chatId, model, isPdf: pdf }: { obs: Obs; chatId: string | null; model: string; isPdf: boolean }) {
  const [failed, setFailed] = useState(false);
  const vsn = o.consistent_with_narrative;
  const vsnTone = vsn === "no" ? "var(--danger)" : vsn === "yes" ? "var(--success)" : "var(--text-soft)";
  const src = chatId && o.filename ? evidenceUrl(chatId, o.filename, { preview: pdf }) : null;
  return (
    <div className="ev-item">
      <div className="ev-itemhead">
        <span className="ev-ic" style={pdf ? { background: "color-mix(in oklch, var(--danger) 16%, transparent)", color: "var(--danger)" } : undefined}>{pdf ? "PDF" : "IMG"}</span>
        <span className="ev-fn">{o.filename ?? "evidence"}</span>
        <span className="ev-model">{model}</span>
      </div>
      <div className="ev-cols">
        <div className={`ev-media${pdf ? " ev-media-pdf" : ""}`}>
          {src && !failed ? (
            <img src={src} alt={o.filename ?? "evidence"} loading="lazy" onError={() => setFailed(true)} />
          ) : (
            <span className="ev-na">image unavailable</span>
          )}
          {pdf && <span className="ev-prev">PDF · pg 1</span>}
        </div>
        <div>
          <div className="ev-stats">
            <div className="ev-stat"><span className="k">severity</span><span className="v" style={{ color: "var(--warning)" }}>{o.severity_band ?? "-"}</span></div>
            <div className="ev-stat"><span className="k">vs narrative</span><span className="v" style={{ color: vsnTone }}>{vsn ?? "-"}</span></div>
            <div className="ev-stat"><span className="k">confidence</span><span className="v" style={{ color: "var(--metric)" }}>{o.confidence ?? "-"}</span></div>
          </div>
          {o.narrative_reason && <p className="ev-reason">{o.narrative_reason}</p>}
        </div>
      </div>
    </div>
  );
}

const HANDOFF_DIR = SPECIALIST_DIRECTORY;
const HS_STEPS: [string, string][] = [["request", "Request"], ["consent", "Consent"], ["approved", "Approved"], ["joined", "Joined"]];

function InvestigateDetail({
  detail,
  specialist,
}: {
  detail: StageDetail;
  specialist: Specialist | null;
}) {
  const recruiting = detail.findings.find((f) => f.stage === "recruiting");
  const verdict = detail.findings.find(
    (f) => f.stage === "specialist_verdict" || f.stage === "fraud_verdict",
  );
  // Use the entry's own stage so the legacy "fraud_verdict" alias still resolves
  // its result (stageResult only returns the result when entry.stage === stage).
  const vr = stageResult(verdict, verdict?.stage === "fraud_verdict" ? "fraud_verdict" : "specialist_verdict");
  const timeline = detail.events
    .map((e) => ({ entry: e, body: auditTrailBody(e) }))
    .filter((row) => row.body);
  const prose = timeline.map((row) => row.body).join(" ");
  const rec = parseRecommendation(
    vr.recommendation ?? specialist?.recommendation,
    [verdict?.summary, prose].filter(Boolean).join(" "),
  );
  const recTone = rec === "approve" ? "var(--success)" : rec === "deny" ? "var(--danger)" : "var(--text-soft)";
  const explanation = humanizeProse(
    vr.explanation || specialist?.explanation || verdict?.summary || prose,
  );
  const risk = vr.risk ?? specialist?.risk;
  const coordinatorOnly = !verdict && !specialist?.name;

  if (timeline.length === 0 && !recruiting && !verdict && !specialist?.recommendation) {
    return (
      <p className="stage-detail-empty">
        {detail.status === "skipped"
          ? "No specialist was recruited. The Case Coordinator handled this claim."
          : "Waiting for the specialist verdict…"}
      </p>
    );
  }

  return (
    <>
      {recruiting && (
        <div className="inv-recruit">
          <span className="inv-recruit-kicker">Recruitment</span>
          <p className="inv-recruit-body">{recruiting.summary}</p>
        </div>
      )}
      {(verdict || specialist?.recommendation || rec) && (
        <article className="inv-verdict">
          <div className="inv-verdict-head">
            <span className="inv-verdict-kicker">
              {coordinatorOnly
                ? "Case Coordinator · recommendation"
                : specialist?.name
                  ? `${specialist.name} · verdict`
                  : "Specialist verdict"}
            </span>
            {verdict?.ts && <span className="inv-verdict-time">{clock(verdict.ts)}</span>}
          </div>
          {rec && (
            <p className="inv-verdict-call" style={{ color: recTone }}>
              {rec === "approve" ? "Approve" : "Deny"}
            </p>
          )}
          <div className="inv-verdict-meta">
            {risk && <span className="inv-pill" data-tone="risk">{String(risk).replace(/_/g, " ")} risk</span>}
            {typeof vr.confidence === "number" && (
              <span className="inv-pill">{Math.round(vr.confidence * 100)}% confidence</span>
            )}
            {(vr.specialty || specialist?.tag) && (
              <span className="inv-pill">#{vr.specialty ?? specialist?.tag}</span>
            )}
            {specialist?.framework && <span className="inv-pill">{specialist.framework}</span>}
            {coordinatorOnly && (
              <span className="inv-pill">No specialist joined</span>
            )}
          </div>
          {explanation && !coordinatorOnly && <p className="inv-verdict-body">{explanation}</p>}
          {coordinatorOnly && (
            <p className="inv-verdict-body">
              Unable to recruit a domain specialist. The Case Coordinator scored the claim and drafted this recommendation for human review.
            </p>
          )}
        </article>
      )}
      {timeline.length > 0 && (
        <div className="stage-events">
          <span className="stage-sub-label">Investigation trail</span>
          <ul className="stage-event-list">
            {timeline.map(({ entry, body }, i) => (
              <li key={i} className="stage-event">
                <div className="stage-event-head">
                  <span className="stage-event-verb" style={{ color: eventTone(entry.type) }}>
                    {eventVerb(entry.type)}
                  </span>
                  {entry.sender && <span className="stage-event-sender">{entry.sender}</span>}
                  {entry.ts && <span className="stage-event-time">{clock(entry.ts)}</span>}
                </div>
                <span className="stage-event-text">{body}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function parseRecommendation(
  explicit: unknown,
  summary?: string,
): "approve" | "deny" | null {
  const raw = String(explicit ?? "").toLowerCase();
  if (raw === "approve" || raw === "deny") return raw;
  const s = (summary ?? "").toLowerCase();
  const recMatch = s.match(/\brecommendation is to (approve|deny)\b/);
  if (recMatch) return recMatch[1] as "approve" | "deny";
  const labeled = s.match(/\brecommendation:\s*(approve|deny)\b/);
  if (labeled) return labeled[1] as "approve" | "deny";
  if (/\bdeny\b/.test(s) || /\breject\b/.test(s)) return "deny";
  if (/\bapprove\b/.test(s)) return "approve";
  return null;
}

// The specialist directory, sourced from the Specialist Registry — one roster shared
// with the recruiting scene, no longer a second hardcoded copy.
function HandoffDetail({ detail }: { detail: StageDetail }) {
  const rec = (detail.findings[0]?.result ?? {}) as { recruited_name?: string; recruited_handle?: string; score?: number; capability_tag?: string };
  const summary = detail.findings[0]?.summary ?? "";
  const handle = (rec.recruited_handle ?? rec.recruited_name ?? "").toLowerCase();
  const chosen = HANDOFF_DIR.find((d) => handle.includes(d.type)) ?? (rec.capability_tag ? HANDOFF_DIR.find((d) => d.tag === rec.capability_tag) : undefined);
  const step = resolveHandshakeStep(detail.handshake, detail.findings);
  return (
    <>
      <div className="ho-headline">
        <span className="ho-ic">⇄</span>
        <div>
          <div className="ho-big">
            {chosen ? <>Recruited <span style={{ color: "var(--accent-strong)" }}>{chosen.role}</span> from {chosen.org}</> : "No specialist needed. Insurance Provider decided"}
          </div>
          <div className="ho-sub">{summary || (chosen ? `Matched #${chosen.tag}, consent approved, joined the room.` : "Score below threshold. Decided from coverage directly.")}</div>
        </div>
      </div>
      <div className="ho-dir">
        {HANDOFF_DIR.map((d) => {
          const isChosen = chosen?.type === d.type;
          return (
            <div key={d.type} className={`ho-card${isChosen ? " chosen" : chosen ? " dim" : ""}`}>
              <div className="ho-org">{d.org}</div>
              <div className="ho-role">{d.role}</div>
              <div className="ho-tag">#{d.tag}</div>
              {isChosen && step >= 3 && <span className="ho-mark join">✓ joined the room</span>}
              {isChosen && step < 3 && <span className="ho-mark">▲ matched</span>}
            </div>
          );
        })}
      </div>
      {chosen && (
        <div className="ho-steps">
          {HS_STEPS.map(([k, label], i) => (
            <div key={k} className={`ho-step${i <= step ? " on" : ""}${i < step ? " adv" : ""}`}>
              <span className="n">{handshakeStepMarker(i, step)}</span>
              <span className="sl">{label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
