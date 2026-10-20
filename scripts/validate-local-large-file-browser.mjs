import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, resolve, sep } from "node:path";
import { build } from "vite";

// Real disk-backed CSV and browser File; no altered File.size or fabricated COMPLETE.
const validationMode = process.env.LOCAL_CSV_VALIDATION_MODE || "large";
assert.ok(validationMode === "large" || validationMode === "small_export", "Unknown CSV validation mode.");
const pointCount = validationMode === "large" ? 26_000 : 8;
const epochCount = 40;
const paddingBytes = validationMode === "large" ? 12 * 1024 : 64;
const timeoutMs = Number(process.env.LOCAL_LARGE_TIMEOUT_MS || 1_800_000);
const artifactDir = resolve(process.env.LOCAL_LARGE_ARTIFACT_DIR || "artifacts/local-large-file-browser");
const fixturePath = resolve(artifactDir, "synthetic-" + pointCount + "-40epochs.csv");
const outputPath = resolve(artifactDir, "results.json");
const workerDir = resolve("artifacts/pasc-local-worker");
const browserPath = process.env.PASC_BROWSER_PATH || process.env.PASC_EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const cdpPort = Number(process.env.LOCAL_LARGE_CDP_PORT || 9347);
const sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
const summary = {
  status: "running", startedAt: new Date().toISOString(), synthetic: true,
  validationMode, rawRows: pointCount, sourceEpochs: epochCount, ignoredPaddingBytesPerRow: paddingBytes,
  gpuDisabled: true, forceWasm: true, tested755kPoints: false,
  browserHarness: "actual browser Worker API; OPFS destination replaces OS save picker only",
  limitation: validationMode === "large"
    ? "This validates >300MiB parsing and all 25k+ records, not 755k point rendering or a full-size 755k AOI."
    : "This validates real eight-row full/quick classification and export; it is not the >300MiB or 755k-point validation.",
};

function fixtureRow(index, periods = 40, padding = 12 * 1024) {
  const id = index === 4 ? "" : "large-" + String(index + 1).padStart(6, "0");
  const longitude = index === 0 ? "" : (110.1 + index % 200 * 0.0003).toFixed(6);
  const latitude = (19.9 + Math.floor(index / 200) * 0.0003).toFixed(6);
  const values = Array.from({ length: periods }, (_, step) => (index === 1 && step >= 3) || (index === 2 && step === periods - 1) ? "" : (-(step * 0.8 + index % 11 * 0.1)).toFixed(1));
  return [id, longitude, latitude, "-24.35", index === 3 ? "" : "0.90", ...values, "x".repeat(padding)];
}

async function writeFixture() {
  const dates = Array.from({ length: epochCount }, (_, index) => new Date(Date.UTC(2024, 0, 1 + index * 12)).toISOString().slice(0, 10));
  const output = createWriteStream(fixturePath, { encoding: "utf8" });
  output.on("error", () => {});
  if (!output.write(["id", "lon", "lat", "velocity", "coherence", ...dates, "ignored_padding"].join(",") + "\n")) await once(output, "drain");
  for (let start = 0; start < pointCount; start += 64) {
    const chunk = [];
    for (let index = start; index < Math.min(pointCount, start + 64); index += 1) chunk.push(fixtureRow(index, epochCount, paddingBytes).join(","));
    if (!output.write(chunk.join("\n") + "\n")) await once(output, "drain");
  }
  output.end(); await once(output, "close");
  const metadata = await stat(fixturePath);
  if (validationMode === "large") assert.ok(metadata.size > 300 * 1024 * 1024, "The actual file must exceed 300MiB.");
  summary.sourceFileBytes = metadata.size;
  summary.sourceFileMiB = metadata.size / 1024 / 1024;
  console.log("Real synthetic CSV: " + metadata.size + " bytes (" + summary.sourceFileMiB.toFixed(2) + " MiB)");
}

