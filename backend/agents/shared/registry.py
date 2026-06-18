"""The Specialist Registry — one source of truth for specialist *identity*.

A **Specialist** is a recruited investigator from a partner org that returns one
structured verdict (Fraud Investigation, Property Assessment, Medical Review). Their
identity — which claim domain they serve, the Band capability tag they advertise,
their Band display name, org, framework, model, verdict label, and the name/handle
needles used to find them when Band exposes no tags — was, until now, restated as a
literal in *five* places across two languages:

  * agents/shared/prompts.py        CAPABILITY_TAGS        (domain → tag)
  * agents/insurer/case_coordinator  _TAG_FALLBACK_NEEDLES  (tag → name needles)
  * gateway/projection.py            SPECIALIST_KINDS       (tag, role, verdict_label)
  * gateway/projection.py            AGENT_META             (org, framework, model)
  * frontend/.../SeamScene + StageDetailCard  DIRECTORY / HANDOFF_DIR (org, role, tag)

Those copies had already silently drifted (the coordinator's needles carried
``investigat`` / ``assessor`` that the gateway's did not). This module is the single
typed seam that ends that drift: one :class:`Specialist` row per specialist, and the
old maps become *derived views* (:func:`capability_tag_for_domain`,
:func:`needles_for_tag`, :func:`by_tag`) rather than independent sources.

**Scope is identity only.** This module does NOT own claim-domain *classification*
(the keyword vocabulary that decides whether a claim is auto/property/medical) — that
stays in ``evidence.py``'s ``_DOMAIN_KEYWORDS``, which is the Evidence Analyst's
concern, not the roster's.

**Band stays the system of record.** This holds only the static descriptor Band does
not store (framework/model labels, verdict label, fallback needles). The *live* roster
— who is actually in a claim room, the real Band tags — still comes from Band via
participants and ``/api/agents``. The registry never becomes authoritative state, and
there is no database (see CLAUDE.md).

The frontend mirrors the presentation-facing columns in
``frontend/dashboard/lib/registry.ts``; ``tests/test_registry_contract.py`` is the
drift guard for that mirror (same no-codegen pattern as the casefile contract test).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Specialist:
    """The identity of one specialist investigator.

    ``key`` is the internal role key the gateway projection uses everywhere
    (``"property"`` / ``"medical"`` / ``"legal"``). The verdict ``specialty`` field
    equals this key, and for the current roster each specialist's ``key`` and served
    ``domain`` are the same string (e.g. a legal verdict carries ``specialty="legal"``
    while serving the ``"legal"`` domain).

    ``band_name`` is the agent's exact Band display name and therefore the @mention
    target — it must match what the seed/run_all register (see CLAUDE.md "agents are
    found by name"). ``card_title`` is the practitioner title the dashboard renders
    ("Legal Reviewer"), which can differ from the agent name ("Legal Review"); both
    are kept so neither caller has to invent the other.
    """

    key: str                 # internal role key — also the verdict "specialty"
    domain: str              # claim domain served: "auto" | "property" | "medical"
    capability_tag: str      # Band directory tag advertised + matched on
    band_name: str           # exact Band display name = @mention target
    card_title: str          # practitioner title shown on the dashboard directory card
    org: str                 # partner org
    framework: str           # agent framework label (dashboard)
    model: str               # provider/model label (dashboard)
    verdict_label: str       # human phrase for the verdict the specialist returns
    needles: tuple[str, ...]  # name/handle fallback match when Band exposes no tags


# One row per specialist. This is the literal source for every value the old maps
# hardcoded. ``needles`` is the UNION of the two previously-drifted sets (the gateway's
# SPECIALIST_KINDS matches and the coordinator's _TAG_FALLBACK_NEEDLES), which equals
# the coordinator's superset and is behavior-preserving: no insurer/human agent name
# contains any of these needles, and the projection classifier checks specialists
# before insurer roles (pinned by test_classify_participant).
SPECIALISTS: tuple[Specialist, ...] = (
    Specialist(
        key="property",
        domain="property",
        capability_tag="property-damage",
        band_name="Property Assessment",
        card_title="Property Assessor",
        org="Property Group",
        framework="CrewAI",
        model="Featherless",
        verdict_label="covered-peril assessment",
        needles=("property", "water", "orion", "structural", "assessor"),
    ),
    Specialist(
        key="medical",
        domain="medical",
        capability_tag="medical-review",
        band_name="Medical Review",
        card_title="Medical Reviewer",
        org="Medical Group",
        framework="CrewAI",
        model="Featherless",
        verdict_label="medical-necessity review",
        needles=("medical", "injury", "clinical", "health"),
    ),
    Specialist(
        key="legal",
        domain="legal",
        capability_tag="legal-review",
        band_name="Legal Review",
        card_title="Legal Reviewer",
        org="Legal Group",
        framework="CrewAI",
        model="Featherless",
        verdict_label="legal-coverage review",
        needles=("legal", "counsel", "attorney", "litigation", "lawyer"),
    ),
)


_BY_KEY: dict[str, Specialist] = {s.key: s for s in SPECIALISTS}
_BY_TAG: dict[str, Specialist] = {s.capability_tag: s for s in SPECIALISTS}
_BY_DOMAIN: dict[str, Specialist] = {s.domain: s for s in SPECIALISTS}

# The capability-tag fallback domain when a recruit() arg can't be matched to a
# known domain. This is NOT the classifier's "nothing matched" path (that returns no
# domain and the Coordinator decides alone) — it only guards capability_tag_for_domain
# against producing an invalid tag. Mirrors evidence.DEFAULT_DOMAIN ("property").
DEFAULT_DOMAIN = "property"


def by_key(key: str) -> Specialist | None:
    """The specialist with this internal role key, or None."""
    return _BY_KEY.get(key)


def by_tag(capability_tag: str) -> Specialist | None:
    """The specialist advertising this capability tag, or None."""
    return _BY_TAG.get((capability_tag or "").strip().lower())


def by_domain(domain: str) -> Specialist | None:
    """The specialist serving this claim domain, or None."""
    return _BY_DOMAIN.get((domain or "").strip().lower())


def capability_tag_for_domain(domain: str) -> str:
    """The capability tag a claim of this domain needs.

    Replaces ``prompts.CAPABILITY_TAGS`` — an unknown domain degrades to the default
    domain's tag (``fraud-investigation``), exactly as the old ``.get(domain, ["auto"])``
    fallback did, so the coordinator never produces an invalid tag.
    """
    spec = by_domain(domain) or _BY_DOMAIN[DEFAULT_DOMAIN]
    return spec.capability_tag


def needles_for_tag(capability_tag: str) -> tuple[str, ...]:
    """The name/handle fallback needles for a capability tag (empty if unknown).

    Replaces ``case_coordinator._TAG_FALLBACK_NEEDLES``.
    """
    spec = by_tag(capability_tag)
    return spec.needles if spec else ()
