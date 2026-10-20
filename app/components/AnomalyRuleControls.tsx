"use client";

import { useState } from "react";
import { DEFAULT_PRIORITY_OPTIONS, normalizePriorityOptions, type PriorityDeformationOptions } from "../lib/priority-deformation";

export function AnomalyRuleControls({ options, evaluationDate, onApply }: {
  options: ReturnType<typeof normalizePriorityOptions>;
  evaluationDate: string;
  onApply: (options: PriorityDeformationOptions) => void;
}) {
  const [draft, setDraft] = useState(() => ({
    velocity: String(options.velocityMmPerYear), displacement: String(options.displacementMm),
    radius: String(options.radiusMeters), minimum: String(options.minimumPoints),
    coherence: String(options.coherenceThreshold), direction: options.direction,
  }));
  const dirty = Number(draft.velocity) !== options.velocityMmPerYear || Number(draft.displacement) !== options.displacementMm
    || Number(draft.radius) !== options.radiusMeters || Number(draft.minimum) !== options.minimumPoints
    || Number(draft.coherence) !== options.coherenceThreshold || draft.direction !== options.direction;
  return <form className="anomaly-rule-form" onSubmit={event => {
    event.preventDefault();
    onApply({ velocityMmPerYear: Number(draft.velocity), displacementMm: Number(draft.displacement),
      radiusMeters: Number(draft.radius), minimumPoints: Number(draft.minimum),
      coherenceThreshold: Number(draft.coherence), direction: draft.direction });
  }}>
    <p className="anomaly-period-note">全观测期速率 + {evaluationDate || "数据末期"} 累计量。时间轴仅用于回看，不改变发现结果。</p>
    <fieldset><legend>1 · 两个量同时达标</legend>
      <label>速率绝对值 ≥<input aria-label="异常速率绝对值下限" type="number" required min="0.1" max="100000" step="any" value={draft.velocity} onChange={e => setDraft({ ...draft, velocity: e.target.value })} /><small>mm/yr</small></label>
      <label>累计量绝对值 ≥<input aria-label="异常累计量绝对值下限" type="number" required min="0.1" max="1000000" step="any" value={draft.displacement} onChange={e => setDraft({ ...draft, displacement: e.target.value })} /><small>mm</small></label>
      <label className="anomaly-rule-wide">形变方向<select aria-label="异常形变方向" value={draft.direction} onChange={e => setDraft({ ...draft, direction: e.target.value as typeof draft.direction })}><option value="both">正负双向 · 分别聚集</option><option value="negative">仅负向</option><option value="positive">仅正向</option></select></label>
      <p>速率与累计量须同号。正负表示观测方向，需结合数据的符号约定解释。</p>
    </fieldset>
    <fieldset><legend>2 · 同向点集中分布</legend>
      <label>邻域半径<input aria-label="异常聚集半径" type="number" required min="25" max="5000" step="any" value={draft.radius} onChange={e => setDraft({ ...draft, radius: e.target.value })} /><small>m</small></label>
      <label>邻域最少点数<input aria-label="异常聚集最少点数" type="number" required min="3" max="50" step="1" value={draft.minimum} onChange={e => setDraft({ ...draft, minimum: e.target.value })} /><small>点</small></label>
      <p>含中心点，重复坐标只计一次。密度连通后形成区域，孤立大值点单列待查。</p>
    </fieldset>
    <fieldset><legend>3 · 核对观测质量</legend>
      <label className="anomaly-rule-wide">相干性下限<input aria-label="异常相干性下限" type="number" required min="0" max="1" step="0.01" value={draft.coherence} onChange={e => setDraft({ ...draft, coherence: e.target.value })} /></label>
      <p>排除已知低相干或缺测率 &gt; 20% 的点；未提供相干性标记为质量待核实。</p>
    </fieldset>
    <p className="anomaly-default-note">初始值用于探索筛选，可按观测精度、监测年限和点间距调整；并非通用预警阈值。PASC 模式仅辅助解释。</p>
    {dirty && <p className="anomaly-draft-note" role="status">参数尚未应用，地图仍显示上次结果。</p>}
    <button className="anomaly-apply-button" type="submit">{dirty ? "应用规则并发现异常" : "发现异常"} ↗</button>
    <button className="workspace-text-action" type="button" onClick={() => setDraft({ velocity: String(DEFAULT_PRIORITY_OPTIONS.velocityMmPerYear), displacement: String(DEFAULT_PRIORITY_OPTIONS.displacementMm), radius: String(DEFAULT_PRIORITY_OPTIONS.radiusMeters), minimum: String(DEFAULT_PRIORITY_OPTIONS.minimumPoints), coherence: String(DEFAULT_PRIORITY_OPTIONS.coherenceThreshold), direction: DEFAULT_PRIORITY_OPTIONS.direction })}>恢复初始参数</button>
  </form>;
}
