"""Validate Phase C result artifacts without loading Torch or model assets."""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

RESULT_ROOT = Path(__file__).resolve().parents[1] / "phase_c_results"
GROUPS = (160, 120, 80, 60, 40)
METHODS = (
    "uniform",
    "random_missing",
    "continuous_gap",
    "front_dense_back_sparse",
    "front_sparse_back_dense",
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> None:
    required = {
        "sampling_indices.csv",
        "sampling_indices.json",
        "phase_c_overall_metrics.csv",
        "phase_c_per_class_metrics.csv",
        "phase_c_predictions.csv",
        "phase_c_results.json",
        "phase_c_metrics.png",
        "phase_c_metrics.pdf",
        "PHASE_C_VALIDATION_REPORT.md",
    }
    missing = sorted(name for name in required if not (RESULT_ROOT / name).is_file())
    require(not missing, f"missing artifacts: {missing}")

    overall = pd.read_csv(RESULT_ROOT / "phase_c_overall_metrics.csv")
    per_class = pd.read_csv(RESULT_ROOT / "phase_c_per_class_metrics.csv")
    predictions = pd.read_csv(RESULT_ROOT / "phase_c_predictions.csv")
    indices = pd.read_csv(RESULT_ROOT / "sampling_indices.csv")
    payload = json.loads((RESULT_ROOT / "phase_c_results.json").read_text(encoding="utf-8"))
    sampling = json.loads((RESULT_ROOT / "sampling_indices.json").read_text(encoding="utf-8"))

    expected_scenarios = {"baseline_248"} | {
        f"{method}_{epochs}" for epochs in GROUPS for method in METHODS
    }
    require(len(overall) == 26, "overall metrics must contain 26 scenarios")
    require(set(overall["scenario"]) == expected_scenarios, "scenario matrix mismatch")
    require(len(per_class) == 26 * 6, "per-class metrics must contain 156 rows")
    require(len(predictions) == 26 * 523, "predictions must contain 13,598 rows")
    require((overall["failureCount"] == 0).all(), "all scenarios must have zero failures")
    require((overall["evaluatedRows"] == 523).all(), "every scenario must evaluate 523 rows")
    require(not predictions.isna().any().any(), "prediction table contains missing values")

    require(len(sampling["scenarios"]) == 26, "sampling manifest must contain 26 scenarios")
    for scenario in sampling["scenarios"]:
        selected = scenario["indices"]
        require(len(selected) == scenario["epochs"], f"epoch count mismatch: {scenario['scenario']}")
        require(len(set(selected)) == len(selected), f"duplicate index: {scenario['scenario']}")
        require(selected[0] == 0 and selected[-1] == 247, f"endpoints missing: {scenario['scenario']}")
    require(len(indices) == 248 + 5 * sum(GROUPS), "sampling CSV row count mismatch")

    policy = payload["decisionPolicy"]
    require(policy["acceptanceThresholdDefined"] is False, "threshold must remain undefined")
    require(policy["supportedMinimumSelected"] is False, "minimum must remain user-owned")
    require(policy["decisionOwner"] == "user", "decision owner must be user")
    require(len(payload["overall"]) == 26, "JSON overall count mismatch")
    require(len(payload["perClass"]) == 156, "JSON per-class count mismatch")
    require(payload["sampling"]["sha256"] == sampling["sha256"], "sampling hash mismatch")
    require((RESULT_ROOT / "phase_c_metrics.png").stat().st_size > 100_000, "PNG is unexpectedly small")
    require((RESULT_ROOT / "phase_c_metrics.pdf").stat().st_size > 10_000, "PDF is unexpectedly small")
    print("Phase C artifact validation: PASS")


if __name__ == "__main__":
    main()
