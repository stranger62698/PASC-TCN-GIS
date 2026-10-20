"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { roadOpsUsageLabel, type RoadOpsDrivingPlan } from "../lib/roadops-driving";
import { assessFieldPlan, buildFieldBrief } from "../lib/roadops-field";
import { navigationFieldVisits, type NavigationDraft } from "../lib/roadops-navigation";
import type { RoadRiskEvidenceInput } from "../lib/roadops-quality";
import type { RoadStrategyComparison } from "../lib/roadops-strategy-comparison";
import { RoadStrategySummary } from "./RoadStrategySummary";

const statusLabels = { needs_replan: "需要重新规划", blocked: "存在执行阻断项", needs_review: "路线已算出 · 现场待核验", ready_with_checks: "核验已记录 · 出发前复核" };
const reviewLabels = { unknown: "入口未核实", confirmed: "已记录人工核验", blocked: "标记不可进入" };
const trafficLabels = ["路况未知", "畅通", "缓行", "拥堵", "严重拥堵"];
const freshnessLabels = { recent: "30天内记录", stale: "需复核时效", unknown: "采集时间未知", future: "时间异常" };
const issueLabels = { blocker: "阻断", review: "待核验", notice: "提示" };
const NO_EVIDENCE: RoadRiskEvidenceInput[] = [];

