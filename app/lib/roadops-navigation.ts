import { assertRoadOpsPlanningMatches, parseRoadOpsDrivingPlan, type RoadOpsDrivingPlan, type RoadOpsDrivingRequest, type RoadOpsPlanningGoal } from "./roadops-driving";
import type { FieldVisitInput } from "./roadops-field";

export type NavigationInspectionSource = {
  schemaVersion: "inspection-navigation-source-v1";
  kind: "point" | "region";
  datasetId: string;
  analysisId: string;
  datasetTitle: string;
  observationDate: string;
  ruleSummary: string;
  representativePointId: string;
  sourceCoordinate: [number, number];
  representativeSelection: "selected-point" | "nearest-member-to-centroid";
  regionId?: string;
  regionPointCount?: number;
  regionMembershipId?: string;
  targetAdjusted: boolean;
  /** Legacy sources without a choice are treated as unconfirmed. This is not access permission. */
  arrivalSelection?: "unconfirmed" | "target" | "custom";
};

export type NavigationPoint = {
  id: string;
  name: string;
  coordinate: [number, number] | null;
  role: "origin" | "destination" | "candidate";
  vehicleCoordinate?: [number, number] | null;
  dwellMinutes?: number;
  accessReview?: FieldVisitInput["accessReview"];
  accessNote?: string;
  inspectionSource?: NavigationInspectionSource;
};

export type NavigationDraft = {
  origin: NavigationPoint;
  destination: NavigationPoint;
  waypoints: NavigationPoint[];
  strategy: RoadOpsDrivingRequest["strategy"];
  optimize: boolean;
  startTime?: string;
  workMinutes?: number;
  bufferMinutes?: number;
  planningGoal?: RoadOpsPlanningGoal;
};

export const NAVIGATION_MAX_WAYPOINTS = 6;

export function createNavigationDraft(): NavigationDraft {
  return {
    origin: { id: "navigation-origin", name: "起点", coordinate: null, role: "origin" },
    destination: { id: "navigation-destination", name: "终点", coordinate: null, role: "destination" },
    waypoints: [],
    strategy: "1",
    optimize: false,
    startTime: "08:30", workMinutes: 480, bufferMinutes: 30,
  };
}

export function navigationPoints(draft: NavigationDraft): NavigationPoint[] {
  return [draft.origin, ...draft.waypoints, draft.destination];
}

export function navigationMapPoints(draft: NavigationDraft): Array<Omit<NavigationPoint, "coordinate"> & { coordinate: [number, number]; index: number }> {
  return navigationPoints(draft).flatMap((point, index) => point.coordinate ? [{ ...point, name: navigationPointName(draft, point), coordinate: [...(point.vehicleCoordinate ?? point.coordinate)] as [number, number], index }] : []);
}

export function navigationFieldVisits(draft: NavigationDraft): FieldVisitInput[] {
  return navigationPoints(draft).flatMap(point => point.coordinate ? [{ id: point.id, name: navigationPointName(draft, point), coordinate: [...point.coordinate], vehicleCoordinate: point.vehicleCoordinate ? [...point.vehicleCoordinate] : null,
    dwellMinutes: point.role === "origin" ? 0 : (point.dwellMinutes ?? (point.role === "candidate" ? 20 : 0)), accessReview: point.accessReview ?? "unknown", accessNote: point.accessNote ?? "" }] : []);
}

/** Work and service budgets affect the solver; names, notes and clock display stay local. */
export function navigationRouteSignature(draft: NavigationDraft): string {
  return JSON.stringify({ points: navigationPoints(draft).map(point => [point.id, point.coordinate, point.vehicleCoordinate ?? null, point.role === "origin" ? 0 : point.dwellMinutes ?? (point.role === "candidate" ? 20 : 0)]), strategy: draft.strategy, optimize: draft.optimize, planningGoal: draft.planningGoal ?? (draft.strategy === "5" ? "distance" : "time"), workMinutes: draft.workMinutes ?? 480, bufferMinutes: draft.bufferMinutes ?? 30 });
}

export function updateNavigationPoint(draft: NavigationDraft, id: string, patch: Partial<Pick<NavigationPoint, "name" | "dwellMinutes" | "accessReview" | "accessNote">>): NavigationDraft {
  const update = (point: NavigationPoint) => point.id === id ? { ...point, ...patch } : point;
  return { ...draft, origin: update(draft.origin), destination: update(draft.destination), waypoints: draft.waypoints.map(update) };
}

export function navigationPickLabel(draft: NavigationDraft, id: string): string {
  if (id.startsWith("vehicle:")) return `${navigationPickLabel(draft, id.slice(8))}车辆到达点`;
  if (id === draft.origin.id) return "起点";
  if (id === draft.destination.id) return "终点";
  const index = draft.waypoints.findIndex(point => point.id === id);
  return index >= 0 ? `途经点 ${index + 1}` : "点位";
}

function navigationPointName(draft: NavigationDraft, point: NavigationPoint): string {
  const name = point.name.trim().slice(0, 80);
  return !name || /^(起点|终点|途经点\s+\d+)$/.test(name) ? navigationPickLabel(draft, point.id) : name;
}

