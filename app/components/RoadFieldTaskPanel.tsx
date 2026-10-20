"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { parseRoadOpsDrivingPlan, roadOpsDrivingError, roadOpsUsageLabel, type RoadOpsDrivingPlan } from "../lib/roadops-driving";
import { createNavigationDraft } from "../lib/roadops-navigation";
import { confirmFieldTaskArrivalSelection, fieldTaskInspectionIssues, parseFieldTaskPlan, type FieldTaskPlan, type InspectionTask } from "../lib/roadops-task-plan";
import { addFieldTaskToVisit, addFieldTaskVisit, removeFieldTask, setFieldTaskTargetCoordinate, setFieldTaskTripMode, setFieldVehicleStopCoordinate, shareFieldTaskVisit, splitFieldTask } from "../lib/roadops-task-editor";
import { bindFieldTaskRoute, compileFieldTaskRouting, type FieldTaskRouteReceipt } from "../lib/roadops-task-routing";
import { buildFieldTaskReport, type FieldTaskReport } from "../lib/roadops-task-report";
import { RoadTaskDraftPanel } from "./RoadTaskDraftPanel";
import { RoadAccessCheckPanel, fieldAccessPlanningGate, useFieldAccessHistory } from "./RoadAccessCheckPanel";
import { useRoadOpsStrategyComparison } from "../lib/use-roadops-strategy-comparison";
import { RoadStrategySummary } from "./RoadStrategySummary";
import { buildLoginContinuationHref } from "../lib/local-analysis-session";
import { getSession } from "../lib/auth-client";
import { fieldAccessTaskExclusions } from "../lib/roadops-access-check";
import { candidateBaseKey, createFieldTaskCandidate, validateFieldTaskCandidate, type FieldTaskCandidate } from "../lib/roadops-task-candidates";
import { fieldPlanningGoalLabel, type FieldPlanningGoal } from "../lib/roadops-planning-goals";
import { RoadPlanningGoalSelect } from "./RoadPlanningGoalSelect";
import { RoadPersonalizedCandidates } from "./RoadPersonalizedCandidates";
import { RoadFieldExecutionPanel, type FieldEvidenceOption } from "./RoadFieldExecutionPanel";

