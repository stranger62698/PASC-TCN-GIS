"use client";
import { useEffect, useMemo, useState } from "react";
import { USER_DATA_LOCAL_ONLY } from "../lib/data-processing-policy";
import {
  buildRoadQualityReport,
  roadQualityReportToCsv,
  roadQualityReportToJson,
  type RoadIssueCategory,
  type RoadIssueSeverity,
  type RoadRiskEvidenceInput,
} from "../lib/roadops-quality";
import type { RoadIssueTypeSafeAssessment } from "../lib/roadops-typesafe";
import {
  ROAD_WORK_ORDER_STATUSES,
  ROAD_WORK_ORDER_STATUS_LABELS,
  makeRoadOpsWorkflowSnapshot,
  parseRoadOpsWorkflowSnapshot,
  roadOpsFieldCandidates,
  roadOpsFieldCandidatesCsv,
  roadOpsReviewCsv,
  roadOpsWorkflowJson,
  roadWorkOrderStatusCounts,
  updateRoadIssueWorkOrder,
  workflowStorageKey,
  type RoadIssueWorkOrder,
  type RoadWorkOrderStatus,
  type RoadWorkOrderUpdate,
} from "../lib/roadops-workflow";
import type { RoadOpsRouteMapPlan } from "../lib/roadops-route";
import type { GisLayer } from "../lib/gis-layer";
import { RoadIssueWorkflowPanel } from "./RoadIssueWorkflowPanel";
import { RoadRoutePlannerPanel, type RoadOpsPlannerMetrics } from "./RoadRoutePlannerPanel";
import { RoadMetricsPanel } from "./RoadMetricsPanel";
import { buildRoadOpsMetrics, createRoadOpsMetricsSession } from "../lib/roadops-metrics";

type Props = {
  layer: GisLayer;
  riskInputs: RoadRiskEvidenceInput[];
  activeFeatureId: string | null;
  onFocusFeature: (featureId: string) => void;
  onRoutePlanChange: (plan: RoadOpsRouteMapPlan | null) => void;
};

const categoryLabels: Record<RoadIssueCategory | "all", string> = { all: "全部", geometry: "几何", topology: "拓扑", attribute: "属性", risk: "风险" };
const severityLabels: Record<RoadIssueSeverity | "all", string> = { all: "全部等级", high: "高", medium: "中", low: "低" };
const queueLabels: Record<RoadIssueTypeSafeAssessment["reviewQueue"], string> = { field_check: "外业核查", map_edit_review: "地图编辑复核", attribute_research: "属性查证", hold: "暂缓" };

