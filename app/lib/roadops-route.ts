import type { Position } from "./gis-layer";
import type { RoadOpsDrivingRequest, RoadOpsFieldRoutingTask, RoadOpsTaskSelection } from "./roadops-driving";

export type RoadOpsRouteCost = { distanceMeters: number; durationSeconds: number };
export type RoadOpsRoutePoint = {
  id: string;
  name: string;
  role: "origin" | "destination" | "candidate";
  coordinate: Position;
  defaultDwellMinutes: number;
  inspectionValue: number;
  reachable: boolean;
  sourceFeatureId: string | null;
  sourceRoadName: string;
  unreachableReason?: string;
};
export type RoadOpsRouteLegFeature = {
  type: "Feature";
  id: string;
  properties: { from: string; to: string; distanceMeters: number; durationSeconds: number; source: "saved_osm_route_demo" | "didi_web_service" | "didi_contract_replay"; legIndex?: number };
  geometry: { type: "LineString"; coordinates: Position[] };
};
export type RoadOpsRouteFixture = {
  schemaVersion: "roadops-offline-route-fixture-v1";
  fixtureId: string;
  generatedAt: string;
  mode: "offline_demo";
  source: { datasetId: string; file: string; sha256: string; attribution: string; license: string };
  limits: { maximumCandidates: number; maximumMatrixPoints: number };
  assumptions: { speedModel: string; directionalCost: string; liveTraffic: false; navigationUse: false };
  points: RoadOpsRoutePoint[];
  matrix: Record<string, Record<string, RoadOpsRouteCost | null>>;
  legGeometries: { type: "FeatureCollection"; name: string; features: RoadOpsRouteLegFeature[] };
  defaultPlan: { startId: string; endId: string; candidateIds: string[]; requiredIds: string[]; workMinutes: number; returnToStart: boolean };
};

export type RoadOpsRouteObjective = "duration" | "distance";
export type RoadOpsRouteRequest = {
  startId: string;
  endId: string;
  candidateIds: string[];
  requiredIds: string[];
  dwellMinutes: Record<string, number>;
  workMinutes: number;
  returnToStart: boolean;
  objective?: RoadOpsRouteObjective;
};
export type RoadOpsRouteExclusion = { pointId: string; pointName: string; reason: "unreachable" | "time_budget" | "not_in_fixed_matrix"; detail: string };
export type RoadOpsRouteMapStop = RoadOpsRoutePoint & { markerRole: "start" | "end" | "waypoint"; visitIndex: number | null; required: boolean };
export type RoadOpsRouteMapPlan = {
  fixtureId: string;
  mode: "offline_demo" | "didi_live" | "didi_replay";
  stops: RoadOpsRouteMapStop[];
  features: RoadOpsRouteLegFeature[];
  bounds: [number, number, number, number] | null;
};
export type RoadOpsRoutePlan = {
  schemaVersion: "roadops-offline-route-plan-v1";
  fixtureId: string;
  mode: "offline_demo";
  status: "ready" | "infeasible";
  stopOrder: string[];
  selectedCandidateIds: string[];
  excluded: RoadOpsRouteExclusion[];
  totalDistanceMeters: number;
  drivingMinutes: number;
  dwellMinutes: number;
  totalMinutes: number;
  workMinutes: number;
  overtimeMinutes: number;
  baselineDistanceMeters: number;
  baselineDrivingMinutes: number;
  distanceSavedMeters: number;
  map: RoadOpsRouteMapPlan;
};

type RouteMetrics = { distanceMeters: number; drivingSeconds: number; reachable: boolean };

const finiteCoordinate = (value: unknown): value is Position => Array.isArray(value) && value.length >= 2
  && typeof value[0] === "number" && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
  && typeof value[1] === "number" && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90;
const unique = (values: string[]) => [...new Set(values)];
const round = (value: number, digits = 1) => Number(value.toFixed(digits));

