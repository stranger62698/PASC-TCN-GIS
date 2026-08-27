"""Authoritative Phase B preprocessing. This module never loads a model."""

from __future__ import annotations

import json
import math
from datetime import timedelta
from importlib.resources import files
from typing import Any

import numpy as np

from .contract import (
    CONTRACT_VERSION,
    FEATURE_NAMES,
    FORMAL_VALIDATION_MIN_EPOCHS,
    MIN_EXPERIMENTAL_EPOCHS,
    MODEL_VERSION,
    SERVICE_VERSION,
    SG_POLYORDER,
    SG_WINDOW,
    SENTINEL_CADENCE_DAYS,
    SIGN_FACTORS_TO_MODEL_NATIVE,
    TARGET_EPOCHS,
    ZSCORE_EPSILON,
    DISPLACEMENT_FACTORS_TO_MM,
    VELOCITY_FACTORS_TO_MM_PER_YEAR,
)
from .errors import MESSAGES, ServiceError
from .schema import ValidatedDataset, inspect_payload
from .security import seal_preprocessed


def _load_scaler() -> dict[str, Any]:
    asset = files("pasc_tcn_service").joinpath("assets/physics_scaler.json")
    scaler = json.loads(asset.read_text(encoding="utf-8"))
    if tuple(scaler["featureOrder"]) != FEATURE_NAMES:
        raise RuntimeError("Frozen Scaler feature order does not match the contract.")
    if not math.isclose(float(scaler["zscoreEpsilon"]), ZSCORE_EPSILON):
        raise RuntimeError("Frozen Scaler Z-score epsilon does not match the contract.")
    if len(scaler["center"]) != len(FEATURE_NAMES) or len(scaler["scale"]) != len(FEATURE_NAMES):
        raise RuntimeError("Frozen Scaler dimensions are invalid.")
    return scaler


SCALER = _load_scaler()
SCALER_CENTER = np.asarray(SCALER["center"], dtype=np.float32)
SCALER_SCALE = np.asarray(SCALER["scale"], dtype=np.float32)


