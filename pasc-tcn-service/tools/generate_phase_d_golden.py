"""Generate Phase D inference golden values using the formal research runtime."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.neighbors import NearestNeighbors

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
sys.path.insert(0, str(SERVICE_ROOT / "src"))

from pasc_tcn_service.phase_c import calibrate_probabilities
from pasc_tcn_service.preprocessing import preprocess_payload

EXPECTED_HASHES = {
    "data": "e2740b4c20b82357f1acc1f67230fa3972fa9ee624ad1e5073cbfb8c324a8265",
    "split": "956a8162b95712d7abf49102ee8a869fd9620fcf46e811feb86d4642d02f484c",
    "checkpoint": "a45b91c0b8288d87481f5c13db82a574d79a13086b28a49eb148617155ca6107",
    "modelCode": "16e4de4a65c8861647103dbafb7758a5236761faab158657fe4abfbe8d64186c",
    "inferenceCode": "c984a60b33328e343c0fae3d981e52b92b78e8973c6fe38d513f0d2327a1890a",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def checked(path: Path, name: str) -> str:
    actual = sha256(path)
    if actual != EXPECTED_HASHES[name]:
        raise RuntimeError(f"{name} hash mismatch: {actual}")
    return actual


def scenario_request(native: dict, kind: str) -> dict:
    value = copy.deepcopy(native)
    if kind == "native248":
        return value
    value["records"] = value["records"][:1]
    if kind == "adapted40":
        columns = value["mapping"]["dateColumns"][:40]
        value["mapping"]["dateColumns"] = columns
        keep = {
            "fid", "xpos", "ypos", "Vel", "coherence", *columns
        }
        value["records"][0] = {
            key: item for key, item in value["records"][0].items() if key in keep
        }
        value["datasetName"] = "formal-adapted40-golden"
        return value
    if kind == "external":
        value["records"][0]["xpos"] = 121.4737
        value["records"][0]["ypos"] = 31.2304
        value["datasetName"] = "external-reference-golden"
        return value
    raise ValueError(kind)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--research-root", type=Path, default=REPOSITORY_ROOT.parent / "fyw0822"
    )
    parser.add_argument(
        "--native-fixture",
        type=Path,
        default=SERVICE_ROOT / "tests" / "fixtures" / "native248_golden.json",
    )
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    args = parser.parse_args()

    research = args.research_root.resolve()
    result_root = research / "results" / "04_m1_m4"
    paths = {
        "data": research / "data" / "real6_near300_per_class_sg_verified_deduplicated.csv",
        "split": result_root / "M2_M3_M4_fixed_real_split.csv",
        "checkpoint": result_root / "fraction_1.00_M4.pth",
        "modelCode": research / "code" / "run_spatial_physics_tcn_patent_prototype.py",
        "inferenceCode": research / "code" / "predict_pasc_tcn_full_area.py",
    }
    hashes = {name: checked(path, name) for name, path in paths.items()}
    sys.path.insert(0, str(research / "code"))
    model_lib = importlib.import_module("run_spatial_physics_tcn_patent_prototype")
    infer_lib = importlib.import_module("predict_pasc_tcn_full_area")
    model_lib.seed_everything(model_lib.FIXED_SPLIT_SEED)
    data = model_lib.load_real_data(paths["data"])
    train, validation, test = model_lib.split_random(data.labels)
    if (len(train), len(validation), len(test)) != (1036, 183, 523):
        raise RuntimeError("formal split counts changed")
    split = pd.read_csv(paths["split"])
    split.columns = split.columns.str.strip()
    expected_train = set(pd.to_numeric(
        split.loc[split["Split"].str.lower() == "train", "Row_Index"],
        errors="raise",
    ).astype(int))
    if expected_train != set(train.tolist()):
        raise RuntimeError("formal training reference split changed")
    physics_scaled, _, _ = model_lib.robust_scale_physics(data.physics, train)
    device = torch.device(args.device)
    model = model_lib.PhysicsTCN(
        physics_scaled.shape[1], classes=len(model_lib.CLASS_NAMES), use_spatial=True
    ).to(device)
    model.load_state_dict(
        torch.load(paths["checkpoint"], map_location="cpu", weights_only=True),
        strict=True,
    )
    model.eval()
    reference_series = data.normalized_series[train]
    reference_physics = physics_scaled[train]
    reference_coordinates = data.coordinates_m[train]
    reference_coherence = data.coherence[train]
    nearest = NearestNeighbors(n_neighbors=9, algorithm="kd_tree", n_jobs=-1).fit(
        reference_coordinates
    )
    reference_nodes, _ = infer_lib.encode_reference_nodes(
        model, reference_series, reference_physics, device, 1024
    )
    latitude0 = float(pd.to_numeric(data.frame["ypos"], errors="raise").mean())

    native_fixture = json.loads(args.native_fixture.read_text(encoding="utf-8"))
    expected = {}
    requests = {}
    for name in ("native248", "adapted40", "external"):
        request = scenario_request(native_fixture["request"], name)
        requests[name] = request
        artifact = preprocess_payload(request)
        points = artifact["points"]
        series = np.asarray([point["normalizedSeries"] for point in points], np.float32)
        physics = np.asarray([point["features"]["scaled"] for point in points], np.float32)
        coordinates = infer_lib.project_lonlat(
            [point["longitude"] for point in points],
            [point["latitude"] for point in points],
            latitude0,
        )
        coherence = np.asarray([point["coherence"]["value"] for point in points], np.float32)
        indices, weights, reliability = infer_lib.query_reference_neighbors(
            coordinates,
            series,
            coherence,
            nearest,
            reference_series,
            reference_coherence,
            8,
            500.0,
            180.0,
        )
        raw, gates = infer_lib.infer_chunk(
            model, series, physics, indices, weights, reliability,
            reference_nodes, device, 1024
        )
        calibrated = calibrate_probabilities(raw, 1.35)
        expected[name] = [
            {
                "pointId": point["pointId"],
                "rawProbabilities": [float(value) for value in raw[index]],
                "rawLabel": int(np.argmax(raw[index])),
                "calibratedProbabilities": [float(value) for value in calibrated[index]],
                "finalLabel": int(np.argmax(calibrated[index])),
                "confidence": float(np.max(calibrated[index])),
                "spatialReliability": float(reliability[index]),
                "spatialGateMean": float(gates[index]),
            }
            for index, point in enumerate(points)
        ]

    output = {
        "fixtureVersion": "phase-d-inference-golden-v1",
        "contractVersion": "pasc-contract-v1",
        "modelVersion": "pasc-tcn-haikou-v1",
        "sourceHashes": hashes,
        "nativeFixtureSha256": sha256(args.native_fixture),
        "scenarioRequests": requests,
        "expected": expected,
        "tolerances": {"absolute": 5e-5, "relative": 1e-6},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "counts": {
        key: len(value) for key, value in expected.items()
    }}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
