import type { InsarPoint } from "../data/site.js";
import type { AnalysisMapView, SelectedRegion } from "./analysis-context.js";
import { PASC_MODEL_VERSION } from "../types/pasc.js";
import { normalizedMode } from "./analysis-context.js";

export const ANALYSIS_SUMMARY_SCHEMA_VERSION = "analysis-summary-v1" as const;
export const ANALYSIS_SUMMARY_MAX_BYTES = 12_000;

export type AnalysisSummary = {
  schemaVersion: typeof ANALYSIS_SUMMARY_SCHEMA_VERSION;
  scope: "current_result" | "selected_region";
  datasetLabel: string;
  pointCount: number;
  timeRange: { startDate: string; endDate: string };
  modeDistribution: Array<{ mode: string; count: number; percentage: number; meanConfidence: number | null }>;
  velocityStats: { mean: number; median: number; minimum: number; maximum: number };
  displacementStats: { meanCurrent: number; medianCurrent: number; maximumAbsolute: number };
  confidenceStats: { available: number; high: number; low: number; mean: number | null; threshold: 0.6 };
  qualityStats: { concernCount: number; lowCoherenceCount: number; highMissingCount: number };
  anomalyCount: number;
  selectedRegion: null | { label: string; source: string; bounds: [number, number, number, number]; areaKm2: number | null };
  currentMap: null | { center: [number, number]; zoom: number; bounds: [number, number, number, number] };
  filterDescription: string;
  representativePatterns: Array<{ mode: string; pointCount: number; meanVelocity: number; meanCurrentDisplacement: number; meanRange: number; meanConfidence: number | null }>;
  modelVersion: string;
};

type BuildAnalysisSummaryInput = {
  points: readonly InsarPoint[];
  datasetLabel: string;
  timeRange: { startDate: string; endDate: string };
  filterDescription: string;
  coherenceThreshold: number;
  selectedRegion?: SelectedRegion | null;
  selectedRegionAreaKm2?: number | null;
  mapView?: AnalysisMapView | null;
};

const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const boundedText = (value: string, maximum: number) => value.trim().replace(/\s+/g, " ").slice(0, maximum);
const median = (values: number[]) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const confidenceFor = (point: InsarPoint) => point.pasc?.confidence ?? point.modeConfidence ?? null;
const currentFor = (point: InsarPoint) => point.series.at(-1) ?? point.displacement;
const rangeFor = (point: InsarPoint) => point.series.length ? Math.max(...point.series) - Math.min(...point.series) : 0;
const tuple4 = (values: [number, number, number, number]) => values.map(value => round(value, 6)) as [number, number, number, number];

