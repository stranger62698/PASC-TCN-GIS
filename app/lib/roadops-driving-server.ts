import { createHash } from "node:crypto";
import type { Position } from "./gis-layer";
import type { RoadOpsDrivingAccess, RoadOpsDrivingLeg, RoadOpsDrivingPlan, RoadOpsDrivingPoint, RoadOpsDrivingRequest, RoadOpsDrivingUsage, RoadOpsFieldDetail, RoadOpsFieldRoutingTask, RoadOpsTaskSelection } from "./roadops-driving";
import { roadOpsPlanningForRequest } from "./roadops-driving.js";
import { optimizeRoadOpsRoute, solveRoadOpsPersonalizedRoute, RoadOpsPersonalizedRouteError, type RoadOpsRouteFixture, type RoadOpsRouteLegFeature, type RoadOpsRouteMapPlan, type RoadOpsRoutePlan } from "./roadops-route.js";
import { SharedQuotaError } from "./roadops-shared-quota.js";

export const ROADOPS_DRIVING_MAX_BODY_BYTES = 48_000;
export const ROADOPS_DRIVING_TIMEOUT_MS = 15_000;
const DIDI_CONVERT_URL = "https://lbs.xiaojukeji.com/api/v2/convert";
const DIDI_ROUTE_URL = "https://lbs.xiaojukeji.com/api/v2/routeplanv3";

type RuntimeEnv = Record<string, string | undefined>;
type FetchLike = typeof fetch;
type DidiGeo = { lng: number; lat: number };
type DidiRoute = { dist?: unknown; duration?: unknown; geo_list?: unknown; segments?: unknown; cost?: unknown; tag?: unknown };
type DidiResult = { errcode?: unknown; errmsg?: unknown; routes?: unknown };
type DidiResponse = { status?: unknown; msg?: unknown; results?: unknown };
type CacheEntry = { expiresAt: number; plan: RoadOpsDrivingPlan };
type SharedQuotaLease = { beforeAttempt(): Promise<void>; close(): Promise<void> };
export type RoadOpsSharedQuota = {
  reserve(identity: string, requests: number): Promise<SharedQuotaLease>;
  usage(identity: string): Promise<RoadOpsDrivingUsage>;
};
type RequestCounter = { upstreamRequests: number; lease?: SharedQuotaLease; lastUsage?: RoadOpsDrivingUsage };

export class RoadOpsDrivingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable = false,
    public readonly usage?: Partial<RoadOpsDrivingUsage>,
  ) {
    super(message);
    this.name = "RoadOpsDrivingError";
  }
}

export type RoadOpsDrivingService = {
  plan: (value: unknown, identity: string, signal?: AbortSignal) => Promise<RoadOpsDrivingPlan>;
  usage: (identity: string) => RoadOpsDrivingUsage;
};

type ServiceOptions = {
  env?: RuntimeEnv;
  fetchImpl?: FetchLike;
  now?: () => number;
  minimumUpstreamGapMs?: number;
  sharedQuota?: RoadOpsSharedQuota;
  requireSharedQuota?: boolean;
  // Explicit local-restart carry-over only. Remote environment defaults do not
  // load this value, and no running service can reset its counters through it.
  initialUsage?: { date: string; used: number; identity: string };
};

