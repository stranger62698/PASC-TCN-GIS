import type { RoadOpsDrivingPlan, RoadOpsDrivingRequest } from "./roadops-driving";

export const ROAD_STRATEGY_COMPARISON_MAX_AGE_MS = 30 * 60 * 1000;
export type RoadDrivingStrategy = RoadOpsDrivingRequest["strategy"];
type OrderingObjective = "input_order" | "duration" | "distance";
type PlanningEcho = { requestedStrategy: RoadDrivingStrategy; orderMode: "input" | "optimize"; orderingObjective: OrderingObjective };
type PlanWithPlanning = RoadOpsDrivingPlan & { planning?: PlanningEcho; drivingDurationSeconds?: number };

export type RoadStrategySnapshot = Readonly<{
  inputKey: string;
  requestedStrategy: RoadDrivingStrategy;
  orderingObjective: OrderingObjective;
  orderMode: "input" | "optimize";
  provider: RoadOpsDrivingPlan["provider"];
  mode: RoadOpsDrivingPlan["mode"];
  mapMode: RoadOpsDrivingPlan["map"]["mode"];
  provenanceKey: string;
  generatedAt: string;
  generatedAtMs: number;
  totalDistanceMeters: number;
  drivingDurationSeconds: number;
  stopOrder: readonly string[];
  geometryKey: string | null;
}>;

export type RoadStrategyComparisonUnavailableReason = "input_changed" | "same_strategy" | "invalid_time" | "future_time" | "expired" | "provenance_changed" | "invalid_metrics";
export type RoadStrategyComparison = {
  status: "unavailable";
  reason: RoadStrategyComparisonUnavailableReason;
} | {
  status: "comparable";
  previousStrategy: RoadDrivingStrategy;
  currentStrategy: RoadDrivingStrategy;
  previousGeneratedAt: string;
  currentGeneratedAt: string;
  previousDistanceMeters: number;
  currentDistanceMeters: number;
  distanceDeltaMeters: number;
  previousDurationSeconds: number;
  currentDurationSeconds: number;
  durationDeltaSeconds: number;
  metricsIdentical: boolean;
  stopOrderIdentical: boolean;
  geometry: "identical" | "coordinates_differ" | "unavailable";
};

const strategyLabels: Record<RoadDrivingStrategy, string> = { "1": "默认推荐", "2": "时间优先", "5": "距离更短", "11": "高速优先", "13": "不走高速" };
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function strategyLabel(strategy: RoadDrivingStrategy): string {
  return strategyLabels[strategy] ?? "未知策略";
}

/** An exact, memory-only key. Do not persist, export, or log this coordinate-bearing value. */
export function strategyComparisonInputKey(request: RoadOpsDrivingRequest): string {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    startId: request.startId,
    endId: request.endId,
    returnToStart: request.returnToStart,
    workMinutes: request.workMinutes,
    orderMode: request.orderMode ?? "optimize",
    detailMode: request.detailMode ?? "overview",
    points: request.points.map(point => ({
      id: point.id,
      role: point.role,
      coordinate: [point.coordinate[0], point.coordinate[1]],
      dwellMinutes: point.dwellMinutes,
      required: point.required,
      inspectionValue: point.inspectionValue,
    })),
  });
}

function geometryKey(plan: RoadOpsDrivingPlan): string | null {
  if (!plan.map.features.length) return null;
  const legs = [];
  for (const feature of plan.map.features) {
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== "LineString" || !Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(point => Array.isArray(point) && point.length === 2 && typeof point[0] === "number" && Number.isFinite(point[0]) && point[0] >= -180 && point[0] <= 180 && typeof point[1] === "number" && Number.isFinite(point[1]) && point[1] >= -90 && point[1] <= 90)) return null;
    legs.push({ from: feature.properties.from, to: feature.properties.to, coordinates });
  }
  return JSON.stringify(legs);
}

