"""Legal Review agent (CrewAI, Legal Group / Featherless)."""

from __future__ import annotations

from agents.investigation.specialist import SpecialistSpec, main_for
from agents.shared.prompts import LEGAL_PROMPT

SPEC = SpecialistSpec(
    credential_name="legal_agent",
    log_name="legal",
    role="Legal Claims Reviewer",
    goal="Review legal-cost insurance claims and return structured approve/deny verdicts",
    backstory=(
        "Senior legal claims reviewer at Legal Group. Expert in insurance coverage "
        "for legal proceedings — liability defense, covered disputes, and reasonable, "
        "itemized fee review."
    ),
    prompt=LEGAL_PROMPT,
)


def main() -> None:
    main_for(SPEC)


if __name__ == "__main__":
    main()
