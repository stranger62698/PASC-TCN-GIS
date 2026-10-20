import assert from "node:assert/strict";
import test from "node:test";
import type { AnalysisContextState } from "../app/lib/analysis-context";
import { ANALYSIS_CONTEXT_MAX_PERSISTED_IDS, ANALYSIS_CONTEXT_MAX_STORAGE_BYTES, ANALYSIS_CONTEXT_STORAGE_KEY, createAnalysisContextPersistence, parseAnalysisContext, serializeAnalysisContext } from "../app/lib/analysis-context-storage";

const stateFor = (ids: string[]): AnalysisContextState => ({
  datasetId: "local-user-csv", datasetName: "用户 CSV",
  timeRange: { startIndex: 0, endIndex: 247, startDate: "2020-01-01", endDate: "2025-01-01" },
  filters: { active: "anomaly", velocityMax: -10, coherenceMin: .7, resultCount: ids.length },
  activeColorMode: "velocity", patternVisibility: "anomaly", selectedPointId: ids[0] ?? null,
  selectedRegion: { bounds: [110, 20, 111, 21], pointIds: ids, geometry: { type: "polygon", coordinates: [[110, 20], [111, 20], [111, 21], [110, 21]] }, regionId: "old-anomaly-region", label: "我的范围", source: "anomalyRegion" },
  selectedRegionStats: { pointCount: ids.length, averageVelocity: -12, maximumDisplacement: 30, qualityCount: ids.length, modeCounts: { "线性型": ids.length } },
  mapView: { center: [20.5, 110.5], zoom: 12, bounds: [110, 20, 111, 21] },
});

function memoryStorage(initial?: string) {
  const entries = new Map(initial ? [[ANALYSIS_CONTEXT_STORAGE_KEY, initial]] : []);
  return { entries, getItem(key: string) { return entries.get(key) ?? null; }, setItem(key: string, value: string) { entries.set(key, value); }, removeItem(key: string) { entries.delete(key); } };
}

test("755,800 runtime IDs stay intact while persistence retains bounded geometry and count", () => {
  const ids = Array.from({ length: 755800 }, (_, i) => `point-${i}`), state = stateFor(ids);
  const stats = state.selectedRegionStats, filters = state.filters, geometry = state.selectedRegion!.geometry;
  const serialized = serializeAnalysisContext(state)!;
  assert.ok(new TextEncoder().encode(serialized).length <= ANALYSIS_CONTEXT_MAX_STORAGE_BYTES);
  assert.ok(serialized.length < 4096);
  assert.equal(state.selectedRegion!.pointIds, ids);
  assert.equal(ids.length, 755800);
  assert.equal(state.selectedRegionStats, stats);
  assert.equal(state.filters, filters);
  assert.equal(state.selectedRegion!.geometry, geometry);
  const restored = parseAnalysisContext(serialized);
  assert.deepEqual(restored.selectedRegion!.pointIds, []);
  assert.equal(restored.selectedRegion!.pointCount, 755800);
  assert.equal(restored.selectedRegion!.pointIdsComplete, false);
  assert.deepEqual(restored.selectedRegion!.geometry, geometry);
  assert.equal(restored.selectedRegion!.regionId, undefined);
  assert.equal(restored.selectedRegion!.source, "polygon");
  assert.equal(restored.selectedRegionStats, null);
  assert.equal(restored.filters!.active, "none");
  assert.equal(restored.filters!.resultCount, 0);
  assert.match(restored.selectedRegion!.label!, /需重新圈选点位/);
  const second = parseAnalysisContext(serializeAnalysisContext({ ...state, ...restored })!);
  assert.equal(second.selectedRegion!.pointCount, 755800);
  assert.equal(second.selectedRegion!.pointIdsComplete, false);
  assert.equal(second.selectedRegion!.label!.match(/需重新圈选点位/g)!.length, 1);
});

test("small complete selections and legacy contexts restore membership and matching statistics", () => {
  const state = stateFor(["p1", "p2"]), restored = parseAnalysisContext(serializeAnalysisContext(state)!);
  assert.deepEqual(restored.selectedRegion!.pointIds, ["p1", "p2"]);
  assert.equal(restored.selectedRegion!.pointIdsComplete, true);
  assert.equal(restored.selectedRegion!.pointCount, 2);
  assert.equal(restored.selectedRegion!.regionId, "old-anomaly-region");
  assert.deepEqual(restored.selectedRegionStats, state.selectedRegionStats);
  assert.deepEqual(restored.filters, state.filters);
  assert.equal(parseAnalysisContext(JSON.stringify(state)).selectedRegion!.pointIdsComplete, true);
});

