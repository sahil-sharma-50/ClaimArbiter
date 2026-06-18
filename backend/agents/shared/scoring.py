"""Single source of truth for ARBITER's deterministic review scoring.

Both the Case Coordinator (which scores a claim and decides whether to recruit) and
the gateway PDF report (which displays the signals → weight → source table) read
these weights. Keeping them here means a weight tuned in one place can never
drift from the other — the spec calls this weighted sum "the reproducible core".
"""

from __future__ import annotations

FRAUD_THRESHOLD = 0.7

# Weight per concern signal. Two strong signals (0.45 + 0.40) clear the 0.7
# threshold; a single one does not — which is what makes the "clean" preset
# deterministically recruit nobody. Every weighted signal here is actually produced
# by a claim's review_signals or the Evidence Analyst; a minor 0.25 tier per domain
# (loss_estimate_gap / estimate_inflated / billing_anomaly) was specced but never
# emitted by any code path, so it was dropped to keep the table drift-free. Re-add a
# signal here in lockstep with the producer that emits it.
SIGNAL_WEIGHTS: dict[str, float] = {
    # legacy paper signals (claim-provided facts) — retained because the scoring
    # contract test pins them; the score is now advisory and no longer gates recruit.
    "prior_claim_match": 0.45,
    "photo_metadata_mismatch": 0.40,
    # evidence-derived (vision / document → deterministic Python)
    "severity_gap": 0.45,
    "evidence_discrepancy": 0.40,
    # property / water-damage (paper)
    "water_source_ambiguous": 0.45,
    "moisture_predates_loss": 0.40,
    # medical / injury (paper)
    "treatment_injury_mismatch": 0.45,
    "unsupported_procedure": 0.40,
}

# Signals produced by the Evidence Analyst from perception (vision + document
# text), as opposed to paper signals carried on the claim. Used to label
# provenance in the report and to distinguish the two sources honestly.
EVIDENCE_SIGNALS: frozenset[str] = frozenset({"severity_gap", "evidence_discrepancy"})


def score_signals(signals: list[str]) -> float:
    """Deterministic weighted sum of present concern signals, rounded to 2 dp."""
    return round(sum(SIGNAL_WEIGHTS.get(s, 0.0) for s in signals), 2)


def signal_source(signal: str) -> str:
    """Provenance of a signal for the report's source column."""
    return "vision" if signal in EVIDENCE_SIGNALS else "paper"
