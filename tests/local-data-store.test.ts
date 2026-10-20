import assert from "node:assert/strict";
import test from "node:test";
import { numericSeriesView, localSeriesRecordBytes, encodeLocalSeriesRows, createLocalSeriesStore } from "../app/lib/local-series-store";
import { parseAndPreprocessLocalCsv, streamAndPreprocessLocalCsvBatches, type PascLocalSettings } from "../app/lib/pasc-local-preprocess";
import { adaptLocalPredictionToMapData, localPredictionCsv } from "../app/lib/pasc-local-map-adapter";
import { slopePerYear } from "../app/lib/insar-v2";
import { isPriorityQualityReliable } from "../app/lib/priority-deformation";
import type { PascLocalCompletePayload } from "../app/lib/pasc-local-worker-protocol";

const settings: PascLocalSettings = { displacementUnit: "cm", velocityUnit: "cm/year", signConvention: "subsidence_positive", preprocessingState: "already_smoothed" };
const dates = Array.from({ length: 20 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index * 12)).toISOString().slice(0, 10));
const makeCsv = (rows: unknown[][]) => new File([["id", "lon", "lat", "velocity", "coherence", ...dates].join(",") + "\n" + rows.map(row => row.join(",")).join("\n")], "own-file.csv");
function fixture(count = 2): PascLocalCompletePayload {
  return {
    pointIds: Array.from({ length: count }, (_, index) => "p-" + index),
    rawModeIndex: new Uint8Array(count).fill(1), modeIndex: new Uint8Array(count).fill(1),
    confidence: new Float32Array(count).fill(0.8), probabilities: new Float32Array(count * 6).fill(1 / 6),
    classCounts: Uint32Array.from([0, count, 0, 0, 0, 0]),
    longitude: new Float32Array(count).fill(110), latitude: new Float32Array(count).fill(20),
    velocity: new Float32Array(count).fill(-20), velocityProvided: new Uint8Array(count).fill(1),
    coherence: new Float32Array(count).fill(0.9), coherenceProvided: new Uint8Array(count).fill(1),
    missingRate: new Float32Array(count), displacementSeries: Int32Array.from({ length: count * 3 }, (_, index) => -(index % 3) * 10),
    displacementScale: 0.1, displacementEncoding: "int32_tenth_mm",
    spatialReliability: new Float32Array(count), spatialGateMean: new Float32Array(count), spatialReferenceSource: new Uint8Array(count),
    dates: ["2024-01-01", "2024-01-13", "2024-01-25"], observedDates: ["2024-01-01", "2024-01-25"],
    observedSeries: Float32Array.from({ length: count * 2 }, (_, index) => index % 2 ? NaN : -40),
    observedMask: Uint8Array.from({ length: count * 2 }, (_, index) => index % 2 ? 0 : 1),
    observedDisplacement: new Float32Array(count).fill(NaN), processedDisplacement: new Float32Array(count).fill(-2),
    effectiveEpochs: new Uint32Array(count).fill(20), classificationEligible: new Uint8Array(count).fill(1),
    sourceEpochs: 2, insertedEpochs: 1, timeSteps: 3, totalRows: count, invalidRows: 0,
    elapsedMs: 1, provider: "wasm", batchSize: 256, fileSizeBytes: 100,
    csvParsingMs: 1, preprocessingMs: 1, modelLoadingMs: 1, inferenceMs: 1, averageBatchMs: 1, batchCount: 1,
  };
}

test("compact 128-epoch views support indexed reads, map, reduce, at, iteration, and JSON", () => {
  const view = numericSeriesView(128, index => index / 10);
  assert.equal(view.length, 128);
  assert.equal(view[10], 1);
  assert.equal(view[127], 12.7);
  assert.equal(view.at(-1), 12.7);
  assert.equal(view.map(value => value * 10)[127], 127);
  assert.equal(view.reduce((sum, value) => sum + value, 0), Array.from(view).reduce((sum, value) => sum + value, 0));
  assert.equal(JSON.parse(JSON.stringify(view))[100], 10);
  assert.equal(Object.hasOwn(view, "100"), false, "numeric backing values must not be allocated");
  assert.throws(() => { view[0] = 10; }, /只读/);
});

