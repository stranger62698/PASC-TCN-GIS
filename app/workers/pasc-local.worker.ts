/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/webgpu";

import {
  calibratePascProbabilities,
  maximumIndex,
  stableSoftmaxRow,
} from "../lib/pasc-local-onnx";
import {
  PASC_LOCAL_CLASS_NAMES,
  parseAndPreprocessLocalCsv,
  streamAndPreprocessLocalCsvBatches,
  type PascLocalPreparedData,
} from "../lib/pasc-local-preprocess";
import { quantizeInsarSeries } from "../lib/insar-precision";
import { encodeLocalSeriesRows, localSeriesRecordBytes } from "../lib/local-series-store";
import { assertLocalFileSize, isStreamingLocalFile, requiresLocalCsvSplit } from "../lib/pasc-local-limits";
import type {
  PascLocalCompletePayload,
  PascLocalWorkerRequest,
  PascLocalWorkerResponse,
} from "../lib/pasc-local-worker-protocol";

declare const __PASC_MODEL_BASE64__: string;
declare const __PASC_REFERENCE_BASE64__: string;

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const neighborCount = 8;
const physicsFeatures = 13;
const referenceLatitudeDegrees = 20.01164207807118;
const radiusMeters = 500;
const distanceScaleMeters = 180;
const classNamesZh = ["稳定型", "线性型", "分段型", "减速型", "加速型", "未定义型"] as const;

let cancelled = false;
let running = false;

type ReferenceData = {
  rows: number;
  timeSteps: number;
  series: Float32Array;
  physics: Float32Array;
  coordinates: Float32Array;
  coherence: Float32Array;
  cells: Map<string, number[]>;
};

function post(message: PascLocalWorkerResponse, transfer: Transferable[] = []) {
  workerScope.postMessage(message, transfer);
}

function progress(
  state: Extract<PascLocalWorkerResponse, { type: "PROGRESS" }>["state"],
  value: number,
  detail: string,
) {
  post({ type: "PROGRESS", state, progress: Math.max(0, Math.min(1, value)), detail });
}

function cellKey(x: number, y: number) {
  return Math.floor(x / radiusMeters) + ":" + Math.floor(y / radiusMeters);
}

function decodePrivateAsset(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function loadReference() {
  const bytes = decodePrivateAsset(__PASC_REFERENCE_BASE64__);
  if (bytes.byteLength < 20) throw new Error("冻结空间参考不可用。");
  const buffer = bytes.buffer;
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== "PASCREF1") throw new Error("冻结空间参考格式无效。");
  const header = new DataView(buffer, 8, 12);
  const rows = header.getUint32(0, true);
  const timeSteps = header.getUint32(4, true);
  const features = header.getUint32(8, true);
  if (rows !== 1036 || timeSteps !== 248 || features !== physicsFeatures) throw new Error("冻结空间参考契约不匹配。");
  let offset = 20;
  const series = new Float32Array(buffer, offset, rows * timeSteps);
  offset += series.byteLength;
  const physics = new Float32Array(buffer, offset, rows * features);
  offset += physics.byteLength;
  const coordinates = new Float32Array(buffer, offset, rows * 2);
  offset += coordinates.byteLength;
  const coherence = new Float32Array(buffer, offset, rows);
  const cells = new Map<string, number[]>();
  for (let index = 0; index < rows; index += 1) {
    const key = cellKey(coordinates[index * 2], coordinates[index * 2 + 1]);
    cells.set(key, [...(cells.get(key) ?? []), index]);
  }
  return { rows, timeSteps, series, physics, coordinates, coherence, cells } satisfies ReferenceData;
}

function project(longitude: number, latitude: number) {
  return [
    longitude * 111320 * Math.cos(referenceLatitudeDegrees * Math.PI / 180),
    latitude * 110540,
  ] as const;
}