const numberFromEnv = (value: string | undefined, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, Math.floor(parsed))) : fallback;
};
const rounded = (value: number, digits = 6) => Number(value.toFixed(digits));
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const boundedText = (value: unknown, field: string, maximum: number) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `${field} 无效。`, 422);
  return value.trim();
};
const safeId = (value: unknown, field: string) => {
  const id = boundedText(value, field, 80);
  if (!/^[a-zA-Z0-9._:/#-]+$/.test(id)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `${field} 含不支持的字符。`, 422);
  return id;
};
const sameOrigin = (origin: string, host: string) => {
  if (!origin) return true;
  try { return new URL(origin).host === host; }
  catch { return false; }
};
// The local budget resets at midnight in Asia/Shanghai. It counts this process's
// HTTP attempts, not the provider's billable units or account-wide quota.
const dateKey = (milliseconds: number) => new Date(milliseconds + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 20);
const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
const inChina = ([longitude, latitude]: Position) => longitude >= 72.004 && longitude <= 137.8347 && latitude >= 0.8293 && latitude <= 55.8271;

const transformLatitude = (longitude: number, latitude: number) => {
  let result = -100 + 2 * longitude + 3 * latitude + 0.2 * latitude * latitude + 0.1 * longitude * latitude + 0.2 * Math.sqrt(Math.abs(longitude));
  result += (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3;
  result += (20 * Math.sin(latitude * Math.PI) + 40 * Math.sin(latitude / 3 * Math.PI)) * 2 / 3;
  return result + (160 * Math.sin(latitude / 12 * Math.PI) + 320 * Math.sin(latitude * Math.PI / 30)) * 2 / 3;
};
const transformLongitude = (longitude: number, latitude: number) => {
  let result = 300 + longitude + 2 * latitude + 0.1 * longitude * longitude + 0.1 * longitude * latitude + 0.1 * Math.sqrt(Math.abs(longitude));
  result += (20 * Math.sin(6 * longitude * Math.PI) + 20 * Math.sin(2 * longitude * Math.PI)) * 2 / 3;
  result += (20 * Math.sin(longitude * Math.PI) + 40 * Math.sin(longitude / 3 * Math.PI)) * 2 / 3;
  return result + (150 * Math.sin(longitude / 12 * Math.PI) + 300 * Math.sin(longitude / 30 * Math.PI)) * 2 / 3;
};

// 滴图坐标转换接口以 coordsys=gps 接收 WGS84，并返回国内地图可用坐标。
// 路线折线回到 Leaflet/OSM 前，仅在这一服务端边界做 GCJ-02 近似反算。
export function gcj02ToWgs84(coordinate: Position): Position {
  if (!inChina(coordinate)) return coordinate;
  const [longitude, latitude] = coordinate;
  const a = 6378245, eccentricity = 0.006693421622965943;
  let deltaLatitude = transformLatitude(longitude - 105, latitude - 35);
  let deltaLongitude = transformLongitude(longitude - 105, latitude - 35);
  const radLatitude = latitude / 180 * Math.PI;
  const magic = 1 - eccentricity * Math.sin(radLatitude) * Math.sin(radLatitude);
  const sqrtMagic = Math.sqrt(magic);
  deltaLatitude = deltaLatitude * 180 / ((a * (1 - eccentricity)) / (magic * sqrtMagic) * Math.PI);
  deltaLongitude = deltaLongitude * 180 / (a / sqrtMagic * Math.cos(radLatitude) * Math.PI);
  return [rounded(longitude * 2 - (longitude + deltaLongitude)), rounded(latitude * 2 - (latitude + deltaLatitude))];
}

export function sanitizeRoadOpsDrivingRequest(value: unknown, maximumMatrixPoints = 8, maximumCandidates = 10): RoadOpsDrivingRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "驾车规划请求必须是 JSON 对象。", 422);
  const input = value as Partial<RoadOpsDrivingRequest>;
  const personalized = input.planningGoal !== undefined || input.drivingBudgetSeconds !== undefined || input.bufferSeconds !== undefined || input.fieldTasks !== undefined;
  if (input.schemaVersion !== "roadops-driving-request-v1") throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "驾车规划请求版本不受支持。", 422);
  const startId = safeId(input.startId, "startId"), endId = input.returnToStart === true ? startId : safeId(input.endId, "endId");
  if (input.orderMode !== undefined && input.orderMode !== "input" && input.orderMode !== "optimize") throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "途经点顺序模式无效。", 422);
  if (input.detailMode !== undefined && input.detailMode !== "field") throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "路线明细模式无效。", 422);
  if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > maximumMatrixPoints) throw new RoadOpsDrivingError("ROADOPS_DIDI_POINT_LIMIT", `规划点数必须为 2—${maximumMatrixPoints}。`, 422);
  const ids = new Set<string>();
  const points = input.points.map((raw, index): RoadOpsDrivingPoint => {
    if (!raw || typeof raw !== "object") throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `points[${index}] 无效。`, 422);
    const point = raw as Partial<RoadOpsDrivingPoint>, id = safeId(point.id, `points[${index}].id`);
    if (ids.has(id)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `点位 ${id} 重复。`, 422);
    ids.add(id);
    if (!Array.isArray(point.coordinate) || point.coordinate.length < 2 || !finite(point.coordinate[0]) || !finite(point.coordinate[1]) || point.coordinate[0] < -180 || point.coordinate[0] > 180 || point.coordinate[1] < -90 || point.coordinate[1] > 90) throw new RoadOpsDrivingError("ROADOPS_DIDI_COORDINATE_INVALID", `点位 ${id} 的 WGS84 坐标无效。`, 422);
    if (point.role !== "origin" && point.role !== "destination" && point.role !== "candidate") throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `点位 ${id} 的角色无效。`, 422);
    const dwellMinutes = finite(point.dwellMinutes) ? personalized ? point.dwellMinutes : Math.round(point.dwellMinutes) : NaN;
    const inspectionValue = finite(point.inspectionValue) ? point.inspectionValue : NaN;
    if (!finite(dwellMinutes) || !personalized && !Number.isInteger(dwellMinutes) || dwellMinutes < 0 || dwellMinutes > 180 || !finite(inspectionValue) || inspectionValue < 0 || inspectionValue > 100) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `点位 ${id} 的停留时间或价值无效。`, 422);
    return {
      id,
      name: boundedText(point.name, `points[${index}].name`, 100),
      coordinate: [rounded(point.coordinate[0]), rounded(point.coordinate[1])],
      role: point.role,
      dwellMinutes,
      inspectionValue: rounded(inspectionValue, 2),
      required: point.required === true,
      sourceFeatureId: point.sourceFeatureId == null ? null : boundedText(point.sourceFeatureId, `points[${index}].sourceFeatureId`, 120),
      sourceRoadName: typeof point.sourceRoadName === "string" && point.sourceRoadName.trim() ? point.sourceRoadName.trim().slice(0, 120) : "道路名称待核实",
    };
  });
  if (!ids.has(startId) || !ids.has(endId)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "起点或终点不在点位列表中。", 422);
  if (startId === endId && input.returnToStart !== true) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "起终点相同时请启用返回起点。", 422);
  const coordinates = new Map<string, string>();
  for (const point of points) {
    const expectedRole = point.id === startId ? "origin" : point.id === endId ? "destination" : "candidate";
    if (point.role !== expectedRole) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `点位 ${point.id} 的角色与起终点设置不一致。`, 422);
    const coordinateKey = point.coordinate.join(",");
    if (coordinates.has(coordinateKey)) throw new RoadOpsDrivingError("ROADOPS_DIDI_DUPLICATE_POINT", "存在重合点位，请删除重复途经点；如需往返，请启用返回起点。", 422);
    coordinates.set(coordinateKey, point.id);
  }
  if (points.filter(point => point.role === "candidate").length > maximumCandidates) throw new RoadOpsDrivingError("ROADOPS_DIDI_CANDIDATE_LIMIT", `候选点不能超过 ${maximumCandidates} 个。`, 422);
  if (!finite(input.workMinutes) || input.workMinutes < 30 || input.workMinutes > 720) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "工作时长必须为 30—720 分钟。", 422);
  const strategies = new Set(["1", "2", "5", "11", "13"]);
  if (typeof input.strategy !== "string" || !strategies.has(input.strategy)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "驾车策略无效。", 422);
  if (input.planningGoal !== undefined && !["time", "distance", "coverage", "priority"].includes(input.planningGoal)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "核查规划目标无效。", 422);
  for (const [name, value] of [["drivingBudgetSeconds", input.drivingBudgetSeconds], ["bufferSeconds", input.bufferSeconds]] as const) if (value !== undefined && (!finite(value) || value < 0 || value > input.workMinutes * 60)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `${name} 必须是完整工时内的非负秒数。`, 422);
  if (personalized && points.filter(point => point.role === "candidate").length > 6) throw new RoadOpsDrivingError("ROADOPS_DIDI_CANDIDATE_LIMIT", "个性化规划最多支持 6 个中途停靠。", 422);
  let fieldTasks: RoadOpsFieldRoutingTask[] | undefined;
  if (input.fieldTasks !== undefined) {
    if (input.detailMode !== "field" || !Array.isArray(input.fieldTasks) || input.fieldTasks.length > 20) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "完整核查排程最多支持 20 项任务，且必须使用外业分段模式。", 422);
    if (points.some(point => point.dwellMinutes !== 0)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "任务排程已按任务计算停留，停车点停留必须为零，避免重复计时。", 422);
    const taskIds = new Set<string>();
    fieldTasks = input.fieldTasks.map((task, index): RoadOpsFieldRoutingTask => {
      if (!task || typeof task !== "object") throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", `fieldTasks[${index}] 无效。`, 422);
      const taskId = safeId(task.taskId, `fieldTasks[${index}].taskId`), pointId = safeId(task.pointId, `fieldTasks[${index}].pointId`);
      if (taskIds.has(taskId) || !ids.has(pointId)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "任务别名重复或停车点不属于到访路线。", 422);
      taskIds.add(taskId);
      if (!finite(task.dwellSeconds) || task.dwellSeconds < 0 || task.dwellSeconds > 10_800 || typeof task.required !== "boolean" || !["high", "medium", "low"].includes(task.priority) || task.eligible !== undefined && typeof task.eligible !== "boolean" || task.ineligibleReasonCode !== undefined && !["access_blocked", "input_incomplete"].includes(task.ineligibleReasonCode)) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "任务停留、必查标记、优先级或进入条件无效。", 422);
      return { taskId, pointId, dwellSeconds: rounded(task.dwellSeconds), required: task.required, priority: task.priority, ...(task.eligible !== undefined ? { eligible: task.eligible } : {}), ...(task.ineligibleReason !== undefined ? { ineligibleReason: boundedText(task.ineligibleReason, "ineligibleReason", 200) } : {}), ...(task.ineligibleReasonCode !== undefined ? { ineligibleReasonCode: task.ineligibleReasonCode } : {}) };
    });
    const variable = input.planningGoal === "coverage" || input.planningGoal === "priority";
    if (fieldTasks.some(task => task.eligible === false && (!variable || task.required))) throw new RoadOpsDrivingError("ROADOPS_DIDI_TASK_CONFLICT", "必查任务或完整任务方案包含未满足进入条件的任务；请先处理约束冲突。", 422);
    const requiredDwell = fieldTasks.filter(task => !variable || task.required).reduce((sum, task) => sum + task.dwellSeconds, 0);
    if (requiredDwell + (input.bufferSeconds ?? 0) > input.workMinutes * 60) throw new RoadOpsDrivingError("ROADOPS_DIDI_TIME_BUDGET", "必查现场停留和机动时间已超过完整工时，未发送道路请求。", 422);
  }
  if ((input.planningGoal === "coverage" || input.planningGoal === "priority") && fieldTasks === undefined) throw new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "限时任务选择必须提供完整任务排程信息。", 422);
  if (personalized && fieldTasks === undefined) {
    const dwellSeconds = points.filter(point => point.role === "candidate" || input.detailMode === "field" && point.id === endId).reduce((sum, point) => sum + point.dwellMinutes * 60, 0);
    if (dwellSeconds + (input.bufferSeconds ?? 0) > input.workMinutes * 60) throw new RoadOpsDrivingError("ROADOPS_DIDI_TIME_BUDGET", "现场停留和机动时间已超过完整工时，未发送道路请求。", 422);
  }
  return { schemaVersion: "roadops-driving-request-v1", startId, endId, returnToStart: input.returnToStart === true, workMinutes: personalized ? input.workMinutes : Math.round(input.workMinutes), strategy: input.strategy as RoadOpsDrivingRequest["strategy"], orderMode: input.orderMode ?? "optimize", ...(input.detailMode === "field" ? { detailMode: "field" as const } : {}), ...(input.planningGoal !== undefined ? { planningGoal: input.planningGoal } : {}), ...(input.drivingBudgetSeconds !== undefined ? { drivingBudgetSeconds: input.drivingBudgetSeconds } : {}), ...(input.bufferSeconds !== undefined ? { bufferSeconds: input.bufferSeconds } : {}), ...(fieldTasks !== undefined ? { fieldTasks } : {}), points };
}

