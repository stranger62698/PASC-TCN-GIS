import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PRIMARY_ANALYSIS_MODES,
  filterPointsForPattern,
  formatFiniteValue,
  patternPointOpacity,
} from "../app/lib/v2-map-analysis.js";

const points = ["Stable", "Linear", "Piecewise", "Decelerating", "Accelerating", "Undefined", "unknown"].map((mode, index) => ({ id: String(index), mode }));

test("V2 Phase 1 exposes exactly the three primary analysis modes", () => {
  assert.deepEqual(PRIMARY_ANALYSIS_MODES.map(item => item.value), ["velocity", "displacement", "mode"]);
});

test("anomaly-only visibility is reversible and optionally includes Undefined", () => {
  const anomaly = filterPointsForPattern(points, "anomaly");
  const withUndefined = filterPointsForPattern(points, "anomaly_with_undefined");
  const all = filterPointsForPattern(points, "all");
  assert.deepEqual(anomaly.map(point => point.mode), ["Linear", "Piecewise", "Decelerating", "Accelerating"]);
  assert.deepEqual(withUndefined.map(point => point.mode), ["Linear", "Piecewise", "Decelerating", "Accelerating", "Undefined"]);
  assert.equal(all.length, points.length);
  assert.equal(points.length, 7, "filtering must not mutate the source collection");
});

test("PASC visual hierarchy de-emphasizes Stable and emphasizes Accelerating", () => {
  assert.equal(patternPointOpacity("Stable"), 0.22);
  assert.ok(patternPointOpacity("Stable") < patternPointOpacity("Undefined"));
  assert.ok(patternPointOpacity("Undefined") < patternPointOpacity("Linear"));
  assert.equal(patternPointOpacity("Accelerating"), 1);
});

test("missing numeric map values render as a neutral placeholder", () => {
  assert.equal(formatFiniteValue(Number.NaN), "--");
  assert.equal(formatFiniteValue(Number.POSITIVE_INFINITY), "--");
  assert.equal(formatFiniteValue(12.345), "12.35");
});

test("workspace wiring preserves the full point set for map extent", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const context = readFileSync("app/lib/analysis-context.tsx", "utf8");
  assert.match(workspace, /<AnalysisModeSwitch value=\{attribute\}/);
  assert.match(workspace, /patternVisibility=\{attribute === "mode" \? patternVisibility : "all"\}/);
  assert.match(map, /displayPoints\.forEach/);
  assert.match(map, /lastPoints\.current!==points/);
  assert.match(context, /patternVisibility: PatternVisibility/);
});