function queryReference(data: PascLocalPreparedData, pointIndex: number, reference: ReferenceData) {
  const indices = new Int32Array(neighborCount);
  const weights = new Float32Array(neighborCount);
  if (data.timeSteps !== reference.timeSteps) return { indices, weights, reliability: 0 };
  const [x, y] = project(data.longitude[pointIndex], data.latitude[pointIndex]);
  const cellX = Math.floor(x / radiusMeters);
  const cellY = Math.floor(y / radiusMeters);
  const candidates: Array<[number, number]> = [];
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const key = (cellX + offsetX) + ":" + (cellY + offsetY);
      for (const candidate of reference.cells.get(key) ?? []) {
        const deltaX = reference.coordinates[candidate * 2] - x;
        const deltaY = reference.coordinates[candidate * 2 + 1] - y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (distance <= radiusMeters) candidates.push([distance, candidate]);
      }
    }
  }
  candidates.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const selected = candidates[0]?.[0] < 1e-3 ? candidates.slice(1, 9) : candidates.slice(0, 8);
  let rawSum = 0;
  for (let slot = 0; slot < selected.length; slot += 1) {
    const [distance, candidate] = selected[slot];
    indices[slot] = candidate;
    let correlation = 0;
    for (let step = 0; step < data.timeSteps; step += 1) {
      correlation += data.series[pointIndex * data.timeSteps + step] * reference.series[candidate * reference.timeSteps + step];
    }
    correlation /= data.timeSteps;
    const temporalSimilarity = Math.max(0, Math.min(1, (correlation + 1) / 2)) ** 2;
    const spatialWeight = Math.exp(-0.5 * (distance / distanceScaleMeters) ** 2);
    const coherenceWeight = Math.sqrt(Math.max(0, Math.min(1, data.coherence[pointIndex] * reference.coherence[candidate])));
    weights[slot] = Math.fround(spatialWeight * (0.15 + 0.85 * temporalSimilarity) * coherenceWeight);
    rawSum += weights[slot];
  }
  if (rawSum > 0) for (let slot = 0; slot < selected.length; slot += 1) weights[slot] /= rawSum;
  return { indices, weights, reliability: Math.fround(1 - Math.exp(-rawSum / (neighborCount * 0.35))) };
}

type AreaContext = {
  indices: Int32Array;
  weights: Float32Array;
  reliability: Float32Array;
};

async function buildAreaContext(data: PascLocalPreparedData): Promise<AreaContext> {
  const count = data.pointIds.length;
  const longitudeMean = data.longitude.reduce((sum, value) => sum + value, 0) / count;
  const latitudeMean = data.latitude.reduce((sum, value) => sum + value, 0) / count;
  const x = new Float32Array(count);
  const y = new Float32Array(count);
  const cells = new Map<string, number[]>();
  for (let index = 0; index < count; index += 1) {
    x[index] = Math.fround((data.longitude[index] - longitudeMean) * 111320 * Math.cos(latitudeMean * Math.PI / 180));
    y[index] = Math.fround((data.latitude[index] - latitudeMean) * 110540);
    const key = cellKey(x[index], y[index]);
    cells.set(key, [...(cells.get(key) ?? []), index]);
  }
  const indices = new Int32Array(count * neighborCount);
  const weights = new Float32Array(count * neighborCount);
  const reliability = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    if (index > 0 && index % 256 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (cancelled) throw new DOMException("cancelled", "AbortError");
    const cellX = Math.floor(x[index] / radiusMeters);
    const cellY = Math.floor(y[index] / radiusMeters);
    const candidates: Array<[number, number]> = [];
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const key = (cellX + offsetX) + ":" + (cellY + offsetY);
        for (const candidate of cells.get(key) ?? []) {
          if (candidate === index) continue;
          const distance = Math.hypot(x[candidate] - x[index], y[candidate] - y[index]);
          if (distance <= radiusMeters) candidates.push([distance, candidate]);
        }
      }
    }
    candidates.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
    const selected = candidates.slice(0, neighborCount);
    let rawSum = 0;
    for (let slot = 0; slot < selected.length; slot += 1) {
      const [distance, candidate] = selected[slot];
      indices[index * neighborCount + slot] = candidate;
      let correlation = 0;
      for (let step = 0; step < data.timeSteps; step += 1) {
        correlation += data.series[index * data.timeSteps + step] * data.series[candidate * data.timeSteps + step];
      }
      correlation /= data.timeSteps;
      const temporalSimilarity = Math.max(0, Math.min(1, (correlation + 1) / 2)) ** 2;
      const rawWeight = Math.exp(-0.5 * (distance / distanceScaleMeters) ** 2)
        * (0.15 + 0.85 * temporalSimilarity)
        * Math.sqrt(Math.max(0, Math.min(1, data.coherence[index] * data.coherence[candidate])));
      weights[index * neighborCount + slot] = Math.fround(rawWeight);
      rawSum += rawWeight;
    }
    if (rawSum > 0) {
      for (let slot = 0; slot < selected.length; slot += 1) weights[index * neighborCount + slot] /= rawSum;
      reliability[index] = Math.fround(1 - Math.exp(-rawSum / (selected.length * 0.35)));
    }
  }
  return { indices, weights, reliability };
}

