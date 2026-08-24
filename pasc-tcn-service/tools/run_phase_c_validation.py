"""Run v4 Phase C on the fixed 523-row test set; no threshold or API."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
sys.path.insert(0, str(SERVICE_ROOT / "src"))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
from sklearn.metrics import accuracy_score, precision_recall_fscore_support
from sklearn.neighbors import NearestNeighbors

from pasc_tcn_service.phase_c import (
    DYNAMIC_PROBABILITY_BOOST,
    adapt_selected_series,
    build_sampling_manifest,
    calibrate_probabilities,
)
from pasc_tcn_service.preprocessing import extract_physical_features, rowwise_zscore

plt.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "pdf.fonttype": 42,
        "font.size": 9,
        "axes.spines.right": False,
        "axes.spines.top": False,
        "axes.linewidth": 0.8,
        "legend.frameon": False,
    }
)

EXPECTED_HASHES = {
    "data": "e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265",
    "split": "956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c",
    "checkpoint": "a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107",
    "baselinePredictions": "40250d66014da01a0d2295d68b537bd2b7a7c8bb4f0f29401735343bf270fba1",
    "modelCode": "16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c",
}
METHOD_COLORS = {
    "uniform": "#0072B2",
    "random_missing": "#E69F00",
    "continuous_gap": "#D73027",
    "front_dense_back_sparse": "#009E73",
    "front_sparse_back_dense": "#CC79A7",
}


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def assert_hash(path: Path, key: str) -> str:
    actual = file_hash(path).lower()
    if actual != EXPECTED_HASHES[key]:
        raise RuntimeError(f"{key} SHA-256 mismatch: {actual}")
    return actual


def load_formal_modules(research_root: Path):
    sys.path.insert(0, str(research_root / "code"))
    model_lib = importlib.import_module("run_spatial_physics_tcn_patent_prototype")
    infer_lib = importlib.import_module("predict_pasc_tcn_full_area")
    return model_lib, infer_lib


def validate_split(data, frame, model_lib):
    train, validation, test = model_lib.split_random(data.labels)
    frame = frame.copy()
    frame.columns = frame.columns.str.strip()
    frame["Split"] = frame["Split"].str.lower()
    for name, indices in (("train", train), ("validation", validation), ("test", test)):
        actual = set(
            pd.to_numeric(
                frame.loc[frame["Split"] == name, "Row_Index"], errors="raise"
            ).astype(int)
        )
        if actual != set(indices.tolist()):
            raise RuntimeError(f"fixed split mismatch: {name}")
    if (len(train), len(validation), len(test)) != (1036, 183, 523):
        raise RuntimeError("fixed split counts are not 1036/183/523")
    indexed = frame.set_index("Row_Index")
    for index in test:
        source = data.frame.iloc[int(index)]
        split_row = indexed.loc[int(index)]
        if int(source["Label"]) != int(split_row["Label"]):
            raise RuntimeError(f"label mismatch at row {index}")
        if int(float(source["fid"])) != int(float(split_row["fid"])):
            raise RuntimeError(f"fid mismatch at row {index}")
    return train, validation, test


def calculate_metrics(labels, raw_probabilities, calibrated, baseline):
    sums = calibrated.sum(axis=1)
    valid = (
        np.all(np.isfinite(raw_probabilities), axis=1)
        & np.all(np.isfinite(calibrated), axis=1)
        & np.isfinite(sums)
        & np.isclose(sums, 1.0, atol=1e-5)
    )
    if not np.any(valid):
        raise RuntimeError("all rows failed probability validation")
    y_true = labels[valid]
    raw_probs = raw_probabilities[valid]
    final_probs = calibrated[valid]
    raw_predictions = raw_probs.argmax(axis=1)
    predictions = final_probs.argmax(axis=1)
    raw_confidence = raw_probs.max(axis=1)
    confidence = final_probs.max(axis=1)

    precision, recall, f1, support = precision_recall_fscore_support(
        y_true, predictions, labels=np.arange(6), zero_division=0
    )
    raw_precision, raw_recall, raw_f1, _ = precision_recall_fscore_support(
        y_true, raw_predictions, labels=np.arange(6), zero_division=0
    )
    macro_f1 = precision_recall_fscore_support(
        y_true, predictions, labels=np.arange(6), average="macro", zero_division=0
    )[2]
    raw_macro_f1 = precision_recall_fscore_support(
        y_true, raw_predictions, labels=np.arange(6), average="macro", zero_division=0
    )[2]
    if baseline is None:
        agreement = 1.0
        shift = absolute_shift = 0.0
    else:
        agreement = float(np.mean(predictions == baseline["predictions"][valid]))
        delta = confidence - baseline["confidence"][valid]
        shift = float(np.mean(delta))
        absolute_shift = float(np.mean(np.abs(delta)))

    overall = {
        "evaluatedRows": int(np.sum(valid)),
        "failureCount": int(np.sum(~valid)),
        "accuracy": float(accuracy_score(y_true, predictions)),
        "macroF1": float(macro_f1),
        "rawAccuracy": float(accuracy_score(y_true, raw_predictions)),
        "rawMacroF1": float(raw_macro_f1),
        "predictionAgreement": agreement,
        "confidenceShift": shift,
        "confidenceAbsoluteShift": absolute_shift,
        "meanConfidence": float(np.mean(confidence)),
        "rawMeanConfidence": float(np.mean(raw_confidence)),
        "calibrationChangeRate": float(np.mean(predictions != raw_predictions)),
    }
    per_class = [
        {
            "classId": class_id,
            "precision": float(precision[class_id]),
            "recall": float(recall[class_id]),
            "f1": float(f1[class_id]),
            "support": int(support[class_id]),
            "rawPrecision": float(raw_precision[class_id]),
            "rawRecall": float(raw_recall[class_id]),
            "rawF1": float(raw_f1[class_id]),
        }
        for class_id in range(6)
    ]
    detail = {
        "valid": valid,
        "rawPredictions": raw_predictions,
        "predictions": predictions,
        "rawConfidence": raw_confidence,
        "confidence": confidence,
    }
    return overall, per_class, detail

def markdown_table(headers, rows):
    lines = [
        "| " + " | ".join(headers) + " |",
        "|" + "|".join("---" for _ in headers) + "|",
    ]
    lines.extend("| " + " | ".join(str(value) for value in row) + " |" for row in rows)
    return "\n".join(lines)


def render_figure(overall: pd.DataFrame, output_dir: Path):
    sampled = overall[overall["method"] != "baseline"]
    baseline = overall.iloc[0]
    panels = (
        ("accuracy", "Accuracy", float(baseline["accuracy"])),
        ("macroF1", "Macro-F1", float(baseline["macroF1"])),
        ("predictionAgreement", "Prediction agreement", 1.0),
        ("confidenceShift", "Mean confidence shift", 0.0),
    )
    fig, axes = plt.subplots(2, 2, figsize=(13, 9), constrained_layout=True)
    for axis, (field, title, baseline_value) in zip(axes.flat, panels):
        for method, group in sampled.groupby("method", sort=False):
            values = group.sort_values("epochs")
            axis.plot(
                values["epochs"],
                values[field],
                marker="o",
                linewidth=2,
                label=method,
                color=METHOD_COLORS[method],
            )
        axis.axhline(baseline_value, color="#4D4D4D", linestyle="--", linewidth=1.2)
        axis.set_title(title)
        axis.set_xlabel("Retained epochs")
        axis.grid(alpha=0.25)
    for axis in (axes[0, 0], axes[0, 1], axes[1, 0]):
        axis.set_ylim(0, 1.02)
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="outside lower center", ncol=3, frameon=False)
    fig.suptitle("PASC-TCN Phase C — fixed 523-sample validation", fontsize=15)
    fig.savefig(output_dir / "phase_c_metrics.png", dpi=300)
    fixed_timestamp = datetime(2026, 8, 24, tzinfo=timezone.utc)
    fig.savefig(
        output_dir / "phase_c_metrics.pdf",
        metadata={
            "Creator": "PASC-TCN Phase C evaluator",
            "Producer": "Matplotlib",
            "CreationDate": fixed_timestamp,
            "ModDate": fixed_timestamp,
        },
    )
    plt.close(fig)


def write_reports(output_dir, overall, per_class, provenance, sampling, baseline_check):
    scenario_rows = [
        [
            row["scenario"],
            row["epochs"],
            f'{row["accuracy"]:.6f}',
            f'{row["macroF1"]:.6f}',
            f'{row["predictionAgreement"]:.6f}',
            f'{row["confidenceShift"]:+.6f}',
            f'{row["calibrationChangeRate"]:.6f}',
            row["failureCount"],
        ]
        for _, row in overall.iterrows()
    ]
    sampled = overall[overall["method"] != "baseline"]
    epoch_rows = [
        [
            int(epochs),
            f'{group["accuracy"].mean():.6f}',
            f'{group["accuracy"].min():.6f}',
            f'{group["macroF1"].mean():.6f}',
            f'{group["macroF1"].min():.6f}',
            f'{group["predictionAgreement"].mean():.6f}',
        ]
        for epochs, group in sampled.groupby("epochs", sort=False)
    ]
    baseline = overall.iloc[0]
    report = f"""# PASC-TCN Phase C — fixed 523-sample validation

