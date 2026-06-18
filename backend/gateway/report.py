"""Rebuild a branded case-report PDF from Band context (gateway is not authoritative)."""

from __future__ import annotations

import io
import json
import logging
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from agents.shared.casefile import parse_casefile_entries, resolve_mentions
from agents.shared.config import state_dir
from agents.shared.evidence import preset_attachment_resolver, upload_attachment_resolver
from agents.shared.scoring import SIGNAL_WEIGHTS, signal_source

logger = logging.getLogger("arbiter.report")

GOLDEN_CLAIM_DIR = Path(__file__).resolve().parents[1] / "seed" / "golden_claim"

# Brand palette translated from the UI's OKLCH tokens to fixed print RGB.
BRAND = colors.HexColor("#e8772e")       # accent
INK = colors.HexColor("#0d0e12")         # near-black canvas
PAPER = colors.HexColor("#ffffff")
MUTED = colors.HexColor("#5b5b66")
SUCCESS = colors.HexColor("#1f9d57")
DANGER = colors.HexColor("#d23b32")
HAIRLINE = colors.HexColor("#d8d8de")

MAX_IMG_W = 2.3 * inch
MAX_IMG_H = 1.9 * inch


def _esc(text: Any) -> str:
    """Escape dynamic text for ReportLab's mini-XML Paragraph parser."""
    return escape(str(text or ""))


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _find_stage(casefile: list[dict[str, Any]], stage: str) -> dict[str, Any] | None:
    for entry in reversed(casefile):
        if entry.get("stage") == stage:
            return entry
    return None


# Audit-ledger event vocabulary — mirrors the dashboard's eventStyle.ts so the PDF
# and the live timeline read the same. Raw Band types ("task"/"tool_call") look
# like machine noise in a formal report; these map them to a human verb + a print
# color (darkened from the UI tokens for legibility at 8pt on a light page).
_EVENT_VERB = {
    "text": "Message",
    "task": "Event",
    "thought": "Reasoning",
    "tool_call": "Tool call",
    "tool_result": "Result",
    "error": "Error",
}
_EVENT_HEX = {
    "text": "#5b5b66",        # muted
    "task": "#b85a18",        # brand orange, darkened for small text
    "thought": "#6b6b76",     # faint gray
    "tool_call": "#2f5fb0",   # info blue
    "tool_result": "#1a7d46", # success green
    "error": "#c0322a",       # danger red
}


def _fmt_ts(ts: Any) -> str:
    """ISO-8601 → compact 'Mon DD · HH:MM:SS' (UTC), best-effort.

    Room timestamps arrive like '2026-06-15T10:00:00Z'. A claim runs within a tight
    window, so a compact month-day + time reads far cleaner than the raw ISO string.
    Falls back to the (truncated) raw value if it doesn't parse.
    """
    s = str(ts or "").strip()
    if not s:
        return "—"
    try:
        from datetime import datetime

        # fromisoformat pre-3.11 rejects a trailing 'Z'; normalize it.
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%b %d · %H:%M:%S")
    except (ValueError, TypeError):
        return s[:16]


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    body = ParagraphStyle("Body", parent=base["Normal"], fontSize=9.5, leading=14, spaceAfter=6)
    return {
        "h1": ParagraphStyle("H1", parent=base["Heading1"], fontSize=20, textColor=PAPER, spaceAfter=2),
        "h1sub": ParagraphStyle("H1Sub", parent=base["Normal"], fontSize=9, textColor=BRAND, spaceAfter=0),
        "section": ParagraphStyle("Section", parent=base["Heading2"], fontSize=13,
                                  textColor=INK, spaceBefore=14, spaceAfter=6),
        "body": body,
        "mono": ParagraphStyle("Mono", parent=body, fontName="Courier", fontSize=8.5, textColor=MUTED),
        "small": ParagraphStyle("Small", parent=body, fontSize=8, textColor=MUTED, spaceAfter=2),
        # Audit-ledger cell styles: a mono timestamp, a bold sender, and the event body.
        "auditTime": ParagraphStyle("AuditTime", parent=body, fontName="Courier",
                                    fontSize=7.5, textColor=MUTED, spaceAfter=0, leading=11),
        "auditSender": ParagraphStyle("AuditSender", parent=body, fontSize=8,
                                      textColor=INK, spaceAfter=1, leading=11),
        "auditBody": ParagraphStyle("AuditBody", parent=body, fontSize=8,
                                    textColor=colors.HexColor("#3a3a44"), spaceAfter=0, leading=11),
        # White header label for the ink-backed audit-table header row.
        "auditHead": ParagraphStyle("AuditHead", parent=body, fontSize=8,
                                    textColor=PAPER, spaceAfter=0, leading=11),
        "decision": ParagraphStyle("Decision", parent=base["Heading1"], fontSize=26, alignment=TA_CENTER),
        "decsub": ParagraphStyle("DecSub", parent=base["Normal"], fontSize=8.5,
                                 textColor=MUTED, alignment=TA_CENTER),
    }