async function buildHarness() {
  const file = path => JSON.stringify(resolve(path).replaceAll("\\", "/"));
  const entry = resolve(artifactDir, "harness-entry.js");
  await writeFile(entry, [
    "import {adaptLocalPredictionToMapData} from " + file("app/lib/pasc-local-map-adapter.ts") + ";",
    "import {exportOriginalWithPascFields} from " + file("app/lib/pasc-local-export.ts") + ";",
    "import {PASC_CLASSES} from " + file("app/lib/pasc.ts") + ";",
    "import {slopePerYear} from " + file("app/lib/insar-v2.ts") + ";",
    "import {createPrioritySnapshot,computePrioritySnapshot} from " + file("app/lib/local-analysis-compute.ts") + ";",
    "window.__localValidationApi = {adaptLocalPredictionToMapData,exportOriginalWithPascFields,PASC_CLASSES,slopePerYear,createPrioritySnapshot,computePrioritySnapshot};",
  ].join("\n"));
  await build({
    configFile: false, logLevel: "warn",
    build: {
      emptyOutDir: false, outDir: artifactDir, copyPublicDir: false, minify: false, target: "es2022",
      lib: { entry, formats: ["es"], fileName: () => "harness.mjs" },
    },
  });
}

async function startLocalServer() {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      if (path === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><body><input id="csv" type="file" accept=".csv"><script type="module" src="/harness.mjs"></script></body></html>');
        return;
      }
      const filePath = path === "/harness.mjs" ? resolve(artifactDir, "harness.mjs") : path.startsWith("/__pasc-local/worker/") ? resolve(workerDir, "." + path.slice("/__pasc-local/worker".length)) : null;
      if (!filePath || (path !== "/harness.mjs" && !filePath.startsWith(workerDir + sep))) { response.writeHead(404); response.end(); return; }
      response.setHeader("Content-Type", extname(filePath) === ".wasm" ? "application/wasm" : "text/javascript; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      const source = createReadStream(filePath); source.on("error", () => { response.writeHead(404); response.end(); }); source.pipe(response);
    } catch { response.writeHead(500); response.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  return { server, origin: "http://127.0.0.1:" + server.address().port };
}

async function waitJson(url) {
  const deadline = Date.now() + 30_000; let error;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch (caught) { error = caught; }
    await sleep(250);
  }
  throw error || new Error("CDP did not become ready.");
}

async function connectCdp(url, allowedOrigin) {
  const socket = new WebSocket(url), pending = new Map(), requests = [], blocked = [], errors = [];
  let sequence = 0, mainSession;
  let closed = false;
  await new Promise((resolvePromise, reject) => { socket.onopen = resolvePromise; socket.onerror = reject; });
  const call = (method, params = {}, sessionId = mainSession) => {
    if (closed) return Promise.reject(new Error("CDP connection closed."));
    const id = ++sequence;
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, timeoutMs);
      pending.set(id, { resolve: result => { clearTimeout(timer); resolvePromise(result); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  };
  socket.onclose = () => { closed = true; for (const waiting of pending.values()) waiting.reject(new Error("CDP connection closed.")); pending.clear(); };
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const waiting = pending.get(message.id); if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message)); else waiting.resolve(message.result);
      return;
    }
    if (message.method === "Target.attachedToTarget") {
      const session = message.params.sessionId;
      void (async () => {
        if (message.params.targetInfo.type === "worker") {
          // Worker targets expose Network but not Fetch in desktop Edge.
          // Their resource URLs come from the actual local Worker/ORT code; log and
          // verify every request. Page Fetch interception also guards initial scripts.
          await call("Network.enable", {}, session);
          await call("Runtime.runIfWaitingForDebugger", {}, session);
        } else {
          await call("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, session);
          await call("Runtime.runIfWaitingForDebugger", {}, session);
        }
      })().catch(error => errors.push(error.message));
    }
    if (message.method === "Network.requestWillBeSent" && message.sessionId && message.sessionId !== mainSession) {
      const request = message.params.request;
      requests.push({ method: request.method, url: request.url, scope: "worker" });
      if (!request.url.startsWith(allowedOrigin + "/") && !/^(blob:|data:|about:)/.test(request.url)) blocked.push(request.url);
    }
    if (message.method === "Fetch.requestPaused") {
      const { request, requestId } = message.params;
      const local = request.url.startsWith(allowedOrigin + "/") || /^(blob:|data:|about:)/.test(request.url);
      requests.push({ method: request.method, url: request.url, scope: message.sessionId ? "worker" : "page" });
      if (!local) blocked.push(request.url);
      void call(local ? "Fetch.continueRequest" : "Fetch.failRequest", local ? { requestId } : { requestId, errorReason: "BlockedByClient" }, message.sessionId).catch(error => errors.push(error.message));
    }
  };
  return {
    call, requests, blocked, errors,
    setMainSession(session) { mainSession = session; },
    close() {
      closed = true; socket.close();
      for (const waiting of pending.values()) waiting.reject(new Error("CDP connection closed."));
      pending.clear();
    },
  };
}

