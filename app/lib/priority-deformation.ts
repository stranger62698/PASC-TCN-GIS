import type { InsarPoint } from "../data/site.js";
import { buildAnomalyRegions, type AnomalyRegionResult } from "./anomaly-regions.js";

export const PRIORITY_RULE_VERSION = "magnitude-spatial-v2";
export const DEFAULT_MAX_MISSING_RATE = 0.2;
export type PriorityDirection = "both" | "negative" | "positive";
export const DEFAULT_PRIORITY_OPTIONS = {
  velocityMmPerYear: 10, displacementMm: 30, direction: "both" as PriorityDirection,
  coherenceThreshold: 0.75, maxMissingRate: DEFAULT_MAX_MISSING_RATE,
  radiusMeters: 60, minimumPoints: 5, maximumCandidates: 50_000,
};
export type PriorityDeformationOptions = Partial<typeof DEFAULT_PRIORITY_OPTIONS> & { evaluationDate?: string };
export type ResolvedPriorityOptions = typeof DEFAULT_PRIORITY_OPTIONS & { evaluationDate?: string };
export type PriorityThresholds = { displacementMm: number; velocityMmPerYear: number };
export type PriorityDeformationSelection = {
  ruleVersion: typeof PRIORITY_RULE_VERSION;
  thresholds: PriorityThresholds;
  direction: PriorityDirection;
  options: ResolvedPriorityOptions;
  amplitudeCandidates: InsarPoint[];
  /** Joint amplitude candidates passing quality, before clustering. */
  candidates: InsarPoint[];
  /** Only points with spatial support are final anomalies. */
  anomalies: InsarPoint[];
  reliable: InsarPoint[];
  limited: InsarPoint[];
  isolated: InsarPoint[];
  excludedLowQuality: InsarPoint[];
  invalid: InsarPoint[];
  regions: AnomalyRegionResult;
};
export const PRIORITY_DEFORMATION_RULE = "速率与累计形变量同时达到幅值下限且同号，通过质量门控后按同方向空间密度聚集；孤立大值不计入聚集异常";
const bounded = (value: number | undefined, fallback: number, minimum: number, maximum: number) =>
  value !== undefined && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
export function normalizePriorityOptions(options: PriorityDeformationOptions = {}): ResolvedPriorityOptions {
  return {
    velocityMmPerYear: bounded(options.velocityMmPerYear, DEFAULT_PRIORITY_OPTIONS.velocityMmPerYear, 0.1, 1_000_000),
    displacementMm: bounded(options.displacementMm, DEFAULT_PRIORITY_OPTIONS.displacementMm, 0.1, 1_000_000),
    direction: options.direction === "negative" || options.direction === "positive" ? options.direction : "both",
    coherenceThreshold: bounded(options.coherenceThreshold, DEFAULT_PRIORITY_OPTIONS.coherenceThreshold, 0, 1),
    maxMissingRate: bounded(options.maxMissingRate, DEFAULT_MAX_MISSING_RATE, 0, 1),
    radiusMeters: bounded(options.radiusMeters, DEFAULT_PRIORITY_OPTIONS.radiusMeters, 25, 5_000),
    minimumPoints: Math.round(bounded(options.minimumPoints, DEFAULT_PRIORITY_OPTIONS.minimumPoints, 3, 50)),
    maximumCandidates: Math.round(bounded(options.maximumCandidates, DEFAULT_PRIORITY_OPTIONS.maximumCandidates, 1_000, 50_000)),
    ...(options.evaluationDate ? { evaluationDate: options.evaluationDate } : {}),
  };
}
/** Read only the requested observation; never substitute the final displacement. */
export function displacementAt(point: InsarPoint, timeIndex: number, evaluationDate?: string): number {
  if (point.observedEvaluationDate !== undefined && (evaluationDate ?? point.dates?.[timeIndex]) === point.observedEvaluationDate) return Number.isFinite(point.observedDisplacement) ? point.observedDisplacement! : Number.NaN;
  if (point.observedSeries && point.observedDates) {
    const requestedDate = evaluationDate ?? point.dates?.[timeIndex];
    const observedIndex = requestedDate ? point.observedDates.indexOf(requestedDate) : timeIndex;
    if (observedIndex < 0 || observedIndex >= point.observedSeries.length || (point.observedMask && !point.observedMask[observedIndex])) return Number.NaN;
    const observed = point.observedSeries[observedIndex];
    return Number.isFinite(observed) ? observed : Number.NaN;
  }
  if (point.observedEvaluationDate !== undefined) {
    const requestedDate = evaluationDate ?? point.dates?.[timeIndex];
    return requestedDate === point.observedEvaluationDate && Number.isFinite(point.observedDisplacement) ? point.observedDisplacement! : Number.NaN;
  }
  const index = evaluationDate && point.dates?.length ? point.dates.indexOf(evaluationDate) : timeIndex;
  if (!Number.isInteger(index) || index < 0 || index >= point.series.length) return Number.NaN;
  const value = point.series[index];
  return Number.isFinite(value) ? value : Number.NaN;
}
const hasValidCoordinates = (point: InsarPoint) => Number.isFinite(point.lon) && Number.isFinite(point.lat)
  && point.lon >= -180 && point.lon <= 180 && point.lat >= -90 && point.lat <= 90
  && (point.lon !== 0 || point.lat !== 0);
