"""Hash-verified, inference-only Phase D runtime for the frozen M4 model."""

from __future__ import annotations

import hashlib
import json
import math
import os
import threading
from pathlib import Path
from typing import Any

import numpy as np

from .contract import (
    CONTRACT_VERSION,
    FEATURE_NAMES,
    MAX_SYNC_INFER_POINTS,
    MODEL_VERSION,
    SERVICE_VERSION,
    SG_POLYORDER,
    SG_WINDOW,
    TARGET_EPOCHS,
    ZSCORE_EPSILON,
)
from .errors import MESSAGES, ServiceError
from .security import verify_preprocessed

REQUIRED_ASSETS = (
    "model_config.json",
    "classes.json",
    "physics_scaler.json",
    "probability_calibration.json",
    "checkpoint.pth",
    "spatial_reference.npz",
    "reference_split.json",
    "SHA256SUMS",
)
_RUNTIME = None
_RUNTIME_KEY = None
_RUNTIME_LOCK = threading.Lock()


def file_sha256(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ServiceError(
            "PASC_MODEL_ASSET_HASH_MISMATCH",
            MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
            status=503,
            details={"asset": path.name},
        ) from error
    if not isinstance(value, dict):
        raise ServiceError(
            "PASC_MODEL_ASSET_HASH_MISMATCH",
            MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
            status=503,
            details={"asset": path.name},
        )
    return value


def verify_bundle(bundle_dir: str | Path) -> dict[str, Any]:
    root = Path(bundle_dir).expanduser().resolve()
    manifest_path = root / "manifest.json"
    if not root.is_dir() or not manifest_path.is_file():
        raise ServiceError(
            "PASC_MODEL_UNAVAILABLE",
            MESSAGES["PASC_MODEL_UNAVAILABLE"],
            status=503,
        )
    manifest = _json(manifest_path)
    assets = manifest.get("assets")
    if (
        manifest.get("contractVersion") != CONTRACT_VERSION
        or manifest.get("modelVersion") != MODEL_VERSION
        or not isinstance(assets, dict)
        or set(REQUIRED_ASSETS) - set(assets)
    ):
        raise ServiceError(
            "PASC_MODEL_ASSET_HASH_MISMATCH",
            MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
            status=503,
        )
    for name in REQUIRED_ASSETS:
        asset_path = root / name
        expected = str(assets.get(name, "")).lower()
        if not asset_path.is_file() or file_sha256(asset_path).lower() != expected:
            raise ServiceError(
                "PASC_MODEL_ASSET_HASH_MISMATCH",
                MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
                status=503,
                details={"asset": name},
            )
    expected_build = canonical_sha256(
        {
            "contractVersion": CONTRACT_VERSION,
            "modelVersion": MODEL_VERSION,
            "assets": assets,
        }
    )
    if manifest.get("buildHash") != expected_build:
        raise ServiceError(
            "PASC_MODEL_ASSET_HASH_MISMATCH",
            MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
            status=503,
            details={"asset": "manifest.json"},
        )
    manifest["_root"] = str(root)
    manifest["_manifestSha256"] = file_sha256(manifest_path)
    return manifest


def _require_equal(actual: Any, expected: Any, field: str) -> None:
    if actual != expected:
        raise ServiceError(
            "PASC_MODEL_ASSET_HASH_MISMATCH",
            MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
            status=503,
            details={"field": field},
        )

class FrozenModelRuntime:
    def __init__(self, bundle_dir: str | Path, *, device_name: str | None = None):
        manifest = verify_bundle(bundle_dir)
        self.root = Path(manifest["_root"])
        self.manifest = manifest
        self.config = _json(self.root / "model_config.json")
        self.classes = _json(self.root / "classes.json")["classes"]
        self.scaler = _json(self.root / "physics_scaler.json")
        self.calibration = _json(self.root / "probability_calibration.json")
        self.reference_split = _json(self.root / "reference_split.json")

        try:
            import torch
            from .model_architecture import PhysicsTCN
        except ImportError as error:
            raise ServiceError(
                "PASC_MODEL_UNAVAILABLE",
                MESSAGES["PASC_MODEL_UNAVAILABLE"],
                status=503,
                details={"dependency": "torch"},
            ) from error
        self._validate_contract()

        requested = device_name or os.environ.get("PASC_DEVICE", "auto")
        if requested == "auto":
            requested = "cuda" if torch.cuda.is_available() else "cpu"
        if requested not in {"cpu", "cuda"}:
            raise ServiceError(
                "PASC_SERVICE_NOT_CONFIGURED",
                MESSAGES["PASC_SERVICE_NOT_CONFIGURED"],
                status=503,
                details={"setting": "PASC_DEVICE"},
            )
        if requested == "cuda" and not torch.cuda.is_available():
            raise ServiceError(
                "PASC_MODEL_UNAVAILABLE",
                MESSAGES["PASC_MODEL_UNAVAILABLE"],
                status=503,
                details={"device": "cuda"},
            )
        self.torch = torch
        self.device = torch.device(requested)
        self.batch_size = int(os.environ.get("PASC_INFER_BATCH_SIZE", "1024"))
        if self.batch_size < 1:
            raise ServiceError(
                "PASC_SERVICE_NOT_CONFIGURED",
                MESSAGES["PASC_SERVICE_NOT_CONFIGURED"],
                status=503,
                details={"setting": "PASC_INFER_BATCH_SIZE"},
            )

        try:
            self.max_concurrency = int(
                os.environ.get("PASC_INFER_MAX_CONCURRENCY", "1")
            )
            self.queue_timeout_seconds = float(
                os.environ.get("PASC_INFER_QUEUE_TIMEOUT_SECONDS", "5")
            )
        except ValueError as error:
            raise ServiceError(
                "PASC_SERVICE_NOT_CONFIGURED",
                MESSAGES["PASC_SERVICE_NOT_CONFIGURED"],
                status=503,
                details={"setting": "PASC_INFER_MAX_CONCURRENCY"},
            ) from error
        if self.max_concurrency < 1 or not (
            0.0 <= self.queue_timeout_seconds <= 60.0
        ):
            raise ServiceError(
                "PASC_SERVICE_NOT_CONFIGURED",
                MESSAGES["PASC_SERVICE_NOT_CONFIGURED"],
                status=503,
                details={"setting": "PASC_INFER_MAX_CONCURRENCY"},
            )
        self._inference_slots = threading.BoundedSemaphore(
            self.max_concurrency
        )

        try:
            reference = np.load(
                self.root / "spatial_reference.npz", allow_pickle=False
            )
            self.reference_series = reference["normalizedSeries"].astype(np.float32)
            self.reference_physics = reference["physicsScaled"].astype(np.float32)
            self.reference_coordinates = reference["coordinatesM"].astype(np.float32)
            self.reference_coherence = reference["coherence"].astype(np.float32)
            self.reference_row_indices = reference["rowIndices"].astype(np.int64)
        except Exception as error:
            raise ServiceError(
                "PASC_MODEL_ASSET_HASH_MISMATCH",
                MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
                status=503,
                details={"asset": "spatial_reference.npz"},
            ) from error
        self._validate_reference()

        self.model = PhysicsTCN(
            len(FEATURE_NAMES), classes=len(self.classes), use_spatial=True
        ).to(self.device)
        try:
            state = torch.load(
                self.root / "checkpoint.pth",
                map_location="cpu",
                weights_only=True,
            )
            self.model.load_state_dict(state, strict=True)
        except Exception as error:
            raise ServiceError(
                "PASC_MODEL_ASSET_HASH_MISMATCH",
                MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
                status=503,
                details={"asset": "checkpoint.pth"},
            ) from error
        self.model.eval()
        self.reference_nodes = self._encode_reference_nodes()

    def _validate_contract(self) -> None:
        from .model_architecture import (
            ARCHITECTURE_VERSION,
            AUTHORITATIVE_SOURCE_SHA256,
        )

        expected = {
            "contractVersion": CONTRACT_VERSION,
            "modelVersion": MODEL_VERSION,
            "architectureVersion": ARCHITECTURE_VERSION,
            "authoritativeSourceSha256": AUTHORITATIVE_SOURCE_SHA256,
            "targetSteps": TARGET_EPOCHS,
            "minimumExperimentalSteps": 40,
            "sgWindow": SG_WINDOW,
            "sgPolyorder": SG_POLYORDER,
            "zscoreEpsilon": ZSCORE_EPSILON,
            "featureOrder": list(FEATURE_NAMES),
            "neighbors": 8,
            "radiusMeters": 500.0,
            "distanceScaleMeters": 180.0,
            "lowConfidenceThreshold": 0.60,
            "coherenceDefault": 0.5,
            "referenceRows": 1036,
        }
        for field, value in expected.items():
            _require_equal(self.config.get(field), value, field)
        _require_equal(
            self.reference_split.get("trainRows"), 1036, "trainRows"
        )
        _require_equal(
            self.reference_split.get("splitSha256"),
            "956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c",
            "splitSha256",
        )
        _require_equal(
            self.scaler.get("featureOrder"),
            list(FEATURE_NAMES),
            "scaler.featureOrder",
        )
        _require_equal(
            self.scaler.get("center"),
            self.config.get("physicsCenter"),
            "physicsCenter",
        )
        _require_equal(
            self.scaler.get("scale"),
            self.config.get("physicsScale"),
            "physicsScale",
        )
        _require_equal(
            self.calibration.get("dynamicClassIds"),
            [2, 3, 4],
            "dynamicClassIds",
        )
        _require_equal(
            self.calibration.get("multiplier"),
            1.35,
            "calibration.multiplier",
        )
        if (
            len(self.classes) != 6
            or [item.get("id") for item in self.classes] != list(range(6))
        ):
            raise ServiceError(
                "PASC_MODEL_ASSET_HASH_MISMATCH",
                MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
                status=503,
                details={"asset": "classes.json"},
            )

    def _validate_reference(self) -> None:
        expected = {
            "normalizedSeries": (1036, TARGET_EPOCHS),
            "physicsScaled": (1036, len(FEATURE_NAMES)),
            "coordinatesM": (1036, 2),
            "coherence": (1036,),
            "rowIndices": (1036,),
        }
        arrays = {
            "normalizedSeries": self.reference_series,
            "physicsScaled": self.reference_physics,
            "coordinatesM": self.reference_coordinates,
            "coherence": self.reference_coherence,
            "rowIndices": self.reference_row_indices,
        }
        for name, shape in expected.items():
            values = arrays[name]
            if values.shape != shape or not np.all(np.isfinite(values)):
                raise ServiceError(
                    "PASC_MODEL_ASSET_HASH_MISMATCH",
                    MESSAGES["PASC_MODEL_ASSET_HASH_MISMATCH"],
                    status=503,
                    details={
                        "asset": "spatial_reference.npz",
                        "array": name,
                    },
                )

    def _encode_reference_nodes(self):
        parts = []
        torch = self.torch
        with torch.inference_mode():
            for start in range(
                0, len(self.reference_series), self.batch_size
            ):
                stop = min(
                    start + self.batch_size, len(self.reference_series)
                )
                series = torch.from_numpy(
                    self.reference_series[start:stop]
                ).unsqueeze(1).to(self.device)
                physics = torch.from_numpy(
                    self.reference_physics[start:stop]
                ).to(self.device)
                node, _ = self.model.encode_node(series, physics)
                parts.append(node)
        return torch.cat(parts, dim=0)

    def _project(
        self,
        longitude: np.ndarray,
        latitude: np.ndarray,
    ) -> np.ndarray:
        latitude0 = float(self.config["referenceLatitudeDegrees"])
        x = (
            longitude.astype(np.float64)
            * 111320.0
            * math.cos(math.radians(latitude0))
        )
        y = latitude.astype(np.float64) * 110540.0
        return np.column_stack([x, y]).astype(np.float32)

    def _query_neighbors(
        self,
        query_coordinates: np.ndarray,
        query_series: np.ndarray,
        query_coherence: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        delta = (
            query_coordinates[:, None, :].astype(np.float64)
            - self.reference_coordinates[None, :, :].astype(np.float64)
        )
        distance_matrix = np.sqrt(np.sum(delta * delta, axis=2))
        order = np.argsort(
            distance_matrix, axis=1, kind="stable"
        )[:, :9]
        distances_all = np.take_along_axis(
            distance_matrix, order, axis=1
        )
        has_exact_match = distances_all[:, 0] < 1e-3
        indices = order[:, :8].copy()
        distances = distances_all[:, :8].copy()
        if np.any(has_exact_match):
            indices[has_exact_match] = order[has_exact_match, 1:9]
            distances[has_exact_match] = distances_all[
                has_exact_match, 1:9
            ]

        neighbor_series = self.reference_series[indices]
        correlation = np.mean(
            neighbor_series * query_series[:, None, :], axis=2
        )
        temporal_similarity = (
            np.clip((correlation + 1.0) / 2.0, 0.0, 1.0) ** 2
        )
        spatial_weight = np.exp(
            -0.5
            * (
                distances
                / float(self.config["distanceScaleMeters"])
            )
            ** 2
        )
        coherence_weight = np.sqrt(
            np.clip(
                query_coherence[:, None]
                * self.reference_coherence[indices],
                0.0,
                1.0,
            )
        )
        raw_weight = (
            spatial_weight
            * (0.15 + 0.85 * temporal_similarity)
            * coherence_weight
        ).astype(np.float32)
        raw_weight[
            distances > float(self.config["radiusMeters"])
        ] = 0.0
        raw_sum = raw_weight.sum(axis=1, keepdims=True)
        weights = np.divide(
            raw_weight,
            raw_sum,
            out=np.zeros_like(raw_weight),
            where=raw_sum > 0,
        )
        reliability = (
            1.0
            - np.exp(
                -raw_sum[:, 0]
                / max(
                    float(self.config["neighbors"]) * 0.35,
                    1e-6,
                )
            )
        ).astype(np.float32)
        return (
            indices.astype(np.int64),
            weights.astype(np.float32),
            reliability,
        )

    def _infer_core(
        self,
        series: np.ndarray,
        physics: np.ndarray,
        neighbor_indices: np.ndarray,
        neighbor_weights: np.ndarray,
        reliability: np.ndarray,
    ) -> tuple[np.ndarray, np.ndarray]:
        probabilities = []
        gate_means = []
        torch = self.torch
        with torch.inference_mode():
            for start in range(0, len(series), self.batch_size):
                stop = min(start + self.batch_size, len(series))
                series_tensor = torch.from_numpy(
                    series[start:stop]
                ).unsqueeze(1).to(self.device)
                physics_tensor = torch.from_numpy(
                    physics[start:stop]
                ).to(self.device)
                index_tensor = torch.from_numpy(
                    neighbor_indices[start:stop]
                ).to(self.device)
                weight_tensor = torch.from_numpy(
                    neighbor_weights[start:stop]
                ).to(self.device)
                reliability_tensor = torch.from_numpy(
                    reliability[start:stop]
                ).to(self.device)

                node, physics_feature = self.model.encode_node(
                    series_tensor, physics_tensor
                )
                neighbor_node = self.reference_nodes[index_tensor]
                context = torch.sum(
                    weight_tensor.unsqueeze(-1) * neighbor_node,
                    dim=1,
                )
                disagreement = torch.abs(context - node)
                gate_input = torch.cat(
                    [
                        node,
                        context,
                        disagreement,
                        reliability_tensor.unsqueeze(1),
                    ],
                    dim=1,
                )
                gate = (
                    self.model.spatial_gate(gate_input)
                    * reliability_tensor[:, None]
                )
                fused = self.model.spatial_norm(
                    node + gate * (context - node)
                )
                logits, _ = self.model.classify_node(
                    fused, physics_feature
                )
                probabilities.append(
                    torch.softmax(logits, dim=1)
                    .cpu()
                    .numpy()
                    .astype(np.float32)
                )
                gate_means.append(
                    gate.mean(dim=1)
                    .cpu()
                    .numpy()
                    .astype(np.float32)
                )
        return np.concatenate(probabilities), np.concatenate(gate_means)

    def infer(
        self,
        points: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        acquired = self._inference_slots.acquire(
            timeout=self.queue_timeout_seconds
        )
        if not acquired:
            raise ServiceError(
                "PASC_INFERENCE_BUSY",
                MESSAGES["PASC_INFERENCE_BUSY"],
                status=503,
                details={
                    "maximumConcurrency": self.max_concurrency,
                    "queueTimeoutSeconds": self.queue_timeout_seconds,
                },
            )
        try:
            return self._infer_unlocked(points)
        finally:
            self._inference_slots.release()

    def _infer_unlocked(
        self,
        points: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        series = np.asarray(
            [point["normalizedSeries"] for point in points],
            dtype=np.float32,
        )
        physics = np.asarray(
            [point["features"]["scaled"] for point in points],
            dtype=np.float32,
        )
        longitude = np.asarray(
            [point["longitude"] for point in points],
            dtype=np.float64,
        )
        latitude = np.asarray(
            [point["latitude"] for point in points],
            dtype=np.float64,
        )
        coherence = np.asarray(
            [point["coherence"]["value"] for point in points],
            dtype=np.float32,
        )
        if (
            series.shape != (len(points), TARGET_EPOCHS)
            or physics.shape
            != (len(points), len(FEATURE_NAMES))
            or not np.all(np.isfinite(series))
            or not np.all(np.isfinite(physics))
            or not np.all(np.isfinite(longitude))
            or not np.all(np.isfinite(latitude))
            or not np.all(np.isfinite(coherence))
        ):
            raise ServiceError(
                "PASC_PREPROCESSED_ARTIFACT_INVALID",
                MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
            )

        coordinates = self._project(longitude, latitude)
        indices, weights, reliability = self._query_neighbors(
            coordinates,
            series,
            coherence,
        )
        raw_probabilities, gate_means = self._infer_core(
            series,
            physics,
            indices,
            weights,
            reliability,
        )
        calibrated = raw_probabilities.copy()
        calibrated[
            :, self.calibration["dynamicClassIds"]
        ] *= np.float32(self.calibration["multiplier"])
        calibrated /= calibrated.sum(axis=1, keepdims=True)
        return [
            self._point_result(
                point,
                raw,
                final,
                reliability_value,
                gate,
            )
            for point, raw, final, reliability_value, gate in zip(
                points,
                raw_probabilities,
                calibrated,
                reliability,
                gate_means,
            )
        ]

    def _class_result(
        self,
        probabilities: np.ndarray,
    ) -> dict[str, Any]:
        class_id = int(np.argmax(probabilities))
        definition = self.classes[class_id]
        return {
            "classId": class_id,
            "className": definition["canonicalName"],
            "classNameZh": definition["displayNameZh"],
            "probabilities": [
                float(value) for value in probabilities
            ],
        }

    def _point_result(
        self,
        source: dict[str, Any],
        raw: np.ndarray,
        calibrated: np.ndarray,
        reliability: np.float32,
        gate_mean: np.float32,
    ) -> dict[str, Any]:
        raw_result = self._class_result(raw)
        calibrated_result = self._class_result(calibrated)
        confidence = float(np.max(calibrated))
        spatial = (
            "full_reference"
            if float(reliability) > 0.0
            else "limited_reference"
        )
        warnings = list(source["quality"].get("warnings", []))
        if spatial == "limited_reference":
            warnings.append(
                {
                    "code": "PASC_SPATIAL_REFERENCE_LIMITED",
                    "message": (
                        "该点缺少海口训练空间参考，"
                        "空间适用性有限。"
                    ),
                }
            )
        temporal = (
            "native_248"
            if source["status"] == "native_248"
            else "experimental_adapted_to_248"
        )
        return {
            "pointId": source["pointId"],
            "status": "predicted",
            "rawResult": raw_result,
            "calibratedResult": calibrated_result,
            "finalLabel": {
                "classId": calibrated_result["classId"],
                "className": calibrated_result["className"],
                "classNameZh": calibrated_result["classNameZh"],
                "color": self.classes[
                    calibrated_result["classId"]
                ]["color"],
            },
            "probabilities": calibrated_result["probabilities"],
            "confidence": confidence,
            "calibrationChanged": (
                raw_result["classId"]
                != calibrated_result["classId"]
            ),
            "lowConfidence": (
                confidence
                < float(self.config["lowConfidenceThreshold"])
            ),
            "spatialReliability": float(reliability),
            "spatialGateMean": float(gate_mean),
            "applicability": {
                "temporal": temporal,
                "spatial": spatial,
            },
            "quality": source["quality"],
            "sources": {
                "velocity": source["velocity"]["source"],
                "coherence": source["coherence"]["source"],
            },
            "warnings": warnings,
        }

def _bundle_setting() -> str:
    return os.environ.get("PASC_MODEL_BUNDLE_DIR", "").strip()


def get_runtime() -> FrozenModelRuntime:
    global _RUNTIME, _RUNTIME_KEY
    bundle = _bundle_setting()
    if not bundle:
        raise ServiceError(
            "PASC_MODEL_UNAVAILABLE",
            MESSAGES["PASC_MODEL_UNAVAILABLE"],
            status=503,
        )
    key = (
        str(Path(bundle).expanduser().resolve()),
        os.environ.get("PASC_DEVICE", "auto"),
    )
    with _RUNTIME_LOCK:
        if _RUNTIME is None or _RUNTIME_KEY != key:
            _RUNTIME = FrozenModelRuntime(
                key[0], device_name=key[1]
            )
            _RUNTIME_KEY = key
    return _RUNTIME


def reset_runtime() -> None:
    global _RUNTIME, _RUNTIME_KEY
    with _RUNTIME_LOCK:
        _RUNTIME = None
        _RUNTIME_KEY = None


def runtime_status(*, load: bool = False) -> dict[str, Any]:
    bundle = _bundle_setting()
    if not bundle:
        return {
            "configured": False,
            "inferenceAvailable": False,
            "reason": "model_bundle_not_configured",
        }
    if not load and _RUNTIME is None:
        return {
            "configured": True,
            "inferenceAvailable": False,
            "reason": "model_bundle_not_loaded",
        }
    try:
        runtime = get_runtime()
    except ServiceError as error:
        return {
            "configured": True,
            "inferenceAvailable": False,
            "reason": error.code,
        }
    return {
        "configured": True,
        "inferenceAvailable": True,
        "buildHash": runtime.manifest["buildHash"],
        "manifestSha256": runtime.manifest["_manifestSha256"],
        "device": str(runtime.device),
        "referenceRows": len(runtime.reference_series),
        "maximumConcurrency": runtime.max_concurrency,
    }


def infer_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ServiceError(
            "PASC_BAD_REQUEST", MESSAGES["PASC_BAD_REQUEST"]
        )
    if (
        payload.get("contractVersion", CONTRACT_VERSION)
        != CONTRACT_VERSION
    ):
        raise ServiceError(
            "PASC_CONTRACT_VERSION_UNSUPPORTED",
            MESSAGES["PASC_CONTRACT_VERSION_UNSUPPORTED"],
        )
    artifact = verify_preprocessed(payload.get("preprocessed"))
    if (
        artifact.get("contractVersion") != CONTRACT_VERSION
        or artifact.get("modelVersion") != MODEL_VERSION
        or artifact.get("operation") != "preprocess_only"
        or not isinstance(artifact.get("points"), list)
    ):
        raise ServiceError(
            "PASC_PREPROCESSED_ARTIFACT_INVALID",
            MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
        )
    points = artifact["points"]
    if not points or len(points) > MAX_SYNC_INFER_POINTS:
        raise ServiceError(
            "PASC_INFERENCE_LIMIT_EXCEEDED",
            MESSAGES["PASC_INFERENCE_LIMIT_EXCEEDED"],
            status=413,
            details={"maximumPoints": MAX_SYNC_INFER_POINTS},
        )
    unsupported = [
        point.get("pointId")
        for point in points
        if point.get("status") == "unsupported"
    ]
    if unsupported:
        raise ServiceError(
            "PASC_TOO_FEW_VALID_EPOCHS",
            MESSAGES["PASC_TOO_FEW_VALID_EPOCHS"],
            details={
                "pointIds": unsupported[:20],
                "count": len(unsupported),
            },
        )
    for point in points:
        if (
            point.get("status")
            not in {"native_248", "adapted_experimental"}
            or point.get("features", {}).get("order")
            != list(FEATURE_NAMES)
            or point.get("audit", {}).get("modelExecuted")
            is not False
        ):
            raise ServiceError(
                "PASC_PREPROCESSED_ARTIFACT_INVALID",
                MESSAGES["PASC_PREPROCESSED_ARTIFACT_INVALID"],
            )

    runtime = get_runtime()
    results = runtime.infer(points)
    return {
        "contractVersion": CONTRACT_VERSION,
        "modelVersion": MODEL_VERSION,
        "serviceVersion": SERVICE_VERSION,
        "operation": "inference_only",
        "inferenceOnly": True,
        "summary": {
            "points": len(results),
            "predicted": len(results),
            "lowConfidence": sum(
                item["lowConfidence"] for item in results
            ),
            "limitedReference": sum(
                item["applicability"]["spatial"]
                == "limited_reference"
                for item in results
            ),
        },
        "modelPackage": {
            "buildHash": runtime.manifest["buildHash"],
            "manifestSha256": runtime.manifest["_manifestSha256"],
            "assetSha256": runtime.manifest["assets"],
        },
        "points": results,
        "audit": {
            "assetHashesVerified": True,
            "referenceRows": len(runtime.reference_series),
            "device": str(runtime.device),
            "modelExecuted": True,
            "userDataFit": False,
            "trainingPathAvailable": False,
        },
    }
