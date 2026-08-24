from __future__ import annotations

import argparse
import csv
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = SERVICE_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from pasc_tcn_service.inference import reset_runtime  # noqa: E402
from pasc_tcn_service.phase_g import evaluate_phase_g  # noqa: E402


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run frozen Phase G external-region evidence evaluation.")
    parser.add_argument(
        "--fixture",
        type=Path,
        default=SERVICE_ROOT / "tests" / "fixtures" / "phase_d_inference_golden.json",
    )
    parser.add_argument("--output", type=Path, default=SERVICE_ROOT / "phase_g_results")
    parser.add_argument("--bundle", type=Path, default=SERVICE_ROOT / ".private-model-bundles" / "pasc-tcn-haikou-v1")
    parser.add_argument("--device", default="cpu")
    return parser


def _write_csv(path: Path, scenarios: list[dict]) -> None:
    fields = [
        "scenario", "category", "pointCount", "effectiveEpochs", "temporalApplicability",
        "spatialApplicability", "classAgreementVsNative", "maximumProbabilityDeltaVsNative",
        "meanConfidence", "meanSpatialReliability", "meanSpatialGate", "maximumGapDays",
        "normalizedSeriesMaxAbsDiff", "physicalRawMaxAbsDiff", "physicalScaledMaxAbsDiff",
        "accuracyEvaluated",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for scenario in scenarios:
            comparison = scenario.get("preprocessingComparison") or {}
            writer.writerow({
                **{field: scenario.get(field) for field in fields},
                "effectiveEpochs": "|".join(map(str, scenario["effectiveEpochs"])),
                "temporalApplicability": "|".join(scenario["temporalApplicability"]),
                "spatialApplicability": "|".join(scenario["spatialApplicability"]),
                "normalizedSeriesMaxAbsDiff": comparison.get("normalizedSeriesMaxAbsDiff"),
                "physicalRawMaxAbsDiff": comparison.get("physicalRawMaxAbsDiff"),
                "physicalScaledMaxAbsDiff": comparison.get("physicalScaledMaxAbsDiff"),
            })


def _fmt(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, float):
        return f"{value:.8g}"
    return str(value)


def _write_report(path: Path, result: dict) -> None:
    scenario_rows = []
    for item in result["scenarios"]:
        scenario_rows.append(
            "| {scenario} | {category} | {epochs} | {agreement} | {delta} | {reliability} | {gate} | {spatial} |".format(
                scenario=item["scenario"],
                category=item["category"],
                epochs=",".join(map(str, item["effectiveEpochs"])),
                agreement=_fmt(item["classAgreementVsNative"]),
                delta=_fmt(item["maximumProbabilityDeltaVsNative"]),
                reliability=_fmt(item["meanSpatialReliability"]),
                gate=_fmt(item["meanSpatialGate"]),
                spatial=",".join(item["spatialApplicability"]),
            )
        )
    comparison = result["branchEvidence"]["coordinateShiftTemporalPhysicalInvariant"]
    self_neighborhood = result["selfNeighborhood"]
    lines = [
        "# Phase G 外区适用性与泛化证据报告",
        "",
        f"生成时间：{result['generatedAt']}",
        "",
        "## 结论",
        "",
        "本次是无外部标签的受控稳健性评估，不是外区精度验证，也不支持‘任意城市高精度’表述。坐标平移保持时间序列和13维物理特征不变；当固定海口空间参考不可用时，空间可靠性与门控归零，产品必须降级为探索性识别并提示人工判读。",
        "",
        "产品固定文案：",
        "",
        *[f"> {line}" for line in result["requiredProductWording"]],
        "",
        "## 冻结边界",
        "",
        "- 模型定义、训练参数、13维物理特征、生产空间机制均未改变。",
        "- 未在用户数据上拟合或训练。",
        "- Self-neighborhood 只做离线诊断，未写入预测路径。",
        "",
        "## 分支独立证据",
        "",
        f"- 坐标平移后的 normalized series 最大绝对差：`{_fmt(comparison['normalizedSeriesMaxAbsDiff'])}`。",
        f"- 13维原始物理特征最大绝对差：`{_fmt(comparison['physicalRawMaxAbsDiff'])}`。",
        f"- 冻结缩放后物理特征最大绝对差：`{_fmt(comparison['physicalScaledMaxAbsDiff'])}`。",
        f"- 外区空间分支是否全部被抑制：`{result['branchEvidence']['externalSpatialBranchSuppressed']}`。",
        "",
        "## 场景结果",
        "",
        "| 场景 | 类型 | 有效期数 | 类别一致率 vs 248 | 最大概率差 | 平均空间可靠性 | 平均门控 | 空间适用性 |",
        "|---|---|---:|---:|---:|---:|---:|---|",
        *scenario_rows,
        "",
        "所有场景 `accuracyEvaluated=false`；上述一致率和概率差仅表示相对冻结基准的受控扰动响应。",
        "",
        "## 单位、符号、轨道与采样",
        "",
        "- cm/cm-year 与 mm/mm-year 语义等价输入通过冻结单位归一化比较。",
        "- `subsidence_positive` 与 model-native 符号等价输入通过冻结符号归一化比较。",
        "- 40/80/160 节点由同一 248 节点序列确定性端点保留抽样，进入既有实验性时间适配器。",
        f"- 轨道差异：`{result['orbitDifference']['status']}`。{result['orbitDifference']['reason']}",
        "",
        "## Self-neighborhood 实验",
        "",
        f"- 状态：`{self_neighborhood['status']}`；点数：{self_neighborhood['pointCount']}。",
        f"- 输入构造：`{self_neighborhood.get('inputConstruction', 'not_recorded')}`；合成坐标：`{self_neighborhood.get('syntheticCoordinates', False)}`。",
        f"- 候选平均可靠性：`{_fmt(self_neighborhood.get('meanCandidateReliability'))}`；预测应用：`{self_neighborhood['predictionApplied']}`；产品可用：`{self_neighborhood['productionEligible']}`。",
        f"- {self_neighborhood.get('warning', '批内点不足，未计算。')}",
        "",
        "## 产品适用性",
        "",
        "- `full_reference`：海口固定空间参考可用，时间/物理与空间证据共同参与。",
        "- `limited_reference`：固定空间参考不可用或超出验证区，空间可靠性和门控下降，主要依赖 TCN 时间分支与运动学物理特征，必须展示探索性文案。",
        "-`not_evaluated`：没有足够证据给出空间适用性结论。",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    args = _parser().parse_args()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    os.environ["PASC_MODEL_BUNDLE_DIR"] = str(args.bundle.resolve())
    os.environ["PASC_DEVICE"] = args.device
    os.environ.setdefault("PASC_ARTIFACT_SIGNING_KEY", secrets.token_hex(32))
    reset_runtime()
    result = evaluate_phase_g(fixture)
    result["generatedAt"] = datetime.now(timezone.utc).isoformat()
    result["inputs"] = {
        "fixture": args.fixture.name,
        "bundle": {"mode": "private_hash_verified_runtime", "pathRecorded": False},
        "device": args.device,
    }
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "phase_g_results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    _write_csv(args.output / "phase_g_scenarios.csv", result["scenarios"])
    _write_report(args.output / "PHASE_G_EXTERNAL_REGION_REPORT.md", result)
    print(json.dumps({
        "output": str(args.output.resolve()),
        "scenarios": len(result["scenarios"]),
        "externalSpatialBranchSuppressed": result["branchEvidence"]["externalSpatialBranchSuppressed"],
        "externalAccuracyEvaluated": result["claims"]["externalAccuracyEvaluated"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
