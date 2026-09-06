import { parsePascDateHeader, resolvePascField } from "./pasc-schema";
import { PASC_LOCAL_STREAM_CHUNK_BYTES } from "./pasc-local-limits";

export const PASC_LOCAL_CLASS_NAMES = [
  "Stable",
  "Linear",
  "Piecewise",
  "Decelerating",
  "Accelerating",
  "Undefined",
] as const;

export type PascLocalSettings = {
  displacementUnit: "mm" | "cm" | "m";
  velocityUnit: "mm/year" | "cm/year" | "m/year";
  signConvention: "model_native" | "subsidence_negative" | "subsidence_positive";
  preprocessingState: "raw" | "already_smoothed";
};

export type PascLocalPreparedData = {
  pointIds: string[];
  longitude: Float32Array;
  latitude: Float32Array;
  velocity: Float32Array;
  velocityProvided: Uint8Array;
  coherence: Float32Array;
  coherenceProvided: Uint8Array;
  missingRate: Float32Array;
  series: Float32Array;
  displacementSeries: Float32Array;
  physics: Float32Array;
  dates: string[];
  timeSteps: number;
  totalRows: number;
  invalidRows: number;
  sourceEpochs: number;
  insertedEpochs: number;
  csvParsingMs: number;
  preprocessingMs: number;
};

export type PascLocalProgress = (progress: number, detail: string) => void;

/* eslint-disable no-loss-of-precision -- values are the frozen float32 scaler artifact */
const scalerCenter = new Float32Array([
  -63.964996337890625, -8.14146614074707, -7.276299953460693,
  -7.185040473937988, -0.041277118027210236, 148.2306671142578,
  36.755325317382, 5.767745018005371, 75.60000610351562,
  0.5951417088508606, 0.8873493671417236, -6.4817657470703125,
  0.6355669498443604,
]);
const scalerScale = new Float32Array([
  55.32749938964844, 7.578825950622559, 11.381746292114258,
  11.533498764038086, 1.6051785945892334, 90.24764251708984,
  9.139708518981934, 4.679878234863281, 49.46750259399414,
  0.09412956237792969, 1.4975991249084473, 6.599137783050537,
  0.2950817942619324,
]);
/* eslint-enable no-loss-of-precision */

// Frozen NumPy least-squares coefficients for window=9, polyorder=3.
const sgCoefficients = [
  [0.858585858585879, 0.28282828282828, -0.020202020202032, -0.121212121212132, -0.090909090909096, 0, 0.080808080808088, 0.080808080808087, -0.070707070707077],
  [0.282828282828299, 0.328282828282826, 0.282828282828273, 0.181818181818173, 0.060606060606057, -0.045454545454543, -0.101010101010094, -0.070707070707066, 0.080808080808075],
  [-0.020202020202007, 0.282828282828281, 0.371572871572864, 0.311688311688304, 0.168831168831165, 0.00865800865801, -0.103174603174598, -0.101010101010097, 0.080808080808077],
  [-0.12121212121211, 0.181818181818181, 0.311688311688305, 0.313852813852807, 0.23376623376623, 0.116883116883116, 0.008658008658011, -0.045454545454543, 0],
  [-0.090909090909081, 0.060606060606061, 0.168831168831163, 0.233766233766227, 0.255411255411249, 0.23376623376623, 0.168831168831168, 0.060606060606062, -0.09090909090909],
  [0, -0.045454545454545, 0.008658008658003, 0.116883116883107, 0.233766233766224, 0.313852813852806, 0.311688311688307, 0.181818181818182, -0.121212121212116],
  [0.080808080808096, -0.101010101010099, -0.103174603174611, 0.008658008657996, 0.168831168831153, 0.311688311688297, 0.371572871572861, 0.282828282828282, -0.020202020202009],
  [0.080808080808102, -0.070707070707067, -0.101010101010111, -0.045454545454565, 0.060606060606036, 0.181818181818158, 0.282828282828266, 0.328282828282826, 0.282828282828301],
  [-0.070707070707039, 0.080808080808086, 0.080808080808065, 0, -0.090909090909127, -0.121212121212156, -0.020202020202044, 0.282828282828279, 0.858585858585886],
] as const;