const routeResult = (value: unknown, index: number) => {
  const response = (value && typeof value === "object" ? value : {}) as DidiResponse;
  if (response.status !== 10000 || !Array.isArray(response.results)) {
    const code = response.status === 40100 ? "ROADOPS_DIDI_AUTH_FAILED" : "ROADOPS_DIDI_UPSTREAM_FAILED";
    throw new RoadOpsDrivingError(code, response.status === 40100 ? "滴图鉴权失败，请检查已轮换的 Web Service Key。" : "滴图路径服务返回异常。", 502, response.status !== 40100);
  }
  const item = response.results[index] as DidiResult | undefined;
  if (!item || item.errcode !== 0 || !Array.isArray(item.routes) || !item.routes.length) return null;
  const route = item.routes[0] as DidiRoute | null;
  if (!route || typeof route !== "object") return null;
  if (!finite(route.dist) || route.dist < 0 || !finite(route.duration) || route.duration < 0) return null;
  return route;
};

const boundsFor = (coordinates: Position[]): [number, number, number, number] | null => coordinates.length
  ? coordinates.reduce<[number, number, number, number]>((bounds, point) => [Math.min(bounds[0], point[0]), Math.min(bounds[1], point[1]), Math.max(bounds[2], point[0]), Math.max(bounds[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity])
  : null;

const routeCoordinates = (route: DidiRoute, legIndex?: number): Position[] => {
  const prefix = legIndex === undefined ? "路线" : `第 ${legIndex} 段路线`;
  if (!Array.isArray(route.geo_list) || route.geo_list.length < 2) throw new RoadOpsDrivingError("ROADOPS_DIDI_UNREACHABLE", `${prefix}未返回可用驾车折线；未用直线替代。`, 422);
  const coordinates = route.geo_list.map((raw, index): Position => {
    const point = (raw && typeof raw === "object" ? raw : {}) as { longitude?: unknown; latitude?: unknown };
    if (!finite(point.longitude) || !finite(point.latitude) || point.longitude < -180 || point.longitude > 180 || point.latitude < -90 || point.latitude > 90) throw new RoadOpsDrivingError("ROADOPS_DIDI_RESPONSE_INVALID", `${prefix}折线第 ${index + 1} 个坐标无效；未生成不完整路线。`, 502, true);
    return gcj02ToWgs84([point.longitude, point.latitude]);
  });
  if (!coordinates.some(point => point[0] !== coordinates[0][0] || point[1] !== coordinates[0][1])) throw new RoadOpsDrivingError("ROADOPS_DIDI_RESPONSE_INVALID", `${prefix}折线退化为单点；未用直线替代。`, 502, true);
  return coordinates;
};

const routeTraffic = (route: DidiRoute, coordinates: Position[]): RoadOpsDrivingLeg["traffic"] => {
  if (!Array.isArray(route.segments)) return [];
  return route.segments.flatMap((raw): RoadOpsDrivingLeg["traffic"] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as { status?: unknown; distance?: unknown; start_index?: unknown; end_index?: unknown };
    if (!finite(item.status) || !Number.isInteger(item.status) || item.status < 0 || item.status > 4 || !finite(item.distance) || item.distance < 0 || !finite(item.start_index) || !finite(item.end_index) || !Number.isInteger(item.start_index) || !Number.isInteger(item.end_index) || item.start_index < 0 || item.end_index < item.start_index || item.end_index >= coordinates.length) return [];
    return [{ status: item.status as 0 | 1 | 2 | 3 | 4, distanceMeters: item.distance, startIndex: item.start_index, endIndex: item.end_index }];
  });
};

const offsetMeters = (a: Position, b: Position) => {
  const rad = Math.PI / 180, dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const haversine = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return rounded(6_371_008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(haversine))), 1);
};

