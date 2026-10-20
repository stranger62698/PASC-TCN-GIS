import assert from "node:assert/strict";
import test from "node:test";
import { exportOriginalWithPascFields } from "../app/lib/pasc-local-export";
import type { PascLocalCompletePayload } from "../app/lib/pasc-local-worker-protocol";

const dates = Array.from({ length: 20 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index * 12)).toISOString().slice(0, 10));
const values = dates.map((_, index) => -index);
const csv = (rows: unknown[][], id = true) => new File([[...(id ? ["id"] : []), "lon", "lat", "note", ...dates].join(",") + "\n" + rows.map(row => row.join(",")).join("\n")], "source.csv");
function result(ids: string[], rowNumbers: number[], eligible: number[]): PascLocalCompletePayload {
  const count = ids.length;
  return {
    pointIds: ids, sourceRowNumbers: Uint32Array.from(rowNumbers), classificationEligible: Uint8Array.from(eligible),
    effectiveEpochs: Uint32Array.from(eligible, value => value ? 20 : 2),
    rawModeIndex: new Uint8Array(count).fill(1), modeIndex: new Uint8Array(count).fill(1),
    confidence: Float32Array.from(eligible, value => value ? 0.8 : NaN), probabilities: new Float32Array(count * 6),
    classCounts: new Uint32Array(6), longitude: new Float32Array(count).fill(110), latitude: new Float32Array(count).fill(20),
    velocity: new Float32Array(count), velocityProvided: new Uint8Array(count), coherence: new Float32Array(count),
    coherenceProvided: new Uint8Array(count), missingRate: new Float32Array(count), displacementSeries: new Int16Array(count * 20),
    displacementScale: 0.1, displacementEncoding: "int16_tenth_mm", spatialReliability: new Float32Array(count),
    spatialGateMean: new Float32Array(count), spatialReferenceSource: new Uint8Array(count), dates,
    observedDates: dates, sourceEpochs: 20, insertedEpochs: 0, timeSteps: 20, totalRows: Math.max(...rowNumbers) - 1,
    invalidRows: Math.max(...rowNumbers) - 1 - count, totalPredictedPoints: eligible.reduce((sum, value) => sum + value, 0), mapSampled: false,
    elapsedMs: 1, provider: "wasm", batchSize: 256, fileSizeBytes: 100, csvParsingMs: 1, preprocessingMs: 1,
    modelLoadingMs: 1, inferenceMs: 1, averageBatchMs: 1, batchCount: 1,
  };
}
async function capture(action: () => Promise<unknown>, stored?: File) {
  let output = "", closed = false, aborted = false;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { showSaveFilePicker: async () => ({
    createWritable: async () => ({ write: async (chunk: string) => { output += chunk; }, close: async () => { closed = true; }, abort: async () => { aborted = true; } }),
  }) } });
  if (stored) Object.defineProperty(globalThis, "navigator", { configurable: true, value: { storage: {
    getDirectory: async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async () => ({ getFile: async () => stored }) }) }),
  } } });
  try { return { returned: await action(), output, closed, aborted }; }
  finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else Reflect.deleteProperty(globalThis, "window");
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator); else Reflect.deleteProperty(globalThis, "navigator");
  }
}
const classificationColumns = ["pasc_mode", "pasc_mode_name", "pasc_confidence", "pasc_spatial_reliability", "pasc_spatial_gate_mean", "pasc_spatial_reference"];
function exportedRows(output: string) {
  const rows = output.trim().replace(/^\uFEFF/, "").split("\r\n").map(row => row.split(","));
  const headers = rows.shift()!;
  return rows.map(row => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}
function assertBlankClassification(row: Record<string, string>) {
  for (const field of classificationColumns) assert.equal(row[field], "", field);
}
const exportIt = (source: File, prediction: PascLocalCompletePayload) => exportOriginalWithPascFields({ source, result: prediction, suggestedName: "result.csv" });

test("source-row identity preserves invalid coordinates and unsupported points without shifting automatic IDs", async () => {
  const source = csv([
    ["", 20, "invalid", ...values],
    [110, 20, "classified", ...values],
    [110, 20, "short", ...dates.map((_, index) => index < 2 ? -index : "")],
  ], false);
  const prediction = result(["2", "3"], [3, 4], [1, 0]);
  const exported = await capture(() => exportIt(source, prediction));
  const rows = exported.output.trim().split("\r\n");
  assert.equal(rows.length, 4);
  const fields = exportedRows(exported.output);
  assertBlankClassification(fields[0]);
  assert.equal(fields[0].pasc_status, "invalid_coordinate");
  assert.equal(fields[0].pasc_status_reason, "coordinates_missing_or_non_numeric");
  assert.equal(fields[0].pasc_effective_observations, "20");
  assert.match(rows[2], /classified.*线性型,Linear/);
  assertBlankClassification(fields[2]);
  assert.equal(fields[1].pasc_status, "classified");
  assert.equal(fields[1].pasc_status_reason, "");
  assert.equal(fields[1].pasc_effective_observations, "20");
  assert.equal(fields[2].pasc_status, "insufficient_observations");
  assert.equal(fields[2].pasc_status_reason, "effective_observations_below_20");
  assert.equal(fields[2].pasc_effective_observations, "2");
  assert.deepEqual(exported.returned, { sourceRows: 3, mappedRows: 2, classifiedRows: 1, unsupportedRows: 1, unprocessedRows: 0, invalidCoordinates: 1 });
  assert.equal(exported.closed, true);
});

test("quick-result export leaves every unprocessed source row empty and validates classified count separately", async () => {
  const source = csv([["A", 110, 20, "processed", ...values], ["B", 110, 20, "later", ...values], ["C", "", 20, "invalid", ...values]]);
  const prediction = result(["A"], [2], [1]);
  prediction.analysisScope = "quick"; prediction.sourceTruncated = true;
  const exported = await capture(() => exportIt(source, prediction));
  const rows = exported.output.trim().split("\r\n");
  assert.match(rows[1], /线性型,Linear/);
  const fields = exportedRows(exported.output);
  assertBlankClassification(fields[1]);
  assertBlankClassification(fields[2]);
  assert.equal(fields[1].pasc_status, "not_processed");
  assert.equal(fields[1].pasc_status_reason, "outside_quick_analysis_scope");
  assert.equal(fields[1].pasc_effective_observations, "20");
  assert.equal(fields[2].pasc_status, "invalid_coordinate");
  assert.equal(fields[2].pasc_status_reason, "coordinates_missing_or_non_numeric");
  assert.deepEqual(exported.returned, { sourceRows: 3, mappedRows: 1, classifiedRows: 1, unsupportedRows: 0, unprocessedRows: 1, invalidCoordinates: 1 });
});

test("reordered source rows and duplicate IDs reject export rather than labeling a different point", async () => {
  const prediction = result(["A", "B"], [2, 3], [1, 1]);
  await capture(async () => { await assert.rejects(exportIt(csv([["B", 110, 20, "", ...values], ["A", 110, 20, "", ...values]]), prediction), /顺序不一致/); });
  await capture(async () => { await assert.rejects(exportIt(csv([["A", 110, 20, "", ...values], ["A", 110, 20, "", ...values]]), prediction), /重复点编号/); });
});

test("OPFS exports consume unsupported records without assigning them any classification fields", async () => {
  const source = csv([["A", 110, 20, "", ...values], ["B", 110, 20, "", ...dates.map((_, index) => index < 2 ? -index : "")]]);
  const prediction = result(["A", "B"], [2, 3], [1, 0]);
  prediction.resultStorage = { kind: "opfs", directory: "test", fileName: "complete.csv", byteLength: 1 };
  const stored = new File([
    "point_id,lon,lat,mode,mode_name,confidence,spatial_reliability,spatial_gate_mean,spatial_reference,classification_status,source_row\n" +
    "A,110,20,线性型,Linear,0.8,0,0,none,classified,2\n" +
    "B,110,20,未分类,,,,,none,insufficient_epochs,3\n",
  ], "complete.csv");
  const exported = await capture(() => exportIt(source, prediction), stored);
  const rows = exported.output.trim().split("\r\n");
  assert.match(rows[1], /线性型,Linear/);
  const fields = exportedRows(exported.output);
  assertBlankClassification(fields[1]);
  assert.equal(fields[1].pasc_status, "insufficient_observations");
  assert.equal(fields[1].pasc_status_reason, "effective_observations_below_20");
  assert.equal(fields[1].pasc_effective_observations, "2");
  assert.equal((exported.returned as { mappedRows: number }).mappedRows, 2);
  assert.equal((exported.returned as { classifiedRows: number }).classifiedRows, 1);
});

test("extra OPFS records and inconsistent source-row provenance fail completeness validation", async () => {
  const prediction = result(["A"], [2], [1]);
  prediction.resultStorage = { kind: "opfs", directory: "test", fileName: "complete.csv", byteLength: 1 };
  const source = csv([["A", 110, 20, "", ...values]]);
  const header = "point_id,mode,mode_name,confidence,spatial_reliability,spatial_gate_mean,spatial_reference,classification_status,source_row\n";
  await capture(async () => { await assert.rejects(exportIt(source, prediction), /未匹配/); }, new File([header + "A,线性型,Linear,0.8,0,0,none,classified,2\nEXTRA,线性型,Linear,0.8,0,0,none,classified,3"], "stored.csv"));
  await capture(async () => { await assert.rejects(exportIt(source, prediction), /源行号不一致/); }, new File([header + "A,线性型,Linear,0.8,0,0,none,classified,99"], "stored.csv"));
});

test("existing appended columns are replaced once and the original input values remain intact", async () => {
  const prediction = result(["A"], [2], [1]);
  const first = await capture(() => exportIt(csv([["A", 110, 20, "note", ...values]]), prediction));
  const rerun = await capture(() => exportIt(new File([first.output], "already-classified.csv"), prediction));
  assert.equal(rerun.output, first.output);
  assert.equal(rerun.output.split("pasc_mode,").length, 2);
});

test("results with duplicate IDs or disagreement between map and classified counts are rejected", async () => {
  const source = csv([["A", 110, 20, "", ...values]]);
  const duplicate = result(["A", "A"], [2, 3], [1, 1]);
  await capture(async () => { await assert.rejects(exportIt(source, duplicate), /重复点编号/); });
  const wrongCount = result(["A"], [2], [1]); wrongCount.totalPredictedPoints = 0;
  await capture(async () => { await assert.rejects(exportIt(source, wrongCount), /分类点数/); });
});


test("a complete result cannot silently omit later valid source records", async () => {
  const source = csv([["A", 110, 20, "", ...values], ["B", 110, 20, "", ...values]]);
  await capture(async () => { await assert.rejects(exportIt(source, result(["A"], [2], [1])), /范围与完整分析/); });
});

test("quick rows outside the processed scope retain true counts without being mislabeled insufficient", async () => {
  const source = csv([["A", 110, 20, "processed", ...values], ["B", 110, 20, "later short", ...dates.map((_, index) => index < 2 ? -index : "")]]);
  const prediction = result(["A"], [2], [1]);
  prediction.analysisScope = "quick"; prediction.sourceTruncated = true;
  const exported = await capture(() => exportIt(source, prediction));
  const fields = exportedRows(exported.output);
  assertBlankClassification(fields[1]);
  assert.equal(fields[1].pasc_status, "not_processed");
  assert.equal(fields[1].pasc_status_reason, "outside_quick_analysis_scope");
  assert.equal(fields[1].pasc_effective_observations, "2");
});

test("invalid-coordinate reasons distinguish nonnumeric, outside bounds and null island without changing raw cells", async () => {
  const source = csv([["A", "bad", 20, "nonnumeric", ...values], ["B", 181, 20, "bounds", ...values], ["C", 0, 0, "zero pair", ...values], ["D", 110, 20, "good", ...values]]);
  const prediction = result(["D"], [5], [1]);
  const exported = await capture(() => exportIt(source, prediction));
  const fields = exportedRows(exported.output);
  assert.deepEqual(fields.map(row => row.pasc_status_reason), ["coordinates_missing_or_non_numeric", "coordinates_out_of_range", "zero_coordinate_pair", ""]);
  assert.deepEqual(fields.map(row => row.lon), ["bad", "181", "0", "110"]);
  assert.ok(fields.every(row => row.pasc_effective_observations === "20"));
  for (const row of fields.slice(0, 3)) { assertBlankClassification(row); assert.equal(row.pasc_status, "invalid_coordinate"); }
});

test("OPFS Float32 text preserves numerical confidence and rejects a mismatched stored class", async () => {
  const prediction = result(["A"], [2], [1]);
  prediction.resultStorage = { kind: "opfs", directory: "test", fileName: "complete.csv", byteLength: 1 };
  const source = csv([["A", 110, 20, "", ...values]]);
  const header = "point_id,mode,mode_name,confidence,spatial_reliability,spatial_gate_mean,spatial_reference,classification_status,source_row\n";
  const confidenceText = String(prediction.confidence[0]);
  assert.notEqual(confidenceText, prediction.confidence[0].toFixed(6));
  const stored = new File([header + "A,线性型,Linear," + confidenceText + ",0,0,none,classified,2\n"], "stored.csv");
  const exported = await capture(() => exportIt(source, prediction), stored);
  assert.equal(Number(exportedRows(exported.output)[0].pasc_confidence), prediction.confidence[0]);
  assert.equal(exportedRows(exported.output)[0].pasc_confidence, confidenceText);
  await capture(async () => { await assert.rejects(exportIt(source, prediction), /类别或置信度不一致/); },
    new File([header + "A,稳定型,Stable," + confidenceText + ",0,0,none,classified,2\n"], "stored.csv"));
});