> Experimental evidence only. This report defines no acceptance threshold and
> does not declare a supported minimum epoch count. The user owns that decision.

## Protocol

- Fixed 523 test rows; no resplit and no additional samples
- Native 248 baseline; sampled 160/120/80/60/40 groups
- Five deterministic patterns with persisted dates and indices
- Both endpoints preserved, then Phase B linear Adapter to 248 nodes
- Already-smoothed input skips SG
- Frozen M4, frozen Scaler, training-only 1,036-row spatial reference
- Dynamic-class probability boost: {DYNAMIC_PROBABILITY_BOOST}
- Sampling manifest SHA-256: {sampling["sha256"]}

## Frozen provenance

{markdown_table(["Asset", "SHA-256"], provenance["hashes"].items())}

## Baseline reproduction

- Existing raw labels matched: {baseline_check["labelsMatched"]}/523
- Maximum raw-confidence difference: {baseline_check["maxConfidenceDifference"]:.10f}
- Calibrated Accuracy / Macro-F1: {baseline["accuracy"]:.6f} / {baseline["macroF1"]:.6f}
- Raw Accuracy / Macro-F1: {baseline["rawAccuracy"]:.6f} / {baseline["rawMacroF1"]:.6f}

## Scenario results

{markdown_table(
    ["Scenario", "Epochs", "Accuracy", "Macro-F1", "Agreement", "Confidence shift", "Calibration change", "Failures"],
    scenario_rows,
)}

