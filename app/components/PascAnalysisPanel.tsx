import type { InsarPoint } from "../data/site";
import { pascApplicabilityPresentation, pascClassById } from "../lib/pasc";
import { deriveTemporalStageAnalysis, pascModeExplanation, pointDataQuality, topPascCandidates } from "../lib/pasc-product";
import { PascPatternLegend } from "./PascPatternLegend";
import { PascProbabilityBars } from "./PascProbabilityBars";

const sourceLabel = { provided: "数据提供", calculated: "真实日期计算", default: "冻结默认值", not_available: "不可用" } as const;
const temporalLabel = {
  native_248: "原生248期",
  adapted_to_248: "已适配至248期",
  experimental_adapted_to_248: "已按真实日期插值至248期（实验性）",
  unsupported: "不支持",
} as const;

export function PascAnalysisPanel({ point }: { point: InsarPoint | null }) {
  if (!point) return <section className="pasc-analysis-empty"><b>选择监测点</b><span>查看 PASC 识别结果、六类概率和可追溯字段。</span></section>;
  const result = point.pasc;
  const classInfo = result ? pascClassById(result.calibratedLabelId) : null;
  const applicability = result ? pascApplicabilityPresentation(result.spatialApplicability) : null;
  const topTwo = topPascCandidates(result);
  const dataQuality = pointDataQuality(point);
  const stage = deriveTemporalStageAnalysis(point);
  const explanation = pascModeExplanation(point);
  return (
    <div className="pasc-analysis">
      <section className="pasc-point-stamp">
        <header><span>PASC-TCN / POINT</span><small>{result?.contractVersion ?? "pasc-contract-v1"}</small></header>
        <div>
          <i style={{ background: classInfo?.color ?? "#4D4D4D" }} />
          <span><small>{point.id}</small><b>{classInfo?.nameZh ?? "暂无 PASC 分类结果"}</b><em>{classInfo?.name ?? "PASC RESULT NOT PROVIDED"}</em></span>
          {result && <strong>{(result.confidence * 100).toFixed(1)}%</strong>}
        </div>
      </section>
      {result ? <>
        <PascProbabilityBars result={result} />
        <section className="pasc-product-evidence">
          <header><span>结果解读</span><small>模式与数据质量分开呈现</small></header>
          <div className="pasc-top-two">
            {topTwo.map((candidate, index) => <article key={candidate.name}><i style={{ background: candidate.color }} /><span>Top-{index + 1}</span><b>{candidate.nameZh}</b><strong>{(candidate.probability * 100).toFixed(1)}%</strong></article>)}
          </div>
          <div className={`pasc-quality-state is-${dataQuality.level}`}><span>数据质量</span><b>{dataQuality.label}</b><small>{dataQuality.reasons.join(" · ")}</small></div>
          {stage && <div className="pasc-stage-summary"><span>候选变化点</span><b>{stage.changeDate}</b><small>前段 {stage.slopeBefore.toFixed(2)} · 后段 {stage.slopeAfter.toFixed(2)} mm/yr</small><em>{stage.method}</em></div>}
          {explanation && <p>{explanation}</p>}
          <small className="pasc-product-boundary">模式解释不等同于风险结论；请结合空间聚集、数据质量与现场资料复核。</small>
        </section>
        {applicability && <section className={`pasc-applicability is-${applicability.state}`}>
          <small>{applicability.eyebrow}</small>
          <b>{applicability.line1}</b>
          <strong>{applicability.line2}</strong>
          <p>{applicability.evidence}</p>
        </section>}
        <section className="pasc-trace">
          <div><span>模型版本</span><b>{result.modelVersion}</b></div>
          <div><span>时间适用性</span><b>{temporalLabel[result.temporalApplicability]}</b></div>
          <div><span>空间适用性</span><b>{result.spatialApplicability}</b></div>
          <div><span>低置信度</span><b>{result.lowConfidence ? "是" : "否"}</b></div>
          <div><span>空间可靠性</span><b>{result.spatialReliability.toFixed(3)}</b></div>
          <div><span>门控均值</span><b>{result.spatialGateMean.toFixed(3)}</b></div>
        </section>
      </> : <PascPatternLegend compact />}
      <section className="pasc-sources">
        <span>输入审计</span>
        <div><b>有效期 {point.effectiveEpochCount ?? point.series.length}</b><small>L{point.capabilityLevel ?? "—"} · {point.temporalApplicability ?? "unsupported"}</small></div>
        <div><b>velocity：{sourceLabel[point.velocitySource ?? "not_available"]}</b><small>{point.velocitySource === "not_available" ? "—" : `${point.velocity.toFixed(2)} mm/year`}</small></div>
        <div><b>coherence：{sourceLabel[point.coherenceSource ?? "not_available"]}</b><small>{point.coherenceSource === "not_available" ? "—" : point.coherence.toFixed(3)}</small></div>
      </section>
      {(point.warnings?.length ?? 0) > 0 && <ul className="pasc-point-warnings">{point.warnings?.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </div>
  );
}
