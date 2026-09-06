"""Generate the compact, formal-input fixture used by the Phase 2 browser prototype."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import torch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
SOURCE_ROOT = SERVICE_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from pasc_tcn_onnx_support import (  # noqa: E402
    PascTcnOnnxAdapter,
    build_model_inputs,
    calibrate_probabilities,
    preprocess_request,
    stable_softmax,
)
from pasc_tcn_service.inference import FrozenModelRuntime, file_sha256  # noqa: E402

DEFAULT_BUNDLE = (
    SERVICE_ROOT / ".private-model-bundles" / "pasc-tcn-haikou-v1"
)
DEFAULT_SOURCE_FIXTURE = (
    SERVICE_ROOT / "tests" / "fixtures" / "phase_d_inference_golden.json"
)
DEFAULT_MODEL = REPOSITORY_ROOT / "artifacts" / "pasc-tcn.onnx"
DEFAULT_OUTPUT = REPOSITORY_ROOT / "artifacts" / "pasc-tcn-phase2-fixture.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a compact browser parity fixture from formal inputs."
    )
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--source-fixture", type=Path, default=DEFAULT_SOURCE_FIXTURE)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def flattened(values: np.ndarray) -> list[float]:
    return [float(value) for value in values.reshape(-1)]


def main() -> int:
    args = parse_args()
    source_bytes = args.source_fixture.read_bytes()
    source = json.loads(source_bytes)
    runtime = FrozenModelRuntime(args.bundle, device_name="cpu")
    points = preprocess_request(source["scenarioRequests"]["native248"])
    inputs = build_model_inputs(runtime, points)
    adapter = PascTcnOnnxAdapter(runtime.model.cpu().eval()).eval()
    with torch.inference_mode():
        outputs = adapter(*inputs.as_torch_args())
    logits = outputs[0].cpu().numpy().astype(np.float32)
    physics_logits = outputs[1].cpu().numpy().astype(np.float32)
    gate_means = outputs[2].cpu().numpy().astype(np.float32)
    raw = stable_softmax(logits)
    calibrated = calibrate_probabilities(
        raw,
        list(runtime.calibration["dynamicClassIds"]),
        float(runtime.calibration["multiplier"]),
    )

    tolerance = float(source["tolerances"]["absolute"])
    golden = source["expected"]["native248"]
    np.testing.assert_allclose(
        raw,
        np.asarray(
            [item["rawProbabilities"] for item in golden], dtype=np.float32
        ),
        atol=tolerance,
        rtol=float(source["tolerances"]["relative"]),
    )
    np.testing.assert_allclose(
        calibrated,
        np.asarray(
            [item["calibratedProbabilities"] for item in golden],
            dtype=np.float32,
        ),
        atol=tolerance,
        rtol=float(source["tolerances"]["relative"]),
    )

    samples = []
    for index, point in enumerate(points):
        samples.append(
            {
                "pointId": str(point["pointId"]),
                "referenceSource": inputs.reference_sources[index],
                "inputs": {
                    "series": flattened(inputs.series[index]),
                    "physics": flattened(inputs.physics[index]),
                    "neighborSeries": flattened(inputs.neighbor_series[index]),
                    "neighborPhysics": flattened(inputs.neighbor_physics[index]),
                    "neighborWeights": flattened(inputs.neighbor_weights[index]),
                    "reliability": float(inputs.reliability[index]),
                },
                "expected": {
                    "logits": flattened(logits[index]),
                    "physicsLogits": flattened(physics_logits[index]),
                    "rawProbabilities": flattened(raw[index]),
                    "rawClassId": int(np.argmax(raw[index])),
                    "calibratedProbabilities": flattened(calibrated[index]),
                    "classId": int(np.argmax(calibrated[index])),
                    "confidence": float(np.max(calibrated[index])),
                    "spatialGateMean": float(gate_means[index]),
                },
            }
        )

    payload = {
        "schemaVersion": "pasc-browser-parity-v1",
        "contractVersion": runtime.manifest["contractVersion"],
        "modelVersion": runtime.manifest["modelVersion"],
        "bundleBuildHash": runtime.manifest["buildHash"],
        "checkpointSha256": runtime.manifest["assets"]["checkpoint.pth"],
        "modelSha256": file_sha256(args.model),
        "sourceFixtureSha256": hashlib.sha256(source_bytes).hexdigest(),
        "classOrder": [item["canonicalName"] for item in runtime.classes],
        "calibration": runtime.calibration,
        "inputShape": {
            "timeSteps": int(inputs.series.shape[2]),
            "physicsFeatures": int(inputs.physics.shape[1]),
            "neighbors": int(inputs.neighbor_weights.shape[1]),
        },
        "prototypeCounts": [1, 10, 100, 1000],
        "batchSize": 20,
        "tolerances": {
            "logitMaxAbsDiff": 1e-4,
            "probabilityMaxAbsDiff": tolerance,
        },
        "baseSamples": samples,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "bytes": args.output.stat().st_size,
                "samples": len(samples),
                "modelSha256": payload["modelSha256"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