function f32(value: number) {
  return Math.fround(value);
}

function finite(value: string | undefined) {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function slope(years: Float32Array, values: Float32Array, start = 0, end = values.length) {
  let timeMean = 0;
  let valueMean = 0;
  const count = end - start;
  for (let index = start; index < end; index += 1) {
    timeMean += years[index];
    valueMean += values[index];
  }
  timeMean = f32(timeMean / count);
  valueMean = f32(valueMean / count);
  let numerator = 0;
  let denominator = 1e-8;
  for (let index = start; index < end; index += 1) {
    const centeredTime = f32(years[index] - timeMean);
    numerator += f32(f32(values[index] - valueMean) * centeredTime);
    denominator += f32(centeredTime * centeredTime);
  }
  return f32(numerator / denominator);
}

function interpolate(sourceDays: Float32Array, sourceValues: Float32Array, targetDays: Float32Array) {
  const result = new Float32Array(targetDays.length);
  let right = 1;
  for (let index = 0; index < targetDays.length; index += 1) {
    const day = targetDays[index];
    while (right < sourceDays.length && sourceDays[right] < day) right += 1;
    if (right >= sourceDays.length) result[index] = sourceValues[sourceValues.length - 1];
    else if (day <= sourceDays[0]) result[index] = sourceValues[0];
    else {
      const left = right - 1;
      const span = sourceDays[right] - sourceDays[left];
      const ratio = span === 0 ? 0 : (day - sourceDays[left]) / span;
      result[index] = f32(sourceValues[left] + ratio * (sourceValues[right] - sourceValues[left]));
    }
  }
  return result;
}

export function savgolFilter9x3(values: Float32Array) {
  if (values.length < 9) throw new Error("SG 平滑要求至少 9 个标准节点。");
  const result = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    const windowStart = index < 4 ? 0 : index >= values.length - 4 ? values.length - 9 : index - 4;
    const coefficientRow = index < 4 ? index : index >= values.length - 4 ? 9 - (values.length - index) : 4;
    let sum = 0;
    for (let offset = 0; offset < 9; offset += 1) {
      sum += sgCoefficients[coefficientRow][offset] * values[windowStart + offset];
    }
    result[index] = f32(sum);
  }
  return result;
}

function normalizeRow(values: Float32Array) {
  let mean = 0;
  for (const value of values) mean += value;
  mean = f32(mean / values.length);
  let variance = 0;
  for (const value of values) {
    const centered = f32(value - mean);
    variance += f32(centered * centered);
  }
  const standardDeviation = f32(Math.sqrt(variance / values.length));
  const result = new Float32Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    result[index] = f32(f32(values[index] - mean) / f32(standardDeviation + 1e-5));
  }
  return result;
}

function physicalFeatures(values: Float32Array, years: Float32Array, velocity: number, coherence: number) {
  const count = values.length;
  const third = Math.max(Math.floor(count / 3), 5);
  const duration = Math.max(years[count - 1] - years[0], 1e-6);
  const fullSlope = slope(years, values);
  const earlySlope = slope(years, values, 0, third);
  const lateSlope = slope(years, values, count - third, count);
  let rateJump = 0;
  let curvatureSum = 0;
  let residualMean = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  let monotonic = 0;
  const rates = new Float32Array(count - 1);
  for (let index = 0; index < count; index += 1) {
    minimum = Math.min(minimum, values[index]);
    maximum = Math.max(maximum, values[index]);
    const fitted = f32(values[0] + fullSlope * years[index]);
    residualMean += f32(values[index] - fitted);
    if (index < count - 1) {
      if (values[index + 1] - values[index] <= 0) monotonic += 1;
      rates[index] = f32((values[index + 1] - values[index]) / Math.max(years[index + 1] - years[index], 1e-5));
    }
  }
  residualMean = f32(residualMean / count);
  let residualVariance = 0;
  for (let index = 0; index < count; index += 1) {
    const fitted = f32(values[0] + fullSlope * years[index]);
    const centered = f32(f32(values[index] - fitted) - residualMean);
    residualVariance += f32(centered * centered);
  }
  for (let index = 0; index < rates.length - 1; index += 1) {
    const difference = f32(rates[index + 1] - rates[index]);
    rateJump = Math.max(rateJump, Math.abs(difference));
    curvatureSum += f32(difference * difference);
  }
  const raw = new Float32Array([
    f32(values[count - 1] - values[0]),
    fullSlope,
    earlySlope,
    lateSlope,
    f32((lateSlope - earlySlope) / duration),
    f32(rateJump),
    f32(Math.sqrt(curvatureSum / (rates.length - 1))),
    f32(Math.sqrt(residualVariance / count)),
    f32(maximum - minimum),
    f32(monotonic / (count - 1)),
    f32(Math.abs(lateSlope) / (Math.abs(earlySlope) + 0.5)),
    f32(velocity),
    f32(coherence),
  ]);
  const scaled = new Float32Array(13);
  for (let index = 0; index < scaled.length; index += 1) {
    scaled[index] = f32(Math.max(-8, Math.min(8, f32(f32(raw[index] - scalerCenter[index]) / scalerScale[index]))));
  }
  return scaled;
}

