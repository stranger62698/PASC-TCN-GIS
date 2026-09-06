"""Shared, inference-only helpers for the Phase 1 ONNX tools."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import nn


class PascTcnOnnxAdapter(nn.Module):
    """Expose the frozen model's tensor outputs as a stable ONNX interface."""

    def __init__(self, model: nn.Module):
        super().__init__()
        self.model = model

    def forward(
        self,
        series: torch.Tensor,
        physics: torch.Tensor,
        neighbor_series: torch.Tensor,
        neighbor_physics: torch.Tensor,
        neighbor_weights: torch.Tensor,
        reliability: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        result = self.model(
            series,
            physics,
            neighbor_series,
            neighbor_physics,
            neighbor_weights,
            reliability,
        )
        return (
            result["logits"],
            result["physics_logits"],
            result["spatial_gate_mean"],
        )


@dataclass(frozen=True)
class ModelInputs:
    series: np.ndarray
    physics: np.ndarray
    neighbor_series: np.ndarray
    neighbor_physics: np.ndarray
    neighbor_weights: np.ndarray
    reliability: np.ndarray
    reference_sources: tuple[str, ...]

    def as_onnx_feed(self) -> dict[str, np.ndarray]:
        return {
            "series": self.series,
            "physics": self.physics,
            "neighbor_series": self.neighbor_series,
            "neighbor_physics": self.neighbor_physics,
            "neighbor_weights": self.neighbor_weights,
            "reliability": self.reliability,
        }

    def as_torch_args(self) -> tuple[torch.Tensor, ...]:
        return tuple(
            torch.from_numpy(value)
            for value in self.as_onnx_feed().values()
        )


def preprocess_request(request: dict[str, Any]) -> list[dict[str, Any]]:
    """Run the exact production preprocessor without sealing the artifact."""
    from pasc_tcn_service.preprocessing import _preprocess_payload

    result = _preprocess_payload(request)
    points = [
        point
        for point in result["points"]
        if point.get("status") != "unsupported"
    ]
    if not points:
        raise ValueError("fixture did not produce any supported points")
    return points


def build_model_inputs(runtime: Any, points: list[dict[str, Any]]) -> ModelInputs:
    """Build the same tensors and spatial context used by FrozenModelRuntime."""
    feature_count = len(runtime.config["featureOrder"])
    neighbor_count = int(runtime.config["neighbors"])
    series_2d = np.asarray(
        [point["normalizedSeries"] for point in points], dtype=np.float32
    )
    physics = np.asarray(
        [point["features"]["scaled"] for point in points], dtype=np.float32
    )
    longitude = np.asarray(
        [point["longitude"] for point in points], dtype=np.float64
    )
    latitude = np.asarray(
        [point["latitude"] for point in points], dtype=np.float64
    )
    coherence = np.asarray(
        [point["coherence"]["value"] for point in points], dtype=np.float32
    )
    if physics.shape != (len(points), feature_count):
        raise ValueError(f"unexpected physics shape: {physics.shape}")

    coordinates = runtime._project(longitude, latitude)
    frozen_indices, frozen_weights, frozen_reliability = runtime._query_neighbors(
        coordinates, series_2d, coherence
    )
    area_coordinates = runtime._project_research_area(longitude, latitude)
    area_indices, area_weights, area_reliability = (
        runtime._query_research_area_neighbors(
            area_coordinates, series_2d, coherence
        )
    )
    use_area_context = (
        (frozen_reliability <= 0.0) & (area_reliability > 0.0)
    )

    batch, time_steps = series_2d.shape
    neighbor_series_3d = np.zeros(
        (batch, neighbor_count, time_steps), dtype=np.float32
    )
    neighbor_physics = np.zeros(
        (batch, neighbor_count, feature_count), dtype=np.float32
    )
    weights = frozen_weights.astype(np.float32, copy=True)
    reliability = frozen_reliability.astype(np.float32, copy=True)

    if time_steps == runtime.reference_series.shape[1]:
        neighbor_series_3d[:] = runtime.reference_series[frozen_indices]
        neighbor_physics[:] = runtime.reference_physics[frozen_indices]

    for row_index in np.flatnonzero(use_area_context):
        selected = area_indices[row_index]
        neighbor_series_3d[row_index] = series_2d[selected]
        neighbor_physics[row_index] = physics[selected]
        weights[row_index] = area_weights[row_index]
        reliability[row_index] = area_reliability[row_index]

    sources = tuple(
        "uploaded_research_area"
        if use_area_context[index]
        else (
            "frozen_training_reference"
            if reliability[index] > 0.0
            else "none"
        )
        for index in range(batch)
    )
    return ModelInputs(
        series=np.ascontiguousarray(series_2d[:, None, :]),
        physics=np.ascontiguousarray(physics),
        neighbor_series=np.ascontiguousarray(
            neighbor_series_3d[:, :, None, :]
        ),
        neighbor_physics=np.ascontiguousarray(neighbor_physics),
        neighbor_weights=np.ascontiguousarray(weights),
        reliability=np.ascontiguousarray(reliability),
        reference_sources=sources,
    )


def stable_softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits.astype(np.float32) - np.max(
        logits.astype(np.float32), axis=1, keepdims=True
    )
    exponentials = np.exp(shifted).astype(np.float32)
    return exponentials / np.sum(exponentials, axis=1, keepdims=True)


def calibrate_probabilities(
    probabilities: np.ndarray,
    dynamic_class_ids: list[int],
    multiplier: float,
) -> np.ndarray:
    calibrated = probabilities.astype(np.float32, copy=True)
    calibrated[:, dynamic_class_ids] *= np.float32(multiplier)
    calibrated /= calibrated.sum(axis=1, keepdims=True)
    return calibrated
