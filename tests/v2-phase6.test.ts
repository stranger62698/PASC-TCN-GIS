import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { aoiPointsCsv, aoiSeriesCsv, buildAnalysisRuleSummary, comparisonCsv, csvText, pointCsv, safeExportName } from "../app/lib/analysis-exports.js";

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

test("Phase 6 point and comparison exports retain IDs, dates, modes, and escaped names", () => {
  const a = point("A", "稳定型", [0, -1]), b = point("B", "加速型", [0, -4]);
  const single = pointCsv(a), compared = comparisonCsv([a, b]);
  assert.match(single, /point_id,name,longitude/);
  assert.match(single, /"点位,A"/);
  assert.match(single, /2024-02,-1/);
  assert.equal(compared.split("\r\n").filter(Boolean).length, 5);
  assert.match(compared, /B,"点位,B",2024-02,-4/);
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
  const summary = buildAnalysisRuleSummary({ datasetName: "海口 Spatial Demo", datasetId: "demo-haikou", timeRange: { startDate: "2017-03", endDate: "2025-05" }, displayMode: "形变模式", displayRange: "PASC 固定六类配色", patternVisibility: "仅异常模式", activeFilter: "质量筛选后的异常候选", coherenceThreshold: .75, anomalyRadiusMeters: 200, anomalyMinimumPoints: 3, selectionSource: "异常区域 AR-01", selectedPointCount: 12 });
  assert.equal(summary.items.length, 8);
  assert.match(summary.text, /低相干阈值 0.75/);
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
  assert.match(styles, /@media\(max-width:520px\).*gis-map\{height:52svh/s);
});
