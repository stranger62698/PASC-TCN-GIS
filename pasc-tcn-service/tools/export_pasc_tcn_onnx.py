"""Export the frozen PASC-TCN model to ONNX without changing its math."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import onnx
import torch

SERVICE_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = SERVICE_ROOT.parent
SOURCE_ROOT = SERVICE_ROOT / "src"
if str(SOURCE_ROOT) not in sys.path:
    sys.path.insert(0, str(SOURCE_ROOT))

from pasc_tcn_onnx_support import (  # noqa: E402
    PascTcnOnnxAdapter,
    build_model_inputs,
    preprocess_request,
)
from pasc_tcn_service.inference import FrozenModelRuntime, file_sha256  # noqa: E402

DEFAULT_BUNDLE = (
    SERVICE_ROOT / ".private-model-bundles" / "pasc-tcn-haikou-v1"
)
DEFAULT_FIXTURE = SERVICE_ROOT / "tests" / "fixtures" / "phase_d_inference_golden.json"
DEFAULT_OUTPUT = REPOSITORY_ROOT / "artifacts" / "pasc-tcn.onnx"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export the hash-verified PASC-TCN checkpoint to ONNX."
    )
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--opset", type=int, default=18)
    return parser.parse_args()


def add_metadata(
    model: onnx.ModelProto,
    runtime: FrozenModelRuntime,
    opset: int,
) -> None:
    metadata = {
        "pasc.architecture_version": str(runtime.config["architectureVersion"]),
        "pasc.bundle_build_hash": str(runtime.manifest["buildHash"]),
        "pasc.checkpoint_sha256": str(
            runtime.manifest["assets"]["checkpoint.pth"]
        ),
        "pasc.classes": json.dumps(
            runtime.classes,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ),
        "pasc.class_order": json.dumps(
            [item["canonicalName"] for item in runtime.classes],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "pasc.confidence_definition": "max(calibrated_probabilities)",
        "pasc.contract_version": str(runtime.manifest["contractVersion"]),
        "pasc.feature_order": json.dumps(
            runtime.config["featureOrder"],
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        "pasc.model_version": str(runtime.manifest["modelVersion"]),
        "pasc.opset": str(opset),
        "pasc.probability_calibration": json.dumps(
            runtime.calibration,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ),
    }
    del model.metadata_props[:]
    for key, value in sorted(metadata.items()):
        entry = model.metadata_props.add()
        entry.key = key
        entry.value = value


def main() -> int:
    args = parse_args()
    if args.opset < 18:
        raise ValueError("opset must be at least 18")

    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    request = fixture["scenarioRequests"]["native248"]
    runtime = FrozenModelRuntime(args.bundle, device_name="cpu")
    inputs = build_model_inputs(runtime, preprocess_request(request))

    adapter = PascTcnOnnxAdapter(runtime.model.cpu().eval()).eval()
    torch_args = inputs.as_torch_args()
    with torch.inference_mode():
        adapter(*torch_args)

    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        adapter,
        torch_args,
        str(output),
        input_names=[
            "series",
            "physics",
            "neighbor_series",
            "neighbor_physics",
            "neighbor_weights",
            "reliability",
        ],
        output_names=[
            "logits",
            "physics_logits",
            "spatial_gate_mean",
        ],
        dynamic_axes={
            "series": {0: "batch", 2: "time"},
            "physics": {0: "batch"},
            "neighbor_series": {0: "batch", 3: "time"},
            "neighbor_physics": {0: "batch"},
            "neighbor_weights": {0: "batch"},
            "reliability": {0: "batch"},
            "logits": {0: "batch"},
            "physics_logits": {0: "batch"},
            "spatial_gate_mean": {0: "batch"},
        },
        opset_version=args.opset,
        do_constant_folding=True,
        dynamo=False,
    )

    model = onnx.load(output)
    add_metadata(model, runtime, args.opset)
    onnx.checker.check_model(model, full_check=True)
    onnx.save(model, output)

    manifest = {
        "artifact": output.name,
        "artifactBytes": output.stat().st_size,
        "artifactSha256": file_sha256(output),
        "bundleBuildHash": runtime.manifest["buildHash"],
        "checkpointSha256": runtime.manifest["assets"]["checkpoint.pth"],
        "classOrder": [item["canonicalName"] for item in runtime.classes],
        "confidenceDefinition": "max(calibrated_probabilities)",
        "contractVersion": runtime.manifest["contractVersion"],
        "fixtureSha256": hashlib.sha256(args.fixture.read_bytes()).hexdigest(),
        "inputContract": {
            "series": ["batch", 1, "time"],
            "physics": ["batch", len(runtime.config["featureOrder"])],
            "neighborSeries": [
                "batch",
                int(runtime.config["neighbors"]),
                1,
                "time",
            ],
            "neighborPhysics": [
                "batch",
                int(runtime.config["neighbors"]),
                len(runtime.config["featureOrder"]),
            ],
            "neighborWeights": ["batch", int(runtime.config["neighbors"])],
            "reliability": ["batch"],
        },
        "modelVersion": runtime.manifest["modelVersion"],
        "opset": args.opset,
        "sourceFramework": f"PyTorch {torch.__version__}",
    }
    manifest_path = output.with_suffix(".manifest.json")
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
