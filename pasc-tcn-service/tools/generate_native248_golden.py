"""Generate the deterministic native-248 oracle fixture from the formal flow.

This is intentionally independent of pasc_tcn_service. Its formulas are a compact
copy of the frozen implementation identified by the hashes embedded below.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import datetime
from pathlib import Path

import numpy as np

SOURCE_SHA256 = "e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265"
FEATURE_SOURCE_SHA256 = "16e4de4a65c8861647103dbafB7758a5236761faab158657fe4abfbe8d64186c".lower()
REPORT_SHA256 = "26ac2302cd6566fd54a391aa9fb54ee382075be0f8a3effbeaf49be208c74ed5"
ROW_INDICES = (0, 871, 1741)
EPSILON = 1e-5
CENTER = np.asarray(
    [
        -63.964996337890625, -8.14146614074707, -7.276299953460693,
        -7.185040473937988, -0.041277118027210236, 148.2306671142578,
        36.75532531738281, 5.767745018005371, 75.60000610351562,
        0.5951417088508606, 0.8873493671417236, -6.4817657470703125,
        0.6355669498443604,
    ],
    dtype=np.float32,
)
SCALE = np.asarray(
    [
        55.32749938964844, 7.578825950622559, 11.381746292114258,
        11.533498764038086, 1.6051785945892334, 90.24764251708984,
        9.139708518981934, 4.679878234863281, 49.46750259399414,
        0.09412956237792969, 1.4975991249084473, 6.599137783050537,
        0.2950817942619324,
    ],
    dtype=np.float32,
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def rowwise_zscore(values):
    values = values.astype(np.float32, copy=True)
    values[~np.isfinite(values)] = np.nan
    means = np.nanmean(values, axis=1, keepdims=True)
    means = np.where(np.isfinite(means), means, 0.0)
    values = np.where(np.isfinite(values), values, means)
    stds = np.std(values, axis=1, keepdims=True)
    return ((values - means) / (stds + EPSILON)).astype(np.float32)


def linear_slope(time_years, values):
    centered_time = time_years - np.mean(time_years)
    denominator = np.sum(centered_time**2) + 1e-8
    return np.sum(
        (values - np.mean(values, axis=1, keepdims=True)) * centered_time,
        axis=1,
    ) / denominator


def physical_features(raw_series, time_columns, velocity, coherence):
    dates = [datetime.strptime(column[1:], "%Y%m%d") for column in time_columns]
    days = np.asarray([(item - dates[0]).days for item in dates], dtype=np.float32)
    years = days / 365.25
    duration = max(float(years[-1] - years[0]), 1e-6)
    n = raw_series.shape[1]
    third = max(n // 3, 5)
    total = raw_series[:, -1] - raw_series[:, 0]
    slope = linear_slope(years, raw_series)
    early = linear_slope(years[:third], raw_series[:, :third])
    late = linear_slope(years[-third:], raw_series[:, -third:])
    acceleration = (late - early) / duration
    dt = np.diff(years)
    rate = np.diff(raw_series, axis=1) / np.maximum(dt[None, :], 1e-5)
    rate_jump = np.max(np.abs(np.diff(rate, axis=1)), axis=1)
    curvature_rms = np.sqrt(np.mean(np.diff(rate, axis=1) ** 2, axis=1))
    fitted = raw_series[:, :1] + slope[:, None] * years[None, :]
    linear_residual = np.std(raw_series - fitted, axis=1)
    amplitude = np.max(raw_series, axis=1) - np.min(raw_series, axis=1)
    monotonic = np.mean(np.diff(raw_series, axis=1) <= 0, axis=1)
    ratio = np.abs(late) / (np.abs(early) + 0.5)
    output = np.column_stack(
        [
            total, slope, early, late, acceleration, rate_jump, curvature_rms,
            linear_residual, amplitude, monotonic, ratio, velocity, coherence,
        ]
    )
    return np.nan_to_num(output, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    actual_hash = sha256(args.source)
    if actual_hash != SOURCE_SHA256:
        raise SystemExit(f"unexpected source hash: {actual_hash}")

    selected = {}
    with args.source.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        time_columns = sorted(
            [field for field in reader.fieldnames if field.startswith("D")],
            key=lambda field: datetime.strptime(field[1:], "%Y%m%d"),
        )
        if len(time_columns) != 248:
            raise SystemExit(f"expected 248 dates, got {len(time_columns)}")
        for index, row in enumerate(reader):
            if index in ROW_INDICES:
                selected[index] = row
    if tuple(selected) != ROW_INDICES:
        raise SystemExit("not all golden rows were found")

    records = []
    raw_rows = []
    velocities = []
    coherences = []
    for index in ROW_INDICES:
        source = selected[index]
        record = {
            "fid": source["fid"],
            "xpos": float(source["xpos"]),
            "ypos": float(source["ypos"]),
            "Vel": float(source["Vel"]),
            "coherence": float(source["coherence"]),
        }
        for field in time_columns:
            record[field] = float(source[field])
        records.append(record)
        raw_rows.append([float(source[field]) for field in time_columns])
        velocities.append(float(source["Vel"]))
        coherences.append(float(source["coherence"]))

    raw = np.asarray(raw_rows, dtype=np.float32)
    normalized = rowwise_zscore(raw)
    velocity = np.asarray(velocities, dtype=np.float32)
    coherence = np.clip(np.asarray(coherences, dtype=np.float32), 0.0, 1.0)
    feature_raw = physical_features(raw, time_columns, velocity, coherence)
    feature_scaled = np.clip((feature_raw - CENTER) / SCALE, -8.0, 8.0).astype(np.float32)

    expected = []
    dates = [
        datetime.strptime(field[1:], "%Y%m%d").date().isoformat()
        for field in time_columns
    ]
    for index, row in enumerate(records):
        expected.append(
            {
                "pointId": str(row["fid"]),
                "targetDates": dates,
                "preprocessedSeriesMm": [float(value) for value in raw[index]],
                "normalizedSeries": [float(value) for value in normalized[index]],
                "featuresRaw": [float(value) for value in feature_raw[index]],
                "featuresScaled": [float(value) for value in feature_scaled[index]],
                "velocityMmPerYear": float(velocity[index]),
                "coherence": float(coherence[index]),
            }
        )

    fixture = {
        "fixtureVersion": "native248-golden-v1",
        "source": {
            "path": "data/real6_near300_per_class_sg_verified_deduplicated.csv",
            "sha256": actual_hash,
            "rowIndices": list(ROW_INDICES),
            "featureImplementationSha256": FEATURE_SOURCE_SHA256,
            "fullAreaReportSha256": REPORT_SHA256,
        },
        "request": {
            "contractVersion": "pasc-contract-v1",
            "datasetName": "formal-native248-golden",
            "mapping": {
                "pointId": "fid",
                "longitude": "xpos",
                "latitude": "ypos",
                "velocity": "Vel",
                "coherence": "coherence",
                "dateColumns": time_columns,
            },
            "settings": {
                "displacementUnit": "mm",
                "velocityUnit": "mm/year",
                "signConvention": "model_native",
                "preprocessingState": "already_smoothed",
            },
            "records": records,
        },
        "expected": expected,
        "tolerances": {"absolute": 1e-5, "relative": 1e-6},
    }
    args.output.write_text(
        json.dumps(fixture, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