export const parseRoadOpsRouteFixture = (value: unknown): RoadOpsRouteFixture => {
  if (!value || typeof value !== "object") throw new Error("离线路线夹具为空。");
  const fixture = value as Partial<RoadOpsRouteFixture>;
  if (fixture.schemaVersion !== "roadops-offline-route-fixture-v1" || fixture.mode !== "offline_demo") throw new Error("离线路线夹具版本不受支持。");
  if (!Array.isArray(fixture.points) || !fixture.points.length || !fixture.points.every(point => point && typeof point.id === "string" && finiteCoordinate(point.coordinate))) throw new Error("离线路线点位无效。");
  if (!fixture.matrix || typeof fixture.matrix !== "object" || !fixture.legGeometries || !Array.isArray(fixture.legGeometries.features)) throw new Error("离线路线成本或几何缺失。");
  if (fixture.points.length > (fixture.limits?.maximumMatrixPoints ?? 8)) throw new Error("离线路线矩阵点数超过冻结上限。");
  return fixture as RoadOpsRouteFixture;
};

const cost = (fixture: RoadOpsRouteFixture, from: string, to: string) => fixture.matrix[from]?.[to] ?? null;
const routeMetrics = (fixture: RoadOpsRouteFixture, order: string[]): RouteMetrics => {
  let distanceMeters = 0, drivingSeconds = 0;
  for (let index = 1; index < order.length; index += 1) {
    const leg = cost(fixture, order[index - 1], order[index]);
    if (!leg) return { distanceMeters: Number.POSITIVE_INFINITY, drivingSeconds: Number.POSITIVE_INFINITY, reachable: false };
    distanceMeters += leg.distanceMeters;
    drivingSeconds += leg.durationSeconds;
  }
  return { distanceMeters, drivingSeconds, reachable: true };
};

const objectiveValue = (metrics: RouteMetrics, objective: RoadOpsRouteObjective) => objective === "distance" ? metrics.distanceMeters : metrics.drivingSeconds;
const compareRouteMetrics = (a: RouteMetrics, b: RouteMetrics, objective: RoadOpsRouteObjective, maximumDrivingSeconds: number) => {
  if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
  const aFeasible = a.drivingSeconds <= maximumDrivingSeconds, bFeasible = b.drivingSeconds <= maximumDrivingSeconds;
  if (aFeasible !== bFeasible) return aFeasible ? -1 : 1;
  // Never replace a feasible route with a shorter route that exceeds the work window.
  // If both exceed it, reduce overtime before applying the chosen objective.
  if (!aFeasible && a.drivingSeconds !== b.drivingSeconds) return a.drivingSeconds - b.drivingSeconds;
  return objectiveValue(a, objective) - objectiveValue(b, objective);
};

export const nearestNeighborOrder = (fixture: RoadOpsRouteFixture, startId: string, candidateIds: string[], endId: string, objective: RoadOpsRouteObjective = "duration") => {
  const remaining = new Set(unique(candidateIds).filter(id => id !== startId && id !== endId));
  const order = [startId], unreachable: string[] = [];
  let current = startId;
  while (remaining.size) {
    const ranked = [...remaining].map(id => {
      const leg = cost(fixture, current, id);
      return { id, value: leg ? objective === "distance" ? leg.distanceMeters : leg.durationSeconds : Number.POSITIVE_INFINITY };
    }).sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
    const next = ranked[0];
    if (!next || !Number.isFinite(next.value)) {
      unreachable.push(...[...remaining].sort());
      break;
    }
    order.push(next.id);
    remaining.delete(next.id);
    current = next.id;
  }
  order.push(endId);
  return { order, unreachable };
};

export const twoOptDirected = (fixture: RoadOpsRouteFixture, order: string[], objective: RoadOpsRouteObjective = "duration", maximumDrivingSeconds = Number.POSITIVE_INFINITY) => {
  let best = [...order], bestMetrics = routeMetrics(fixture, best), improved = true;
  while (improved) {
    improved = false;
    for (let start = 1; start < best.length - 2; start += 1) {
      for (let end = start + 1; end < best.length - 1; end += 1) {
        const candidate = [...best.slice(0, start), ...best.slice(start, end + 1).reverse(), ...best.slice(end + 1)];
        const metrics = routeMetrics(fixture, candidate);
        if (metrics.reachable && compareRouteMetrics(metrics, bestMetrics, objective, maximumDrivingSeconds) < -1e-6) {
          best = candidate;
          bestMetrics = metrics;
          improved = true;
        }
      }
    }
  }
  return best;
};

