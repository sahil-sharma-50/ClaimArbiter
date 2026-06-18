"""Evidence analysis engine — vision perceives, Python decides.

Pure analysis logic with no Band coupling. The Evidence Analyst agent calls
``analyze()``; unit tests exercise ``derive_signals`` directly.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

from agents.shared.providers import featherless_vision_client, featherless_vision_model_name

logger = logging.getLogger("arbiter.evidence")

SeverityBand = Literal["none", "minor", "moderate", "severe"]
Consistency = Literal["yes", "no", "unclear"]
Confidence = Literal["low", "medium", "high"]
Domain = Literal["property", "medical", "legal"]

PDF_TEXT_BUDGET = 4000
MAX_IMAGE_PX = 1024
VISION_TIMEOUT = 90.0

# Default domain when a claim has SOME signal but classification ties. "property" is
# the demo's hero domain and mirrors registry.DEFAULT_DOMAIN. Note this is only a
# tie-breaker: when NOTHING points anywhere classify_domain returns None (no domain),
# and the Case Coordinator then decides the claim itself with no specialist.
DEFAULT_DOMAIN: Domain = "property"

# Keyword vocabularies for deterministic domain classification. Ordered most- to
# least-specific within each domain; matching is whole-word so "car" doesn't fire
# on "scarf". These intentionally mirror the language in seed/golden_claim/*.json
# and the kinds of narratives the custom-claim form collects.
_DOMAIN_KEYWORDS: dict[Domain, tuple[str, ...]] = {
    "medical": (
        "injury", "injured", "treatment", "medical", "patient", "diagnosis",
        "hospital", "clinic", "provider", "physician", "doctor", "surgery",
        "mri", "x-ray", "xray", "imaging", "physical therapy", "therapy",
        "cervical", "lumbar", "neck strain", "soft-tissue", "soft tissue",
        "billed", "billing", "procedure", "npi", "icd", "cpt", "er evaluation",
        "emergency room", "rehabilitation", "fracture", "sprain", "whiplash",
    ),
    "property": (
        "water damage", "water", "flood", "flooding", "fire", "smoke", "roof",
        "structural", "subfloor", "drywall", "cabinet", "cabinets", "moisture",
        "mold", "leak", "burst", "pipe", "plumbing", "plumber", "supply-line",
        "supply line", "dwelling", "property", "premises", "hvac", "ceiling",
        "foundation", "basement", "storm", "hail", "wind", "kitchen", "bathroom",
        "apartment", "rental", "tenant", "landlord", "infestation", "bed bug",
        "bed bugs", "bedbug",
    ),
    "legal": (
        "attorney", "lawyer", "counsel", "litigation", "lawsuit", "court",
        "legal fees", "legal fee", "legal costs", "legal cost", "settlement",
        "defense", "plaintiff", "defendant", "liability", "deposition",
        "subpoena", "damages awarded", "legal proceeding", "proceeding",
        "hearing", "filing fee", "filing fees", "retainer", "counterclaim",
        "judgment", "claimant's counsel", "outside counsel",
    ),
}

VISION_PROMPT = """You are an insurance evidence analyst reviewing a single photo \
submitted with a claim. The claim may be property, medical, or legal — describe what \
the image actually shows.

