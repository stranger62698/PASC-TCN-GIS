import type { InsarPoint } from "../data/site.js";
import { pascDisplayName } from "./pasc.js";

export const MAX_COMPARE_POINTS = 5;
export const COMPARISON_COLORS = ["#1677ff", "#e94b4b", "#0a9c93", "#ff8a34", "#6b5acb"] as const;

export type ComparisonUpdate = {
  ids: string[];
  action: "added" | "removed" | "limit";
};

export type ComparisonSummary = {
  count: number;
  meanVelocity: number;
  minimumVelocity: number;
  maximumVelocity: number;
  velocitySpread: number;
  meanCurrentDisplacement: number;
  minimumCurrentDisplacement: number;
  maximumCurrentDisplacement: number;
  currentDisplacementSpread: number;
  meanCoherence: number | null;
  modeCount: number;
};

export type DataBackedQuickCase = {
  id: "lowest-velocity" | "pattern-contrast" | "reference";
  kicker: string;
  title: string;
  description: string;
  criterion: string;
  metric: string;
  pointIds: string[];
  focusPointId: string;
  bounds: [number, number, number, number];
};

function uniqueIds(ids: readonly string[], maximum: number) {
  return [...new Set(ids.filter(Boolean))].slice(0, Math.max(1, maximum));
}

export function updateComparison(ids: readonly string[], pointId: string, maximum = MAX_COMPARE_POINTS): ComparisonUpdate {
  const current = uniqueIds(ids, maximum);
  if (current.includes(pointId)) return { ids: current.filter(id => id !== pointId), action: "removed" };
  if (current.length >= maximum) return { ids: current, action: "limit" };
  return { ids: [...current, pointId], action: "added" };
}

export function comparisonColor(index: number) {
  return COMPARISON_COLORS[index % COMPARISON_COLORS.length];
}

export function currentDisplacement(point: InsarPoint, timeIndex: number) {
  return point.series[Math.min(Math.max(0, timeIndex), Math.max(0, point.series.length - 1))] ?? point.displacement;
}

export function summarizeComparison(points: readonly InsarPoint[], timeIndex: number): ComparisonSummary | null {
  if (!points.length) return null;
  const velocities = points.map(point => point.velocity).filter(Number.isFinite);
  const current = points.map(point => currentDisplacement(point, timeIndex)).filter(Number.isFinite);
  const coherence = points.map(point => point.coherence).filter(value => Number.isFinite(value) && value > 0);
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const minimumVelocity = Math.min(...velocities), maximumVelocity = Math.max(...velocities);
  const minimumCurrentDisplacement = Math.min(...current), maximumCurrentDisplacement = Math.max(...current);
  return {
    count: points.length,
    meanVelocity: mean(velocities),
    minimumVelocity,
    maximumVelocity,
    velocitySpread: maximumVelocity - minimumVelocity,
    meanCurrentDisplacement: mean(current),
    minimumCurrentDisplacement,
    maximumCurrentDisplacement,
    currentDisplacementSpread: maximumCurrentDisplacement - minimumCurrentDisplacement,
    meanCoherence: coherence.length ? mean(coherence) : null,
    modeCount: new Set(points.map(point => pascDisplayName(point.mode))).size,
  };
}

function boundsFor(points: readonly InsarPoint[]): [number, number, number, number] {
  return [
    Math.min(...points.map(point => point.lon)),
    Math.min(...points.map(point => point.lat)),
    Math.max(...points.map(point => point.lon)),
    Math.max(...points.map(point => point.lat)),
  ];
}

function squaredDistance(a: InsarPoint, b: InsarPoint) {
  const longitudeScale = Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180);
  return ((a.lon - b.lon) * longitudeScale) ** 2 + (a.lat - b.lat) ** 2;
}

function nearest(points: readonly InsarPoint[], anchor: InsarPoint, maximum: number) {
  return [...points].sort((a, b) => {
    if (a.id === anchor.id) return -1;
    if (b.id === anchor.id) return 1;
    return squaredDistance(a, anchor) - squaredDistance(b, anchor) || a.id.localeCompare(b.id);
  }).slice(0, maximum);
}