def evidence_resolver(chat_id: str):
    """Same attachment chain the Evidence Analyst uses: uploads first, golden fallback.

    Builds the per-claim upload path WITHOUT creating it — this is a read-only GET,
    so it must not leave an empty ``uploads/<chat_id>/`` dir behind for preset claims
    that uploaded nothing. ``upload_attachment_resolver`` already tolerates a missing
    dir (it ``is_file()``-checks each name and falls back to golden).
    """
    golden = preset_attachment_resolver(GOLDEN_CLAIM_DIR)
    try:
        upload_path = state_dir() / "uploads" / Path(str(chat_id)).name
        return upload_attachment_resolver(upload_path, golden)
    except Exception:  # noqa: BLE001 — upload dir is best-effort; golden still works
        return golden


def _image_flowable(resolver, filename: str) -> Image | None:
    """Resolve + downscale an evidence image into a ReportLab flowable, or None.

    Never raises: a missing/corrupt/oversized image returns None so the caller
    renders a text note instead of 500-ing the whole report.
    """
    try:
        raw = resolver(filename)
        if not raw:
            return None
        from PIL import Image as PILImage

        img = PILImage.open(io.BytesIO(raw))
        img = img.convert("RGB")
        w, h = img.size
        scale = min(MAX_IMG_W / w, MAX_IMG_H / h, 1.0)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=80)
        out.seek(0)
        return Image(out, width=w * scale, height=h * scale)
    except Exception as exc:  # noqa: BLE001 — degrade to text note, never crash
        logger.warning("report image %s failed: %s", filename, exc)
        return None


def _brand_header(story: list[Any], styles: dict[str, ParagraphStyle], generated_at: str) -> None:
    """Dark cover band: hub glyph + wordmark + document title."""
    from reportlab.platypus import Flowable

    class _Glyph(Flowable):
        def __init__(self, s: float = 22):
            super().__init__()
            self.width = s
            self.height = s

        def draw(self):
            c = self.canv
            c.setStrokeColor(BRAND)
            c.setFillColor(BRAND)
            c.setLineWidth(1.6)
            c.setLineCap(1)
            c.setLineJoin(1)
            sx = self.width / 24.0
            sy = self.height / 24.0

            def X(v):
                return v * sx

            def Y(v):
                return self.height - v * sy  # SVG y-down -> PDF y-up

            c.line(X(5), Y(6.5), X(9.7), Y(10.4))
            c.line(X(5), Y(17.5), X(9.7), Y(13.6))
            c.line(X(19.3), Y(12), X(15.5), Y(12))
            p = c.beginPath()
            p.moveTo(X(12), Y(8.5))
            p.lineTo(X(15.5), Y(12))
            p.lineTo(X(12), Y(15.5))
            p.lineTo(X(8.5), Y(12))
            p.close()
            c.drawPath(p, stroke=1, fill=0)
            for cx, cy in ((5, 6.5), (5, 17.5), (19.3, 12)):
                c.circle(X(cx), Y(cy), 1.4 * sx, stroke=0, fill=1)

    title_cell = [
        Paragraph("CLAIM<font color='#e8772e'>ARBITER</font>", styles["h1"]),
        Paragraph("Claim Adjudication Report", styles["h1sub"]),
    ]
    header = Table(
        [[_Glyph(26), title_cell]],
        colWidths=[0.5 * inch, None],
    )
    header.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), INK),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(header)
    if generated_at:
        story.append(Spacer(1, 4))
        story.append(Paragraph(f"Generated {_esc(generated_at)}", styles["small"]))


