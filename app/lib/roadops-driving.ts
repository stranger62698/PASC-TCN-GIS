import type { Position } from "./gis-layer";
import type { RoadOpsRouteExclusion, RoadOpsRouteMapPlan } from "./roadops-route";

export type RoadOpsDrivingPoint = {
  id: string;
  name: string;
  coordinate: Position;
  role: "origin" | "destination" | "candidate";
  dwellMinutes: number;
  inspectionValue: number;
  required: boolean;
  sourceFeatureId: string | null;
  sourceRoadName: string;
};

export type RoadOpsPlanningGoal = "time" | "distance" | "coverage" | "priority";
export type RoadOpsFieldRoutingTask = {
  /** Transport aliases only; descriptions, evidence and original task IDs stay local. */
  taskId: string;
  pointId: string;
  dwellSeconds: number;
  required: boolean;
  priority: "high" | "medium" | "low";
  eligible?: boolean;
  ineligibleReason?: string;
  ineligibleReasonCode?: "access_blocked" | "input_incomplete";
};
export type RoadOpsDeferredTask = {
  taskId: string;
  reason: "time_budget" | "unreachable" | "access_blocked" | "input_incomplete";
  detail: string;
};
export type RoadOpsTaskSelection = {
  selectedTaskIds: string[];
  deferredTasks: RoadOpsDeferredTask[];
  dwellSeconds: number;
  bufferSeconds: number;
  workBudgetSeconds: number;
  drivingBudgetSeconds: number;
};

export type RoadOpsDrivingRequest = {
  schemaVersion: "roadops-driving-request-v1";
  startId: string;
  endId: string;
  returnToStart: boolean;
  workMinutes: number;
  strategy: "1" | "2" | "5" | "11" | "13";
  /** input follows every candidate in array order; omitted preserves legacy optimization. */
  orderMode?: "input" | "optimize";
  /** Field mode obtains a separate provider polyline for every consecutive stop pair. */
  detailMode?: "field";
  /** Independent task objective; road strategy still controls the provider's roads. */
  planningGoal?: RoadOpsPlanningGoal;
  /** Exact available driving seconds, including zero and budgets below 30 minutes. */
  drivingBudgetSeconds?: number;
  bufferSeconds?: number;
  fieldTasks?: RoadOpsFieldRoutingTask[];
  points: RoadOpsDrivingPoint[];
};

export type RoadOpsDrivingLeg = {
  id: string;
  index: number;
  fromId: string;
  toId: string;
  distanceMeters: number;
  durationSeconds: number;
  coordinates: Position[];
  bounds: [number, number, number, number];
  traffic: Array<{ status: 0 | 1 | 2 | 3 | 4; distanceMeters: number; startIndex: number; endIndex: number }>;
  tollsYuan: number | null;
  tag: string | null;
};

export type RoadOpsDrivingAccess = {
  pointId: string;
  coordinate: Position;
  roadCoordinate: Position;
  offsetMeters: number;
  status: "near_route" | "far_from_route";
  thresholdMeters: 50;
};

export type RoadOpsFieldDetail = {
  schemaVersion: "roadops-field-detail-v1";
  guidance: "geometry_only";
  legs: RoadOpsDrivingLeg[];
  access: RoadOpsDrivingAccess[];
  /** Attempted route packs, not provider billable units; zero for cached results. */
  routePackCount: number;
  limitations: string[];
};

export type RoadOpsDrivingUsage = {
  budgetScope?: "shared" | "process";
  cached: boolean;
  upstreamRequests: number;
  dailyUsed: number;
  dailyBudget: number;
  dailyRemaining: number;
  perIdentityUsed: number;
  perIdentityLimit: number;
};