test("source observations keep normalized units and missing endpoints; unsupported valid rows remain", async () => {
  const full = ["full", 110, 20, 2, 0.9, ...dates.map((_, index) => index + 1)];
  const unsupported = ["short", 110.1, 20.1, "", 0.9, ...dates.map((_, index) => index < 3 ? index + 1 : "")];
  const invalid = ["bad", "NaN", 20, 1, 0.9, ...dates.map(() => 1)];
  const result = await parseAndPreprocessLocalCsv(makeCsv([full, unsupported, invalid]), settings, () => {}, () => false);
  assert.deepEqual(result.pointIds, ["full", "short"]);
  assert.deepEqual(Array.from(result.effectiveEpochs!), [20, 3]);
  assert.deepEqual(Array.from(result.classificationEligible!), [1, 0]);
  assert.equal(result.observedSeries![19], -200);
  assert.equal(result.velocity[0], -20);
  assert.ok(Number.isNaN(result.observedSeries![39]));
  assert.equal(result.observedMask![39], 0);
  assert.equal(result.displacementSeries.at(-1), -30, "model/display interpolation must remain separate from missing observations");
  assert.deepEqual(result.invalidReasons, { invalidCoordinate: 1, insufficientEpochs: 1, duplicateIds: 0 });
  assert.equal(result.invalidRows, 1);
  const batches: number[] = [];
  await streamAndPreprocessLocalCsvBatches(makeCsv([full, unsupported, invalid]), settings, 1, async batch => {
    batches.push(batch.classificationEligible![0]); assert.equal(batch.observedDates?.length, 20);
  }, () => {}, () => false, 17);
  assert.deepEqual(batches, [1, 0]);
});

test("duplicate point IDs fail with their source row rather than silently collapsing points", async () => {
  const row = ["same", 110, 20, 1, 0.9, ...dates.map(() => 1)];
  await assert.rejects(parseAndPreprocessLocalCsv(makeCsv([row, row]), settings, () => {}, () => false), /第 3 行.*重复点编号.*same/);
});

test("fixed-size OPFS rows round-trip source masks and date columns without interpolation", async () => {
  const result = fixture();
  const bytes = encodeLocalSeriesRows(Float32Array.from([0, -1, -2, 0, 1, 2]), result.observedSeries!, result.observedMask!, 2, 3, 2);
  assert.equal(bytes.byteLength, 2 * localSeriesRecordBytes(3, 2));
  result.seriesStorage = { kind: "opfs", directory: "test", fileName: "test.series", pointCount: 2, timeSteps: 3, observedEpochs: 2, recordBytes: localSeriesRecordBytes(3, 2) };
  result.displacementSeries = new Int32Array(0);
  delete result.observedSeries; delete result.observedMask;
  const store = createLocalSeriesStore(result, async () => new Blob([bytes as Uint8Array<ArrayBuffer>]));
  assert.equal(store.storage?.pointCount, 2);
  assert.ok(Number.isNaN(store.view(0)[1]), "unloaded cells must never invent observations");
  const row = await store.readRow(0);
  assert.deepEqual(row.processed, [0, -1, -2]);
  assert.deepEqual(row.mask, Uint8Array.from([1, 0]));
  assert.equal(row.observed[0], -40);
  assert.ok(Number.isNaN(row.observed[1]));
  assert.deepEqual(Array.from(await store.readColumn(0, "observed")), [-40, -40]);
  assert.ok(Array.from(await store.readColumn(1, "observed")).every(Number.isNaN));
  assert.deepEqual(Array.from(await store.readColumn(1, "processed")), [-1, 1]);
});

