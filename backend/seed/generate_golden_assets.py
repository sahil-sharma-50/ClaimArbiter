#!/usr/bin/env python3
"""Generate golden_claim demo assets (photos + supporting-document PDFs).

Prefers REAL drop-in photos when present, falls back to clear synthetic renders
so the repo always has *some* asset. Drop real images into seed/source_photos/
named exactly as the claims reference them (e.g. damage_rear.jpg, water_kitchen.jpg)
and they are copied verbatim — the open-weight vision model reads a real photo far
more reliably than a line drawing.

Demo design (what each asset is for):
  * property    — plumber_report.pdf attributes a "sudden burst" claim to long-term
    corrosion; the Property Assessor weighs sudden-vs-gradual cause and denies the
    gradual-leak repair. water_*.jpg show the kitchen water damage.
  * medical     — intake_chart.pdf for the injury claim; documents a cervical (neck)
    complaint while the bill adds an unsupported lumbar MRI, so the Medical Reviewer
    denies the treatment-injury mismatch.
  * legal       — a law-firm invoice for a business contract dispute that is outside
    the policy; the supporting document is reused (police_report.pdf) and there are
    no photos, so no domain-specific imagery is generated for this claim.

The shared damage_*.jpg / police_report.pdf assets are still generated because the
custom New-Claim flow falls back to them when a filer uploads no attachments.
Each claim references its OWN filenames so presets never clobber each other.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "golden_claim"
SOURCE = ROOT / "source_photos"  # optional real photos, copied verbatim if present


def _font(size: int):
    for path in (
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _car_photo(label: str, *, severe: bool) -> Image.Image:
    """Synthetic fallback car render. No baked-in verdict text — the model must
    read the depicted damage, not an OCR caption."""
    w, h = 800, 600
    img = Image.new("RGB", (w, h), (176, 184, 196))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 430, w, h], fill=(86, 88, 94))
    draw.rounded_rectangle([120, 280, 680, 430], radius=22, fill=(38, 54, 120))
    draw.rounded_rectangle([300, 215, 620, 300], radius=16, fill=(33, 48, 110))
    for cx in (230, 560):
        draw.ellipse([cx - 46, 388, cx + 46, 480], fill=(28, 28, 30))
        draw.ellipse([cx - 20, 414, cx + 20, 454], fill=(120, 120, 126))
    if severe:
        # Crushed rear corner: torn metal, deep deformation.
        draw.polygon([(620, 300), (705, 250), (700, 415), (628, 430)], fill=(70, 72, 78))
        draw.line([(636, 318), (694, 392)], fill=(180, 40, 40), width=7)
        draw.line([(648, 300), (700, 360)], fill=(150, 30, 30), width=5)
    else:
        # Minor front scuff only.
        draw.arc([132, 300, 208, 384], 200, 320, fill=(178, 150, 70), width=7)
    draw.text((20, 20), label, fill=(28, 28, 28), font=_font(20))
    return img


def _damage_photo_scene(label: str, fill: tuple[int, int, int]) -> Image.Image:
    """Generic synthetic fallback for non-auto domains (property/medical)."""
    w, h = 800, 600
    img = Image.new("RGB", (w, h), fill)
    draw = ImageDraw.Draw(img)
    draw.text((20, 20), label, fill=(30, 30, 30), font=_font(20))
    return img


def _emit(name: str, fallback: Image.Image) -> None:
    """Copy a real source photo if present, else write the synthetic fallback."""
    for ext in (".jpg", ".jpeg", ".png"):
        src = SOURCE / (Path(name).stem + ext)
        if src.is_file():
            shutil.copyfile(src, OUT / name)
            print(f"  · {name} ← real photo {src.name}")
            return
    fallback.convert("RGB").save(OUT / name, format="JPEG", quality=92)
    print(f"  · {name} (synthetic fallback)")


def _write_pdf(name: str, text: str) -> None:
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 72), text, fontsize=11, fontname="helv")
    doc.save(OUT / name)
    doc.close()
    print(f"  · {name}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    print("Shared fallback photos (used by the custom New-Claim flow when no upload):")
    _emit("damage_front.jpg", _car_photo("damage_front", severe=False))
    _emit("damage_rear.jpg", _car_photo("damage_rear", severe=False))
    _emit("damage_detail.jpg", _car_photo("damage_detail", severe=False))

    print("Property — water damage:")
    _emit("water_kitchen.jpg", _damage_photo_scene("water_kitchen", (150, 160, 170)))
    _emit("water_cabinets.jpg", _damage_photo_scene("water_cabinets", (140, 150, 165)))
    _emit("moisture_meter.jpg", _damage_photo_scene("moisture_meter", (120, 130, 145)))

    print("Documents:")
    _write_pdf(
        "police_report.pdf",
        "POLICE INCIDENT REPORT — PR-88231\n"
        "Date: 2026-05-28  Location: I-405 southbound near exit 12\n\n"
        "Summary: Minor rear contact reported. No injuries. Visible damage limited to\n"
        "a small scuff on the front bumper. No evidence of severe rear quarter panel\n"
        "crush or trunk deformation at the scene. Both parties' statements note a\n"
        "low-speed contact; rear structural damage not observed by responding officer.\n\n"
        "Reporting officer: Badge #4412\n",
    )
    _write_pdf(
        "plumber_report.pdf",
        "LICENSED PLUMBER INSPECTION — JOB 5521\n"
        "Property: 118 Cedar Hollow Rd, Unit 4\n\n"
        "Findings: Claimant reports a sudden supply-line burst. However, fittings show\n"
        "long-term corrosion and the subfloor staining indicates a slow, pre-existing\n"
        "leak that predates the reported incident date by several weeks. Damage to the\n"
        "cabinets and subfloor is real and extensive, but the cause is gradual wear,\n"
        "not a sudden accidental discharge.\n\n"
        "Inspector: License #PL-7782\n",
    )
    _write_pdf(
        "intake_chart.pdf",
        "CLINICAL INTAKE CHART — Lakeside Orthopedic & Imaging\n"
        "Patient: Eli Brandt   DOB: 1989-03-12\n\n"
        "Chief complaint: neck pain following a rear-end collision. Exam documents\n"
        "cervical (neck) tenderness. No lower-back complaint recorded. Cervical X-ray\n"
        "ordered. Note: a lumbar MRI appears on the bill but is not referenced in the\n"
        "imaging order or supported by the documented complaint.\n",
    )

    print(f"\nWrote assets to {OUT}")
    print(f"(Drop real photos into {SOURCE}/ with matching names to override synthetics.)")


if __name__ == "__main__":
    main()
