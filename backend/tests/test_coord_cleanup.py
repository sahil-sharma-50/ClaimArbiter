"""P2 cleanup regressions: dead scoring weights removed, model defaults consistent.

- scoring.SIGNAL_WEIGHTS dropped three weights never produced by any code path
  (loss_estimate_gap / estimate_inflated / billing_anomaly). Scoring of the signals
  that ARE produced must be unchanged (clean stays below threshold; two strong
  signals still clear it).
- The AIML / Featherless model defaults must agree between gateway/main.py and
  agents/shared/config.py (and match .env.example): AIML gpt-4o, Featherless
  meta-llama/Meta-Llama-3.1-8B-Instruct.
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from agents.shared import config as cfg_mod  # noqa: E402
from agents.shared import scoring  # noqa: E402
from agents.shared.config import get_provider_config  # noqa: E402
from gateway.main import DEFAULT_AIML_MODEL, DEFAULT_FEATHERLESS_MODEL  # noqa: E402


class TestScoringWeights(unittest.TestCase):
    def test_dead_weights_removed(self):
        for dead in ("loss_estimate_gap", "estimate_inflated", "billing_anomaly"):
            self.assertNotIn(dead, scoring.SIGNAL_WEIGHTS, f"{dead} should be removed")

    def test_produced_signals_still_present(self):
        for sig in (
            "prior_claim_match", "photo_metadata_mismatch",
            "severity_gap", "evidence_discrepancy",
            "water_source_ambiguous", "moisture_predates_loss",
            "treatment_injury_mismatch", "unsupported_procedure",
        ):
            self.assertIn(sig, scoring.SIGNAL_WEIGHTS)

    def test_threshold_behavior_unchanged(self):
        # A single signal does not clear 0.7; two strong signals do.
        self.assertLess(scoring.score_signals(["prior_claim_match"]), scoring.FRAUD_THRESHOLD)
        self.assertGreaterEqual(
            scoring.score_signals(["prior_claim_match", "photo_metadata_mismatch"]),
            scoring.FRAUD_THRESHOLD,
        )
        self.assertEqual(scoring.score_signals([]), 0.0)


class TestModelDefaultsConsistent(unittest.TestCase):
    def test_gateway_defaults_match_env_example_values(self):
        self.assertEqual(DEFAULT_AIML_MODEL, "gpt-4o")
        self.assertEqual(DEFAULT_FEATHERLESS_MODEL, "meta-llama/Meta-Llama-3.1-8B-Instruct")

    def test_config_defaults_match_gateway_defaults(self):
        # With model env vars absent (but the required API keys present), the config
        # must fall back to the SAME defaults the gateway advertises. load_env is a
        # no-op here so a host .env can't repopulate the model vars and mask the
        # default-fallback path we're actually exercising.
        with mock.patch.object(cfg_mod, "load_env", lambda: None), \
             mock.patch.dict(os.environ, {"AIML_API_KEY": "x", "FEATHERLESS_API_KEY": "y"}, clear=False):
            for var in ("AIML_MODEL", "FEATHERLESS_MODEL"):
                os.environ.pop(var, None)
            cfg = get_provider_config()
        self.assertEqual(cfg.aiml_model, DEFAULT_AIML_MODEL)
        self.assertEqual(cfg.featherless_model, DEFAULT_FEATHERLESS_MODEL)


if __name__ == "__main__":
    unittest.main()
