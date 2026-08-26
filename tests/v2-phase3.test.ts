import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { aggregateAoiSeries, aoiAreaKm2, geometryBounds, pointInPolygon, rectangleGeometry, summarizeAoi } from "../app/lib/aoi-analysis.js";

const points = [
  { id: "A", name: "A", lon: 110.001, lat: 20.001, velocity: -3, displacement: -3, coherence: .9, missingRate: .01, mode: "稳定型", updated: "2024-03", dates: ["2024-01", "2024-02", "2024-03"], series: [0, -1, -3] },
  { id: "B", name: "B", lon: 110.006, lat: 20.003, velocity: -6, displacement: -7, coherence: .6, missingRate: .02, mode: "加速型", updated: "2024-03", dates: ["2024-01", "2024-02", "2024-03"], series: [0, -2, -7] },
  { id: "C", name: "C", lon: 110.02, lat: 20.02, velocity: -30, displacement: -90, coherence: .8, missingRate: .3, mode: "加速型", updated: "2024-03", dates: ["2024-01", "2024-02", "2024-03"], series: [0, -10, -90] },
] as InsarPoint[];

test("Phase 3 polygon selection includes boundary points and excludes outside points", () => {
  const polygon = [[110, 20], [110.01, 20], [110.01, 20.01], [110, 20.01]] as [number, number][];
  assert.equal(pointInPolygon(points[0].lon, points[0].lat, polygon), true);
  assert.equal(pointInPolygon(110, 20.005, polygon), true);
  assert.equal(pointInPolygon(points[2].lon, points[2].lat, polygon), false);
  assert.deepEqual(geometryBounds({ type: "polygon", coordinates: polygon }), [110, 20, 110.01, 20.01]);
});

test("Phase 3 computes non-planar AOI area from persisted WGS84 geometry", () => {
  const area = aoiAreaKm2(rectangleGeometry([110, 20, 110.01, 20.01]));
  assert.ok(area !== null && area > 1 && area < 1.3);
});

test("Phase 3 defaults can distinguish robust median from outlier-sensitive mean", () => {
  const median = aggregateAoiSeries(points, "median");
  const mean = aggregateAoiSeries(points, "mean");
  assert.equal(median.overall[2], -7);
  assert.ok((mean.overall[2] ?? 0) < -30);
  assert.deepEqual(median.groups.map(group => group.mode).sort(), ["加速型", "稳定型"]);
});

test("Phase 3 summary keeps quality concepts and AOI metrics separate", () => {
  const geometry = rectangleGeometry([110, 20, 110.01, 20.01]);
  const summary = summarizeAoi(points.slice(0, 2), 2, .75, point => point.mode, geometry);
  assert.ok(summary);
  assert.equal(summary.pointCount, 2);
  assert.equal(summary.lowCoherenceCount, 1);
  assert.equal(summary.missingDataCount, 0);
  assert.equal(summary.qualityConcernCount, 1);
  assert.equal(summary.medianCurrentDisplacement, -5);
  assert.ok((summary.areaKm2 ?? 0) > 1);
});

test("Phase 3 AOI geometry, chart and context are wired into the existing flow", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const context = readFileSync("app/lib/analysis-context.tsx", "utf8");
  assert.match(workspace, /handlePolygonSelect/);
  assert.match(workspace, /AoiTimeSeriesChart/);
  assert.match(map, /pointInPolygon/);
  assert.match(map, /双击完成/);
  assert.match(context, /geometry\?: AoiGeometry/);
});
