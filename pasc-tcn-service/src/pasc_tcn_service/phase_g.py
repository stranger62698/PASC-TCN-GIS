"""Phase G external-region evidence utilities.

This module evaluates the frozen preprocessing/inference contract. It does not
change the model, fit user data, or inject self-neighborhood evidence into
production predictions.
"""

from __future__ import annotations

import copy
import math
from typing import Any

import numpy as np

from .contract import CONTRACT_VERSION, TARGET_EPOCHS
from .inference import infer_payload
from .preprocessing import preprocess_payload

EXPLORATORY_TITLE = "探索性识别结果"
EXPLORATORY_LINE_1 = "当前数据超出模型主要验证区域，"
EXPLORATORY_LINE_2 = "建议结合人工判读使用。"
EXTERNAL_TARGET = {"name": "Shanghai coordinate-shift control", "longitude": 121.4737, "latitude": 31.2304}


def _numeric(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _transform_fields(request: dict[str, Any], factor: float) -> dict[str, Any]:
    transformed = copy.deepcopy(request)
    mapping = transformed["mapping"]
    fields = list(mapping["dateColumns"])
    velocity_field = mapping.get("velocity")
    if velocity_field:
        fields.append(velocity_field)
    for row in transformed["records"]:
        for field in fields:
            number = _numeric(row.get(field))
            if number is not None:
                row[field] = number * factor
    return transformed


def build_unit_equivalent_request(request: dict[str, Any]) -> dict[str, Any]:
    """Represent the same physical values in centimetres."""
    transformed = _transform_fields(request, 0.1)
    transformed["datasetName"] = f'{request.get("datasetName", "dataset")}-unit-cm'
    transformed["settings"]["displacementUnit"] = "cm"
    if transformed["mapping"].get("velocity"):
        transformed["settings"]["velocityUnit"] = "cm/year"
    return transformed


def build_sign_equivalent_request(request: dict[str, Any]) -> dict[str, Any]:
    """Represent model-native values using the opposite accepted sign convention."""
    transformed = _transform_fields(request, -1.0)
    transformed["datasetName"] = f'{request.get("datasetName", "dataset")}-sign-positive'
    transformed["settings"]["signConvention"] = "subsidence_positive"
    return transformed


def build_sampling_request(request: dict[str, Any], epochs: int) -> dict[str, Any]:
    """Create a deterministic endpoint-preserving temporal subset."""
    date_fields = list(request["mapping"]["dateColumns"])
    if epochs < 2 or epochs > len(date_fields):
        raise ValueError("epochs must be between 2 and the source date count")
    indices = [index * (len(date_fields) - 1) // (epochs - 1) for index in range(epochs)]
    if len(set(indices)) != epochs:
        raise ValueError("deterministic sampling produced duplicate indices")
    selected = [date_fields[index] for index in indices]
    transformed = copy.deepcopy(request)
    transformed["datasetName"] = f'{request.get("datasetName", "dataset")}-sampled-{epochs}'
    transformed["mapping"]["dateColumns"] = selected
    for row in transformed["records"]:
        for field in date_fields:
            if field not in selected:
                row.pop(field, None)
    return transformed


def build_external_coordinate_request(
    request: dict[str, Any],
    *,
    longitude: float = EXTERNAL_TARGET["longitude"],
    latitude: float = EXTERNAL_TARGET["latitude"],
) -> dict[str, Any]:
    """Translate a batch while preserving its local point geometry and all non-coordinate inputs."""
    transformed = copy.deepcopy(request)
    longitude_field = transformed["mapping"]["longitude"]
    latitude_field = transformed["mapping"]["latitude"]
    origin = transformed["records"][0]
    origin_longitude = float(origin[longitude_field])
    origin_latitude = float(origin[latitude_field])
    for row in transformed["records"]:
        row[longitude_field] = longitude + (float(row[longitude_field]) - origin_longitude)
        row[latitude_field] = latitude + (float(row[latitude_field]) - origin_latitude)
    transformed["datasetName"] = f'{request.get("datasetName", "dataset")}-external-shanghai-control'
    return transformed



def build_self_neighborhood_experiment_request(
    request: dict[str, Any],
    *,
    longitude: float = EXTERNAL_TARGET["longitude"],
    latitude: float = EXTERNAL_TARGET["latitude"],
    spacing_meters: float = 80.0,
) -> dict[str, Any]:
    """Create an explicitly synthetic dense external cluster for diagnostics only."""
    transformed = copy.deepcopy(request)
    longitude_field = transformed["mapping"]["longitude"]
    latitude_field = transformed["mapping"]["latitude"]
    center = (len(transformed["records"]) - 1) / 2.0
    meters_per_degree = 111320.0 * math.cos(math.radians(latitude))
    for index, row in enumerate(transformed["records"]):
        row[longitude_field] = longitude + ((index - center) * spacing_meters / meters_per_degree)
        row[latitude_field] = latitude
    transformed["datasetName"] = f'{request.get("datasetName", "dataset")}-self-neighborhood-diagnostic-only'
    return transformed
def compare_preprocessed(
    reference: dict[str, Any], candidate: dict[str, Any]
) -> dict[str, float]:
    """Compare temporal and physical artifacts for matching supported point IDs."""
    reference_points = {item["pointId"]: item for item in reference["points"] if item["status"] != "unsupported"}
    candidate_points = {item["pointId"]: item for item in candidate["points"] if item["status"] != "unsupported"}
    common = sorted(reference_points.keys() & candidate_points.keys())
    if not common:
        raise ValueError("no matching supported points")
    series_delta = 0.0
    raw_delta = 0.0
    scaled_delta = 0.0
    for point_id in common:
        left = reference_points[point_id]
        right = candidate_points[point_id]
        series_delta = max(series_delta, float(np.max(np.abs(np.asarray(left["normalizedSeries"]) - np.asarray(right["normalizedSeries"])))))
        raw_delta = max(raw_delta, float(np.max(np.abs(np.asarray(left["features"]["raw"]) - np.asarray(right["features"]["raw"])))))
        scaled_delta = max(scaled_delta, float(np.max(np.abs(np.asarray(left["features"]["scaled"]) - np.asarray(right["features"]["scaled"])))))
    return {
        "normalizedSeriesMaxAbsDiff": series_delta,
        "physicalRawMaxAbsDiff": raw_delta,
        "physicalScaledMaxAbsDiff": scaled_delta,
    }


def self_neighborhood_diagnostics(
    points: list[dict[str, Any]],
    *,
    neighbors: int = 8,
    radius_meters: float = 500.0,
    distance_scale_meters: float = 180.0,
    reference_latitude_degrees: float = 20.0,
) -> dict[str, Any]:
    """Measure batch-internal support without applying it to model predictions."""
    supported = [point for point in points if point.get("status") != "unsupported"]
    base = {
        "mode": "diagnostics_only",
        "predictionApplied": False,
        "productionEligible": False,
        "accuracyEvaluated": False,
        "pointCount": len(supported),
    }
    if len(supported) < 2:
        return {**base, "status": "insufficient_batch_points", "supportedPointCount": 0}
    longitude = np.asarray([point["longitude"] for point in supported], dtype=np.float64)
    latitude = np.asarray([point["latitude"] for point in supported], dtype=np.float64)
    x = longitude * 111320.0 * math.cos(math.radians(reference_latitude_degrees))
    y = latitude * 110540.0
    coordinates = np.column_stack([x, y])
    delta = coordinates[:, None, :] - coordinates[None, :, :]
    distance = np.sqrt(np.sum(delta * delta, axis=2))
    np.fill_diagonal(distance, np.inf)
    series = np.asarray([point["normalizedSeries"] for point in supported], dtype=np.float32)
    coherence = np.asarray([point["coherence"]["value"] for point in supported], dtype=np.float32)
    reliabilities: list[float] = []
    nearest_distances: list[float] = []
    support_counts: list[int] = []
    for index in range(len(supported)):
        order = np.argsort(distance[index], kind="stable")[: min(neighbors, len(supported) - 1)]
        distances = distance[index, order]
        correlation = np.mean(series[order] * series[index][None, :], axis=1)
        temporal_similarity = np.clip((correlation + 1.0) / 2.0, 0.0, 1.0) ** 2
        spatial_weight = np.exp(-0.5 * (distances / distance_scale_meters) ** 2)
        coherence_weight = np.sqrt(np.clip(coherence[index] * coherence[order], 0.0, 1.0))
        raw_weight = spatial_weight * (0.15 + 0.85 * temporal_similarity) * coherence_weight
        raw_weight[distances > radius_meters] = 0.0
        raw_sum = float(np.sum(raw_weight))
        reliabilities.append(1.0 - math.exp(-raw_sum / max(neighbors * 0.35, 1e-6)))
        nearest_distances.append(float(distances[0]))
        support_counts.append(int(np.count_nonzero(raw_weight > 0.0)))
    return {
        **base,
        "status": "evaluated_not_applied",
        "supportedPointCount": int(sum(count > 0 for count in support_counts)),
        "meanCandidateReliability": float(np.mean(reliabilities)),
        "maximumCandidateReliability": float(np.max(reliabilities)),
        "meanNearestDistanceMeters": float(np.mean(nearest_distances)),
        "maximumSupportCount": max(support_counts),
        "warning": "Self-neighborhood仅为离线实验，未进入冻结模型预测，也不能替代外部标注精度验证。",
    }


def _infer_request(request: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    preprocessed = preprocess_payload(request)
    inference = infer_payload({"contractVersion": CONTRACT_VERSION, "preprocessed": preprocessed})
    return preprocessed, inference


def _scenario_metrics(
    name: str,
    category: str,
    preprocessed: dict[str, Any],
    inference: dict[str, Any],
    reference_inference: dict[str, Any],
    comparison: dict[str, float] | None,
) -> dict[str, Any]:
    reference = {point["pointId"]: point for point in reference_inference["points"]}
    points = inference["points"]
    aligned = [(reference[point["pointId"]], point) for point in points if point["pointId"] in reference]
    probability_delta = max(
        (float(np.max(np.abs(np.asarray(left["probabilities"]) - np.asarray(right["probabilities"])))) for left, right in aligned),
        default=0.0,
    )
    class_agreement = (
        sum(left["finalLabel"]["classId"] == right["finalLabel"]["classId"] for left, right in aligned) / len(aligned)
        if aligned else None
    )
    spatial_states = sorted({point["applicability"]["spatial"] for point in points})
    temporal_states = sorted({point["applicability"]["temporal"] for point in points})
    return {
        "scenario": name,
        "category": category,
        "pointCount": len(points),
        "effectiveEpochs": sorted({point["quality"]["effectiveEpochs"] for point in points}),
        "temporalApplicability": temporal_states,
        "spatialApplicability": spatial_states,
        "classAgreementVsNative": class_agreement,
        "maximumProbabilityDeltaVsNative": probability_delta,
        "meanConfidence": float(np.mean([point["confidence"] for point in points])),
        "meanSpatialReliability": float(np.mean([point["spatialReliability"] for point in points])),
        "meanSpatialGate": float(np.mean([point["spatialGateMean"] for point in points])),
        "maximumGapDays": max(point["quality"]["maximumGapDays"] for point in points),
        "preprocessingComparison": comparison,
        "accuracyEvaluated": False,
    }


def evaluate_phase_g(fixture: dict[str, Any]) -> dict[str, Any]:
    """Run the controlled Phase G evaluation against the frozen Phase D fixture."""
    native_request = fixture["scenarioRequests"]["native248"]
    requests = {
        "native_248_reference": native_request,
        "external_golden_shanghai": fixture["scenarioRequests"]["external"],
        "external_batch_shanghai": build_external_coordinate_request(native_request),
        "unit_cm_equivalent": build_unit_equivalent_request(native_request),
        "sign_positive_equivalent": build_sign_equivalent_request(native_request),
        "sampled_160": build_sampling_request(native_request, 160),
        "sampled_80": build_sampling_request(native_request, 80),
        "sampled_40": build_sampling_request(native_request, 40),
    }
    categories = {
        "native_248_reference": "reference",
        "external_golden_shanghai": "external_region",
        "external_batch_shanghai": "external_region",
        "unit_cm_equivalent": "unit_equivalence",
        "sign_positive_equivalent": "sign_equivalence",
        "sampled_160": "sampling_difference",
        "sampled_80": "sampling_difference",
        "sampled_40": "sampling_difference",
    }
    artifacts: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for name, request in requests.items():
        artifacts[name] = _infer_request(request)
    native_preprocessed, native_inference = artifacts["native_248_reference"]
    scenarios = []
    for name in requests:
        preprocessed, inference = artifacts[name]
        comparison = None
        if name in {"external_batch_shanghai", "unit_cm_equivalent", "sign_positive_equivalent"}:
            comparison = compare_preprocessed(native_preprocessed, preprocessed)
        scenarios.append(_scenario_metrics(name, categories[name], preprocessed, inference, native_inference, comparison))
    external_preprocessed, external_inference = artifacts["external_batch_shanghai"]
    external_comparison = compare_preprocessed(native_preprocessed, external_preprocessed)
    external_points = external_inference["points"]
    spatial_suppressed = all(
        point["applicability"]["spatial"] == "limited_reference"
        and point["spatialReliability"] == 0.0
        and point["spatialGateMean"] == 0.0
        for point in external_points
    )
    equivalence = {
        name: compare_preprocessed(native_preprocessed, artifacts[name][0])
        for name in ("unit_cm_equivalent", "sign_positive_equivalent")
    }
    return {
        "phase": "G",
        "contractVersion": fixture["contractVersion"],
        "modelVersion": fixture["modelVersion"],
        "evaluationKind": "controlled_external_region_robustness_without_external_labels",
        "frozenBoundary": {
            "modelDefinitionChanged": False,
            "trainingParametersChanged": False,
            "physicalFeaturesChanged": False,
            "productionSpatialMechanismChanged": False,
            "userDataFit": False,
        },
        "claims": {
            "externalLabelsAvailable": False,
            "externalAccuracyEvaluated": False,
            "arbitraryCityHighAccuracyClaimed": False,
            "allowedConclusion": "外区空间参考受限时，产品降级为探索性识别并提示人工判读。",
        },
        "requiredProductWording": [EXPLORATORY_TITLE, EXPLORATORY_LINE_1, EXPLORATORY_LINE_2],
        "branchEvidence": {
            "coordinateShiftTemporalPhysicalInvariant": external_comparison,
            "externalSpatialBranchSuppressed": spatial_suppressed,
            "interpretation": "坐标平移不改变时间序列与13维物理特征；固定海口参考不可用时空间可靠性和门控归零，输出主要依赖TCN时间分支与运动学物理特征。",
        },
        "unitAndSignEquivalence": equivalence,
        "orbitDifference": {
            "status": "not_evaluable_from_current_contract",
            "reason": "冻结输入契约不包含升降轨或视线几何字段，不能据此给出轨道差异的数值结论。",
            "productAction": "保留人工元数据检查，不宣称轨道泛化能力。",
        },
        "selfNeighborhood": {
            **self_neighborhood_diagnostics(
                preprocess_payload(build_self_neighborhood_experiment_request(native_request))["points"]
            ),
            "inputConstruction": "synthetic_three_point_external_cluster_80m_spacing",
            "syntheticCoordinates": True,
        },
        "scenarios": scenarios,
    }