const saveText = (name: string, type: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export function RoadQualityPanel({ layer, riskInputs, activeFeatureId, onFocusFeature, onRoutePlanChange }: Props) {
  const report = useMemo(() => buildRoadQualityReport(layer, riskInputs), [layer, riskInputs]);
  const [plannerMetrics, setPlannerMetrics] = useState<RoadOpsPlannerMetrics>(() => ({ route: null, session: createRoadOpsMetricsSession(new Date().toISOString()) }));
  const [category, setCategory] = useState<RoadIssueCategory | "all">("all");
  const [severity, setSeverity] = useState<RoadIssueSeverity | "all">("all");
  const [workflowStatus, setWorkflowStatus] = useState<RoadWorkOrderStatus | "all">("all");
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [reviewMessage, setReviewMessage] = useState("");
  const [assessments, setAssessments] = useState<Record<string, RoadIssueTypeSafeAssessment>>({});
  const storeKey = workflowStorageKey(report.datasetId, report.ruleVersion);
  const [workflowStore, setWorkflowStore] = useState<{ key: string; records: Record<string, RoadIssueWorkOrder>; state: "loading" | "ready" | "session" }>({ key: "", records: {}, state: "loading" });
  useEffect(() => {
    let records: Record<string, RoadIssueWorkOrder> = {}, state: "ready" | "session" = "ready";
    try { records = parseRoadOpsWorkflowSnapshot(window.localStorage.getItem(storeKey), report.datasetId, report.ruleVersion).records; }
    catch { state = "session"; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the versioned browser-local workflow store after mount.
    setWorkflowStore({ key: storeKey, records, state });
  }, [report.datasetId, report.ruleVersion, storeKey]);
  const workflowRecords = workflowStore.key === storeKey ? workflowStore.records : {};
  const workflowCounts = roadWorkOrderStatusCounts(report.issues, workflowRecords);
  const filtered = report.issues.filter(issue => (category === "all" || issue.category === category) && (severity === "all" || issue.severity === severity) && (workflowStatus === "all" || (workflowRecords[issue.id]?.status ?? "pending_review") === workflowStatus));
  const activeIssue = report.issues.find(issue => issue.id === activeIssueId) ?? null;
  const activeAssessment = activeIssue ? assessments[activeIssue.id] : null;
  const activeSegment = activeIssue ? report.segments.find(segment => segment.id === activeIssue.roadSegmentIds[0]) : undefined;
  const activeDefaultEvidenceIds = activeIssue ? activeIssue.evidenceIds.map(id => report.evidences.find(evidence => evidence.id === id)?.sourceId).filter(Boolean) as string[] : [];
  const workflowUpdatedAt = Object.values(workflowRecords).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.updatedAt ?? report.generatedAt;
  const fieldCandidates = roadOpsFieldCandidates(report, workflowRecords);

  const focusIssue = (issueId: string, featureId: string | undefined) => {
    setActiveIssueId(issueId);
    if (featureId) onFocusFeature(featureId);
  };
  const reviewIssue = async () => {
    if (USER_DATA_LOCAL_ONLY) return;
    if (!activeIssue || reviewBusy) return;
    setReviewBusy(activeIssue.id); setReviewMessage("");
    try {
      const segments = report.segments.filter(segment => activeIssue.roadSegmentIds.includes(segment.id));
      const evidences = report.evidences.filter(evidence => activeIssue.evidenceIds.includes(evidence.id));
      const response = await fetch("/api/roadops/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issue: activeIssue, segments, evidences }) });
      const responseText = await response.text();
      let payload: { assessment?: RoadIssueTypeSafeAssessment; error?: { message?: string } };
      try {
        payload = JSON.parse(responseText) as typeof payload;
      } catch {
        throw new Error("本地静态预览未启用 TypeSafe 服务器端点；确定性规则仍可使用。");
      }
      if (!response.ok || !payload.assessment) throw new Error(payload.error?.message || "TypeSafe 语义复核失败");
      setAssessments(current => ({ ...current, [activeIssue.id]: payload.assessment! }));
      setReviewMessage("TypeSafe 已返回概率化建议；规则结果和人工决策未被覆盖。");
    } catch (error) { setReviewMessage(error instanceof Error ? error.message : "TypeSafe 语义复核失败"); }
    finally { setReviewBusy(null); }
  };
  const saveWorkflow = (update: RoadWorkOrderUpdate) => {
    if (!activeIssue) return;
    const now = new Date().toISOString();
    const updated = updateRoadIssueWorkOrder(activeIssue, report.datasetId, workflowRecords[activeIssue.id], update, now);
    const records = { ...workflowRecords, [activeIssue.id]: updated };
    let state: "ready" | "session" = "ready";
    try { window.localStorage.setItem(storeKey, JSON.stringify(makeRoadOpsWorkflowSnapshot(report.datasetId, report.ruleVersion, records, now))); }
    catch { state = "session"; }
    setWorkflowStore({ key: storeKey, records, state });
  };

  return <section className="road-quality-panel" aria-label="RoadOps 道路质量规则">
    <RoadMetricsPanel snapshot={buildRoadOpsMetrics({ report, records: workflowRecords, route: plannerMetrics.route, session: plannerMetrics.session })} />
    <header><div><small>ROADOPS · PHASE 2</small><b>路网模型与质量规则</b></div><span>{report.ruleVersion}</span></header>
    <div className="road-quality-metrics">
      <span><b>{report.counts.normalizedSegments.toLocaleString()}</b><small>标准路段 / 分母</small></span>
      <span><b>{report.counts.nodes.toLocaleString()}</b><small>拓扑节点</small></span>
      <span><b>{report.counts.issues.toLocaleString()}</b><small>规则候选</small></span>
      <span><b>{report.severityCounts.high.toLocaleString()}</b><small>高优先级</small></span>
    </div>
    <p className="road-quality-boundary">{report.counts.ruleHits.toLocaleString()} 次原始规则命中 → {report.counts.issues.toLocaleString()} 张去重候选工单；同一道路对象的同类问题保留全部命中证据，已有审核 ID 不变。</p>
    <div className="road-rule-strip" aria-label="十类规则命中数">{Object.entries(report.ruleCounts).map(([code, count]) => <span key={code}><i>{code}</i><b>{count}</b></span>)}</div>
    <section className="road-workflow-summary" aria-label="Phase 3 工单队列摘要">
      <header><div><small>ROADOPS · PHASE 3</small><b>审核工单队列</b></div><span>{workflowStore.state === "loading" ? "读取中" : workflowStore.state === "ready" ? "浏览器已保存" : "仅当前会话"}</span></header>
      <div>{ROAD_WORK_ORDER_STATUSES.map(status => <button type="button" aria-pressed={workflowStatus === status} onClick={() => setWorkflowStatus(current => current === status ? "all" : status)} key={status}><b>{workflowCounts[status].toLocaleString()}</b><small>{ROAD_WORK_ORDER_STATUS_LABELS[status]}</small></button>)}</div>
      <p>发现 → 审核 → 转外业 → 核查；驳回保留原始候选与完整轨迹。</p>
    </section>
    <div className="road-quality-filters">
      <label>类型<select value={category} onChange={event => setCategory(event.target.value as RoadIssueCategory | "all")}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>等级<select value={severity} onChange={event => setSeverity(event.target.value as RoadIssueSeverity | "all")}>{Object.entries(severityLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>工单<select value={workflowStatus} onChange={event => setWorkflowStatus(event.target.value as RoadWorkOrderStatus | "all")}><option value="all">全部状态</option>{ROAD_WORK_ORDER_STATUSES.map(value => <option value={value} key={value}>{ROAD_WORK_ORDER_STATUS_LABELS[value]}</option>)}</select></label>
      <b>{filtered.length.toLocaleString()} 条</b>
    </div>
    <div className="road-quality-list">{filtered.slice(0, 60).map(issue => <button type="button" className={`${issue.id === activeIssueId ? "is-active" : ""} severity-${issue.severity}`} aria-pressed={issue.id === activeIssueId} onClick={() => focusIssue(issue.id, issue.featureIds[0])} key={issue.id}>
      <span><i>{issue.ruleCode}</i><em>{categoryLabels[issue.category]} · {severityLabels[issue.severity]}</em>{assessments[issue.id] && <strong>TypeSafe</strong>}<u>{ROAD_WORK_ORDER_STATUS_LABELS[workflowRecords[issue.id]?.status ?? "pending_review"]}</u></span>
      <b>{issue.title}</b><small>{issue.description}</small>
      {issue.featureIds[0] === activeFeatureId && <mark>地图已高亮</mark>}
    </button>)}</div>
    {filtered.length > 60 && <p className="road-quality-limit">当前展示前 60 条；导出包含筛选前的完整确定性结果。</p>}
    {activeIssue && <article className="road-issue-detail">
      <small>{activeIssue.ruleCode} · {activeIssue.ruleVersion}</small><b>{activeIssue.title}</b>
      <p>{activeIssue.suggestion}</p>
      <span>对象：{activeIssue.roadSegmentIds.join("、") || activeIssue.featureIds.join("、")}</span>
      {USER_DATA_LOCAL_ONLY ? <p className="road-typesafe-message">当前使用本机规则质检，不发送在线语义复核请求。</p> : <button type="button" disabled={reviewBusy === activeIssue.id} onClick={() => void reviewIssue()}>{reviewBusy === activeIssue.id ? "TypeSafe 判断中…" : "TypeSafe 语义复核（可选）"}</button>}
      {activeAssessment && <div className="road-typesafe-result"><small>Typed judgment · 不覆盖规则</small><b>{queueLabels[activeAssessment.reviewQueue]} · {(activeAssessment.reviewQueueConfidence * 100).toFixed(0)}%</b><span>外业必要性 {activeAssessment.fieldCheckNeed.toFixed(1)} / 4</span><span>语义歧义概率 {(activeAssessment.semanticAmbiguityProbability * 100).toFixed(0)}%</span></div>}
      {reviewMessage && <p className="road-typesafe-message" role="status">{reviewMessage}</p>}
    </article>}
    {activeIssue && <RoadIssueWorkflowPanel key={`${activeIssue.id}:${workflowRecords[activeIssue.id]?.updatedAt ?? "new"}`} issue={activeIssue} datasetId={report.datasetId} segment={activeSegment} evidenceInputs={riskInputs} defaultEvidenceIds={activeDefaultEvidenceIds} record={workflowRecords[activeIssue.id]} onSave={saveWorkflow} />}
    <div className="road-quality-export"><button type="button" onClick={() => saveText("roadops-phase2-quality.json", "application/json;charset=utf-8", roadQualityReportToJson(report))}>导出 JSON</button><button type="button" onClick={() => saveText("roadops-phase2-issues.csv", "text/csv;charset=utf-8", roadQualityReportToCsv(report))}>导出 CSV</button></div>
    <div className="road-workflow-export"><button type="button" onClick={() => saveText("roadops-phase3-review.json", "application/json;charset=utf-8", roadOpsWorkflowJson(report, workflowRecords, workflowUpdatedAt))}>审核快照 JSON</button><button type="button" onClick={() => saveText("roadops-phase3-review.csv", "text/csv;charset=utf-8", roadOpsReviewCsv(report, workflowRecords))}>审核清单 CSV</button><button type="button" disabled={!workflowCounts.field_required && !workflowCounts.verified} onClick={() => saveText("roadops-phase4-field-candidates.csv", "text/csv;charset=utf-8", roadOpsFieldCandidatesCsv(report, workflowRecords))}>外业候选 CSV</button></div>
    <RoadRoutePlannerPanel phase3Candidates={fieldCandidates} onPlanChange={onRoutePlanChange} onMetricsChange={setPlannerMetrics} />
    <p className="road-quality-boundary">规则候选用于数据生产复核；OSM 为开源基线，TypeSafe 为可选语义判断，均不构成导航或道路安全结论。</p>
  </section>;
}