function browserStart(options = {}) {
  const source = document.querySelector("#csv").files[0];
  if (!(source instanceof File) || (window.__validationMode === "large" && source.size <= 300 * 1024 * 1024)) throw new Error("The real disk-backed CSV File was not selected.");
  const state = window.__largeFileValidation = { source, result: null, dataset: null, error: null, phase: "worker", progress: null, batches: 0, startedAt: performance.now() };
  const worker = new Worker("/__pasc-local/worker/worker.js", { type: "module", name: "large-real-csv-validation" });
  state.worker = worker;
  worker.onmessage = event => {
    const message = event.data;
    if (message.type === "PROGRESS") state.progress = { state: message.state, progress: message.progress, detail: message.detail };
    else if (message.type === "BATCH_DONE") state.batches += 1;
    else if (message.type === "COMPLETE") { state.result = message.result; state.phase = "complete"; state.workerElapsedMs = performance.now() - state.startedAt; worker.terminate(); }
    else if (message.type === "ERROR") { state.error = message.message; state.phase = "error"; worker.terminate(); }
    else if (message.type === "CANCELLED") { state.error = "Worker was cancelled."; state.phase = "error"; worker.terminate(); }
  };
  worker.onerror = event => { state.error = event.message; state.phase = "error"; worker.terminate(); };
  worker.postMessage({ type: "START", file: source, forceWasm: true, analysisScope: options.analysisScope || "full", quickPointLimit: options.quickPointLimit, batchSize: 256, settings: { displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "subsidence_negative", preprocessingState: "already_smoothed" } });
  return { actualFileBytes: source.size, actualFileName: source.name };
}

