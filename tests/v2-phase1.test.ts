import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectCsv, parseMappedCsv } from "../app/lib/insar-v2.js";
import { pointDataBounds } from "../app/lib/full-point-layer.js";
import {
  PRIMARY_ANALYSIS_MODES,
  filterPointsForPattern,
  filterPointsForModes,
  formatFiniteValue,
  patternPointOpacity,
} from "../app/lib/v2-map-analysis.js";

const points = ["Stable", "Linear", "Piecewise", "Decelerating", "Accelerating", "Undefined", "unknown"].map((mode, index) => ({ id: String(index), mode }));

test("user CSV import automatically finds mixed date headers, orders observations and respects a manual date subset", () => {
  const csv = [
    "point_id,longitude,latitude,D_20230315,20210101,D20220101,2020-02-29,D_20230229,notes",
    "P1,110.35,20.09,3,1,2,0,99,20",
  ].join("\n");
  const inspection = inspectCsv(csv);
  assert.deepEqual(inspection.mapping.timeCols, ["2020-02-29", "20210101", "D20220101", "D_20230315"]);
  assert.deepEqual(inspection.unparsedTimeColumns, ["D_20230229"], "an invalid calendar date must remain a warning rather than become an observation");
  const mapping = { ...inspection.mapping, displacementUnit: "mm" as const, velocityUnit: "mm/year" as const, signConvention: "toward_satellite_positive" as const, preprocessingState: "raw" as const };
  const result = parseMappedCsv(csv, "mixed-dates.csv", mapping);
  assert.equal(result.periods, 4);
  assert.deepEqual(result.quality.timeColumns, inspection.mapping.timeCols);
  assert.deepEqual(result.points[0].dates, ["2020-02-29", "2021-01-01", "2022-01-01", "2023-03-15"]);
  assert.deepEqual(result.points[0].series, [0, 1, 2, 3]);
  const manual = parseMappedCsv(csv, "mixed-dates.csv", { ...mapping, timeCols: ["D_20230315", "20210101"] });
  assert.equal(manual.periods, 2);
  assert.deepEqual(manual.points[0].dates, ["2021-01-01", "2023-03-15"]);
  assert.deepEqual(manual.points[0].series, [1, 3]);
});

test("user CSV import normalizes BOM and header whitespace without changing data IDs", () => {
  const csv = "\uFEFFpoint_id, longitude , latitude , D_20240113 , 20240101 , Time.2024-01-25 \nCase Mixed 001,110.35,20.09,-1,0,-2";
  const inspection = inspectCsv(csv);
  assert.equal(inspection.mapping.lon, "longitude");
  assert.equal(inspection.mapping.lat, "latitude");
  assert.deepEqual(inspection.mapping.timeCols, ["20240101", "D_20240113", "Time.2024-01-25"]);
  const result = parseMappedCsv(csv, "spaced-headers.csv", { ...inspection.mapping, displacementUnit: "mm", signConvention: "toward_satellite_positive", preprocessingState: "raw" });
  assert.equal(result.periods, 3);
  assert.equal(result.points[0].id, "Case Mixed 001");
  assert.deepEqual(result.points[0].dates, ["2024-01-01", "2024-01-13", "2024-01-25"]);
  assert.deepEqual(result.points[0].series, [0, -1, -2]);
});

test("automatic date deduplication cannot hide conflicting same-day source aliases", () => {
  const header = "point_id,longitude,latitude,D20240101,D_20240101,20240113";
  const conflict = `${header}\nP1,110.35,20.09,0,9,-1`;
  const inspection = inspectCsv(conflict);
  assert.deepEqual(inspection.mapping.timeCols, ["D20240101", "20240113"]);
  const mapping = { ...inspection.mapping, displacementUnit: "mm" as const, signConvention: "toward_satellite_positive" as const, preprocessingState: "raw" as const };
  assert.throws(() => parseMappedCsv(conflict, "conflict.csv", mapping), /PASC_DUPLICATE_DATE_CONFLICT/);
  const matching = parseMappedCsv(`${header}\nP1,110.35,20.09,0,0,-1`, "matching.csv", mapping);
  assert.equal(matching.periods, 2);
  assert.deepEqual(matching.compatibility.duplicateDates, ["2024-01-01"]);
  const ambiguous = "point_id,longitude,latitude,D20240101, D20240101 ,20240113\nP1,110.35,20.09,0,9,-1";
  assert.throws(() => inspectCsv(ambiguous), /重复字段名/);
  assert.throws(() => parseMappedCsv(ambiguous, "ambiguous.csv", mapping), /重复字段名/);
});