export type RoadOpsDrivingPlan = {
  schemaVersion: "roadops-driving-plan-v1";
  provider: "didi_web_service" | "didi_contract_replay";
  mode: "didi_live" | "didi_replay";
  generatedAt: string;
  inputFingerprint: string;
  /** Optional only for legacy/offline fixtures; live request binding requires this echo. */
  planning?: RoadOpsDrivingPlanning;
  status: "ready" | "infeasible";
  stopOrder: string[];
  selectedCandidateIds: string[];
  excluded: RoadOpsRouteExclusion[];
  totalDistanceMeters: number;
  drivingMinutes: number;
  /** Raw provider seconds, before display rounding. */
  drivingDurationSeconds?: number;
  dwellMinutes: number;
  totalMinutes: number;
  workMinutes: number;
  overtimeMinutes: number;
  map: RoadOpsRouteMapPlan;
  usage: RoadOpsDrivingUsage;
  field?: RoadOpsFieldDetail;
  taskSelection?: RoadOpsTaskSelection;
  boundary: string;
};

export type RoadOpsDrivingPlanning = {
  requestedStrategy: RoadOpsDrivingRequest["strategy"];
  orderMode: "input" | "optimize";
  orderingObjective: "input_order" | "duration" | "distance";
  planningGoal?: RoadOpsPlanningGoal;
  drivingBudgetSeconds?: number;
  bufferSeconds?: number;
  fieldTasks?: RoadOpsFieldRoutingTask[];
};

export function roadOpsPlanningForRequest(request: RoadOpsDrivingRequest): RoadOpsDrivingPlanning {
  const orderMode = request.orderMode ?? "optimize";
  const objective = request.planningGoal ? request.planningGoal === "distance" ? "distance" : "duration" : request.strategy === "5" ? "distance" : "duration";
  return {
    requestedStrategy: request.strategy, orderMode, orderingObjective: orderMode === "input" ? "input_order" : objective,
    ...(request.planningGoal !== undefined ? { planningGoal: request.planningGoal } : {}),
    ...(request.drivingBudgetSeconds !== undefined ? { drivingBudgetSeconds: request.drivingBudgetSeconds } : {}),
    ...(request.bufferSeconds !== undefined ? { bufferSeconds: request.bufferSeconds } : {}),
    ...(request.fieldTasks !== undefined ? { fieldTasks: request.fieldTasks.map(task => ({ taskId: task.taskId, pointId: task.pointId, dwellSeconds: task.dwellSeconds, required: task.required, priority: task.priority, ...(task.eligible !== undefined ? { eligible: task.eligible } : {}), ...(task.ineligibleReason !== undefined ? { ineligibleReason: task.ineligibleReason } : {}), ...(task.ineligibleReasonCode !== undefined ? { ineligibleReasonCode: task.ineligibleReasonCode } : {}) })) } : {}),
  };
}