export function setNavigationCoordinate(draft: NavigationDraft, id: string, coordinate: [number, number] | null): NavigationDraft {
  const vehicle = id.startsWith("vehicle:"), targetId = vehicle ? id.slice(8) : id;
  const update = (point: NavigationPoint): NavigationPoint => point.id === targetId ? { ...point,
    ...(vehicle ? { vehicleCoordinate: coordinate ? [...coordinate] as [number, number] : null } : { coordinate: coordinate ? [...coordinate] as [number, number] : null, vehicleCoordinate: null }),
    ...(point.inspectionSource ? { inspectionSource: { ...point.inspectionSource,
      arrivalSelection: vehicle && coordinate ? "custom" : "unconfirmed",
      ...(!vehicle ? { targetAdjusted: !coordinate || coordinate.some((value, index) => value !== point.inspectionSource!.sourceCoordinate[index]) } : {}),
    } } : {}),
    accessReview: "unknown", accessNote: "",
  } : point;
  return { ...draft, origin: update(draft.origin), destination: update(draft.destination), waypoints: draft.waypoints.map(update) };
}

/** An explicit choice of routing input never confirms parking or site access. */
export function confirmInspectionNavigationTarget(draft: NavigationDraft, id: string): NavigationDraft {
  const selected = navigationPoints(draft).find(point => point.id === id);
  if (!selected?.coordinate || !selected.inspectionSource) throw new Error("请先选择有分析来源的核查目标。");
  const cleared = setNavigationCoordinate(draft, `vehicle:${id}`, null);
  const update = (point: NavigationPoint): NavigationPoint => point.id === id ? {
    ...point, inspectionSource: { ...point.inspectionSource!, arrivalSelection: "target" },
  } : point;
  return { ...cleared, origin: update(cleared.origin), destination: update(cleared.destination), waypoints: cleared.waypoints.map(update) };
}

export type NavigationAnalysisContext = { currentDatasetId?: string | null; currentAnalysisId?: string | null };
export type NavigationInspectionIssue = { pointId: string; kind: "stale" | "arrival"; message: string };

export function navigationInspectionIssues(draft: NavigationDraft, context: NavigationAnalysisContext = {}): NavigationInspectionIssue[] {
  return navigationPoints(draft).flatMap<NavigationInspectionIssue>(point => {
    const source = point.inspectionSource;
    if (!source) return [];
    const label = navigationPickLabel(draft, point.id);
    if ((context.currentDatasetId !== undefined && context.currentDatasetId !== source.datasetId)
      || (context.currentAnalysisId !== undefined && context.currentAnalysisId !== source.analysisId)) {
      return [{ pointId: point.id, kind: "stale" as const, message: `${label}的分析来源已过期；请删除此点，再从当前分析候选加入。` }];
    }
    if ((source.arrivalSelection === "target" && !point.vehicleCoordinate)
      || (source.arrivalSelection === "custom" && !!point.vehicleCoordinate)) return [];
    return [{ pointId: point.id, kind: "arrival" as const, message: `请明确选择${label}的算路位置：使用目标位置，或另设车辆到达点；入口仍待核验。` }];
  });
}

