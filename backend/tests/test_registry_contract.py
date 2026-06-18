"""Python↔TypeScript contract test for the Specialist Registry.

The dashboard mirrors the backend specialist roster in
frontend/dashboard/lib/registry.ts (SPECIALIST_DIRECTORY). There is no codegen step
(kept out of the demo build), so this test is the drift guard — the same pattern as
test_ts_casefile_contract.py: it parses the TS file as text and asserts the mirror
carries exactly the backend registry's specialists, matched on the STABLE identity
fields (type / org / capability tag).

It deliberately does NOT assert the card `role` ("Fraud Investigator"): that is a
presentational practitioner title that intentionally differs from the agent's Band
display name ("Fraud Investigation"). Identity — which specialist, which org, which
tag — is what must not drift; the title is the dashboard's to phrase.

This is the seam that ends the drift Candidate 01 found: before the registry, the
roster's identity was restated as a literal in five places across two languages, and
two of the backend copies had already silently diverged.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.registry import SPECIALISTS  # noqa: E402

_TS_REGISTRY = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "dashboard" / "lib" / "registry.ts"
)


def _ts_directory_rows() -> list[dict[str, str]]:
    """Parse SPECIALIST_DIRECTORY's `{ type, org, role, tag }` object literals.

    Text-scraping (not execution), mirroring the casefile contract test: find the
    SPECIALIST_DIRECTORY array body, then pull each `{ ... }` row's string fields.
    """
    source = _TS_REGISTRY.read_text(encoding="utf-8")
    m = re.search(r"SPECIALIST_DIRECTORY[^=]*=\s*\[(.*?)\];", source, re.DOTALL)
    if not m:
        raise AssertionError("SPECIALIST_DIRECTORY array not found in registry.ts")
    body = m.group(1)

    rows: list[dict[str, str]] = []
    for obj in re.findall(r"\{([^}]*)\}", body):
        row: dict[str, str] = {}
        for key, val in re.findall(r'(\w+)\s*:\s*"([^"]*)"', obj):
            row[key] = val
        if row:
            rows.append(row)
    return rows


class TestRegistryContract(unittest.TestCase):
    def test_ts_registry_file_exists(self):
        self.assertTrue(_TS_REGISTRY.exists(), f"missing {_TS_REGISTRY}")

    def test_identity_rows_match_backend_registry(self):
        ts_rows = _ts_directory_rows()
        # Compare on the stable identity triple only: (type/key, org, capability tag).
        ts_identity = {(r.get("type"), r.get("org"), r.get("tag")) for r in ts_rows}
        py_identity = {(s.key, s.org, s.capability_tag) for s in SPECIALISTS}

        missing = py_identity - ts_identity  # in Python registry, absent from TS
        extra = ts_identity - py_identity    # in TS, not backed by the registry
        self.assertFalse(
            missing,
            f"registry.ts is missing specialists from the backend registry: "
            f"{sorted(missing)} — update SPECIALIST_DIRECTORY.",
        )
        self.assertFalse(
            extra,
            f"registry.ts has specialists not in the backend registry: "
            f"{sorted(extra)} — update the backend registry or the mirror.",
        )

    def test_counts_match(self):
        self.assertEqual(
            len(_ts_directory_rows()),
            len(SPECIALISTS),
            "registry.ts row count differs from the backend Specialist Registry.",
        )


if __name__ == "__main__":
    unittest.main()