def _decision_banner(story: list[Any], styles: dict[str, ParagraphStyle],
                     signoff: dict[str, Any] | None) -> None:
    if not signoff:
        return
    res = _as_dict(signoff.get("result"))
    decision = str(res.get("decision") or signoff.get("decision") or "").lower()
    if decision not in {"approve", "deny"}:
        return
    approved = decision == "approve"
    tone = SUCCESS if approved else DANGER
    tone_hex = "#1f9d57" if approved else "#d23b32"
    word = "APPROVED" if approved else "DENIED"
    authored = res.get("authored_by", "agent_on_behalf_of_human")
    prov = (
        "Signed by the Human Reviewer · in the Band audit trail"
        if authored == "human"
        else "Recorded on behalf of the Human Reviewer (Band Human API unavailable) · in the Band audit trail"
    )
    cell = [
        Paragraph(f"<font color='{tone_hex}'>{word}</font>", styles["decision"]),
        Paragraph(_esc(prov), styles["decsub"]),
    ]
    note = res.get("note") or ""
    if note:
        cell.append(Paragraph(f"<i>“{_esc(note)}”</i>", styles["decsub"]))
    banner = Table([[cell]], colWidths=[None])
    banner.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 1.5, tone),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#faf7f2")),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(Spacer(1, 10))
    story.append(banner)


def _kv_table(rows: list[tuple[str, str]], small: ParagraphStyle) -> Table:
    data = [[Paragraph(f"<b>{_esc(k)}</b>", small), Paragraph(_esc(v), small)] for k, v in rows]
    t = Table(data, colWidths=[1.6 * inch, None])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.4, HAIRLINE),
                           ("TOPPADDING", (0, 0), (-1, -1), 4),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    return t


