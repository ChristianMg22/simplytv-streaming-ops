import json
from pathlib import Path

R = json.loads((Path(__file__).resolve().parents[1] / "outputs" / "model_results.json").read_text())["classification"]["robustness"]


def test_lift_over_baseline_is_significant_and_stable():
    assert R["diff_ci"][0] > 0                                  # 95% interval excludes zero
    assert all(r["auc"] > r["baseline"] for r in R["rolling"])  # wins in every time window


def test_probabilities_are_calibrated_and_useful():
    assert R["ece"] < 0.05 and R["brier"] < R["brier_naive"]
    assert R["cost"]["model"] < min(R["cost"]["never_alert"], R["cost"]["always_alert"])