export function preprocessTimeSeries(input: {
  sourceDays: Float32Array;
  sourceValues: Float32Array;
  targetDays: Float32Array;
  years: Float32Array;
  velocity: number;
  coherence: number;
  preprocessingState: PascLocalSettings["preprocessingState"];
}) {
  const adapted = interpolate(input.sourceDays, input.sourceValues, input.targetDays);
  const processed = input.preprocessingState === "raw" ? savgolFilter9x3(adapted) : adapted;
  return {
    normalizedSeries: normalizeRow(processed),
    scaledPhysics: physicalFeatures(processed, input.years, input.velocity, input.coherence),
    processedSeries: processed,
  };
}

type CsvDescriptor = {
  idIndex: number;
  longitudeIndex: number;
  latitudeIndex: number;
  velocityIndex: number;
  coherenceIndex: number;
  dateGroups: Array<{ timestamp: number; indices: number[] }>;
  targetDays: Float32Array;
  dates: string[];
  years: Float32Array;
  insertedEpochs: number;
};

function buildDescriptor(headers: string[]): CsvDescriptor {
  const idIndex = headers.indexOf(resolvePascField(headers, "point_id").field);
  const longitudeIndex = headers.indexOf(resolvePascField(headers, "longitude").field);
  const latitudeIndex = headers.indexOf(resolvePascField(headers, "latitude").field);
  const velocityIndex = headers.indexOf(resolvePascField(headers, "velocity").field);
  const coherenceIndex = headers.indexOf(resolvePascField(headers, "coherence").field);
  if (longitudeIndex < 0 || latitudeIndex < 0) throw new Error("无法自动识别经度和纬度字段。");
  const grouped = new Map<number, number[]>();
  headers.forEach((header, index) => {
    const parsed = parsePascDateHeader(header);
    if (parsed) grouped.set(parsed.timestamp, [...(grouped.get(parsed.timestamp) ?? []), index]);
  });
  const dateGroups = [...grouped.entries()].sort((left, right) => left[0] - right[0]).map(([timestamp, indices]) => ({ timestamp, indices }));
  if (dateGroups.length < 20) throw new Error("本地 PASC 分析至少需要 20 个可解析日期字段。");
  const origin = dateGroups[0].timestamp;
  const target: number[] = [0];
  let insertedEpochs = 0;
  for (let index = 0; index < dateGroups.length - 1; index += 1) {
    const left = Math.round((dateGroups[index].timestamp - origin) / 86_400_000);
    const right = Math.round((dateGroups[index + 1].timestamp - origin) / 86_400_000);
    for (let candidate = left + 12; candidate < right; candidate += 12) {
      target.push(candidate);
      insertedEpochs += 1;
    }
    target.push(right);
  }
  const targetDays = Float32Array.from(target);
  const years = Float32Array.from(target, day => f32(day / 365.25));
  const dates = target.map(day => new Date(origin + day * 86_400_000).toISOString().slice(0, 10));
  return { idIndex, longitudeIndex, latitudeIndex, velocityIndex, coherenceIndex, dateGroups, targetDays, dates, years, insertedEpochs };
}

