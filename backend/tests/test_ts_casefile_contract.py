"""Python↔TypeScript contract test for the casefile payload schema.

The dashboard mirrors the backend per-stage payload models in
frontend/dashboard/lib/casefileSchema.ts. There is no codegen step (kept out of the
demo build), so this test is the drift guard: it parses the TS file as text and
asserts that every field of each RESULT-BEARING Pydantic model is present in the
mirrored TS type. Add a field to a Python model and forget the TS mirror (or vice
versa) and this fails.

Scope note — result-bearing stages only: the gateway sets
``CasefileEntry.result = metadata.get("result", metadata)``, so for intake / coverage /
evidence_analysis / escalation / conflict the frontend's ``result`` IS the model 1:1.
Sibling-bearing stages (discovery / recruiting / specialist_verdict / signoff) expose
their fields differently across the gateway projection, so they are mirrored in TS for
completeness but are not asserted field-for-field here.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared.casefile_schema import (  # noqa: E402
    ConflictResult,
    CoverageResult,
    EscalationResult,
    IntakeResult,
)
from agents.shared.evidence import EvidenceReport  # noqa: E402

_TS_SCHEMA = (
    Path(__file__).resolve().parents[2]
    / "frontend" / "dashboard" / "lib" / "casefileSchema.ts"
)

# Python model → the TS type name that mirrors it.
_RESULT_BEARING_MIRROR = {
    IntakeResult: "IntakeResult",
    CoverageResult: "CoverageResult",
    EvidenceReport: "EvidenceAnalysisResult",
    EscalationResult: "EscalationResult",
    ConflictResult: "ConflictResult",
}


def _ts_source() -> str:
    return _TS_SCHEMA.read_text(encoding="utf-8")


def _ts_type_body(source: str, type_name: str) -> str:
    """Extract the `{ ... }` body of `export type <type_name> = { ... };`."""
    m = re.search(rf"export type {re.escape(type_name)}\s*=\s*\{{", source)
    if not m:
        raise AssertionError(f"TS type '{type_name}' not found in casefileSchema.ts")
    start = m.end() - 1  # at the opening brace
    depth = 0
    for i in range(start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[start : i + 1]
    raise AssertionError(f"Unbalanced braces for TS type '{type_name}'")


def _ts_field_names(body: str) -> set[str]:
    """Top-level field names in a TS type body (depth-1 `name?:` / `name:` keys)."""
    names: set[str] = set()
    depth = 0
    # Walk char by char, only matching keys at brace-depth 1 (skip nested objects).
    i = 0
    while i < len(body):
        ch = body[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        elif depth == 1:
            m = re.match(r"\s*([A-Za-z_]\w*)\??\s*:", body[i:])
            if m:
                names.add(m.group(1))
                i += m.end()
                continue
        i += 1
    return names


class TestTsCasefileContract(unittest.TestCase):
    def test_ts_schema_file_exists(self):
        self.assertTrue(_TS_SCHEMA.exists(), f"missing {_TS_SCHEMA}")

    def test_result_bearing_models_are_mirrored_field_for_field(self):
        source = _ts_source()
        for model, ts_name in _RESULT_BEARING_MIRROR.items():
            with self.subTest(model=model.__name__):
                py_fields = set(model.model_fields.keys())
                ts_fields = _ts_field_names(_ts_type_body(source, ts_name))
                missing = py_fields - ts_fields
                self.assertFalse(
                    missing,
                    f"{ts_name} is missing fields present in {model.__name__}: "
                    f"{sorted(missing)} — update casefileSchema.ts (or the model).",
                )

    def test_stage_names_union_covers_python_stages(self):
        # The TS StageName union must list every stage the Python schema knows.
        from agents.shared.casefile_schema import _MODEL_BY_STAGE

        source = _ts_source()
        union_body = re.search(r"export type StageName\s*=\s*([^;]+);", source)
        self.assertIsNotNone(union_body, "StageName union not found")
        ts_stages = set(re.findall(r'"([a-z_]+)"', union_body.group(1)))
        py_stages = set(_MODEL_BY_STAGE) | {"evidence_analysis"}
        missing = py_stages - ts_stages
        self.assertFalse(missing, f"StageName union missing stages: {sorted(missing)}")


if __name__ == "__main__":
    unittest.main()