function buildFeeds(
  data: PascLocalPreparedData,
  reference: ReferenceData,
  area: AreaContext,
  offset: number,
  count: number,
) {
  const timeSteps = data.timeSteps;
  const series = data.series.slice(offset * timeSteps, (offset + count) * timeSteps);
  const physics = data.physics.slice(offset * physicsFeatures, (offset + count) * physicsFeatures);
  const neighborSeries = new Float32Array(count * neighborCount * timeSteps);
  const neighborPhysics = new Float32Array(count * neighborCount * physicsFeatures);
  const neighborWeights = new Float32Array(count * neighborCount);
  const reliability = new Float32Array(count);
  const referenceSource = new Uint8Array(count);
  for (let row = 0; row < count; row += 1) {
    const pointIndex = offset + row;
    const frozen = queryReference(data, pointIndex, reference);
    const useArea = frozen.reliability <= 0 && area.reliability[pointIndex] > 0;
    reliability[row] = useArea ? area.reliability[pointIndex] : frozen.reliability;
    referenceSource[row] = useArea ? 2 : frozen.reliability > 0 ? 1 : 0;
    for (let slot = 0; slot < neighborCount; slot += 1) {
      const targetSeries = (row * neighborCount + slot) * timeSteps;
      const targetPhysics = (row * neighborCount + slot) * physicsFeatures;
      if (useArea) {
        const source = area.indices[pointIndex * neighborCount + slot];
        neighborSeries.set(data.series.subarray(source * timeSteps, (source + 1) * timeSteps), targetSeries);
        neighborPhysics.set(data.physics.subarray(source * physicsFeatures, (source + 1) * physicsFeatures), targetPhysics);
        neighborWeights[row * neighborCount + slot] = area.weights[pointIndex * neighborCount + slot];
      } else {
        const source = frozen.indices[slot];
        if (timeSteps === reference.timeSteps) {
          neighborSeries.set(reference.series.subarray(source * timeSteps, (source + 1) * timeSteps), targetSeries);
          neighborPhysics.set(reference.physics.subarray(source * physicsFeatures, (source + 1) * physicsFeatures), targetPhysics);
        }
        neighborWeights[row * neighborCount + slot] = frozen.weights[slot];
      }
    }
  }
  return {
    feeds: {
      series: new ort.Tensor("float32", series, [count, 1, timeSteps]),
      physics: new ort.Tensor("float32", physics, [count, physicsFeatures]),
      neighbor_series: new ort.Tensor("float32", neighborSeries, [count, neighborCount, 1, timeSteps]),
      neighbor_physics: new ort.Tensor("float32", neighborPhysics, [count, neighborCount, physicsFeatures]),
      neighbor_weights: new ort.Tensor("float32", neighborWeights, [count, neighborCount]),
      reliability: new ort.Tensor("float32", reliability, [count]),
    },
    reliability,
    referenceSource,
  };
}

async function createSession(forceWasm: boolean) {
  const model = decodePrivateAsset(__PASC_MODEL_BASE64__);
  ort.env.logLevel = "warning";
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = new URL("./", workerScope.location.href).href;
  const hasWebGpu = !forceWasm && Boolean((workerScope.navigator as Navigator & { gpu?: unknown }).gpu);
  if (hasWebGpu) {
    try {
      return {
        provider: "webgpu" as const,
        session: await ort.InferenceSession.create(model.slice(), { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }),
      };
    } catch (error) {
      console.debug("[PASC local worker] WebGPU fallback", error);
    }
  }
  return {
    provider: "wasm" as const,
    session: await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }),
  };
}

