"""Deterministic Phase C sampling and calibration helpers.

This module contains no model loading and defines no acceptance threshold.
"""

from __future__ import annotations

import hashlib
import json
from typing import Iterable

import numpy as np

SOURCE_EPOCHS = 248
PHASE_C_SEED = 20260824
EPOCH_GROUPS = (160, 120, 80, 60, 40)
SAMPLING_METHODS = (
    "uniform",
    "random_missing",
    "continuous_gap",
    "front_dense_back_sparse",
    "front_sparse_back_dense",
)
DYNAMIC_CLASS_IDS = (2, 3, 4)
DYNAMIC_PROBABILITY_BOOST = 1.35


def scenario_seed(epochs: int, method: str) -> int:
    if method not in SAMPLING_METHODS:
        raise ValueError(f"unknown sampling method: {method}")
    return PHASE_C_SEED + epochs * 100 + SAMPLING_METHODS.index(method)


def _uniform_segment(start: int, stop: int, count: int) -> np.ndarray:
    if count == 0:
        return np.empty(0, dtype=np.int64)
    available = stop - start + 1
    if count < 0 or count > available:
        raise ValueError("segment count is outside the available range")
    if count == 1:
        return np.asarray([start], dtype=np.int64)
    selected = np.rint(np.linspace(start, stop, count)).astype(np.int64)
    if len(np.unique(selected)) != count:
        raise AssertionError("uniform selection produced duplicate indices")
    return selected


def sampling_indices(
    epochs: int,
    method: str,
    *,
    source_epochs: int = SOURCE_EPOCHS,
) -> np.ndarray:
    """Return sorted, unique, endpoint-preserving indices for one scenario."""
    if source_epochs != SOURCE_EPOCHS:
        raise ValueError(f"Phase C source must have {SOURCE_EPOCHS} epochs")
    if epochs not in EPOCH_GROUPS:
        raise ValueError(f"unsupported Phase C epoch group: {epochs}")
    if method not in SAMPLING_METHODS:
        raise ValueError(f"unknown sampling method: {method}")

    if method == "uniform":
        selected = _uniform_segment(0, source_epochs - 1, epochs)
    elif method == "random_missing":
        rng = np.random.default_rng(scenario_seed(epochs, method))
        interior = rng.choice(
            np.arange(1, source_epochs - 1),
            size=epochs - 2,
            replace=False,
        )
        selected = np.sort(np.concatenate(([0], interior, [source_epochs - 1])))
    elif method == "continuous_gap":
        gap_size = source_epochs - epochs
        rng = np.random.default_rng(scenario_seed(epochs, method))
        gap_start = int(rng.integers(1, source_epochs - gap_size))
        missing = np.arange(gap_start, gap_start + gap_size)
        selected = np.setdiff1d(np.arange(source_epochs), missing, assume_unique=True)
    else:
        dense_count = int(np.ceil(epochs * 0.70))
        sparse_count = epochs - dense_count
        if method == "front_dense_back_sparse":
            front_count, back_count = dense_count, sparse_count
        else:
            front_count, back_count = sparse_count, dense_count
        selected = np.concatenate(
            (
                _uniform_segment(0, source_epochs // 2 - 1, front_count),
                _uniform_segment(source_epochs // 2, source_epochs - 1, back_count),
            )
        )

    selected = np.asarray(selected, dtype=np.int64)
    if len(selected) != epochs:
        raise AssertionError(f"{method}/{epochs} selected {len(selected)} indices")
    if len(np.unique(selected)) != epochs or np.any(np.diff(selected) <= 0):
        raise AssertionError(f"{method}/{epochs} indices are not strictly increasing")
    if selected[0] != 0 or selected[-1] != source_epochs - 1:
        raise AssertionError(f"{method}/{epochs} must preserve both endpoints")
    return selected


def build_sampling_manifest(time_columns: Iterable[str]) -> dict:
    columns = list(time_columns)
    if len(columns) != SOURCE_EPOCHS:
        raise ValueError(f"expected {SOURCE_EPOCHS} dates, got {len(columns)}")
    scenarios = [
        {
            "scenario": "baseline_248",
            "epochs": SOURCE_EPOCHS,
            "method": "baseline",
            "seed": None,
            "indices": list(range(SOURCE_EPOCHS)),
            "dateColumns": columns,
        }
    ]
    for epochs in EPOCH_GROUPS:
        for method in SAMPLING_METHODS:
            selected = sampling_indices(epochs, method)
            scenarios.append(
                {
                    "scenario": f"{method}_{epochs}",
                    "epochs": epochs,
                    "method": method,
                    "seed": scenario_seed(epochs, method),
                    "indices": selected.tolist(),
                    "dateColumns": [columns[index] for index in selected],
                }
            )
    canonical = json.dumps(scenarios, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return {
        "manifestVersion": "phase-c-sampling-v1",
        "sourceEpochs": SOURCE_EPOCHS,
        "baseSeed": PHASE_C_SEED,
        "endpointPolicy": "always_preserve_first_and_last",
        "scenarios": scenarios,
        "sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    }


def adapt_selected_series(
    raw_series: np.ndarray,
    day_offsets: np.ndarray,
    selected: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Apply the Phase B relative-time linear Adapter to shared selected dates."""
    raw = np.asarray(raw_series, dtype=np.float32)
    days = np.asarray(day_offsets, dtype=np.float32)
    indices = np.asarray(selected, dtype=np.int64)
    if raw.ndim != 2 or raw.shape[1] != SOURCE_EPOCHS:
        raise ValueError("raw_series must be [rows, 248]")
    if len(days) != SOURCE_EPOCHS:
        raise ValueError("day_offsets must contain 248 values")
    if indices[0] != 0 or indices[-1] != SOURCE_EPOCHS - 1:
        raise ValueError("Phase C selections must preserve full temporal coverage")

    selected_days = days[indices]
    span = float(selected_days[-1] - selected_days[0])
    relative = (selected_days - selected_days[0]) / np.float32(span)
    target_relative = np.linspace(0.0, 1.0, SOURCE_EPOCHS, dtype=np.float32)
    adapted = np.vstack(
        [
            np.interp(target_relative, relative, row[indices]).astype(np.float32)
            for row in raw
        ]
    )
    target_years = target_relative * np.float32(span) / np.float32(365.25)
    return adapted.astype(np.float32), target_years.astype(np.float32)


def calibrate_probabilities(
    probabilities: np.ndarray,
    boost: float = DYNAMIC_PROBABILITY_BOOST,
) -> np.ndarray:
    values = np.asarray(probabilities, dtype=np.float32).copy()
    if values.ndim != 2 or values.shape[1] != 6:
        raise ValueError("probabilities must have six columns")
    values[:, list(DYNAMIC_CLASS_IDS)] *= np.float32(boost)
    totals = values.sum(axis=1, keepdims=True)
    if np.any(~np.isfinite(totals)) or np.any(totals <= 0):
        raise ValueError("probabilities cannot be calibrated")
    return (values / totals).astype(np.float32)
