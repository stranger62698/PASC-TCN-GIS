import type { PascCompatibilitySummary } from "../types/pasc";

const temporalLabels = {
  native_248: "原生 248 期",
  adapted_to_248: "可按 12 天步长补齐缺口",
  experimental_adapted_to_248: "将按 12 天步长补齐缺口（实验性）",
  unsupported: "PASC 不可用",
} as const;
const spatialLabels = {
  full_reference: "完整空间参考",
  limited_reference: "等待按上传研究区建立邻域",
  not_evaluated: "空间尚未评估",
} as const;

export function PascCompatibilityCheck({ summary }: { summary: PascCompatibilitySummary | null }) {
  if (!summary) {
    return <section className="pasc-compatibility is-empty"><span>COMPATIBILITY</span><b>等待数据检查</b><p>导入 CSV 后显示 Level、逐点有效期数和双维适用性。</p></section>;
  }
  return (
    <section className="pasc-compatibility">
      <header><span>数据兼容性</span><small>{summary.contractVersion}</small></header>
      <div className="pasc-level">
        <b>L{summary.capabilityLevel}</b>
        <span>数据能力等级<small>{summary.pascCandidatePoints.toLocaleString()} / {summary.totalPoints.toLocaleString()} 个 PASC 候选点</small></span>
      </div>
      <dl>
        <div><dt>有效期范围</dt><dd>{summary.minEffectiveEpochs}—{summary.maxEffectiveEpochs}</dd></div>
        <div><dt>时间适用性</dt><dd>{temporalLabels[summary.temporalApplicability]}</dd></div>
        <div><dt>空间适用性</dt><dd>{spatialLabels[summary.spatialApplicability]}</dd></div>
        <div><dt>PASC 候选点</dt><dd>{summary.pascCandidatePoints.toLocaleString()}</dd></div>
      </dl>
      <div className="pasc-cadence-flow" aria-label="十二天缺口补值流程"><span><i>01</i><b>保留原始日期</b></span><em>→</em><span><i>02</i><b>仅补大于12天的缺口</b></span><em>→</em><span><i>03</i><b>SG 与分类</b></span></div>
      {summary.issues.length > 0
        ? <ul>{summary.issues.map((issue, index) => <li className={issue.severity} key={`${issue.code}-${index}`}><b>{issue.code}</b><span>{issue.message}</span></li>)}</ul>
        : <p className="pasc-clear">协议预检查未发现阻断项。</p>}
      <footer>每个 CSV 独立处理：保留全部原始日期，只在相邻日期缺口大于 12 天时按 12 天步长补值；输出期数由本数据自己的缺口决定，与其他数据集无关。</footer>
    </section>
  );
}
