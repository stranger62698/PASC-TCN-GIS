"use client";
import { useEffect, useMemo, useState } from "react";
import {
  optimizeRoadOpsRoute,
  parseRoadOpsRouteFixture,
  type RoadOpsRouteFixture,
  type RoadOpsRouteMapPlan,
  type RoadOpsRoutePlan,
} from "../lib/roadops-route";
import { parseRoadOpsDrivingPlan, roadOpsDrivingError, roadOpsUsageLabel, type RoadOpsDrivingPlan, type RoadOpsDrivingRequest } from "../lib/roadops-driving";
import type { RoadOpsFieldCandidate } from "../lib/roadops-workflow";
import { createRoadOpsMetricsSession, type RoadOpsMetricsSession } from "../lib/roadops-metrics";

export type RoadOpsPlannerMetrics = { route: RoadOpsRoutePlan | RoadOpsDrivingPlan | null; session: RoadOpsMetricsSession };

type Props = {
  phase3Candidates: RoadOpsFieldCandidate[];
  onPlanChange: (plan: RoadOpsRouteMapPlan | null) => void;
  onMetricsChange?: (value: RoadOpsPlannerMetrics) => void;
};

const DEFAULT_CANDIDATES = ["checkpoint-a", "checkpoint-b", "checkpoint-c", "checkpoint-d", "checkpoint-e", "checkpoint-f"];
const DEFAULT_DWELL: Record<string, number> = { "checkpoint-a": 35, "checkpoint-b": 25, "checkpoint-c": 40, "checkpoint-d": 30, "checkpoint-e": 20, "checkpoint-f": 25 };
const formatDistance = (meters: number) => meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters.toLocaleString()} m`;

export function RoadRoutePlannerPanel({ phase3Candidates, onPlanChange, onMetricsChange }: Props) {
  const [fixture, setFixture] = useState<RoadOpsRouteFixture | null>(null);
  const [loadError, setLoadError] = useState("");
  const [startId, setStartId] = useState("origin");
  const [endId, setEndId] = useState("terminal");
  const [candidateIds, setCandidateIds] = useState(DEFAULT_CANDIDATES);
  const [requiredIds, setRequiredIds] = useState(["checkpoint-c"]);
  const [dwellMinutes, setDwellMinutes] = useState(DEFAULT_DWELL);
  const [workMinutes, setWorkMinutes] = useState(240);
  const [returnToStart, setReturnToStart] = useState(false);
  const [routeMode, setRouteMode] = useState<"offline" | "live" | "replay">("offline");
  const [drivingPlan, setDrivingPlan] = useState<RoadOpsDrivingPlan | null>(null);
  const [drivingStatus, setDrivingStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [drivingMessage, setDrivingMessage] = useState("");
  const [session, setSession] = useState(() => createRoadOpsMetricsSession(new Date().toISOString()));

  useEffect(() => {
    let cancelled = false;
    fetch("/data/roadops/jiangdong-route-demo.json")
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(value => { if (!cancelled) setFixture(parseRoadOpsRouteFixture(value)); })
      .catch(error => { if (!cancelled) setLoadError(`固定路线演示数据加载失败：${error instanceof Error ? error.message : "未知错误"}`); });
    return () => { cancelled = true; };
  }, []);

  const plan = useMemo<RoadOpsRoutePlan | null>(() => {
    if (!fixture) return null;
    try {
      return optimizeRoadOpsRoute(fixture, { startId, endId, candidateIds, requiredIds, dwellMinutes, workMinutes, returnToStart });
    } catch {
      return null;
    }
  }, [fixture, startId, endId, candidateIds, requiredIds, dwellMinutes, workMinutes, returnToStart]);
  useEffect(() => { onPlanChange(routeMode === "offline" ? plan?.map ?? null : drivingPlan?.map ?? plan?.map ?? null); }, [drivingPlan, onPlanChange, plan, routeMode]);
  useEffect(() => { onMetricsChange?.({ route: routeMode === "offline" ? plan : drivingPlan, session }); }, [drivingPlan, onMetricsChange, plan, routeMode, session]);

  const pointById = useMemo(() => new Map(fixture?.points.map(point => [point.id, point]) ?? []), [fixture]);
  const phase3ByFeatureId = useMemo(() => new Map(phase3Candidates.filter(candidate => candidate.featureId).map(candidate => [candidate.featureId, candidate])), [phase3Candidates]);
  const matchedPhase3Count = fixture?.points.filter(point => point.sourceFeatureId && phase3ByFeatureId.has(point.sourceFeatureId)).length ?? 0;
  const fixedCandidates = fixture?.points.filter(point => point.role === "candidate") ?? [];
  const drivingRequest = useMemo<RoadOpsDrivingRequest | null>(() => {
    if (!fixture) return null;
    const effectiveEndId = returnToStart ? startId : endId;
    const pointIds = [...new Set([startId, effectiveEndId, ...candidateIds])];
    const points = pointIds.map(id => pointById.get(id)).filter((point): point is NonNullable<typeof point> => Boolean(point)).map(point => ({
      id: point.id,
      name: point.name,
      coordinate: point.coordinate,
      role: point.id === startId ? "origin" as const : point.id === effectiveEndId ? "destination" as const : "candidate" as const,
      dwellMinutes: dwellMinutes[point.id] ?? point.defaultDwellMinutes,
      inspectionValue: point.inspectionValue,
      required: requiredIds.includes(point.id),
      sourceFeatureId: point.sourceFeatureId,
      sourceRoadName: point.sourceRoadName,
    }));
    return { schemaVersion: "roadops-driving-request-v1", startId, endId: effectiveEndId, returnToStart, workMinutes, strategy: "1", points };
  }, [candidateIds, dwellMinutes, endId, fixture, pointById, requiredIds, returnToStart, startId, workMinutes]);

  const resetToOffline = () => { setRouteMode("offline"); setDrivingStatus("idle"); setDrivingMessage(""); setSession(current => ({ ...current, updatedAt: new Date().toISOString() })); };

  const toggleCandidate = (id: string, checked: boolean) => {
    resetToOffline();
    setCandidateIds(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id));
    if (!checked) setRequiredIds(current => current.filter(value => value !== id));
  };
  const runLiveDriving = async () => {
    if (!drivingRequest || drivingStatus === "loading") return;
    setSession(current => ({ ...current, updatedAt: new Date().toISOString(), liveAttempts: current.liveAttempts + 1 }));
    setDrivingStatus("loading"); setDrivingMessage("正在执行受控闭环：坐标转换 → 有向矩阵 → 最终折线；不自动重试。");
    try {
      const response = await fetch("/api/roadops/driving", { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(drivingRequest) });
      const body = await response.json().catch(() => null) as { plan?: unknown; error?: { usage?: unknown } } | null;
      if (!response.ok) recordUsage(body?.error?.usage);
      if (!response.ok) throw new Error(roadOpsDrivingError(body, response.status === 404 ? "当前为静态预览，实时服务端代理未运行；可使用脱敏契约回放。" : `实时驾车规划失败（HTTP ${response.status}）。`));
      if (!body?.plan) throw new Error("当前为静态预览，实时服务端代理未运行；可使用脱敏契约回放或启动本地服务端开发模式。");
      const next = parseRoadOpsDrivingPlan(body?.plan);
      if (next.mode !== "didi_live") throw new Error("实时服务返回的数据模式不符，固定方案保持不变。");
      recordUsage(next.usage);
      setSession(current => ({ ...current, updatedAt: new Date().toISOString(), liveSuccesses: current.liveSuccesses + 1, cacheHits: current.cacheHits + (next.usage.cached ? 1 : 0) }));
      setDrivingPlan(next); setRouteMode("live"); setDrivingStatus("success");
      setDrivingMessage(`${next.usage.cached ? "命中服务端缓存" : `完成 ${next.usage.upstreamRequests} 次受控上游请求`} · 今日剩余 ${next.usage.dailyRemaining}/${next.usage.dailyBudget}`);
    } catch (error) {
      setSession(current => ({ ...current, updatedAt: new Date().toISOString(), failedAttempts: current.failedAttempts + 1 }));
      setRouteMode("offline"); setDrivingStatus("error"); setDrivingMessage(error instanceof Error ? error.message : "实时驾车规划失败；固定演示路线保持不变。");
    }
  };
  const runReplay = async () => {
    if (drivingStatus === "loading") return;
    setDrivingStatus("loading"); setDrivingMessage("正在读取仓库内固定脱敏契约回放；不会调用滴图。");
    try {
      const response = await fetch("/data/roadops/jiangdong-didi-contract-replay.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`契约回放加载失败（HTTP ${response.status}）。`);
      const next = parseRoadOpsDrivingPlan(await response.json());
      if (next.mode !== "didi_replay") throw new Error("固定回放数据模式不符。");
      setSession(current => ({ ...current, updatedAt: new Date().toISOString(), replayLoads: current.replayLoads + 1 }));
      setDrivingPlan(next); setRouteMode("replay"); setDrivingStatus("success"); setDrivingMessage("脱敏契约回放 · 0 次上游请求 · 不消耗滴图额度");
    } catch (error) {
      setRouteMode("offline"); setDrivingStatus("error"); setDrivingMessage(error instanceof Error ? error.message : "契约回放失败；固定演示路线保持不变。");
    }
  };
  const recordUsage = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const usage = value as Record<string, unknown>;
    const valid = (item: unknown): item is number => typeof item === "number" && Number.isSafeInteger(item) && item >= 0;
    if (!valid(usage.dailyUsed) || !valid(usage.dailyBudget) || !valid(usage.dailyRemaining) || !valid(usage.upstreamRequests) || usage.dailyRemaining !== Math.max(0, usage.dailyBudget - usage.dailyUsed)) return;
    const observedAt = new Date().toISOString();
    const latestUsage = { observedAt, dailyUsed: usage.dailyUsed, dailyBudget: usage.dailyBudget, dailyRemaining: usage.dailyRemaining };
    const upstreamRequests = usage.upstreamRequests;
    setSession(current => ({ ...current, updatedAt: observedAt, usageObservations: current.usageObservations + 1, observedUpstreamRequests: current.observedUpstreamRequests + upstreamRequests, latestUsage }));
  };
  const exportPlan = () => {
    const activePlan = routeMode === "offline" ? plan : drivingPlan;
    if (!activePlan) return;
    const payload = JSON.stringify(activePlan, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" })), anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = routeMode === "offline" ? "roadops-phase4-offline-route-plan.json" : `roadops-phase5-${routeMode}-driving-plan.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return <section className="road-route-planner" aria-label="RoadOps Phase 5 受控驾车路线规划">
    <header>
      <div><small>ROADOPS · PHASE 4 → 5</small><b>外业路线优化</b></div>
      <span className={`route-mode-badge mode-${routeMode}`}>{routeMode === "live" ? "滴图实时 · 服务端" : routeMode === "replay" ? "脱敏契约 · 0 调用" : "演示数据 · 离线规划"}</span>
    </header>
    <div className="route-mode-switch" aria-label="路线数据模式">
      <button type="button" aria-pressed={routeMode === "offline"} disabled={drivingStatus === "loading"} onClick={resetToOffline}>固定矩阵 / 保存路线</button>
      <button type="button" aria-pressed={routeMode === "live"} disabled={drivingStatus === "loading" || !drivingRequest} onClick={runLiveDriving}>生成实时驾车路线</button>
      <button type="button" aria-pressed={routeMode === "replay"} disabled={drivingStatus === "loading"} onClick={runReplay}>脱敏契约回放</button>
    </div>
    <p className="route-mode-note">离线优化随表单即时计算；只有点击“生成实时驾车路线”才请求同源服务端代理，未缓存闭环最多 3 次上游调用且不自动重试。</p>
    <aside className={`route-live-status status-${drivingStatus}`} aria-live="polite"><span><b>{drivingStatus === "loading" ? "请求执行中" : drivingStatus === "success" ? "Phase 5 已返回" : drivingStatus === "error" ? "实时路线未替换" : "额度保护已启用"}</b><small>Key 仅存服务端 · 默认日预算 50 · 相同输入优先缓存</small></span>{drivingMessage && <em>{drivingMessage}</em>}</aside>
    {loadError && <p className="route-load-error" role="alert">{loadError}</p>}
    {!fixture && !loadError && <p className="route-loading" role="status">正在读取固定江东路线夹具…</p>}
    {fixture && <>
      <fieldset className="route-inputs" disabled={drivingStatus === "loading"}><legend className="sr-only">路线条件</legend>
      <div className="route-endpoints">
        <label><span>出发地</span><select value={startId} onChange={event => { resetToOffline(); setStartId(event.target.value); }}>{fixture.points.map(point => <option key={point.id} value={point.id} disabled={!point.reachable}>{point.name}</option>)}</select></label>
        <label><span>结束地</span><select value={returnToStart ? startId : endId} disabled={returnToStart} onChange={event => { resetToOffline(); setEndId(event.target.value); }}>{fixture.points.map(point => <option key={point.id} value={point.id} disabled={!point.reachable || point.id === startId}>{point.name}</option>)}</select></label>
        <label className="route-return-toggle"><input type="checkbox" checked={returnToStart} onChange={event => { resetToOffline(); setReturnToStart(event.target.checked); }} /><span>完成后返回出发地</span></label>
      </div>
      <label className="route-work-budget"><span>单组工作时长 <b>{(workMinutes / 60).toFixed(1)} 小时</b></span><input aria-label="外业工作时长" type="range" min="120" max="480" step="30" value={workMinutes} onChange={event => { resetToOffline(); setWorkMinutes(Number(event.target.value)); }} /><small>含驾车与单点停留；调整后会重新选择点位和访问顺序。</small></label>
      <fieldset className="route-candidate-picker"><legend>候选途经点 <small>最多 {fixture.limits.maximumCandidates} 个</small></legend>
        <div>{fixedCandidates.map(point => {
          const selected = candidateIds.includes(point.id), required = requiredIds.includes(point.id), phase3 = point.sourceFeatureId ? phase3ByFeatureId.get(point.sourceFeatureId) : undefined;
          return <article className={!point.reachable ? "is-unreachable" : undefined} key={point.id}>
            <label className="route-candidate-select"><input aria-label={`选择候选点 ${point.name}`} type="checkbox" checked={selected} onChange={event => toggleCandidate(point.id, event.target.checked)} /><span><b>{point.name}</b><small>{point.sourceRoadName} · 价值 {point.inspectionValue}{phase3 ? ` · Phase 3 ${phase3.ruleCode}` : ""}</small></span></label>
            <label><span>必选</span><input type="checkbox" checked={required} disabled={!selected || !point.reachable} onChange={event => { resetToOffline(); setRequiredIds(current => event.target.checked ? [...new Set([...current, point.id])] : current.filter(value => value !== point.id)); }} /></label>
            <label><span>停留</span><input aria-label={`${point.name}停留分钟`} type="number" min="0" max="180" step="5" value={dwellMinutes[point.id] ?? point.defaultDwellMinutes} onChange={event => { resetToOffline(); setDwellMinutes(current => ({ ...current, [point.id]: Math.max(0, Number(event.target.value) || 0) })); }} /><i>分</i></label>
            {!point.reachable && <em>{point.unreachableReason}</em>}
          </article>;
        })}</div>
      </fieldset>
      </fieldset>
      <aside className="route-phase3-input"><b>Phase 3 外业候选</b><span>{phase3Candidates.length} 条工单候选 · {matchedPhase3Count} 个固定点匹配</span><small>当前规划器使用固定演示点；未匹配工单保留在外业清单，尚未进入驾车请求。下方收益只比较同一组演示点的访问顺序。</small></aside>
      {routeMode === "offline" && plan && <section className={`route-plan-result status-${plan.status}`} aria-label="离线路线优化结果">
        <header><div><small>{plan.status === "ready" ? "预算内方案" : "约束不可行"}</small><b>{pointById.get(plan.stopOrder[0])?.name} → {pointById.get(plan.stopOrder.at(-1) ?? "")?.name}</b></div><button type="button" onClick={exportPlan}>导出计划</button></header>
        <div className="route-plan-metrics"><span><b>{plan.selectedCandidateIds.length}</b><small>纳入点位</small></span><span><b>{formatDistance(plan.totalDistanceMeters)}</b><small>固定道路里程</small></span><span><b>{plan.totalMinutes.toFixed(1)} 分</b><small>驾车 {plan.drivingMinutes.toFixed(1)} + 停留 {plan.dwellMinutes.toFixed(1)}</small></span><span><b>{formatDistance(plan.distanceSavedMeters)}</b><small>较原始顺序节省</small></span></div>
        {plan.overtimeMinutes > 0 && <p className="route-overtime">必选点约束超出工作时长 {plan.overtimeMinutes.toFixed(1)} 分钟，请增加时长或调整必选点。</p>}
        <ol className="route-itinerary">{plan.stopOrder.map((id, index) => {
          const point = pointById.get(id), first = index === 0, last = index === plan.stopOrder.length - 1;
          return <li key={`${id}:${index}`}><i>{first ? "起" : last ? "终" : index}</i><span><b>{point?.name ?? id}</b><small>{first ? "出发" : last ? returnToStart ? "返回驻点" : "收队" : `${requiredIds.includes(id) ? "必选 · " : ""}停留 ${dwellMinutes[id] ?? point?.defaultDwellMinutes ?? 0} 分钟`}</small></span></li>;
        })}</ol>
        {plan.excluded.length > 0 && <div className="route-exclusions"><b>未纳入原因</b>{plan.excluded.map(item => <span key={item.pointId}><i>{item.reason === "unreachable" ? "不可达" : item.reason === "time_budget" ? "超预算" : "待矩阵"}</i><em>{item.pointName}：{item.detail}</em></span>)}</div>}
      </section>}
      {routeMode !== "offline" && drivingPlan && <section className={`route-plan-result route-driving-result status-${drivingPlan.status}`} aria-label="Phase 5 驾车路线结果">
        <header><div><small>{drivingPlan.mode === "didi_live" ? drivingPlan.usage.cached ? "滴图实时 · 缓存命中" : "滴图实时 · 新请求" : "脱敏契约回放 · 非实时"}</small><b>{pointById.get(drivingPlan.stopOrder[0])?.name ?? drivingPlan.stopOrder[0]} → {pointById.get(drivingPlan.stopOrder.at(-1) ?? "")?.name ?? drivingPlan.stopOrder.at(-1)}</b></div><button type="button" onClick={exportPlan}>导出计划</button></header>
        <div className="route-plan-metrics"><span><b>{drivingPlan.selectedCandidateIds.length}</b><small>纳入点位</small></span><span><b>{formatDistance(drivingPlan.totalDistanceMeters)}</b><small>{drivingPlan.mode === "didi_live" ? "滴图道路里程" : "回放道路里程"}</small></span><span><b>{drivingPlan.totalMinutes.toFixed(1)} 分</b><small>驾车 {drivingPlan.drivingMinutes.toFixed(1)} + 停留 {drivingPlan.dwellMinutes.toFixed(1)}</small></span><span><b>{drivingPlan.mode === "didi_replay" ? "回放" : drivingPlan.usage.cached ? "缓存" : drivingPlan.usage.upstreamRequests}</b><small>{drivingPlan.mode === "didi_replay" ? "本地读取 · 0 调用" : drivingPlan.usage.cached ? "未新增上游调用" : "本次上游请求"}</small></span></div>
        {drivingPlan.overtimeMinutes > 0 && <p className="route-overtime">真实道路耗时使方案超出工作时长 {drivingPlan.overtimeMinutes.toFixed(1)} 分钟，请调整点位或时长。</p>}
        <ol className="route-itinerary">{drivingPlan.map.stops.map((point, index) => { const first = index === 0, last = index === drivingPlan.map.stops.length - 1; return <li key={`${point.id}:${index}`}><i>{first ? "起" : last ? "终" : index}</i><span><b>{point.name}</b><small>{first ? "出发" : last ? point.id === drivingPlan.stopOrder[0] ? "返回驻点" : "收队" : `${point.required ? "必选 · " : ""}停留 ${point.defaultDwellMinutes} 分钟`}</small></span></li>; })}</ol>
        {drivingPlan.excluded.length > 0 && <div className="route-exclusions"><b>未纳入原因</b>{drivingPlan.excluded.map(item => <span key={item.pointId}><i>{item.reason === "unreachable" ? "不可达" : item.reason === "time_budget" ? "超预算" : "待矩阵"}</i><em>{item.pointName}：{item.detail}</em></span>)}</div>}
        <p className="route-driving-usage">{drivingPlan.mode === "didi_replay" ? "固定回放使用保存的演示条件，不代表当前表单结果或真实账户用量；修改条件可回到离线优化。" : roadOpsUsageLabel(drivingPlan.usage)}</p>
      </section>}
      <p className="route-boundary">{routeMode === "live" && drivingPlan ? drivingPlan.boundary : routeMode === "replay" && drivingPlan ? drivingPlan.boundary : "固定成本含道路等级速度与有向差异，不含实时交通；折线来自保存的 OSM 道路形状。仅用于作品集验证，不提供导航。"}</p>
    </>}
  </section>;
}
