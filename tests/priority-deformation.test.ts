import assert from "node:assert/strict";
import test from "node:test";
import type { InsarPoint } from "../app/data/site.js";
import { buildAnomalyRegions } from "../app/lib/anomaly-regions.js";
import { DEFAULT_PRIORITY_OPTIONS, displacementAt, formatPriorityDeformationRule, normalizePriorityOptions, selectPriorityDeformationPoints } from "../app/lib/priority-deformation.js";

const point = (id: string, xMeters = 0, patch: Partial<InsarPoint> = {}): InsarPoint => ({
  id, name: id, lon: 110 + xMeters / (111_195 * Math.cos(20 * Math.PI / 180)), lat: 20,
  velocity: -10, velocitySource: "provided", displacement: -30, coherence: .9,
  coherenceSource: "provided", missingRate: 0, mode: "线性型", updated: "2026-01-03", series: [0, -30], ...patch,
});
const cluster = (prefix = "c", patch: Partial<InsarPoint> = {}) => Array.from({ length: 5 }, (_, index) => point(`${prefix}-${index}`, index * 5, patch));
const ids = (points: InsarPoint[]) => points.map(item => item.id).sort();

test("defaults use both absolute magnitudes, consistent direction and five spatial neighbors", () => {
  const selection = selectPriorityDeformationPoints(cluster(), 1);
  assert.equal(selection.ruleVersion, "magnitude-spatial-v2");
  assert.deepEqual(selection.thresholds, { velocityMmPerYear: 10, displacementMm: 30 });
  assert.equal(selection.options.radiusMeters, 60);
  assert.equal(selection.options.minimumPoints, 5);
  assert.equal(selection.anomalies.length, 5);
  assert.equal(selection.reliable.length, 5);
  assert.equal(selection.regions.regions.length, 1);
  assert.equal(selection.regions.regions[0].meanCurrentDisplacement, -30);
});

test("both amplitude conditions must pass and their signs must agree", () => {
  const rejected = [point("slow", 0, { velocity: -9.999 }), point("small", 5, { series: [0, -29.999] }),
    point("opposite", 10, { velocity: 20 }), point("zero", 15, { velocity: 0 }), point("stable", 20, { velocity: -.2, series: [0, -.5] })];
  const selection = selectPriorityDeformationPoints(rejected, 1);
  assert.equal(selection.amplitudeCandidates.length, 0);
  assert.equal(selection.anomalies.length, 0);
  assert.equal(selection.regions.status, "ready");
});

test("the rule does not force a fixed fraction of a stable dataset to be abnormal", () => {
  const stable = Array.from({ length: 100 }, (_, i) => point(`stable-${i}`, i * 5, { velocity: -.1 - i * .01, series: [0, -1 - i * .1] }));
  const selection = selectPriorityDeformationPoints(stable, 1);
  assert.equal(selection.candidates.length, 0);
  assert.equal(selection.regions.regions.length, 0);
  assert.deepEqual(selection.thresholds, { velocityMmPerYear: DEFAULT_PRIORITY_OPTIONS.velocityMmPerYear, displacementMm: DEFAULT_PRIORITY_OPTIONS.displacementMm });
});

test("a large isolated point stays a candidate and never becomes a final anomaly", () => {
  const points = [...cluster(), point("isolated", 1000, { velocity: -100, series: [0, -300] })];
  const selection = selectPriorityDeformationPoints(points, 1);
  assert.equal(selection.candidates.length, 6);
  assert.equal(selection.anomalies.length, 5);
  assert.deepEqual(ids(selection.isolated), ["isolated"]);
});

test("positive and negative directions cannot jointly manufacture spatial density", () => {
  const negative = cluster("negative").slice(0, 3), positive = cluster("positive", { velocity: 10, series: [0, 30] }).slice(0, 3);
  assert.equal(selectPriorityDeformationPoints([...negative, ...positive], 1).anomalies.length, 0);
  const both = [...cluster("negative"), ...cluster("positive", { velocity: 10, series: [0, 30] })];
  const selection = selectPriorityDeformationPoints(both, 1);
  assert.equal(selection.regions.regions.length, 2);
  assert.ok(selection.regions.regions.every(region => region.direction !== "mixed"));
  assert.deepEqual(ids(selectPriorityDeformationPoints(both, 1, { direction: "positive" }).anomalies), ids(both.slice(5)));
  assert.deepEqual(ids(selectPriorityDeformationPoints(both, 1, { direction: "negative" }).anomalies), ids(both.slice(0, 5)));
});