async function browserValidate() {
  const { result, source } = window.__largeFileValidation;
  const { adaptLocalPredictionToMapData, exportOriginalWithPascFields, PASC_CLASSES, slopePerYear, createPrioritySnapshot, computePrioritySnapshot } = window.__localValidationApi;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  check(result.provider === "wasm", "The actual ONNX provider must be WASM.");
  check(result.largeFileMode === true && result.mapSampled === false && result.analysisScope === "full" && !result.sourceTruncated, "The actual large-file/full/all-point branch did not run.");
  check(result.fileSizeBytes === source.size, "Worker File.size must equal the real disk-backed File.");
  check(result.totalRows === 26_000 && result.invalidRows === 1, "Raw row or invalid-coordinate count mismatch.");
  check(result.pointIds.length === 25_999 && result.totalPredictedPoints === 25_998, "All valid map points and eligible model points must be counted separately.");
  check(result.classCounts.reduce((sum, value) => sum + value, 0) === 25_998, "Class counts mismatch.");
  check(result.displacementSeries.length === 0 && !result.observedSeries && !result.observedMask, "Large COMPLETE must not retain full time matrices in main memory.");
  check(result.classificationEligible[0] === 0 && result.effectiveEpochs[0] === 3 && !Number.isFinite(result.confidence[0]), "The unsupported source row must remain, without fabricated classification.");
  check(result.pointIds[3] === "5" && result.sourceRowNumbers[3] === 6, "Automatic IDs must preserve source row identity.");
  check(result.pointIds.at(-1) === "large-026000" && result.sourceRowNumbers.at(-1) === 26_001, "The last point beyond the former 25k cap disappeared.");
  const evidence = window.__largeFileValidation.evidence = {
    provider: result.provider, largeFileMode: result.largeFileMode, mapSampled: result.mapSampled,
    mapPoints: result.pointIds.length, classifiedPoints: result.totalPredictedPoints, sourceRows: result.totalRows,
    classCounts: Array.from(result.classCounts), invalidReasons: result.invalidReasons,
    workerElapsedMs: window.__largeFileValidation.workerElapsedMs,
  };
  const dataset = adaptLocalPredictionToMapData(result, source.name); window.__largeFileValidation.dataset = dataset;
  check(dataset.points.length === 25_999 && dataset.points.at(-1).id === result.pointIds.at(-1), "Map adapter must keep every valid point.");
  check(dataset.points[0].mode === "未分类" && dataset.points[0].pasc === undefined, "Unsupported point must remain unclassified.");
  check(dataset.points.at(-1).pasc.quality.seriesMean === null, "Unloaded OPFS curves must not invent statistics.");
  check(!dataset.points.at(-1).localSeriesHydrated && Number.isNaN(dataset.points.at(-1).series[10]), "Large curves must be fetched on demand.");
  const root = await navigator.storage.getDirectory();
  const directory = await root.getDirectoryHandle(result.seriesStorage.directory);
  const seriesFile = await (await directory.getFileHandle(result.seriesStorage.fileName)).getFile();
  check(seriesFile.size === result.seriesStorage.pointCount * result.seriesStorage.recordBytes, "OPFS record layout/length mismatch.");
  const selected = await dataset.hydratePoints([result.pointIds[0], result.pointIds[1], result.pointIds.at(-1)]);
  check(selected.every(point => point.localSeriesHydrated), "Hydrated detail flags are required.");
  const missingLast = dataset.points[1];
  check(missingLast.observedMask[39] === 0 && Number.isNaN(missingLast.observedSeries[39]), "Missing endpoint must stay missing in source observations.");
  check(Number.isFinite(missingLast.series[39]), "Processed display series remains separate from the missing observation.");
  await dataset.loadEvaluationDate(result.observedDates[10]);
  check(dataset.points.every(point => point.observedEvaluationDate === result.observedDates[10]), "Changing the real evaluation date must update every point.");
  const expectedLast = Math.fround(-(10 * 0.8 + 25_999 % 11 * 0.1));
  check(dataset.points.at(-1).observedDisplacement === expectedLast && Number.isNaN(dataset.points[0].observedDisplacement), "OPFS date columns must preserve source values and masks.");
  await dataset.loadEvaluationDate(result.observedDates[39]);
  check(Number.isNaN(missingLast.observedDisplacement), "Returning to a missing final date cannot use an interpolated scalar.");
  const anomalyStartedAt = performance.now();
  // The actual fixture is a 33m grid: bounded local neighborhoods, no dense N^2 cluster.
  // Use every imported point and the standard default anomaly rule, including points beyond 25k.
  const priority = computePrioritySnapshot(createPrioritySnapshot(dataset.points, 39, { evaluationDate: result.observedDates[39] }));
  check(priority.regions.status === "ready", "Default full-population clustering must complete.");
  check(Array.from(priority.indices.anomalies).includes(dataset.points.length - 1), "The last point beyond the former 25k cap must belong to the actual spatial anomaly result.");
  const anomalyElapsedMs = performance.now() - anomalyStartedAt;
  await dataset.loadDisplayTime(10);
  check(dataset.points.every(point => point.renderTimeIndex === 10), "Display scalar date must update every point.");
  await dataset.loadStageVelocity(3, 37);
  const lastPoint = dataset.points.at(-1);
  check(lastPoint.renderStageVelocity === slopePerYear(lastPoint.series.slice(3, 38), lastPoint.dates.slice(3, 38)), "Full-range stage OLS must match the original statistic.");
  Object.assign(evidence, {
    fullRangeStageOlsVerified: true, sourceMissingEndpointPreserved: true, evaluationDateChangedForAllPoints: true,
    fullPopulationAnomalyPoints: priority.indices.anomalies.length, lateIndexAnomalyMemberVerified: true, anomalyElapsedMs,
    displayDateChangedForAllPoints: true,
  });
  const exportHandle = await root.getFileHandle("validation-original-with-pasc.csv", { create: true });
  // Only substitutes the interactive destination picker. Export still streams the original File,
  // reads actual OPFS classification rows and writes a real OPFS file.
  window.showSaveFilePicker = async () => exportHandle;
  window.__largeFileValidation.phase = "export";
  const exportStartedAt = performance.now();
  const exported = await exportOriginalWithPascFields({
    source, result, suggestedName: "validation-original-with-pasc.csv",
    onProgress: (progress, detail) => { window.__largeFileValidation.progress = { state: "export", progress, detail }; },
  });
  const exportedFile = await exportHandle.getFile();
  check(exported.sourceRows === 26_000 && exported.mappedRows === 25_999 && exported.classifiedRows === 25_998 && exported.unsupportedRows === 1 && exported.unprocessedRows === 0 && exported.invalidCoordinates === 1, "Original CSV export row binding counts mismatch.");
  check(exportedFile.size > source.size, "The output must contain the complete original CSV.");
  Object.assign(evidence, { exported, exportedFileBytes: exportedFile.size });
  const reader = exportedFile.stream().getReader(), decoder = new TextDecoder();
  const classFields = ["pasc_mode", "pasc_mode_name", "pasc_confidence", "pasc_spatial_reliability", "pasc_spatial_gate_mean", "pasc_spatial_reference"];
  const statusFields = ["pasc_status", "pasc_status_reason", "pasc_effective_observations"];
  let tail = "", header = null, outputIndexes = null, checkedRows = 0;
  const inspect = line => {
    const cells = line.replace(/\r$/, "").replace(/^\uFEFF/, "").split(",");
    if (!header) {
      header = cells; outputIndexes = Object.fromEntries(cells.map((name, index) => [name, index]));
      check(header.length === window.__largeFixtureRow(0).length + classFields.length + statusFields.length, "Original/export header length mismatch.");
      check([...classFields, ...statusFields].every(name => Number.isInteger(outputIndexes[name])), "Export metadata headers are missing.");
      return;
    }
    const original = window.__largeFixtureRow(checkedRows);
    for (let column = 0; column < original.length; column += 1) check(cells[column] === original[column], "Original source field shifted at row " + (checkedRows + 2) + " column " + column);
    const mapRow = checkedRows - 1;
    if (checkedRows <= 1) check(classFields.every(name => cells[outputIndexes[name]] === ""), "Invalid/unsupported rows must have blank classification fields.");
    else {
      const definition = PASC_CLASSES[result.modeIndex[mapRow]];
      const confidenceText = cells[outputIndexes.pasc_confidence];
      const confidenceNumber = Number(confidenceText), expectedConfidence = result.confidence[mapRow];
      if (checkedRows === 2) evidence.firstClassifiedBinding = {
        sourceRow: checkedRows + 2, id: result.pointIds[mapRow], exportedMode: cells[outputIndexes.pasc_mode_name],
        expectedMode: definition.name, exportedConfidenceText: confidenceText,
        expectedConfidenceNumber: expectedConfidence, expectedSixDecimalText: expectedConfidence.toFixed(6),
      };
      check(cells[outputIndexes.pasc_mode] === definition.nameZh && cells[outputIndexes.pasc_mode_name] === definition.name
        && confidenceText.trim() !== "" && Number.isFinite(confidenceNumber) && Math.abs(confidenceNumber - expectedConfidence) <= 0.0000005,
        "OPFS class/confidence shifted at source row " + (checkedRows + 2) + ": exported " + confidenceText + ", expected " + expectedConfidence);
      check(result.sourceRowNumbers[mapRow] === checkedRows + 2, "Source row identity mismatch.");
    }
    const expectedStatus = checkedRows === 0 ? "invalid_coordinate" : checkedRows === 1 ? "insufficient_observations" : "classified";
    const expectedReason = checkedRows === 0 ? "coordinates_missing_or_non_numeric" : checkedRows === 1 ? "effective_observations_below_20" : "";
    const expectedObservations = checkedRows === 1 ? 3 : checkedRows === 2 ? 39 : 40;
    check(cells[outputIndexes.pasc_status] === expectedStatus && cells[outputIndexes.pasc_status_reason] === expectedReason, "Source status mismatch at row " + (checkedRows + 2));
    check(Number(cells[outputIndexes.pasc_effective_observations]) === expectedObservations, "Source observation count mismatch.");
    checkedRows += 1; evidence.verifiedOriginalRows = checkedRows;
  };
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    tail += decoder.decode(value, { stream: true });
    let newline; while ((newline = tail.indexOf("\n")) >= 0) { inspect(tail.slice(0, newline)); tail = tail.slice(newline + 1); }
  }
  tail += decoder.decode(); if (tail) inspect(tail); reader.releaseLock();
  check(checkedRows === 26_000, "Every original source row must be checked.");
  window.__largeFileValidation.phase = "validated";
  return {
    provider: result.provider, largeFileMode: result.largeFileMode, mapSampled: result.mapSampled,
    mapPoints: dataset.points.length, classifiedPoints: result.totalPredictedPoints, sourceRows: result.totalRows,
    classCounts: Array.from(result.classCounts), invalidReasons: result.invalidReasons,
    processedDates: result.timeSteps, observedDates: result.observedDates.length, seriesStorage: result.seriesStorage,
    opfsSeriesBytes: seriesFile.size, opfsClassificationBytes: result.resultStorage.byteLength,
    workerElapsedMs: window.__largeFileValidation.workerElapsedMs, reportedInferenceMs: result.inferenceMs,
    exportElapsedMs: performance.now() - exportStartedAt, exportedFileBytes: exportedFile.size, exported, verifiedOriginalRows: checkedRows,
    fullRangeStageOlsVerified: true, sourceMissingEndpointPreserved: true, evaluationDateChangedForAllPoints: true,
    fullPopulationAnomalyPoints: priority.indices.anomalies.length, lateIndexAnomalyMemberVerified: true, anomalyElapsedMs,
    displayDateChangedForAllPoints: true, firstClassifiedBinding: evidence.firstClassifiedBinding,
  };
}