type Predictions = {
  rawModeIndex: Uint8Array; modeIndex: Uint8Array; confidence: Float32Array; probabilities: Float32Array;
  spatialReliability: Float32Array; spatialGateMean: Float32Array; spatialReferenceSource: Uint8Array;
  classCounts: Uint32Array; inferenceMs: number; areaMs: number; batchCount: number; classified: number;
};

function selectEligible(data: PascLocalPreparedData) {
  const indices = Array.from({ length: data.pointIds.length }, (_, index) => index).filter(index => !data.classificationEligible || data.classificationEligible[index] === 1);
  if (indices.length === data.pointIds.length) return { data, indices };
  const vector = (input: Float32Array, width = 1) => {
    const output = new Float32Array(indices.length * width);
    indices.forEach((source, target) => output.set(input.subarray(source * width, (source + 1) * width), target * width));
    return output;
  };
  return {
    indices,
    data: { ...data, pointIds: indices.map(index => data.pointIds[index]),
      longitude: vector(data.longitude), latitude: vector(data.latitude), velocity: vector(data.velocity),
      coherence: vector(data.coherence), series: vector(data.series, data.timeSteps), physics: vector(data.physics, physicsFeatures),
    },
  };
}

async function predictEligible(data: PascLocalPreparedData, reference: ReferenceData, session: ort.InferenceSession, batchSize: number, onProgress?: (completed: number, total: number) => void): Promise<Predictions> {
  const total = data.pointIds.length;
  const prediction: Predictions = {
    rawModeIndex: new Uint8Array(total).fill(5), modeIndex: new Uint8Array(total).fill(5),
    confidence: new Float32Array(total).fill(NaN), probabilities: new Float32Array(total * 6).fill(NaN),
    spatialReliability: new Float32Array(total), spatialGateMean: new Float32Array(total), spatialReferenceSource: new Uint8Array(total),
    classCounts: new Uint32Array(6), inferenceMs: 0, areaMs: 0, batchCount: 0, classified: 0,
  };
  const eligible = selectEligible(data);
  if (!eligible.indices.length) return prediction;
  const areaStartedAt = performance.now();
  const area = await buildAreaContext(eligible.data);
  prediction.areaMs = performance.now() - areaStartedAt;
  for (let offset = 0; offset < eligible.indices.length; offset += batchSize) {
    if (cancelled) throw new DOMException("cancelled", "AbortError");
    const count = Math.min(batchSize, eligible.indices.length - offset);
    const started = performance.now();
    const built = buildFeeds(eligible.data, reference, area, offset, count);
    const outputs = await session.run(built.feeds);
    const logits = outputs.logits?.data as Float32Array | undefined;
    const gateMeans = outputs.spatial_gate_mean?.data as Float32Array | undefined;
    if (!logits || !gateMeans) throw new Error("ONNX 输出契约不完整。");
    for (let row = 0; row < count; row += 1) {
      const target = eligible.indices[offset + row];
      const raw = stableSoftmaxRow(logits.subarray(row * 6, row * 6 + 6));
      const calibrated = calibratePascProbabilities(raw, [2, 3, 4], 1.35);
      const label = maximumIndex(calibrated);
      prediction.rawModeIndex[target] = maximumIndex(raw); prediction.modeIndex[target] = label;
      prediction.confidence[target] = calibrated[label]; prediction.probabilities.set(calibrated, target * 6);
      prediction.spatialReliability[target] = built.reliability[row]; prediction.spatialGateMean[target] = gateMeans[row];
      prediction.spatialReferenceSource[target] = built.referenceSource[row]; prediction.classCounts[label] += 1;
    }
    prediction.inferenceMs += performance.now() - started; prediction.batchCount += 1; prediction.classified += count;
    post({ type: "BATCH_DONE", completed: prediction.classified, total: eligible.indices.length, elapsedMs: performance.now() - started });
    if (onProgress) onProgress(prediction.classified, eligible.indices.length);
    else progress("predicting", prediction.classified / eligible.indices.length, "正在本地分类 · " + prediction.classified.toLocaleString() + " / " + eligible.indices.length.toLocaleString());
  }
  return prediction;
}