export function assertRoadOpsPlanningMatches(plan: RoadOpsDrivingPlan, request: RoadOpsDrivingRequest): void {
  const expected = roadOpsPlanningForRequest(request);
  const actualTasks = plan.planning?.fieldTasks === undefined ? undefined : roadOpsPlanningForRequest({ ...request, fieldTasks: plan.planning.fieldTasks }).fieldTasks;
  if (!plan.planning || plan.planning.requestedStrategy !== expected.requestedStrategy || plan.planning.orderMode !== expected.orderMode || plan.planning.orderingObjective !== expected.orderingObjective || plan.planning.planningGoal !== expected.planningGoal || plan.planning.drivingBudgetSeconds !== expected.drivingBudgetSeconds || plan.planning.bufferSeconds !== expected.bufferSeconds || JSON.stringify(actualTasks) !== JSON.stringify(expected.fieldTasks)) {
    throw new Error("返回方案的驾车策略或站点排序目标与本次请求不一致；未展示旧策略结果，请更新路线服务后手动重算。");
  }
  if (request.fieldTasks !== undefined) {
    const selection = plan.taskSelection, tasks = request.fieldTasks;
    const invalid = () => { throw new Error("返回方案的执行任务、延期原因或完整工时预算与本次请求不一致。"); };
    if (!selection || !Array.isArray(selection.selectedTaskIds) || !Array.isArray(selection.deferredTasks)) return invalid();
    const allIds = [...selection.selectedTaskIds, ...selection.deferredTasks.map(task => task.taskId)];
    if (new Set(allIds).size !== tasks.length || allIds.length !== tasks.length || allIds.some(id => !tasks.some(task => task.taskId === id))) return invalid();
    const selected = tasks.filter(task => selection.selectedTaskIds.includes(task.taskId));
    const variable = request.planningGoal === "coverage" || request.planningGoal === "priority";
    if (tasks.some(task => (task.required || !variable) && !selection.selectedTaskIds.includes(task.taskId)) || selected.some(task => task.eligible === false || !plan.stopOrder.includes(task.pointId))) return invalid();
    const dwell = selected.reduce((sum, task) => sum + task.dwellSeconds, 0), buffer = request.bufferSeconds ?? 0, work = request.workMinutes * 60;
    const driving = Math.max(0, Math.min(request.drivingBudgetSeconds ?? work, work - dwell - buffer));
    if (Math.abs(selection.dwellSeconds - dwell) > 1e-6 || selection.bufferSeconds !== buffer || selection.workBudgetSeconds !== work || Math.abs(selection.drivingBudgetSeconds - driving) > 1e-6) return invalid();
    if (selection.deferredTasks.some(deferred => {
      const task = tasks.find(input => input.taskId === deferred.taskId)!;
      return typeof deferred.detail !== "string" || !deferred.detail.trim() || !["time_budget", "unreachable", "access_blocked", "input_incomplete"].includes(deferred.reason) || task.eligible === false && deferred.reason !== (task.ineligibleReasonCode ?? "access_blocked");
    })) return invalid();
  }
}

export type RoadOpsDrivingErrorBody = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    fallbackAvailable: boolean;
    usage?: Partial<RoadOpsDrivingUsage>;
  };
};

const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const validPosition = (value: unknown): value is Position => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function validateFieldDetail(plan: RoadOpsDrivingPlan) {
  const field = plan.field;
  if (!field) return;
  const invalid = () => { throw new Error("外业分段路线或可达性响应无效。"); };
  if (field.schemaVersion !== "roadops-field-detail-v1" || field.guidance !== "geometry_only" || !Array.isArray(field.legs) || field.legs.length !== plan.stopOrder.length - 1 || !Array.isArray(field.access) || !Array.isArray(field.limitations) || !field.limitations.every(item => typeof item === "string") || !Number.isInteger(field.routePackCount) || field.routePackCount < 0) invalid();
  const ids = new Set<string>();
  field.legs.forEach((leg, index) => {
    if (!leg || typeof leg.id !== "string" || !leg.id || ids.has(leg.id) || leg.index !== index + 1 || leg.fromId !== plan.stopOrder[index] || leg.toId !== plan.stopOrder[index + 1] || !nonnegative(leg.distanceMeters) || !nonnegative(leg.durationSeconds) || !Array.isArray(leg.coordinates) || leg.coordinates.length < 2 || !leg.coordinates.every(validPosition) || !Array.isArray(leg.bounds) || leg.bounds.length !== 4 || !leg.bounds.every(finite) || leg.bounds[0] > leg.bounds[2] || leg.bounds[1] > leg.bounds[3] || !Array.isArray(leg.traffic) || (leg.tollsYuan !== null && !nonnegative(leg.tollsYuan)) || (leg.tag !== null && typeof leg.tag !== "string")) invalid();
    ids.add(leg.id);
    if (!leg.coordinates.some(point => point[0] !== leg.coordinates[0][0] || point[1] !== leg.coordinates[0][1])) invalid();
    leg.traffic.forEach(segment => {
      if (!segment || !Number.isInteger(segment.status) || segment.status < 0 || segment.status > 4 || !nonnegative(segment.distanceMeters) || !Number.isInteger(segment.startIndex) || !Number.isInteger(segment.endIndex) || segment.startIndex < 0 || segment.endIndex < segment.startIndex || segment.endIndex >= leg.coordinates.length) invalid();
    });
    const feature = plan.map.features[index];
    if (!feature || feature.id !== leg.id || feature.properties?.legIndex !== leg.index || feature.properties?.from !== leg.fromId || feature.properties?.to !== leg.toId || feature.geometry?.type !== "LineString" || JSON.stringify(feature.geometry.coordinates) !== JSON.stringify(leg.coordinates)) invalid();
  });
  if (plan.map.features.length !== field.legs.length || Math.abs(field.legs.reduce((sum, leg) => sum + leg.distanceMeters, 0) - plan.totalDistanceMeters) > 1 || Math.abs(field.legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) / 60 - plan.drivingMinutes) > 0.051) invalid();
  const stopIds = new Set(plan.stopOrder), accessIds = new Set<string>();
  field.access.forEach(access => {
    if (!access || !stopIds.has(access.pointId) || accessIds.has(access.pointId) || !validPosition(access.coordinate) || !validPosition(access.roadCoordinate) || !nonnegative(access.offsetMeters) || access.thresholdMeters !== 50 || access.status !== (access.offsetMeters > access.thresholdMeters ? "far_from_route" : "near_route")) invalid();
    accessIds.add(access.pointId);
  });
  if (accessIds.size !== stopIds.size) invalid();
}

