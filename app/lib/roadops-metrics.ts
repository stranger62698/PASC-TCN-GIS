import type { RoadOpsDrivingPlan } from "./roadops-driving";
import type { RoadQualityReport } from "./roadops-quality";
import type { RoadOpsRoutePlan } from "./roadops-route";
import { ROAD_WORK_ORDER_STATUSES, type RoadIssueWorkOrder, type RoadWorkOrderStatus } from "./roadops-workflow";

export type RoadOpsMetricsSession = {
  startedAt: string;
  updatedAt: string;
  liveAttempts: number;
  liveSuccesses: number;
  cacheHits: number;
  replayLoads: number;
  failedAttempts: number;
  observedUpstreamRequests: number;
  usageObservations: number;
  latestUsage: { observedAt: string; dailyUsed: number; dailyBudget: number; dailyRemaining: number } | null;
};

export type RoadOpsMetric = {
  id: string;
  group: "quality" | "workflow" | "route" | "api";
  label: string;
  value: number | null;
  unit: string;
  definition: string;
  numerator: number | null;
  denominator: number | null;
  timeRange: string;
  source: string;
};

export type RoadOpsMetricsSnapshot = {
  schemaVersion: "roadops-metrics-v1";
  generatedAt: string;
  lineage: {
    datasetId: string;
    qualitySchemaVersion: string;
    ruleVersion: string;
    qualityGeneratedAt: string;
    workflowSchemaVersion: "roadops-workflow-v1";
    routeSchemaVersion: string | null;
    routeMode: "offline_demo" | "didi_live" | "didi_replay" | null;
    routeFixtureId: string | null;
    sessionStartedAt: string;
    lastUsageObservedAt: string | null;
  };
  workflow: Record<RoadWorkOrderStatus, number>;
  metrics: RoadOpsMetric[];
  limitations: string[];
};

export function createRoadOpsMetricsSession(at: string): RoadOpsMetricsSession {
  return { startedAt: at, updatedAt: at, liveAttempts: 0, liveSuccesses: 0, cacheHits: 0, replayLoads: 0, failedAttempts: 0, observedUpstreamRequests: 0, usageObservations: 0, latestUsage: null };
}

const finite = (value: number | null | undefined): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const nonnegative = (value: number | null | undefined): number | null => finite(value) !== null && value! >= 0 ? value! : null;
const rounded = (value: number | null): number | null => value === null ? null : Math.round(value * 100) / 100;
const percentage = (numerator: number | null, denominator: number | null): number | null => numerator !== null && denominator !== null && denominator > 0 ? rounded(numerator / denominator * 100) : null;