test("evaluation date changes update all scalars and a late old-date request cannot overwrite them", async () => {
  const dataset = adaptLocalPredictionToMapData(fixture(), "own.csv");
  let finishOld!: (values: Float32Array) => void;
  dataset.seriesStore.readColumn = async index => index === 0
    ? new Promise<Float32Array>(resolve => { finishOld = resolve; })
    : Float32Array.from([-99, NaN]);
  const old = dataset.loadEvaluationDate("2024-01-01");
  await dataset.loadEvaluationDate("2024-01-25");
  finishOld(Float32Array.from([-1, -2]));
  await old;
  assert.equal(dataset.points[0].observedDisplacement, -99);
  assert.equal(dataset.points[0].observedEvaluationDate, "2024-01-25");
  assert.ok(Number.isNaN(dataset.points[1].observedDisplacement!));
  await assert.rejects(dataset.loadEvaluationDate("2024-01-13"), /真实观测日期/);
});

test("all map records beyond the former 25,000 sample remain accessible with unloaded OPFS details", () => {
  const result = fixture(25_003);
  result.seriesStorage = { kind: "opfs", directory: "test", fileName: "all.series", pointCount: result.pointIds.length, timeSteps: 3, observedEpochs: 2, recordBytes: localSeriesRecordBytes(3, 2) };
  result.displacementSeries = new Int32Array(0); delete result.observedSeries; delete result.observedMask;
  result.mapSampled = false; result.totalPredictedPoints = result.pointIds.length;
  const dataset = adaptLocalPredictionToMapData(result, "all.csv");
  assert.equal(dataset.points.length, 25_003);
  assert.equal(dataset.points.at(-1)?.id, "p-25002");
  assert.equal(dataset.points.at(-1)?.series.length, 3);
  assert.equal(dataset.points.at(-1)?.pasc?.quality.seriesMean, null, "unloaded data must not produce fake statistics");
  assert.equal(dataset.mapSampled, false);
});

test("full-range stage OLS uses all intermediate values in memory and multi-block OPFS", async () => {
  const count = 9_000, length = 128, result = fixture(count);
  result.timeSteps = length;
  result.dates = Array.from({ length }, (_, index) => new Date(Date.UTC(2020, 0, 1 + index * 12)).toISOString().slice(0, 10));
  const processed = Float32Array.from({ length: count * length }, (_, index) => {
    const row = Math.floor(index / length), step = index % length;
    return row === 1 && step === 110 ? NaN : (step * step % 157) / 10 + row % 13;
  });
  result.displacementSeries = Int32Array.from(processed, value => Number.isFinite(value) ? Math.round(value * 10) : -2_147_483_648);
  const memory = createLocalSeriesStore(result);
  const expected = slopePerYear(Array.from(result.displacementSeries.slice(100, 121), value => value / 10), result.dates.slice(100, 121));
  const memorySlopes = await memory.readStageVelocity(100, 120, result.dates);
  assert.equal(memorySlopes[0], expected);
  assert.ok(Number.isNaN(memorySlopes[1]));
  assert.notEqual(expected, (processed[120] - processed[100]) / (20 * 12 / 365.25), "endpoints cannot replace full OLS");
  const encoded = encodeLocalSeriesRows(processed, result.observedSeries!, result.observedMask!, count, length, 2);
  assert.ok(encoded.byteLength > 4 * 1024 * 1024);
  result.seriesStorage = { kind: "opfs", directory: "test", fileName: "stage.series", pointCount: count, timeSteps: length, observedEpochs: 2, recordBytes: localSeriesRecordBytes(length, 2) };
  result.displacementSeries = new Int32Array(0); delete result.observedSeries; delete result.observedMask;
  const store = createLocalSeriesStore(result, async () => new Blob([encoded as Uint8Array<ArrayBuffer>]));
  assert.ok(Number.isNaN(store.maskView(0)[0]), "unloaded source mask must remain unknown");
  const opfsSlopes = await store.readStageVelocity(120, 100, result.dates);
  for (const row of [0, 1, 8_500, count - 1]) assert.equal(opfsSlopes[row], memorySlopes[row]);
  assert.ok(Number.isNaN(store.view(0)[100]), "OLS must not cache every intermediate column");
  const dataset = adaptLocalPredictionToMapData(result, "stage.csv");
  dataset.seriesStore.readStageVelocity = store.readStageVelocity;
  await dataset.loadStageVelocity(120, 100);
  assert.equal(dataset.points[0].renderStageVelocity, expected);
  assert.equal(dataset.points[0].renderStageStart, 100); assert.equal(dataset.points[0].renderStageEnd, 120);
  await assert.rejects(store.readStageVelocity(100, 120, result.dates, () => true), { name: "AbortError" });
});