export function parseRoadOpsDrivingPlan(value: unknown): RoadOpsDrivingPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("实时驾车路线响应为空。");
  const plan = value as Partial<RoadOpsDrivingPlan>;
  if (plan.schemaVersion !== "roadops-driving-plan-v1" || (plan.mode !== "didi_live" && plan.mode !== "didi_replay")) throw new Error("实时驾车路线响应版本不受支持。");
  if (!Array.isArray(plan.stopOrder) || plan.stopOrder.length < 2 || !Array.isArray(plan.selectedCandidateIds) || !Array.isArray(plan.excluded)) throw new Error("实时驾车路线顺序无效。");
  if (!finite(plan.totalDistanceMeters) || !finite(plan.drivingMinutes) || !finite(plan.totalMinutes) || !plan.map || !Array.isArray(plan.map.stops) || !Array.isArray(plan.map.features)) throw new Error("实时驾车路线指标或几何无效。");
  if (!plan.usage || typeof plan.usage.cached !== "boolean" || !finite(plan.usage.dailyRemaining)) throw new Error("实时驾车路线用量信息无效。");
  if (plan.planning !== undefined) {
    const echo = plan.planning;
    const objective = echo?.planningGoal ? echo.planningGoal === "distance" ? "distance" : "duration" : echo?.requestedStrategy === "5" ? "distance" : "duration";
    if (!echo || typeof echo !== "object" || Array.isArray(echo) || !["1", "2", "5", "11", "13"].includes(echo.requestedStrategy) || !["input", "optimize"].includes(echo.orderMode) || echo.orderingObjective !== (echo.orderMode === "input" ? "input_order" : objective) || echo.planningGoal !== undefined && !["time", "distance", "coverage", "priority"].includes(echo.planningGoal) || echo.drivingBudgetSeconds !== undefined && !nonnegative(echo.drivingBudgetSeconds) || echo.bufferSeconds !== undefined && !nonnegative(echo.bufferSeconds)) throw new Error("实时驾车路线策略回显无效。");
    if (echo.fieldTasks !== undefined && (!Array.isArray(echo.fieldTasks) || echo.fieldTasks.length > 20 || new Set(echo.fieldTasks.map(task => task?.taskId)).size !== echo.fieldTasks.length || echo.fieldTasks.some(task => !task || typeof task.taskId !== "string" || !task.taskId || typeof task.pointId !== "string" || !task.pointId || !nonnegative(task.dwellSeconds) || typeof task.required !== "boolean" || !["high", "medium", "low"].includes(task.priority) || task.eligible !== undefined && typeof task.eligible !== "boolean" || task.ineligibleReasonCode !== undefined && !["access_blocked", "input_incomplete"].includes(task.ineligibleReasonCode)))) throw new Error("实时驾车路线任务回显无效。");
  }
  if (plan.taskSelection !== undefined) {
    const selection = plan.taskSelection;
    if (!selection || typeof selection !== "object" || !Array.isArray(selection.selectedTaskIds) || !selection.selectedTaskIds.every(id => typeof id === "string") || new Set(selection.selectedTaskIds).size !== selection.selectedTaskIds.length || !Array.isArray(selection.deferredTasks) || selection.deferredTasks.some(task => !task || typeof task.taskId !== "string" || !["time_budget", "unreachable", "access_blocked", "input_incomplete"].includes(task.reason) || typeof task.detail !== "string") || ![selection.dwellSeconds, selection.bufferSeconds, selection.workBudgetSeconds, selection.drivingBudgetSeconds].every(nonnegative)) throw new Error("实时驾车路线任务选择无效。");
    const deferredIds = selection.deferredTasks.map(task => task.taskId);
    if (new Set(deferredIds).size !== deferredIds.length || deferredIds.some(id => selection.selectedTaskIds.includes(id))) throw new Error("实时驾车路线任务选择重复。");
  }
  if (plan.drivingDurationSeconds !== undefined && (!nonnegative(plan.drivingDurationSeconds) || Math.abs(plan.drivingDurationSeconds / 60 - plan.drivingMinutes!) > 0.051)) throw new Error("实时驾车路线精确耗时无效。");
  if (plan.field !== undefined) {
    if (!plan.field || typeof plan.field !== "object" || Array.isArray(plan.field)) throw new Error("外业分段路线响应无效。");
    validateFieldDetail(plan as RoadOpsDrivingPlan);
    if (plan.drivingDurationSeconds !== undefined && Math.abs(plan.field.legs.reduce((sum, leg) => sum + leg.durationSeconds, 0) - plan.drivingDurationSeconds) > 1) throw new Error("实时驾车路线精确耗时与分段不一致。");
  }
  return plan as RoadOpsDrivingPlan;
}

