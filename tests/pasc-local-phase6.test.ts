import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { assertLocalFileSize, friendlyLocalAnalysisError, localDatasetWarning, PASC_LOCAL_HARD_FILE_BYTES, PASC_LOCAL_LARGE_DATASET_MESSAGE, PASC_LOCAL_RECOMMENDED_POINTS, PASC_LOCAL_STREAMING_FILE_BYTES, PASC_LOCAL_SPLIT_REQUIRED_BYTES, requiresLocalCsvSplit } from "../app/lib/pasc-local-limits.js";
import { inspectLocalCsv, parseAndPreprocessLocalCsv, streamAndPreprocessLocalCsvBatches, type PascLocalPreparedData, type PascLocalSettings } from "../app/lib/pasc-local-preprocess.js";

const settings: PascLocalSettings = { displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "subsidence_negative", preprocessingState: "already_smoothed" };
const csvFile = (text: string) => new File([text], "fixture.csv", { type: "text/csv" });
const dates = Array.from({ length: 20 }, (_, index) => `2024-${String(Math.floor(index / 2) + 1).padStart(2, "0")}-${index % 2 ? "13" : "01"}`);

test("local CSV inspection reads just the header and reports date coverage and aliases", async () => {
  const file = csvFile(["\uFEFF id , lon , lat ,velocity,coherence", ...dates].join(",") + "\n" + "0".repeat(200_000));
  let bytesRead = 0;
  const originalSlice = file.slice.bind(file);
  file.slice = (start, end, type) => { bytesRead += (end ?? file.size) - (start ?? 0); return originalSlice(start, end, type); };
  file.text = async () => { throw new Error("must not read the whole file"); };
  const inspection = await inspectLocalCsv(file);
  assert.equal(inspection.fields.longitude.field, "lon");
  assert.equal(inspection.fields.point_id.field, "id");
  assert.equal(inspection.dateCount, 20);
  assert.equal(inspection.startDate, "2024-01-01");
  assert.equal(inspection.endDate, "2024-10-13");
  assert.ok(bytesRead <= 64 * 1024);
  await assert.rejects(inspectLocalCsv(csvFile("lon,lat,lon\n1,2,3")), /重复字段名/);
});

test("manual fields are honored by both whole-file and streaming preprocessing", async () => {
  const file = csvFile(["sample_code", "coord_a", "coord_b", "speed_custom", "quality_custom", ...dates].map(header => ` ${header} `).join(",") + "\n" + ["SITE-7", 110, 20, -12, 0.9, ...dates.map((_, index) => -index * 2)].join(","));
  const mapped: PascLocalSettings = { ...settings, fieldMapping: { point_id: "sample_code", longitude: "coord_a", latitude: "coord_b", velocity: "speed_custom", coherence: "quality_custom" } };
  const result = await parseAndPreprocessLocalCsv(file, mapped, () => {}, () => false);
  assert.deepEqual(result.pointIds, ["SITE-7"]);
  assert.equal(result.longitude[0], 110);
  assert.equal(result.latitude[0], 20);
  assert.equal(result.velocity[0], -12);
  await streamAndPreprocessLocalCsvBatches(file, mapped, 2, async batch => {
    assert.deepEqual(batch.pointIds, result.pointIds);
    assert.deepEqual(batch.series, result.series);
    assert.deepEqual(batch.velocity, result.velocity);
  }, () => {}, () => false, 17);
  const inferred = await parseAndPreprocessLocalCsv(file, { ...mapped, fieldMapping: { ...mapped.fieldMapping, velocity: "", coherence: "" } }, () => {}, () => false);
  assert.equal(inferred.velocityProvided[0], 0);
  assert.equal(inferred.coherenceProvided[0], 0);
  await assert.rejects(parseAndPreprocessLocalCsv(file, { ...mapped, fieldMapping: { ...mapped.fieldMapping, longitude: "missing" } }, () => {}, () => false), /所选字段不存在/);
  await assert.rejects(parseAndPreprocessLocalCsv(file, { ...mapped, fieldMapping: { ...mapped.fieldMapping, longitude: "coord_b" } }, () => {}, () => false), /不能使用同一列/);
});