/** Bind to the request actually sent, never the current editable draft or rounded minutes. */
export function createStrategySnapshot(request: RoadOpsDrivingRequest, plan: RoadOpsDrivingPlan): RoadStrategySnapshot | null {
  const response = plan as PlanWithPlanning;
  const orderMode = request.orderMode ?? "optimize";
  const objective: OrderingObjective = orderMode === "input" ? "input_order" : request.strategy === "5" ? "distance" : "duration";
  if (plan.status !== "ready" || !response.planning || response.planning.requestedStrategy !== request.strategy || response.planning.orderMode !== orderMode || response.planning.orderingObjective !== objective || !nonnegative(response.drivingDurationSeconds) || !nonnegative(plan.totalDistanceMeters)) return null;
  const expectedProvider = plan.mode === "didi_live" ? "didi_web_service" : "didi_contract_replay";
  const sources = [...new Set(plan.map.features.map(feature => feature.properties.source))].sort();
  if (plan.provider !== expectedProvider || plan.map.mode !== plan.mode || sources.some(source => source !== expectedProvider)) return null;
  return Object.freeze({
    inputKey: strategyComparisonInputKey(request),
    requestedStrategy: request.strategy,
    orderingObjective: objective,
    orderMode,
    provider: plan.provider,
    mode: plan.mode,
    mapMode: plan.map.mode,
    provenanceKey: JSON.stringify([...new Set([expectedProvider, ...sources])].sort()),
    generatedAt: plan.generatedAt,
    generatedAtMs: Date.parse(plan.generatedAt),
    totalDistanceMeters: plan.totalDistanceMeters,
    drivingDurationSeconds: response.drivingDurationSeconds,
    stopOrder: Object.freeze([...plan.stopOrder]),
    geometryKey: geometryKey(plan),
  });
}

export function compareStrategySnapshots(previous: RoadStrategySnapshot, current: RoadStrategySnapshot, nowMs = Date.now()): RoadStrategyComparison {
  const unavailable = (reason: RoadStrategyComparisonUnavailableReason): RoadStrategyComparison => ({ status: "unavailable", reason });
  if (previous.inputKey !== current.inputKey) return unavailable("input_changed");
  if (previous.requestedStrategy === current.requestedStrategy) return unavailable("same_strategy");
  if (previous.provider !== current.provider || previous.mode !== current.mode || previous.mapMode !== current.mapMode || previous.provenanceKey !== current.provenanceKey) return unavailable("provenance_changed");
  if (![nowMs, previous.generatedAtMs, current.generatedAtMs].every(Number.isFinite)) return unavailable("invalid_time");
  if (previous.generatedAtMs > nowMs || current.generatedAtMs > nowMs) return unavailable("future_time");
  if (nowMs - previous.generatedAtMs > ROAD_STRATEGY_COMPARISON_MAX_AGE_MS || nowMs - current.generatedAtMs > ROAD_STRATEGY_COMPARISON_MAX_AGE_MS) return unavailable("expired");
  if (![previous.totalDistanceMeters, current.totalDistanceMeters, previous.drivingDurationSeconds, current.drivingDurationSeconds].every(nonnegative)) return unavailable("invalid_metrics");
  const distanceDeltaMeters = current.totalDistanceMeters - previous.totalDistanceMeters;
  const durationDeltaSeconds = current.drivingDurationSeconds - previous.drivingDurationSeconds;
  return {
    status: "comparable",
    previousStrategy: previous.requestedStrategy,
    currentStrategy: current.requestedStrategy,
    previousGeneratedAt: previous.generatedAt,
    currentGeneratedAt: current.generatedAt,
    previousDistanceMeters: previous.totalDistanceMeters,
    currentDistanceMeters: current.totalDistanceMeters,
    distanceDeltaMeters,
    previousDurationSeconds: previous.drivingDurationSeconds,
    currentDurationSeconds: current.drivingDurationSeconds,
    durationDeltaSeconds,
    metricsIdentical: distanceDeltaMeters === 0 && durationDeltaSeconds === 0,
    stopOrderIdentical: previous.stopOrder.length === current.stopOrder.length && previous.stopOrder.every((id, index) => id === current.stopOrder[index]),
    geometry: previous.geometryKey === null || current.geometryKey === null ? "unavailable" : previous.geometryKey === current.geometryKey ? "identical" : "coordinates_differ",
  };
}