def rowwise_zscore(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Match the frozen training implementation, including float32 and epsilon."""
    values = np.asarray(values).astype(np.float32, copy=True)
    values[~np.isfinite(values)] = np.nan
    means = np.nanmean(values, axis=1, keepdims=True)
    means = np.where(np.isfinite(means), means, 0.0)
    values = np.where(np.isfinite(values), values, means)
    stds = np.std(values, axis=1, keepdims=True)
    normalized = ((values - means) / (stds + ZSCORE_EPSILON)).astype(np.float32)
    return normalized, means.astype(np.float32), stds.astype(np.float32)


def linear_slope(time_years: np.ndarray, values: np.ndarray) -> np.ndarray:
    time_years = np.asarray(time_years, dtype=np.float32)
    values = np.asarray(values, dtype=np.float32)
    centered_time = time_years - np.mean(time_years)
    denominator = np.sum(centered_time**2) + 1e-8
    return np.sum(
        (values - np.mean(values, axis=1, keepdims=True)) * centered_time,
        axis=1,
    ) / denominator


def extract_physical_features(
    raw_series: np.ndarray,
    years: np.ndarray,
    velocity: np.ndarray,
    coherence: np.ndarray,
) -> np.ndarray:
    """Frozen 13-feature definition from the formal PASC-TCN implementation."""
    raw_series = np.asarray(raw_series, dtype=np.float32)
    years = np.asarray(years, dtype=np.float32)
    velocity = np.asarray(velocity, dtype=np.float32)
    coherence = np.asarray(coherence, dtype=np.float32)
    duration = max(float(years[-1] - years[0]), 1e-6)
    n = raw_series.shape[1]
    third = max(n // 3, 5)

    total = raw_series[:, -1] - raw_series[:, 0]
    slope = linear_slope(years, raw_series)
    early_slope = linear_slope(years[:third], raw_series[:, :third])
    late_slope = linear_slope(years[-third:], raw_series[:, -third:])
    acceleration = (late_slope - early_slope) / duration

    dt = np.diff(years)
    rate = np.diff(raw_series, axis=1) / np.maximum(dt[None, :], 1e-5)
    rate_jump = np.max(np.abs(np.diff(rate, axis=1)), axis=1)
    curvature_rms = np.sqrt(np.mean(np.diff(rate, axis=1) ** 2, axis=1))

    fitted = raw_series[:, :1] + slope[:, None] * years[None, :]
    linear_residual = np.std(raw_series - fitted, axis=1)
    amplitude = np.max(raw_series, axis=1) - np.min(raw_series, axis=1)
    monotonic_subsidence = np.mean(np.diff(raw_series, axis=1) <= 0, axis=1)
    late_early_ratio = np.abs(late_slope) / (np.abs(early_slope) + 0.5)

    features = np.column_stack(
        [
            total,
            slope,
            early_slope,
            late_slope,
            acceleration,
            rate_jump,
            curvature_rms,
            linear_residual,
            amplitude,
            monotonic_subsidence,
            late_early_ratio,
            velocity,
            coherence,
        ]
    )
    return np.nan_to_num(features, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)


def scale_physical_features(features: np.ndarray) -> np.ndarray:
    """Apply the frozen training Scaler. Fitting user data is deliberately absent."""
    low, high = (float(item) for item in SCALER["clip"])
    return np.clip(
        (np.asarray(features, dtype=np.float32) - SCALER_CENTER) / SCALER_SCALE,
        low,
        high,
    ).astype(np.float32)


def savgol_filter_9_3(values: np.ndarray) -> np.ndarray:
    """Savitzky-Golay window=9/polyorder=3 with SciPy-compatible interp edges."""
    series = np.asarray(values, dtype=np.float64)
    if series.ndim != 1 or len(series) < SG_WINDOW:
        raise ServiceError(
            "PASC_PREPROCESS_FAILED",
            "SG平滑要求至少9个标准节点。",
            details={"window": SG_WINDOW, "polyorder": SG_POLYORDER},
        )

    half = SG_WINDOW // 2
    offsets = np.arange(-half, half + 1, dtype=np.float64)
    basis = np.vander(offsets, N=SG_POLYORDER + 1, increasing=True)
    center_weights = np.linalg.pinv(basis)[0]
    result = np.empty_like(series)
    for index in range(half, len(series) - half):
        result[index] = center_weights @ series[index - half : index + half + 1]

    left_x = np.arange(SG_WINDOW, dtype=np.float64)
    left_basis = np.vander(left_x, N=SG_POLYORDER + 1, increasing=True)
    left_coefficients = np.linalg.lstsq(left_basis, series[:SG_WINDOW], rcond=None)[0]
    result[:half] = np.polynomial.polynomial.polyval(left_x[:half], left_coefficients)

    right_x = np.arange(len(series) - SG_WINDOW, len(series), dtype=np.float64)
    right_origin = right_x[0]
    right_basis = np.vander(
        right_x - right_origin,
        N=SG_POLYORDER + 1,
        increasing=True,
    )
    right_coefficients = np.linalg.lstsq(
        right_basis,
        series[-SG_WINDOW:],
        rcond=None,
    )[0]
    result[-half:] = np.polynomial.polynomial.polyval(
        right_x[-half:] - right_origin,
        right_coefficients,
    )
    return result.astype(np.float32)


def _finite(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _merged_original(dataset: ValidatedDataset, row: dict[str, Any]):
    dates = []
    values = []
    for group in dataset.date_groups:
        finite = [
            number
            for number in (_finite(row.get(column.source)) for column in group)
            if number is not None
        ]
        if finite:
            dates.append(group[0].value)
            values.append(finite[0])
    return dates, np.asarray(values, dtype=np.float32)


def _regularize_to_sentinel_cadence(
    original_dates,
    original_values: np.ndarray,
    grid_start,
    grid_end,
) -> tuple[np.ndarray, np.ndarray, list[str], bool]:
    day_offsets = np.asarray(
        [(item - grid_start).days for item in original_dates],
        dtype=np.float32,
    )
    span = float((grid_end - grid_start).days)
    if span <= 0:
        raise ServiceError("PASC_PREPROCESS_FAILED", "有效日期跨度必须大于0。")
    target_days = np.arange(
        0.0,
        span + 1.0,
        float(SENTINEL_CADENCE_DAYS),
        dtype=np.float32,
    )
    if len(target_days) < SG_WINDOW:
        raise ServiceError(
            "PASC_PREPROCESS_FAILED",
            "按12天时间分辨率重建后不足9个节点，无法执行SG平滑。",
            details={"regularizedEpochs": len(target_days), "minimum": SG_WINDOW},
        )
    regularized = np.interp(target_days, day_offsets, original_values).astype(np.float32)
    exact_grid = len(day_offsets) == len(target_days) and np.array_equal(day_offsets, target_days)
    target_dates = [
        (grid_start + timedelta(days=int(offset))).isoformat()
        for offset in target_days
    ]
    return (
        regularized,
        (target_days / np.float32(365.25)).astype(np.float32),
        target_dates,
        not exact_grid,
    )


def _validation_error(dataset: ValidatedDataset) -> ServiceError | None:
    failures = [item for item in dataset.issues if item["severity"] == "error"]
    if not failures:
        return None
    priority = (
        "PASC_DUPLICATE_DATE_CONFLICT",
        "PASC_CONTRACT_VERSION_UNSUPPORTED",
        "PASC_DATE_PARSE_FAILED",
        "PASC_SCHEMA_UNRESOLVED",
        "PASC_UNIT_CONFIRMATION_REQUIRED",
        "PASC_SIGN_CONFIRMATION_REQUIRED",
        "PASC_PREPROCESSING_STATE_REQUIRED",
        "PASC_BAD_REQUEST",
    )
    selected = next(
        (item for code in priority for item in failures if item["code"] == code),
        failures[0],
    )
    return ServiceError(
        selected["code"],
        selected["message"],
        details={"issues": failures},
    )


def _value(row: dict[str, Any], field: str | None) -> Any:
    return row.get(field) if field else None


def _json_floats(values: np.ndarray) -> list[float]:
    return [float(item) for item in np.asarray(values).reshape(-1)]


def _preprocess_point(
    dataset: ValidatedDataset,
    row: dict[str, Any],
    point_report: dict[str, Any],
) -> dict[str, Any]:
    point_id = point_report["pointId"]
    base_audit = {
        "contractVersion": CONTRACT_VERSION,
        "serviceVersion": SERVICE_VERSION,
        "mapping": dataset.mapping_report,
        "settings": dataset.settings,
        "pipeline": [
            "mapping",
            "date_parse_sort_deduplicate",
            "unit_conversion",
            "sign_normalization",
            "missing_and_effective_epochs",
            "velocity",
            "regularize_calendar_to_12_day_grid",
            "savgol",
            "rowwise_zscore",
            "physical_features_13",
            "frozen_scaler",
        ],
        "modelExecuted": False,
    }

    if not point_report["supported"]:
        return {
            "pointId": point_id,
            "status": "unsupported",
            "reason": point_report["reason"],
            "quality": {
                "effectiveEpochs": point_report["effectiveEpochs"],
                "targetEpochs": TARGET_EPOCHS,
            },
            "audit": base_audit,
        }

    original_dates, original_values = _merged_original(dataset, row)
    displacement_factor = DISPLACEMENT_FACTORS_TO_MM[dataset.settings["displacementUnit"]]
    sign_factor = SIGN_FACTORS_TO_MODEL_NATIVE[dataset.settings["signConvention"]]
    original_values = (
        original_values.astype(np.float32)
        * np.float32(displacement_factor)
        * np.float32(sign_factor)
    )

    grid_start = dataset.date_groups[0][0].value
    grid_end = dataset.date_groups[-1][0].value
    adapted, years, target_dates, adapter_applied = _regularize_to_sentinel_cadence(
        original_dates,
        original_values,
        grid_start,
        grid_end,
    )
    preprocessing_state = dataset.settings["preprocessingState"]
    gap_days = np.asarray(
        [(right - left).days for left, right in zip(original_dates, original_dates[1:])],
        dtype=np.float32,
    )
    median_gap_days = float(np.median(gap_days))
    cadence_status = (
        "sentinel_12_day_like"
        if 9.0 <= median_gap_days <= 15.0
        else "non_12_day_cadence"
    )
    warnings: list[dict[str, str]] = []
    if len(original_values) < FORMAL_VALIDATION_MIN_EPOCHS:
        warnings.append(
            {
                "code": "PASC_20_TO_39_EXPLORATORY",
                "message": "原始有效观测仅20—39期；已先按日期补齐为12天等间隔序列，仅供探索性判读。",
            }
        )
    if cadence_status == "non_12_day_cadence":
        warnings.append(
            {
                "code": "PASC_NON_SENTINEL_CADENCE",
                "message": f"中位时相间隔为{median_gap_days:.1f}天；已先按实际日期线性插值到12天等间隔网格，再执行后续处理。",
            }
        )
    if preprocessing_state == "raw":
        processed = savgol_filter_9_3(adapted)
        noise_residual_std: float | None = float(
            np.std(adapted.astype(np.float32) - processed)
        )
        smoothing = {
            "applied": True,
            "method": "savgol",
            "window": SG_WINDOW,
            "polyorder": SG_POLYORDER,
        }
    else:
        processed = adapted.astype(np.float32, copy=True)
        noise_residual_std = None
        smoothing = {
            "applied": False,
            "method": "skip_already_smoothed",
            "window": None,
            "polyorder": None,
        }

    velocity_field = dataset.mapping.get("velocity")
    provided_velocity = _finite(_value(row, velocity_field))
    if provided_velocity is None:
        original_days = np.asarray(
            [(item - original_dates[0]).days for item in original_dates],
            dtype=np.float32,
        )
        original_years = original_days / np.float32(365.25)
        velocity = float(linear_slope(original_years, original_values[None, :])[0])
        velocity_source = "calculated"
        velocity_method = "least_squares_real_dates"
    else:
        velocity = (
            provided_velocity
            * VELOCITY_FACTORS_TO_MM_PER_YEAR[dataset.settings["velocityUnit"]]
            * sign_factor
        )
        velocity_source = "provided"
        velocity_method = "provided_field"

    coherence_field = dataset.mapping.get("coherence")
    provided_coherence = _finite(_value(row, coherence_field))
    if provided_coherence is None:
        coherence = float(SCALER["coherenceDefault"])
        coherence_source = "default"
        warnings.append(
            {
                "code": "PASC_COHERENCE_DEFAULTED",
                "message": "缺少相干性，使用冻结模型包默认值0.5。",
            }
        )
    else:
        coherence = float(np.clip(provided_coherence, 0.0, 1.0))
        coherence_source = "provided"
        if not math.isclose(coherence, provided_coherence):
            warnings.append(
                {
                    "code": "PASC_COHERENCE_CLIPPED",
                    "message": "相干性已裁剪到[0,1]。",
                }
            )

    normalized, means, stds = rowwise_zscore(processed[None, :])
    features_raw = extract_physical_features(
        processed[None, :],
        years,
        np.asarray([velocity], dtype=np.float32),
        np.asarray([coherence], dtype=np.float32),
    )
    features_scaled = scale_physical_features(features_raw)

    original_iso = [item.isoformat() for item in original_dates]
    quality = {
        "effectiveEpochs": len(original_values),
        "missingEpochs": len(dataset.date_groups) - len(original_values),
        "originalStart": original_iso[0],
        "originalEnd": original_iso[-1],
        "missingRate": (
            (len(dataset.date_groups) - len(original_values)) / len(dataset.date_groups)
        ),
        "medianGapDays": median_gap_days,
        "cadenceStatus": cadence_status,
        "maximumGapDays": max(
            (right - left).days
            for left, right in zip(original_dates, original_dates[1:])
        ),
        "originalSpanDays": (original_dates[-1] - original_dates[0]).days,
        "adapterApplied": adapter_applied,
        "adapterMethod": "linear_calendar_12_day_grid" if adapter_applied else "native_12_day_grid_bypass",
        "regularizedEpochs": len(target_dates),
        "cadenceDays": SENTINEL_CADENCE_DAYS,
        "smoothing": smoothing,
        "noiseResidualStd": noise_residual_std,
        "seriesMean": float(means[0, 0]),
        "noiseResidualStatus": "available" if noise_residual_std is not None else "not_available",
        "seriesStd": float(stds[0, 0]),
        "zscoreEpsilon": ZSCORE_EPSILON,
        "warnings": warnings,
    }
    base_audit.update(
        {
            "originalDates": original_iso,
            "originalValuesMm": _json_floats(original_values),
            "velocitySource": velocity_source,
            "coherenceSource": coherence_source,
            "velocityMethod": velocity_method,
            "adapter": {
                "applied": adapter_applied,
                "method": quality["adapterMethod"],
                "targetEpochs": len(target_dates),
                "cadenceDays": SENTINEL_CADENCE_DAYS,
            },
            "smoothing": smoothing,
            "featureOrder": list(FEATURE_NAMES),
            "scalerArtifactVersion": SCALER["artifactVersion"],
        }
    )

    return {
        "pointId": point_id,
        "longitude": float(_value(row, dataset.mapping["longitude"])),
        "latitude": float(_value(row, dataset.mapping["latitude"])),
        "status": "native_248" if not adapter_applied and len(target_dates) == TARGET_EPOCHS else "adapted_experimental",
        "targetDates": target_dates,
        "preprocessedSeriesMm": _json_floats(processed),
        "normalizedSeries": _json_floats(normalized[0]),
        "normalization": {
            "mean": float(means[0, 0]),
            "std": float(stds[0, 0]),
            "epsilon": ZSCORE_EPSILON,
        },
        "features": {
            "order": list(FEATURE_NAMES),
            "raw": _json_floats(features_raw[0]),
            "scaled": _json_floats(features_scaled[0]),
        },
        "velocity": {
            "valueMmPerYear": float(np.float32(velocity)),
            "source": velocity_source,
            "method": velocity_method,
        },
        "coherence": {
            "value": coherence,
            "source": coherence_source,
        },
        "applicability": {
            "temporal": "native" if not adapter_applied else "experimental",
            "spatial": "not_evaluated_in_phase_b",
        },
        "quality": quality,
        "audit": base_audit,
    }


def _preprocess_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate and preprocess records into 248 nodes and frozen physical features."""
    dataset = inspect_payload(payload)
    failure = _validation_error(dataset)
    if failure:
        raise failure

    points = [
        _preprocess_point(dataset, row, point_report)
        for row, point_report in zip(dataset.rows, dataset.point_reports)
    ]
    return {
        "contractVersion": CONTRACT_VERSION,
        "serviceVersion": SERVICE_VERSION,
        "modelVersion": MODEL_VERSION,
        "operation": "preprocess_only",
        "inferenceAvailable": False,
        "validation": dataset.report,
        "scaler": {
            "artifactVersion": SCALER["artifactVersion"],
            "featureOrder": list(FEATURE_NAMES),
            "source": SCALER["source"],
            "fitOnUserData": False,
        },
        "summary": {
            "points": len(points),
            "native248": sum(item["status"] == "native_248" for item in points),
            "experimental": sum(item["status"] == "adapted_experimental" for item in points),
            "unsupported": sum(item["status"] == "unsupported" for item in points),
        },
        "points": points,
    }

def preprocess_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a service-generated preprocessing artifact with optional HMAC."""
    return seal_preprocessed(_preprocess_payload(payload))
