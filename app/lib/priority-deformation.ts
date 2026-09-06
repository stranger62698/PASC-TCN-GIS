import type { InsarPoint } from "../data/site.js";

export const PRIORITY_RULE_VERSION = "negative-tail-v1";
export const DEFAULT_PRIORITY_TAIL_PERCENT = 5;
export const MIN_PRIORITY_TAIL_PERCENT = 1;
export const MAX_PRIORITY_TAIL_PERCENT = 20;
export const DEFAULT_MAX_MISSING_RATE = 0.2;

export type PriorityThresholds = {
  displacementMm: number | null;
  velocityMmPerYear: number | null;
};

export type PriorityDeformationSelection = {
  ruleVersion: typeof PRIORITY_RULE_VERSION;
  tailPercent: number;
  thresholds: PriorityThresholds;
  candidates: InsarPoint[];
  reliable: InsarPoint[];
  limited: InsarPoint[];
};

export type PriorityDeformationOptions = {
  tailPercent?: number;
  coherenceThreshold?: number;
  maxMissingRate?: number;
};

export const PRIORITY_DEFORMATION_RULE = "累计形变量与年均速率同时位于当前数据集的负向单侧尾部；数据质量单独分层";

export function displacementAt(point: InsarPoint, timeIndex: number) {
  const index = Math.min(Math.max(0, timeIndex), Math.max(0, point.series.length - 1));
  return point.series[index] ?? point.displacement;
}

export function clampPriorityTailPercent(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_PRIORITY_TAIL_PERCENT;
  return Math.min(MAX_PRIORITY_TAIL_PERCENT, Math.max(MIN_PRIORITY_TAIL_PERCENT, value));
}

export function empiricalQuantile(values: readonly number[], percentile: number) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const clamped = Math.min(1, Math.max(0, percentile));
  const position = (sorted.length - 1) * clamped;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

export function calculatePriorityThresholds(
  points: readonly InsarPoint[],
  timeIndex: number,
  tailPercent = DEFAULT_PRIORITY_TAIL_PERCENT,
): PriorityThresholds {
  const percentile = clampPriorityTailPercent(tailPercent) / 100;
  return {
    displacementMm: empiricalQuantile(points.map(point => displacementAt(point, timeIndex)), percentile),
    velocityMmPerYear: empiricalQuantile(points.map(point => point.velocity), percentile),
  };
}

export function isPriorityDeformationPoint(
  point: InsarPoint,
  timeIndex: number,
  thresholds: PriorityThresholds,
) {
  const displacement = displacementAt(point, timeIndex);
  return thresholds.displacementMm !== null
    && thresholds.velocityMmPerYear !== null
    && thresholds.displacementMm < 0
    && thresholds.velocityMmPerYear < 0
    && Number.isFinite(displacement)
    && Number.isFinite(point.velocity)
    && displacement < 0
    && point.velocity < 0
    && displacement <= thresholds.displacementMm
    && point.velocity <= thresholds.velocityMmPerYear;
}

export function isPriorityQualityReliable(
  point: InsarPoint,
  coherenceThreshold: number,
  maxMissingRate = DEFAULT_MAX_MISSING_RATE,
) {
  return Number.isFinite(point.coherence)
    && point.coherence > 0
    && point.coherence >= coherenceThreshold
    && Number.isFinite(point.missingRate)
    && point.missingRate <= maxMissingRate;
}

export function selectPriorityDeformationPoints(
  points: readonly InsarPoint[],
  timeIndex: number,
  options: PriorityDeformationOptions = {},
): PriorityDeformationSelection {
  const tailPercent = clampPriorityTailPercent(options.tailPercent ?? DEFAULT_PRIORITY_TAIL_PERCENT);
  const coherenceThreshold = options.coherenceThreshold ?? 0.75;
  const maxMissingRate = options.maxMissingRate ?? DEFAULT_MAX_MISSING_RATE;
  const thresholds = calculatePriorityThresholds(points, timeIndex, tailPercent);
  const candidates = points.filter(point => isPriorityDeformationPoint(point, timeIndex, thresholds));
  const reliable: InsarPoint[] = [];
  const limited: InsarPoint[] = [];
  candidates.forEach(point => {
    (isPriorityQualityReliable(point, coherenceThreshold, maxMissingRate) ? reliable : limited).push(point);
  });
  return { ruleVersion: PRIORITY_RULE_VERSION, tailPercent, thresholds, candidates, reliable, limited };
}

function thresholdLabel(value: number | null, unit: string) {
  return value === null ? "不可计算" : `≤ ${value.toFixed(2)} ${unit}`;
}

export function formatPriorityDeformationRule(selection: PriorityDeformationSelection) {
  return `当前数据集负向单侧 ${selection.tailPercent}%：累计形变量 ${thresholdLabel(selection.thresholds.displacementMm, "mm")}，且年均速率 ${thresholdLabel(selection.thresholds.velocityMmPerYear, "mm/yr")}；可靠 ${selection.reliable.length} 点，质量受限 ${selection.limited.length} 点`;
}