async function streamCsvRows(
  file: File,
  onRow: (row: string[], rowNumber: number) => boolean | void | Promise<boolean | void>,
  onBytes: (bytes: number) => void,
  isCancelled: () => boolean,
  chunkBytes = PASC_LOCAL_STREAM_CHUNK_BYTES,
) {
  const decoder = new TextDecoder();
  let field = "";
  let row: string[] = [];
  let rowNumber = 0;
  let inQuotes = false;
  let quotePending = false;
  let bytes = 0;
  const emitRow = () => {
    row.push(field);
    field = "";
    const emitted = row.some(value => value.trim() !== "") ? onRow(row, rowNumber++) : undefined;
    row = [];
    return emitted;
  };
  let stopped = false;
  const consume = async (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      if (isCancelled()) throw new DOMException("cancelled", "AbortError");
      const character = text[index];
      if (quotePending) {
        quotePending = false;
        if (character === '"') { field += '"'; continue; }
        inQuotes = false;
      }
      if (character === '"') {
        if (!inQuotes) inQuotes = true;
        else if (index + 1 < text.length) {
          if (text[index + 1] === '"') { field += '"'; index += 1; }
          else inQuotes = false;
        } else quotePending = true;
      } else if (character === "," && !inQuotes) {
        row.push(field);
        field = "";
      } else if ((character === "\n" || character === "\r") && !inQuotes) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        const emitted = emitRow();
        const shouldContinue = emitted instanceof Promise ? await emitted : emitted;
        if (shouldContinue === false) { stopped = true; return; }
      } else field += character;
    }
  };
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    if (isCancelled()) throw new DOMException("cancelled", "AbortError");
    const end = Math.min(file.size, offset + chunkBytes);
    const value = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    bytes = end;
    await consume(decoder.decode(value, { stream: true }));
    if (stopped) break;
    onBytes(bytes);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  if (!stopped) await consume(decoder.decode());
  if (quotePending) { quotePending = false; inQuotes = false; }
  if (inQuotes) throw new Error("CSV 格式错误：引号未闭合。");
  if (!stopped && (field || row.length)) {
    const emitted = emitRow();
    if (emitted) await emitted;
  }
}

export type PascLocalStreamSummary = {
  totalRows: number;
  invalidRows: number;
  validRows: number;
  dates: string[];
  timeSteps: number;
  sourceEpochs: number;
  insertedEpochs: number;
  csvParsingMs: number;
  preprocessingMs: number;
};