async function browserValidateSmallExport() {
  const { result, source } = window.__largeFileValidation;
  const { exportOriginalWithPascFields, PASC_CLASSES } = window.__localValidationApi;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const quick = result.analysisScope === "quick", mapCount = quick ? 3 : 7, classifiedCount = quick ? 2 : 6;
  check(result.provider === "wasm" && result.fileSizeBytes === source.size, "Small file must use the actual WASM Worker and disk-backed File.");
  check(!result.largeFileMode && !result.mapSampled && result.pointIds.length === mapCount && result.totalPredictedPoints === classifiedCount, "Small full/quick Worker counts mismatch.");
  check(result.classificationEligible[0] === 0 && result.effectiveEpochs[0] === 3, "Small unsupported row mismatch.");
  check(result.sourceRowNumbers[0] === 3 && result.pointIds[0] === "large-000002", "Small source provenance mismatch.");
  if (!quick) check(result.pointIds.at(-1) === "large-000008" && result.pointIds[3] === "5", "Small full point identity mismatch.");
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle(quick ? "small-quick-original.csv" : "small-full-original.csv", { create: true });
  window.showSaveFilePicker = async () => handle;
  const exported = await exportOriginalWithPascFields({ source, result, suggestedName: "small-original.csv" });
  check(exported.sourceRows === 8 && exported.mappedRows === mapCount && exported.classifiedRows === classifiedCount
    && exported.unsupportedRows === 1 && exported.invalidCoordinates === 1 && exported.unprocessedRows === (quick ? 4 : 0), "Small real export counts mismatch.");
  const file = await handle.getFile();
  const rows = (await file.text()).replace(/^\uFEFF/, "").trim().split("\r\n").map(line => line.split(","));
  const headers = rows.shift(), indexes = Object.fromEntries(headers.map((name, index) => [name, index]));
  const classFields = ["pasc_mode", "pasc_mode_name", "pasc_confidence", "pasc_spatial_reliability", "pasc_spatial_gate_mean", "pasc_spatial_reference"];
  const statuses = [];
  for (let rawRow = 0; rawRow < rows.length; rawRow += 1) {
    const cells = rows[rawRow], original = window.__largeFixtureRow(rawRow);
    check(original.every((value, index) => cells[index] === value), "Small original fields changed at source row " + (rawRow + 2));
    const mapRow = rawRow - 1, processed = rawRow >= 1 && mapRow < mapCount;
    const status = rawRow === 0 ? "invalid_coordinate" : !processed ? "not_processed" : rawRow === 1 ? "insufficient_observations" : "classified";
    const reason = rawRow === 0 ? "coordinates_missing_or_non_numeric" : !processed ? "outside_quick_analysis_scope" : rawRow === 1 ? "effective_observations_below_20" : "";
    const observations = rawRow === 1 ? 3 : rawRow === 2 ? 39 : 40;
    check(cells[indexes.pasc_status] === status && cells[indexes.pasc_status_reason] === reason && Number(cells[indexes.pasc_effective_observations]) === observations, "Small per-row status/count mismatch.");
    if (status === "classified") {
      const definition = PASC_CLASSES[result.modeIndex[mapRow]], confidence = Number(cells[indexes.pasc_confidence]);
      check(cells[indexes.pasc_mode] === definition.nameZh && cells[indexes.pasc_mode_name] === definition.name
        && cells[indexes.pasc_confidence].trim() !== "" && Number.isFinite(confidence) && Math.abs(confidence - result.confidence[mapRow]) <= 0.0000005, "Small actual classification binding mismatch.");
      check(result.sourceRowNumbers[mapRow] === rawRow + 2, "Small classified source-row mismatch.");
    } else check(classFields.every(name => cells[indexes[name]] === ""), "Small unclassified row has a fabricated classification.");
    statuses.push({ sourceRow: rawRow + 2, status, reason, effectiveObservations: observations });
  }
  check(rows.length === 8, "All eight original rows must be preserved.");
  return { provider: result.provider, actualFileBytes: source.size, analysisScope: result.analysisScope,
    sourceTruncated: result.sourceTruncated, mapPoints: mapCount, classifiedPoints: classifiedCount,
    exportFileBytes: file.size, exported, verifiedOriginalRows: rows.length, statuses };
}