def build_case_report_pdf(chat_id: str, messages: list[dict[str, Any]], generated_at: str = "") -> bytes:
    """Render a branded ReportLab PDF from Band messages."""
    casefile = parse_casefile_entries(messages)
    styles = _styles()
    resolver = evidence_resolver(chat_id)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, topMargin=0.6 * inch,
                            bottomMargin=0.7 * inch, leftMargin=0.7 * inch, rightMargin=0.7 * inch)
    story: list[Any] = []

    _brand_header(story, styles, generated_at)
    story.append(Paragraph(f"Band room: {_esc(chat_id)}", styles["small"]))

    signoff = _find_stage(casefile, "signoff")
    _decision_banner(story, styles, signoff)

    intake = _find_stage(casefile, "intake")
    if intake:
        story.append(Paragraph("Claim summary", styles["section"]))
        ires = _as_dict(intake.get("result"))
        rows = []
        if ires.get("claim_id") is not None:
            rows.append(("Claim ID", f"#{ires.get('claim_id')}"))
        if ires.get("domain"):
            rows.append(("Domain", str(ires.get("domain"))))
        if rows:
            story.append(_kv_table(rows, styles["small"]))
        if intake.get("summary"):
            story.append(Paragraph(_esc(intake.get("summary")), styles["body"]))

    coverage = _find_stage(casefile, "coverage")
    if coverage:
        story.append(Paragraph("Coverage", styles["section"]))
        cres = _as_dict(coverage.get("result"))
        covered = cres.get("covered")
        word = "Excluded" if covered is False else "Valid" if covered is True else "—"
        rows = [("Decision", word)]
        if cres.get("policy"):
            rows.append(("Policy", str(cres.get("policy"))))
        if cres.get("deductible") is not None:
            rows.append(("Deductible", f"${cres.get('deductible')}"))
        story.append(_kv_table(rows, styles["small"]))
        if coverage.get("summary"):
            story.append(Paragraph(_esc(coverage.get("summary")), styles["body"]))

    evidence = _find_stage(casefile, "evidence_analysis")
    if evidence:
        story.append(Paragraph("Evidence analysis", styles["section"]))
        eres = _as_dict(evidence.get("result"))
        model = str(eres.get("vision_model", "Featherless vision"))
        story.append(Paragraph(f"Vision model: <i>{_esc(model)}</i>", styles["small"]))
        observations = [o for o in (eres.get("observations") or []) if isinstance(o, dict)]
        if not observations:
            story.append(Paragraph("No image evidence on this claim.", styles["body"]))
        for obs in observations:
            consistent = str(obs.get("consistent_with_narrative", "—"))
            tone_hex = "#d23b32" if consistent == "no" else "#1f9d57" if consistent == "yes" else "#5b5b66"
            analysis = [
                Paragraph(f"<b>{_esc(obs.get('filename', '?'))}</b>", styles["small"]),
                Paragraph(
                    f"Severity: {_esc(obs.get('severity_band', '—'))} · "
                    f"<font color='{tone_hex}'>vs narrative: {_esc(consistent)}</font>",
                    styles["small"],
                ),
                Paragraph(f"Location: {_esc(obs.get('damage_location', '—'))} · "
                          f"Confidence: {_esc(obs.get('confidence', '—'))}", styles["small"]),
            ]
            if obs.get("narrative_reason"):
                analysis.append(Paragraph(f"<i>{_esc(obs.get('narrative_reason'))}</i>", styles["small"]))
            img = _image_flowable(resolver, str(obs.get("filename", "")))
            left = img if img is not None else Paragraph("<i>(image unavailable)</i>", styles["small"])
            row = Table([[left, analysis]], colWidths=[MAX_IMG_W + 6, None])
            row.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                                     ("BOX", (0, 0), (-1, -1), 0.5, HAIRLINE),
                                     ("LEFTPADDING", (0, 0), (-1, -1), 6),
                                     ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                                     ("TOPPADDING", (0, 0), (-1, -1), 6),
                                     ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
            story.append(Spacer(1, 6))
            story.append(row)
        signals = eres.get("signals") or []
        if signals:
            story.append(Spacer(1, 8))
            data = [["Signal", "Weight", "Source"]]
            for sig in signals:
                data.append([_esc(sig), str(SIGNAL_WEIGHTS.get(sig, "?")), signal_source(sig)])
            t = Table(data, colWidths=[2.4 * inch, 1 * inch, 1.2 * inch])
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK),
                                   ("TEXTCOLOR", (0, 0), (-1, 0), PAPER),
                                   ("GRID", (0, 0), (-1, -1), 0.4, HAIRLINE),
                                   ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                                   ("TOPPADDING", (0, 0), (-1, -1), 4),
                                   ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
            story.append(t)
        excerpt = eres.get("pdf_excerpt")
        if excerpt:
            story.append(Spacer(1, 6))
            story.append(Paragraph("Document excerpt", styles["small"]))
            story.append(Paragraph(_esc(str(excerpt)[:1200]), styles["mono"]))

    verdict = _find_stage(casefile, "specialist_verdict") or _find_stage(casefile, "fraud_verdict")
    if verdict:
        story.append(Paragraph("Specialist verdict", styles["section"]))
        # specialist_verdict is sibling-bearing: recommendation / explanation /
        # specialty / risk live at the top of metadata, which parse_casefile_entries
        # surfaces under "result" (it falls back to the whole metadata dict). Any of
        # the three domains (property / medical / legal) lands here; missing fields
        # (legacy verdicts) simply render nothing.
        vres = _as_dict(verdict.get("result"))
        rows: list[tuple[str, str]] = []
        if vres.get("specialty"):
            rows.append(("Specialty", str(vres.get("specialty"))))
        rec = str(vres.get("recommendation") or "").lower()
        if rec in {"approve", "deny"}:
            rows.append(("Recommendation", rec.upper()))
        if vres.get("risk"):
            rows.append(("Risk", str(vres.get("risk"))))
        if rows:
            story.append(_kv_table(rows, styles["small"]))
        explanation = vres.get("explanation")
        if explanation:
            story.append(Paragraph(_esc(str(explanation)), styles["body"]))
        if verdict.get("summary"):
            story.append(Paragraph(_esc(verdict.get("summary", "")), styles["body"]))

    conflict = _find_stage(casefile, "conflict")
    if conflict:
        story.append(Paragraph("Conflict &amp; resolution", styles["section"]))
        story.append(Paragraph(_esc(conflict.get("summary", "")), styles["body"]))
        for reason in _as_dict(conflict.get("result")).get("reasons") or []:
            story.append(Paragraph(f"· {_esc(reason)}", styles["body"]))

    escalation = _find_stage(casefile, "escalation")
    if escalation:
        story.append(Paragraph("Case Coordinator recommendation", styles["section"]))
        story.append(Paragraph(_esc(escalation.get("summary", "")), styles["body"]))

    _audit_ledger(story, styles, messages)
    _audit_seal_footer(story, styles, chat_id, messages)

    doc.build(story)
    return buf.getvalue()