const sortedObservations = Array.from({ length: 24 }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index * 12)).toISOString().slice(0, 10));
function dateHeaderVariant(date: string, index: number) {
  const [year, month, day] = date.split("-"), compact = year + month + day;
  return [
    `D${compact}`, `D_${compact}`, compact, `${year}-${Number(month)}-${Number(day)}`,
    `${year}/${Number(month)}/${Number(day)}`, `${year}_${month}_${day}`, `${year}.${month}.${day}`,
    `D${date}`, `d_${year}/${month}/${day}`, `Date ${compact}`, `Time_${year}.${month}.${day}`, `t-${date}`,
  ][index % 12];
}
type ObservationColumn = { header: string; source: number };
function observationFile(columns: ObservationColumn[], conflictColumn = -1) {
  const rows = [0, 1].map(row => [
    `point-${row}`, 110 + row * 0.001, 20,
    ...columns.map((column, index) => index === conflictColumn ? 777 : row === 1 && column.source === 4 ? "" : column.source * (row ? -3 : -2)),
  ].join(","));
  return csvFile([["id", "lon", "lat", ...columns.map(column => column.header)].join(","), ...rows].join("\r\n"));
}

test("mixed date prefixes and separators preserve sorted observations and preprocessing across tiny streaming chunks", async () => {
  const ordered = sortedObservations.map((header, source) => ({ header, source }));
  const mixed = Array.from({ length: ordered.length }, (_, index) => {
    const source = index * 7 % ordered.length;
    return { source, header: dateHeaderVariant(sortedObservations[source], source) };
  });
  const baseline = await parseAndPreprocessLocalCsv(observationFile(ordered), settings, () => {}, () => false);
  const file = observationFile(mixed);
  file.text = async () => { throw new Error("must preserve the streaming File path"); };
  const inspection = await inspectLocalCsv(file);
  assert.equal(inspection.dateCount, sortedObservations.length);
  assert.equal(inspection.startDate, sortedObservations[0]);
  assert.equal(inspection.endDate, sortedObservations.at(-1));
  const actual = await parseAndPreprocessLocalCsv(file, settings, () => {}, () => false);
  for (const key of ["dates", "observedDates", "observedSeries", "observedMask", "displacementSeries", "series", "physics", "velocity", "missingRate", "effectiveEpochs", "classificationEligible"] as const) {
    assert.deepEqual(actual[key], baseline[key], key);
  }
  const batches: PascLocalPreparedData[] = [];
  const summary = await streamAndPreprocessLocalCsvBatches(file, settings, 1, async batch => { batches.push(batch); }, () => {}, () => false, 17);
  assert.equal(batches.length, 2); assert.equal(summary.sourceEpochs, sortedObservations.length);
  assert.equal(summary.insertedEpochs, 0); assert.deepEqual(summary.observedDates, sortedObservations);
  for (const key of ["observedSeries", "displacementSeries", "series", "physics"] as const) {
    assert.deepEqual(Float32Array.from(batches.flatMap(batch => Array.from(batch[key]!))), baseline[key], key);
  }
  assert.deepEqual(Uint8Array.from(batches.flatMap(batch => Array.from(batch.observedMask!))), baseline.observedMask);
});

test("equivalent date aliases merge one observation and conflicting aliases reject in both local CSV paths", async () => {
  const ordered = sortedObservations.map((header, source) => ({ header, source }));
  const aliases = [...ordered,
    { header: `D_${sortedObservations[0].replaceAll("-", "")}`, source: 0 },
    { header: `Date_${sortedObservations[10].replaceAll("-", "/")}`, source: 10 },
  ];
  const baseline = await parseAndPreprocessLocalCsv(observationFile(ordered), settings, () => {}, () => false);
  const file = observationFile(aliases);
  assert.equal((await inspectLocalCsv(file)).dateCount, sortedObservations.length);
  const actual = await parseAndPreprocessLocalCsv(file, settings, () => {}, () => false);
  assert.equal(actual.sourceEpochs, sortedObservations.length);
  assert.deepEqual(actual.observedSeries, baseline.observedSeries);
  assert.deepEqual(actual.series, baseline.series);
  const summary = await streamAndPreprocessLocalCsvBatches(file, settings, 1, async batch => {
    assert.equal(batch.sourceEpochs, sortedObservations.length);
  }, () => {}, () => false, 17);
  assert.equal(summary.sourceEpochs, sortedObservations.length);
  const conflict = observationFile(aliases, aliases.length - 1);
  await assert.rejects(parseAndPreprocessLocalCsv(conflict, settings, () => {}, () => false), /第 2 行.*同日重复字段冲突/);
  await assert.rejects(streamAndPreprocessLocalCsvBatches(conflict, settings, 1, async () => {}, () => {}, () => false, 17), /第 2 行.*同日重复字段冲突/);
});