export function roadOpsDrivingError(value: unknown, fallback: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const message = (value as RoadOpsDrivingErrorBody).error?.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

/** A static SPA fallback or proxy error page is not a driving-service response. */
export async function readRoadOpsDrivingResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (contentType !== "application/json" && !/^application\/[\w.+-]+\+json$/.test(contentType)) {
    throw new Error(contentType === "text/html" || contentType === "application/xhtml+xml"
      ? `路线服务接口返回了网页（HTTP ${response.status}）。当前站点可能仅启动了静态预览或 API 转发未连接；请接通当前站点的驾车 API 服务后手动重试，点位已保留。`
      : `路线服务接口未返回 JSON（HTTP ${response.status}）。请检查当前站点的驾车 API 连接后手动重试，点位已保留。`);
  }
  try { return await response.json(); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`路线服务返回的 JSON 无法解析（HTTP ${response.status}）。请检查驾车 API 响应后手动重试，点位已保留。`);
  }
}

export function roadOpsUsageLabel(usage: RoadOpsDrivingUsage): string {
  return usage.budgetScope === "shared"
    ? `本站共享当日计数 ${usage.dailyUsed}/${usage.dailyBudget} · 当前账号 ${usage.perIdentityUsed}/${usage.perIdentityLimit}（HTTP保护计数，非滴图账单）`
    : `本进程当日计数 ${usage.dailyUsed}/${usage.dailyBudget}（重启重置，非持久配额，不是账号余额/计费账单）`;
}