export function buildRoadOpsMetrics({ report, records, route, session }: {
  report: RoadQualityReport;
  records: Record<string, RoadIssueWorkOrder>;
  route: RoadOpsRoutePlan | RoadOpsDrivingPlan | null;
  session: RoadOpsMetricsSession;
}): RoadOpsMetricsSnapshot {
  const issues = [...new Map(report.issues.map(issue => [issue.id, issue])).values()];
  const segmentIds = new Set(report.segments.map(segment => segment.id));
  const affectedSegments = new Set(issues.flatMap(issue => issue.roadSegmentIds).filter(id => segmentIds.has(id)));
  const workflow = Object.fromEntries(ROAD_WORK_ORDER_STATUSES.map(status => [status, 0])) as Record<RoadWorkOrderStatus, number>;
  const workflowTimes = [report.generatedAt];
  for (const issue of issues) {
    const record = records[issue.id];
    const valid = record && record.issueId === issue.id && record.datasetId === report.datasetId && record.ruleVersion === report.ruleVersion && ROAD_WORK_ORDER_STATUSES.includes(record.status);
    workflow[valid ? record.status : "pending_review"] += 1;
    if (valid && record.updatedAt) workflowTimes.push(record.updatedAt);
  }
  const qualityTime = `数据快照：${report.generatedAt}`;
  const workflowTime = `当前累计状态，截至 ${workflowTimes.sort().at(-1)}`;
  const sessionTime = `本面板会话：${session.startedAt} — ${session.updatedAt}`;
  const routeTime = route && "generatedAt" in route ? `方案快照：${route.generatedAt}` : "当前固定演示方案";
  const qualitySource = "当前质量报告；只统计本数据集和规则版本";
  const workflowSource = "当前质量问题 + 同数据集、同规则版本的本地审核记录";
  const routeSource = route?.mode === "offline_demo" ? "OSM 固定有向成本矩阵；样例估算，不含实时路况"
    : route?.mode === "didi_live" ? "滴图驾车结果；没有可比的原顺序基线"
      : route?.mode === "didi_replay" ? "本地 OSM 契约回放；不含滴图响应" : "尚无路线方案";
  const sessionSource = "本面板内人工操作计数；刷新后重置";
  const metrics: RoadOpsMetric[] = [];
  const add = (group: RoadOpsMetric["group"], id: string, label: string, value: number | null, unit: string, definition: string, numerator: number | null, denominator: number | null, timeRange: string, source: string) => {
    metrics.push({ id, group, label, value: rounded(finite(value)), unit, definition, numerator: finite(numerator), denominator: finite(denominator), timeRange, source });
  };
  add("quality", "quality_segments", "标准路段", segmentIds.size, "段", "按标准路段 ID 去重；不含未能形成标准路段的无效几何。", segmentIds.size, null, qualityTime, qualitySource);
  add("quality", "quality_issues", "规则候选问题", issues.length, "条", "按当前规则问题 ID 去重；同一路段可以触发多个问题，不等于不合格路段数。", issues.length, null, qualityTime, qualitySource);
  add("quality", "quality_affected_segments", "受影响路段", affectedSegments.size, "段", "所有规则问题关联的有效标准路段 ID 并集；同一路段多次触发仅计一次。", affectedSegments.size, null, qualityTime, qualitySource);
  add("quality", "quality_affected_rate", "受影响路段占比", percentage(affectedSegments.size, segmentIds.size), "%", "受影响的去重标准路段数 ÷ 全部去重标准路段数；是规则候选覆盖率，不是实测缺陷率。", affectedSegments.size, segmentIds.size, qualityTime, qualitySource);
  const reviewed = issues.length - workflow.pending_review;
  const decided = workflow.accepted + workflow.rejected;
  add("workflow", "workflow_reviewed_rate", "已审核率", percentage(reviewed, issues.length), "%", "当前不再处于待审核的候选数 ÷ 当前全部候选数；包含接受、驳回、需外业和已核查。", reviewed, issues.length, workflowTime, workflowSource);
  add("workflow", "workflow_acceptance_rate", "明确结论接受率", percentage(workflow.accepted, decided), "%", "当前接受数 ÷（当前接受数 + 当前驳回数）；需外业和已核查不推断为接受。", workflow.accepted, decided, workflowTime, workflowSource);
  add("workflow", "workflow_field_required", "待外业候选", workflow.field_required, "条", "当前状态为需外业的候选数；已核查记录单列，不重复纳入待办。", workflow.field_required, null, workflowTime, workflowSource);
  add("workflow", "workflow_verified", "已核查", workflow.verified, "条", "当前状态为已核查的记录数；仅表示核查完成，不代表道路数据已发布。", workflow.verified, null, workflowTime, workflowSource);
  const selectedCount = route ? new Set(route.selectedCandidateIds).size : null;
  add("route", "route_selected_candidates", "计划核查点", selectedCount, "个", "当前方案纳入的去重候选点数；不包含起点和终点。", selectedCount, null, routeTime, routeSource);
  add("route", "route_distance_km", "计划驾车里程", route ? nonnegative(route.totalDistanceMeters) === null ? null : route.totalDistanceMeters / 1000 : null, "km", "当前方案所有驾车路段的距离总和。", route ? nonnegative(route.totalDistanceMeters) : null, 1000, routeTime, routeSource);
  add("route", "route_total_minutes", "计划总时长", route ? nonnegative(route.totalMinutes) : null, "min", "当前方案驾车时长与核查停留时长之和。", route ? nonnegative(route.totalMinutes) : null, null, routeTime, routeSource);
  // The offline optimizer computes its baseline from selectedCandidateIds in input order.
  // Comparing to all requested candidates would falsely count dropped stops as an optimization gain.
  const comparable = route?.mode === "offline_demo" && route.status === "ready" ? route : null;
  const baselineMinutes = comparable ? nonnegative(comparable.baselineDrivingMinutes) : null;
  const baselineDistance = comparable ? nonnegative(comparable.baselineDistanceMeters) : null;
  const savedMinutes = comparable && baselineMinutes !== null && nonnegative(comparable.drivingMinutes) !== null ? baselineMinutes - comparable.drivingMinutes : null;
  const savedDistance = comparable && baselineDistance !== null && nonnegative(comparable.totalDistanceMeters) !== null ? baselineDistance - comparable.totalDistanceMeters : null;
  add("route", "route_time_saved_minutes", "同点集顺序节时", savedMinutes, "min", "相同起终点、相同已选候选集合：输入顺序驾车分钟数 − 优化顺序驾车分钟数；不计删点或停留时间。实时/回放无匹配基线时为空。", savedMinutes, null, routeTime, routeSource);
  add("route", "route_time_saved_rate", "同点集节时率", percentage(savedMinutes, baselineMinutes), "%", "同点集顺序节约的驾车分钟数 ÷ 同点集输入顺序驾车分钟数；基线为零时为空。", savedMinutes, baselineMinutes, routeTime, routeSource);
  add("route", "route_distance_saved_meters", "同点集里程变化", savedDistance, "m", "同点集输入顺序里程 − 优化顺序里程；保留负值，按时间优化不承诺距离也减少。", savedDistance, null, routeTime, routeSource);
  add("api", "api_live_attempts", "实时规划尝试", nonnegative(session.liveAttempts), "次", "本面板人工提交到本地实时规划接口的次数；不是滴图计费调用数。", nonnegative(session.liveAttempts), null, sessionTime, sessionSource);
  add("api", "api_live_successes", "实时规划成功", nonnegative(session.liveSuccesses), "次", "返回有效真实驾车方案的次数，含真实缓存命中；不含本地回放。", nonnegative(session.liveSuccesses), null, sessionTime, sessionSource);
  add("api", "api_failed_attempts", "实时规划失败", nonnegative(session.failedAttempts), "次", "人工实时规划尝试中失败的次数；失败不自动重试。", nonnegative(session.failedAttempts), null, sessionTime, sessionSource);
  const upstream = session.usageObservations > 0 ? nonnegative(session.observedUpstreamRequests) : null;
  add("api", "api_upstream_requests", "已观测上游请求", upstream, "次", "仅累加真实服务响应或结构化错误中明确报告的上游请求数；无观测时为空，未知失败可能未计入，不等于账户计费量。", upstream, session.usageObservations, sessionTime, "真实代理响应的 usage.upstreamRequests；以控制台核对为准");
  add("api", "api_cache_hit_rate", "真实缓存命中率", percentage(nonnegative(session.cacheHits), nonnegative(session.liveSuccesses)), "%", "真实服务缓存命中次数 ÷ 返回有效真实方案次数；失败和本地契约回放不进入分母。", nonnegative(session.cacheHits), nonnegative(session.liveSuccesses), sessionTime, sessionSource);
  const usage = session.latestUsage;
  const validUsage = usage && [usage.dailyBudget, usage.dailyUsed, usage.dailyRemaining].every(value => nonnegative(value) !== null) && usage.dailyRemaining === Math.max(0, usage.dailyBudget - usage.dailyUsed) ? usage : null;
  add("api", "api_budget_remaining", "本地日预算剩余", validUsage?.dailyRemaining ?? null, "次", "最近真实代理返回的本地日预算剩余；不是滴图账户余额，无真实预算快照时为空。", validUsage?.dailyRemaining ?? null, validUsage?.dailyBudget ?? null, validUsage ? `服务端当日快照，观测于 ${validUsage.observedAt}` : "尚未观测到真实服务端预算", "真实代理日预算快照；可能随服务进程重启而重置");
  add("api", "api_replay_loads", "本地回放加载", nonnegative(session.replayLoads), "次", "本面板加载固定契约回放的次数；不消耗滴图额度，也不计入真实缓存命中率。", nonnegative(session.replayLoads), null, sessionTime, "本地固定回放文件");
  return {
    schemaVersion: "roadops-metrics-v1",
    generatedAt: [...workflowTimes, session.updatedAt, ...(route && "generatedAt" in route ? [route.generatedAt] : [])].sort().at(-1)!,
    lineage: { datasetId: report.datasetId, qualitySchemaVersion: report.schemaVersion, ruleVersion: report.ruleVersion, qualityGeneratedAt: report.generatedAt, workflowSchemaVersion: "roadops-workflow-v1", routeSchemaVersion: route?.schemaVersion ?? null, routeMode: route?.mode ?? null, routeFixtureId: route ? "fixtureId" in route ? route.fixtureId : route.map.fixtureId : null, sessionStartedAt: session.startedAt, lastUsageObservedAt: validUsage?.observedAt ?? null },
    workflow,
    metrics,
    limitations: ["质量指标来自规则候选，不代表权威质量结论。", "审核漏斗显示当前状态，不表示历史逐级转化率。", "顺序收益只在同点集离线基线上计算，不宣称真实业务收益。", "会话调用计数与服务端预算的时间范围不同；滴图控制台计费量尚需独立核对。", "聚合导出不包含坐标、审核理由、人工备注、证据明细或服务密钥。"],
  };
}