test("invalid calendar dates and descriptive date fragments never count as local observation epochs", async () => {
  const valid = sortedObservations.slice(0, 19).map((date, source) => ({ header: dateHeaderVariant(date, source), source }));
  const invalid = ["D20230229", "D_20241301", "20240431", "Date 2024/2/30", "2024-00-01", "Time20240132", "project_D20240101_note", "2024010", "date2024/1", "D20240101_mean"];
  const file = observationFile([...valid, ...invalid.map(header => ({ header, source: 999 }))]);
  assert.equal((await inspectLocalCsv(file)).dateCount, 19);
  await assert.rejects(parseAndPreprocessLocalCsv(file, settings, () => {}, () => false), /至少需要 20 个可解析日期字段/);
  await assert.rejects(streamAndPreprocessLocalCsvBatches(file, settings, 1, async () => {}, () => {}, () => false, 17), /至少需要 20 个可解析日期字段/);
});

test("Phase 6 parser reports malformed CSV, missing coordinates, insufficient dates, and NaN-only rows", async () => {
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile('lon,lat,"2024-01-01\n110,20,1'), settings, () => {}, () => false), /引号未闭合/);
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile(["id", ...dates].join(",") + "\nP-1," + dates.map(() => "1").join(",")), settings, () => {}, () => false), /经度和纬度/);
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile("lon,lat,2024-01-01\n110,20,1"), settings, () => {}, () => false), /至少需要 20/);
  await assert.rejects(parseAndPreprocessLocalCsv(csvFile(["lon", "lat", ...dates].join(",") + "\nNaN,NaN," + dates.map(() => "NaN").join(",")), settings, () => {}, () => false), /没有可用于/);
});

test("large-file selection accepts more than 1 GiB with a local partition boundary and browser capability checks", () => {
  assert.equal(localDatasetWarning(28 * 1024 * 1024, PASC_LOCAL_RECOMMENDED_POINTS), PASC_LOCAL_LARGE_DATASET_MESSAGE);
  assert.equal(localDatasetWarning(1024, 100), "");
  assert.doesNotThrow(() => assertLocalFileSize(PASC_LOCAL_HARD_FILE_BYTES));
  assert.throws(() => assertLocalFileSize(PASC_LOCAL_HARD_FILE_BYTES + 1), /安全读取/);
  const capable = { desktopChromium: true, fileStream: true, worker: true, opfs: true };
  assert.doesNotThrow(() => assertLocalFileSize(PASC_LOCAL_STREAMING_FILE_BYTES + 1, capable));
  assert.doesNotThrow(() => assertLocalFileSize(4 * PASC_LOCAL_SPLIT_REQUIRED_BYTES, capable));
  assert.equal(requiresLocalCsvSplit(PASC_LOCAL_SPLIT_REQUIRED_BYTES), false);
  assert.equal(requiresLocalCsvSplit(PASC_LOCAL_SPLIT_REQUIRED_BYTES + 1), true);
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
  assert.match(friendlyLocalAnalysisError("ONNX model failed"), /本地分析组件加载失败.*检查网络.*重试/);
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
  assert.doesNotMatch(worker, /PASC_LOCAL_MAP_SAMPLE_POINTS|reservoirSlot/);
  assert.match(worker, /chunks\.push\(lightweightResult/);
  assert.match(worker, /encodeLocalSeriesRows/);
  assert.match(worker, /seriesStorage:/);
  assert.match(worker, /streamingProgress = value/);
  assert.match(worker, /累计已分类/);
  assert.match(worker, /mapSampled: false/);
  assert.doesNotMatch(worker, /file\.text\(\)/);
});

test("Phase 6 Local UI preserves the zero-upload boundary and exposes measured timings", async () => {
  const component = await readFile("app/components/PascLocalWebGis.tsx", "utf8");
  assert.match(component, /该数据集较大|PASC_LOCAL_RECOMMENDED_POINTS/);
  assert.match(component, /data-performance/);
  assert.match(component, /csvParsingMs/);
  assert.match(component, /超过 1 GiB 可先在本机分片/);
  assert.match(component, /splitLocalCsv/);
  assert.match(component, /保存此分片到本机磁盘/);
  assert.match(component, /跨片空间邻域不合并/);
  assert.match(component, /prepareLargeLocalStorage/);
  assert.match(component, /beforeunload/);
  assert.match(component, /保存完整结果 CSV/);
  assert.doesNotMatch(component, /fetch\s*\(|\/api\/pasc|\/v1\/jobs|@vercel\/blob/i);
});
