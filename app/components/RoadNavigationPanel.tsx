"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { readRoadOpsDrivingResponse, roadOpsDrivingError, type RoadOpsDrivingPlan, type RoadOpsDrivingRequest } from "../lib/roadops-driving";
import {
  NAVIGATION_MAX_WAYPOINTS, addNavigationWaypoint, buildNavigationRequest, createNavigationDraft,
  confirmInspectionNavigationTarget, moveNavigationWaypoint, navigationInspectionIssues, navigationPickLabel, navigationPoints, parseNavigationResponse, setNavigationCoordinate, swapNavigationEndpoints, updateNavigationPoint,
  type NavigationDraft, type NavigationPoint,
} from "../lib/roadops-navigation";
import type { RoadRiskEvidenceInput } from "../lib/roadops-quality";
import { RoadFieldPlanPanel } from "./RoadFieldPlanPanel";
import { RoadTaskDraftPanel } from "./RoadTaskDraftPanel";
import { createFieldTaskPlan, type FieldTaskPlan } from "../lib/roadops-task-plan";
import { strategyComparisonInputKey } from "../lib/roadops-strategy-comparison";
import { useRoadOpsStrategyComparison } from "../lib/use-roadops-strategy-comparison";
import { buildLoginContinuationHref } from "../lib/local-analysis-session";
import { getSession } from "../lib/auth-client";
import { RoadPlanningGoalSelect } from "./RoadPlanningGoalSelect";

type Props = {
  draft: NavigationDraft;
  onChange: (draft: NavigationDraft) => void;
  pickId: string | null;
  onPick: (id: string | null) => void;
  plan: RoadOpsDrivingPlan | null;
  onPlan: (plan: RoadOpsDrivingPlan | null) => void;
  onBusy: (busy: boolean) => void;
  evidence: RoadRiskEvidenceInput[];
  activeLegId: string | null;
  onFocusLeg: (id: string | null) => void;
  onFocusPoint: (coordinate: [number, number]) => void;
  onOpenFieldTasks?: (plan: FieldTaskPlan, saved?: boolean) => void;
  currentDatasetId?: string | null;
  currentAnalysisId?: string | null;
};

