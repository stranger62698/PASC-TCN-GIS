"""Validate fixed-sample PyTorch/ONNX parity for the frozen PASC-TCN model."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
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
DEFAULT_FIXTURE = SERVICE_ROOT / "tests" / "fixtures" / "phase_d_inference_golden.json"
DEFAULT_ONNX = REPOSITORY_ROOT / "artifacts" / "pasc-tcn.onnx"
DEFAULT_JSON = REPOSITORY_ROOT / "artifacts" / "pasc-tcn-parity.json"
DEFAULT_REPORT = SERVICE_ROOT / "PHASE_1_ONNX_VALIDATION_REPORT.md"
SCENARIOS = ("native248", "adapted40", "external")
GOLDEN_BASELINE_SCENARIOS = {"native248", "external"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare frozen PyTorch and ONNX Runtime outputs."
    )
    parser.add_argument("--bundle", type=Path, default=DEFAULT_BUNDLE)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--onnx", type=Path, default=DEFAULT_ONNX)
    parser.add_argument("--json-output", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--logit-tolerance", type=float, default=1e-4)
    parser.add_argument("--probability-tolerance", type=float, default=5e-5)
    return parser.parse_args()


def max_and_mean(values: list[np.ndarray]) -> tuple[float, float]:
    flattened = np.concatenate([value.reshape(-1) for value in values])
    return float(np.max(flattened)), float(np.mean(flattened))


def render_report(result: dict[str, Any]) -> str:
    metrics = result["metrics"]
    acceptance = result["acceptance"]
    scenario_lines = "\n".join(
        f"| {item['name']} | {item['samples']} | {item['timeSteps']} | "
        f"{item['classMatches']}/{item['samples']} |"
        for item in result["scenarios"]
    )
    mismatch_lines = (
        "无。"
        if not result["mismatches"]
        else "\n".join(
            f"- `{item['scenario']}/{item['pointId']}`："
            f"PyTorch={item['pytorchClass']}，ONNX={item['onnxClass']}"
            for item in result["mismatches"]
        )
    )
    status = "通过" if result["passed"] else "未通过"
    return f"""# Phase 1：PASC-TCN ONNX 一致性验证报告

## 结论

**{status}**。固定回归样本的 PyTorch 与 ONNX Runtime 预测类别一致率为 **{metrics['classAgreementRate']:.2%}**，最大校准概率差异为 **{metrics['calibratedProbabilityMaxAbsDiff']:.9g}**。

本阶段仅导出模型并执行 Python 端一致性验证，未修改正式网页，也未把模型放入 `public/models/`。

## 验证对象

- 模型版本：`{result['modelVersion']}`
- 契约版本：`{result['contractVersion']}`
- 模型 bundle build hash：`{result['bundleBuildHash']}`
- checkpoint SHA-256：`{result['checkpointSha256']}`
- ONNX SHA-256：`{result['onnxSha256']}`
- ONNX opset：`{result['opset']}`
- PyTorch：`{result['runtime']['pytorch']}`
- ONNX Runtime：`{result['runtime']['onnxRuntime']}`（CPUExecutionProvider）
- 验证时间（UTC）：`{result['generatedAt']}`

## 固定样本

| 场景 | 样本数 | 时间步 | 类别一致 |
| --- | ---: | ---: | ---: |
{scenario_lines}

总样本数：**{metrics['sampleCount']}**。

## 数值一致性

| 指标 | 最大绝对差 | 平均绝对差 |
| --- | ---: | ---: |
| logits | {metrics['logitMaxAbsDiff']:.9g} | {metrics['logitMeanAbsDiff']:.9g} |
| 原始 probability | {metrics['rawProbabilityMaxAbsDiff']:.9g} | {metrics['rawProbabilityMeanAbsDiff']:.9g} |
| 校准后 probability | {metrics['calibratedProbabilityMaxAbsDiff']:.9g} | {metrics['calibratedProbabilityMeanAbsDiff']:.9g} |
| confidence | {metrics['confidenceMaxAbsDiff']:.9g} | {metrics['confidenceMeanAbsDiff']:.9g} |

- 类别映射：{'一致' if acceptance['classMappingExact'] else '不一致'}
- confidence 定义：`max(calibrated_probabilities)`，{'一致' if acceptance['confidenceDefinitionExact'] else '不一致'}
- PyTorch / ONNX 原始类别一致率：{metrics['rawClassAgreementRate']:.2%}
- PyTorch / ONNX 最终类别一致率：{metrics['classAgreementRate']:.2%}
- PyTorch 与现有测试实际锁定的 Phase D golden 基线（native248、external）：{'一致' if acceptance['pytorchGoldenBaseline'] else '不一致'}
- logits 容差：`{result['tolerances']['logitMaxAbsDiff']}`
- probability 容差：`{result['tolerances']['probabilityMaxAbsDiff']}`

## 不一致样本

{mismatch_lines}

## 验收项