export function addNavigationWaypoint(draft: NavigationDraft): NavigationDraft {
  if (draft.waypoints.length >= NAVIGATION_MAX_WAYPOINTS) throw new Error(`本次最多添加 ${NAVIGATION_MAX_WAYPOINTS} 个途经点。`);
  const ids = new Set(navigationPoints(draft).map(point => point.id));
  // A deleted visit must not donate its identity to a newly created persisted task.
  let id: string;
  do { id = `navigation-waypoint-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; } while (ids.has(id));
  return { ...draft, waypoints: [...draft.waypoints, { id, name: `途经点 ${draft.waypoints.length + 1}`, coordinate: null, role: "candidate", dwellMinutes: 20 }] };
}

export function moveNavigationWaypoint(draft: NavigationDraft, id: string, direction: -1 | 1): NavigationDraft {
  const index = draft.waypoints.findIndex(point => point.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= draft.waypoints.length) return draft;
  const waypoints = [...draft.waypoints];
  [waypoints[index], waypoints[target]] = [waypoints[target], waypoints[index]];
  return { ...draft, waypoints };
}

export function swapNavigationEndpoints(draft: NavigationDraft): NavigationDraft {
  return {
    ...draft,
    origin: { ...draft.destination, id: draft.origin.id, role: "origin", coordinate: draft.destination.coordinate ? [...draft.destination.coordinate] : null, name: "起点", dwellMinutes: 0 },
    destination: { ...draft.origin, id: draft.destination.id, role: "destination", coordinate: draft.origin.coordinate ? [...draft.origin.coordinate] : null, name: "终点", dwellMinutes: 0 },
  };
}

export function buildNavigationRequest(draft: NavigationDraft, context: NavigationAnalysisContext = {}): RoadOpsDrivingRequest {
  if (draft.planningGoal === "coverage" || draft.planningGoal === "priority") throw new Error("限时多查和重点核查需要设置必查、可延期与优先级，请使用完整外业任务入口。");
  if (draft.planningGoal !== undefined && draft.planningGoal !== "time" && draft.planningGoal !== "distance") throw new Error("请选择有效的核查规划需求。");
  const inspectionIssue = navigationInspectionIssues(draft, context)[0];
  if (inspectionIssue) throw new Error(inspectionIssue.message);
  if (draft.waypoints.length > NAVIGATION_MAX_WAYPOINTS) throw new Error(`本次最多支持 ${NAVIGATION_MAX_WAYPOINTS} 个途经点。`);
  if (draft.origin.role !== "origin" || draft.destination.role !== "destination" || draft.waypoints.some(point => point.role !== "candidate")) throw new Error("点位角色无效，请清空后重新选择。");
  if (!["1", "2", "5", "11", "13"].includes(draft.strategy)) throw new Error("请选择有效的驾车策略。");
  if (!Number.isFinite(draft.workMinutes ?? 480) || (draft.workMinutes ?? 480) < 30 || (draft.workMinutes ?? 480) > 720) throw new Error("可用工时应为 30–720 分钟。");
  if (!Number.isFinite(draft.bufferMinutes ?? 30) || (draft.bufferMinutes ?? 30) < 0) throw new Error("机动时间不能为负数。");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.startTime ?? "08:30")) throw new Error("请填写有效的出发时间。");
  const ids = new Set<string>();
  const coordinates = new Set<string>();
  const points = navigationPoints(draft).map(point => {
    const label = navigationPickLabel(draft, point.id);
    if (!point.id || ids.has(point.id)) throw new Error("点位标识重复，请清空后重新选择。");
    ids.add(point.id);
    if (!point.coordinate) throw new Error(`请先在地图上选择${label}。`);
    const [longitude, latitude] = point.vehicleCoordinate ?? point.coordinate;
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error(`${label}坐标无效；请使用 WGS84 经度、纬度。`);
    const coordinate: [number, number] = [Number(longitude.toFixed(6)), Number(latitude.toFixed(6))];
    const key = coordinate.join(",");
    if (coordinates.has(key)) throw new Error("起点、终点和途经点不能重合，请重新选点或删除重复点。");
    coordinates.add(key);
    const dwellMinutes = point.role === "origin" ? 0 : (point.dwellMinutes ?? (point.role === "candidate" ? 20 : 0));
    if (!Number.isFinite(dwellMinutes) || dwellMinutes < 0 || dwellMinutes > 180) throw new Error(`${label}停留应为 0–180 分钟。`);
    return { id: point.id, role: point.role, name: navigationPointName(draft, point), coordinate, dwellMinutes, inspectionValue: 0, required: point.role === "candidate", sourceFeatureId: null, sourceRoadName: "用户指定车辆到达点 · 入口未由地图商核验" };
  });
  const workMinutes = draft.workMinutes ?? 480, bufferSeconds = (draft.bufferMinutes ?? 30) * 60;
  const drivingBudgetSeconds = workMinutes * 60 - points.reduce((sum, point) => sum + point.dwellMinutes * 60, 0) - bufferSeconds;
  if (drivingBudgetSeconds < 0) throw new Error("现场停留和机动时间已超过可用工时，请调整耗时或工时；未发送道路请求。");
  return { schemaVersion: "roadops-driving-request-v1", startId: draft.origin.id, endId: draft.destination.id, returnToStart: false, workMinutes, strategy: draft.strategy, orderMode: draft.optimize ? "optimize" : "input", detailMode: "field", planningGoal: draft.planningGoal ?? (draft.strategy === "5" ? "distance" : "time"), drivingBudgetSeconds, bufferSeconds, points };
}

/** The HTTP handler returns an envelope, not the plan object itself. */
export function parseNavigationResponse(value: unknown, request: RoadOpsDrivingRequest): RoadOpsDrivingPlan {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("plan" in value)) throw new Error("路线服务响应缺少 plan 数据，请检查本地服务版本。");
  const result = parseRoadOpsDrivingPlan(value.plan);
  assertRoadOpsPlanningMatches(result, request);
  if (result.mode !== "didi_live" || result.provider !== "didi_web_service" || result.map.mode !== "didi_live" || result.map.features.length === 0) throw new Error("服务未返回滴图真实驾车路线，未绘制任何替代路线。");
  const expectedIds = [request.startId, ...request.points.filter(point => point.role === "candidate").map(point => point.id), request.endId];
  if (result.stopOrder.length !== expectedIds.length || new Set(result.stopOrder).size !== expectedIds.length || expectedIds.some(id => !result.stopOrder.includes(id)) || result.stopOrder[0] !== request.startId || result.stopOrder.at(-1) !== request.endId) throw new Error("返回路线没有完整经过全部指定点位，未展示不完整方案。");
  if (request.orderMode === "input" && result.stopOrder.some((id, index) => id !== expectedIds[index])) throw new Error("返回路线与手动途经顺序不一致，请检查路线服务。");
  return result;
}