function NavigationIcon({ name }: { name: "pin" | "close" | "up" | "down" | "plus" | "swap" | "route" | "settings" | "clock" }) {
  return <svg className="road-navigation-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === "pin" && <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.3" /></>}
    {name === "close" && <path d="m6 6 12 12M18 6 6 18" />}
    {name === "up" && <path d="M12 19V5m-5 5 5-5 5 5" />}
    {name === "down" && <path d="M12 5v14m-5-5 5 5 5-5" />}
    {name === "plus" && <path d="M12 5v14M5 12h14" />}
    {name === "swap" && <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4" />}
    {name === "route" && <><circle cx="5" cy="18" r="2" /><circle cx="19" cy="6" r="2" /><path d="M5 16V9a3 3 0 0 1 3-3h3a3 3 0 0 1 0 6h2a3 3 0 0 0 3-3V6h1" /></>}
    {name === "settings" && <><path d="M4 7h9m4 0h3M4 17h3m4 0h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>}
    {name === "clock" && <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>}
  </svg>;
}

function CoordinateEditor({ point, label, onApply }: { point: NavigationPoint; label: string; onApply: (coordinate: [number, number]) => void }) {
  const [longitude, setLongitude] = useState(point.coordinate?.[0].toFixed(6) ?? "");
  const [latitude, setLatitude] = useState(point.coordinate?.[1].toFixed(6) ?? "");
  const [error, setError] = useState("");
  function apply(event: FormEvent) {
    event.preventDefault();
    const lng = Number(longitude), lat = Number(latitude);
    if (!longitude.trim() || !latitude.trim() || !Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      setError("请输入有效的 WGS84 经度（-180～180）和纬度（-90～90）。");
      return;
    }
    setError("");
    onApply([lng, lat]);
  }
  return <details className="road-navigation-coordinate-editor">
    <summary>输入精确坐标</summary>
    <form onSubmit={apply}>
      <p>仅接受 WGS84；顺序为经度、纬度。</p>
      <div className="road-navigation-coordinate-fields">
        <label htmlFor={`${point.id}-longitude`}>经度<input id={`${point.id}-longitude`} aria-label={`${label} WGS84 经度`} type="number" step="any" min="-180" max="180" value={longitude} onChange={event => setLongitude(event.target.value)} required /></label>
        <label htmlFor={`${point.id}-latitude`}>纬度<input id={`${point.id}-latitude`} aria-label={`${label} WGS84 纬度`} type="number" step="any" min="-90" max="90" value={latitude} onChange={event => setLatitude(event.target.value)} required /></label>
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="submit">应用此坐标</button>
    </form>
  </details>;
}

export function RoadNavigationPanel({ draft, onChange, pickId, onPick, plan, onPlan, onBusy, evidence, activeLegId, onFocusLeg, onFocusPoint, onOpenFieldTasks, currentDatasetId, currentAnalysisId }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [loginHref, setLoginHref] = useState("");
  const analysisContext = useMemo(() => ({ currentDatasetId, currentAnalysisId }), [currentDatasetId, currentAnalysisId]);
  const inspectionIssues = useMemo(() => navigationInspectionIssues(draft, analysisContext), [draft, analysisContext]);
  const requestSignature = useMemo(() => JSON.stringify([draft, analysisContext]), [draft, analysisContext]);
  const comparisonScopeKey = useMemo(() => {
    try {
      return JSON.stringify([strategyComparisonInputKey(buildNavigationRequest(draft, analysisContext)), { ...draft, strategy: undefined }]);
    } catch { return null; }
  }, [draft, analysisContext]);
  const { comparison, begin: beginComparison, accept: acceptComparison, clear: clearComparison } = useRoadOpsStrategyComparison(comparisonScopeKey);
  const requestRef = useRef<{ controller: AbortController; signature: string } | null>(null);
  const committedDraftSignature = useRef(requestSignature);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusy);
  useEffect(() => { busyCallback.current = onBusy; }, [onBusy]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestRef.current?.controller.abort();
      busyCallback.current(false);
    };
  }, []);
  useLayoutEffect(() => {
    committedDraftSignature.current = requestSignature;
    if (requestRef.current && requestRef.current.signature !== requestSignature) requestRef.current.controller.abort();
  }, [requestSignature]);
  useEffect(() => {
    if (plan && inspectionIssues.some(issue => issue.kind === "stale")) { clearComparison(); onPlan(null); }
  }, [inspectionIssues, plan, clearComparison, onPlan]);

  useEffect(() => {
    if (!loginHref) return;
    let cancelled = false;
    const refresh = () => { void getSession().then(user => {
      if (!cancelled && user) { setLoginHref(""); setFailed(false); setMessage("登录会话已恢复，点位已保留；请点击规划驾车路线重试。"); }
    }).catch(() => null); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", visible); };
  }, [loginHref]);

  function change(next: NavigationDraft) {
    if (busy) return;
    if (JSON.stringify({ ...next, strategy: undefined }) !== JSON.stringify({ ...draft, strategy: undefined })) clearComparison();
    else if (next.strategy !== draft.strategy) beginComparison();
    setMessage("");
    setFailed(false);
    onChange(next);
  }
  function remove(point: NavigationPoint) {
    if (pickId === point.id || pickId === `vehicle:${point.id}`) onPick(null);
    change(point.role === "candidate" ? { ...draft, waypoints: draft.waypoints.filter(item => item.id !== point.id) } : setNavigationCoordinate(draft, point.id, null));
  }
  function addWaypoint() {
    const next = addNavigationWaypoint(draft);
    change(next);
    onPick(next.waypoints[next.waypoints.length - 1].id);
  }
  async function generateRoute() {
    if (requestRef.current) return;
    let request: RoadOpsDrivingRequest;
    try { request = buildNavigationRequest(draft, analysisContext); }
    catch (error) { clearComparison(); setMessage(error instanceof Error ? error.message : "请检查点位设置。"); setFailed(true); return; }
    const controller = new AbortController();
    const current = { controller, signature: requestSignature };
    requestRef.current = current;
    beginComparison();
    setBusy(true);
    onBusy(true);
    onPick(null);
    onPlan(null);
    setFailed(false);
    setLoginHref("");
    setMessage("正在请求滴图驾车路线；不会自动重试。");
    let timedOut = false;
    const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const response = await fetch("/api/roadops/driving", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: controller.signal, credentials: "same-origin", cache: "no-store" });
      const raw = await readRoadOpsDrivingResponse(response);
      if (!mounted.current || requestRef.current !== current || controller.signal.aborted || current.signature !== committedDraftSignature.current) { clearComparison(); return; }
      if (response.status === 401) {
        setLoginHref(buildLoginContinuationHref(`${window.location.pathname}${window.location.search}${window.location.hash}`, window.location.origin));
        throw new Error("需要登录后才能使用驾车路线服务。请在新标签页登录，再回到此页手动重试；当前点位和分析结果保留。");
      }
      if (!response.ok) throw new Error(roadOpsDrivingError(raw, `路线服务暂不可用（HTTP ${response.status}）。请检查本地服务后再手动重试。`));
      const result = parseNavigationResponse(raw, request);
      if (!mounted.current || requestRef.current !== current) return;
      if (controller.signal.aborted || current.signature !== committedDraftSignature.current) { clearComparison(); return; }
      acceptComparison(request, result);
      onPlan(result);
      setMessage(result.usage.cached ? "已复用相同方案的服务端缓存；本次未新增上游请求。" : "真实道路分段已生成；入口和现场通行条件仍需核验。");
    } catch (error) {
      if (!mounted.current || requestRef.current !== current) return;
      clearComparison();
      setFailed(true);
      setMessage(controller.signal.aborted ? (timedOut ? "路线请求等待超时；已停止等待，不会自动重试。已发出的请求可能已计入用量。" : "已取消等待。已发出的请求可能已计入用量；点位保留。") : error instanceof Error ? error.message : "路线请求失败，点位已保留；不会绘制模拟连线。");
    } finally {
      window.clearTimeout(timer);
      if (requestRef.current === current) {
        requestRef.current = null;
        if (mounted.current) { setBusy(false); onBusy(false); }
      }
    }
  }

  return <section className="road-navigation" aria-label="滴图驾车路线规划">
    <header className="road-navigation-heading">
      <p className="road-navigation-eyebrow">路线：滴图驾车 · 底图独立</p>
      <h3>小客车外业行程</h3>
      <p>选核查目标，必要时另设道路入口或车辆到达点。路线、停留与现场进入条件分开核验。</p>
    </header>
    <RoadTaskDraftPanel draft={draft} disabled={busy} onRestore={next => { clearComparison(); onPlan(null); onPick(null); change(next); }} onRestoreTaskPlan={onOpenFieldTasks ? next => { clearComparison(); onOpenFieldTasks(next, true); } : undefined} />
    {onOpenFieldTasks && <button className="road-task-advanced-entry" type="button" disabled={busy} onClick={() => { clearComparison(); onPlan(null); onPick(null); onOpenFieldTasks(createFieldTaskPlan(draft, { planId: `field-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`, name: "未命名外业任务", now: new Date().toISOString() })); }}>个性化方案与完整任务 <span>比较方案、可延期任务、返程与共站</span></button>}
    <RoadPlanningGoalSelect goal={draft.planningGoal ?? (draft.strategy === "5" ? "distance" : "time")} disabled={busy} onChange={planningGoal => {
      const next = { ...draft, planningGoal, strategy: planningGoal === "time" ? "2" as const : planningGoal === "distance" ? "5" as const : draft.strategy };
      if (onOpenFieldTasks) { clearComparison(); onPlan(null); onPick(null); onOpenFieldTasks(createFieldTaskPlan(next, { planId: `field-${globalThis.crypto.randomUUID()}`, name: "未命名外业任务", now: new Date().toISOString() })); }
      else change(next);
    }} />
    {plan && <RoadFieldPlanPanel plan={plan} comparison={comparison} draft={draft} evidence={evidence} activeLegId={activeLegId} onFocusLeg={onFocusLeg} onFocusPoint={onFocusPoint} />}
    <details className="road-navigation-edit" open={!plan}>
    <summary>{plan ? "编辑点位、核查停留与进入核验" : "设置核查行程"}</summary>
    <fieldset className="road-navigation-form" disabled={busy}>
      <legend className="road-navigation-sr-only">行程点位与驾车设置</legend>
      <div className="road-navigation-points">
        {navigationPoints(draft).map((point, index) => {
          const label = navigationPickLabel(draft, point.id);
          const waypointIndex = draft.waypoints.findIndex(item => item.id === point.id);
          const sourceIssue = inspectionIssues.find(issue => issue.pointId === point.id);
          return <div key={point.id} className={`road-navigation-point road-navigation-point-${point.role}${pickId === point.id ? " is-picking" : ""}`}>
            <div className="road-navigation-point-heading">
              <span className="road-navigation-point-marker" aria-hidden="true">{point.role === "origin" ? "起" : point.role === "destination" ? "终" : index}</span>
              <strong>{label}</strong>
              {point.role === "candidate" && <span className="road-navigation-required">必经</span>}
              <button type="button" className="road-navigation-remove" aria-label={`${point.role === "candidate" ? "删除" : "清空"}${label}`} disabled={!point.coordinate && point.role !== "candidate"} onClick={() => remove(point)}><NavigationIcon name="close" /></button>
            </div>
            <button type="button" className="road-navigation-pick" aria-pressed={pickId === point.id} onClick={() => onPick(pickId === point.id ? null : point.id)}>
              <NavigationIcon name="pin" />
              <span className="road-navigation-pick-copy"><span>{pickId === point.id ? "请点击地图，选择此点" : point.coordinate ? "重新在地图上选点" : `在地图上选择${label}`}</span>
              <small>{point.coordinate ? `${point.coordinate[0].toFixed(6)}, ${point.coordinate[1].toFixed(6)}` : "尚未选择"}</small></span>
            </button>
            {point.role === "candidate" && <div className="road-navigation-reorder">
              <button type="button" aria-label={`上移${label}`} disabled={waypointIndex === 0 || draft.optimize} onClick={() => change(moveNavigationWaypoint(draft, point.id, -1))}><NavigationIcon name="up" />上移</button>
              <button type="button" aria-label={`下移${label}`} disabled={waypointIndex === draft.waypoints.length - 1 || draft.optimize} onClick={() => change(moveNavigationWaypoint(draft, point.id, 1))}><NavigationIcon name="down" />下移</button>
            </div>}
            {point.inspectionSource && <details className="road-navigation-source"><summary>分析来源 · {point.inspectionSource.datasetTitle}</summary>
              <p>{point.inspectionSource.kind === "region" ? `${point.inspectionSource.regionId} · ${point.inspectionSource.regionPointCount} 个成员点` : "已选监测点"} · 真实点 {point.inspectionSource.representativePointId}</p>
              <p>观测日期：{point.inspectionSource.observationDate}</p><p>规则：{point.inspectionSource.ruleSummary}</p>
              <small>分析编号：{point.inspectionSource.analysisId}</small>
              {point.inspectionSource.kind === "region" && <p>目标选自该组真实成员点，区域中心仅用于选取代表点。</p>}
              {point.inspectionSource.targetAdjusted && <p>目标位置已人工调整；以上来源仍指向原始分析点。</p>}
            </details>}
            {point.inspectionSource && <div className="road-navigation-arrival" data-inspection-arrival-selection={point.inspectionSource.arrivalSelection ?? "unconfirmed"}>
              {sourceIssue ? <p role="status">{sourceIssue.message}</p> : <p>{point.inspectionSource.arrivalSelection === "custom" ? "已选择独立车辆到达点算路" : "已明确使用目标位置算路"}；停车与入口许可仍待核验。</p>}
              <button type="button" disabled={!point.coordinate || sourceIssue?.kind === "stale"} onClick={() => { onPick(null); change(confirmInspectionNavigationTarget(draft, point.id)); }}>使用目标位置算路（入口待核验）</button>
              <p>也可在下方“名称、停留与车辆到达点”中另设车辆位置。</p>
            </div>}
            <CoordinateEditor key={`${point.id}:${point.coordinate?.join(",") ?? "empty"}`} point={point} label={label} onApply={coordinate => { onPick(null); change(setNavigationCoordinate(draft, point.id, coordinate)); }} />
            <details className="road-field-point-settings"><summary>名称、停留与车辆到达点{point.vehicleCoordinate ? " · 已设到达点" : ""}</summary>
              <label>任务名称<input aria-label={`${label}任务名称`} maxLength={80} value={point.name} onChange={event => change(updateNavigationPoint(draft, point.id, { name: event.target.value }))} /></label>
              {point.role !== "origin" && <label>停留 / 核查 / 转移（分钟）<input aria-label={`${label}停留分钟`} type="number" min="0" max="180" step="1" value={point.dwellMinutes ?? (point.role === "candidate" ? 20 : 0)} onChange={event => change(updateNavigationPoint(draft, point.id, { dwellMinutes: Number(event.target.value) }))} /></label>}
              <p>目标在园区、坡地或建筑内部时，可另选车辆接近位置。选中并不表示允许停车或进入。</p>
              <button className="road-navigation-vehicle-pick" type="button" disabled={!point.coordinate} aria-pressed={pickId === `vehicle:${point.id}`} onClick={() => onPick(pickId === `vehicle:${point.id}` ? null : `vehicle:${point.id}`)}><NavigationIcon name="pin" />{point.vehicleCoordinate ? "重选" : "另设"}{label}车辆到达点</button>
              {point.vehicleCoordinate && <><small>{point.vehicleCoordinate.map(value => value.toFixed(6)).join(", ")}</small><button type="button" onClick={() => change(setNavigationCoordinate(draft, `vehicle:${point.id}`, null))}>恢复直接到目标</button></>}
              {point.coordinate && <CoordinateEditor key={`vehicle:${point.id}:${point.vehicleCoordinate?.join(",") ?? "empty"}`} point={{ ...point, id: `vehicle:${point.id}`, coordinate: point.vehicleCoordinate ?? null }} label={`${label}车辆到达点`} onApply={coordinate => { onPick(null); change(setNavigationCoordinate(draft, `vehicle:${point.id}`, coordinate)); }} />}
              <label>现场进入条件<select aria-label={`${label}进入核验`} value={point.accessReview ?? "unknown"} onChange={event => change(updateNavigationPoint(draft, point.id, { accessReview: event.target.value as NavigationPoint["accessReview"] }))}><option value="unknown">未核实</option><option value="confirmed">已人工核实（须填依据）</option><option value="blocked">不可进入 / 需调整</option></select></label>
              <label>核验依据 / 限制备注<textarea aria-label={`${label}核验备注`} maxLength={500} rows={2} placeholder="例如：核实日期、入口许可、停车位置与最后一段进入方式" value={point.accessNote ?? ""} onChange={event => change(updateNavigationPoint(draft, point.id, { accessNote: event.target.value }))} /></label>
            </details>
          </div>;
        })}
      </div>
      <div className="road-navigation-tools">
        <button type="button" disabled={draft.waypoints.length >= NAVIGATION_MAX_WAYPOINTS} onClick={addWaypoint}><NavigationIcon name="plus" />途经点 <small>{draft.waypoints.length}/{NAVIGATION_MAX_WAYPOINTS}</small></button>
        <button type="button" onClick={() => { onPick(null); change(swapNavigationEndpoints(draft)); }}><NavigationIcon name="swap" />互换起终点</button>
        <button type="button" onClick={() => { if (!window.confirm("清空将移除当前行程的点位与核验备注；若已保存草稿，自动保存也会更新为空行程。请先另存或导出需要保留的版本。是否继续？")) return; clearComparison(); onPick(null); change(createNavigationDraft()); }}>清空</button>
      </div>
      <section className="road-navigation-preferences" aria-labelledby="road-navigation-preferences-heading">
      <div className="road-navigation-section-heading"><h4 id="road-navigation-preferences-heading"><NavigationIcon name="settings" />驾车设置</h4></div>
      <label className="road-navigation-strategy" htmlFor="road-navigation-strategy">驾车策略
        <select id="road-navigation-strategy" value={draft.strategy} onChange={event => change({ ...draft, strategy: event.target.value as NavigationDraft["strategy"] })}>
          <option value="1">默认推荐</option><option value="2">时间优先</option><option value="5">距离更短</option><option value="11">高速优先</option><option value="13">不走高速</option>
        </select>
      </label>
      <label className="road-navigation-optimize"><input type="checkbox" checked={draft.optimize} onChange={event => change({ ...draft, optimize: event.target.checked })} />优化途经点顺序 <small>保留全部必经点</small></label>
      <p className="road-navigation-help">{draft.optimize ? draft.strategy === "5" ? "按所选策略返回的道路距离优化顺序，并保留工时可行性；起终点不变，不删点。" : "按所选策略返回的预计耗时优化顺序，并保留工时可行性；起终点不变，不删点。" : "严格按照上方点位顺序驾车；可用上移、下移调整途经点。"}</p>
      <details className="road-navigation-help"><summary>排序与策略说明</summary><p>最多 6 个中途点，在本次有向道路成本矩阵和完整工时约束下比较停靠顺序。固定顺序不重排；道路偏好与核查需求分别设置。更改后手动规划，不预测未来交通。</p></details>
      </section>
      <section className="road-navigation-schedule" aria-labelledby="road-navigation-schedule-heading">
      <div className="road-navigation-section-heading"><h4 id="road-navigation-schedule-heading"><NavigationIcon name="clock" />时间安排</h4><span>本地评估</span></div>
      <div className="road-field-schedule-inputs">
        <label>出发时刻<input aria-label="出发时刻" type="time" value={draft.startTime ?? "08:30"} onChange={event => change({ ...draft, startTime: event.target.value })} /></label>
        <label>可用工时（分）<input aria-label="可用工时分钟" type="number" min="30" max="720" value={draft.workMinutes ?? 480} onChange={event => change({ ...draft, workMinutes: Number(event.target.value) })} /></label>
        <label>机动缓冲（分）<input aria-label="机动缓冲分钟" type="number" min="0" max="720" value={draft.bufferMinutes ?? 30} onChange={event => change({ ...draft, bufferMinutes: Number(event.target.value) })} /></label>
      </div>
      <p className="road-navigation-help">工时、缓冲和停留影响排程，修改后手动规划。出发时刻只调整本地时刻表，不预测未来路况。</p>
      </section>
    </fieldset>
    </details>
    <div className="road-navigation-actions">
      <button type="button" className="road-navigation-submit" disabled={busy || inspectionIssues.length > 0} onClick={() => void generateRoute()}><NavigationIcon name="route" />{busy ? "正在规划…" : "规划驾车路线"}</button>
      {busy && <button type="button" onClick={() => { clearComparison(); requestRef.current?.controller.abort(); }}>取消等待</button>}
    </div>
    {inspectionIssues.length > 0 && <p className="road-navigation-message is-error" role="status">{inspectionIssues[0].message}</p>}
    {message && <p className={`road-navigation-message${failed ? " is-error" : ""}`} role={failed ? "alert" : "status"}>{message}</p>}
    {loginHref && <a className="button primary" href={loginHref} target="_blank" rel="noopener noreferrer">在新标签页登录，保留当前分析</a>}
    <p className="road-navigation-boundary">仅提供驾车路线规划，不提供实时定位、语音或转向导航。底图和路网质检图层均不是本功能的寻路数据源。</p>
  </section>;
}