const bestInsertion = (fixture: RoadOpsRouteFixture, order: string[], pointId: string, dwellMinutes: number, objective: RoadOpsRouteObjective, maximumDrivingSeconds: number) => {
  let best: { order: string[]; addedSeconds: number; addedCost: number; metrics: RouteMetrics } | null = null;
  for (let index = 1; index < order.length; index += 1) {
    const from = order[index - 1], to = order[index], direct = cost(fixture, from, to), incoming = cost(fixture, from, pointId), outgoing = cost(fixture, pointId, to);
    if (!incoming || !outgoing) continue;
    const addedSeconds = incoming.durationSeconds + outgoing.durationSeconds - (direct?.durationSeconds ?? 0) + Math.max(0, dwellMinutes) * 60;
    const addedCost = objective === "distance" ? incoming.distanceMeters + outgoing.distanceMeters - (direct?.distanceMeters ?? 0) : addedSeconds;
    const nextOrder = [...order.slice(0, index), pointId, ...order.slice(index)], metrics = routeMetrics(fixture, nextOrder);
    if (!metrics.reachable) continue;
    if (!best || compareRouteMetrics(metrics, best.metrics, objective, maximumDrivingSeconds) < 0) best = { order: nextOrder, addedSeconds, addedCost, metrics };
  }
  return best;
};

const mapForOrder = (fixture: RoadOpsRouteFixture, order: string[], requiredIds: string[]): RoadOpsRouteMapPlan => {
  const featureByLeg = new Map(fixture.legGeometries.features.map(feature => [`${feature.properties.from}|${feature.properties.to}`, feature]));
  const features: RoadOpsRouteLegFeature[] = [];
  for (let index = 1; index < order.length; index += 1) {
    const feature = featureByLeg.get(`${order[index - 1]}|${order[index]}`);
    if (feature) features.push({ ...feature, properties: { ...feature.properties, legIndex: index } });
  }
  const pointById = new Map(fixture.points.map(point => [point.id, point]));
  const middle = order.slice(1, -1), required = new Set(requiredIds);
  const stops = order.map((id, index) => {
    const point = pointById.get(id);
    if (!point) throw new Error(`路线点 ${id} 不存在。`);
    const isStart = index === 0, isEnd = index === order.length - 1;
    return { ...point, markerRole: isStart ? "start" as const : isEnd ? "end" as const : "waypoint" as const, visitIndex: isStart || isEnd ? null : middle.indexOf(id) + 1, required: required.has(id) };
  });
  const coordinates = features.flatMap(feature => feature.geometry.coordinates);
  const bounds: [number, number, number, number] | null = coordinates.length ? [Math.min(...coordinates.map(point => point[0])), Math.min(...coordinates.map(point => point[1])), Math.max(...coordinates.map(point => point[0])), Math.max(...coordinates.map(point => point[1]))] : null;
  return { fixtureId: fixture.fixtureId, mode: "offline_demo", stops, features, bounds };
};

