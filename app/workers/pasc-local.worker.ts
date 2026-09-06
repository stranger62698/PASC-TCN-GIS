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
import { PASC_LOCAL_MAP_SAMPLE_POINTS, assertLocalFileSize, isStreamingLocalFile } from "../lib/pasc-local-limits";
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
  ort.env.wasm.wasmPaths = "/__pasc-local/worker/";
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

type LargeSampleRecord = {
  pointId: string;
  rawModeIndex: number;
  modeIndex: number;
  confidence: number;
  probabilities: Float32Array;
  longitude: number;
  latitude: number;
  velocity: number;
  velocityProvided: number;
  coherence: number;
  coherenceProvided: number;
  missingRate: number;
  displacementSeries: Int32Array;
  spatialReliability: number;
  spatialGateMean: number;
  spatialReferenceSource: number;
};

function mix32(value: number) {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function reservoirSlot(seen: number, limit: number) {
  if (seen <= limit) return seen - 1;
  const candidate = mix32(seen) % seen;
  return candidate < limit ? candidate : -1;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function sourceLabel(code: number) {
  return code === 1 ? "frozen_training_reference" : code === 2 ? "batch_local_research_area" : "none";
}

async function openLargeResultFile() {
  if (!workerScope.navigator.storage?.getDirectory) throw new Error("OPFS 本地结果存储不可用。");
  const root = await workerScope.navigator.storage.getDirectory();
  const directory = "lanjifyw-pasc-local";
  const folder = await root.getDirectoryHandle(directory, { create: true });
  const fileName = `pasc-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.csv`;
  const handle = await folder.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  return { root, folder, directory, fileName, writable };
}

function assembleLargeSample(
  sample: LargeSampleRecord[],
  classCounts: Uint32Array,
  metadata: {
    dates: string[];
    sourceEpochs: number;
    insertedEpochs: number;
    totalRows: number;
    invalidRows: number;
    totalPredictedPoints: number;
    elapsedMs: number;
    provider: "webgpu" | "wasm";
    batchSize: number;
    fileSizeBytes: number;
    csvParsingMs: number;
    preprocessingMs: number;
    modelLoadingMs: number;
    inferenceMs: number;
    batchCount: number;
    resultStorage: NonNullable<PascLocalCompletePayload["resultStorage"]>;
  },
): PascLocalCompletePayload {
  const count = sample.length;
  const timeSteps = metadata.dates.length;
  const rawModeIndex = new Uint8Array(count);
  const modeIndex = new Uint8Array(count);
  const confidence = new Float32Array(count);
  const probabilities = new Float32Array(count * PASC_LOCAL_CLASS_NAMES.length);
  const longitude = new Float32Array(count);
  const latitude = new Float32Array(count);
  const velocity = new Float32Array(count);
  const velocityProvided = new Uint8Array(count);
  const coherence = new Float32Array(count);
  const coherenceProvided = new Uint8Array(count);
  const missingRate = new Float32Array(count);
  const displacementSeries = new Int32Array(count * timeSteps);
  const spatialReliability = new Float32Array(count);
  const spatialGateMean = new Float32Array(count);
  const spatialReferenceSource = new Uint8Array(count);
  sample.forEach((record, index) => {
    rawModeIndex[index] = record.rawModeIndex;
    modeIndex[index] = record.modeIndex;
    confidence[index] = record.confidence;
    probabilities.set(record.probabilities, index * PASC_LOCAL_CLASS_NAMES.length);
    longitude[index] = record.longitude;
    latitude[index] = record.latitude;
    velocity[index] = record.velocity;
    velocityProvided[index] = record.velocityProvided;
    coherence[index] = record.coherence;
    coherenceProvided[index] = record.coherenceProvided;
    missingRate[index] = record.missingRate;
    displacementSeries.set(record.displacementSeries, index * timeSteps);
    spatialReliability[index] = record.spatialReliability;
    spatialGateMean[index] = record.spatialGateMean;
    spatialReferenceSource[index] = record.spatialReferenceSource;
  });
  return {
    pointIds: sample.map(record => record.pointId), rawModeIndex, modeIndex, confidence, probabilities, classCounts,
    longitude, latitude, velocity, velocityProvided, coherence, coherenceProvided, missingRate,
    displacementSeries, displacementScale: 0.1, displacementEncoding: "int32_tenth_mm",
    spatialReliability, spatialGateMean, spatialReferenceSource,
    dates: metadata.dates, sourceEpochs: metadata.sourceEpochs, insertedEpochs: metadata.insertedEpochs,
    totalRows: metadata.totalRows, invalidRows: metadata.invalidRows, timeSteps,
    elapsedMs: metadata.elapsedMs, provider: metadata.provider, batchSize: metadata.batchSize,
    fileSizeBytes: metadata.fileSizeBytes, csvParsingMs: metadata.csvParsingMs,
    preprocessingMs: metadata.preprocessingMs, modelLoadingMs: metadata.modelLoadingMs,
    inferenceMs: metadata.inferenceMs, averageBatchMs: metadata.batchCount ? metadata.inferenceMs / metadata.batchCount : 0,
    batchCount: metadata.batchCount, totalPredictedPoints: metadata.totalPredictedPoints,
    mapSampled: metadata.totalPredictedPoints > count, largeFileMode: true, resultStorage: metadata.resultStorage,
  };
}

async function runLargeFile(message: Extract<PascLocalWorkerRequest, { type: "START" }>) {
  const startedAt = performance.now();
  progress("loading_model", 0, "正在准备大文件本地 ONNX 与 OPFS");
  const modelStartedAt = performance.now();
  const reference = await loadReference();
  const engine = await createSession(Boolean(message.forceWasm));
  const modelLoadingMs = performance.now() - modelStartedAt;
  const output = await openLargeResultFile();
  const header = "point_id,lon,lat,velocity_mm_per_year,mode,mode_name,confidence,spatial_reliability,spatial_gate_mean,spatial_reference,coherence,missing_rate,epochs\n";
  let outputBytes = new TextEncoder().encode(header).byteLength;
  await output.writable.write(header);
  const classCounts = new Uint32Array(PASC_LOCAL_CLASS_NAMES.length);
  const sample: LargeSampleRecord[] = [];
  let predicted = 0;
  let inferenceMs = 0;
  let areaMs = 0;
  let batchCount = 0;
  let summary: Awaited<ReturnType<typeof streamAndPreprocessLocalCsvBatches>> | null = null;
  try {
    summary = await streamAndPreprocessLocalCsvBatches(
      message.file,
      message.settings,
      message.batchSize,
      async data => {
        if (cancelled) throw new DOMException("cancelled", "AbortError");
        const areaStartedAt = performance.now();
        const area = await buildAreaContext(data);
        areaMs += performance.now() - areaStartedAt;
        const batchStartedAt = performance.now();
        const built = buildFeeds(data, reference, area, 0, data.pointIds.length);
        const outputs = await engine.session.run(built.feeds);
        const logits = outputs.logits?.data as Float32Array | undefined;
        const gateMeans = outputs.spatial_gate_mean?.data as Float32Array | undefined;
        if (!logits || !gateMeans) throw new Error("ONNX 输出契约不完整。");
        const lines: string[] = [];
        for (let row = 0; row < data.pointIds.length; row += 1) {
          const raw = stableSoftmaxRow(logits.subarray(row * 6, row * 6 + 6));
          const calibrated = calibratePascProbabilities(raw, [2, 3, 4], 1.35);
          const classIndex = maximumIndex(calibrated);
          const rawClassIndex = maximumIndex(raw);
          classCounts[classIndex] += 1;
          predicted += 1;
          const source = built.referenceSource[row];
          lines.push([
            data.pointIds[row], data.longitude[row], data.latitude[row], Math.round(data.velocity[row] * 10) / 10,
            classNamesZh[classIndex], PASC_LOCAL_CLASS_NAMES[classIndex], calibrated[classIndex].toFixed(6),
            built.reliability[row].toFixed(6), gateMeans[row].toFixed(6), sourceLabel(source),
            data.coherenceProvided[row] ? data.coherence[row].toFixed(4) : "", data.missingRate[row].toFixed(6), data.timeSteps,
          ].map(csvCell).join(","));
          const slot = reservoirSlot(predicted, PASC_LOCAL_MAP_SAMPLE_POINTS);
          if (slot >= 0) {
            const encodedSeries = new Int32Array(data.timeSteps);
            for (let step = 0; step < data.timeSteps; step += 1) {
              const encoded = Math.round(data.displacementSeries[row * data.timeSteps + step] * 10);
              if (!Number.isFinite(encoded) || encoded < -2_147_483_648 || encoded > 2_147_483_647) throw new Error("形变值超出一位小数量化范围。");
              encodedSeries[step] = encoded;
            }
            sample[slot] = {
              pointId: data.pointIds[row], rawModeIndex: rawClassIndex, modeIndex: classIndex,
              confidence: calibrated[classIndex], probabilities: Float32Array.from(calibrated),
              longitude: data.longitude[row], latitude: data.latitude[row], velocity: data.velocity[row],
              velocityProvided: data.velocityProvided[row], coherence: data.coherence[row],
              coherenceProvided: data.coherenceProvided[row], missingRate: data.missingRate[row],
              displacementSeries: encodedSeries, spatialReliability: built.reliability[row],
              spatialGateMean: gateMeans[row], spatialReferenceSource: source,
            };
          }
        }
        const outputChunk = lines.join("\n") + "\n";
        outputBytes += new TextEncoder().encode(outputChunk).byteLength;
        await output.writable.write(outputChunk);
        inferenceMs += performance.now() - batchStartedAt;
        batchCount += 1;
        post({ type: "BATCH_DONE", completed: predicted, total: predicted, elapsedMs: performance.now() - batchStartedAt });
      },
      (value, detail) => progress("streaming", value, `${detail} · 已完成 ${predicted.toLocaleString()} 点`),
      () => cancelled,
    );
    await output.writable.close();
  } catch (error) {
    await output.writable.abort().catch(() => undefined);
    await output.folder.removeEntry(output.fileName).catch(() => undefined);
    throw error;
  } finally {
    await engine.session.release();
  }
  if (!summary) throw new Error("大文件流式分析未生成摘要。");
  progress("finalizing", 1, `正在生成 ${sample.length.toLocaleString()} 点地图抽样预览`);
  const result = assembleLargeSample(sample, classCounts, {
    dates: summary.dates, sourceEpochs: summary.sourceEpochs, insertedEpochs: summary.insertedEpochs,
    totalRows: summary.totalRows, invalidRows: summary.invalidRows, totalPredictedPoints: predicted,
    elapsedMs: performance.now() - startedAt, provider: engine.provider, batchSize: message.batchSize,
    fileSizeBytes: message.file.size, csvParsingMs: summary.csvParsingMs,
    preprocessingMs: summary.preprocessingMs + areaMs, modelLoadingMs, inferenceMs, batchCount,
    resultStorage: { kind: "opfs", directory: output.directory, fileName: output.fileName, byteLength: outputBytes },
  });
  post({ type: "COMPLETE", result }, [
    result.rawModeIndex.buffer, result.modeIndex.buffer, result.confidence.buffer, result.probabilities.buffer,
    result.classCounts.buffer, result.longitude.buffer, result.latitude.buffer, result.velocity.buffer,
    result.velocityProvided.buffer, result.coherence.buffer, result.coherenceProvided.buffer,
    result.missingRate.buffer, result.displacementSeries.buffer, result.spatialReliability.buffer,
    result.spatialGateMean.buffer, result.spatialReferenceSource.buffer,
  ]);
}

async function run(message: Extract<PascLocalWorkerRequest, { type: "START" }>) {
  assertLocalFileSize(message.file.size);
  if (message.batchSize > 1024) {
    throw new Error("batch 2048 已实测超过 WebGPU 2 GiB 单缓冲限制；请选择 256、512 或 1024。");
  }
  const analysisScope = message.analysisScope ?? "full";
  if (isStreamingLocalFile(message.file.size) && analysisScope === "full") {
    await runLargeFile(message);
    return;
  }
  const startedAt = performance.now();
  progress("loading_file", 0, "正在读取 " + message.file.name);
  progress("parsing", 0, "正在解析 CSV");
  const data = await parseAndPreprocessLocalCsv(
    message.file,
    message.settings,
    (value, detail) => progress(value < 1 ? "parsing" : "preprocessing", value, detail),
    () => cancelled,
    analysisScope === "quick" ? message.quickPointLimit : undefined,
  );
  if (cancelled) throw new DOMException("cancelled", "AbortError");
  progress("preprocessing", 1, "正在构建无标签空间邻域");
  const areaStartedAt = performance.now();
  const area = await buildAreaContext(data);
  const areaElapsedMs = performance.now() - areaStartedAt;
  if (cancelled) throw new DOMException("cancelled", "AbortError");
  progress("loading_model", 0, "正在加载本地 ONNX 模型");
  // The local-only builder embeds both private assets in this ignored bundle.
  // Decode the smaller reference before initializing the ORT runtime.
  const modelStartedAt = performance.now();
  const reference = await loadReference();
  const engine = await createSession(Boolean(message.forceWasm));
  const modelLoadingMs = performance.now() - modelStartedAt;
  const total = data.pointIds.length;
  const rawModeIndex = new Uint8Array(total);
  const modeIndex = new Uint8Array(total);
  const confidence = new Float32Array(total);
  const probabilities = new Float32Array(total * PASC_LOCAL_CLASS_NAMES.length);
  const spatialReliability = new Float32Array(total);
  const spatialGateMean = new Float32Array(total);
  const spatialReferenceSource = new Uint8Array(total);
  const classCounts = new Uint32Array(PASC_LOCAL_CLASS_NAMES.length);
  let inferenceMs = 0;
  let batchCount = 0;
  progress("predicting", 0, "正在本地分类 · batch " + message.batchSize);
  try {
    for (let offset = 0; offset < total; offset += message.batchSize) {
      if (cancelled) throw new DOMException("cancelled", "AbortError");
      const count = Math.min(message.batchSize, total - offset);
      const batchStartedAt = performance.now();
      const batch = buildFeeds(data, reference, area, offset, count);
      const outputs = await engine.session.run(batch.feeds);
      const logits = outputs.logits?.data as Float32Array | undefined;
      const gateMeans = outputs.spatial_gate_mean?.data as Float32Array | undefined;
      if (!logits) throw new Error("ONNX 输出契约缺少 logits。");
      if (!gateMeans) throw new Error("ONNX 输出契约缺少 spatial_gate_mean。");
      spatialReliability.set(batch.reliability, offset);
      spatialGateMean.set(gateMeans, offset);
      spatialReferenceSource.set(batch.referenceSource, offset);
      for (let row = 0; row < count; row += 1) {
        const raw = stableSoftmaxRow(logits.subarray(row * 6, row * 6 + 6));
        const calibrated = calibratePascProbabilities(raw, [2, 3, 4], 1.35);
        const classIndex = maximumIndex(calibrated);
        rawModeIndex[offset + row] = maximumIndex(raw);
        modeIndex[offset + row] = classIndex;
        confidence[offset + row] = calibrated[classIndex];
        probabilities.set(calibrated, (offset + row) * PASC_LOCAL_CLASS_NAMES.length);
        classCounts[classIndex] += 1;
      }
      const batchElapsedMs = performance.now() - batchStartedAt;
      inferenceMs += batchElapsedMs;
      batchCount += 1;
      const completed = offset + count;
      post({ type: "BATCH_DONE", completed, total, elapsedMs: batchElapsedMs });
      progress("predicting", completed / total, "正在本地分类 · " + completed.toLocaleString() + " / " + total.toLocaleString());
    }
  } finally {
    await engine.session.release();
  }
  progress("finalizing", 1, "正在生成结果");
  const quantizedDisplacement = quantizeInsarSeries(data.displacementSeries);
  const result: PascLocalCompletePayload = {
    pointIds: data.pointIds,
    rawModeIndex,
    modeIndex,
    confidence,
    probabilities,
    classCounts,
    longitude: data.longitude,
    latitude: data.latitude,
    velocity: data.velocity,
    velocityProvided: data.velocityProvided,
    coherence: data.coherence,
    coherenceProvided: data.coherenceProvided,
    missingRate: data.missingRate,
    displacementSeries: quantizedDisplacement.values,
    displacementScale: quantizedDisplacement.scale,
    displacementEncoding: quantizedDisplacement.encoding,
    spatialReliability,
    spatialGateMean,
    spatialReferenceSource,
    dates: data.dates,
    sourceEpochs: data.sourceEpochs,
    insertedEpochs: data.insertedEpochs,
    totalRows: data.totalRows,
    invalidRows: data.invalidRows,
    timeSteps: data.timeSteps,
    elapsedMs: performance.now() - startedAt,
    provider: engine.provider,
    batchSize: message.batchSize,
    fileSizeBytes: message.file.size,
    csvParsingMs: data.csvParsingMs,
    preprocessingMs: data.preprocessingMs + areaElapsedMs,
    modelLoadingMs,
    inferenceMs,
    averageBatchMs: batchCount ? inferenceMs / batchCount : 0,
    batchCount,
    analysisScope,
    sourceTruncated: analysisScope === "quick" && Boolean(message.quickPointLimit && data.pointIds.length >= message.quickPointLimit),
  };
  post({ type: "COMPLETE", result }, [
    rawModeIndex.buffer,
    modeIndex.buffer,
    confidence.buffer,
    probabilities.buffer,
    classCounts.buffer,
    data.longitude.buffer,
    data.latitude.buffer,
    data.velocity.buffer,
    data.velocityProvided.buffer,
    data.coherence.buffer,
    data.coherenceProvided.buffer,
    data.missingRate.buffer,
    quantizedDisplacement.values.buffer,
    spatialReliability.buffer,
    spatialGateMean.buffer,
    spatialReferenceSource.buffer,
  ]);
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