test("legacy large IDs, duplicates, mismatched counts and missing ID arrays cannot claim complete membership", () => {
  const large = stateFor(Array.from({ length: ANALYSIS_CONTEXT_MAX_PERSISTED_IDS + 1 }, (_, i) => `p${i}`));
  const restored = parseAnalysisContext(JSON.stringify(large));
  assert.equal(restored.selectedRegion!.pointCount, large.selectedRegion!.pointIds.length);
  assert.equal(restored.selectedRegion!.pointIdsComplete, false);
  for (const membership of [{ pointIds: ["p1", "p1"] }, { pointIds: ["p1", "p2"], pointCount: 1 }, { pointIds: ["p1", "p2"], pointCount: 3 }, { pointIds: undefined }]) {
    const source = stateFor(["p1", "p2"]);
    const parsed = parseAnalysisContext(JSON.stringify({ ...source, selectedRegion: { ...source.selectedRegion, ...membership } }));
    assert.equal(parsed.selectedRegion!.pointIdsComplete, false);
    assert.deepEqual(parsed.selectedRegion!.pointIds, []);
    assert.equal(parsed.selectedRegionStats, null);
    assert.equal(parsed.filters!.resultCount, 0);
  }
});

test("byte limit catches long IDs and huge polygon geometry without mutating runtime geometry", () => {
  const state = stateFor(["x".repeat(ANALYSIS_CONTEXT_MAX_STORAGE_BYTES)]);
  // A long selected point identifier can also be present in old/custom datasets.
  state.selectedPointId = null;
  let restored = parseAnalysisContext(serializeAnalysisContext(state)!);
  assert.equal(restored.selectedRegion!.pointIdsComplete, false);
  assert.equal(restored.selectedRegion!.pointCount, 1);
  const vertices = Array.from({ length: 30000 }, (_, i): [number, number] => [110 + i / 30000, 20 + (i % 2)]);
  state.selectedRegion!.geometry = { type: "polygon", coordinates: vertices };
  const serialized = serializeAnalysisContext(state)!;
  assert.ok(new TextEncoder().encode(serialized).length <= ANALYSIS_CONTEXT_MAX_STORAGE_BYTES);
  restored = parseAnalysisContext(serialized);
  assert.equal(restored.selectedRegion!.geometry, undefined);
  assert.equal(restored.selectedRegion!.geometryComplete, false);
  assert.equal(restored.selectedRegion!.source, "rectangle");
  assert.deepEqual(restored.selectedRegion!.bounds, [110, 20, 111, 21]);
  assert.equal(state.selectedRegion!.geometry.coordinates, vertices);
  assert.match(restored.selectedRegion!.label!, /边界范围已恢复/);
});

test("disabled storage getter never throws and disables subsequent reads and writes", () => {
  let attempts = 0;
  const persistence = createAnalysisContextPersistence(() => { attempts += 1; throw new Error("SecurityError: storage disabled"); });
  assert.equal(persistence.read(), null);
  assert.equal(persistence.write(stateFor(["p1"])), false);
  assert.equal(persistence.read(), null);
  assert.equal(attempts, 1);
});

test("quota failure does not affect full runtime membership or retry each map update", () => {
  const ids = Array.from({ length: 100000 }, (_, i) => `p${i}`), state = stateFor(ids);
  let writes = 0;
  const storage = { ...memoryStorage(), setItem() { writes += 1; throw new Error("QuotaExceededError"); } };
  const persistence = createAnalysisContextPersistence(() => storage);
  assert.equal(persistence.write(state), false);
  assert.equal(persistence.write({ ...state, selectedPointId: "p99" }), false);
  assert.equal(writes, 1);
  assert.equal(state.selectedRegion!.pointIds, ids);
  assert.equal(state.filters.resultCount, 100000);
});

test("malformed saved JSON and failing removeItem do not break context restoration", () => {
  let removals = 0;
  const storage = { ...memoryStorage("{malformed"), removeItem() { removals += 1; throw new Error("storage disabled"); } };
  const persistence = createAnalysisContextPersistence(() => storage);
  assert.equal(persistence.read(), null);
  assert.equal(persistence.write(stateFor(["p1"])), false);
  assert.equal(removals, 1);
});

test("bounded persistence writes its own key and restores a useful map view", () => {
  const storage = memoryStorage(), persistence = createAnalysisContextPersistence(() => storage), state = stateFor(["p1"]);
  assert.equal(persistence.write(state), true);
  assert.deepEqual(persistence.read()!.mapView, state.mapView);
  assert.deepEqual([...storage.entries.keys()], [ANALYSIS_CONTEXT_STORAGE_KEY]);
});