export const optimizeRoadOpsRoute = (fixture: RoadOpsRouteFixture, request: RoadOpsRouteRequest): RoadOpsRoutePlan => {
  const pointById = new Map(fixture.points.map(point => [point.id, point]));
  const objective = request.objective ?? "duration";
  const endId = request.returnToStart ? request.startId : request.endId;
  if (!pointById.has(request.startId) || !pointById.has(endId)) throw new Error("起点或终点不在固定矩阵中。");
  const candidateIds = unique(request.candidateIds).filter(id => id !== request.startId && id !== endId).slice(0, fixture.limits.maximumCandidates);
  const requiredIds = unique(request.requiredIds).filter(id => candidateIds.includes(id));
  const excluded: RoadOpsRouteExclusion[] = [];
  const reachable = candidateIds.filter(id => {
    const point = pointById.get(id);
    if (point?.reachable) return true;
    excluded.push({ pointId: id, pointName: point?.name ?? id, reason: "unreachable", detail: point?.unreachableReason ?? "固定有向成本矩阵中不可达" });
    return false;
  });
  const dwellForOrder = (nextOrder: string[]) => nextOrder.slice(1, -1).reduce((sum, id) => sum + Math.max(0, request.dwellMinutes[id] ?? pointById.get(id)?.defaultDwellMinutes ?? 0), 0);
  const maximumDrivingSeconds = (nextOrder: string[], extraDwell = 0) => (request.workMinutes - dwellForOrder(nextOrder) - Math.max(0, extraDwell)) * 60;
  let order = [request.startId, endId], infeasible = false;
  for (const id of requiredIds.sort()) {
    if (!reachable.includes(id)) {
      infeasible = true;
      continue;
    }
    const dwell = request.dwellMinutes[id] ?? pointById.get(id)?.defaultDwellMinutes ?? 0;
    const insertion = bestInsertion(fixture, order, id, dwell, objective, maximumDrivingSeconds(order, dwell));
    if (!insertion) {
      infeasible = true;
      excluded.push({ pointId: id, pointName: pointById.get(id)?.name ?? id, reason: "unreachable", detail: "必选点无法接入当前起终点路线" });
    } else order = insertion.order;
  }
  const totalWithDwell = (nextOrder: string[]) => {
    const metrics = routeMetrics(fixture, nextOrder);
    return metrics.drivingSeconds / 60 + dwellForOrder(nextOrder);
  };
  const remaining = new Set(reachable.filter(id => !requiredIds.includes(id)));
  while (remaining.size) {
    const options = [...remaining].map(id => {
      const dwell = request.dwellMinutes[id] ?? pointById.get(id)?.defaultDwellMinutes ?? 0;
      const insertion = bestInsertion(fixture, order, id, dwell, objective, maximumDrivingSeconds(order, dwell));
      const value = pointById.get(id)?.inspectionValue ?? 0;
      const addedCost = insertion ? objective === "distance" ? insertion.addedCost : insertion.addedSeconds / 60 : 0;
      return { id, insertion, score: insertion ? value / Math.max(1, addedCost) : -1, value };
    }).filter(option => option.insertion).sort((a, b) => b.score - a.score || b.value - a.value || a.id.localeCompare(b.id));
    const accepted = options.find(option => option.insertion && totalWithDwell(option.insertion.order) <= request.workMinutes);
    if (!accepted?.insertion) break;
    order = accepted.insertion.order;
    remaining.delete(accepted.id);
  }
  const selected = new Set(order.slice(1, -1));
  for (const id of remaining) excluded.push({ pointId: id, pointName: pointById.get(id)?.name ?? id, reason: "time_budget", detail: `加入后将超过 ${request.workMinutes} 分钟工作时长` });
  const selectedInInputOrder = reachable.filter(id => selected.has(id));
  const baselineOrder = [request.startId, ...selectedInInputOrder, endId];
  const nearest = nearestNeighborOrder(fixture, request.startId, selectedInInputOrder, endId, objective).order;
  const drivingBudget = maximumDrivingSeconds(order);
  const candidates = [order, twoOptDirected(fixture, order, objective, drivingBudget), twoOptDirected(fixture, nearest, objective, drivingBudget), twoOptDirected(fixture, baselineOrder, objective, drivingBudget)];
  order = candidates.map(candidateOrder => ({ order: candidateOrder, metrics: routeMetrics(fixture, candidateOrder) }))
    .filter(item => item.metrics.reachable && item.order.length === order.length && item.order.slice(1, -1).every(id => selected.has(id)))
    .sort((a, b) => compareRouteMetrics(a.metrics, b.metrics, objective, drivingBudget) || a.order.join("|").localeCompare(b.order.join("|")))[0]?.order ?? order;
  const metrics = routeMetrics(fixture, order), baseline = routeMetrics(fixture, baselineOrder);
  const dwellMinutes = dwellForOrder(order);
  const drivingMinutes = metrics.drivingSeconds / 60, totalMinutes = drivingMinutes + dwellMinutes;
  return {
    schemaVersion: "roadops-offline-route-plan-v1",
    fixtureId: fixture.fixtureId,
    mode: "offline_demo",
    status: infeasible || !metrics.reachable || totalMinutes > request.workMinutes ? "infeasible" : "ready",
    stopOrder: order,
    selectedCandidateIds: order.slice(1, -1),
    excluded: excluded.sort((a, b) => a.pointId.localeCompare(b.pointId)),
    totalDistanceMeters: Math.round(metrics.distanceMeters),
    drivingMinutes: round(drivingMinutes),
    dwellMinutes: round(dwellMinutes),
    totalMinutes: round(totalMinutes),
    workMinutes: request.workMinutes,
    overtimeMinutes: round(Math.max(0, totalMinutes - request.workMinutes)),
    baselineDistanceMeters: Math.round(baseline.distanceMeters),
    baselineDrivingMinutes: round(baseline.drivingSeconds / 60),
    distanceSavedMeters: Math.max(0, Math.round(baseline.distanceMeters - metrics.distanceMeters)),
    map: mapForOrder(fixture, order, requiredIds),
  };
};