- 类别映射完全一致：{'通过' if acceptance['classMappingExact'] else '未通过'}
- confidence 定义完全一致：{'通过' if acceptance['confidenceDefinitionExact'] else '未通过'}
- 固定样本预测类别 100% 一致：{'通过' if acceptance['allClassesMatch'] else '未通过'}
- 概率差异在浮点容差内：{'通过' if acceptance['probabilityWithinTolerance'] else '未通过'}
- logits 差异在浮点容差内：{'通过' if acceptance['logitsWithinTolerance'] else '未通过'}
- 未改变模型数学结构：通过（ONNX adapter 仅将原模型字典输出展开为三个张量）

## 复现

```powershell
pasc-tcn-service\\.venv\\Scripts\\python.exe pasc-tcn-service\\tools\\export_pasc_tcn_onnx.py
pasc-tcn-service\\.venv\\Scripts\\python.exe pasc-tcn-service\\tools\\validate_onnx_parity.py
```

生成的 `artifacts/pasc-tcn.onnx` 与机器可读 JSON 保持为本地产物，不进入版本库；通过后才允许进入 Phase 2 浏览器最小原型。
"""


def main() -> int:
    args = parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    runtime = FrozenModelRuntime(args.bundle, device_name="cpu")
    adapter = PascTcnOnnxAdapter(runtime.model.cpu().eval()).eval()
    session = ort.InferenceSession(
        str(args.onnx.resolve()), providers=["CPUExecutionProvider"]
    )

    expected_inputs = {
        "series",
        "physics",
        "neighbor_series",
        "neighbor_physics",
        "neighbor_weights",
        "reliability",
    }
    actual_inputs = {item.name for item in session.get_inputs()}
    if actual_inputs != expected_inputs:
        raise RuntimeError(
            f"unexpected ONNX inputs: {sorted(actual_inputs)}"
        )

    metadata = session.get_modelmeta().custom_metadata_map
    class_order = [item["canonicalName"] for item in runtime.classes]
    mapping_exact = (
        json.loads(metadata.get("pasc.class_order", "[]")) == class_order
        and json.loads(metadata.get("pasc.classes", "[]")) == runtime.classes
    )
    confidence_definition_exact = (
        metadata.get("pasc.confidence_definition")
        == "max(calibrated_probabilities)"
    )

    logit_differences: list[np.ndarray] = []
    raw_probability_differences: list[np.ndarray] = []
    calibrated_probability_differences: list[np.ndarray] = []
    confidence_differences: list[np.ndarray] = []
    baseline_probability_differences: list[np.ndarray] = []
    scenario_results: list[dict[str, Any]] = []
    sample_results: list[dict[str, Any]] = []
    mismatches: list[dict[str, Any]] = []
    raw_matches = 0
    final_matches = 0
    baseline_classes_match = True

    dynamic_ids = list(runtime.calibration["dynamicClassIds"])
    multiplier = float(runtime.calibration["multiplier"])
    for scenario_name in SCENARIOS:
        points = preprocess_request(fixture["scenarioRequests"][scenario_name])
        model_inputs = build_model_inputs(runtime, points)
        with torch.inference_mode():
            pytorch_outputs = adapter(*model_inputs.as_torch_args())
        pytorch_logits = pytorch_outputs[0].cpu().numpy().astype(np.float32)
        pytorch_gate = pytorch_outputs[2].cpu().numpy().astype(np.float32)
        onnx_logits, _, onnx_gate = session.run(
            ["logits", "physics_logits", "spatial_gate_mean"],
            model_inputs.as_onnx_feed(),
        )
        onnx_logits = onnx_logits.astype(np.float32)
        onnx_gate = onnx_gate.astype(np.float32)

        pytorch_raw = stable_softmax(pytorch_logits)
        onnx_raw = stable_softmax(onnx_logits)
        pytorch_calibrated = calibrate_probabilities(
            pytorch_raw, dynamic_ids, multiplier
        )
        onnx_calibrated = calibrate_probabilities(
            onnx_raw, dynamic_ids, multiplier
        )
        pytorch_raw_class = np.argmax(pytorch_raw, axis=1)
        onnx_raw_class = np.argmax(onnx_raw, axis=1)
        pytorch_class = np.argmax(pytorch_calibrated, axis=1)
        onnx_class = np.argmax(onnx_calibrated, axis=1)
        pytorch_confidence = np.max(pytorch_calibrated, axis=1)
        onnx_confidence = np.max(onnx_calibrated, axis=1)

        logit_differences.append(np.abs(pytorch_logits - onnx_logits))
        raw_probability_differences.append(np.abs(pytorch_raw - onnx_raw))
        calibrated_probability_differences.append(
            np.abs(pytorch_calibrated - onnx_calibrated)
        )
        confidence_differences.append(
            np.abs(pytorch_confidence - onnx_confidence)
        )
        raw_matches += int(np.sum(pytorch_raw_class == onnx_raw_class))
        final_matches += int(np.sum(pytorch_class == onnx_class))

        golden_items = fixture["expected"][scenario_name]
        if len(golden_items) != len(points):
            raise RuntimeError(f"golden sample count changed for {scenario_name}")
        scenario_match_count = int(np.sum(pytorch_class == onnx_class))
        scenario_results.append(
            {
                "name": scenario_name,
                "samples": len(points),
                "timeSteps": int(model_inputs.series.shape[2]),
                "classMatches": scenario_match_count,
            }
        )

        for index, (point, golden) in enumerate(zip(points, golden_items)):
            point_id = str(point["pointId"])
            golden_raw = np.asarray(golden["rawProbabilities"], dtype=np.float32)
            golden_calibrated = np.asarray(
                golden["calibratedProbabilities"], dtype=np.float32
            )
            if scenario_name in GOLDEN_BASELINE_SCENARIOS:
                baseline_probability_differences.extend(
                    [
                        np.abs(pytorch_raw[index] - golden_raw),
                        np.abs(pytorch_calibrated[index] - golden_calibrated),
                    ]
                )
                baseline_classes_match = baseline_classes_match and (
                    int(pytorch_raw_class[index]) == int(golden["rawLabel"])
                    and int(pytorch_class[index]) == int(golden["finalLabel"])
                )
            sample = {
                "scenario": scenario_name,
                "pointId": point_id,
                "referenceSource": model_inputs.reference_sources[index],
                "pytorchRawClass": int(pytorch_raw_class[index]),
                "onnxRawClass": int(onnx_raw_class[index]),
                "pytorchClass": int(pytorch_class[index]),
                "onnxClass": int(onnx_class[index]),
                "pytorchConfidence": float(pytorch_confidence[index]),
                "onnxConfidence": float(onnx_confidence[index]),
                "confidenceAbsDiff": float(
                    abs(pytorch_confidence[index] - onnx_confidence[index])
                ),
                "pytorchSpatialGateMean": float(pytorch_gate[index]),
                "onnxSpatialGateMean": float(onnx_gate[index]),
            }
            sample_results.append(sample)
            if sample["pytorchClass"] != sample["onnxClass"]:
                mismatches.append(sample)

    sample_count = len(sample_results)
    logit_max, logit_mean = max_and_mean(logit_differences)
    raw_max, raw_mean = max_and_mean(raw_probability_differences)
    calibrated_max, calibrated_mean = max_and_mean(
        calibrated_probability_differences
    )
    confidence_max, confidence_mean = max_and_mean(confidence_differences)
    baseline_max, _ = max_and_mean(baseline_probability_differences)
    golden_tolerance = float(fixture["tolerances"]["absolute"])

    acceptance = {
        "classMappingExact": mapping_exact,
        "confidenceDefinitionExact": confidence_definition_exact,
        "allClassesMatch": final_matches == sample_count,
        "probabilityWithinTolerance": calibrated_max
        <= args.probability_tolerance,
        "logitsWithinTolerance": logit_max <= args.logit_tolerance,
        "pytorchGoldenBaseline": baseline_classes_match
        and baseline_max <= golden_tolerance,
    }
    passed = all(acceptance.values())
    result = {
        "schemaVersion": "pasc-onnx-parity-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "passed": passed,
        "modelVersion": runtime.manifest["modelVersion"],
        "contractVersion": runtime.manifest["contractVersion"],
        "bundleBuildHash": runtime.manifest["buildHash"],
        "checkpointSha256": runtime.manifest["assets"]["checkpoint.pth"],
        "fixtureSha256": hashlib.sha256(args.fixture.read_bytes()).hexdigest(),
        "onnxSha256": file_sha256(args.onnx.resolve()),
        "opset": session.get_modelmeta().custom_metadata_map.get(
            "pasc.opset", "18"
        ),
        "runtime": {
            "pytorch": str(torch.__version__),
            "onnxRuntime": str(ort.__version__),
            "provider": "CPUExecutionProvider",
        },
        "tolerances": {
            "logitMaxAbsDiff": args.logit_tolerance,
            "probabilityMaxAbsDiff": args.probability_tolerance,
            "goldenProbabilityMaxAbsDiff": golden_tolerance,
        },
        "metrics": {
            "sampleCount": sample_count,
            "rawClassAgreementRate": raw_matches / sample_count,
            "classAgreementRate": final_matches / sample_count,
            "logitMaxAbsDiff": logit_max,
            "logitMeanAbsDiff": logit_mean,
            "rawProbabilityMaxAbsDiff": raw_max,
            "rawProbabilityMeanAbsDiff": raw_mean,
            "calibratedProbabilityMaxAbsDiff": calibrated_max,
            "calibratedProbabilityMeanAbsDiff": calibrated_mean,
            "confidenceMaxAbsDiff": confidence_max,
            "confidenceMeanAbsDiff": confidence_mean,
            "pytorchGoldenProbabilityMaxAbsDiff": baseline_max,
        },
        "acceptance": acceptance,
        "scenarios": scenario_results,
        "mismatches": mismatches,
        "samples": sample_results,
    }

    args.json_output.parent.mkdir(parents=True, exist_ok=True)
    args.json_output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(render_report(result), encoding="utf-8")
    print(json.dumps(result["metrics"], ensure_ascii=False, indent=2))
    print(f"Phase 1 parity: {'PASS' if passed else 'FAIL'}")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
