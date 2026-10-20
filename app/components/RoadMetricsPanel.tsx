"use client";
import { useState } from "react";
import { roadOpsMetricsCsv, roadOpsMetricsJson, type RoadOpsMetricsSnapshot } from "../lib/roadops-metrics";
import { ROAD_WORK_ORDER_STATUS_LABELS, ROAD_WORK_ORDER_STATUSES } from "../lib/roadops-workflow";

const groups = [
  { id: "quality", label: "路网质量" },
  { id: "workflow", label: "审核与外业" },
  { id: "route", label: "路线收益" },
  { id: "api", label: "调用用量" },
] as const;
const format = (value: number | null) => value === null ? "未观测" : value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function RoadMetricsPanel({ snapshot }: { snapshot: RoadOpsMetricsSnapshot }) {
  const [group, setGroup] = useState<(typeof groups)[number]["id"]>("quality");
  const exportSnapshot = (type: "json" | "csv") => {
    const content = type === "json" ? roadOpsMetricsJson(snapshot) : `\uFEFF${roadOpsMetricsCsv(snapshot)}`;
    const url = URL.createObjectURL(new Blob([content], { type: type === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `roadops-metrics.${type}`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <section className="road-metrics-panel" aria-label="数据生产指标">
    <header><div><small>ROADOPS · QUALITY & OPERATIONS</small><h3>数据生产指标</h3></div><span>本地演示</span></header>
    <p className="road-metrics-intro">从规则候选到外业计划，查看当前数据的质量与处理进度。</p>
    <div className="road-metrics-groups" aria-label="指标分类">{groups.map(item => <button type="button" key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}>{item.label}</button>)}</div>
    {group === "workflow" && <ol className="road-metrics-workflow" aria-label="当前审核状态分布">{ROAD_WORK_ORDER_STATUSES.map(status => <li key={status}><strong>{snapshot.workflow[status]}</strong><span>{ROAD_WORK_ORDER_STATUS_LABELS[status]}</span></li>)}</ol>}
    {group === "api" && <p className="road-metrics-notice">本面板会话统计；固定回放单独计数。服务预算只反映最近响应的进程内计数，重启会重置，不能当作滴图账号账单。批量请求的实际配额消耗仍待控制台核对。</p>}
    {group === "route" && <p className="road-metrics-notice">离线收益比较同一组点的输入顺序与优化顺序；实时及回放缺少同口径基准时不计算节省率。</p>}
    <div className="road-metrics-grid">{snapshot.metrics.filter(metric => metric.group === group).map(metric => <article key={metric.id} data-metric-id={metric.id}>
      <span>{metric.label}</span><div className="road-metric-value"><b>{format(metric.value)}</b>{metric.value !== null && <small>{metric.unit}</small>}</div>
      <details><summary>{metric.label}口径</summary><dl>
        <dt>定义</dt><dd>{metric.definition}</dd>
        <dt>分子 / 分母</dt><dd>{format(metric.numerator)} / {format(metric.denominator)}</dd>
        <dt>时间范围</dt><dd>{metric.timeRange}</dd>
        <dt>来源</dt><dd>{metric.source}</dd>
      </dl></details>
    </article>)}</div>
    <footer><span>导出包含指标口径与来源</span><div><button type="button" onClick={() => exportSnapshot("json")}>指标 JSON</button><button type="button" onClick={() => exportSnapshot("csv")}>指标 CSV</button></div></footer>
  </section>;
}