function FieldPlanIcon({ name }: { name: "review" | "check" | "focus" | "download" }) {
  return <svg className="road-navigation-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "review" && <><path d="M10.3 4.5a2 2 0 0 1 3.4 0l7.1 12.4a2 2 0 0 1-1.7 3H4.9a2 2 0 0 1-1.7-3Z" /><path d="M12 9v4m0 3h.01" /></>}
    {name === "check" && <><circle cx="12" cy="12" r="8" /><path d="m8 12 3 3 5-6" /></>}
    {name === "focus" && <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" /><circle cx="12" cy="12" r="3" /></>}
    {name === "download" && <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />}
  </svg>;
}

export function RoadFieldPlanPanel({ plan, comparison = null, draft, evidence = NO_EVIDENCE, activeLegId, onFocusLeg, onFocusPoint }: {
  plan: RoadOpsDrivingPlan; comparison?: RoadStrategyComparison | null; draft: NavigationDraft; evidence?: RoadRiskEvidenceInput[];
  activeLegId?: string | null; onFocusLeg: (id: string | null) => void; onFocusPoint: (coordinate: [number, number]) => void;
}) {
  const [includeEvidence, setIncludeEvidence] = useState(false);
  const [assessedAt, setAssessedAt] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(() => setAssessedAt(new Date().toISOString()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const visits = useMemo(() => navigationFieldVisits(draft), [draft]);
  const report = useMemo(() => assessFieldPlan(plan, visits, { startTime: draft.startTime ?? "08:30", workMinutes: draft.workMinutes ?? 480, bufferMinutes: draft.bufferMinutes ?? 30 }, includeEvidence ? evidence : NO_EVIDENCE, { assessedAt }), [plan, visits, draft.startTime, draft.workMinutes, draft.bufferMinutes, includeEvidence, evidence, assessedAt]);
  const [exportMessage, setExportMessage] = useState("");
  const resultElement = useRef<HTMLElement>(null);
  useEffect(() => {
    if (resultElement.current?.offsetParent) resultElement.current.scrollIntoView({ block: "start" });
  }, [plan.inputFingerprint]);
  function exportBrief() {
    const content = `${buildFieldBrief(report, plan, visits)}\n平台数据关联：${includeEvidence ? "已选当前平台数据，可能含演示内容；并非已核实现场事实" : "未启用（无额外现场数据）"}\n`;
    const url = URL.createObjectURL(new Blob(["\uFEFF", content], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `外业核查任务单-${plan.generatedAt.slice(0, 10)}.txt`;
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setExportMessage("已发起任务单下载，请检查浏览器下载目录。不会请求滴图。");
  }
  return <section ref={resultElement} className="road-field-plan" aria-label="外业行程与可达性核验">
    <div className={`road-field-status is-${report.status}`} role="status">
      <span>小客车外业 · 非实时导航</span>
      <div className="road-field-status-heading"><span className="road-field-status-icon"><FieldPlanIcon name={report.status === "ready_with_checks" ? "check" : "review"} /></span><strong>{statusLabels[report.status]}</strong></div>
      <p>地图商路线 ≠ 停车许可 ≠ 核查点可进入。未提供的现场条件均按未知处理。</p>
    </div>
    <RoadStrategySummary plan={plan} comparison={comparison} />
    <div className="road-field-schedule-summary"><b>含核查与机动 {Math.ceil(report.totals.totalMinutes)} 分钟</b><span>停留 {report.totals.dwellMinutes} 分钟 ＋ 机动 {report.totals.bufferMinutes} 分钟</span><span>预计结束 {report.totals.finishTime} · 可用 {report.totals.workMinutes} 分钟{report.totals.overtimeMinutes > 0 ? ` · 超时 ${Math.ceil(report.totals.overtimeMinutes)} 分钟` : ""}</span></div>
    <div className="road-field-section-title"><h4>沿道路分段查看</h4><button type="button" onClick={() => onFocusLeg(null)}><FieldPlanIcon name="focus" />全程视图</button></div>
    <p className="road-navigation-help">点击一段放大，蓝线箭头表示行驶方向。以下是相邻站点间路线，不是逐路口转向指令。</p>
    <ol className="road-field-legs">{report.legs.map(leg => {
      const detail = plan.field?.legs.find(item => item.id === leg.id);
      const traffic = trafficLabels.flatMap((label, status) => {
        const segments = detail?.traffic.filter(item => item.status === status) ?? [];
        return segments.length ? [`${label} ${(segments.reduce((sum, segment) => sum + segment.distanceMeters, 0) / 1000).toFixed(2)} km`] : [];
      });
      return <li key={leg.id}><button type="button" aria-pressed={activeLegId === leg.id} onClick={() => onFocusLeg(leg.id)}>
        <span className="road-field-leg-index">{leg.index}</span><span className="road-field-leg-copy"><strong>{leg.fromName} → {leg.toName}</strong><span>{(leg.distanceMeters / 1000).toFixed(2)} 公里 · {Math.ceil(leg.drivingMinutes)} 分钟</span><small>{leg.departureTime} 出发 → {leg.arrivalTime} 到达</small><small>{traffic.length ? traffic.join(" / ") : "未返回路况明细"}</small><small>{detail?.tollsYuan == null ? "费用未知" : `参考收费 ¥${detail.tollsYuan}`} · 路况为算路时快照</small></span><FieldPlanIcon name="focus" />
      </button></li>;
    })}</ol>
    <h4>逐站任务与最后一段</h4>
    <ol className="road-field-stops">{report.stops.map(stop => <li key={`${stop.id}-${stop.visitIndex}`}>
      <div className="road-field-stop-heading"><strong>{stop.visitIndex === 0 ? "起" : stop.visitIndex}. {stop.name}</strong><button type="button" onClick={() => onFocusPoint(stop.vehicleCoordinate)}><FieldPlanIcon name="focus" />查看到达点</button></div>
      <div className="road-field-stop-meta"><p>{stop.arrivalTime}{stop.dwellMinutes ? `–${stop.departureTime} · 核查/转移 ${stop.dwellMinutes} 分钟` : " · 不停留"}</p>
      <span className={`road-field-access is-${stop.accessReview}`}>{reviewLabels[stop.accessReview]}</span></div>
      <p>路线端点偏移 {stop.roadOffsetMeters === null ? "未知" : `${Math.round(stop.roadOffsetMeters)} 米`}{stop.roadOffsetMeters !== null && stop.roadOffsetMeters > 50 ? " · 需重新确认车辆位置" : ""}</p>
      {stop.targetGapMeters > 0 && <p>到核查目标直线 {Math.round(stop.targetGapMeters)} 米；未计算步行路径/耗时。</p>}
    </li>)}</ol>
    {report.issues.length > 0 && <details className="road-field-review" open><summary>出发前待办 / 阻断项（{report.issues.filter(item => item.severity !== "notice").length}）</summary><ul>{report.issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={`is-${issue.severity}`}><span className="road-field-issue-level">{issueLabels[issue.severity]}</span><span className="road-field-issue-copy">{issue.message}</span></li>)}</ul></details>}
    <details className="road-field-evidence"><summary>数据依据与覆盖范围</summary>
      <label><input type="checkbox" checked={includeEvidence} onChange={event => setIncludeEvidence(event.target.checked)} />关联当前平台数据（{evidence.length} 条，可能含示例）</label>
      <p>默认不使用额外数据。开启后仅做 100 米邻近线索提示，不推断封路、可达或自动绕行。InSAR 为候选点；滑坡图层按要素中心近似，不能代表完整面范围。导入时间不等于采集时间。</p>
      <ul>{report.coverage.map(item => <li key={item}>{item}</li>)}</ul>
      {report.evidence.items.map(item => <article key={item.id}><strong>{item.type} · {Math.round(item.distanceMeters)} 米</strong><p>{item.summary}</p><small>{item.capturedAt ?? "无采集日期"} · {freshnessLabels[item.freshness]}</small></article>)}
      <p>未命中只表示本次已关联数据中没有邻近记录，不能说明没有风险。</p>
    </details>
    <details className="road-field-evidence"><summary>时效、坐标与使用边界</summary><ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul><p>生成于 {new Date(plan.generatedAt).toLocaleString("zh-CN")}；排程使用这次算路耗时，不预测所填出发时段的交通。</p></details>
    <button className="road-field-export" type="button" onClick={exportBrief}><FieldPlanIcon name="download" />下载外业任务单（TXT）</button>
    {exportMessage && <p role="status" className="road-navigation-help">{exportMessage}</p>}
    <div className="road-navigation-usage"><p className="road-navigation-usage-row"><span className="road-navigation-usage-mode">{plan.usage.cached ? "复用缓存" : "实时请求"}</span><span>本次上游 HTTP {plan.usage.upstreamRequests} 次 / 算路子任务 {plan.field?.routePackCount ?? "未知"} 个</span></p><p className="road-navigation-usage-row">{roadOpsUsageLabel(plan.usage)}</p></div>
  </section>;
}