export type FieldTaskResult = { receipt: FieldTaskRouteReceipt; providerPlan: RoadOpsDrivingPlan };
type Props = {
  plan: FieldTaskPlan; stored: boolean; onChange: (plan: FieldTaskPlan) => void;
  onSaved: (plan: FieldTaskPlan) => void; onRestore: (plan: FieldTaskPlan, saved?: boolean) => void;
  pickId: string | null; onPick: (id: string | null) => void;
  result: FieldTaskResult | null; onResult: (result: FieldTaskResult | null) => void;
  onBusy: (busy: boolean) => void; activeLegId: string | null;
  onFocusLeg: (id: string | null) => void; onFocusPoint: (coordinate: [number, number]) => void;
  currentDatasetId?: string | null; currentAnalysisId?: string | null;
  onAdopt?: (plan: FieldTaskPlan, result: FieldTaskResult | null) => void;
  evidenceOptions?: FieldEvidenceOption[];
};
const newId = (kind: string) => `${kind}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const coordinateText = (value: [number, number] | null) => value ? value.map(number => number.toFixed(6)).join(", ") : "尚未选择";
const minutes = (value: number) => `${Number(value.toFixed(1))} 分钟`;
const meters = (value: number | null) => value === null ? "无对应道路端点" : `${Math.round(value)} 米`;
const labelOf = (plan: FieldTaskPlan, index: number) => index === 0 ? "出发地" : index === plan.visits.length - 1 ? plan.tripMode === "return_to_start" ? "返回出发地" : "结束停靠" : `停靠 ${index}`;

function CoordinateInput({ id, label, coordinate, onApply }: { id: string; label: string; coordinate: [number, number] | null; onApply: (value: [number, number]) => void }) {
  const [longitude, setLongitude] = useState(coordinate?.[0].toFixed(6) ?? ""), [latitude, setLatitude] = useState(coordinate?.[1].toFixed(6) ?? "");
  const [error, setError] = useState("");
  function apply(event: FormEvent) {
    event.preventDefault();
    const lng = Number(longitude), lat = Number(latitude);
    if (!longitude.trim() || !latitude.trim() || !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) { setError("请输入有效的 WGS84 经度、纬度。"); return; }
    setError(""); onApply([lng, lat]);
  }
  return <details className="road-navigation-coordinate-editor"><summary>输入精确坐标</summary><form onSubmit={apply}><p>仅接受 WGS84；经度在前，纬度在后。</p><div className="road-navigation-coordinate-fields">
    <label htmlFor={`${id}-lng`}>经度<input id={`${id}-lng`} aria-label={`${label}经度`} type="number" step="any" value={longitude} onChange={event => setLongitude(event.target.value)} required /></label>
    <label htmlFor={`${id}-lat`}>纬度<input id={`${id}-lat`} aria-label={`${label}纬度`} type="number" step="any" value={latitude} onChange={event => setLatitude(event.target.value)} required /></label>
  </div>{error && <p role="alert">{error}</p>}<button type="submit">应用坐标</button></form></details>;
}

function TaskReport({ report, plan, activeLegId, onFocusLeg, onFocusPoint }: { report: FieldTaskReport; plan: FieldTaskPlan; activeLegId: string | null; onFocusLeg: Props["onFocusLeg"]; onFocusPoint: Props["onFocusPoint"] }) {
  const labels = new Map(report.visits.map((visit, index) => [visit.visitId, visit.role === "origin" ? "出发地" : visit.role === "destination" ? plan.tripMode === "return_to_start" ? "返回出发地" : "结束停靠" : `停靠 ${index}`]));
  const issueGroups = new Map<string, FieldTaskReport["issues"]>();
  report.issues.forEach(issue => issueGroups.set(issue.code, [...(issueGroups.get(issue.code) ?? []), issue]));
  return <section className="road-field-plan" aria-label="逐站外业行程报告">
    <div className="road-field-heading"><h4>逐站行程</h4><span className="road-task-report-state">{report.status === "blocked" ? "需调整工时" : "待现场核验"}</span></div>
    <div className="road-task-report-metrics"><div><small>驾车里程</small><strong>{(report.totals.distanceMeters / 1000).toFixed(3)} km</strong></div><div><small>驾车耗时</small><strong>{minutes(report.totals.drivingMinutes)}</strong></div><div><small>任务停留</small><strong>{minutes(report.totals.dwellMinutes)}</strong></div><div><small>含缓冲总计</small><strong>{minutes(report.totals.totalMinutes)}</strong></div></div>
    <p className="road-navigation-help">预计结束 {report.totals.finishTime} · {report.totals.overtimeMinutes > 0 ? `超出工时 ${minutes(report.totals.overtimeMinutes)}` : `可用工时 ${minutes(report.totals.workMinutes)}`}。停车后转移时间待核实。</p>
    <details open className="road-task-report-visits"><summary>逐站安排 · {report.visits.length} 次到访 / 执行 {report.selectedTaskIds.length} 项任务</summary>
      {report.visits.map(visit => <article key={visit.visitId} className="road-task-report-visit"><div className="road-task-report-visit-title"><strong>{visit.visitIndex + 1}. {labels.get(visit.visitId)}</strong><button type="button" onClick={() => onFocusPoint(visit.coordinate)}>查看车辆位置</button></div><p>{visit.arrivalTime} 到达 → {visit.departureTime} 离开 · 停留 {minutes(visit.dwellMinutes)}</p>
        {visit.tasks.length ? <ol>{visit.tasks.map(task => <li key={task.taskId}><strong>{task.name}</strong><span>{task.startTime}–{task.endTime} · {minutes(task.dwellMinutes)}</span><button type="button" onClick={() => onFocusPoint(task.targetCoordinate)}>查看核查目标</button>{task.targetGapMeters > 0 && <small>距停车点直线 {meters(task.targetGapMeters)} · 转移待核验</small>}</li>)}</ol> : <p className="road-navigation-help">无核查任务。</p>}
        <details><summary>道路端点证据</summary><p>到达偏移：{meters(visit.roadEvidence.arrivalOffsetMeters)} · 离开偏移：{meters(visit.roadEvidence.departureOffsetMeters)}</p><p>到达 / 离开端点间距：{meters(visit.roadEvidence.arrivalDepartureGapMeters)}</p></details>
      </article>)}
    </details>
    {report.deferredTasks.length > 0 && <details open className="road-task-report-deferred"><summary>本次延期 · {report.deferredTasks.length} 项</summary><ul>{report.deferredTasks.map(task => <li key={task.taskId}><strong>{plan.tasks.find(value => value.taskId === task.taskId)?.name ?? task.taskId}</strong><p>{task.reason === "time_budget" ? "工时不足" : task.reason === "unreachable" ? "道路不可达" : task.reason === "access_blocked" ? "现场进入受阻" : "输入待补全"}：{task.detail}</p></li>)}</ul></details>}
    {report.legs.length > 0 && <details className="road-task-report-legs"><summary>滴图驾车分段 · {report.legs.length} 段</summary>{report.legs.map(leg => <button type="button" className={activeLegId === leg.id ? "is-active" : ""} key={leg.id} onClick={() => onFocusLeg(activeLegId === leg.id ? null : leg.id)}><span>{labels.get(leg.fromVisitId)} → {labels.get(leg.toVisitId)}</span><small>{leg.departureTime}–{leg.arrivalTime} · {(leg.distanceMeters / 1000).toFixed(1)} km · {minutes(leg.drivingMinutes)}</small></button>)}</details>}
    <details className="road-task-report-issues"><summary>出发前复核 · {report.issues.length} 项</summary><ul>{Array.from(issueGroups, ([code, issues]) => <li key={code}><p>{issues[0].message}</p>{issues.some(issue => issue.visitId) && <small>涉及：{issues.map(issue => [issue.visitId && labels.get(issue.visitId), issue.taskId && plan.tasks.find(task => task.taskId === issue.taskId)?.name].filter(Boolean).join(" / ")).filter(Boolean).join("、")}</small>}</li>)}</ul></details>
    <details><summary>数据与使用边界</summary><ul>{report.limitations.map(item => <li key={item}>{item}</li>)}</ul><p>道路时距、几何和本报告仅在当前页面内存中使用，不进入草稿、JSON 备份或账号云端。</p></details>
  </section>;
}

/** Canonical user task editor; the supplier request is an explicit, separate action. */
export function RoadFieldTaskPanel({ plan, stored, onChange, onSaved, onRestore: restoreTaskPlan, pickId, onPick, result, onResult, onBusy, activeLegId, onFocusLeg, onFocusPoint, currentDatasetId, currentAnalysisId, onAdopt, evidenceOptions = [] }: Props) {
  const goal: FieldPlanningGoal = plan.planningGoal ?? (plan.strategy === "5" ? "distance" : "time");
  const selectionGoal = goal === "coverage" || goal === "priority";
  const [candidates, setCandidates] = useState<FieldTaskCandidate[]>([]), [activeCandidateId, setActiveCandidateId] = useState<string | null>(null);
  const candidateScope = useMemo(() => JSON.stringify([candidateBaseKey(plan), currentDatasetId, currentAnalysisId]), [plan, currentDatasetId, currentAnalysisId]);
  const candidateScopeRef = useRef(candidateScope);
  const analysisContext = useMemo(() => ({ currentDatasetId, currentAnalysisId }), [currentDatasetId, currentAnalysisId]);
  const inspectionIssues = useMemo(() => fieldTaskInspectionIssues(plan, analysisContext), [plan, analysisContext]);
  const blockingInspectionIssues = useMemo(() => inspectionIssues.filter(issue => issue.kind === "stale" || !selectionGoal || plan.tasks.some(task => task.taskId === issue.taskId && task.required)), [inspectionIssues, plan, selectionGoal]);
  const requestSignature = useMemo(() => JSON.stringify([plan, analysisContext]), [plan, analysisContext]);
  const canConfirmArrivals = useMemo(() => {
    if (inspectionIssues.some(issue => issue.kind === "stale")) return false;
    const stops = new Map(plan.stops.map(stop => [stop.stopId, stop]));
    return plan.tasks.every(task => plan.visits.some(visit => visit.taskIds.includes(task.taskId) && !!stops.get(visit.stopId)?.coordinate));
  }, [plan, inspectionIssues]);
  // Saving only bumps metadata. It must not erase a just-generated strategy baseline.
  const comparisonScope = useMemo(() => JSON.stringify([{ ...plan, planningGoal: undefined, strategy: undefined, revision: undefined, updatedAt: undefined, name: undefined }, analysisContext]), [plan, analysisContext]);
  const strategyComparison = useRoadOpsStrategyComparison(comparisonScope);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [failed, setFailed] = useState(false), [localReport, setLocalReport] = useState(false);
  const [loginHref, setLoginHref] = useState("");
  const [assessedAt, setAssessedAt] = useState(() => new Date().toISOString());
  const access = useFieldAccessHistory(plan.planId);
  const [accessFormDirty, setAccessFormDirty] = useState(false);
  const [draftIoBusy, setDraftIoBusy] = useState(false);
  const requiredScope = useMemo(() => selectionGoal ? {
    selectedTaskIds: plan.tasks.filter(task => task.required).map(task => task.taskId),
    selectedVisitIds: plan.visits.filter(visit => visit.role !== "candidate" || !visit.taskIds.length || visit.taskIds.some(id => plan.tasks.some(task => task.taskId === id && task.required))).map(visit => visit.visitId),
  } : {}, [plan, selectionGoal]);
  const accessGate = useMemo(() => fieldAccessPlanningGate(plan, access.state, { assessedAt, ...requiredScope }), [plan, access.state, assessedAt, requiredScope]);
  const pickCallback = useRef(onPick);
  useLayoutEffect(() => { pickCallback.current = onPick; }, [onPick]);
  const accessDirtyChanged = useCallback((dirty: boolean) => { setAccessFormDirty(dirty); if (dirty) pickCallback.current(null); }, []);
  const legacyDraft = useMemo(() => createNavigationDraft(), []);
  const mounted = useRef(false), latestPlan = useRef(plan), latestContext = useRef(analysisContext), latestSignature = useRef(requestSignature), busyCallback = useRef(onBusy);
  const requestRef = useRef<{ controller: AbortController; signature: string } | null>(null);
  useLayoutEffect(() => {
    latestPlan.current = plan; latestContext.current = analysisContext; latestSignature.current = requestSignature;
    if (requestRef.current && requestRef.current.signature !== requestSignature) requestRef.current.controller.abort();
  }, [plan, analysisContext, requestSignature]);
  useEffect(() => {
    if (candidateScopeRef.current !== candidateScope) { candidateScopeRef.current = candidateScope; setCandidates([]); setActiveCandidateId(null); }
  }, [candidateScope]);
  useEffect(() => { busyCallback.current = onBusy; }, [onBusy]);
  useEffect(() => { mounted.current = true; const timer = window.setInterval(() => setAssessedAt(new Date().toISOString()), 60_000); return () => { mounted.current = false; requestRef.current?.controller.abort(); busyCallback.current(false); window.clearInterval(timer); }; }, []);
  useEffect(() => {
    if (result && inspectionIssues.some(issue => issue.kind === "stale")) { strategyComparison.clear(); onResult(null); }
  }, [result, inspectionIssues, strategyComparison, onResult]);
  useEffect(() => {
    if (!loginHref) return;
    let cancelled = false;
    const refresh = () => { void getSession().then(user => {
      if (!cancelled && user) { setLoginHref(""); setFailed(false); setMessage("登录会话已恢复，任务已保留；请点击规划外业行程重试。"); }
    }).catch(() => null); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [loginHref]);
  const report = useMemo(() => {
    if (blockingInspectionIssues.length || (!result && !localReport)) return null;
    try { return buildFieldTaskReport(plan, result?.receipt ?? null, { assessedAt, inputExclusions: candidates.find(candidate => candidate.candidateId === activeCandidateId)?.inputExclusions }); } catch { return null; }
  }, [plan, result, localReport, assessedAt, blockingInspectionIssues, candidates, activeCandidateId]);
  const reportGate = useMemo(() => report ? fieldAccessPlanningGate(plan, access.state, { assessedAt, selectedTaskIds: report.selectedTaskIds, selectedVisitIds: report.visits.map(visit => visit.visitId) }) : accessGate, [plan, access.state, assessedAt, report, accessGate]);
  const activeCandidate = candidates.find(candidate => candidate.candidateId === activeCandidateId) ?? null;

  function applyCandidate(candidate: FieldTaskCandidate) {
    const snapshot = parseFieldTaskPlan(candidate.plan);
    const nextResult = candidate.receipt && candidate.providerPlan ? { receipt: candidate.receipt, providerPlan: candidate.providerPlan } : null;
    latestPlan.current = snapshot; setActiveCandidateId(candidate.candidateId); setLocalReport(!candidate.receipt); onPick(null);
    if (onAdopt) onAdopt(snapshot, nextResult); else { onChange(snapshot); onResult(nextResult); }
  }
  function retainCandidate(candidate: FieldTaskCandidate) {
    setCandidates(current => [...current.filter(value => value.objective !== candidate.objective), candidate].slice(-4));
    if (candidate.report.status === "blocked" || candidate.providerPlan?.status === "infeasible") { setActiveCandidateId(null); setFailed(true); setMessage("本次条件下没有可按时完成的方案，请调整工时、停留或必查设置。"); return false; }
    applyCandidate(candidate);
    return true;
  }
  async function adoptCandidate(candidateId: string) {
    if (busy || accessFormDirty || access.state.saving || draftIoBusy) return;
    const candidate = candidates.find(value => value.candidateId === candidateId);
    if (!candidate) return;
    const signature = requestSignature;
    setBusy(true); onBusy(true); setFailed(false);
    try {
      const validated = validateFieldTaskCandidate(plan, candidate, { assessedAt: new Date().toISOString() });
      if (validated.report.status === "blocked" || validated.providerPlan?.status === "infeasible") throw new Error("此方案不能在工时内完成，未采用。");
      const fresh = await access.reload();
      if (!mounted.current || latestSignature.current !== signature) throw new Error("输入已变化，请重新生成方案。");
      const gate = fieldAccessPlanningGate(validated.plan, fresh, { assessedAt: new Date().toISOString(), selectedTaskIds: validated.report.selectedTaskIds, selectedVisitIds: validated.report.visits.map(visit => visit.visitId) });
      if (!gate.canPlan) throw new Error(gate.reason);
      applyCandidate(validated); setMessage(`已采用「${fieldPlanningGoalLabel(validated.objective)}」，地图与逐站安排已同步。`);
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "方案未采用。"); }
    finally { if (mounted.current) { setBusy(false); onBusy(false); } }
  }

  function edit(action: () => FieldTaskPlan) {
    if (busy || access.state.saving || accessFormDirty) return false;
    try { const next = action(); latestPlan.current = next; setMessage(""); setFailed(false); setLocalReport(false); setActiveCandidateId(null); onPick(null); onChange(next); return true; }
    catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "任务编辑未完成，原输入已保留。"); return false; }
  }
  function patchTask(taskId: string, patch: Partial<InspectionTask>) { edit(() => parseFieldTaskPlan({ ...plan, tasks: plan.tasks.map(task => task.taskId === taskId ? { ...task, ...patch } : task) })); }
  function newTask(): InspectionTask { return { taskId: newId("task"), name: `核查任务 ${plan.tasks.length + 1}`, targetCoordinate: null, dwellMinutes: 20, required: true, legacyAccessReview: "unknown", accessNote: "" }; }
  function addVisit() { const task = newTask(); if (edit(() => addFieldTaskVisit(plan, { task, visitId: newId("visit"), stopId: newId("stop") }))) onPick(`task:${task.taskId}`); }
  function addAtVisit(visitId: string) { const task = newTask(); if (edit(() => addFieldTaskToVisit(plan, task, visitId))) onPick(`task:${task.taskId}`); }
  function reorderVisit(index: number, direction: -1 | 1) { edit(() => { const visits = [...plan.visits]; [visits[index], visits[index + direction]] = [visits[index + direction], visits[index]]; return parseFieldTaskPlan({ ...plan, visits }); }); }
  function reorderTask(visitId: string, index: number, direction: -1 | 1) { edit(() => parseFieldTaskPlan({ ...plan, visits: plan.visits.map(visit => { if (visit.visitId !== visitId) return visit; const taskIds = [...visit.taskIds]; [taskIds[index], taskIds[index + direction]] = [taskIds[index + direction], taskIds[index]]; return { ...visit, taskIds }; }) })); }
  function onRestore(next: FieldTaskPlan, saved?: boolean) { strategyComparison.clear(); setCandidates([]); setActiveCandidateId(null); setLocalReport(false); restoreTaskPlan(next, saved); }
  async function generateRoute() {
    if (requestRef.current || busy || accessFormDirty || draftIoBusy || !accessGate.canPlan || blockingInspectionIssues.length) return;
    const controller = new AbortController(), pending = { controller, signature: requestSignature };
    requestRef.current = pending; strategyComparison.begin(); setBusy(true); onBusy(true); onPick(null); onResult(null); setActiveCandidateId(null); setLocalReport(false); setFailed(false); setLoginHref("");
    setMessage("正在检查已保存的通行限制…");
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const freshAccess = await access.reload();
      const snapshot = parseFieldTaskPlan({ ...latestPlan.current, planningGoal: goal });
      const preflight = fieldAccessPlanningGate(snapshot, freshAccess, { assessedAt: new Date().toISOString(), ...requiredScope });
      if (!preflight.canPlan) throw new Error(preflight.reason);
      if (!mounted.current || controller.signal.aborted || requestRef.current !== pending) throw new Error("已取消等待。");
      const fullGate = fieldAccessPlanningGate(snapshot, freshAccess, { assessedAt: new Date().toISOString() });
      const excludedTaskReasons = selectionGoal && fullGate.evaluation ? fieldAccessTaskExclusions(snapshot, fullGate.evaluation) : {};
      const issued = compileFieldTaskRouting(snapshot, latestContext.current, { excludedTaskReasons });
      pending.signature = JSON.stringify([latestPlan.current, latestContext.current]); setAssessedAt(new Date().toISOString());
      if (!issued.request) {
        const candidate = createFieldTaskCandidate(snapshot, { candidateId: newId("candidate"), generatedAt: new Date().toISOString(), assessedAt: new Date().toISOString(), receipt: null, inputExclusions: issued.inputExclusions });
        const gate = fieldAccessPlanningGate(snapshot, freshAccess, { assessedAt: new Date().toISOString(), selectedTaskIds: candidate.report.selectedTaskIds, selectedVisitIds: candidate.report.visits.map(visit => visit.visitId) });
        if (!gate.canPlan) throw new Error(gate.reason);
        strategyComparison.clear(); if (retainCandidate(candidate)) setMessage("同站行程已生成，无需站间驾车；现场通行待核验。"); return;
      }
      setMessage("正在获取驾车路线…");
      const response = await fetch("/api/roadops/driving", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(issued.request), signal: controller.signal, credentials: "same-origin", cache: "no-store" });
      const raw: unknown = await response.json().catch(() => null);
      if (!mounted.current || controller.signal.aborted || requestRef.current !== pending || pending.signature !== latestSignature.current) return;
      if (response.status === 401) {
        setLoginHref(buildLoginContinuationHref(`${window.location.pathname}${window.location.search}${window.location.hash}`, window.location.origin));
        throw new Error("需要登录后才能使用驾车路线服务。请在新标签页登录，回到此页手动重试；当前分析和任务保留。");
      }
      if (!response.ok) throw new Error(roadOpsDrivingError(raw, `路线服务暂不可用（HTTP ${response.status}），任务保留，请检查后手动重试。`));
      if (!mounted.current || controller.signal.aborted || requestRef.current !== pending) return;
      const responseAccess = await access.reload();
      const receipt = bindFieldTaskRoute(snapshot, raw, issued);
      const responseGate = fieldAccessPlanningGate(snapshot, responseAccess, { assessedAt: new Date().toISOString(), selectedTaskIds: receipt.selectedTaskIds, selectedVisitIds: receipt.visits.map(visit => visit.visitId) });
      if (!responseGate.canPlan) throw new Error(`路线响应未采纳：${responseGate.reason} 已发出的请求可能已计入用量。`);
      if (!mounted.current || controller.signal.aborted || requestRef.current !== pending) return;
      if (pending.signature !== latestSignature.current || fieldTaskInspectionIssues(latestPlan.current, latestContext.current).some(issue => issue.kind === "stale")) return;
      const providerPlan = parseRoadOpsDrivingPlan((raw as { plan: unknown }).plan);
      strategyComparison.accept(issued.request, providerPlan);
      if (retainCandidate(createFieldTaskCandidate(snapshot, { candidateId: newId("candidate"), generatedAt: receipt.generatedAt, assessedAt: new Date().toISOString(), receipt, providerPlan }))) setMessage(providerPlan.usage.cached ? "行程已更新，复用已有道路路线。" : "行程已生成，请查看逐站安排。");
    } catch (error) {
      if (!mounted.current || requestRef.current !== pending) return;
      strategyComparison.clear();
      setFailed(true); setMessage(controller.signal.aborted ? timedOut ? "等待超时；不会自动重试。已发出的请求可能已计入用量。" : "已取消等待，输入保留；已发出的请求可能已计入用量。" : error instanceof Error ? error.message : "规划失败；未绘制连点线或沿用旧结果。");
    } finally { window.clearTimeout(timer); if (requestRef.current === pending) { requestRef.current = null; if (mounted.current) { setBusy(false); onBusy(false); } } }
  }

  const actionHint = accessFormDirty ? "有未保存核验，请展开「通行与入口核验」保存或重置。"
    : draftIoBusy ? "正在处理草稿，请稍候。"
    : access.state.saving ? "正在保存核验，请稍候。"
    : blockingInspectionIssues[0]?.message ?? (!accessGate.canPlan ? accessGate.reason : "");

  return <section className="road-navigation road-field-task-editor" aria-label="小客车外业任务规划">
    <header className="road-navigation-heading"><p className="road-navigation-eyebrow">驾车路线与外业任务</p><h3>小客车外业行程</h3><p>按停车点安排核查任务，支持返程与共站任务。</p></header>
    <RoadTaskDraftPanel draft={legacyDraft} taskPlan={plan} initialSavedPlan={stored ? plan : undefined} disabled={busy || access.state.saving || accessFormDirty} onRestore={() => { /* Advanced drafts always use the full model callback. */ }} onRestoreTaskPlan={onRestore} onTaskPlanSaved={onSaved} onStorageBusy={setDraftIoBusy} />
    {accessFormDirty && <p className="road-navigation-help">核验未保存，请先保存或重置，再编辑行程。</p>}
    <RoadAccessCheckPanel key={plan.planId} plan={plan} state={access.state} stored={stored} disabled={busy || draftIoBusy} assessedAt={assessedAt} onAppend={access.append} onReload={access.reload} onDirty={accessDirtyChanged} />
    <RoadPlanningGoalSelect goal={goal} disabled={busy || draftIoBusy || access.state.saving || accessFormDirty} onChange={planningGoal => edit(() => parseFieldTaskPlan({ ...plan, planningGoal, strategy: planningGoal === "time" ? "2" : planningGoal === "distance" ? "5" : plan.strategy }))} />
    <RoadPersonalizedCandidates candidates={candidates.map(candidate => ({ candidateId: candidate.candidateId, goal: candidate.objective, active: candidate.candidateId === activeCandidateId,
      distanceMeters: candidate.report.totals.distanceMeters, totalMinutes: candidate.report.totals.totalMinutes, finishTime: candidate.report.totals.finishTime, workMinutes: candidate.report.totals.workMinutes,
      selectedCount: candidate.report.selectedTaskIds.length, requiredCount: candidate.plan.tasks.filter(task => task.required).length, deferredCount: candidate.report.deferredTasks.length,
      sequence: JSON.stringify([candidate.report.visits.map(visit => visit.visitId), [...candidate.report.selectedTaskIds].sort(), candidate.providerPlan?.map.features.map(feature => feature.geometry.coordinates) ?? []]),
      strategy: `${candidate.plan.optimize ? "允许重排" : "固定顺序"} · ${{ "1": "默认道路", "2": "时间优先道路", "5": "距离优先道路", "11": "高速优先", "13": "不走高速" }[candidate.plan.strategy]}` }))}
      disabled={busy || draftIoBusy || access.state.saving || accessFormDirty || blockingInspectionIssues.length > 0} onAdopt={id => void adoptCandidate(id)} />
    {report && !reportGate.canPlan && <p className="road-navigation-message is-error" role="alert">当前报告不可作为出发行程：{reportGate.reason}</p>}
    {report && result && <RoadStrategySummary plan={result.providerPlan} comparison={strategyComparison.comparison} />}
    {report && <TaskReport report={report} plan={plan} activeLegId={activeLegId} onFocusLeg={onFocusLeg} onFocusPoint={onFocusPoint} />}
    <RoadFieldExecutionPanel planId={plan.planId} candidate={report && reportGate.canPlan ? activeCandidate : null} disabled={busy || draftIoBusy || accessFormDirty || access.state.saving} evidenceOptions={evidenceOptions} taskNames={Object.fromEntries(plan.tasks.map(task => [task.taskId, task.name]))} />
    <details className="road-navigation-edit" open={!report}><summary>{report ? "编辑行程与核查任务" : "设置行程与核查任务"}</summary><fieldset className="road-navigation-form" disabled={busy || access.state.saving || accessFormDirty}><legend className="road-navigation-sr-only">外业任务设置</legend>
      <div className="road-task-trip-modes" role="group" aria-label="行程方式"><button type="button" aria-pressed={plan.tripMode === "one_way"} onClick={() => edit(() => setFieldTaskTripMode(plan, "one_way"))}>单程行程</button><button type="button" aria-pressed={plan.tripMode === "return_to_start"} onClick={() => edit(() => setFieldTaskTripMode(plan, "return_to_start"))}>返回出发地</button></div>
      <details className="road-navigation-help"><summary>返程如何安排</summary><p>开启返程会保留原终点任务为中途停靠，再追加返回到访；不会删除任务。</p></details>
      {plan.tasks.some(task => task.inspectionSource) && <div className="road-navigation-arrival">
        {inspectionIssues.map(issue => <p key={issue.taskId} role="status">{issue.message}</p>)}
        <button type="button" disabled={!canConfirmArrivals} onClick={() => edit(() => confirmFieldTaskArrivalSelection(plan, analysisContext))}>确认当前车辆停靠位置用于算路（入口待核验）</button>
        <p>确认算路位置后，仍需核验停车和现场进入条件。</p>
      </div>}
      <div className="road-navigation-points">{plan.visits.map((visit, index) => {
        const stop = plan.stops.find(value => value.stopId === visit.stopId)!;
        const label = labelOf(plan, index), firstTask = plan.tasks.find(task => task.taskId === visit.taskIds[0]);
        const mainPick = !stop.usesVehicleCoordinate && visit.taskIds.length === 1 ? `task:${firstTask!.taskId}` : `stop:${stop.stopId}`;
        return <article key={visit.visitId} className={`road-navigation-point road-navigation-point-${visit.role}${pickId === mainPick ? " is-picking" : ""}`}>
          <div className="road-navigation-point-heading"><span className="road-navigation-point-marker" aria-hidden="true">{index === 0 ? "起" : visit.role === "destination" ? plan.tripMode === "return_to_start" ? "返" : "终" : index}</span><strong>{label}</strong><span className="road-navigation-required">{visit.taskIds.length} 项任务</span></div>
          <button type="button" className="road-navigation-pick" aria-pressed={pickId === mainPick} onClick={() => onPick(pickId === mainPick ? null : mainPick)}><span className="road-navigation-pick-copy"><span>{pickId === mainPick ? "请在地图上选择位置" : stop.usesVehicleCoordinate || !firstTask ? "选择车辆停靠位置" : "选择目标及车辆到达位置"}</span><small>{coordinateText(stop.coordinate)}</small></span></button>
          <CoordinateInput key={`${stop.stopId}:${coordinateText(stop.coordinate)}`} id={`vehicle-${visit.visitId}`} label={`${label}车辆位置`} coordinate={stop.coordinate} onApply={coordinate => edit(() => setFieldVehicleStopCoordinate(plan, stop.stopId, coordinate))} />
          {visit.role === "candidate" && <div className="road-navigation-reorder"><button type="button" disabled={index <= 1 || plan.optimize} onClick={() => reorderVisit(index, -1)}>上移停靠</button><button type="button" disabled={index >= plan.visits.length - 2 || plan.optimize} onClick={() => reorderVisit(index, 1)}>下移停靠</button></div>}
          <div className="road-task-stop-tasks">{visit.taskIds.map((taskId, taskIndex) => {
            const task = plan.tasks.find(value => value.taskId === taskId)!;
            return <details key={taskId} className="road-field-point-settings" open={visit.taskIds.length === 1}><summary>{taskIndex + 1}. {task.name} · {minutes(task.dwellMinutes)}</summary>
              {task.inspectionSource && <details className="road-field-task-source"><summary>分析来源 · {task.inspectionSource.datasetTitle}</summary>
                <p>真实点 {task.inspectionSource.representativePointId} · 观测日期 {task.inspectionSource.observationDate}</p>
                <p>规则：{task.inspectionSource.ruleSummary}</p><small>分析编号：{task.inspectionSource.analysisId}</small>
                <p>算路位置选择：{task.inspectionSource.arrivalSelection === "custom" ? "独立车辆停靠" : task.inspectionSource.arrivalSelection === "target" ? "目标位置" : "未确认"}；入口仍待核验。</p>
                {task.inspectionSource.targetAdjusted && <p>目标位置已人工调整，来源仍指向原始分析点。</p>}
              </details>}
              <label>任务名称<input aria-label={`${label}任务 ${taskIndex + 1} 名称`} maxLength={80} value={task.name} onChange={event => patchTask(taskId, { name: event.target.value })} /></label>
              <label>任务停留总时长（分钟）<input aria-label={`${task.name}停留分钟`} type="number" min="0" max="180" step="0.1" value={task.dwellMinutes} onChange={event => patchTask(taskId, { dwellMinutes: Number(event.target.value) })} /></label>
              <label>任务安排<select aria-label={`${task.name}必查设置`} value={task.required ? "required" : "optional"} onChange={event => edit(() => parseFieldTaskPlan({ ...plan, planningGoal: goal, tasks: plan.tasks.map(value => value.taskId === taskId ? { ...value, required: event.target.value === "required" } : value) }))}><option value="required">必查</option><option value="optional">可延期</option></select></label>
              <label>人工优先级<select aria-label={`${task.name}优先级`} value={task.priority ?? "medium"} onChange={event => patchTask(taskId, { priority: event.target.value as InspectionTask["priority"] })}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label>
              <button type="button" className="road-navigation-vehicle-pick" aria-pressed={pickId === `task:${taskId}`} onClick={() => onPick(pickId === `task:${taskId}` ? null : `task:${taskId}`)}>在地图上选择核查目标</button><small>{coordinateText(task.targetCoordinate)}</small>
              <CoordinateInput key={`${taskId}:${coordinateText(task.targetCoordinate)}`} id={taskId} label={task.name} coordinate={task.targetCoordinate} onApply={coordinate => edit(() => setFieldTaskTargetCoordinate(plan, taskId, coordinate))} />
              <label>现场进入状态<select aria-label={`${task.name}进入状态`} value={task.legacyAccessReview} onChange={event => patchTask(taskId, { legacyAccessReview: event.target.value as InspectionTask["legacyAccessReview"] })}><option value="unknown">未核验</option>{task.legacyAccessReview === "confirmed" && <option value="confirmed" disabled>历史确认 · 仍待复核</option>}<option value="blocked">明确不可进入 / 需调整</option></select></label>
              <label>核验依据与限制备注<textarea aria-label={`${task.name}核验备注`} rows={2} maxLength={4000} value={task.accessNote} onChange={event => patchTask(taskId, { accessNote: event.target.value })} /></label>
              <div className="road-task-draft-actions">{visit.taskIds.length > 1 && <><button type="button" disabled={taskIndex === 0} onClick={() => reorderTask(visit.visitId, taskIndex, -1)}>任务上移</button><button type="button" disabled={taskIndex === visit.taskIds.length - 1} onClick={() => reorderTask(visit.visitId, taskIndex, 1)}>任务下移</button><button type="button" disabled={plan.visits.length >= 8} onClick={() => edit(() => splitFieldTask(plan, taskId, { visitId: newId("visit"), stopId: newId("stop") }))}>拆为独立停靠</button></>}<button type="button" onClick={() => { if (window.confirm(`删除“${task.name}”？仅删除此任务；若其为中途站唯一任务，也会移除此空站。已保存草稿会更新，请先备份需要保留的版本。`)) edit(() => removeFieldTask(plan, taskId, { confirmed: true })); }}>删除任务</button></div>
            </details>;
          })}</div>
          <div className="road-task-draft-actions"><button type="button" disabled={plan.tasks.length >= 20} onClick={() => addAtVisit(visit.visitId)}>在此停靠添加任务</button></div>
          {visit.role === "candidate" && <label className="road-task-share">共用其他停靠<select aria-label={`${label}共用停车点`} value="" onChange={event => { const targetId = event.target.value; if (!targetId) return; const targetIndex = plan.visits.findIndex(value => value.visitId === targetId); if (window.confirm(`将${label}的 ${visit.taskIds.length} 项任务移至${labelOf(plan, targetIndex)}，共用该次到访的停车点？每个目标、备注和停留均保留，任务在站内依次安排；不是自动确认停车或可达。`)) edit(() => shareFieldTaskVisit(plan, visit.visitId, targetId, { confirmed: true })); }}><option value="">选择明确共用的到访…</option>{plan.visits.filter(value => value.visitId !== visit.visitId).map(value => <option key={value.visitId} value={value.visitId}>{labelOf(plan, plan.visits.indexOf(value))}</option>)}</select></label>}
        </article>;
      })}</div>
      <div className="road-navigation-tools"><button type="button" disabled={plan.visits.length >= 8 || plan.tasks.length >= 20} onClick={addVisit}>添加中途核查 · {plan.visits.length - 2}/6</button></div>
      <section className="road-navigation-preferences"><label className="road-navigation-strategy">道路偏好<select aria-label="外业驾车策略" value={plan.strategy} onChange={event => edit(() => parseFieldTaskPlan({ ...plan, strategy: event.target.value }))}><option value="1">默认推荐</option><option value="2">时间优先</option><option value="5">距离更短</option><option value="11">高速优先</option><option value="13">不走高速</option></select></label><label className="road-navigation-optimize"><input type="checkbox" checked={plan.optimize} onChange={event => edit(() => parseFieldTaskPlan({ ...plan, optimize: event.target.checked }))} />优化中途停靠顺序 <small>起终点不变</small></label><details className="road-navigation-help"><summary>排序与策略说明</summary><p>{plan.optimize ? `允许重排停车点，按「${fieldPlanningGoalLabel(goal)}」和完整工时选择方案。` : "保持输入的停车点顺序；限时方案中的延期站会从本次行程中略去。"} {selectionGoal ? "必查保留，可延期任务按工时与人工优先级选择。" : "保留全部任务，在工时内比较停靠顺序。"} 最多 6 个中途停靠、20 项任务；同站任务顺序不变。道路偏好单独控制站间选路，结果仅代表本次成本矩阵。</p></details></section>
      <section className="road-navigation-schedule"><div className="road-field-schedule-inputs"><label>出发时刻<input aria-label="外业出发时刻" type="time" value={plan.startTime} onChange={event => edit(() => parseFieldTaskPlan({ ...plan, startTime: event.target.value }))} /></label><label>可用工时（分）<input aria-label="外业可用工时" type="number" min="30" max="720" value={plan.workMinutes} onChange={event => edit(() => parseFieldTaskPlan({ ...plan, workMinutes: Number(event.target.value) }))} /></label><label>机动缓冲（分）<input aria-label="外业机动缓冲" type="number" min="0" max="720" value={plan.bufferMinutes} onChange={event => edit(() => parseFieldTaskPlan({ ...plan, bufferMinutes: Number(event.target.value) }))} /></label></div><p className="road-navigation-help">修改后手动重新规划；服务可能复用相同道路请求的内存缓存。出发时刻仅用于本地排程，不预测未来路况。</p></section>
    </fieldset></details>
    <div className="road-navigation-actions"><button type="button" className="road-navigation-submit" disabled={busy || draftIoBusy || accessFormDirty || !accessGate.canPlan || blockingInspectionIssues.length > 0} onClick={() => void generateRoute()}>{busy ? "正在规划…" : "规划外业行程"}</button>{busy && <button type="button" onClick={() => requestRef.current?.controller.abort()}>取消等待</button>}</div>
    {actionHint && <p className={`road-navigation-message${access.state.loading || access.state.saving || draftIoBusy ? "" : " is-error"}`} role="status">{actionHint}</p>}
    {loginHref && <a className="button primary" href={loginHref} target="_blank" rel="noopener noreferrer">在新标签页登录，保留当前分析</a>}
    {message && <p className={`road-navigation-message${failed ? " is-error" : ""}`} role={failed ? "alert" : "status"}>{message}</p>}
    {result && <details className="road-navigation-help"><summary>路线服务用量</summary><p>本次上游 HTTP {result.providerPlan.usage.upstreamRequests} 次 · {roadOpsUsageLabel(result.providerPlan.usage)}</p></details>}
    <p className="road-navigation-boundary">道路路线仅供行程预估，停车和现场进入需另行核验。</p>
  </section>;
}