const fieldAccess = (legs: RoadOpsDrivingLeg[], points: Map<string, RoadOpsDrivingPoint>): RoadOpsDrivingAccess[] => {
  const access = new Map<string, RoadOpsDrivingAccess>();
  for (const leg of legs) {
    for (const [pointId, roadCoordinate] of [[leg.fromId, leg.coordinates[0]], [leg.toId, leg.coordinates.at(-1)!]] as Array<[string, Position]>) {
      const coordinate = points.get(pointId)!.coordinate, offset = offsetMeters(coordinate, roadCoordinate);
      // A waypoint may have different arrival/departure road endpoints. Keep the
      // larger gap instead of hiding an inaccessible-looking approach behind the smaller one.
      if (!access.has(pointId) || access.get(pointId)!.offsetMeters < offset) access.set(pointId, { pointId, coordinate, roadCoordinate, offsetMeters: offset, status: offset > 50 ? "far_from_route" : "near_route", thresholdMeters: 50 });
    }
  }
  return [...access.values()];
};

export function createRoadOpsDrivingService(options: ServiceOptions = {}): RoadOpsDrivingService {
  const env = options.env ?? process.env, fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const dailyBudget = numberFromEnv(env.DIDI_ROUTE_DAILY_BUDGET, 50, 1, 5_000);
  const perIdentityLimit = numberFromEnv(env.DIDI_ROUTE_PER_USER_DAILY_LIMIT, 20, 1, 500);
  const maximumMatrixPoints = numberFromEnv(env.DIDI_ROUTE_MAX_MATRIX_POINTS, 8, 2, 12);
  const maximumCandidates = numberFromEnv(env.DIDI_ROUTE_MAX_CANDIDATES, 10, 1, 12);
  const cacheTtlMs = numberFromEnv(env.DIDI_ROUTE_CACHE_TTL_SECONDS, 1_800, 60, 86_400) * 1_000;
  const qps = numberFromEnv(env.DIDI_ROUTE_QPS_LIMIT, 1, 1, 10);
  const minimumGap = options.minimumUpstreamGapMs ?? Math.ceil(1_000 / qps);
  const key = env.DIDI_MAP_WEB_SERVICE_KEY?.trim() ?? "";
  const sharedQuota = options.sharedQuota;
  const cache = new Map<string, CacheEntry>(), daily = new Map<string, number>(), identities = new Map<string, number>();
  if (options.initialUsage) {
    const { date, used, identity } = options.initialUsage;
    if (date !== dateKey(now()) || !Number.isSafeInteger(used) || used < 0 || !identity.trim()) {
      throw new Error("Local usage carry-over requires today's Asia/Shanghai date and a non-negative integer count.");
    }
    daily.set(date, used);
    identities.set(`${date}:${identity}`, used);
  }
  let lastUpstreamAt = 0;
  let pendingPlan: Promise<void> = Promise.resolve();

  const usage = (identity: string): RoadOpsDrivingUsage => {
    const day = dateKey(now()), dailyUsed = daily.get(day) ?? 0, perIdentityUsed = identities.get(`${day}:${identity}`) ?? 0;
    return { cached: false, upstreamRequests: 0, dailyUsed, dailyBudget, dailyRemaining: Math.max(0, dailyBudget - dailyUsed), perIdentityUsed, perIdentityLimit };
  };
  const consume = (identity: string) => {
    const day = dateKey(now()), identityKey = `${day}:${identity}`, dayUsed = daily.get(day) ?? 0, identityUsed = identities.get(identityKey) ?? 0;
    if (dayUsed >= dailyBudget || identityUsed >= perIdentityLimit) throw new RoadOpsDrivingError("ROADOPS_DIDI_BUDGET_EXHAUSTED", "本地 HTTP 保护额度已用尽，未生成新的驾车路线。这不是滴图官方余额提示，请检查本地额度设置。", 429, false, usage(identity));
    daily.set(day, dayUsed + 1); identities.set(identityKey, identityUsed + 1);
  };
  const planUsage = async (identity: string, counter: RequestCounter): Promise<RoadOpsDrivingUsage> => {
    const current = sharedQuota ? { ...await sharedQuota.usage(identity), budgetScope: "shared" as const } : usage(identity);
    counter.lastUsage = current;
    return current;
  };
  const checkAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new RoadOpsDrivingError("ROADOPS_DIDI_CANCELLED", "本次规划已取消，未继续发起上游请求。", 499);
  };
  const upstream = async (url: string, body: unknown, identity: string, counter: RequestCounter, signal?: AbortSignal) => {
    checkAborted(signal);
    const remainingGap = minimumGap - (now() - lastUpstreamAt);
    if (remainingGap > 0) await wait(remainingGap);
    checkAborted(signal);
    if (sharedQuota) {
      if (!counter.lease) throw new SharedQuotaError("ROADOPS_QUOTA_UNAVAILABLE", 503, "未取得共享驾车额度预留，未发送供应商请求。");
      await counter.lease.beforeAttempt();
      checkAborted(signal);
    } else {
      if (options.requireSharedQuota) throw new SharedQuotaError("ROADOPS_QUOTA_UNAVAILABLE", 503, "共享驾车额度未配置，未发送供应商请求。");
      consume(identity);
    }
    counter.upstreamRequests += 1;
    lastUpstreamAt = now();
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ROADOPS_DRIVING_TIMEOUT_MS);
    const abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetchImpl(`${url}?key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) throw new RoadOpsDrivingError("ROADOPS_DIDI_UPSTREAM_HTTP", `滴图路径服务 HTTP ${response.status}。`, 502, response.status >= 500);
      const text = await response.text();
      if (text.length > 6_000_000) throw new RoadOpsDrivingError("ROADOPS_DIDI_RESPONSE_LIMIT", "滴图路径响应超过安全上限。", 502);
      try { return JSON.parse(text) as unknown; }
      catch { throw new RoadOpsDrivingError("ROADOPS_DIDI_RESPONSE_INVALID", "滴图路径响应不是有效 JSON。", 502, true); }
    } catch (error) {
      if (error instanceof RoadOpsDrivingError) throw error;
      if (signal?.aborted) throw new RoadOpsDrivingError("ROADOPS_DIDI_CANCELLED", "本次规划已取消，未继续发起上游请求。", 499, false, usage(identity));
      if (error instanceof Error && error.name === "AbortError") throw new RoadOpsDrivingError("ROADOPS_DIDI_TIMEOUT", "滴图驾车规划超时，未生成新的驾车路线。", 504, true, usage(identity));
      throw new RoadOpsDrivingError("ROADOPS_DIDI_UPSTREAM_FAILED", "滴图驾车规划暂时不可用，未生成新的驾车路线。", 502, true, usage(identity));
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
    }
  };

  const executePlan = async (value: unknown, identity: string, counter: RequestCounter, signal?: AbortSignal): Promise<RoadOpsDrivingPlan> => {
    checkAborted(signal);
    const input = sanitizeRoadOpsDrivingRequest(value, maximumMatrixPoints, maximumCandidates);
    const personalized = input.planningGoal !== undefined || input.drivingBudgetSeconds !== undefined || input.bufferSeconds !== undefined || input.fieldTasks !== undefined;
    const selectsTasks = input.planningGoal === "coverage" || input.planningGoal === "priority";
    const needsMatrix = input.orderMode === "optimize" || selectsTasks;
    // Array order is part of the input-order contract. Legacy optimization remains
    // order-independent for cache compatibility; its selected order is computed below.
    const normalized = JSON.stringify({ orderingVersion: "strategy-objective-v2", ...input, points: input.orderMode === "input" ? input.points : [...input.points].sort((a, b) => a.id.localeCompare(b.id)) });
    const inputFingerprint = fingerprint(normalized), timestamp = now();
    const cached = cache.get(inputFingerprint);
    if (cached && cached.expiresAt > timestamp) {
      const current = await planUsage(identity, counter), result = { ...cached.plan, ...(cached.plan.field ? { field: { ...cached.plan.field, routePackCount: 0 } } : {}), usage: { ...current, cached: true, upstreamRequests: 0 } };
      console.info("RoadOps driving", { fingerprint: inputFingerprint, cacheHit: true, upstreamRequests: 0, pointCount: input.points.length });
      return result;
    }
    if (!key) throw new RoadOpsDrivingError("ROADOPS_DIDI_NOT_CONFIGURED", "服务器未配置滴图 Web Service Key，无法生成真实驾车路线。", 503, false, usage(identity));
    if (options.requireSharedQuota && !sharedQuota) throw new SharedQuotaError("ROADOPS_QUOTA_UNAVAILABLE", 503, "共享驾车额度未配置，未发送供应商请求。");
    const before = await planUsage(identity, counter);
    const requestBudget = needsMatrix ? 3 : 2;
    if (before.dailyRemaining < requestBudget || before.perIdentityLimit - before.perIdentityUsed < requestBudget) throw new RoadOpsDrivingError("ROADOPS_DIDI_BUDGET_EXHAUSTED", `本地 HTTP 保护额度不足：总额度剩余 ${before.dailyRemaining} 次，当前用户剩余 ${Math.max(0, before.perIdentityLimit - before.perIdentityUsed)} 次（本次最多需 ${requestBudget} 次）。这不是滴图官方余额提示，请检查本地额度设置。`, 429, false, before);
    if (sharedQuota) counter.lease = await sharedQuota.reserve(identity, requestBudget);

    const locations = input.points.map(point => `${point.coordinate[0].toFixed(6)},${point.coordinate[1].toFixed(6)}`).join(";");
    const convertedRaw = await upstream(DIDI_CONVERT_URL, { coordsys: "gps", locations }, identity, counter, signal) as { status?: unknown; results?: unknown };
    if (convertedRaw.status !== 10000 || !Array.isArray(convertedRaw.results) || convertedRaw.results.length !== input.points.length) throw new RoadOpsDrivingError("ROADOPS_DIDI_CONVERT_FAILED", "WGS84 坐标转换失败；未发起后续路径请求。", 502, true, usage(identity));
    const converted = convertedRaw.results.map((raw, index): DidiGeo => {
      const point = raw as { lng?: unknown; lat?: unknown };
      if (!finite(point.lng) || !finite(point.lat)) throw new RoadOpsDrivingError("ROADOPS_DIDI_CONVERT_FAILED", `第 ${index + 1} 个坐标转换结果无效。`, 502, true, usage(identity));
      return { lng: point.lng, lat: point.lat };
    });
    const convertedById = new Map(input.points.map((point, index) => [point.id, converted[index]]));
    const departure = Math.floor(timestamp / 1_000);
    const candidates = input.points.filter(point => point.role === "candidate");
    let taskSelection: RoadOpsTaskSelection | undefined;
    let routePackCount = 0;
    // Manual navigation-style planning never removes a selected stop. Work time
    // is an informational feasibility check after the real route is returned.
    let optimized: Pick<RoadOpsRoutePlan, "status" | "stopOrder" | "selectedCandidateIds" | "excluded" | "dwellMinutes"> = {
      status: "ready",
      stopOrder: [input.startId, ...candidates.map(point => point.id), input.endId],
      selectedCandidateIds: candidates.map(point => point.id),
      excluded: [],
      dwellMinutes: candidates.reduce((sum, point) => sum + point.dwellMinutes, 0),
    };
    if (needsMatrix) {
      const pairs: Array<{ from: RoadOpsDrivingPoint; to: RoadOpsDrivingPoint }> = [];
      input.points.forEach(from => input.points.forEach(to => { if (from.id !== to.id) pairs.push({ from, to }); }));
      routePackCount += pairs.length;
      const matrixRaw = await upstream(DIDI_ROUTE_URL, { packs: pairs.map(({ from, to }) => ({ origin: `${convertedById.get(from.id)!.lng},${convertedById.get(from.id)!.lat}`, destination: `${convertedById.get(to.id)!.lng},${convertedById.get(to.id)!.lat}`, departure_time: departure, routeplan_type: "1", need_polyline: false, eta_strategy: 0, strategy: input.strategy })) }, identity, counter, signal);
      const matrix = Object.fromEntries(input.points.map(point => [point.id, Object.fromEntries(input.points.map(target => [target.id, point.id === target.id ? { distanceMeters: 0, durationSeconds: 0 } : null]))])) as RoadOpsRouteFixture["matrix"];
      pairs.forEach(({ from, to }, index) => {
        const route = routeResult(matrixRaw, index);
        if (route) matrix[from.id][to.id] = { distanceMeters: Math.round(route.dist as number), durationSeconds: Math.round(route.duration as number) };
      });
      const effectiveEndId = input.returnToStart ? input.startId : input.endId;
      const fixturePoints = input.points.map(point => {
        const isCandidate = point.role === "candidate";
        return {
          id: point.id,
          name: point.name,
          role: point.id === input.startId ? "origin" as const : point.role === "candidate" ? "candidate" as const : "destination" as const,
          coordinate: point.coordinate,
          defaultDwellMinutes: point.dwellMinutes,
          inspectionValue: point.inspectionValue,
          reachable: !isCandidate || Boolean(matrix[input.startId]?.[point.id] && matrix[point.id]?.[effectiveEndId]),
          sourceFeatureId: point.sourceFeatureId,
          sourceRoadName: point.sourceRoadName,
          unreachableReason: isCandidate ? "滴图有向矩阵未返回起终点可达成本" : undefined,
        };
      });
      const fixture: RoadOpsRouteFixture = {
        schemaVersion: "roadops-offline-route-fixture-v1",
        fixtureId: `didi-live-${inputFingerprint}`,
        generatedAt: new Date(timestamp).toISOString(),
        mode: "offline_demo",
        source: { datasetId: "didi-live-session", file: "not-persisted", sha256: inputFingerprint, attribution: "滴图出行技术开放平台", license: "受平台服务协议约束" },
        limits: { maximumCandidates, maximumMatrixPoints },
        assumptions: { speedModel: "Didi Web Service duration", directionalCost: "Didi directed routeplan packs", liveTraffic: false, navigationUse: false },
        points: fixturePoints,
        matrix,
        legGeometries: { type: "FeatureCollection", name: "didi-live-matrix-no-geometry", features: [] },
        defaultPlan: { startId: input.startId, endId: input.endId, candidateIds: fixturePoints.filter(point => point.role === "candidate").map(point => point.id), requiredIds: input.points.filter(point => point.required).map(point => point.id), workMinutes: input.workMinutes, returnToStart: input.returnToStart },
      };
      if (personalized) {
        try {
          const solved = solveRoadOpsPersonalizedRoute(fixture, input, { shouldAbort: () => Boolean(signal?.aborted) });
          optimized = solved;
          if (input.fieldTasks !== undefined) taskSelection = solved.taskSelection;
        } catch (error) {
          if (error instanceof RoadOpsPersonalizedRouteError) throw new RoadOpsDrivingError(error.reason === "aborted" ? "ROADOPS_DIDI_CANCELLED" : error.reason === "unreachable" ? "ROADOPS_DIDI_UNREACHABLE" : "ROADOPS_DIDI_BAD_REQUEST", error.message, error.reason === "aborted" ? 499 : 422, false, usage(identity));
          throw error;
        }
      } else optimized = optimizeRoadOpsRoute(fixture, {
        objective: input.strategy === "5" ? "distance" : "duration",
        startId: input.startId,
        endId: input.endId,
        candidateIds: fixturePoints.filter(point => point.role === "candidate").map(point => point.id),
        requiredIds: input.points.filter(point => point.required).map(point => point.id),
        dwellMinutes: Object.fromEntries(input.points.map(point => [point.id, point.dwellMinutes])),
        // The optimizer counts candidate dwell only. Field arrival work at the
        // destination (or returned origin) consumes the same work window too.
        workMinutes: input.workMinutes - (input.detailMode === "field" ? input.points.find(point => point.id === effectiveEndId)!.dwellMinutes : 0),
        returnToStart: input.returnToStart,
      });
      if (candidates.some(point => point.required && !optimized.selectedCandidateIds.includes(point.id))) throw new RoadOpsDrivingError("ROADOPS_DIDI_UNREACHABLE", "至少一个必经点未返回可达路线；请检查点位是否位于可通行道路附近。没有删除必经点生成替代路线。", 422, false, usage(identity));
    }
    if (!needsMatrix && input.fieldTasks !== undefined) {
      const dwellSeconds = input.fieldTasks.reduce((sum, task) => sum + task.dwellSeconds, 0), bufferSeconds = input.bufferSeconds ?? 0;
      taskSelection = { selectedTaskIds: input.fieldTasks.map(task => task.taskId), deferredTasks: [], dwellSeconds, bufferSeconds, workBudgetSeconds: input.workMinutes * 60, drivingBudgetSeconds: Math.max(0, Math.min(input.drivingBudgetSeconds ?? input.workMinutes * 60, input.workMinutes * 60 - dwellSeconds - bufferSeconds)) };
    }
    if (personalized && optimized.stopOrder.length === 2 && optimized.stopOrder[0] === optimized.stopOrder[1]) throw new RoadOpsDrivingError("ROADOPS_DIDI_NO_STATION_DRIVING", "本次工时内未安排站间核查，请调整工时或必查设置；同站任务可单独安排。", 422, false, usage(identity));
    const finalPoints = optimized.stopOrder.map(id => convertedById.get(id)!);
    const inputById = new Map(input.points.map(point => [point.id, point]));
    const routePack = (from: DidiGeo, to: DidiGeo) => ({ origin: `${from.lng},${from.lat}`, destination: `${to.lng},${to.lat}`, departure_time: departure, routeplan_type: "1", need_polyline: true, eta_strategy: 0, strategy: input.strategy });
    const finalPacks = input.detailMode === "field"
      ? finalPoints.slice(0, -1).map((point, index) => ({ ...routePack(point, finalPoints[index + 1]), show_fields: "segments,cost" }))
      : [{ ...routePack(finalPoints[0], finalPoints.at(-1)!), waypoints: finalPoints.slice(1, -1).map(point => `${point.lng},${point.lat}`).join(";") }];
    routePackCount += finalPacks.length;
    const finalRaw = await upstream(DIDI_ROUTE_URL, { packs: finalPacks }, identity, counter, signal);
    const features: RoadOpsRouteLegFeature[] = [];
    let totalDistanceMeters = 0, durationSeconds = 0, field: RoadOpsFieldDetail | undefined;
    if (input.detailMode === "field") {
      const legs = finalPacks.map((_pack, index): RoadOpsDrivingLeg => {
        const route = routeResult(finalRaw, index);
        if (!route) throw new RoadOpsDrivingError("ROADOPS_DIDI_UNREACHABLE", `第 ${index + 1} 段（${inputById.get(optimized.stopOrder[index])!.name} → ${inputById.get(optimized.stopOrder[index + 1])!.name}）未返回可达驾车路线；整条行程未生成，请调整该段入口点。`, 422, false, usage(identity));
        const coordinates = routeCoordinates(route, index + 1);
        const rawTolls = route.cost && typeof route.cost === "object" ? (route.cost as { tolls?: unknown }).tolls : undefined;
        const tolls = typeof rawTolls === "number" || (typeof rawTolls === "string" && rawTolls.trim()) ? Number(rawTolls) : NaN;
        return { id: `didi-live-route-${inputFingerprint}-leg-${index + 1}`, index: index + 1, fromId: optimized.stopOrder[index], toId: optimized.stopOrder[index + 1], distanceMeters: Math.round(route.dist as number), durationSeconds: Math.round(route.duration as number), coordinates, bounds: boundsFor(coordinates)!, traffic: routeTraffic(route, coordinates), tollsYuan: Number.isFinite(tolls) && tolls >= 0 ? rounded(tolls, 2) : null, tag: typeof route.tag === "string" && route.tag.trim() ? route.tag.trim().slice(0, 200) : null };
      });
      for (const leg of legs) {
        features.push({ type: "Feature", id: leg.id, properties: { from: leg.fromId, to: leg.toId, distanceMeters: leg.distanceMeters, durationSeconds: leg.durationSeconds, source: "didi_web_service", legIndex: leg.index }, geometry: { type: "LineString", coordinates: leg.coordinates } });
        totalDistanceMeters += leg.distanceMeters;
        durationSeconds += leg.durationSeconds;
      }
      field = {
        schemaVersion: "roadops-field-detail-v1", guidance: "geometry_only", legs, access: fieldAccess(legs, inputById), routePackCount,
        limitations: [
          "滴图 Web Service 返回行驶折线及可选路况/费用，不返回道路名和逐转向指令；不生成推测的转向播报。",
          "点位可达性仅比较所选坐标与驾车折线端点的直线偏离，50 米为本项目检查阈值；靠近路线不代表入口开放、停车允许或最后一段可进入。",
          "路线已由滴图按驾车网络计算，但未独立核验门禁、施工、私有道路、车型/限高限重或现场步行接近条件，出发前仍需确认。",
          "分段预计时间以同一请求时刻分别计算，未逐段预测到达时刻；路况和费用仅展示有效返回值，缺失不代表畅通或免费。",
          "用于底图叠加的坐标经过近似反算；偏离检查需结合现场入口核实，不能作为测绘精度证明。",
        ],
      };
    } else {
      const finalRoute = routeResult(finalRaw, 0);
      if (!finalRoute) throw new RoadOpsDrivingError("ROADOPS_DIDI_UNREACHABLE", "滴图未返回最终顺序的可用驾车折线。", 422, false, usage(identity));
      const coordinates = routeCoordinates(finalRoute);
      totalDistanceMeters = Math.round(finalRoute.dist as number);
      durationSeconds = Math.round(finalRoute.duration as number);
      features.push({ type: "Feature", id: `didi-live-route-${inputFingerprint}`, properties: { from: optimized.stopOrder[0], to: optimized.stopOrder.at(-1)!, distanceMeters: totalDistanceMeters, durationSeconds, source: "didi_web_service", legIndex: 1 }, geometry: { type: "LineString", coordinates } });
    }
    const coordinates = features.flatMap(feature => feature.geometry.coordinates);
    const middle = optimized.stopOrder.slice(1, -1), required = new Set(input.points.filter(point => point.required).map(point => point.id));
    const map: RoadOpsRouteMapPlan = {
      fixtureId: `didi-live-${inputFingerprint}`,
      mode: "didi_live",
      stops: optimized.stopOrder.map((id, index) => {
        const point = inputById.get(id)!;
        const selectedDwell = taskSelection && input.fieldTasks ? input.fieldTasks.filter(task => task.pointId === id && taskSelection!.selectedTaskIds.includes(task.taskId)).reduce((sum, task) => sum + task.dwellSeconds, 0) / 60 : point.dwellMinutes;
        return { id, name: point.name, role: point.role, coordinate: point.coordinate, defaultDwellMinutes: selectedDwell, inspectionValue: point.inspectionValue, reachable: true, sourceFeatureId: point.sourceFeatureId, sourceRoadName: point.sourceRoadName, markerRole: index === 0 ? "start" as const : index === optimized.stopOrder.length - 1 ? "end" as const : "waypoint" as const, visitIndex: index === 0 || index === optimized.stopOrder.length - 1 ? null : middle.indexOf(id) + 1, required: required.has(id) };
      }),
      features,
      bounds: boundsFor(coordinates),
    };
    // Field work may include an inspection at the destination (or at the origin
    // after returning). Only the initial departure has no arrival dwell.
    const stopDwellMinutes = taskSelection ? taskSelection.dwellSeconds / 60 : input.detailMode === "field" ? optimized.stopOrder.slice(1).reduce((sum, id) => sum + inputById.get(id)!.dwellMinutes, 0) : optimized.dwellMinutes;
    const bufferSeconds = personalized ? input.bufferSeconds ?? 0 : 0;
    const exactTotalSeconds = durationSeconds + stopDwellMinutes * 60 + bufferSeconds;
    const drivingMinutes = rounded(durationSeconds / 60, 1), dwellMinutes = rounded(stopDwellMinutes, 1), totalMinutes = personalized ? rounded(exactTotalSeconds / 60, 1) : rounded(drivingMinutes + dwellMinutes, 1);
    const current = await planUsage(identity, counter);
    const result: RoadOpsDrivingPlan = {
      schemaVersion: "roadops-driving-plan-v1",
      provider: "didi_web_service",
      mode: "didi_live",
      generatedAt: new Date(timestamp).toISOString(),
      inputFingerprint,
      planning: roadOpsPlanningForRequest(input),
      status: (personalized ? exactTotalSeconds > input.workMinutes * 60 || durationSeconds > (taskSelection?.drivingBudgetSeconds ?? input.drivingBudgetSeconds ?? input.workMinutes * 60) : optimized.status === "infeasible" || totalMinutes > input.workMinutes) ? "infeasible" : "ready",
      stopOrder: optimized.stopOrder,
      selectedCandidateIds: optimized.selectedCandidateIds,
      excluded: optimized.excluded,
      totalDistanceMeters,
      drivingMinutes,
      drivingDurationSeconds: durationSeconds,
      dwellMinutes,
      totalMinutes,
      workMinutes: input.workMinutes,
      overtimeMinutes: rounded(Math.max(0, personalized ? exactTotalSeconds / 60 - input.workMinutes : totalMinutes - input.workMinutes), 1),
      map,
      usage: { ...current, cached: false, upstreamRequests: counter.upstreamRequests },
      ...(field ? { field } : {}),
      ...(taskSelection ? { taskSelection } : {}),
      boundary: "路线、距离与预计驾车时间来自滴图 Web Service；仅作行前规划，不提供定位跟随、转向播报等实时导航能力。",
    };
    cache.set(inputFingerprint, { expiresAt: timestamp + cacheTtlMs, plan: result });
    if (cache.size > 100) cache.forEach((entry, cacheKey) => { if (entry.expiresAt <= timestamp) cache.delete(cacheKey); });
    console.info("RoadOps driving", { fingerprint: inputFingerprint, cacheHit: false, upstreamRequests: result.usage.upstreamRequests, pointCount: input.points.length, selectedCount: result.selectedCandidateIds.length });
    return result;
  };

  // Serialize complete plans inside this service instance: budget preflight,
  // upstream pacing and cache publication must not race with another plan.
  // Restarted or separate instances still require an external shared quota store.
  const plan = (value: unknown, identity: string, signal?: AbortSignal): Promise<RoadOpsDrivingPlan> => {
    const counter: RequestCounter = { upstreamRequests: 0 };
    const result = pendingPlan.then(async () => {
      try {
        const completed = await executePlan(value, identity, counter, signal);
        if (counter.lease) {
          const completedLease = counter.lease;
          counter.lease = undefined;
          await completedLease.close();
          completed.usage = { ...await planUsage(identity, counter), cached: completed.usage.cached, upstreamRequests: counter.upstreamRequests };
        }
        return completed;
      } catch (error) {
        if (counter.lease) {
          const failedLease = counter.lease;
          counter.lease = undefined;
          try { await failedLease.close(); } catch { /* conservative persisted charge */ }
        }
        let known: RoadOpsDrivingUsage | undefined;
        if (sharedQuota) {
          try { known = { ...await sharedQuota.usage(identity), budgetScope: "shared" }; } catch { /* unknown, never display a stale/local balance */ }
        } else if (!options.requireSharedQuota) known = usage(identity);
        const current = known ? { ...known, upstreamRequests: counter.upstreamRequests } : { upstreamRequests: counter.upstreamRequests };
        if (error instanceof SharedQuotaError) throw new RoadOpsDrivingError(error.code, error.message, error.status, false, current);
        if (error instanceof RoadOpsDrivingError) throw new RoadOpsDrivingError(error.code, error.message, error.status, error.retryable, current);
        throw new RoadOpsDrivingError("ROADOPS_DIDI_FAILED", "驾车规划失败，未生成新的驾车路线。", 502, true, current);
      } finally {
        // Only the lease's definite unattempted remainder may be refunded.
        // A failed cleanup leaves conservative persisted counts; never fall back.
        if (counter.lease) {
          try { await counter.lease.close(); } catch { /* fail closed, no reset */ }
        }
      }
    });
    pendingPlan = result.then(() => undefined, () => undefined);
    return result;
  };

  return { plan, usage };
}

let defaultService: RoadOpsDrivingService | null = null;
export const getRoadOpsDrivingService = () => defaultService ??= createRoadOpsDrivingService();

export type RoadOpsDrivingHttpInput = {
  method: string;
  origin: string;
  host: string;
  contentType?: string;
  bodyText: string;
  identity: string;
  signal?: AbortSignal;
};
export type RoadOpsDrivingHttpResult = { status: number; body: unknown; headers: Record<string, string> };

export async function handleRoadOpsDrivingRequest(input: RoadOpsDrivingHttpInput, service = getRoadOpsDrivingService()): Promise<RoadOpsDrivingHttpResult> {
  const headers = { "cache-control": "private, no-store", "content-type": "application/json; charset=utf-8" };
  const fail = (error: RoadOpsDrivingError): RoadOpsDrivingHttpResult => ({ status: error.status, headers, body: { error: { code: error.code, message: error.message, retryable: error.retryable, fallbackAvailable: false, usage: error.usage } } });
  if (input.method !== "POST") return fail(new RoadOpsDrivingError("ROADOPS_DIDI_METHOD", "仅支持 POST 请求。", 405));
  if (!sameOrigin(input.origin, input.host)) return fail(new RoadOpsDrivingError("ROADOPS_DIDI_ORIGIN", "请求来源验证失败。", 403));
  if (input.contentType !== undefined && !/^application\/json(?:\s*;|$)/i.test(input.contentType)) return fail(new RoadOpsDrivingError("ROADOPS_DIDI_CONTENT_TYPE", "驾车规划请求必须使用 application/json。", 415));
  if (new TextEncoder().encode(input.bodyText).byteLength > ROADOPS_DRIVING_MAX_BODY_BYTES) return fail(new RoadOpsDrivingError("ROADOPS_DIDI_BODY_LIMIT", "驾车规划请求超过 48 KB。", 413));
  let payload: unknown;
  try { payload = JSON.parse(input.bodyText); }
  catch { return fail(new RoadOpsDrivingError("ROADOPS_DIDI_BAD_REQUEST", "驾车规划请求必须是 UTF-8 JSON。", 422)); }
  try {
    const plan = await service.plan(payload, input.identity, input.signal);
    return { status: 200, headers, body: { plan } };
  } catch (error) {
    if (error instanceof RoadOpsDrivingError) return fail(error);
    return fail(new RoadOpsDrivingError("ROADOPS_DIDI_FAILED", "驾车规划失败，未生成新的驾车路线。", 502, true, service.usage(input.identity)));
  }
}