let server, browser, cdp, profileDir;
try {
  await mkdir(artifactDir, { recursive: true });
  if (!existsSync(browserPath)) throw new Error("Browser executable not found: " + browserPath);
  await writeFixture();
  if (process.env.LOCAL_LARGE_SKIP_WORKER_BUILD !== "1") {
    const builder = spawn(process.execPath, ["scripts/build-pasc-local-worker.mjs"], { stdio: "inherit", windowsHide: true });
    const [code] = await once(builder, "exit"); if (code !== 0) throw new Error("Actual Worker artifact build failed.");
  }
  await buildHarness();
  const local = await startLocalServer(); server = local.server; summary.localOrigin = local.origin;
  profileDir = await mkdtemp(resolve(tmpdir(), "codex-local-large-validation-"));
  browser = spawn(browserPath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-features=MediaRouter",
    "--remote-debugging-port=" + cdpPort, "--user-data-dir=" + profileDir, "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const browserInfo = await waitJson("http://127.0.0.1:" + cdpPort + "/json/version");
  cdp = await connectCdp(browserInfo.webSocketDebuggerUrl, local.origin);
  const tab = await cdp.call("Target.createTarget", { url: "about:blank" });
  const attached = await cdp.call("Target.attachToTarget", { targetId: tab.targetId, flatten: true });
  cdp.setMainSession(attached.sessionId);
  await cdp.call("Page.enable"); await cdp.call("Runtime.enable"); await cdp.call("Performance.enable");
  await cdp.call("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await cdp.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await cdp.call("Page.navigate", { url: local.origin + "/" });
  const evaluate = async expression => {
    const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
    return result.result.value;
  };
  const deadline = Date.now() + 30_000;
  while (!await evaluate("Boolean(window.__localValidationApi)")) {
    if (Date.now() > deadline) throw new Error("Browser harness did not load."); await sleep(250);
  }
  await evaluate("window.__validationMode = " + JSON.stringify(validationMode)
    + "; window.__largeFixtureRow = index => (" + fixtureRow.toString() + ")(index, " + epochCount + ", " + paddingBytes + ");");
  const documentRoot = await cdp.call("DOM.getDocument");
  const input = await cdp.call("DOM.querySelector", { nodeId: documentRoot.root.nodeId, selector: "#csv" });
  await cdp.call("DOM.setFileInputFiles", { nodeId: input.nodeId, files: [fixturePath] });
  summary.input = await evaluate("(" + browserStart.toString() + ")()");
  const startedAt = Date.now(); let lastLog = 0, pageHeapPeak = 0;
  while (true) {
    const state = await evaluate("({phase:window.__largeFileValidation.phase,error:window.__largeFileValidation.error,progress:window.__largeFileValidation.progress,batches:window.__largeFileValidation.batches})");
    summary.lastProgress = state;
    const metrics = await cdp.call("Performance.getMetrics");
    pageHeapPeak = Math.max(pageHeapPeak, metrics.metrics.find(metric => metric.name === "JSHeapUsedSize")?.value || 0);
    if (Date.now() - lastLog > 10_000) { console.log(JSON.stringify(state)); lastLog = Date.now(); }
    if (state.error) throw new Error("Actual Worker: " + state.error);
    if (state.phase === "complete") break;
    if (Date.now() - startedAt > timeoutMs) throw new Error("Actual large-file Worker exceeded " + timeoutMs + "ms.");
    await sleep(1_000);
  }
  summary.actualWorker = await evaluate("({pointCount:window.__largeFileValidation.result.pointIds.length,totalPredictedPoints:window.__largeFileValidation.result.totalPredictedPoints,totalRows:window.__largeFileValidation.result.totalRows,elapsedMs:window.__largeFileValidation.result.elapsedMs,provider:window.__largeFileValidation.result.provider})");
  const completeMetadata = await evaluate("JSON.stringify(window.__largeFileValidation.result,(key,value)=>ArrayBuffer.isView(value)?{typedArray:value.constructor.name,values:Array.from(value)}:value)");
  summary.actualCompleteMetadataFile = resolve(artifactDir, "actual-complete.json");
  await writeFile(summary.actualCompleteMetadataFile, completeMetadata + "\n");
  if (validationMode === "large") summary.validation = await evaluate("(" + browserValidate.toString() + ")()");
  else {
    summary.fullExportValidation = await evaluate("(" + browserValidateSmallExport.toString() + ")()");
    await evaluate("(" + browserStart.toString() + ")({analysisScope:'quick',quickPointLimit:3})");
    const quickStartedAt = Date.now();
    while (true) {
      const state = await evaluate("({phase:window.__largeFileValidation.phase,error:window.__largeFileValidation.error})");
      if (state.error) throw new Error("Actual quick Worker: " + state.error);
      if (state.phase === "complete") break;
      if (Date.now() - quickStartedAt > timeoutMs) throw new Error("Actual quick Worker timed out.");
      await sleep(250);
    }
    summary.quickExportValidation = await evaluate("(" + browserValidateSmallExport.toString() + ")()");
  }
  const completedMetrics = await cdp.call("Performance.getMetrics");
  pageHeapPeak = Math.max(pageHeapPeak, completedMetrics.metrics.find(metric => metric.name === "JSHeapUsedSize")?.value || 0);
  summary.pageJsHeapPeakBytes = pageHeapPeak;
  summary.memoryMeasurementScope = "Main-page JS heap only; excludes Worker, WASM linear memory and browser/native memory.";
  summary.networkCheck = "Page Fetch blocks external requests; Worker Network logs all resource URLs and requires local-only GETs.";
  summary.requests = cdp.requests; summary.blockedExternalRequests = cdp.blocked; summary.cdpErrors = cdp.errors;
  assert.equal(cdp.blocked.length, 0, "The application attempted a nonlocal network request.");
  assert.ok(cdp.requests.every(request => request.method === "GET"), "No CSV upload HTTP request is allowed.");
  assert.equal(cdp.errors.length, 0, "CDP interception must be complete.");
  summary.status = "passed";
  console.log(validationMode === "large" ? "PASS: real >300MiB CSV -> WASM Worker -> all compact points/OPFS -> all original rows verified."
    : "PASS: real 8-row CSV -> WASM full/quick Workers -> original fields, per-row statuses and true observations verified.");
} catch (error) {
  summary.status = "failed"; summary.error = error instanceof Error ? error.stack : String(error);
  if (cdp) {
    summary.requests = cdp.requests; summary.blockedExternalRequests = cdp.blocked; summary.cdpErrors = cdp.errors;
    try {
      const captured = await cdp.call("Runtime.evaluate", { expression: "window.__largeFileValidation?.evidence || null", returnByValue: true });
      summary.partialValidationEvidence = captured.result.value;
    } catch { /* Preserve the original failure if the browser cannot supply partial evidence. */ }
  }
  if (profileDir) {
    summary.retainedBrowserProfile = profileDir;
    summary.profileRecoveryNote = "Failure profile/OPFS is retained. Reopen on the same local origin (host and port) and use actual-complete.json; do not fabricate model results.";
  }
  process.exitCode = 1; console.error(summary.error);
} finally {
  summary.finishedAt = new Date().toISOString();
  await mkdir(artifactDir, { recursive: true }); await writeFile(outputPath, JSON.stringify(summary, null, 2) + "\n");
  console.log("Result: " + outputPath);
  cdp?.close(); browser?.kill();
  if (browser && browser.exitCode === null) await Promise.race([once(browser, "exit"), sleep(5_000)]);
  if (server) await new Promise(resolvePromise => server.close(resolvePromise));
  if (profileDir && summary.status === "passed") {
    const checked = resolve(profileDir), tempRoot = resolve(tmpdir()) + sep;
    if (checked.startsWith(tempRoot) && checked.split(sep).at(-1).startsWith("codex-local-large-validation-")) await rm(checked, { recursive: true, force: true }).catch(() => {});
  }
}