test("known low quality cannot act as the fifth supporting neighbor", () => {
  for (const patch of [{ coherence: .74 }, { coherence: 0 }, { missingRate: .21 }, { missingRate: 2 }]) {
    const points = cluster();
    Object.assign(points[4], patch);
    const selection = selectPriorityDeformationPoints(points, 1);
    assert.equal(selection.amplitudeCandidates.length, 5);
    assert.equal(selection.excludedLowQuality.length, 1);
    assert.equal(selection.candidates.length, 4);
    assert.equal(selection.anomalies.length, 0);
    assert.equal(selection.limited.length, 0);
  }
});

test("unknown coherence may support preliminary spatial results but is never reliable", () => {
  for (const patch of [{ coherenceSource: "not_available" as const, coherence: 0 }, { coherenceSource: "default" as const }, { coherence: Number.NaN }, { coherence: 1.2 }]) {
    const points = cluster();
    Object.assign(points[4], patch);
    const selection = selectPriorityDeformationPoints(points, 1);
    assert.equal(selection.anomalies.length, 5);
    assert.equal(selection.excludedLowQuality.length, 0);
    assert.equal(selection.reliable.length, 4);
    assert.deepEqual(ids(selection.limited), ["c-4"]);
  }
  const unknown = selectPriorityDeformationPoints(cluster("unknown", { coherenceSource: "not_available", coherence: 0 }), 1);
  assert.equal(unknown.limited.length, 5);
  assert.equal(unknown.reliable.length, 0);
});

test("inclusive quality boundaries pass and missing observations cannot be hidden by a false rate", () => {
  const atBoundary = selectPriorityDeformationPoints(cluster("boundary", { coherence: .75, missingRate: .2 }), 1);
  assert.equal(atBoundary.reliable.length, 5);
  const missing = selectPriorityDeformationPoints(cluster("missing", { series: [Number.NaN, -30], missingRate: 0 }), 1);
  assert.equal(missing.excludedLowQuality.length, 5);
  assert.equal(missing.anomalies.length, 0);
});

test("an evaluation date reads the exact observed epoch even when valid series were compacted", () => {
  const dates = ["2026-01-01", "2026-01-03"];
  const points = cluster("compacted", { dates, series: [0, -35], displacement: -100 });
  const selected = selectPriorityDeformationPoints(points, 2, { evaluationDate: "2026-01-03" });
  assert.equal(selected.anomalies.length, 5);
  assert.equal(selected.regions.regions[0].meanCurrentDisplacement, -35);
  const missingDate = selectPriorityDeformationPoints(points, 1, { evaluationDate: "2026-01-02" });
  assert.equal(missingDate.invalid.length, 5);
  assert.equal(missingDate.amplitudeCandidates.length, 0);
});

test("a missing requested epoch, out-of-range index or absent series never falls back to final displacement", () => {
  assert.ok(Number.isNaN(displacementAt(point("out"), 3)));
  assert.ok(Number.isNaN(displacementAt(point("negative"), -1)));
  assert.ok(Number.isNaN(displacementAt(point("fractional"), .5)));
  assert.ok(Number.isNaN(displacementAt(point("no-series", 0, { series: [] }), 0)));
  const missing = selectPriorityDeformationPoints(cluster("missing", { series: [0, Number.NaN], displacement: -100 }), 1);
  assert.equal(missing.invalid.length, 5);
  assert.equal(missing.candidates.length, 0);
});

test("invalid coordinates and placeholder/unavailable velocities are excluded before density counting", () => {
  const patches: Partial<InsarPoint>[] = [{ lon: Number.NaN }, { lat: 91 }, { lon: 181 }, { lon: 0, lat: 0 }, { velocity: Infinity }, { velocitySource: "default" }, { velocitySource: "not_available" }];
  const selection = selectPriorityDeformationPoints(patches.map((patch, i) => point(`invalid-${i}`, 0, patch)), 1);
  assert.equal(selection.invalid.length, patches.length);
  assert.equal(selection.candidates.length, 0);
});