function csvCell(value: unknown) {
  const text = typeof value === "number" && !Number.isFinite(value) ? "" : String(value ?? "");
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
function sourceLabel(code: number) {
  return code === 1 ? "frozen_training_reference" : code === 2 ? "batch_local_research_area" : "none";
}
async function openLargeResultFile() {
  if (!workerScope.navigator.storage?.getDirectory) throw new Error("OPFS 本地结果存储不可用。");
  const root = await workerScope.navigator.storage.getDirectory();
  const directory = "lanjifyw-pasc-local";
  const folder = await root.getDirectoryHandle(directory, { create: true });
  const name = "pasc-local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const fileName = name + ".csv", seriesFileName = name + ".series";
  const writable = await (await folder.getFileHandle(fileName, { create: true })).createWritable();
  let seriesWritable: FileSystemWritableFileStream;
  try { seriesWritable = await (await folder.getFileHandle(seriesFileName, { create: true })).createWritable(); }
  catch (error) { await writable.abort(); await folder.removeEntry(fileName).catch(() => undefined); throw error; }
  return { folder, directory, fileName, seriesFileName, writable, seriesWritable };
}
function finalValues(input: Float32Array, width: number, count: number) {
  return Float32Array.from({ length: count }, (_, index) => input[index * width + width - 1]);
}
function lightweightResult(data: PascLocalPreparedData, prediction: Predictions) {
  return {
    pointIds: data.pointIds, rawModeIndex: prediction.rawModeIndex, modeIndex: prediction.modeIndex, confidence: prediction.confidence,
    probabilities: prediction.probabilities, longitude: data.longitude, latitude: data.latitude, velocity: data.velocity,
    velocityProvided: data.velocityProvided, coherence: data.coherence, coherenceProvided: data.coherenceProvided, missingRate: data.missingRate,
    spatialReliability: prediction.spatialReliability, spatialGateMean: prediction.spatialGateMean, spatialReferenceSource: prediction.spatialReferenceSource,
    effectiveEpochs: data.effectiveEpochs!, classificationEligible: data.classificationEligible!, sourceRowNumbers: data.sourceRowNumbers!,
    observedDisplacement: finalValues(data.observedSeries!, data.sourceEpochs, data.pointIds.length),
    processedDisplacement: finalValues(data.displacementSeries, data.timeSteps, data.pointIds.length),
  };
}
type LightResult = ReturnType<typeof lightweightResult>;

function transferResult(result: PascLocalCompletePayload) {
  const buffers = (Object.values(result) as unknown[]).filter((value): value is ArrayBufferView => ArrayBuffer.isView(value)).map(value => value.buffer as ArrayBuffer);
  post({ type: "COMPLETE", result }, [...new Set(buffers)]);
}
async function runLargeFile(message: Extract<PascLocalWorkerRequest, { type: "START" }>) {
  const startedAt = performance.now(), modelStartedAt = performance.now();
  const reference = await loadReference();
  const engine = await createSession(Boolean(message.forceWasm));
  const modelLoadingMs = performance.now() - modelStartedAt;
  let output: Awaited<ReturnType<typeof openLargeResultFile>>;
  try { output = await openLargeResultFile(); }
  catch (error) { await engine.session.release(); throw error; }
  const header = "point_id,lon,lat,velocity_mm_per_year,mode,mode_name,confidence,spatial_reliability,spatial_gate_mean,spatial_reference,coherence,missing_rate,epochs,classification_status,effective_epochs,source_row\n";
  let outputBytes = new TextEncoder().encode(header).byteLength;
  const classCounts = new Uint32Array(6), chunks: LightResult[] = [];
  let pointCount = 0, classified = 0, inferenceMs = 0, areaMs = 0, batchCount = 0, streamingProgress = 0;
  let summary: Awaited<ReturnType<typeof streamAndPreprocessLocalCsvBatches>> | null = null;
  try {
    await output.writable.write(header);
    summary = await streamAndPreprocessLocalCsvBatches(message.file, message.settings, message.batchSize, async data => {
      if (cancelled) throw new DOMException("cancelled", "AbortError");
      const prediction = await predictEligible(data, reference, engine.session, message.batchSize, (completed, total) =>
        progress("predicting", streamingProgress, "大文件完整分析 · 累计已分类 " + (classified + completed).toLocaleString() + " 点 · 当前批次 " + completed.toLocaleString() + " / " + total.toLocaleString()));
      inferenceMs += prediction.inferenceMs; areaMs += prediction.areaMs; batchCount += prediction.batchCount; classified += prediction.classified;
      prediction.classCounts.forEach((value, index) => { classCounts[index] += value; });
      const lines = data.pointIds.map((id, row) => [
        id, data.longitude[row], data.latitude[row], Math.round(data.velocity[row] * 10) / 10,
        data.classificationEligible![row] ? classNamesZh[prediction.modeIndex[row]] : "未分类",
        data.classificationEligible![row] ? PASC_LOCAL_CLASS_NAMES[prediction.modeIndex[row]] : "",
        prediction.confidence[row], prediction.spatialReliability[row], prediction.spatialGateMean[row], sourceLabel(prediction.spatialReferenceSource[row]),
        data.coherenceProvided[row] ? data.coherence[row] : "", data.missingRate[row], data.timeSteps,
        data.classificationEligible![row] ? "classified" : "insufficient_epochs", data.effectiveEpochs![row], data.sourceRowNumbers![row],
      ].map(csvCell).join(","));
      const csv = lines.join("\n") + "\n"; outputBytes += new TextEncoder().encode(csv).byteLength;
      await output.writable.write(csv);
      await output.seriesWritable.write(encodeLocalSeriesRows(data.displacementSeries, data.observedSeries!, data.observedMask!, data.pointIds.length, data.timeSteps, data.sourceEpochs));
      chunks.push(lightweightResult(data, prediction)); pointCount += data.pointIds.length;
    }, (value, detail) => { streamingProgress = value; progress("streaming", value, detail + " · 已保留 " + pointCount.toLocaleString() + " 点"); }, () => cancelled);
    await output.writable.close(); await output.seriesWritable.close();
  } catch (error) {
    await output.writable.abort().catch(() => undefined); await output.seriesWritable.abort().catch(() => undefined);
    await output.folder.removeEntry(output.fileName).catch(() => undefined); await output.folder.removeEntry(output.seriesFileName).catch(() => undefined);
    throw error;
  } finally { await engine.session.release(); }
  if (!summary) throw new Error("大文件流式分析未生成摘要。");
  progress("finalizing", 1, "正在接入全部 " + pointCount.toLocaleString() + " 个有效点");
  const combined = {} as LightResult;
  for (const key of Object.keys(chunks[0]) as Array<keyof LightResult>) {
    if (key === "pointIds") { combined.pointIds = chunks.flatMap(chunk => chunk.pointIds); continue; }
    const first = chunks[0][key] as Uint8Array | Uint32Array | Float32Array;
    const length = chunks.reduce((sum, chunk) => sum + chunk[key].length, 0);
    const vector = first instanceof Float32Array ? new Float32Array(length) : first instanceof Uint32Array ? new Uint32Array(length) : new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { const values = chunk[key] as typeof vector; vector.set(values, offset); offset += values.length; }
    (combined as unknown as Record<string, unknown>)[key] = vector;
  }
  const result: PascLocalCompletePayload = {
    ...combined, classCounts, displacementSeries: new Int32Array(0), displacementScale: 0.1, displacementEncoding: "int32_tenth_mm",
    dates: summary.dates, observedDates: summary.observedDates, sourceEpochs: summary.sourceEpochs, insertedEpochs: summary.insertedEpochs,
    timeSteps: summary.timeSteps, totalRows: summary.totalRows, invalidRows: summary.invalidRows,
    invalidReasons: summary.invalidReasons, invalidExamples: summary.invalidExamples,
    elapsedMs: performance.now() - startedAt, provider: engine.provider, batchSize: message.batchSize, fileSizeBytes: message.file.size,
    csvParsingMs: summary.csvParsingMs, preprocessingMs: summary.preprocessingMs + areaMs, modelLoadingMs, inferenceMs,
    averageBatchMs: batchCount ? inferenceMs / batchCount : 0, batchCount, totalPredictedPoints: classified, mapSampled: false, largeFileMode: true,
    analysisScope: "full", sourceTruncated: false,
    resultStorage: { kind: "opfs", directory: output.directory, fileName: output.fileName, byteLength: outputBytes },
    seriesStorage: { kind: "opfs", directory: output.directory, fileName: output.seriesFileName, pointCount, timeSteps: summary.timeSteps,
      observedEpochs: summary.sourceEpochs, recordBytes: localSeriesRecordBytes(summary.timeSteps, summary.sourceEpochs) },
  };
  transferResult(result);
}

async function run(message: Extract<PascLocalWorkerRequest, { type: "START" }>) {
  assertLocalFileSize(message.file.size);
  if (message.batchSize > 1024) throw new Error("batch 2048 已实测超过 WebGPU 2 GiB 单缓冲限制；请选择 256、512 或 1024。");
  const analysisScope = message.analysisScope ?? "full";
  if (analysisScope === "full" && requiresLocalCsvSplit(message.file.size)) throw new Error("超过 1 GiB 的 CSV 请先在本机分片，再逐片分析；原文件不会上传。");
  if (isStreamingLocalFile(message.file.size) && analysisScope === "full") { await runLargeFile(message); return; }
  const startedAt = performance.now();
  progress("parsing", 0, "正在解析 CSV");
  const data = await parseAndPreprocessLocalCsv(message.file, message.settings,
    (value, detail) => progress(value < 1 ? "parsing" : "preprocessing", value, detail), () => cancelled,
    analysisScope === "quick" ? message.quickPointLimit : undefined);
  if (cancelled) throw new DOMException("cancelled", "AbortError");
  progress("loading_model", 0, "正在加载本地 ONNX 模型");
  const modelStartedAt = performance.now();
  const reference = await loadReference();
  const engine = await createSession(Boolean(message.forceWasm));
  const modelLoadingMs = performance.now() - modelStartedAt;
  let prediction: Predictions;
  try { prediction = await predictEligible(data, reference, engine.session, message.batchSize); }
  finally { await engine.session.release(); }
  progress("finalizing", 1, "正在生成完整本地结果");
  const hasMissing = data.displacementSeries.some(value => !Number.isFinite(value));
  const quantized = hasMissing
    ? { values: Int32Array.from(data.displacementSeries, value => {
      if (!Number.isFinite(value)) return -2_147_483_648;
      const encoded = Math.round(value * 10);
      if (encoded <= -2_147_483_648 || encoded > 2_147_483_647) throw new Error("形变值超出一位小数量化范围。");
      return encoded;
    }), scale: 0.1 as const, encoding: "int32_tenth_mm" as const }
    : quantizeInsarSeries(data.displacementSeries);
  const result: PascLocalCompletePayload = {
    ...lightweightResult(data, prediction), classCounts: prediction.classCounts,
    displacementSeries: quantized.values, displacementScale: quantized.scale, displacementEncoding: quantized.encoding,
    observedSeries: data.observedSeries, observedMask: data.observedMask, observedDates: data.observedDates,
    dates: data.dates, sourceEpochs: data.sourceEpochs, insertedEpochs: data.insertedEpochs, totalRows: data.totalRows,
    invalidRows: data.invalidRows, invalidReasons: data.invalidReasons, invalidExamples: data.invalidExamples, timeSteps: data.timeSteps,
    elapsedMs: performance.now() - startedAt, provider: engine.provider, batchSize: message.batchSize, fileSizeBytes: message.file.size,
    csvParsingMs: data.csvParsingMs, preprocessingMs: data.preprocessingMs + prediction.areaMs, modelLoadingMs,
    inferenceMs: prediction.inferenceMs, averageBatchMs: prediction.batchCount ? prediction.inferenceMs / prediction.batchCount : 0,
    batchCount: prediction.batchCount, totalPredictedPoints: prediction.classified, mapSampled: false,
    analysisScope, sourceTruncated: analysisScope === "quick" && data.pointIds.length >= (message.quickPointLimit ?? 5000),
  };
  transferResult(result);
}

workerScope.addEventListener("message", event => {
  const message = event.data as PascLocalWorkerRequest;
  if (message.type === "CANCEL") {
    cancelled = true;
    return;
  }
  if (message.type !== "START" || running) return;
  running = true;
  cancelled = false;
  void run(message).catch(error => {
    if (cancelled || (error instanceof DOMException && error.name === "AbortError")) post({ type: "CANCELLED" });
    else {
      console.error("[PASC local worker]", error);
      post({ type: "ERROR", message: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    }
  }).finally(() => {
    running = false;
  });
});
