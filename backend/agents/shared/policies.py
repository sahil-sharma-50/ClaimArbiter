"""Domain approve/deny policy — the single source of truth for what each specialist enforces.

ClaimArbiter recruits exactly one of three domain specialists (property, medical, legal)
per claim, and that specialist alone decides ``approve`` vs ``deny`` and writes the
explanation the Case Coordinator relays verbatim to the human reviewer. The *rules* that
decision turns on — what a property assessor approves, what a medical reviewer denies —
were about to be restated as prose in three places: the specialist prompts, the gateway's
``/api/policies`` endpoint, and the dashboard's Policy card. That is exactly the kind of
drift the casefile and registry contracts already eliminated, so the policy lives here
once and the rest derive from it.

**Scope is policy only.** This module owns the approve/deny stance per domain. It does NOT
own specialist *identity* (Band name, org, capability tag, card title) — that stays in
``registry.py``, which is the roster. The two share a ``key`` ("property"/"medical"/"legal")
so a caller can join a :class:`DomainPolicy` to its :class:`registry.Specialist` when it
needs both, but neither restates the other's columns. The ``title`` and ``org`` carried
here duplicate the registry's ``card_title``/``org`` deliberately, so a payload consumer
(the dashboard Policy card) gets a self-contained row without a second fetch; the registry
contract test guards the identity copy, this module is the policy copy.

Import-light by design (stdlib + dataclasses only) so prompts.py, the gateway endpoint,
and any test can import it without pulling in pydantic or the provider chain.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DomainPolicy:
    """The approve/deny stance one domain specialist enforces.

    ``key`` joins to :class:`registry.Specialist.key` / ``domain``
    ("property"/"medical"/"legal"). ``approve`` and ``deny`` are the concrete, ordered
    bullet lists the specialist applies and the dashboard renders; ``summary`` is the
    one-line framing shown above them.
    """

    key: str                      # domain key — joins to registry Specialist.key/domain
    title: str                    # practitioner title (mirrors registry card_title)
    org: str                      # partner org (mirrors registry org)
    summary: str                  # one-line framing of the domain's mandate
    approve: tuple[str, ...]      # concrete conditions the specialist APPROVES under
    deny: tuple[str, ...]         # concrete conditions the specialist DENIES under

    def as_payload(self) -> dict[str, Any]:
        """JSON-serializable dict for the gateway endpoint and the dashboard Policy card."""
        return {
            "domain": self.key,
            "title": self.title,
            "org": self.org,
            "summary": self.summary,
            "approve": list(self.approve),
            "deny": list(self.deny),
        }

    # Alias: callers and the casefile/registry modules use to_dict() elsewhere.
    to_dict = as_payload


POLICIES: tuple[DomainPolicy, ...] = (
    DomainPolicy(
        key="property",
        title="Property Assessor",
        org="Property Group",
        summary="Covers sudden, accidental physical loss to property; excludes gradual deterioration and neglect.",
        approve=(
            "Sudden and accidental water discharge — a burst pipe, failed water heater, or appliance supply line that lets go without warning.",
            "Storm and weather damage — wind, hail, or a windborne object that breaches the structure during a covered event.",
            "Fire, smoke, and explosion damage to the dwelling and its contents.",
            "Accidental impact damage (vehicle, falling tree or limb) consistent with the reported incident.",
            "Repair estimates that are itemized and proportionate to the damage visible in the evidence.",
        ),
        deny=(
            "Gradual or long-term water seepage and leaks that developed over weeks or months rather than suddenly.",
            "Mold, rot, or dry-rot arising from neglect or deferred maintenance.",
            "Pest, vermin, or insect infestation — including bed bugs, termites, and rodents — which is a maintenance and habitability matter, not sudden accidental physical loss.",
            "Landlord–tenant disputes (habitability, rent, or deposit claims); these are legal matters outside a property peril, not covered physical damage.",
            "Ordinary wear and tear, deterioration, and end-of-life failure of building components.",
            "Pre-existing damage that predates the policy period or the reported loss date.",
            "Repair estimates that far exceed the observed damage or bill for unrelated, betterment work.",
        ),
    ),
    DomainPolicy(
        key="medical",
        title="Medical Reviewer",
        org="Medical Group",
        summary="Covers medically necessary treatment consistent with the reported injury, billed at standard rates.",
        approve=(
            "Treatment that is medically necessary for and consistent with the reported injury or condition.",
            "Diagnostics, procedures, and follow-up care that match the documented mechanism of injury.",
            "Medically necessary dental treatment arising from the covered incident.",
            "Services billed at standard, customary rates with supporting clinical documentation.",
            "Emergency and stabilizing care delivered for the reported acute injury.",
        ),
        deny=(
            "Treatment-to-injury mismatch — procedures unrelated to the reported injury or condition.",
            "Unsupported procedures lacking clinical documentation or medical justification.",
            "Duplicate or repeat billing for the same procedure or visit.",
            "Cosmetic or elective care not arising from the covered incident.",
            "Care expressly excluded by the policy (experimental, non-covered providers).",
        ),
    ),
    DomainPolicy(
        key="legal",
        title="Legal Reviewer",
        org="Legal Group",
        summary="Covers legal costs for covered proceedings with reasonable, itemized fees; excludes criminal and out-of-policy matters.",
        approve=(
            "Liability defense costs for a covered claim brought against the policyholder.",
            "Legal fees for disputes the policy expressly covers (e.g., covered property or injury liability).",
            "Reasonable, itemized attorney fees billed at customary hourly rates.",
            "Court costs and filing fees directly tied to a covered proceeding.",
            "Settlement-related legal costs within the policy's covered scope and limits.",
        ),
        deny=(
            "Criminal defense costs and any matter arising from alleged criminal conduct.",
            "Fines, penalties, and punitive damages, which are not insurable legal costs.",
            "Business, commercial, or contract disputes that fall outside the personal policy's scope.",
            "Contingency-only fee arrangements with no itemized, hourly accounting.",
            "Unreasonable or unsupported fees disproportionate to the matter.",
        ),
    ),
)


_BY_KEY: dict[str, DomainPolicy] = {p.key: p for p in POLICIES}


def by_key(key: str) -> DomainPolicy | None:
    """The policy for this domain key ("property"/"medical"/"legal"), or None."""
    return _BY_KEY.get((key or "").strip().lower())


def policies_payload() -> list[dict[str, Any]]:
    """All three domain policies as JSON-serializable dicts, in property/medical/legal order.

    The list returned by the gateway's ``GET /api/policies`` and consumed by the
    dashboard's ``fetchPolicies`` / Policy card.
    """
    return [p.as_payload() for p in POLICIES]
