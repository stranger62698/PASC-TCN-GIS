import type { InsarPoint } from "../data/site";
import { PASC_CLASSES, parsePascClass } from "./pasc";
import type { PascClassName, PascPointResult } from "../types/pasc";

export const PASC_MODE_EXPLANATIONS: Record<PascClassName, string> = {
  Stable: "整体波动幅度较小，未表现出持续显著形变趋势。",
  Linear: "形变在观测期内保持较稳定的单向演化趋势。",
  Piecewise: "时序过程中存在明显阶段变化，不同阶段形变速率存在差异。",
  Decelerating: "前期形变较明显，后期变化速率逐渐降低，整体呈趋稳特征。",
  Accelerating: "后期形变速率较前期明显增大，表现出持续加速趋势，建议结合空间聚集情况进一步关注。",
  Undefined: "当前时序曲线趋势不清晰或模型置信度不足，不建议直接解释为具体形变模式。",
};

export type PascCandidate = { name: PascClassName; nameZh: string; color: string; probability: number };
export type PointDataQuality = { level: "high" | "medium" | "low" | "not_evaluated"; label: string; reasons: string[] };
export type TemporalStageAnalysis = {
  source: "provided" | "derived";
  changeIndex: number;
  changeDate: string;
  slopeBefore: number;
  slopeAfter: number;
  improvement: number | null;
  method: string;
};

export function topPascCandidates(result: PascPointResult | null | undefined, limit = 2): PascCandidate[] {
  if (!result) return [];
  return PASC_CLASSES.map(item => ({ ...item, probability: result.probabilities[item.name] }))
    .filter(item => Number.isFinite(item.probability))
    .sort((a, b) => b.probability - a.probability || a.id - b.id)
    .slice(0, Math.max(0, limit));
}

export function pointDataQuality(point: InsarPoint, coherenceThreshold = 0.75): PointDataQuality {
  const hasCoherence = point.coherenceSource ? point.coherenceSource !== "not_available" : Number.isFinite(point.coherence) && point.coherence > 0;
  const missingRate = Number.isFinite(point.missingRate) ? Math.max(0, point.missingRate) : null;
  const reasons: string[] = [];
  if (hasCoherence && point.coherence < coherenceThreshold) reasons.push(`相干性 ${point.coherence.toFixed(2)} 低于 ${coherenceThreshold.toFixed(2)}`);
  if (missingRate !== null && missingRate > 0.2) reasons.push(`缺测率 ${(missingRate * 100).toFixed(1)}% 高于 20%`);
  if (reasons.length) return { level: "low", label: "需复核", reasons };
  if (!hasCoherence && missingRate === null) return { level: "not_evaluated", label: "未评估", reasons: ["未提供相干性和缺测率"] };
  if (!hasCoherence) return { level: "medium", label: "信息有限", reasons: ["未提供相干性", `缺测率 ${((missingRate ?? 0) * 100).toFixed(1)}%`] };
  if (missingRate !== null && missingRate > 0.1) return { level: "medium", label: "一般", reasons: [`缺测率 ${(missingRate * 100).toFixed(1)}%`] };
  return { level: "high", label: "良好", reasons: [`相干性 ${point.coherence.toFixed(2)}`, `缺测率 ${((missingRate ?? 0) * 100).toFixed(1)}%`] };
}

export function pascModeExplanation(point: InsarPoint): string | null {
  const name = point.pasc?.calibratedLabel ?? parsePascClass(point.mode).definition?.name;
  return name ? PASC_MODE_EXPLANATIONS[name] : null;
}

function timestamp(value: string): number {
  const parts = String(value || "").match(/((?:19|20)\d{2})\D?(\d{1,2})?\D?(\d{1,2})?/);
  if (!parts) return Number.NaN;
  return Date.UTC(Number(parts[1]), Math.max(0, Number(parts[2] || 1) - 1), Math.max(1, Number(parts[3] || 1)));
}

function fit(times: number[], values: number[], start: number, end: number) {
  const origin = times[start];
  const xs = times.slice(start, end).map(value => (value - origin) / 31557600000);
  const ys = values.slice(start, end);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / ys.length;
  let numerator = 0, denominator = 0;
  xs.forEach((value, index) => { numerator += (value - meanX) * (ys[index] - meanY); denominator += (value - meanX) ** 2; });
  const slope = denominator ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  const sse = ys.reduce((sum, value, index) => sum + (value - (intercept + slope * xs[index])) ** 2, 0);
  return { slope, sse };
}

export function deriveTemporalStageAnalysis(point: InsarPoint): TemporalStageAnalysis | null {
  const dates = point.dates ?? [];
  if (point.changePoint && Number.isFinite(point.slopeBefore) && Number.isFinite(point.slopeAfter)) {
    const index = Math.max(0, dates.indexOf(point.changePoint));
    return { source: "provided", changeIndex: index, changeDate: point.changePoint, slopeBefore: Number(point.slopeBefore), slopeAfter: Number(point.slopeAfter), improvement: null, method: "数据或模型结果直接提供" };
  }
  if (point.series.length < 8 || dates.length !== point.series.length || point.series.some(value => !Number.isFinite(value))) return null;
  const times = dates.map(timestamp);
  if (times.some(value => !Number.isFinite(value))) return null;
  const minimumSegment = Math.max(3, Math.min(12, Math.floor(point.series.length / 5)));
  const single = fit(times, point.series, 0, point.series.length);
  if (single.sse <= 1e-9) return null;
  let best: { split: number; sse: number; before: number; after: number } | null = null;
  for (let split = minimumSegment; split <= point.series.length - minimumSegment; split += 1) {
    const before = fit(times, point.series, 0, split);
    const after = fit(times, point.series, split, point.series.length);
    const sse = before.sse + after.sse;
    if (!best || sse < best.sse) best = { split, sse, before: before.slope, after: after.slope };
  }
  if (!best) return null;
  const improvement = Math.max(0, 1 - best.sse / single.sse);
  const slopeContrast = Math.abs(best.after - best.before);
  const slopeScale = Math.max(0.1, Math.abs(best.before), Math.abs(best.after));
  if (improvement < 0.1 || slopeContrast < Math.max(0.1, slopeScale * 0.15)) return null;
  return {
    source: "derived",
    changeIndex: best.split,
    changeDate: dates[best.split],
    slopeBefore: best.before,
    slopeAfter: best.after,
    improvement,
    method: `真实日期双段线性拟合；较单段拟合改善 ${(improvement * 100).toFixed(1)}%（改善门槛 10%，阶段斜率差异门槛 15%）`,
  };
}