export type RoadOpsPersonalizedRouteResult = {
  status: "ready" | "infeasible";
  stopOrder: string[];
  selectedCandidateIds: string[];
  excluded: RoadOpsRouteExclusion[];
  drivingSeconds: number;
  distanceMeters: number;
  dwellMinutes: number;
  taskSelection: RoadOpsTaskSelection;
};

export class RoadOpsPersonalizedRouteError extends Error {
  constructor(public readonly reason: "unreachable" | "invalid" | "aborted", message: string) {
    super(message);
    this.name = "RoadOpsPersonalizedRouteError";
  }
}

/** Exact bounded matrix search. It never fetches roads or treats missing directed legs as zero. */
export function solveRoadOpsPersonalizedRoute(fixture: RoadOpsRouteFixture, request: RoadOpsDrivingRequest, options: { shouldAbort?: () => boolean } = {}): RoadOpsPersonalizedRouteResult {
  if (options.shouldAbort?.()) throw new RoadOpsPersonalizedRouteError("aborted", "规划已取消。");
  const candidates = request.points.filter(point => point.role === "candidate").map(point => point.id);
  const endId = request.returnToStart ? request.startId : request.endId;
  const tasks: RoadOpsFieldRoutingTask[] = request.fieldTasks ?? request.points.filter(point => point.role === "candidate" || request.detailMode === "field" && point.id === endId).map(point => ({ taskId: point.id, pointId: point.id, dwellSeconds: point.dwellMinutes * 60, required: point.required, priority: "medium" }));
  if (candidates.length > 6 || tasks.length > 20) throw new RoadOpsPersonalizedRouteError("invalid", "个性化规划最多支持 6 个中途停靠和 20 项任务。");
  const goal = request.planningGoal ?? (request.strategy === "5" ? "distance" : "time");
  const variableTasks = goal === "coverage" || goal === "priority";
  const bufferSeconds = request.bufferSeconds ?? 0;
  const workBudgetSeconds = request.workMinutes * 60;
  const drivingLimit = request.drivingBudgetSeconds ?? workBudgetSeconds - bufferSeconds;
  const required = tasks.filter(task => !variableTasks || task.required);
  if (required.some(task => task.eligible === false)) throw new RoadOpsPersonalizedRouteError("invalid", "必查任务或完整任务方案包含未满足进入条件的任务；请先处理约束冲突。");
  const eligibleOptional = tasks.filter(task => variableTasks && !task.required && task.eligible !== false);
  const candidateIndex = new Map(candidates.map((id, index) => [id, index]));
  const stationMask = (task: RoadOpsFieldRoutingTask) => candidateIndex.has(task.pointId) ? 1 << candidateIndex.get(task.pointId)! : 0;
  for (const task of tasks) if (!request.points.some(point => point.id === task.pointId)) throw new RoadOpsPersonalizedRouteError("invalid", "任务停车点不属于到访路线。");
  const taskMask = (selected: RoadOpsFieldRoutingTask[]) => selected.reduce((mask, task) => mask | stationMask(task), 0);
  const requiredMask = taskMask(required);
  type RouteChoice = { order: string[]; distanceMeters: number; drivingSeconds: number };
  const routesByMask = new Map<number, RouteChoice[]>();
  const choicesForMask = (mask: number): RouteChoice[] => {
    const cached = routesByMask.get(mask);
    if (cached) return cached;
    const ids = candidates.filter((_id, index) => mask & 1 << index);
    const routes: RouteChoice[] = [];
    const visit = (middle: string[], remaining: string[]) => {
      if (!remaining.length) {
        const order = [request.startId, ...middle, endId], metrics = routeMetrics(fixture, order);
        if (metrics.reachable && Number.isFinite(metrics.drivingSeconds) && Number.isFinite(metrics.distanceMeters)) routes.push({ order, drivingSeconds: metrics.drivingSeconds, distanceMeters: metrics.distanceMeters });
        return;
      }
      remaining.forEach((id, index) => visit([...middle, id], remaining.filter((_value, offset) => offset !== index)));
    };
    if (request.orderMode === "input") visit(ids, []);
    else visit([], ids);
    routes.sort((a, b) => a.drivingSeconds - b.drivingSeconds || a.distanceMeters - b.distanceMeters || a.order.join("|").localeCompare(b.order.join("|")));
    routesByMask.set(mask, routes);
    return routes;
  };
  const routeFor = (mask: number, dwellSeconds: number, allowOvertime = false) => {
    const routes = choicesForMask(mask);
    const seconds = Math.min(drivingLimit, workBudgetSeconds - bufferSeconds - dwellSeconds);
    if (goal !== "distance") return routes[0] && (routes[0].drivingSeconds <= seconds + 1e-6 || allowOvertime) ? routes[0] : undefined;
    const feasible = routes.filter(route => route.drivingSeconds <= seconds + 1e-6);
    if (goal === "distance" && feasible.length) return [...feasible].sort((a, b) => a.distanceMeters - b.distanceMeters || a.drivingSeconds - b.drivingSeconds || a.order.join("|").localeCompare(b.order.join("|")))[0];
    return feasible[0] ?? (allowOvertime ? routes[0] : undefined);
  };
  const requiredDwell = required.reduce((sum, task) => sum + task.dwellSeconds, 0);
  const initial = routeFor(requiredMask, requiredDwell, true);
  type Selection = { bits: number; route: RouteChoice; dwell: number; count: number; high: number; medium: number; low: number };
  const priorityCount = (selected: RoadOpsFieldRoutingTask[], priority: RoadOpsFieldRoutingTask["priority"]) => selected.filter(task => task.priority === priority).length;
  const requiredHigh = priorityCount(required, "high"), requiredMedium = priorityCount(required, "medium"), requiredLow = priorityCount(required, "low");
  let best: Selection | undefined = initial ? { bits: 0, route: initial, dwell: requiredDwell, count: required.length, high: requiredHigh, medium: requiredMedium, low: requiredLow } : undefined;
  const better = (next: Selection, previous: Selection) => {
    const nextScores = goal === "coverage" ? [next.count, next.high, next.medium] : [next.high, next.medium, next.low];
    const previousScores = goal === "coverage" ? [previous.count, previous.high, previous.medium] : [previous.high, previous.medium, previous.low];
    for (let index = 0; index < nextScores.length; index += 1) if (nextScores[index] !== previousScores[index]) return nextScores[index] > previousScores[index];
    const nextTime = next.route.drivingSeconds + next.dwell, previousTime = previous.route.drivingSeconds + previous.dwell;
    return nextTime < previousTime || nextTime === previousTime && (next.route.distanceMeters < previous.route.distanceMeters || next.route.distanceMeters === previous.route.distanceMeters && next.bits < previous.bits);
  };
  if (variableTasks && requiredDwell + bufferSeconds <= workBudgetSeconds) {
    // Gray-code traversal updates a single task and station count per subset.
    // At most 2^20 subsets; each station subset's <=6! routes are computed once.
    const stationCounts = candidates.map(id => required.filter(task => task.pointId === id).length);
    let bits = 0, mask = requiredMask, dwell = requiredDwell, count = required.length, high = requiredHigh, medium = requiredMedium, low = requiredLow;
    for (let state = 1; state < 2 ** eligibleOptional.length; state += 1) {
      if (state % 1024 === 0 && options.shouldAbort?.()) throw new RoadOpsPersonalizedRouteError("aborted", "规划已取消。");
      const nextBits = state ^ state >> 1, changed = bits ^ nextBits, index = 31 - Math.clz32(changed), task = eligibleOptional[index];
      const direction = nextBits & changed ? 1 : -1;
      bits = nextBits;
      dwell += direction * task.dwellSeconds;
      count += direction;
      if (task.priority === "high") high += direction;
      else if (task.priority === "medium") medium += direction;
      else low += direction;
      const station = candidateIndex.get(task.pointId);
      if (station !== undefined) { stationCounts[station] += direction; mask = stationCounts[station] ? mask | 1 << station : mask & ~(1 << station); }
      const route = routeFor(mask, dwell);
      if (!route) continue;
      const next = { bits, route, dwell, count, high, medium, low };
      if (!best || better(next, best)) best = next;
    }
  }
  if (options.shouldAbort?.()) throw new RoadOpsPersonalizedRouteError("aborted", "规划已取消。");
  if (!best) throw new RoadOpsPersonalizedRouteError("unreachable", "当前有向道路成本下无法连接全部必查停靠；没有删除必查任务生成替代路线。");
  const selected = new Set([...required.map(task => task.taskId), ...eligibleOptional.filter((_task, index) => best.bits & 1 << index).map(task => task.taskId)]);
  const deferredTasks = tasks.filter(task => !selected.has(task.taskId)).map(task => {
    if (task.eligible === false) return { taskId: task.taskId, reason: task.ineligibleReasonCode ?? "access_blocked" as const, detail: task.ineligibleReason ?? "本次进入条件未满足，暂不安排。" };
    const individuallyReachable = choicesForMask(requiredMask | stationMask(task)).length > 0;
    return { taskId: task.taskId, reason: individuallyReachable ? "time_budget" as const : "unreachable" as const, detail: individuallyReachable ? "在保留必查任务和机动时间后，本次工时内未安排；可增加工时或调整任务优先级。" : "当前有向道路成本无法在保留必查任务的同时接入该停车点。" };
  });
  const stopOrder = best.route.order;
  const excluded = candidates.filter(id => !stopOrder.includes(id)).map(id => ({ pointId: id, pointName: request.points.find(point => point.id === id)!.name, reason: deferredTasks.some(task => task.reason === "unreachable" && tasks.find(input => input.taskId === task.taskId)?.pointId === id) ? "unreachable" as const : "time_budget" as const, detail: "该停车点本次没有计划执行任务；任务池和延期原因保留。" }));
  const dwellSeconds = tasks.filter(task => selected.has(task.taskId)).reduce((sum, task) => sum + task.dwellSeconds, 0);
  return {
    status: best.route.drivingSeconds + dwellSeconds + bufferSeconds <= workBudgetSeconds + 1e-6 && best.route.drivingSeconds <= drivingLimit + 1e-6 ? "ready" : "infeasible",
    stopOrder, selectedCandidateIds: stopOrder.slice(1, -1), excluded,
    drivingSeconds: best.route.drivingSeconds, distanceMeters: best.route.distanceMeters, dwellMinutes: dwellSeconds / 60,
    taskSelection: { selectedTaskIds: tasks.filter(task => selected.has(task.taskId)).map(task => task.taskId), deferredTasks, dwellSeconds, bufferSeconds, workBudgetSeconds, drivingBudgetSeconds: Math.max(0, Math.min(drivingLimit, workBudgetSeconds - bufferSeconds - dwellSeconds)) },
  };
}