// Select aggregate fields explicitly so future additions cannot silently export raw records.
const exportSnapshot = (snapshot: RoadOpsMetricsSnapshot): RoadOpsMetricsSnapshot => ({
  schemaVersion: snapshot.schemaVersion,
  generatedAt: snapshot.generatedAt,
  lineage: {
    datasetId: snapshot.lineage.datasetId, qualitySchemaVersion: snapshot.lineage.qualitySchemaVersion, ruleVersion: snapshot.lineage.ruleVersion, qualityGeneratedAt: snapshot.lineage.qualityGeneratedAt,
    workflowSchemaVersion: snapshot.lineage.workflowSchemaVersion, routeSchemaVersion: snapshot.lineage.routeSchemaVersion, routeMode: snapshot.lineage.routeMode,
    routeFixtureId: snapshot.lineage.routeFixtureId, sessionStartedAt: snapshot.lineage.sessionStartedAt, lastUsageObservedAt: snapshot.lineage.lastUsageObservedAt,
  },
  workflow: Object.fromEntries(ROAD_WORK_ORDER_STATUSES.map(status => [status, snapshot.workflow[status]])) as Record<RoadWorkOrderStatus, number>,
  metrics: snapshot.metrics.map(({ id, group, label, value, unit, definition, numerator, denominator, timeRange, source }) => ({ id, group, label, value, unit, definition, numerator, denominator, timeRange, source })),
  limitations: [...snapshot.limitations],
});