function caseFromPoints(item: Omit<DataBackedQuickCase, "pointIds" | "focusPointId" | "bounds">, points: readonly InsarPoint[], focusPointId: string): DataBackedQuickCase {
  return { ...item, pointIds: points.map(point => point.id), focusPointId, bounds: boundsFor(points) };
}

export function buildDataBackedQuickCases(points: readonly InsarPoint[], maximum = MAX_COMPARE_POINTS): DataBackedQuickCase[] {
  const valid = points.filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat) && Number.isFinite(point.velocity) && point.series.some(Number.isFinite));
  if (!valid.length) return [];
  const qualityScreened = valid.filter(point => point.missingRate <= .2 && (!point.coherence || point.coherence >= .75));
  const evidence = qualityScreened.length ? qualityScreened : valid;
  const lowest = [...evidence].sort((a, b) => a.velocity - b.velocity || a.id.localeCompare(b.id))[0];
  const lowestGroup = nearest(evidence, lowest, maximum);
  const cases: DataBackedQuickCase[] = [caseFromPoints({
    id: "lowest-velocity",
    kicker: "RATE EVIDENCE",
    title: lowest.velocity < 0 ? "最低速率样本" : "最小速率样本",
    description: "定位当前数据中通过质量筛选的最低年均速率点，并加载它的最近邻用于时序对照。",
    criterion: qualityScreened.length ? "缺测率 ≤ 20%，且相干性未提供或 ≥ 0.75" : "当前数据没有通过默认质量筛选的点，已回退到全部有效点",
    metric: `${lowest.velocity.toFixed(2)} mm/yr · ${lowest.id}`,
  }, lowestGroup, lowest.id)];

  const preferredModes = ["加速型", "分段型", "线性型", "减速型", "稳定型", "未定义型", "Stepwise（旧版，待确认）", "未分类"];
  const bestByMode = new Map<string, InsarPoint>();
  evidence.forEach(point => {
    const mode = pascDisplayName(point.mode), current = bestByMode.get(mode);
    const score = (point.pasc?.confidence ?? point.modeConfidence ?? 0) * 2 + (point.coherence || 0);
    const currentScore = current ? (current.pasc?.confidence ?? current.modeConfidence ?? 0) * 2 + (current.coherence || 0) : -1;
    if (!current || score > currentScore || (score === currentScore && point.id.localeCompare(current.id) < 0)) bestByMode.set(mode, point);
  });
  const contrast = [...bestByMode.entries()].sort((a, b) => {
    const ai = preferredModes.indexOf(a[0]), bi = preferredModes.indexOf(b[0]);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a[1].id.localeCompare(b[1].id);
  }).slice(0, maximum).map(entry => entry[1]);
  if (contrast.length >= 2) cases.push(caseFromPoints({
    id: "pattern-contrast",
    kicker: "PATTERN EVIDENCE",
    title: "形变模式对照",
    description: "从当前数据的不同已有模式中各取一个质量较高点，直接叠加时序进行对照。",
    criterion: "每种已有模式至多一个点，优先已有置信度与相干性较高者",
    metric: `${contrast.length} 种模式 · ${contrast.length} 个点`,
  }, contrast, contrast[0].id));

  const reference = [...evidence].sort((a, b) => {
    const aStable = pascDisplayName(a.mode) === "稳定型" ? 1 : 0, bStable = pascDisplayName(b.mode) === "稳定型" ? 1 : 0;
    return bStable - aStable || (b.coherence || 0) - (a.coherence || 0) || Math.abs(a.velocity) - Math.abs(b.velocity) || a.id.localeCompare(b.id);
  })[0];
  const referenceGroup = nearest(evidence, reference, Math.min(3, maximum));
  if (!cases.some(item => item.pointIds.join("|") === referenceGroup.map(point => point.id).join("|"))) cases.push(caseFromPoints({
    id: "reference",
    kicker: "REFERENCE EVIDENCE",
    title: "高相干参考样本",
    description: "优先定位稳定型且相干性较高的参考点，并加载邻近点检查局部时序一致性。",
    criterion: "优先稳定型，其次相干性，再按绝对速率接近零排序",
    metric: `${reference.coherence ? reference.coherence.toFixed(2) : "未提供"} 相干性 · ${reference.id}`,
  }, referenceGroup, reference.id));
  return cases;
}