export function buildAnalysisSummary(input: BuildAnalysisSummaryInput): AnalysisSummary {
  if (!input.points.length) throw new Error("当前没有可用于 AI 解读的有效监测点。");
  const velocities = input.points.map(point => point.velocity).filter(Number.isFinite);
  const current = input.points.map(currentFor).filter(Number.isFinite);
  if (!velocities.length || !current.length) throw new Error("当前统计缺少有效速率或形变值，无法生成 AI 摘要。");
  const confidences = input.points.map(confidenceFor).filter((value): value is number => value !== null && Number.isFinite(value));
  const groups = new Map<string, InsarPoint[]>();
  input.points.forEach(point => {
    const mode = normalizedMode(point.mode);
    const existing = groups.get(mode);
    if (existing) existing.push(point);
    else groups.set(mode, [point]);
  });
  const modeDistribution = [...groups.entries()].map(([mode, points]) => {
    const values = points.map(confidenceFor).filter((value): value is number => value !== null && Number.isFinite(value));
    return { mode, count: points.length, percentage: round(points.length / input.points.length * 100, 2), meanConfidence: values.length ? round(mean(values)) : null };
  }).sort((left, right) => right.count - left.count || left.mode.localeCompare(right.mode)).slice(0, 8);
  const representativePatterns = modeDistribution.slice(0, 6).map(item => {
    const points = groups.get(item.mode) ?? [];
    const values = points.map(confidenceFor).filter((value): value is number => value !== null && Number.isFinite(value));
    return {
      mode: item.mode,
      pointCount: points.length,
      meanVelocity: round(mean(points.map(point => point.velocity))),
      meanCurrentDisplacement: round(mean(points.map(currentFor))),
      meanRange: round(mean(points.map(rangeFor))),
      meanConfidence: values.length ? round(mean(values)) : null,
    };
  });
  const lowCoherenceCount = input.points.filter(point => point.coherence > 0 && point.coherence < input.coherenceThreshold).length;
  const highMissingCount = input.points.filter(point => point.missingRate > 0.2).length;
  const anomalyCount = input.points.filter(point => {
    const mode = normalizedMode(point.mode);
    return point.velocity <= -3 || mode === "加速型" || mode === "分段型";
  }).length;
  const summary: AnalysisSummary = {
    schemaVersion: ANALYSIS_SUMMARY_SCHEMA_VERSION,
    scope: input.selectedRegion ? "selected_region" : "current_result",
    datasetLabel: boundedText(input.datasetLabel, 120),
    pointCount: input.points.length,
    timeRange: { startDate: boundedText(input.timeRange.startDate, 32), endDate: boundedText(input.timeRange.endDate, 32) },
    modeDistribution,
    velocityStats: { mean: round(mean(velocities)), median: round(median(velocities)), minimum: round(velocities.reduce((result, value) => Math.min(result, value), Number.POSITIVE_INFINITY)), maximum: round(velocities.reduce((result, value) => Math.max(result, value), Number.NEGATIVE_INFINITY)) },
    displacementStats: { meanCurrent: round(mean(current)), medianCurrent: round(median(current)), maximumAbsolute: round(current.reduce((result, value) => Math.max(result, Math.abs(value)), 0)) },
    confidenceStats: { available: confidences.length, high: confidences.filter(value => value >= 0.6).length, low: confidences.filter(value => value < 0.6).length, mean: confidences.length ? round(mean(confidences)) : null, threshold: 0.6 },
    qualityStats: { concernCount: input.points.filter(point => (point.coherence > 0 && point.coherence < input.coherenceThreshold) || point.missingRate > 0.2).length, lowCoherenceCount, highMissingCount },
    anomalyCount,
    selectedRegion: input.selectedRegion ? { label: boundedText(input.selectedRegion.label || "当前区域", 100), source: input.selectedRegion.source || "unknown", bounds: tuple4(input.selectedRegion.bounds), areaKm2: input.selectedRegionAreaKm2 == null ? null : round(input.selectedRegionAreaKm2) } : null,
    currentMap: input.mapView ? { center: [round(input.mapView.center[0], 6), round(input.mapView.center[1], 6)], zoom: round(input.mapView.zoom, 2), bounds: tuple4(input.mapView.bounds) } : null,
    filterDescription: boundedText(input.filterDescription, 180),
    representativePatterns,
    modelVersion: boundedText(input.points.find(point => point.pasc)?.pasc?.modelVersion || PASC_MODEL_VERSION, 80),
  };
  if (analysisSummaryBytes(summary) > ANALYSIS_SUMMARY_MAX_BYTES) throw new Error("AI 分析摘要超过长度限制；请缩小当前分析范围。");
  return summary;
}

export function analysisSummaryBytes(summary: AnalysisSummary) {
  return new TextEncoder().encode(JSON.stringify(summary)).byteLength;
}