test("stage requests cannot overwrite newer ranges and hydrated OPFS details have an explicit flag", async () => {
  const result = fixture(65);
  const bytes = encodeLocalSeriesRows(Float32Array.from(result.displacementSeries, value => value / 10), result.observedSeries!, result.observedMask!, 65, 3, 2);
  result.seriesStorage = { kind: "opfs", directory: "test", fileName: "hydrate.series", pointCount: 65, timeSteps: 3, observedEpochs: 2, recordBytes: localSeriesRecordBytes(3, 2) };
  result.displacementSeries = new Int32Array(0); delete result.observedSeries; delete result.observedMask;
  const dataset = adaptLocalPredictionToMapData(result, "hydrate.csv");
  const store = createLocalSeriesStore(result, async () => new Blob([bytes as Uint8Array<ArrayBuffer>]));
  dataset.seriesStore.readRow = store.readRow;
  assert.equal(dataset.points[0].localSeriesHydrated, false);
  await dataset.hydratePoints(["p-0"]);
  assert.equal(dataset.points[0].localSeriesHydrated, true);
  const stableCopy = { ...dataset.points[0] };
  await dataset.hydratePoints(result.pointIds.slice(1));
  assert.equal(dataset.points[0].localSeriesHydrated, false);
  assert.equal(stableCopy.localSeriesHydrated, true);
  assert.deepEqual(stableCopy.series, [0, -1, -2]);
  let finishOld!: (values: Float64Array) => void;
  dataset.seriesStore.readStageVelocity = async start => start === 0 ? new Promise(resolve => { finishOld = resolve; }) : new Float64Array(65).fill(22);
  const old = dataset.loadStageVelocity(0, 1);
  await dataset.loadStageVelocity(1, 2);
  finishOld(new Float64Array(65).fill(11));
  await old;
  assert.equal(dataset.points[0].renderStageVelocity, 22);
  assert.equal(dataset.points[0].renderStageStart, 1);
  assert.equal(dataset.points[0].renderStageEnd, 2);
});

test("OPFS file length mismatches fail before silently reading shifted records", async () => {
  const result = fixture();
  result.seriesStorage = { kind: "opfs", directory: "test", fileName: "bad.series", pointCount: 2, timeSteps: 3, observedEpochs: 2, recordBytes: localSeriesRecordBytes(3, 2) };
  const store = createLocalSeriesStore(result, async () => new Blob([new Uint8Array(100)]));
  await assert.rejects(store.readRow(0), /文件损坏/);
});

function deferredOpfsStore() {
  const result = fixture();
  result.seriesStorage = { kind: "opfs", directory: "test", fileName: "deferred.series", pointCount: 2, timeSteps: 3, observedEpochs: 2, recordBytes: localSeriesRecordBytes(3, 2) };
  result.displacementSeries = new Int32Array(0);
  delete result.observedSeries; delete result.observedMask;
  const loads: Array<ReturnType<typeof Promise.withResolvers<Blob>>> = [];
  const store = createLocalSeriesStore(result, () => {
    const pending = Promise.withResolvers<Blob>(); loads.push(pending); return pending.promise;
  });
  const file = (step: number) => new Blob([encodeLocalSeriesRows(Float32Array.from([0, step, step * 2, 0, step, step * 2]), Float32Array.from([0, step, 0, step]), new Uint8Array(4).fill(1), 2, 3, 2) as Uint8Array<ArrayBuffer>]);
  return { result, store, loads, file };
}

