import { anomalyPointsCsv } from "../app/lib/analysis-exports.js";
import { selectPriorityDeformationPoints } from "../app/lib/priority-deformation.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { aoiPointsCsv, aoiSeriesCsv, buildAnalysisRuleSummary, comparisonCsv, csvText, pointCsv, safeExportName } from "../app/lib/analysis-exports.js";
import { decodeInsarValue, quantizeInsarSeries, roundInsarValue } from "../app/lib/insar-precision.js";

const point = (id: string, mode: string, series: number[], dates = ["2024-01", "2024-02"]): InsarPoint => ({
  id,
  name: `点位,${id}`,
  lon: 110,
  lat: 20,
  velocity: series.at(-1) ?? 0,
  displacement: series.at(-1) ?? 0,
  coherence: .9,
  missingRate: .01,
  mode,
  modeSource: 'CSV "label"',
  modeConfidence: .8,
  updated: dates.at(-1) || "2024-02",
  dates,
  series,
});

test("Phase 6 CSV output is UTF-8 BOM, CRLF, and safely escaped", () => {
  const csv = csvText([["name", "note"], ["A,1", 'quoted "value"'], [null, Number.NaN]]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"A,1","quoted ""value"""/);
  assert.ok(csv.endsWith("\r\n"));
  assert.match(csv, /\r\n,\r\n$/);
});

test("Phase 6 filenames remove Windows-invalid characters deterministically", () => {
  assert.equal(safeExportName(' 海口:AOI / "case"? '), "海口-AOI-case");
  assert.equal(safeExportName("   "), "lanjifyw-insar");
});

test("InSAR results round to one decimal after computation and use compact tenth-millimeter storage", () => {
  assert.equal(roundInsarValue(-12.345), -12.3);
  const compact = quantizeInsarSeries(Float32Array.from([0, -1.26, 8.94]));
  assert.ok(compact.values instanceof Int16Array);
  assert.equal(compact.values.byteLength, 6);
  assert.deepEqual(Array.from(compact.values, value => decodeInsarValue(value, compact.scale)), [0, -1.3, 8.9]);
  const wide = quantizeInsarSeries(Float32Array.from([4000]));
  assert.ok(wide.values instanceof Int32Array);
});

test("Phase 6 point and comparison exports retain IDs, dates, modes, and escaped names", () => {
  const a = point("A", "稳定型", [0, -1]), b = point("B", "加速型", [0, -4]);
  const single = pointCsv(a), compared = comparisonCsv([a, b]);
  assert.match(single, /point_id,name,longitude/);
  assert.match(single, /"点位,A"/);
  assert.match(single, /2024-02,-1/);
  assert.equal(compared.split("\r\n").filter(Boolean).length, 5);
  assert.match(compared, /B,"点位,B",2024-02,-4/);
  assert.match(pointCsv(point("C", "线性型", [0, -1.26])), /2024-02,-1.3/);
});

test("Phase 6 AOI exports preserve selected points and the active aggregate view", () => {
  const points = [point("A", "稳定型", [0, 2]), point("B", "加速型", [0, -6])];
  const pointRows = aoiPointsCsv(points, 1), aggregate = aoiSeriesCsv(points, "median", ["加速型"], mode => mode);
  assert.match(pointRows, /current_displacement_mm,current_date/);
  assert.match(pointRows, /A,"点位,A",110,20,2,2,2024-02/);
  assert.match(aggregate, /aoi_median_displacement_mm,加速型_displacement_mm/);
  assert.match(aggregate, /2024-02,-2,-6/);
  assert.doesNotMatch(aggregate, /稳定型_displacement_mm/);
});

test("Phase 6 rule summary records transparent thresholds and the safety boundary", () => {
  const summary = buildAnalysisRuleSummary({ datasetName: "海口 Spatial Demo", datasetId: "demo-haikou", analysisId: "analysis-current", anomalyScope: "用户选区 12 点", timeRange: { startDate: "2017-03", endDate: "2025-05" }, displayMode: "形变模式", displayRange: "PASC 固定六类配色", patternVisibility: "仅异常模式", activeFilter: "质量筛选后的异常候选", coherenceThreshold: .75, anomalyRadiusMeters: 200, anomalyMinimumPoints: 3, selectionSource: "异常区域 AR-01", selectedPointCount: 12, priorityRuleVersion: "magnitude-spatial-v2", priorityDirection: "both", priorityEvaluationDate: "2025-05-03", priorityAnomalyCount: 14, priorityIsolatedCount: 3, priorityExcludedCount: 5, priorityDisplacementThresholdMm: 30, priorityVelocityThresholdMmPerYear: 10, priorityCandidateCount: 14, priorityReliableCount: 4, priorityLimitedCount: 10 });
  assert.equal(summary.items.length, 10);
  assert.match(summary.text, /analysis-current/);
  assert.match(summary.text, /用户选区 12 点/);
  assert.match(summary.text, /低相干阈值 0.75/);
  assert.match(summary.text, /双指标达标 AND 同向聚集/);
  assert.match(summary.text, /规则 magnitude-spatial-v2/);
  assert.match(summary.text, /邻域 200 m · 最少 3 点/);
  assert.match(summary.boundary, /不构成工程安全判断/);
  assert.doesNotMatch(summary.text, /风险评分：/);
});

test("Phase 6 exports, finite status, rules, and narrow layouts are wired", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8"), chart = readFileSync("app/components/AoiTimeSeriesChart.tsx", "utf8"), styles = readFileSync("app/globals.css", "utf8"), rules = readFileSync("app/components/AnalysisRuleSummary.tsx", "utf8");
  assert.match(workspace, /workspace-operation-state/);
  assert.match(workspace, /exportAoiPoints/);
  assert.match(workspace, /exportComparison/);
  assert.match(workspace, /AnalysisRuleSummary/);
  assert.match(chart, /导出图表数据 CSV/);
  assert.match(rules, /REPRODUCIBLE ANALYSIS/);
  assert.match(styles, /right-workspace-tabs\{grid-template-columns:repeat\(4/);
  assert.match(styles, /@media\(max-width:520px\)[\s\S]*gis-map\{height:52svh/);
});


test("anomaly CSV exports exact evaluation evidence, membership and reproducible rule parameters", () => {
  const source = Array.from({ length: 5 }, (_, index) => ({ ...point(`P${index}`, "线性型", [0, -40]), lon: 110 + index * .00002, velocity: -15 }));
  source.push({ ...source[0], id: "isolated", lon: 111 });
  const selection = selectPriorityDeformationPoints(source, 1, { evaluationDate: "2024-02" });
  const output = anomalyPointsCsv(source, selection, 0);
  assert.match(output, /evaluation_displacement_mm,evaluation_date,result_status,quality_status,region_id,rule_version/);
  assert.match(output, /-15,-40,2024-02,clustered_anomaly,reliable,AR-01,magnitude-spatial-v2,10,30,both,60,5,0.75,0.2/);
  assert.match(output, /-15,-40,2024-02,isolated_candidate,reliable,,magnitude-spatial-v2/);
});
