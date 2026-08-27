import type { PascCompatibilitySummary } from "../types/pasc";

const temporalLabels = {
  native_248: "原生 248 期",
  adapted_to_248: "可补齐为 12 天等间隔",
  experimental_adapted_to_248: "将按实际日期补齐为 12 天等间隔（实验性）",
  unsupported: "PASC 不可用",
} as const;
const spatialLabels = {
  full_reference: "完整空间参考",
  limited_reference: "空间参考有限",
  not_evaluated: "空间尚未评估",
} as const;

export function PascCompatibilityCheck({ summary }: { summary: PascCompatibilitySummary | null }) {
  if (!summary) {
    return <section className="pasc-compatibility is-empty"><span>COMPATIBILITY</span><b>等待数据检查</b><p>导入 CSV 后显示 Level、逐点有效期数和双维适用性。</p></section>;
  }
  return (
    <section className="pasc-compatibility">
      <header><span>COMPATIBILITY / INPUT</span><small>{summary.contractVersion}</small></header>
      <div className="pasc-level">
        <b>L{summary.capabilityLevel}</b>
        <span>数据能力等级<small>{summary.pascCandidatePoints.toLocaleString()} / {summary.totalPoints.toLocaleString()} 个 PASC 候选点</small></span>
      </div>
      <dl>
        <div><dt>有效期范围</dt><dd>{summary.minEffectiveEpochs}—{summary.maxEffectiveEpochs}</dd></div>
        <div><dt>时间适用性</dt><dd>{temporalLabels[summary.temporalApplicability]}</dd></div>
        <div><dt>空间适用性</dt><dd>{spatialLabels[summary.spatialApplicability]}</dd></div>
        <div><dt>248 期点</dt><dd>{summary.native248Points.toLocaleString()}</dd></div>
      </dl>
      <div className="pasc-epoch-ruler" aria-label="19、20、248期门槛"><i /><span>19<br/><small>不支持</small></span><span>20<br/><small>实验门槛</small></span><span>248<br/><small>原生</small></span></div>
      {summary.issues.length > 0
        ? <ul>{summary.issues.map((issue, index) => <li className={issue.severity} key={`${issue.code}-${index}`}><b>{issue.code}</b><span>{issue.message}</span></li>)}</ul>
        : <p className="pasc-clear">协议预检查未发现阻断项。</p>}
      <footer>确认映射、单位、符号与平滑状态后，≥20 期候选点会先按实际日期线性插值为每 12 天一个节点，再执行 SG 与模型识别；不会把序列强行拉伸到 248 期。20—39 个原始观测仅供探索性判读。</footer>
    </section>
  );
}
