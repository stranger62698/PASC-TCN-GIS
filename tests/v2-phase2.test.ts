import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { deriveTemporalStageAnalysis, pascModeExplanation, pointDataQuality, topPascCandidates } from "../app/lib/pasc-product.js";
import type { PascPointResult } from "../app/types/pasc.js";

const result = { calibratedLabelId: 4, calibratedLabel: "Accelerating", probabilities: { Stable: .02, Linear: .06, Piecewise: .15, Decelerating: .04, Accelerating: .7, Undefined: .03 }, confidence: .7 } as PascPointResult;
const point = { id: "P2", name: "P2", lon: 110, lat: 20, velocity: -8, displacement: -30, coherence: .9, missingRate: .02, mode: "加速型", modeConfidence: .7, updated: "2024-01-01", dates: Array.from({ length: 10 }, (_, index) => `${2015 + index}-01-01`), series: [0, -1, -2, -3, -4, -8, -13, -19, -26, -34], pasc: result } as InsarPoint;

test("Phase 2 ranks calibrated PASC probabilities as Top-2", () => {
  assert.deepEqual(topPascCandidates(result).map(item => item.name), ["Accelerating", "Piecewise"]);
});

test("data quality remains separate from the classified mode", () => {
  const quality = pointDataQuality({ ...point, mode: "Undefined", coherence: .35 }, .75);
  assert.equal(quality.level, "low");
  assert.match(quality.reasons.join(" "), /相干性/);
  assert.equal(topPascCandidates(result)[0].name, "Accelerating");
});

test("mode explanation is bounded and contains no disaster conclusion", () => {
  const explanation = pascModeExplanation(point) ?? "";
  assert.match(explanation, /加速趋势/);
  assert.doesNotMatch(explanation, /危险|即将失稳|灾害预测/);
});

test("candidate change point and real-date stage slopes are deterministic", () => {
  const stage = deriveTemporalStageAnalysis(point);
  assert.ok(stage);
  assert.equal(stage.source, "derived");
  assert.ok(stage.changeIndex >= 3 && stage.changeIndex <= 7);
  assert.ok(stage.slopeAfter < stage.slopeBefore);
  assert.match(stage.method, /改善门槛 10%/);
  const linear = deriveTemporalStageAnalysis({ ...point, series: point.series.map((_, index) => -index) });
  assert.equal(linear, null);
});

test("Phase 2 product evidence is wired into point, PASC, map tooltip, and chart", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const panel = readFileSync("app/components/PascAnalysisPanel.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  assert.match(workspace, /selectedTopTwo/);
  assert.match(workspace, /point-stage-analysis/);
  assert.match(workspace, /chart-change-point/);
  assert.match(panel, /pasc-product-evidence/);
  assert.match(map, /Confidence:/);
});
