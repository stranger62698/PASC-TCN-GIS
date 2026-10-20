import assert from "node:assert/strict";
import test from "node:test";
import { inspectCsv, parseMappedCsv, type CsvMapping } from "../app/lib/insar-v2.js";
import { localSettingsForWorkspaceImport, mergeLocalImportFieldMapping, workspaceImportCoherenceMinimum, workspaceImportVisiblePointIds } from "../app/lib/workspace-local-import.js";

const csv = [
  "id,longitude,latitude,velocity,coherence,D20200101,D20210101",
  "low,110,20,-2,0.6,0,-2",
  "boundary,110.001,20,-2,0.75,0,-2",
  "high,110.002,20,-2,0.9,0,-2",
  "unknown,110.003,20,-2,,0,-2",
].join("\n");
const mapping: CsvMapping = { ...inspectCsv(csv).mapping, displacementUnit: "cm", velocityUnit: "m/year", signConvention: "toward_satellite_positive", preprocessingState: "already_smoothed" };

test("an in-memory import transfers confirmed columns and physical conventions to local PASC", () => {
  const local = localSettingsForWorkspaceImport(mapping);
  assert.deepEqual(local.fieldMapping, { point_id: "id", longitude: "longitude", latitude: "latitude", velocity: "velocity", coherence: "coherence" });
  assert.equal(local.displacementUnit, "cm");
  assert.equal(local.velocityUnit, "m/year");
  assert.equal(local.signConvention, "model_native");
  assert.equal(local.preprocessingState, "already_smoothed");
  assert.equal(localSettingsForWorkspaceImport({ ...mapping, signConvention: "away_from_satellite_positive" }).signConvention, "subsidence_positive");
  const unknown = localSettingsForWorkspaceImport({ ...mapping, signConvention: "unknown", displacementUnit: "unknown", velocityUnit: "unknown" });
  assert.equal(unknown.signConvention, undefined, "unknown sign must remain a manual confirmation");
  assert.equal(unknown.displacementUnit, undefined);
  assert.equal(unknown.velocityUnit, undefined);
  assert.deepEqual(localSettingsForWorkspaceImport(), {});
});

test("late field detection preserves confirmed mappings and intentionally omitted optional columns", () => {
  const detected = { longitude: "longitude", latitude: "latitude", velocity: "velocity", coherence: "coherence" };
  const confirmed = { longitude: "east", latitude: "north", velocity: "", coherence: "" };
  assert.deepEqual(mergeLocalImportFieldMapping(detected, confirmed), confirmed);
  assert.deepEqual(mergeLocalImportFieldMapping(detected), detected);
});

test("the recommended minimum coherence filter displays good points without changing parsed source rows", () => {
  const result = parseMappedCsv(csv, "import.csv", mapping);
  assert.deepEqual(workspaceImportVisiblePointIds(result.points, 0.75), ["boundary", "high"]);
  assert.deepEqual(result.points.map(point => point.id), ["low", "boundary", "high", "unknown"]);
  assert.equal(workspaceImportVisiblePointIds(result.points, null), null, "clearing the display filter restores all source points");
  assert.deepEqual(workspaceImportVisiblePointIds(result.points, 1), []);
  assert.equal(workspaceImportCoherenceMinimum(undefined), null);
  assert.equal(workspaceImportCoherenceMinimum(NaN), null);
  assert.equal(workspaceImportCoherenceMinimum(0), 0);
  assert.equal(workspaceImportCoherenceMinimum(2), 1);
});
