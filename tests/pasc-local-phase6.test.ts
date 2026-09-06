import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertLocalFileSize, friendlyLocalAnalysisError, localDatasetWarning, PASC_LOCAL_HARD_FILE_BYTES, PASC_LOCAL_LARGE_DATASET_MESSAGE, PASC_LOCAL_RECOMMENDED_POINTS, PASC_LOCAL_STREAMING_FILE_BYTES } from "../app/lib/pasc-local-limits.js";
import { parseAndPreprocessLocalCsv, streamAndPreprocessLocalCsvBatches, type PascLocalSettings } from "../app/lib/pasc-local-preprocess.js";

const settings: PascLocalSettings = { displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "subsidence_negative", preprocessingState: "already_smoothed" };
const csvFile = (text: string) => new File([text], "fixture.csv", { type: "text/csv" });
const dates = Array.from({ length: 20 }, (_, index) => `2024-${String(Math.floor(index / 2) + 1).padStart(2, "0")}-${index % 2 ? "13" : "01"}`);

test("Phase 6 parser reports malformed CSV, missing coordinates, insufficient dates, and NaN-only rows", async () => {
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile('lon,lat,"2024-01-01\n110,20,1'), settings, () => {}, () => false), /引号未闭合/);
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile(["id", ...dates].join(",") + "\nP-1," + dates.map(() => "1").join(",")), settings, () => {}, () => false), /经度和纬度/);
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile("lon,lat,2024-01-01\n110,20,1"), settings, () => {}, () => false), /至少需要 20/);
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile(["lon", "lat", ...dates].join(",") + "\nNaN,NaN," + dates.map(() => "NaN").join(",")), settings, () => {}, () => false), /没有可用于/);
});

test("Phase 6 large-data guard warns at the measured range and gates 1 GiB streaming to capable desktop browsers", () => {
  assert.equal(localDatasetWarning(28 * 1024 * 1024, PASC_LOCAL_RECOMMENDED_POINTS), PASC_LOCAL_LARGE_DATASET_MESSAGE);
  assert.equal(localDatasetWarning(1024, 100), "");
  assert.doesNotThrow(() => assertLocalFileSize(PASC_LOCAL_HARD_FILE_BYTES));
  assert.throws(() => assertLocalFileSize(PASC_LOCAL_HARD_FILE_BYTES + 1), /1 GiB/);
  const capable = { desktopChromium: true, fileStream: true, worker: true, opfs: true };
  assert.doesNotThrow(() => assertLocalFileSize(PASC_LOCAL_STREAMING_FILE_BYTES + 1, capable));
  assert.throws(() => assertLocalFileSize(PASC_LOCAL_STREAMING_FILE_BYTES + 1, { ...capable, desktopChromium: false }), /桌面版 Chrome 或 Edge/);
  assert.throws(() => assertLocalFileSize(PASC_LOCAL_STREAMING_FILE_BYTES + 1, { ...capable, opfs: false }), /OPFS/);
});

test("Phase 7 large CSV parser keeps quoted UTF-8 rows intact across tiny chunks and flushes bounded batches", async () => {
  const header = ["id", "lon", "lat", ...dates].join(",");
  const row = (id: string, lon: number) => [id, lon, 20, ...dates.map((_, index) => index + 0.14)].map(value => typeof value === "string" && value.includes(",") ? `"${value}"` : value).join(",");
  const file = csvFile([header, row("坡体,一号", 110), row("坡体二号", 110.1), row("坡体三号", 110.2)].join("\r\n"));
  const sizes: number[] = [];
  const ids: string[] = [];
  const summary = await streamAndPreprocessLocalCsvBatches(file, settings, 2, async batch => {
    sizes.push(batch.pointIds.length);
    ids.push(...batch.pointIds);
    assert.ok(batch.series instanceof Float32Array);
    assert.ok(batch.displacementSeries instanceof Float32Array);
  }, () => {}, () => false, 17);
  assert.deepEqual(sizes, [2, 1]);
  assert.deepEqual(ids, ["坡体,一号", "坡体二号", "坡体三号"]);
  assert.equal(summary.validRows, 3);
  assert.equal(summary.invalidRows, 0);
  assert.equal(summary.sourceEpochs, 20);
  assert.ok(summary.timeSteps >= summary.sourceEpochs);
});

test("Phase 6 friendly errors cover model, WASM, memory, coordinates and time-axis failures", () => {
  assert.match(friendlyLocalAnalysisError("WebAssembly compile failed"), /WASM 初始化失败/);
  assert.match(friendlyLocalAnalysisError("ONNX model failed"), /ONNX 模型/);
  assert.match(friendlyLocalAnalysisError("out of memory"), /内存不足/);
  assert.match(friendlyLocalAnalysisError("无法自动识别经度和纬度字段"), /经度或纬度/);
  assert.match(friendlyLocalAnalysisError("至少需要 20 个日期字段"), /至少需要 20/);
});

test("Phase 6 worker records timing metrics, releases sessions, cancels, and falls back to WASM", async () => {
  const protocol = await readFile("app/lib/pasc-local-worker-protocol.ts", "utf8");
  const worker = await readFile("app/workers/pasc-local.worker.ts", "utf8");
  assert.match(protocol, /csvParsingMs: number/);
  assert.match(protocol, /averageBatchMs: number/);
  assert.match(worker, /WebGPU fallback/);
  assert.match(worker, /executionProviders: \["wasm"\]/);
  assert.match(worker, /finally \{\s*await engine\.session\.release\(\)/);
  assert.match(worker, /type: "CANCELLED"/);
  assert.match(worker, /streamAndPreprocessLocalCsvBatches/);
  assert.match(worker, /openLargeResultFile/);
  assert.match(worker, /PASC_LOCAL_MAP_SAMPLE_POINTS/);
  assert.doesNotMatch(worker, /file\.text\(\)/);
});

test("Phase 6 Local UI preserves the zero-upload boundary and exposes measured timings", async () => {
  const component = await readFile("app/components/PascLocalWebGis.tsx", "utf8");
  assert.match(component, /该数据集较大|PASC_LOCAL_RECOMMENDED_POINTS/);
  assert.match(component, /data-performance/);
  assert.match(component, /csvParsingMs/);
  assert.match(component, /支持最大 1 GiB/);
  assert.match(component, /prepareLargeLocalStorage/);
  assert.match(component, /beforeunload/);
  assert.match(component, /保存完整结果 CSV/);
  assert.doesNotMatch(component, /fetch\s*\(|\/api\/pasc|\/v1\/jobs|@vercel\/blob/i);
});