## Descriptive aggregation across five patterns

These mean/min values are descriptive and are not acceptance criteria.

{markdown_table(
    ["Epochs", "Mean accuracy", "Min accuracy", "Mean Macro-F1", "Min Macro-F1", "Mean agreement"],
    epoch_rows,
)}

## Metric definitions

- Accuracy, Macro-F1 and per-class Precision/Recall/F1 use calibrated labels.
- Prediction Agreement compares each calibrated label with native-248.
- Confidence Shift is mean calibrated confidence minus native-248 confidence.
- Calibration Change Rate is calibrated label different from raw label.
- Failure Count is non-finite or non-normalized probability rows.
- Complete per-class calibrated/raw metrics are in CSV and JSON.

## Scope boundary

No threshold or supported minimum was selected. No /v1/infer endpoint, online
classifier, training entry point, checkpoint copy, or Phase D code was added.
"""
    (output_dir / "PHASE_C_VALIDATION_REPORT.md").write_text(report, encoding="utf-8")

    def json_records(frame: pd.DataFrame):
        return (
            frame.astype(object)
            .where(pd.notna(frame), None)
            .to_dict(orient="records")
        )

    payload = {
        "reportVersion": "phase-c-validation-v1",
        "contractVersion": "pasc-contract-v1",
        "modelVersion": "pasc-tcn-haikou-v1",
        "decisionPolicy": {
            "acceptanceThresholdDefined": False,
            "supportedMinimumSelected": False,
            "decisionOwner": "user",
        },
        "provenance": provenance,
        "sampling": sampling,
        "baselineReproduction": baseline_check,
        "overall": json_records(overall),
        "perClass": json_records(per_class),
    }
    (output_dir / "phase_c_results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )

def main():
    default_research = REPOSITORY_ROOT.parent / "fyw0822"
    parser = argparse.ArgumentParser(description="PASC-TCN Phase C offline validation")
    parser.add_argument("--research-root", type=Path, default=default_research)
    parser.add_argument("--output-dir", type=Path, default=SERVICE_ROOT / "phase_c_results")
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--batch-size", type=int, default=1024)
    args = parser.parse_args()

    research_root = args.research_root.resolve()
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    result_root = research_root / "results" / "04_m1_m4"
    paths = {
        "data": research_root / "data" / "real6_near300_per_class_sg_verified_deduplicated.csv",
        "split": result_root / "M2_M3_M4_fixed_real_split.csv",
        "checkpoint": result_root / "fraction_1.00_M4.pth",
        "baselinePredictions": result_root / "fraction_1.00_M4_predictions.csv",
        "modelCode": research_root / "code" / "run_spatial_physics_tcn_patent_prototype.py",
    }
    hashes = {key: assert_hash(path, key) for key, path in paths.items()}
    model_lib, infer_lib = load_formal_modules(research_root)
    model_lib.seed_everything(model_lib.FIXED_SPLIT_SEED)
    data = model_lib.load_real_data(paths["data"])
    train_indices, validation_indices, test_indices = validate_split(
        data, pd.read_csv(paths["split"]), model_lib
    )
    physics_scaled, physics_center, physics_scale = model_lib.robust_scale_physics(
        data.physics, train_indices
    )
    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)
    model = model_lib.PhysicsTCN(
        physics_scaled.shape[1], classes=len(model_lib.CLASS_NAMES), use_spatial=True
    ).to(device)
    model.load_state_dict(
        torch.load(paths["checkpoint"], map_location="cpu", weights_only=True),
        strict=True,
    )
    model.eval()

    reference_series = data.normalized_series[train_indices]
    reference_physics = physics_scaled[train_indices]
    reference_coordinates = data.coordinates_m[train_indices]
    reference_coherence = data.coherence[train_indices]
    nearest = NearestNeighbors(n_neighbors=9, algorithm="kd_tree", n_jobs=-1).fit(
        reference_coordinates
    )
    reference_nodes, _ = infer_lib.encode_reference_nodes(
        model, reference_series, reference_physics, device, args.batch_size
    )

    sampling = build_sampling_manifest(data.time_columns)
    (output_dir / "sampling_indices.json").write_text(
        json.dumps(sampling, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    with (output_dir / "sampling_indices.csv").open(
        "w", encoding="utf-8", newline=""
    ) as stream:
        writer = csv.writer(stream)
        writer.writerow(
            ("scenario", "epochs", "method", "seed", "position", "dateIndex", "dateColumn")
        )
        for scenario in sampling["scenarios"]:
            for position, (index, column) in enumerate(
                zip(scenario["indices"], scenario["dateColumns"])
            ):
                writer.writerow(
                    (
                        scenario["scenario"],
                        scenario["epochs"],
                        scenario["method"],
                        "" if scenario["seed"] is None else scenario["seed"],
                        position,
                        index,
                        column,
                    )
                )

    dates = pd.to_datetime([column[1:] for column in data.time_columns], format="%Y%m%d")
    day_offsets = (dates - dates[0]).days.to_numpy(dtype=np.float32)
    test_raw = data.raw_series[test_indices]
    test_labels = data.labels[test_indices]
    test_velocity = pd.to_numeric(
        data.frame.iloc[test_indices]["Vel"], errors="coerce"
    ).fillna(0.0).to_numpy(np.float32)
    test_coherence = data.coherence[test_indices]
    baseline = None
    baseline_check = {}
    overall_rows, class_rows, prediction_rows = [], [], []

    for scenario in sampling["scenarios"]:
        selected = np.asarray(scenario["indices"], dtype=np.int64)
        if scenario["method"] == "baseline":
            query_series = data.normalized_series[test_indices]
            query_physics = physics_scaled[test_indices]
        else:
            adapted, target_years = adapt_selected_series(test_raw, day_offsets, selected)
            query_series, _, _ = rowwise_zscore(adapted)
            raw_physics = extract_physical_features(
                adapted, target_years, test_velocity, test_coherence
            )
            query_physics = np.clip(
                (raw_physics - physics_center) / physics_scale, -8.0, 8.0
            ).astype(np.float32)

        neighbor_indices, weights, reliability = infer_lib.query_reference_neighbors(
            data.coordinates_m[test_indices],
            query_series,
            test_coherence,
            nearest,
            reference_series,
            reference_coherence,
            8,
            500.0,
            180.0,
        )
        raw_probabilities, gates = infer_lib.infer_chunk(
            model,
            query_series,
            query_physics,
            neighbor_indices,
            weights,
            reliability,
            reference_nodes,
            device,
            args.batch_size,
        )
        calibrated = calibrate_probabilities(
            raw_probabilities, DYNAMIC_PROBABILITY_BOOST
        )
        overall, per_class, detail = calculate_metrics(
            test_labels, raw_probabilities, calibrated, baseline
        )
        overall.update(
            {
                "scenario": scenario["scenario"],
                "epochs": scenario["epochs"],
                "method": scenario["method"],
                "seed": scenario["seed"],
                "meanSpatialReliability": float(np.mean(reliability)),
                "meanSpatialGate": float(np.mean(gates)),
            }
        )
        overall_rows.append(overall)
        for values in per_class:
            values.update(
                {
                    "scenario": scenario["scenario"],
                    "epochs": scenario["epochs"],
                    "method": scenario["method"],
                    "className": model_lib.CLASS_NAMES[values["classId"]],
                }
            )
            class_rows.append(values)
        for local, raw_label, label, raw_conf, confidence in zip(
            np.flatnonzero(detail["valid"]),
            detail["rawPredictions"],
            detail["predictions"],
            detail["rawConfidence"],
            detail["confidence"],
        ):
            row_index = int(test_indices[local])
            prediction_rows.append(
                {
                    "scenario": scenario["scenario"],
                    "epochs": scenario["epochs"],
                    "method": scenario["method"],
                    "rowIndex": row_index,
                    "fid": str(data.frame.iloc[row_index]["fid"]),
                    "trueLabel": int(test_labels[local]),
                    "rawPredictedLabel": int(raw_label),
                    "predictedLabel": int(label),
                    "rawConfidence": float(raw_conf),
                    "confidence": float(confidence),
                    "spatialReliability": float(reliability[local]),
                    "spatialGate": float(gates[local]),
                }
            )
        if baseline is None:
            baseline = {
                "predictions": calibrated.argmax(axis=1),
                "confidence": calibrated.max(axis=1),
            }
            existing = pd.read_csv(paths["baselinePredictions"])
            if existing["Row_Index"].astype(int).tolist() != test_indices.tolist():
                raise RuntimeError("existing baseline row order changed")
            labels_matched = int(
                np.sum(
                    existing["Predicted_Label"].to_numpy(np.int64)
                    == raw_probabilities.argmax(axis=1)
                )
            )
            maximum_difference = float(
                np.max(
                    np.abs(
                        existing["Confidence"].to_numpy(np.float64)
                        - raw_probabilities.max(axis=1)
                    )
                )
            )
            if labels_matched != 523 or maximum_difference > 5e-5:
                raise RuntimeError(
                    "native-248 baseline reproduction failed: "
                    f"labels={labels_matched}/523, maxConfidenceDiff={maximum_difference}"
                )
            baseline_check = {
                "rows": 523,
                "labelsMatched": labels_matched,
                "maxConfidenceDifference": maximum_difference,
                "confidenceTolerance": 5e-5,
            }
        print(
            f'{scenario["scenario"]}: accuracy={overall["accuracy"]:.6f}, '
            f'macroF1={overall["macroF1"]:.6f}, failures={overall["failureCount"]}'
        )

    overall_frame = pd.DataFrame(overall_rows)
    class_frame = pd.DataFrame(class_rows)
    predictions_frame = pd.DataFrame(prediction_rows)
    overall_frame.to_csv(
        output_dir / "phase_c_overall_metrics.csv", index=False, encoding="utf-8-sig"
    )
    class_frame.to_csv(
        output_dir / "phase_c_per_class_metrics.csv", index=False, encoding="utf-8-sig"
    )
    predictions_frame.to_csv(
        output_dir / "phase_c_predictions.csv", index=False, encoding="utf-8-sig"
    )
    provenance = {
        "researchRoot": str(research_root),
        "hashes": hashes,
        "fixedSplitSeed": int(model_lib.FIXED_SPLIT_SEED),
        "trainRows": len(train_indices),
        "validationRows": len(validation_indices),
        "testRows": len(test_indices),
        "classOrder": list(model_lib.CLASS_NAMES),
        "dynamicProbabilityBoost": DYNAMIC_PROBABILITY_BOOST,
        "neighbors": 8,
        "radiusMeters": 500.0,
        "distanceScaleMeters": 180.0,
        "device": str(device),
        "python": platform.python_version(),
        "torch": torch.__version__,
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "physicsScalerCenter": [float(value) for value in physics_center],
        "physicsScalerScale": [float(value) for value in physics_scale],
    }
    render_figure(overall_frame, output_dir)
    write_reports(
        output_dir, overall_frame, class_frame, provenance, sampling, baseline_check
    )


if __name__ == "__main__":
    main()