test("clearing OPFS rows cancels old reads and preserves the replacement same-row request", async () => {
  const { store, loads, file } = deferredOpfsStore();
  const old = store.readRow(0), cancelled = assert.rejects(old, { name: "AbortError" });
  store.clear();
  const fresh = store.readRow(0);
  assert.equal(loads.length, 2, "a cleared pending row must not be reused");
  loads[0].resolve(file(1));
  await cancelled;
  assert.equal(store.hasRow(0), false, "old I/O must not repopulate a cleared cache");
  const duplicate = store.readRow(0);
  loads[1].resolve(file(7));
  const current = await fresh;
  assert.equal(await duplicate, current, "an old request's finally block must not remove the new pending row");
  assert.deepEqual(current.processed, [0, 7, 14]);
  assert.equal(await store.readRow(0), current);
});

test("clearing OPFS columns and stage calculations cancels their pending file reads", async () => {
  for (const kind of ["column", "stage"] as const) {
    const { result, store, loads, file } = deferredOpfsStore();
    const pending = kind === "column" ? store.readColumn(1, "processed") : store.readStageVelocity(0, 2, result.dates);
    const cancelled = assert.rejects(pending, { name: "AbortError" });
    store.clear(); loads[0].resolve(file(1));
    await cancelled;
    assert.ok(Number.isNaN(store.view(0)[1]), "cleared columns must remain unloaded");
    const fresh = store.readColumn(1, "processed");
    assert.equal(loads.length, 2);
    loads[1].resolve(file(7));
    assert.deepEqual(Array.from(await fresh), [7, 7]);
  }
});

test("failure from a cleared OPFS file load cannot invalidate the new file cache", async () => {
  const { store, loads, file } = deferredOpfsStore();
  const old = store.readRow(0), rejected = assert.rejects(old, /old file failure/);
  store.clear();
  const fresh = store.readRow(1);
  loads[1].resolve(file(7)); await fresh;
  loads[0].reject(new Error("old file failure")); await rejected;
  const next = store.readRow(0);
  assert.equal(loads.length, 2, "the current successful file must remain cached");
  assert.deepEqual((await next).processed, [0, 7, 14]);
});

test("display scalars survive column eviction and a late prior display date cannot overwrite them", async () => {
  const dataset = adaptLocalPredictionToMapData(fixture(), "display.csv");
  let finishOld!: (values: Float32Array) => void;
  dataset.seriesStore.readColumn = async index => index === 0 ? new Promise(resolve => { finishOld = resolve; }) : Float32Array.from([-12.3, -45.6]);
  const old = dataset.loadDisplayTime(0);
  await dataset.loadDisplayTime(2);
  finishOld(Float32Array.from([10, 20]));
  await old;
  assert.equal(dataset.points[0].renderTimeIndex, 2);
  assert.equal(dataset.points[0].renderDisplacement, Math.fround(-12.3));
});

test("compact result CSV keeps unsupported points without inventing a six-class label", () => {
  const result = fixture();
  result.classificationEligible![0] = 0; result.effectiveEpochs![0] = 3; result.confidence[0] = NaN;
  const rows = localPredictionCsv(result).split(/\r?\n/).filter(Boolean).map(line => line.split(","));
  assert.equal(rows[1][4], "未分类");
  assert.equal(rows[1][5], "");
  assert.equal(rows[1][6], "");
  assert.equal(rows[1][12], "3");
  assert.equal(rows[2][5], "Linear");
});

test("exactly 20 percent source missing observations remains within the quality threshold", () => {
  const result = fixture(1);
  result.observedDates = dates.concat(dates.map(date => date.replace("2024", "2025")));
  result.sourceEpochs = 40; result.effectiveEpochs![0] = 32; result.missingRate[0] = 0.2;
  result.observedSeries = Float32Array.from({ length: 40 }, (_, index) => index < 32 ? -index : NaN);
  result.observedMask = Uint8Array.from({ length: 40 }, (_, index) => index < 32 ? 1 : 0);
  assert.ok(result.missingRate[0] > 0.2, "compact Float32 metadata has rounding error at the threshold");
  const point = adaptLocalPredictionToMapData(result, "boundary.csv").points[0];
  assert.equal(point.missingRate, 1 - 32 / 40);
  assert.ok(isPriorityQualityReliable(point, 0.75, 0.2));
  assert.equal(point.pasc?.quality.missingRate, point.missingRate);
});
