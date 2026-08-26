import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { buildAnomalyRegions, convexHull } from "../app/lib/anomaly-regions.js";

const point = (id: string, lon: number, lat: number, velocity = -5, mode = "加速型"): InsarPoint => ({
  id,
  name: id,
  lon,
  lat,
  velocity,
  displacement: velocity,
  coherence: .9,
  missingRate: .01,
  mode,
  updated: "2025-01",
  dates: ["2024-01", "2025-01"],
  series: [0, velocity],
});

const candidates = [
  point("A1", 110, 20),
  point("A2", 110.0004, 20.0002),
  point("A3", 110.0002, 20.0006, -4, "分段型"),
  point("B1", 110.01, 20.01),
  point("B2", 110.0104, 20.0101),
  point("B3", 110.0102, 20.0105, -7, "线性型"),
  point("N1", 110.03, 20.03),
];

test("Phase 4 grid-index clustering finds deterministic density-connected regions", () => {
  const result = buildAnomalyRegions(candidates, { radiusMeters: 150, minimumPoints: 3 }, 1);
  assert.equal(result.status, "ready");
  assert.equal(result.regions.length, 2);
  assert.equal(result.assignedPointCount, 6);
  assert.equal(result.noisePointCount, 1);
  assert.deepEqual(result.regions.map(region => region.pointCount), [3, 3]);
  assert.match(result.method, /150 m/);
});

test("Phase 4 region identities and membership do not depend on source order", () => {
  const forward = buildAnomalyRegions(candidates, { radiusMeters: 150, minimumPoints: 3 }, 1);
  const reverse = buildAnomalyRegions([...candidates].reverse(), { radiusMeters: 150, minimumPoints: 3 }, 1);
  assert.deepEqual(forward.regions.map(region => [region.id, region.pointIds]), reverse.regions.map(region => [region.id, region.pointIds]));
});

test("Phase 4 analytical envelopes are valid polygons with transparent statistics", () => {
  const result = buildAnomalyRegions(candidates, { radiusMeters: 150, minimumPoints: 3 }, 1);
  const region = result.regions[0];
  assert.ok(region.geometry.coordinates.length >= 3);
  assert.ok(region.areaKm2 > 0);
  assert.equal(region.pointCount, 3);
  assert.equal(region.clearSubsidenceCount, 3);
  assert.equal("riskScore" in region, false);
  assert.ok(convexHull([[0, 0], [1, 0], [1, 1], [0, 1], [.5, .5]]).length === 4);
});

test("Phase 4 fails closed instead of clustering an unbounded local candidate set", () => {
  const large = Array.from({ length: 1001 }, (_, index) => point(`P${index}`, 110 + index * 1e-7, 20));
  const result = buildAnomalyRegions(large, { radiusMeters: 200, minimumPoints: 3, maximumCandidates: 1000 }, 1);
  assert.equal(result.status, "too_large");
  assert.equal(result.regions.length, 0);
  assert.equal(result.noisePointCount, 1001);
});

test("Phase 4 default parameters produce spatial support on the frozen public demo", () => {
  const lines = readFileSync("public/data/haikou-insar.csv", "utf8").trim().split(/\r?\n/);
  const headers = lines[0].split(",");
  const index = (name: string) => headers.indexOf(name);
  const parsed = lines.slice(1).map(line => {
    const values = line.split(",");
    return point(values[index("fid")], +values[index("xpos")], +values[index("ypos")], +values[index("Vel")], values[index("Predicted_Label")]);
  }).map((item, rowIndex) => {
    const values = lines[rowIndex + 1].split(",");
    return { ...item, coherence: +values[index("coherence")] };
  }).filter(item => item.coherence >= .75 && (item.velocity <= -3 || item.mode === "Accelerating" || item.mode === "Piecewise"));
  const result = buildAnomalyRegions(parsed, { radiusMeters: 200, minimumPoints: 3 }, 1, item => item.mode === "Accelerating" ? "加速型" : item.mode === "Piecewise" ? "分段型" : item.mode);
  assert.equal(result.candidateCount, 119);
  assert.ok(result.regions.length > 0);
  assert.ok(result.assignedPointCount > 0);
  assert.ok(result.noisePointCount > 0);
});

test("Phase 4 region list, map polygons and context detail are wired without danger claims", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const panel = readFileSync("app/components/AnomalyRegionPanel.tsx", "utf8");
  assert.match(workspace, /buildAnomalyRegions/);
  assert.match(workspace, /focusAnomalyRegion/);
  assert.match(map, /anomalyRegionLayer/);
  assert.match(panel, /邻域半径/);
  assert.match(panel, /不是危险区或工程边界/);
  assert.doesNotMatch(panel, /风险分|危险等级|即将失稳/);
});