export async function streamAndPreprocessLocalCsvBatches(
  file: File,
  settings: PascLocalSettings,
  batchRows: number,
  onBatch: (batch: PascLocalPreparedData) => Promise<void>,
  onProgress: PascLocalProgress,
  isCancelled: () => boolean,
  chunkBytes = PASC_LOCAL_STREAM_CHUNK_BYTES,
): Promise<PascLocalStreamSummary> {
  if (!Number.isInteger(batchRows) || batchRows < 1) throw new Error("本地流式 batch 必须为正整数。");
  const startedAt = performance.now();
  let preprocessingMs = 0;
  let batchCallbackMs = 0;
  let descriptor: CsvDescriptor | null = null;
  let totalRows = 0;
  let invalidRows = 0;
  let validRows = 0;
  const displacementFactor = settings.displacementUnit === "m" ? 1000 : settings.displacementUnit === "cm" ? 10 : 1;
  const velocityFactor = settings.velocityUnit === "m/year" ? 1000 : settings.velocityUnit === "cm/year" ? 10 : 1;
  const signFactor = settings.signConvention === "subsidence_positive" ? -1 : 1;
  let pointIds: string[] = [];
  let longitude: number[] = [];
  let latitude: number[] = [];
  let velocity: number[] = [];
  let velocityProvided: number[] = [];
  let coherence: number[] = [];
  let coherenceProvided: number[] = [];
  let missingRate: number[] = [];
  let series: Float32Array[] = [];
  let displacement: Float32Array[] = [];
  let physics: Float32Array[] = [];

  const reset = () => {
    pointIds = []; longitude = []; latitude = []; velocity = []; velocityProvided = [];
    coherence = []; coherenceProvided = []; missingRate = []; series = []; displacement = []; physics = [];
  };
  const flush = async () => {
    const activeDescriptor = descriptor;
    if (!activeDescriptor || !pointIds.length) return;
    const count = pointIds.length;
    const normalized = new Float32Array(count * activeDescriptor.targetDays.length);
    const processed = new Float32Array(count * activeDescriptor.targetDays.length);
    const physical = new Float32Array(count * 13);
    for (let index = 0; index < count; index += 1) {
      normalized.set(series[index], index * activeDescriptor.targetDays.length);
      processed.set(displacement[index], index * activeDescriptor.targetDays.length);
      physical.set(physics[index], index * 13);
    }
    const batch: PascLocalPreparedData = {
      pointIds,
      longitude: Float32Array.from(longitude),
      latitude: Float32Array.from(latitude),
      velocity: Float32Array.from(velocity),
      velocityProvided: Uint8Array.from(velocityProvided),
      coherence: Float32Array.from(coherence),
      coherenceProvided: Uint8Array.from(coherenceProvided),
      missingRate: Float32Array.from(missingRate),
      series: normalized,
      displacementSeries: processed,
      physics: physical,
      dates: activeDescriptor.dates,
      timeSteps: activeDescriptor.targetDays.length,
      totalRows: count,
      invalidRows: 0,
      sourceEpochs: activeDescriptor.dateGroups.length,
      insertedEpochs: activeDescriptor.insertedEpochs,
      csvParsingMs: 0,
      preprocessingMs: 0,
    };
    reset();
    const callbackStartedAt = performance.now();
    await onBatch(batch);
    batchCallbackMs += performance.now() - callbackStartedAt;
  };

  await streamCsvRows(file, (cells, rowNumber) => {
    if (rowNumber === 0) {
      cells[0] = cells[0].replace(/^\uFEFF/, "");
      descriptor = buildDescriptor(cells);
      return;
    }
    totalRows += 1;
    const activeDescriptor = descriptor as CsvDescriptor | null;
    if (!activeDescriptor) throw new Error("CSV 缺少标题行。");
    const lon = finite(cells[activeDescriptor.longitudeIndex]);
    const lat = finite(cells[activeDescriptor.latitudeIndex]);
    if (lon === null || lat === null || lon < -180 || lon > 180 || lat < -90 || lat > 90 || (lon === 0 && lat === 0)) {
      invalidRows += 1;
      return;
    }
    const sourceDays: number[] = [];
    const sourceValues: number[] = [];
    const origin = activeDescriptor.dateGroups[0].timestamp;
    for (const group of activeDescriptor.dateGroups) {
      const values = group.indices.map(index => finite(cells[index])).filter((value): value is number => value !== null);
      if (new Set(values.map(value => value.toPrecision(14))).size > 1) throw new Error(`第 ${rowNumber + 1} 行存在同日重复字段冲突。`);
      if (values.length) {
        sourceDays.push(Math.round((group.timestamp - origin) / 86_400_000));
        sourceValues.push(f32(values[0] * displacementFactor * signFactor));
      }
    }
    if (sourceValues.length < 20) {
      invalidRows += 1;
      return;
    }
    let rate = finite(cells[activeDescriptor.velocityIndex]);
    const hasVelocity = rate !== null;
    if (rate === null) rate = slope(Float32Array.from(sourceDays, day => f32(day / 365.25)), Float32Array.from(sourceValues));
    else rate = f32(rate * velocityFactor * signFactor);
    const rawCoherence = finite(cells[activeDescriptor.coherenceIndex]);
    const rowCoherence = Math.max(0, Math.min(1, rawCoherence ?? 0.5));
    const rowStartedAt = performance.now();
    const rowResult = preprocessTimeSeries({
      sourceDays: Float32Array.from(sourceDays),
      sourceValues: Float32Array.from(sourceValues),
      targetDays: activeDescriptor.targetDays,
      years: activeDescriptor.years,
      velocity: rate,
      coherence: rowCoherence,
      preprocessingState: settings.preprocessingState,
    });
    preprocessingMs += performance.now() - rowStartedAt;
    pointIds.push(activeDescriptor.idIndex >= 0 && cells[activeDescriptor.idIndex]?.trim() ? cells[activeDescriptor.idIndex].trim() : String(validRows + 1));
    longitude.push(lon); latitude.push(lat); velocity.push(rate); velocityProvided.push(hasVelocity ? 1 : 0);
    coherence.push(rowCoherence); coherenceProvided.push(rawCoherence === null ? 0 : 1);
    missingRate.push(1 - sourceValues.length / activeDescriptor.dateGroups.length);
    series.push(rowResult.normalizedSeries); displacement.push(rowResult.processedSeries); physics.push(rowResult.scaledPhysics);
    validRows += 1;
    if (pointIds.length >= batchRows) return flush();
  }, bytes => onProgress(Math.min(0.995, bytes / Math.max(file.size, 1)), `已流式读取 ${(bytes / 1_048_576).toFixed(1)} MB`), isCancelled, chunkBytes);
  await flush();
  const completedDescriptor = descriptor as CsvDescriptor | null;
  if (!completedDescriptor) throw new Error("CSV 缺少标题行。");
  if (!validRows) throw new Error("没有可用于本地 PASC 分析的有效监测点。");
  const elapsed = performance.now() - startedAt;
  return {
    totalRows,
    invalidRows,
    validRows,
    dates: completedDescriptor.dates,
    timeSteps: completedDescriptor.targetDays.length,
    sourceEpochs: completedDescriptor.dateGroups.length,
    insertedEpochs: completedDescriptor.insertedEpochs,
    csvParsingMs: Math.max(0, elapsed - preprocessingMs - batchCallbackMs),
    preprocessingMs,
  };
}