def _audit_seal_footer(story: list[Any], styles: dict[str, ParagraphStyle],
                       chat_id: str, messages: list[dict[str, Any]]) -> None:
    """Print the tamper-evident seal: a SHA-256 over the canonicalized transcript.

    Band is the system of record; this gateway stores nothing authoritative. Anyone
    can recompute this hash from a fresh Band pull (GET /api/claims/<id>/verify) and
    confirm the packet matches the room — delete the gateway and the seal still holds.
    """
    from gateway.audit_seal import compute_seal

    seal = compute_seal(messages)
    story.append(Spacer(1, 12))
    box = Table([[
        Paragraph(
            f"<b>Audit seal</b> &nbsp; <font face='Courier'>{_esc(seal)}</font><br/>"
            f"SHA-256 over {len(messages)} ordered Band events. Verify independently: "
            f"<font face='Courier'>GET /api/claims/{_esc(chat_id)}/verify?seal=…</font> "
            f"recomputes this hash from Band. The gateway stores no authoritative state.",
            styles["small"],
        )
    ]], colWidths=[None])
    box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, HAIRLINE),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#faf7f2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(box)


def _audit_ledger(story: list[Any], styles: dict[str, ParagraphStyle],
                  messages: list[dict[str, Any]]) -> None:
    """Render the room transcript as a structured audit ledger, not a log dump.

    A four-column table — When / Actor / Event / Detail — with a header row that
    repeats across page breaks, zebra striping for row scanning, and a colored
    event-type chip per row (mapped from the raw Band message_type to a human verb).
    Mentions are resolved so "@[[uuid]]" reads as "@Case Coordinator". The last 40
    events are shown (a claim rarely exceeds that), newest last, matching the
    chronological order of the rest of the report; a note flags any truncation.
    """
    story.append(Paragraph("Audit timeline", styles["section"]))

    recent = messages[-40:]
    dropped = len(messages) - len(recent)
    if not recent:
        story.append(Paragraph("No room activity recorded.", styles["small"]))
        return
    if dropped > 0:
        story.append(Paragraph(
            f"Showing the {len(recent)} most recent events ({dropped} earlier "
            f"omitted). Full history lives in the Band room.", styles["small"]))

    header = [
        Paragraph("<b>When</b>", styles["auditHead"]),
        Paragraph("<b>Actor</b>", styles["auditHead"]),
        Paragraph("<b>Event</b>", styles["auditHead"]),
        Paragraph("<b>Detail</b>", styles["auditHead"]),
    ]
    rows: list[list[Any]] = [header]
    type_styles: list[tuple] = []  # per-row event-type color, applied after build

    for i, msg in enumerate(recent):
        mtype = str(msg.get("message_type", "text") or "text")
        verb = _EVENT_VERB.get(mtype, mtype.replace("_", " ").title())
        hexc = _EVENT_HEX.get(mtype, "#5b5b66")
        sender = msg.get("sender_name") or "system"
        content = resolve_mentions(msg.get("content", ""), msg.get("metadata"))
        # Collapse whitespace so a multi-line agent message stays one tidy cell.
        detail = " ".join(str(content).split())[:300]
        rows.append([
            Paragraph(_fmt_ts(msg.get("inserted_at")), styles["auditTime"]),
            Paragraph(_esc(sender), styles["auditSender"]),
            Paragraph(f"<font color='{hexc}'><b>{_esc(verb)}</b></font>", styles["auditBody"]),
            Paragraph(_esc(detail) or "<i>—</i>", styles["auditBody"]),
        ])
        # +1 because row 0 is the header.
        type_styles.append(("LINEBEFORE", (2, i + 1), (2, i + 1), 1.5, colors.HexColor(hexc)))

    table = Table(rows, colWidths=[0.95 * inch, 1.15 * inch, 0.8 * inch, None], repeatRows=1)
    style = [
        # Header label color comes from the auditHead Paragraph style (white); the
        # ink fill is set here behind it.
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, HAIRLINE),
    ]
    # Zebra striping on the body rows for easy left-to-right scanning.
    for r in range(1, len(rows)):
        if r % 2 == 0:
            style.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f6f6f8")))
    style.extend(type_styles)
    table.setStyle(TableStyle(style))
    story.append(table)