export function roadOpsMetricsJson(snapshot: RoadOpsMetricsSnapshot): string {
  return JSON.stringify(exportSnapshot(snapshot), null, 2) + "\n";
}

export function roadOpsMetricsCsv(snapshot: RoadOpsMetricsSnapshot): string {
  const safeCell = (value: unknown) => {
    const text = String(value ?? "");
    const safe = typeof value === "string" && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const headers = ["schema_version", "dataset_id", "rule_version", "quality_generated_at", "route_mode", "route_fixture_id", "session_started_at", "snapshot_at", "metric_id", "group", "label", "value", "unit", "definition", "numerator", "denominator", "time_range", "source"];
  const rows = exportSnapshot(snapshot).metrics.map(metric => [snapshot.schemaVersion, snapshot.lineage.datasetId, snapshot.lineage.ruleVersion, snapshot.lineage.qualityGeneratedAt, snapshot.lineage.routeMode, snapshot.lineage.routeFixtureId, snapshot.lineage.sessionStartedAt, snapshot.generatedAt, metric.id, metric.group, metric.label, metric.value, metric.unit, metric.definition, metric.numerator, metric.denominator, metric.timeRange, metric.source]);
  return [headers, ...rows].map(row => row.map(safeCell).join(",")).join("\r\n") + "\r\n";
}
