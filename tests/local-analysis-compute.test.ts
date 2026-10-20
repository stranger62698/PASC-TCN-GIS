import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateExact, aggregateLocalMatrix, computePrioritySnapshot, createPrioritySnapshot, restorePrioritySelection } from "../app/lib/local-analysis-compute";
import { displacementAt, selectPriorityDeformationPoints } from "../app/lib/priority-deformation";
import type { InsarPoint } from "../app/data/site";
const makePoint = (id: string, longitude: number, sign = -1): InsarPoint => ({ id, name: id, lon: longitude, lat: 20, velocity: sign * 15, displacement: sign * 45, coherence: .9, coherenceSource: "provided", missingRate: 0, mode: "Linear", updated: "2024-01-13", series: [0, sign * 45], dates: ["2024-01-01", "2024-01-13"] });
test("interpolated final values never replace missing observed displacement", () => {
  const point = { ...makePoint("missing", 110), observedDates: ["2024-01-01", "2024-01-13"], observedSeries: [0, NaN], observedMask: new Uint8Array([1, 0]), observedDisplacement: NaN, observedEvaluationDate: "2024-01-13" };
  assert.ok(Number.isNaN(displacementAt(point, 1, "2024-01-13")));
  const selected = computePrioritySnapshot(createPrioritySnapshot([point], 1, { evaluationDate: "2024-01-13" }));
  assert.deepEqual([...selected.indices.invalid], [0]); assert.equal(selected.indices.candidates.length, 0);
});
test("full-data worker snapshot matches existing same-direction cluster semantics", () => {
  const points = Array.from({ length: 6 }, (_, index) => makePoint("point-" + index, 110 + (index % 3) * .0001, index < 3 ? -1 : 1));
  const options = { minimumPoints: 3, radiusMeters: 60, evaluationDate: "2024-01-13" };
  const expected = selectPriorityDeformationPoints(points, 1, options);
  const restored = restorePrioritySelection(computePrioritySnapshot(createPrioritySnapshot(points, 1, options)), points);
  assert.equal(restored.regions.regions.length, 2);
  assert.deepEqual(restored.anomalies.map(point => point.id), expected.anomalies.map(point => point.id));
  assert.equal(restored.anomalies[0], points[0]);
});
test("missing coherence remains unknown rather than false quality confirmation", () => {
  const points = Array.from({ length: 3 }, (_, index) => ({ ...makePoint("unknown-" + index, 110 + index * .0001), coherence: 0, coherenceSource: "default" as const }));
  const selected = restorePrioritySelection(computePrioritySnapshot(createPrioritySnapshot(points, 1, { minimumPoints: 3 })), points);
  assert.equal(selected.anomalies.length, 3); assert.equal(selected.reliable.length, 0); assert.equal(selected.limited.length, 3);
});
test("unknown missing-rate metadata stays limited even with complete observed arrays", () => {
  const points = Array.from({ length: 3 }, (_, index) => ({ ...makePoint("unknown-missing-" + index, 110 + index * .0001), missingRate: NaN }));
  const selected = restorePrioritySelection(computePrioritySnapshot(createPrioritySnapshot(points, 1, { minimumPoints: 3 })), points);
  assert.equal(selected.anomalies.length, 3); assert.equal(selected.reliable.length, 0); assert.equal(selected.limited.length, 3);
});
test("AOI exact aggregation preserves missing observations and all groups", () => {
  const matrix = Float32Array.from([1, 4, 3, NaN, 9, 8, NaN, NaN]);
  const median = aggregateLocalMatrix(matrix, ["A", "A", "B", "B"], ["d1", "d2"], "median");
  assert.deepEqual(median.overall, [3, 6]);
  assert.deepEqual(median.groups, [{ mode: "A", pointCount: 2, values: [2, 4] }, { mode: "B", pointCount: 2, values: [9, 8] }]);
  const mean = aggregateLocalMatrix(matrix, ["A", "A", "B", "B"], ["d1", "d2"], "mean");
  assert.deepEqual(mean.overall, [13 / 3, 6]);
});
test("exact median handles repeated values and even/odd arrays", () => {
  for (const length of [1, 2, 3, 24, 125, 256, 2048]) {
    const values = Array.from({ length }, (_, index) => (index * 17) % 11 - 5), sorted = [...values].sort((a, b) => a - b), middle = Math.floor(length / 2);
    const expected = length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    assert.equal(aggregateExact(Float32Array.from(values), "median"), expected);
  }
  assert.equal(aggregateExact(new Float32Array(100_000).fill(7), "median"), 7);
});
test("lazy local observations use explicitly loaded dates and never stale date fallback", () => {
  const point = { ...makePoint("lazy", 110), localSeriesIndex: 0, observedEvaluationDate: "2024-01-13", observedDisplacement: -45, observedDates: ["2024-01-01", "2024-01-13"], observedSeries: [NaN, -45] };
  assert.equal(displacementAt(point, 1, "2024-01-13"), -45);
  assert.ok(Number.isNaN(displacementAt(point, 0, "2024-01-01")));
});