test("selected observation dates recover a finite same-day alias while retaining true missing values and manual exclusions", () => {
  const csv = [
    "point_id,longitude,latitude,velocity,D20240101,D_20240101,20240113",
    "alias,110.35,20.09,-1,,0,-1",
    "primary,110.351,20.09,-1,0,,-1",
    "missing,110.352,20.09,-1,,,-1",
  ].join("\n");
  const mapping = { ...inspectCsv(csv).mapping, displacementUnit: "mm" as const, velocityUnit: "mm/year" as const, signConvention: "toward_satellite_positive" as const, preprocessingState: "raw" as const };
  const parsed = parseMappedCsv(csv, "date-alias-values.csv", mapping);
  for (const point of parsed.points.slice(0, 2)) {
    assert.deepEqual(point.dates, ["2024-01-01", "2024-01-13"]);
    assert.deepEqual(point.series, [0, -1], "an explicit zero in either alias is an observation");
    assert.equal(point.missingRate, 0);
  }
  assert.deepEqual(parsed.points[2].dates, ["2024-01-13"]);
  assert.deepEqual(parsed.points[2].series, [-1]);
  assert.equal(parsed.points[2].missingRate, .5);
  assert.equal(parsed.quality.missingRate, 1 / 6);
  const reverse = parseMappedCsv(csv, "date-alias-values.csv", { ...mapping, timeCols: ["D_20240101", "20240113"] });
  assert.deepEqual(reverse.points.map(point => point.series), parsed.points.map(point => point.series));
  const subset = parseMappedCsv(csv, "date-alias-values.csv", { ...mapping, timeCols: ["20240113"] });
  assert.equal(subset.periods, 1);
  assert.ok(subset.points.every(point => point.dates?.length === 1 && point.dates[0] === "2024-01-13" && point.series[0] === -1 && point.missingRate === 0));
});

test("blank numeric CSV cells remain missing observations while explicit zero stays valid", () => {
  const csv = [
    "id,lon,lat,velocity,coherence,D20200101,D20210101,D20220101",
    "missing,110,20,, ,0,-12, ",
    "zero,110.001,20,0,0,0,0,0",
  ].join("\n");
  const result = parseMappedCsv(csv, "missing.csv", {
    ...inspectCsv(csv).mapping,
    displacementUnit: "mm",
    velocityUnit: "mm/year",
    signConvention: "toward_satellite_positive",
    preprocessingState: "raw",
  });
  const missing = result.points[0], zero = result.points[1];
  assert.deepEqual(missing.series, [0, -12]);
  assert.deepEqual(missing.dates, ["2020-01-01", "2021-01-01"]);
  assert.equal(missing.displacement, -12, "blank final epoch must not create a zero displacement");
  assert.equal(missing.missingRate, 1 / 3);
  assert.equal(result.quality.missingRate, 1 / 6);
  assert.equal(missing.velocitySource, "calculated");
  assert.ok(missing.velocity < -11 && missing.velocity > -13);
  assert.equal(missing.coherenceSource, "not_available");
  assert.deepEqual(zero.series, [0, 0, 0]);
  assert.equal(zero.missingRate, 0);
  assert.equal(zero.velocitySource, "provided");
  assert.equal(zero.velocity, 0);
  assert.equal(zero.coherenceSource, "provided");
  assert.equal(zero.coherence, 0);
});

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

test("defined PASC classes stay legible while only Undefined remains strongly transparent", () => {
  assert.equal(patternPointOpacity("Stable"), 0.86);
  assert.ok(patternPointOpacity("Undefined") < patternPointOpacity("Stable"));
  assert.ok(patternPointOpacity("Stable") < patternPointOpacity("Linear"));
  assert.equal(patternPointOpacity("Accelerating"), 1);
});

test("QGIS-style mode visibility can independently hide and restore every category", () => {
  assert.deepEqual(filterPointsForModes(points, ["稳定型", "加速型"]).map(point => point.mode), ["Linear", "Piecewise", "Decelerating", "Undefined", "unknown"]);
  assert.equal(filterPointsForModes(points, []).length, points.length);
});

test("missing numeric map values render as a neutral placeholder", () => {
  assert.equal(formatFiniteValue(Number.NaN), "--");
  assert.equal(formatFiniteValue(Number.POSITIVE_INFINITY), "--");
  assert.equal(formatFiniteValue(12.345), "12.3");
});

test("workspace wiring preserves the full point set for map extent", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const context = readFileSync("app/lib/analysis-context.tsx", "utf8");
  assert.match(workspace, /<WorkspaceSelect label="地图显示属性" value=\{attribute\} onChange=\{setAttribute\}/);
  assert.match(workspace, /patternVisibility=\{attribute === "mode" \? patternVisibility : "all"\}/);
  assert.match(workspace, /hiddenModes=\{attribute === "mode" \? hiddenModes : \[\]\}/);
  assert.match(workspace, /filteredPointIds=\{filteredMapPointIds\}/);
  // Rendering consumes the filtered display set; extent remains based on the source.
  // FullPointLayer's separate behavior suite covers drawing every source/viewport point.
  assert.match(map, /pointLayer\.current\.update\(\{points:displayPoints,index:spatialIndex/);
  assert.match(map, /onToggleMode\(mode\)/);
  assert.match(workspace, /onClick=\{applyThreshold\}/);
  assert.doesNotMatch(map, /onApplyVelocityFilter/);
  assert.match(map, /const extent\s*=\s*pointDataBounds\(points\)/);
  assert.doesNotMatch(map, /pointDataBounds\(displayPoints\)/);
  assert.match(map, /lastExtent\.current\s*=\s*extent/);
  const sourcePoints = [
    { id: "visible", mode: "Stable", lon: 110, lat: 20 },
    { id: "hidden-edge", mode: "Linear", lon: 111, lat: 21 },
  ];
  assert.deepEqual(pointDataBounds(sourcePoints), [110, 20, 111, 21]);
  assert.deepEqual(pointDataBounds(filterPointsForModes(sourcePoints, ["Linear"])), [110, 20, 110, 20]);
  assert.match(context, /patternVisibility: PatternVisibility/);
});