const hasValidVelocity = (point: InsarPoint) => Number.isFinite(point.velocity)
  && (point.velocitySource === undefined || point.velocitySource === "provided" || point.velocitySource === "calculated");
export function isPriorityDeformationPoint(
  point: InsarPoint, timeIndex: number, thresholds: PriorityThresholds,
  direction: PriorityDirection = "both", evaluationDate?: string,
) {
  const displacement = displacementAt(point, timeIndex, evaluationDate);
  return hasValidCoordinates(point) && hasValidVelocity(point) && Number.isFinite(displacement)
    && Number.isFinite(thresholds.displacementMm) && thresholds.displacementMm > 0
    && Number.isFinite(thresholds.velocityMmPerYear) && thresholds.velocityMmPerYear > 0
    && Math.abs(displacement) >= thresholds.displacementMm && Math.abs(point.velocity) >= thresholds.velocityMmPerYear
    && Math.sign(displacement) === Math.sign(point.velocity)
    && (direction === "both" || (direction === "negative" ? point.velocity < 0 : point.velocity > 0));
}
function qualityState(point: InsarPoint, coherenceThreshold: number, maxMissingRate: number): "reliable" | "unknown" | "excluded" {
  const coherenceKnown = Number.isFinite(point.coherence) && point.coherence >= 0 && point.coherence <= 1
    && (point.coherenceSource === undefined || point.coherenceSource === "provided" || point.coherenceSource === "calculated");
  const missingKnown = Number.isFinite(point.missingRate) && point.missingRate >= 0 && point.missingRate <= 1;
  const sourceSeries = point.observedSeries ?? point.series;
  let validCount = 0;
  if (point.localSeriesIndex === undefined) for (let index = 0; index < sourceSeries.length; index += 1) if (Number.isFinite(sourceSeries[index]) && (!point.observedMask || point.observedMask[index])) validCount += 1;
  const observedMissingRate = Number.isFinite(point.observedMissingRate) ? point.observedMissingRate! : point.localSeriesIndex !== undefined && Number.isFinite(point.missingRate) ? point.missingRate : sourceSeries.length ? 1 - validCount / sourceSeries.length : point.observedEvaluationDate !== undefined && Number.isFinite(point.missingRate) ? point.missingRate : NaN;
  if ((coherenceKnown && point.coherence < coherenceThreshold)
    || (Number.isFinite(point.missingRate) && point.missingRate > maxMissingRate)
    || observedMissingRate > maxMissingRate + Number.EPSILON) return "excluded";
  return coherenceKnown && missingKnown ? "reliable" : "unknown";
}
export function isPriorityQualityReliable(point: InsarPoint, coherenceThreshold: number, maxMissingRate = DEFAULT_MAX_MISSING_RATE) {
  return qualityState(point, coherenceThreshold, maxMissingRate) === "reliable";
}
export function selectPriorityDeformationPoints(
  points: readonly InsarPoint[], timeIndex: number, options: PriorityDeformationOptions = {},
  modeForPoint?: (point: InsarPoint) => string,
): PriorityDeformationSelection {
  const resolved = normalizePriorityOptions(options);
  const thresholds = { displacementMm: resolved.displacementMm, velocityMmPerYear: resolved.velocityMmPerYear };
  const amplitudeCandidates: InsarPoint[] = [], candidates: InsarPoint[] = [], excludedLowQuality: InsarPoint[] = [], invalid: InsarPoint[] = [];
  const reliableCandidates = new Set<InsarPoint>();
  for (const point of points) {
    if (!hasValidCoordinates(point) || !hasValidVelocity(point) || !Number.isFinite(displacementAt(point, timeIndex, resolved.evaluationDate))) {
      invalid.push(point);
      continue;
    }
    if (!isPriorityDeformationPoint(point, timeIndex, thresholds, resolved.direction, resolved.evaluationDate)) continue;
    amplitudeCandidates.push(point);
    const quality = qualityState(point, resolved.coherenceThreshold, resolved.maxMissingRate);
    if (quality === "excluded") excludedLowQuality.push(point);
    else {
      candidates.push(point);
      if (quality === "reliable") reliableCandidates.add(point);
    }
  }
  const regions = buildAnomalyRegions(candidates, {
    radiusMeters: resolved.radiusMeters, minimumPoints: resolved.minimumPoints,
    maximumCandidates: resolved.maximumCandidates, sameDirection: true,
  }, timeIndex, modeForPoint, point => displacementAt(point, timeIndex, resolved.evaluationDate));
  const assignedIds = new Set(regions.regions.flatMap(region => region.pointIds));
  const anomalies = candidates.filter(point => assignedIds.has(point.id));
  const reliable = anomalies.filter(point => reliableCandidates.has(point));
  const limited = anomalies.filter(point => !reliableCandidates.has(point));
  // Candidates are unassessed when the safety limit refuses clustering.
  const isolated = regions.status === "ready" ? candidates.filter(point => !assignedIds.has(point.id)) : [];
  return { ruleVersion: PRIORITY_RULE_VERSION, thresholds, direction: resolved.direction, options: resolved,
    amplitudeCandidates, candidates, anomalies, reliable, limited, isolated, excludedLowQuality, invalid, regions };
}
export function formatPriorityDeformationRule(selection: PriorityDeformationSelection) {
  const direction = selection.direction === "negative" ? "负向" : selection.direction === "positive" ? "正向" : "正负双向分别聚集";
  const options = selection.options;
  const countLabel = selection.regions.status === "too_large" ? "候选过多，尚未聚集" : `聚集异常 ${selection.anomalies.length} 点，质量可靠 ${selection.reliable.length} 点，质量未知 ${selection.limited.length} 点，孤立候选 ${selection.isolated.length} 点`;
  return `${direction}：|年均速率| ≥ ${options.velocityMmPerYear} mm/yr 且 |累计形变量| ≥ ${options.displacementMm} mm，并且同号；相干性 ≥ ${options.coherenceThreshold}、缺测率 ≤ ${Math.round(options.maxMissingRate * 100)}%（未知质量单列待核实）；DBSCAN 邻域 ${options.radiusMeters} m，至少 ${options.minimumPoints} 个不同坐标点（含自身）；${countLabel}`;
}
