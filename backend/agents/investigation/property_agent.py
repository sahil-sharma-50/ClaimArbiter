"""Property Damage Assessor agent (CrewAI, Property Group / Featherless)."""

from __future__ import annotations

from agents.investigation.specialist import SpecialistSpec, main_for
from agents.shared.prompts import PROPERTY_PROMPT

SPEC = SpecialistSpec(
    credential_name="property_agent",
    log_name="property",
    role="Property Damage Assessor",
    goal="Assess property and water-damage claims and return structured coverage verdicts",
    backstory=(
        "Senior field assessor at Property Group. Expert in water-intrusion forensics, "
        "structural damage assessment, and distinguishing covered sudden-loss events from "
        "long-term seepage and pre-existing damage."
    ),
    prompt=PROPERTY_PROMPT,
)


def main() -> None:
    main_for(SPEC)


if __name__ == "__main__":
    main()
