import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { adaptLocalPredictionToMapData, localPredictionCsv } from "../app/lib/pasc-local-map-adapter.js";
import type { PascLocalCompletePayload } from "../app/lib/pasc-local-worker-protocol.js";

function fixture(): PascLocalCompletePayload {
  return {
    pointIds: ["P-1", "P-2"],
    rawModeIndex: Uint8Array.from([1, 4]),
    modeIndex: Uint8Array.from([1, 5]),
    confidence: Float32Array.from([0.82, 0.51]),
    probabilities: Float32Array.from([
      0.02, 0.82, 0.04, 0.04, 0.05, 0.03,
      0.08, 0.09, 0.12, 0.1, 0.1, 0.51,
    ]),
    classCounts: Uint32Array.from([0, 1, 0, 0, 0, 1]),
    longitude: Float32Array.from([110.1, 110.2]),
    latitude: Float32Array.from([20.1, 20.2]),
    velocity: Float32Array.from([-3.2, 1.1]),
    velocityProvided: Uint8Array.from([1, 0]),
    coherence: Float32Array.from([0.88, 0.5]),
    coherenceProvided: Uint8Array.from([1, 0]),
    missingRate: Float32Array.from([0, 0.1]),
    displacementSeries: Int16Array.from([0, -10, -20, 0, 4, 7]),
    displacementScale: 0.1,
    displacementEncoding: "int16_tenth_mm",
    spatialReliability: Float32Array.from([0.7, 0]),
    spatialGateMean: Float32Array.from([0.4, 0]),
    spatialReferenceSource: Uint8Array.from([1, 0]),
    dates: ["2024-01-01", "2024-01-13", "2024-01-25"],
    sourceEpochs: 248,
    insertedEpochs: 0,
    totalRows: 3,
    invalidRows: 1,
    timeSteps: 3,
    elapsedMs: 1200,
    provider: "webgpu",
    batchSize: 256,
    fileSizeBytes: 4096,
    csvParsingMs: 100,
    preprocessingMs: 300,
    modelLoadingMs: 200,
    inferenceMs: 500,
    averageBatchMs: 500,
    batchCount: 1,
  };
}

test("Phase 4 adapter maps local typed arrays into the existing WebGIS point contract", () => {
  const dataset = adaptLocalPredictionToMapData(fixture(), "research.csv");
  assert.equal(dataset.title, "research · 浏览器本地 PASC-TCN");
  assert.equal(dataset.points.length, 2);
  assert.equal(dataset.points[0].mode, "线性型");
  assert.equal(dataset.points[0].modeCanonical, "Linear");
  assert.equal(dataset.points[0].pasc?.probabilities.Linear, fixture().probabilities[1]);
  assert.equal(dataset.points[0].pasc?.spatialApplicability, "full_reference");
  assert.equal(dataset.points[1].pasc?.spatialApplicability, "limited_reference");
  assert.equal(dataset.points[1].pasc?.lowConfidence, true);
  assert.equal(dataset.points[1].coherence, 0, "default model coherence must not look like a measured map value");
  assert.deepEqual(dataset.points[0].series, [0, -1, -2]);
  assert.deepEqual(dataset.points[0].dates, fixture().dates);
});

test("large-file adapter preserves the full analyzed count while exposing a bounded map sample", () => {
  const result = fixture();
  result.totalPredictedPoints = 125_000;
  result.mapSampled = true;
  result.largeFileMode = true;
  result.spatialReferenceSource = Uint8Array.from([1, 2]);
  result.spatialReliability = Float32Array.from([0.7, 0.4]);
  const dataset = adaptLocalPredictionToMapData(result, "large.csv");
  assert.equal(dataset.totalPredictedPoints, 125_000);
  assert.equal(dataset.mapSampled, true);
  assert.equal(dataset.points.length, 2);
  assert.match(dataset.points[1].warnings.join(" "), /当前处理批次内无标签邻点/);
});

test("Phase 4 local export is a browser-ready CSV with the required result fields", () => {
  const csv = localPredictionCsv(fixture());
  assert.ok(csv.startsWith("\uFEFFpoint_id,lon,lat,velocity_mm_per_year,mode,mode_name,confidence"));
  assert.match(csv, /P-1,110\.099/);
  assert.match(csv, /线性型,Linear/);
  assert.match(csv, /frozen_training_reference/);
});

test("Phase 4 Local UI has no task Blob or server inference call path", async () => {
  const component = await readFile("app/components/PascLocalWebGis.tsx", "utf8");
  assert.match(component, /new Worker\(PASC_LOCAL_WORKER_URL/);
  assert.match(component, /localPredictionCsv/);
  assert.match(component, /登录只解锁功能/);
  assert.doesNotMatch(component, /fetch\s*\(/);
  assert.doesNotMatch(component, /\/api\/pasc|\/v1\/jobs|meta\.json/i);
});

test("Phase 4 adapter rejects partial payloads before mutating map state", () => {
  const result = fixture();
  result.confidence = Float32Array.from([0.8]);
  assert.throws(() => adaptLocalPredictionToMapData(result, "broken.csv"), /长度不一致/);
});