Given the claim context below, return ONLY a JSON object (no markdown fences) with:
- damage_location: free text describing where damage/condition appears (e.g. "front
  bumper", "kitchen subfloor", "cervical x-ray")
- severity_band: one of none, minor, moderate, severe
- consistent_with_narrative: yes, no, or unclear
- narrative_reason: one short sentence explaining consistent_with_narrative
- confidence: low, medium, or high

Claim context:
{claim_context}

Respond with JSON only."""


class ImageObservation(BaseModel):
    filename: str
    damage_location: str = ""
    severity_band: SeverityBand = "none"
    consistent_with_narrative: Consistency = "unclear"
    narrative_reason: str = ""
    confidence: Confidence = "low"
    error: str | None = None


class EvidenceReport(BaseModel):
    observations: list[ImageObservation] = Field(default_factory=list)
    pdf_excerpt: str = ""
    signals: list[str] = Field(default_factory=list)
    # None when the claim classifies to NO domain (the Case Coordinator then decides
    # the claim itself, with no specialist). Otherwise one of property/medical/legal.
    suggested_domain: str | None = "property"
    vision_model: str = ""
    degraded: bool = False


def extract_pdf_text(path: Path) -> str:
    """Extract text from a PDF; render page 1 as image when scanned (empty text)."""
    import fitz  # PyMuPDF

    doc = fitz.open(path)
    try:
        parts: list[str] = []
        for page in doc:
            parts.append(page.get_text())
        text = "\n".join(parts).strip()
        if text:
            return text[:PDF_TEXT_BUDGET]
        if len(doc) == 0:
            return ""
        # Scanned PDF — note for downstream; vision on rendered page is deferred in v1.
        pix = doc[0].get_pixmap(dpi=150)
        logger.info("PDF %s has no extractable text (scanned); excerpt empty", path.name)
        return f"[scanned document {path.name}; no OCR in v1]"
    finally:
        doc.close()


def _resize_image(image_bytes: bytes) -> tuple[bytes, str]:
    from PIL import Image

    img = Image.open(io.BytesIO(image_bytes))
    fmt = (img.format or "JPEG").upper()
    mime = "image/jpeg" if fmt in {"JPEG", "JPG"} else f"image/{fmt.lower()}"
    img = img.convert("RGB")
    w, h = img.size
    longest = max(w, h)
    if longest > MAX_IMAGE_PX:
        scale = MAX_IMAGE_PX / longest
        img = img.resize((int(w * scale), int(h * scale)), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue(), "image/jpeg"


def _parse_vision_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    return json.loads(text)


def _claim_context(claim: dict[str, Any]) -> str:
    damage = claim.get("damage") or {}
    return json.dumps(
        {
            "narrative": claim.get("narrative", ""),
            "damage_description": damage.get("description", ""),
            "loss_amount": claim.get("loss_amount"),
            "estimated_repair": damage.get("estimated_repair"),
        },
        indent=2,
    )


def analyze_image(image_bytes: bytes, claim_context: str, *, filename: str = "photo") -> ImageObservation:
    """Qualitative vision read via Featherless open-weight VL model."""
    model = featherless_vision_model_name()
    try:
        resized, mime = _resize_image(image_bytes)
        b64 = base64.b64encode(resized).decode("ascii")
        data_url = f"data:{mime};base64,{b64}"
        client = featherless_vision_client()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": VISION_PROMPT.format(claim_context=claim_context)},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            max_tokens=400,
            temperature=0,
            timeout=VISION_TIMEOUT,
        )
        raw = (response.choices[0].message.content or "").strip()
        data = _parse_vision_json(raw)
        return ImageObservation(
            filename=filename,
            damage_location=str(data.get("damage_location", "")),
            severity_band=_coerce_severity(data.get("severity_band")),
            consistent_with_narrative=_coerce_consistency(data.get("consistent_with_narrative")),
            narrative_reason=str(data.get("narrative_reason", "")),
            confidence=_coerce_confidence(data.get("confidence")),
        )
    except (json.JSONDecodeError, ValidationError, KeyError, IndexError) as exc:
        logger.warning("Vision parse failed for %s: %s", filename, exc)
        return ImageObservation(filename=filename, confidence="low", error=str(exc))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Vision call failed for %s: %s", filename, exc)
        return ImageObservation(filename=filename, confidence="low", error=str(exc))


def _coerce_severity(value: Any) -> SeverityBand:
    v = str(value or "none").lower().strip()
    if v in {"none", "minor", "moderate", "severe"}:
        return v  # type: ignore[return-value]
    return "none"


def _coerce_consistency(value: Any) -> Consistency:
    v = str(value or "unclear").lower().strip()
    if v in {"yes", "no", "unclear"}:
        return v  # type: ignore[return-value]
    return "unclear"


def _coerce_confidence(value: Any) -> Confidence:
    v = str(value or "low").lower().strip()
    if v in {"low", "medium", "high"}:
        return v  # type: ignore[return-value]
    return "low"


_SEVERITY_RANK = {"none": 0, "minor": 1, "moderate": 2, "severe": 3}


def _safe_float(value: Any) -> float:
    """Coerce a loss/estimate to float, tolerating '$12,500'-style strings.

    Custom-claim and upload paths can carry loss_amount as a formatted string;
    a bare float() would raise ValueError and abort the whole analysis, defeating
    the degraded-fallback guarantee. Strip non-numeric characters and fall back
    to 0.0 rather than crash.
    """
    try:
        return float(value)
    except (TypeError, ValueError):
        try:
            return float(re.sub(r"[^0-9.]", "", str(value)) or 0)
        except ValueError:
            return 0.0


def _narrative_implied_severity(claim: dict[str, Any]) -> SeverityBand:
    """Heuristic: how severe the claim narrative / loss implies."""
    damage = claim.get("damage") or {}
    desc = f"{claim.get('narrative', '')} {damage.get('description', '')}".lower()
    loss = _safe_float(claim.get("loss_amount") or damage.get("estimated_repair") or 0)
    if any(w in desc for w in ("total loss", "crush", "severe", "extensive", "deformation")):
        return "severe"
    if loss >= 8000 or any(w in desc for w in ("major", "significant", "quarter panel")):
        return "moderate"
    if any(w in desc for w in ("scuff", "minor", "low-speed", "tap", "crack")):
        return "minor"
    if loss >= 3000:
        return "moderate"
    return "minor"


def _domain_corpus(claim: dict[str, Any], pdf_text: str = "") -> str:
    """The free text a domain classifier reads: narrative + descriptions + report.

    Pulls from every place a custom or golden claim describes the loss — narrative,
    damage/treatment descriptions, claim_type, billed items — plus any extracted PDF
    text, so classification works off the *story*, not the (now-neutral) form fields.
    """
    damage = claim.get("damage") or {}
    treatment = claim.get("treatment") or {}
    parts = [
        str(claim.get("narrative") or ""),
        str(claim.get("claim_type") or ""),
        str(damage.get("description") or ""),
        " ".join(str(a) for a in (damage.get("affected_areas") or [])),
        str(treatment.get("reported_injury") or ""),
        " ".join(str(b) for b in (treatment.get("billed_items") or [])),
        pdf_text or "",
    ]
    return " ".join(p for p in parts if p).lower()


def _structural_domain_hint(claim: dict[str, Any]) -> Domain | None:
    """A strong domain signal from the claim's *shape*, independent of wording.

    Some shapes are unambiguous: a ``treatment`` block (or a provider party) is
    medical, a ``legal``/``counsel`` block is legal, a property_address or affected
    areas is property. Used to break ties and to anchor classification when the
    narrative is terse.
    """
    parties = claim.get("parties") or {}
    if claim.get("treatment") or parties.get("provider"):
        return "medical"
    if claim.get("legal") or claim.get("counsel") or parties.get("counsel") or parties.get("attorney"):
        return "legal"
    claimant = parties.get("claimant") or {}
    if claimant.get("property_address") or (claim.get("damage") or {}).get("affected_areas"):
        return "property"
    return None


def classify_domain(claim: dict[str, Any], pdf_text: str = "") -> Domain | None:
    """Detect the claim domain (property | medical | legal) from its content, or None.

    Deterministic and provider-free: scores the claim's narrative/descriptions
    (and any PDF text) against per-domain keyword vocabularies, then lets an
    unambiguous structural hint (a ``treatment`` block, a ``legal``/``counsel`` block,
    a property_address) break ties or stand in when the prose is sparse.

    Returns **None** when NOTHING points to a domain — no keyword match, no structural
    hint, and no valid explicit ``domain`` on the claim. That "no domain" signal is
    load-bearing: the Case Coordinator recruits no specialist and decides the claim
    itself. When there IS a signal but the keyword tally ties, it falls back to a
    structural hint / explicit domain / :data:`DEFAULT_DOMAIN`. This is what makes the
    Evidence Analyst's ``suggested_domain`` meaningful instead of an echo of the
    (now-neutral) input domain, and it is reused by Intake to re-derive a domain the
    LLM did not supply.
    """
    corpus = _domain_corpus(claim, pdf_text)
    scores: dict[Domain, int] = {"property": 0, "medical": 0, "legal": 0}
    for domain, words in _DOMAIN_KEYWORDS.items():
        for word in words:
            # Whole-word/phrase match so "car" can't fire inside "scarf".
            if re.search(rf"(?<!\w){re.escape(word)}(?!\w)", corpus):
                scores[domain] += 1

    hint = _structural_domain_hint(claim)
    explicit = str(claim.get("domain") or "").lower()
    best_score = max(scores.values())
    if best_score == 0:
        # No keywords matched — trust a structural hint, else a valid explicit domain
        # on the claim (presets carry it). If NEITHER exists, nothing points to a
        # domain: return None so the Coordinator decides the claim with no specialist.
        if hint:
            return hint
        return explicit if explicit in scores else None  # type: ignore[return-value]

    leaders = [d for d, s in scores.items() if s == best_score]
    if len(leaders) == 1:
        return leaders[0]
    # Tie on keywords: prefer the structurally hinted domain if it's among the
    # leaders, otherwise the explicit domain, otherwise the default.
    if hint in leaders:
        return hint  # type: ignore[return-value]
    if explicit in leaders:
        return explicit  # type: ignore[return-value]
    return DEFAULT_DOMAIN if DEFAULT_DOMAIN in leaders else leaders[0]


def derive_signals(
    claim: dict[str, Any],
    observations: list[ImageObservation],
    pdf_text: str,
) -> list[str]:
    """Deterministic mapping into evidence signal vocabulary.

    Two independent evidence sources, each derived in pure Python:
      * the document (PDF) text vs the narrative — needs no vision model, so it
        is ALWAYS evaluated; this is the deterministic backbone of the trap.
      * the vision observations — only the *usable* ones (no error, confidence
        != "low") contribute, so a flaky open-weight read is ignored rather than
        poisoning the result, but it never blocks the document-derived signals.
    """
    signals: list[str] = []
    implied = _narrative_implied_severity(claim)
    implied_rank = _SEVERITY_RANK[implied]

    # --- Document-derived signals (deterministic; independent of vision) ------
    narrative = (claim.get("narrative") or "").lower()
    pdf_lower = pdf_text.lower()
    if pdf_text and narrative:
        # (a) Auto: narrative claims a severe loss, report describes minor damage.
        severe_words = ("high-speed", "severe", "extensive", "crush", "total")
        minor_words = ("minor", "low-speed", "contact", "tap", "scuff")
        if any(w in narrative for w in severe_words) and any(w in pdf_lower for w in minor_words):
            signals.append("evidence_discrepancy")
            if implied_rank >= _SEVERITY_RANK["moderate"]:
                signals.append("severity_gap")

        # (b) Cause contradiction (e.g. property): narrative says a sudden covered
        # event, the report attributes it to a gradual/pre-existing cause. The
        # damage may be real, so this is a discrepancy WITHOUT a severity gap — the
        # case where the document and a domain expert can legitimately disagree.
        sudden_words = ("sudden", "burst", "accident", "suddenly", "abrupt")
        gradual_words = ("long-term", "long term", "gradual", "pre-existing",
                         "preexisting", "corrosion", "slow leak", "predates", "wear")
        if any(w in narrative for w in sudden_words) and any(w in pdf_lower for w in gradual_words):
            signals.append("evidence_discrepancy")

    # --- Vision-derived signals (only from usable observations) ---------------
    usable = [o for o in observations if not o.error and o.confidence != "low"]
    if usable:
        max_observed_rank = max(_SEVERITY_RANK[o.severity_band] for o in usable)
        if implied_rank >= _SEVERITY_RANK["moderate"] and max_observed_rank <= _SEVERITY_RANK["moderate"]:
            if implied_rank - max_observed_rank >= 1:
                signals.append("severity_gap")
        if implied_rank <= _SEVERITY_RANK["minor"] and max_observed_rank >= _SEVERITY_RANK["moderate"]:
            if max_observed_rank - implied_rank >= 1:
                signals.append("severity_gap")
        if any(o.consistent_with_narrative == "no" for o in usable):
            signals.append("evidence_discrepancy")

    # Deduplicate while preserving order
    seen: set[str] = set()
    out: list[str] = []
    for s in signals:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


AttachmentResolver = Callable[[str], bytes | None]


def analyze(
    claim: dict[str, Any],
    attachment_resolver: AttachmentResolver,
    *,
    skip_vision: bool = False,
) -> EvidenceReport:
    """Orchestrate PDF extraction, vision reads, and signal derivation."""
    model = featherless_vision_model_name()
    ctx = _claim_context(claim)

    photos: list[str] = list((claim.get("damage") or {}).get("photos") or [])
    report_name = claim.get("supporting_document") or claim.get("police_report")
    pdf_text = ""
    if report_name:
        pdf_bytes = attachment_resolver(str(report_name))
        if pdf_bytes:
            import tempfile

            try:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
                    tmp.write(pdf_bytes)
                    tmp.flush()
                    pdf_text = extract_pdf_text(Path(tmp.name))
            except Exception as exc:  # noqa: BLE001 — a corrupt PDF must not abort analysis
                logger.warning("PDF extraction failed for %s: %s", report_name, exc)

    # Classify the domain from the claim's story + any extracted document text, so
    # suggested_domain is a real perception signal rather than an echo of the
    # (now-neutral) input domain. Computed once with whatever PDF text we have.
    suggested_domain = classify_domain(claim, pdf_text)

    if not photos and not report_name:
        return EvidenceReport(
            observations=[],
            pdf_excerpt=pdf_text,
            signals=[],
            suggested_domain=suggested_domain,
            vision_model=model,
            degraded=False,
        )

    observations: list[ImageObservation] = []

    if not skip_vision:
        for photo in photos:
            raw = attachment_resolver(photo)
            if raw is None:
                observations.append(
                    ImageObservation(filename=photo, confidence="low", error="attachment not found")
                )
                continue
            observations.append(analyze_image(raw, ctx, filename=photo))

    # Signals are derived deterministically and ALWAYS computed: the PDF-vs-narrative
    # check needs no vision, and derive_signals internally ignores weak/errored
    # observations. `degraded` is a presentational flag — "no usable perception at
    # all" (every photo failed, or vision was skipped) — never a gate that wipes the
    # document-derived signals. A flaky open-weight read can no longer kill the trap.
    signals = derive_signals(claim, observations, pdf_text)
    had_photos = bool(photos)
    usable = [o for o in observations if not o.error and o.confidence != "low"]
    degraded = skip_vision or (had_photos and not usable)

    return EvidenceReport(
        observations=observations,
        pdf_excerpt=pdf_text[:PDF_TEXT_BUDGET],
        signals=signals,
        suggested_domain=suggested_domain,
        vision_model=model,
        degraded=degraded,
    )


def _safe_name(name: str) -> str:
    """The bare filename — never a path — so a resolver can't escape its directory."""
    return Path(str(name)).name


def preset_attachment_resolver(golden_dir: Path) -> AttachmentResolver:
    """Resolve attachments from baked-in seed/golden_claim/ files."""

    def resolve(name: str) -> bytes | None:
        path = golden_dir / _safe_name(name)
        if path.is_file():
            return path.read_bytes()
        return None

    return resolve


def upload_attachment_resolver(upload_dir: Path, fallback: AttachmentResolver) -> AttachmentResolver:
    """Resolve uploaded attachments first, then fall back (e.g. to golden assets).

    A custom claim's photos/PDF are written by the gateway to ``upload_dir`` (a
    per-claim folder under the shared state volume — no database). Preset/golden
    claims have no uploads, so the fallback keeps them working unchanged. Filenames
    are basename-only to prevent path traversal out of ``upload_dir``.
    """

    def resolve(name: str) -> bytes | None:
        path = upload_dir / _safe_name(name)
        if path.is_file():
            return path.read_bytes()
        return fallback(name)

    return resolve
