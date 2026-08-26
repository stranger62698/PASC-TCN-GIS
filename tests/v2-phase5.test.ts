import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { buildDataBackedQuickCases, MAX_COMPARE_POINTS, summarizeComparison, updateComparison } from "../app/lib/point-comparison.js";

const point = (id: string, lon: number, lat: number, velocity: number, mode: string, coherence = .9, series = [0, velocity]): InsarPoint => ({
  id,
  name: id,
  lon,
  lat,
  velocity,
  displacement: series.at(-1) ?? velocity,
  coherence,
  missingRate: .01,
  mode,
  updated: "2025-01",
  dates: ["2024-01", "2025-01"],
  series,
});

const points = [
  point("A", 110, 20, -8, "Accelerating", .92, [0, -9]),
  point("B", 110.001, 20.001, -4, "Linear", .88, [0, -5]),
  point("C", 110.002, 20.001, -2, "Piecewise", .86, [0, -3]),
  point("D", 110.003, 20.002, .1, "Stable", .96, [0, .2]),
  point("E", 110.004, 20.002, 2, "Decelerating", .84, [0, 2.4]),
  point("F", 110.005, 20.003, 4, "Undefined", .8, [0, 5]),
];

test("Phase 5 comparison toggles membership without duplicating IDs", () => {
  assert.deepEqual(updateComparison(["A", "B"], "C"), { ids: ["A", "B", "C"], action: "added" });
  assert.deepEqual(updateComparison(["A", "B", "A"], "A"), { ids: ["B"], action: "removed" });
});

test("Phase 5 rejects a sixth point instead of silently evicting evidence", () => {
  const current = ["A", "B", "C", "D", "E"];
  const result = updateComparison(current, "F");
  assert.equal(MAX_COMPARE_POINTS, 5);
  assert.equal(result.action, "limit");
  assert.deepEqual(result.ids, current);
});

test("Phase 5 comparison summary exposes ranges, spread, modes, and available coherence", () => {
  const summary = summarizeComparison(points.slice(0, 3), 1);
  assert.ok(summary);
  assert.equal(summary.count, 3);
  assert.equal(summary.minimumVelocity, -8);
  assert.equal(summary.maximumVelocity, -2);
  assert.equal(summary.velocitySpread, 6);
  assert.equal(summary.minimumCurrentDisplacement, -9);
  assert.equal(summary.maximumCurrentDisplacement, -3);
  assert.equal(summary.modeCount, 3);
  assert.ok((summary.meanCoherence ?? 0) > .88);
});

test("Phase 5 quick cases are deterministic, bounded, and reference only loaded points", () => {
  const forward = buildDataBackedQuickCases(points), reverse = buildDataBackedQuickCases([...points].reverse()), ids = new Set(points.map(item => item.id));
  assert.deepEqual(forward, reverse);
  assert.ok(forward.length >= 2);
  forward.forEach(item => {
    assert.ok(item.pointIds.length >= 1 && item.pointIds.length <= MAX_COMPARE_POINTS);
    assert.ok(item.pointIds.every(id => ids.has(id)));
    assert.ok(item.pointIds.includes(item.focusPointId));
    assert.equal(item.bounds.length, 4);
  });
});

test("Phase 5 quick cases resolve against the frozen public Spatial Demo", () => {
  const lines = readFileSync("public/data/haikou-insar.csv", "utf8").trim().split(/\r?\n/), headers = lines[0].split(","), index = (name: string) => headers.indexOf(name);
  const demo = lines.slice(1).map(line => { const values = line.split(","); return point(values[index("fid")], +values[index("xpos")], +values[index("ypos")], +values[index("Vel")], values[index("Predicted_Label")], +values[index("coherence")]); });
  const cases = buildDataBackedQuickCases(demo), demoIds = new Set(demo.map(item => item.id));
  assert.equal(demo.length, 3094);
  assert.ok(cases.length >= 2);
  assert.ok(cases.flatMap(item => item.pointIds).every(id => demoIds.has(id)));
  assert.equal(cases[0].id, "lowest-velocity");
});

test("Phase 5 case panel, five-point copy, hover evidence, and map focus are wired", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8"), map = readFileSync("app/components/WebGisMap.tsx", "utf8"), panel = readFileSync("app/components/DataBackedCasePanel.tsx", "utf8");
  assert.match(workspace, /MAX_COMPARE_POINTS/);
  assert.match(workspace, /activateQuickCase/);
  assert.match(workspace, /compare-hover-readout/);
  assert.doesNotMatch(workspace, /slice\(-30\)|\/30|最多 30/);
  assert.match(map, /focusBounds/);
  assert.match(panel, /不新增坐标、不代表区域风险或类别比例/);
});
