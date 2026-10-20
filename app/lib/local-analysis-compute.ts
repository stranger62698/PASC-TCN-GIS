import type { InsarPoint } from "../data/site";
import { displacementAt, normalizePriorityOptions, selectPriorityDeformationPoints, type PriorityDeformationOptions, type PriorityDeformationSelection } from "./priority-deformation";
import type { AoiAggregateMethod, AoiSeries } from "./aoi-analysis";
import type { PascLocalSeriesStorage } from "./pasc-local-worker-protocol";

export type PrioritySnapshot = {
  ids: string[]; modes: string[]; longitude: Float64Array; latitude: Float64Array;
  velocity: Float64Array; displacement: Float64Array; coherence: Float64Array; missingRate: Float64Array; observedMissingRate: Float64Array;
  velocitySource: Uint8Array; coherenceSource: Uint8Array; options: PriorityDeformationOptions;
};
const sourceCode = (source: string | undefined) => source === undefined || source === "provided" ? 0 : source === "calculated" ? 1 : 2;
export function createPrioritySnapshot(points: readonly InsarPoint[], timeIndex: number, options: PriorityDeformationOptions, modeForPoint = (point: InsarPoint) => point.mode): PrioritySnapshot {
  const count = points.length;
  const snapshot: PrioritySnapshot = {
    ids: [], modes: [], longitude: new Float64Array(count), latitude: new Float64Array(count),
    velocity: new Float64Array(count), displacement: new Float64Array(count), coherence: new Float64Array(count),
    missingRate: new Float64Array(count), observedMissingRate: new Float64Array(count), velocitySource: new Uint8Array(count), coherenceSource: new Uint8Array(count),
    options: normalizePriorityOptions(options),
  };
  points.forEach((point, index) => {
    snapshot.ids.push(point.id); snapshot.modes.push(modeForPoint(point));
    snapshot.longitude[index] = point.lon; snapshot.latitude[index] = point.lat;
    snapshot.velocity[index] = point.velocity; snapshot.displacement[index] = displacementAt(point, timeIndex, options.evaluationDate);
    snapshot.coherence[index] = point.coherence; snapshot.missingRate[index] = point.missingRate;
    snapshot.observedMissingRate[index] = point.observedMissingRate ?? point.missingRate;
    if (point.localSeriesIndex === undefined) {
      const series = point.observedSeries ?? point.series;
      let valid = 0;
      for (let step = 0; step < series.length; step += 1) if (Number.isFinite(series[step]) && (!point.observedMask || point.observedMask[step])) valid += 1;
      const actualMissing = series.length ? 1 - valid / series.length : NaN;
      snapshot.observedMissingRate[index] = actualMissing;
    }
    snapshot.velocitySource[index] = sourceCode(point.velocitySource);
    snapshot.coherenceSource[index] = sourceCode(point.coherenceSource);
  });
  return snapshot;
}
export type EncodedPrioritySelection = Omit<PriorityDeformationSelection, "amplitudeCandidates" | "candidates" | "anomalies" | "reliable" | "limited" | "isolated" | "excludedLowQuality" | "invalid"> & {
  indices: Record<"amplitudeCandidates" | "candidates" | "anomalies" | "reliable" | "limited" | "isolated" | "excludedLowQuality" | "invalid", Uint32Array>;
};
const selectionKeys = ["amplitudeCandidates", "candidates", "anomalies", "reliable", "limited", "isolated", "excludedLowQuality", "invalid"] as const;
export function computePrioritySnapshot(snapshot: PrioritySnapshot): EncodedPrioritySelection {
  const date = snapshot.options.evaluationDate ?? "local-evaluation";
  const points = snapshot.ids.map((id, index): InsarPoint => ({
    id, name: id, lon: snapshot.longitude[index], lat: snapshot.latitude[index], velocity: snapshot.velocity[index],
    velocitySource: snapshot.velocitySource[index] === 0 ? "provided" : snapshot.velocitySource[index] === 1 ? "calculated" : "not_available",
    displacement: snapshot.displacement[index], observedDisplacement: snapshot.displacement[index], observedEvaluationDate: date,
    coherence: snapshot.coherence[index], coherenceSource: snapshot.coherenceSource[index] === 0 ? "provided" : snapshot.coherenceSource[index] === 1 ? "calculated" : "not_available",
    missingRate: snapshot.missingRate[index], observedMissingRate: snapshot.observedMissingRate[index], mode: snapshot.modes[index], updated: date, series: [], dates: [date],
  }));
  const selected = selectPriorityDeformationPoints(points, 0, { ...snapshot.options, evaluationDate: date });
  const byPoint = new Map(points.map((point, index) => [point, index]));
  const indices = Object.fromEntries(selectionKeys.map(key => [key, Uint32Array.from(selected[key], point => byPoint.get(point)!)])) as EncodedPrioritySelection["indices"];
  return { ruleVersion: selected.ruleVersion, thresholds: selected.thresholds, direction: selected.direction, options: selected.options, regions: selected.regions, indices };
}
export function restorePrioritySelection(encoded: EncodedPrioritySelection, points: readonly InsarPoint[]): PriorityDeformationSelection {
  const arrays = Object.fromEntries(selectionKeys.map(key => [key, Array.from(encoded.indices[key], index => {
    if (!points[index]) throw new Error("异常分析返回了失效点位，请重新分析。");
    return points[index];
  })])) as Pick<PriorityDeformationSelection, typeof selectionKeys[number]>;
  return { ruleVersion: encoded.ruleVersion, thresholds: encoded.thresholds, direction: encoded.direction, options: encoded.options, regions: encoded.regions, ...arrays };
}
export function prioritySnapshotTransfers(snapshot: PrioritySnapshot): ArrayBuffer[] {
  return [snapshot.longitude, snapshot.latitude, snapshot.velocity, snapshot.displacement, snapshot.coherence, snapshot.missingRate, snapshot.observedMissingRate, snapshot.velocitySource, snapshot.coherenceSource].map(array => array.buffer as ArrayBuffer);
}
function nth(values: Float32Array, target: number): number {
  let left = 0, right = values.length - 1;
  while (left < right) {
    const pivot = values[Math.floor((left + right) / 2)];
    let low = left, cursor = left, high = right;
    while (cursor <= high) {
      if (values[cursor] < pivot) { const held = values[low]; values[low++] = values[cursor]; values[cursor++] = held; }
      else if (values[cursor] > pivot) { const held = values[high]; values[high--] = values[cursor]; values[cursor] = held; }
      else cursor += 1;
    }
    if (target < low) right = low - 1;
    else if (target > high) left = high + 1;
    else return values[target];
  }
  return values[target];
}
export function aggregateExact(values: Float32Array, method: AoiAggregateMethod): number | null {
  if (!values.length) return null;
  if (method === "mean") { let sum = 0; for (const value of values) sum += value; return sum / values.length; }
  const middle = Math.floor(values.length / 2), upper = nth(values, middle);
  return values.length % 2 ? upper : (nth(values, middle - 1) + upper) / 2;
}
export function aggregateLocalMatrix(matrix: Float32Array, modes: string[], dates: string[], method: AoiAggregateMethod): AoiSeries {
  if (matrix.length !== modes.length * dates.length) throw new Error("区域时序矩阵与点位/日期数量不一致。");
  const groupNames = [...new Set(modes)], counts = groupNames.map(mode => modes.filter(item => item === mode).length);
  const offsets: number[] = []; let total = 0;
  counts.forEach(count => { offsets.push(total); total += count; });
  const ranks = new Map(groupNames.map((mode, index) => [mode, index]));
  const groups = groupNames.map((mode, index) => ({ mode, pointCount: counts[index], values: [] as Array<number | null> }));
  const overall: Array<number | null> = [], all = new Float32Array(modes.length), grouped = new Float32Array(modes.length);
  for (let step = 0; step < dates.length; step += 1) {
    const validCounts = counts.map(() => 0); let finite = 0;
    for (let row = 0; row < modes.length; row += 1) {
      const value = matrix[row * dates.length + step];
      if (!Number.isFinite(value)) continue;
      all[finite++] = value; const rank = ranks.get(modes[row])!;
      grouped[offsets[rank] + validCounts[rank]++] = value;
    }
    groups.forEach((group, rank) => group.values.push(aggregateExact(grouped.subarray(offsets[rank], offsets[rank] + validCounts[rank]), method)));
    overall.push(aggregateExact(all.subarray(0, finite), method));
  }
  return { dates, overall, groups };
}
export type LocalAoiRequest = { kind?: "processed" | "observed"; rows: Uint32Array; modes: string[]; dates: string[]; method: AoiAggregateMethod; matrix?: Float32Array; storage?: PascLocalSeriesStorage };
export type LocalComputeRequest = { type: "PRIORITY"; runId: number; snapshot: PrioritySnapshot } | { type: "AOI"; runId: number; input: LocalAoiRequest };
export type LocalComputeResponse = { type: "PRIORITY"; runId: number; result: EncodedPrioritySelection } | { type: "AOI"; runId: number; result: AoiSeries } | { type: "ERROR"; runId: number; message: string };