export function analysisSummaryKey(summary: AnalysisSummary) {
  const text = JSON.stringify(summary);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lanjifyw-ai:${summary.schemaVersion}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function sanitizeAnalysisSummary(value: unknown): AnalysisSummary {
  const object = (item: unknown, label: string) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} 无效。`);
    return item as Record<string, unknown>;
  };
  const text = (item: unknown, label: string, maximum: number) => {
    if (typeof item !== "string" || !item.trim() || item.length > maximum) throw new Error(`${label} 无效或过长。`);
    return boundedText(item, maximum);
  };
  const number = (item: unknown, label: string, minimum = -1e9, maximum = 1e9) => {
    if (typeof item !== "number" || !Number.isFinite(item) || item < minimum || item > maximum) throw new Error(`${label} 无效。`);
    return item;
  };
  const count = (item: unknown, label: string) => {
    const result = number(item, label, 0, 10_000_000);
    if (!Number.isInteger(result)) throw new Error(`${label} 必须是整数。`);
    return result;
  };
  const numbers = (item: unknown, label: string, length: number) => {
    if (!Array.isArray(item) || item.length !== length) throw new Error(`${label} 无效。`);
    return item.map((child, index) => number(child, `${label}[${index}]`));
  };
  const root = object(value, "AnalysisSummary");
  if (root.schemaVersion !== ANALYSIS_SUMMARY_SCHEMA_VERSION) throw new Error("AnalysisSummary 版本无效。");
  if (root.scope !== "current_result" && root.scope !== "selected_region") throw new Error("AnalysisSummary scope 无效。");
  const timeRange = object(root.timeRange, "timeRange");
  const velocity = object(root.velocityStats, "velocityStats");
  const displacement = object(root.displacementStats, "displacementStats");
  const confidence = object(root.confidenceStats, "confidenceStats");
  const quality = object(root.qualityStats, "qualityStats");
  if (!Array.isArray(root.modeDistribution) || root.modeDistribution.length > 8 || !Array.isArray(root.representativePatterns) || root.representativePatterns.length > 6) throw new Error("AnalysisSummary 聚合列表无效。");
  const selected = root.selectedRegion === null ? null : object(root.selectedRegion, "selectedRegion");
  const map = root.currentMap === null ? null : object(root.currentMap, "currentMap");
  const canonical: AnalysisSummary = {
    schemaVersion: ANALYSIS_SUMMARY_SCHEMA_VERSION,
    scope: root.scope,
    datasetLabel: text(root.datasetLabel, "datasetLabel", 120),
    pointCount: count(root.pointCount, "pointCount"),
    timeRange: { startDate: text(timeRange.startDate, "startDate", 32), endDate: text(timeRange.endDate, "endDate", 32) },
    modeDistribution: root.modeDistribution.map((entry, index) => { const item = object(entry, `modeDistribution[${index}]`); return { mode: text(item.mode, "mode", 40), count: count(item.count, "mode count"), percentage: number(item.percentage, "percentage", 0, 100), meanConfidence: item.meanConfidence === null ? null : number(item.meanConfidence, "meanConfidence", 0, 1) }; }),
    velocityStats: { mean: number(velocity.mean, "velocity mean"), median: number(velocity.median, "velocity median"), minimum: number(velocity.minimum, "velocity minimum"), maximum: number(velocity.maximum, "velocity maximum") },
    displacementStats: { meanCurrent: number(displacement.meanCurrent, "meanCurrent"), medianCurrent: number(displacement.medianCurrent, "medianCurrent"), maximumAbsolute: number(displacement.maximumAbsolute, "maximumAbsolute", 0) },
    confidenceStats: { available: count(confidence.available, "confidence available"), high: count(confidence.high, "confidence high"), low: count(confidence.low, "confidence low"), mean: confidence.mean === null ? null : number(confidence.mean, "confidence mean", 0, 1), threshold: 0.6 },
    qualityStats: { concernCount: count(quality.concernCount, "quality concern"), lowCoherenceCount: count(quality.lowCoherenceCount, "low coherence"), highMissingCount: count(quality.highMissingCount, "high missing") },
    anomalyCount: count(root.anomalyCount, "anomalyCount"),
    selectedRegion: selected ? { label: text(selected.label, "region label", 100), source: text(selected.source, "region source", 40), bounds: numbers(selected.bounds, "region bounds", 4) as [number, number, number, number], areaKm2: selected.areaKm2 === null ? null : number(selected.areaKm2, "region area", 0) } : null,
    currentMap: map ? { center: numbers(map.center, "map center", 2) as [number, number], zoom: number(map.zoom, "map zoom", 0, 30), bounds: numbers(map.bounds, "map bounds", 4) as [number, number, number, number] } : null,
    filterDescription: text(root.filterDescription, "filterDescription", 180),
    representativePatterns: root.representativePatterns.map((entry, index) => { const item = object(entry, `representativePatterns[${index}]`); return { mode: text(item.mode, "pattern mode", 40), pointCount: count(item.pointCount, "pattern count"), meanVelocity: number(item.meanVelocity, "pattern velocity"), meanCurrentDisplacement: number(item.meanCurrentDisplacement, "pattern displacement"), meanRange: number(item.meanRange, "pattern range", 0), meanConfidence: item.meanConfidence === null ? null : number(item.meanConfidence, "pattern confidence", 0, 1) }; }),
    modelVersion: text(root.modelVersion, "modelVersion", 80),
  };
  if (analysisSummaryBytes(canonical) > ANALYSIS_SUMMARY_MAX_BYTES) throw new Error("AnalysisSummary 超过 12 KB 限制。");
  return canonical;
}
