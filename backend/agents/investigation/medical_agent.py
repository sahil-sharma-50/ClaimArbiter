"""Medical Claims Reviewer agent (CrewAI, Medical Group / Featherless)."""

from __future__ import annotations

from agents.investigation.specialist import SpecialistSpec, main_for
from agents.shared.prompts import MEDICAL_PROMPT

SPEC = SpecialistSpec(
    credential_name="medical_agent",
    log_name="medical",
    role="Medical Claims Reviewer",
    goal="Review medical/injury claims and return structured medical-necessity verdicts",
    backstory=(
        "Senior clinical reviewer at Medical Group. Expert in treatment-to-injury "
        "consistency, procedure necessity, and billing-anomaly detection."
    ),
    prompt=MEDICAL_PROMPT,
)


def main() -> None:
    main_for(SPEC)


if __name__ == "__main__":
    main()