export async function parseAndPreprocessLocalCsv(
  file: File,
  settings: PascLocalSettings,
  onProgress: PascLocalProgress,
  isCancelled: () => boolean,
  maxPoints?: number,
): Promise<PascLocalPreparedData> {
  const parsingStartedAt = performance.now();
  let preprocessingMs = 0;
  let descriptor: CsvDescriptor | null = null;
  const pointIds: string[] = [];
  const longitudeBlocks: number[] = [];
  const latitudeBlocks: number[] = [];
  const velocityBlocks: number[] = [];
  const velocityProvidedBlocks: number[] = [];
  const coherenceBlocks: number[] = [];
  const coherenceProvidedBlocks: number[] = [];
  const missingRateBlocks: number[] = [];
  const seriesBlocks: Float32Array[] = [];
  const displacementBlocks: Float32Array[] = [];
  const physicsBlocks: Float32Array[] = [];
  let totalRows = 0;
  let invalidRows = 0;
  const displacementFactor = settings.displacementUnit === "m" ? 1000 : settings.displacementUnit === "cm" ? 10 : 1;
  const velocityFactor = settings.velocityUnit === "m/year" ? 1000 : settings.velocityUnit === "cm/year" ? 10 : 1;
  const signFactor = settings.signConvention === "subsidence_positive" ? -1 : 1;

  await streamCsvRows(file, (cells, rowNumber) => {
    if (rowNumber === 0) {
      cells[0] = cells[0].replace(/^\uFEFF/, "");
      descriptor = buildDescriptor(cells);
      return;
    }
    totalRows += 1;
    const activeDescriptor = descriptor as CsvDescriptor | null;
    if (!activeDescriptor) throw new Error("CSV 缺少标题行。");
    const longitude = finite(cells[activeDescriptor.longitudeIndex]);
    const latitude = finite(cells[activeDescriptor.latitudeIndex]);
    if (longitude === null || latitude === null || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 || (longitude === 0 && latitude === 0)) {
      invalidRows += 1;
      return;
    }
    const sourceDays: number[] = [];
    const sourceValues: number[] = [];
    const origin = activeDescriptor.dateGroups[0].timestamp;
    for (const group of activeDescriptor.dateGroups) {
      const values = group.indices.map(index => finite(cells[index])).filter((value): value is number => value !== null);
      if (new Set(values.map(value => value.toPrecision(14))).size > 1) throw new Error(`第 ${rowNumber + 1} 行存在同日重复字段冲突。`);
      if (values.length) {
        sourceDays.push(Math.round((group.timestamp - origin) / 86_400_000));
        sourceValues.push(f32(values[0] * displacementFactor * signFactor));
      }
    }
    if (sourceValues.length < 20) {
      invalidRows += 1;
      return;
    }
    let velocity = finite(cells[activeDescriptor.velocityIndex]);
    const velocityProvided = velocity !== null;
    if (velocity === null) velocity = slope(Float32Array.from(sourceDays, day => f32(day / 365.25)), Float32Array.from(sourceValues));
    else velocity = f32(velocity * velocityFactor * signFactor);
    const rawCoherence = finite(cells[activeDescriptor.coherenceIndex]);
    const coherence = Math.max(0, Math.min(1, rawCoherence ?? 0.5));
    const rowPreprocessingStartedAt = performance.now();
    const result = preprocessTimeSeries({
      sourceDays: Float32Array.from(sourceDays),
      sourceValues: Float32Array.from(sourceValues),
      targetDays: activeDescriptor.targetDays,
      years: activeDescriptor.years,
      velocity,
      coherence,
      preprocessingState: settings.preprocessingState,
    });
    preprocessingMs += performance.now() - rowPreprocessingStartedAt;
    pointIds.push(activeDescriptor.idIndex >= 0 && cells[activeDescriptor.idIndex]?.trim() ? cells[activeDescriptor.idIndex].trim() : String(pointIds.length + 1));
    longitudeBlocks.push(longitude);
    latitudeBlocks.push(latitude);
    velocityBlocks.push(velocity);
    velocityProvidedBlocks.push(velocityProvided ? 1 : 0);
    coherenceBlocks.push(coherence);
    coherenceProvidedBlocks.push(rawCoherence === null ? 0 : 1);
    missingRateBlocks.push(1 - sourceValues.length / activeDescriptor.dateGroups.length);
    seriesBlocks.push(result.normalizedSeries);
    displacementBlocks.push(result.processedSeries);
    physicsBlocks.push(result.scaledPhysics);
    if (maxPoints && pointIds.length >= maxPoints) return false;
  }, bytes => onProgress(Math.min(0.98, bytes / Math.max(file.size, 1)), `已读取 ${(bytes / 1_048_576).toFixed(1)} MB`), isCancelled);

  const streamElapsedMs = performance.now() - parsingStartedAt;
  const streamingPreprocessingMs = preprocessingMs;
  const completedDescriptor = descriptor as CsvDescriptor | null;
  if (!completedDescriptor) throw new Error("CSV 缺少标题行。");
  if (!pointIds.length) throw new Error("没有可用于本地 PASC 分析的有效监测点。");
  onProgress(1, maxPoints && pointIds.length >= maxPoints ? `快速验证已取得前 ${pointIds.length.toLocaleString()} 个有效点` : `已预处理 ${pointIds.length.toLocaleString()} 个有效点`);
  const assemblyStartedAt = performance.now();
  const series = new Float32Array(pointIds.length * completedDescriptor.targetDays.length);
  const displacementSeries = new Float32Array(pointIds.length * completedDescriptor.targetDays.length);
  const physics = new Float32Array(pointIds.length * 13);
  seriesBlocks.forEach((values, index) => series.set(values, index * completedDescriptor.targetDays.length));
  displacementBlocks.forEach((values, index) => displacementSeries.set(values, index * completedDescriptor.targetDays.length));
  physicsBlocks.forEach((values, index) => physics.set(values, index * 13));
  preprocessingMs += performance.now() - assemblyStartedAt;
  return {
    pointIds,
    longitude: Float32Array.from(longitudeBlocks),
    latitude: Float32Array.from(latitudeBlocks),
    velocity: Float32Array.from(velocityBlocks),
    velocityProvided: Uint8Array.from(velocityProvidedBlocks),
    coherence: Float32Array.from(coherenceBlocks),
    coherenceProvided: Uint8Array.from(coherenceProvidedBlocks),
    missingRate: Float32Array.from(missingRateBlocks),
    series,
    displacementSeries,
    physics,
    dates: completedDescriptor.dates,
    timeSteps: completedDescriptor.targetDays.length,
    totalRows,
    invalidRows,
    sourceEpochs: completedDescriptor.dateGroups.length,
    insertedEpochs: completedDescriptor.insertedEpochs,
    csvParsingMs: Math.max(0, streamElapsedMs - streamingPreprocessingMs),
    preprocessingMs,
  };
}