test("duplicate coordinates do not count as independent density support", () => {
  const duplicates = Array.from({ length: 10 }, (_, index) => point(`duplicate-${index}`));
  assert.equal(selectPriorityDeformationPoints(duplicates, 1).anomalies.length, 0);
  const supported = selectPriorityDeformationPoints([...cluster(), ...duplicates], 1);
  assert.equal(supported.regions.regions.length, 1);
  assert.equal(supported.anomalies.length, 15);
});

test("DBSCAN border points join a core neighborhood but cannot extend a sparse chain", () => {
  const points = [...cluster(), point("border", 40), point("sparse-tail", 60)];
  const selection = selectPriorityDeformationPoints(points, 1, { radiusMeters: 25 });
  assert.ok(ids(selection.anomalies).includes("border"));
  assert.deepEqual(ids(selection.isolated), ["sparse-tail"]);
  const reversed = selectPriorityDeformationPoints([...points].reverse(), 1, { radiusMeters: 25 });
  assert.deepEqual(selection.regions.regions, reversed.regions.regions);
});

test("sphere distances retain correct neighborhood size at high latitude and across the date line", () => {
  const high = Array.from({ length: 5 }, (_, i) => point(`polar-${i}`, 0, { lat: 80, lon: 30 + i * 5 / (111_195 * Math.cos(80 * Math.PI / 180)) }));
  const dateline = Array.from({ length: 5 }, (_, i) => point(`date-${i}`, 0, { lat: 1, lon: i < 3 ? 179.9999 + i * .00002 : -179.99998 + (i - 3) * .00002 }));
  assert.equal(selectPriorityDeformationPoints(high, 1).anomalies.length, 5);
  assert.equal(selectPriorityDeformationPoints(dateline, 1).anomalies.length, 5);
});

test("candidate limits fail closed without labelling unassessed points as isolated", () => {
  const points = Array.from({ length: 1001 }, (_, index) => point(`large-${index}`, index));
  const selection = selectPriorityDeformationPoints(points, 1, { maximumCandidates: 1000 });
  assert.equal(selection.regions.status, "too_large");
  assert.equal(selection.anomalies.length, 0);
  assert.equal(selection.isolated.length, 0);
  assert.match(formatPriorityDeformationRule(selection), /尚未聚集/);
});

test("parameter normalization supplies finite bounds and explicit rule wording", () => {
  const options = normalizePriorityOptions({ velocityMmPerYear: NaN, radiusMeters: Infinity, minimumPoints: 2.7, coherenceThreshold: 2, maxMissingRate: -1 });
  assert.equal(options.velocityMmPerYear, 10);
  assert.equal(options.radiusMeters, 60);
  assert.equal(options.minimumPoints, 3);
  assert.equal(options.coherenceThreshold, 1);
  assert.equal(options.maxMissingRate, 0);
  const label = formatPriorityDeformationRule(selectPriorityDeformationPoints(cluster(), 1));
  assert.match(label, /同号/);
  assert.match(label, /不同坐标点（含自身）/);
  assert.doesNotMatch(label, /分位|尾部/);
});

test("legacy region calls preserve output fields and permit optional mixed direction grouping", () => {
  const result = buildAnomalyRegions([point("a"), point("b", 5, { velocity: 10 })], { radiusMeters: 60, minimumPoints: 2 }, 1);
  assert.equal(result.assignedPointCount, 2);
  assert.equal(result.regions[0].direction, "mixed");
  assert.equal(result.regions[0].pointCount, 2);
  assert.ok(result.regions[0].geometry.coordinates.length >= 3);
});


test("every reported region retains the minimum distinct locations after shared borders are assigned", () => {
  const points = Array.from({ length: 150 }, (_, i) => point(`shared-${i}`, (i % 30) * 19, { lat: 20 + Math.floor(i / 30) * .00014 }));
  const selection = selectPriorityDeformationPoints(points, 1, { radiusMeters: 25, minimumPoints: 5 });
  for (const region of selection.regions.regions) {
    const members = points.filter(item => region.pointIds.includes(item.id));
    assert.ok(new Set(members.map(item => `${item.lon}:${item.lat}`)).size >= 5);
  }
});
