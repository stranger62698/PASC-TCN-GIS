import type { PascLocalCompletePayload, PascLocalSeriesStorage } from "./pasc-local-worker-protocol";

export type LocalSeriesKind = "processed" | "observed";
export type LocalSeriesRow = { processed: number[]; observed: number[]; mask: Uint8Array };
export type LocalSeriesStore = {
  kind: "memory" | "opfs";
  readonly storage?: PascLocalSeriesStorage;
  pointCount: number;
  timeSteps: number;
  observedEpochs: number;
  view: (row: number, kind?: LocalSeriesKind) => number[];
  maskView: (row: number) => ArrayLike<number>;
  readRow: (row: number) => Promise<LocalSeriesRow>;
  readColumn: (index: number, kind?: LocalSeriesKind) => Promise<Float32Array>;
  readStageVelocity: (start: number, end: number, dates: string[], isCancelled?: () => boolean) => Promise<Float64Array>;
  hasRow: (row: number) => boolean;
  clear: () => void;
};

/** Array-compatible read-only view. No per-point numeric backing array is allocated. */
export function numericSeriesView(length: number, valueAt: (index: number) => number): number[] {
  const indexOf = (key: PropertyKey) => typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) ? Number(key) : -1;
  return new Proxy([] as number[], {
    get(target, key, receiver) {
      if (key === "length") return length;
      const index = indexOf(key);
      if (index >= 0) return index < length ? valueAt(index) : undefined;
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      const index = indexOf(key);
      return index >= 0 ? index < length : Reflect.has(target, key);
    },
    set() { throw new Error("本地时序视图只读。"); },
    deleteProperty() { throw new Error("本地时序视图只读。"); },
  });
}

export function localSeriesRecordBytes(timeSteps: number, observedEpochs: number) {
  return Math.ceil((timeSteps * 4 + observedEpochs * 5) / 4) * 4;
}

/** Fixed-size row records make point and date access independent of CSV quoting/row length. */
export function encodeLocalSeriesRows(processed: Float32Array, observed: Float32Array, mask: Uint8Array, count: number, timeSteps: number, observedEpochs: number) {
  const stride = localSeriesRecordBytes(timeSteps, observedEpochs);
  const buffer = new ArrayBuffer(count * stride);
  for (let row = 0; row < count; row += 1) {
    const offset = row * stride;
    const encodedSeries = new Int32Array(buffer, offset, timeSteps);
    for (let step = 0; step < timeSteps; step += 1) {
      const value = processed[row * timeSteps + step];
      if (!Number.isFinite(value)) { encodedSeries[step] = -2_147_483_648; continue; }
      const encoded = Math.round(value * 10);
      if (encoded <= -2_147_483_648 || encoded > 2_147_483_647) throw new Error("形变值超出一位小数量化范围。");
      encodedSeries[step] = encoded;
    }
    new Float32Array(buffer, offset + timeSteps * 4, observedEpochs).set(observed.subarray(row * observedEpochs, (row + 1) * observedEpochs));
    new Uint8Array(buffer, offset + (timeSteps + observedEpochs) * 4, observedEpochs).set(mask.subarray(row * observedEpochs, (row + 1) * observedEpochs));
  }
  return new Uint8Array(buffer);
}

async function readOpfsFile(storage: PascLocalSeriesStorage): Promise<Blob> {
  if (!navigator.storage?.getDirectory) throw new Error("浏览器本地时序存储不可用。");
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle(storage.directory);
  return (await folder.getFileHandle(storage.fileName)).getFile();
}

export function createLocalSeriesStore(result: PascLocalCompletePayload, loadFile: (storage: PascLocalSeriesStorage) => Promise<Blob> = readOpfsFile): LocalSeriesStore {
  const storage = result.seriesStorage;
  const count = result.pointIds.length;
  const epochs = result.observedDates?.length ?? 0;
  if (storage && (storage.pointCount !== count || storage.timeSteps !== result.timeSteps || storage.observedEpochs !== epochs || storage.recordBytes !== localSeriesRecordBytes(result.timeSteps, epochs))) {
    throw new Error("本地时序存储与点位/日期契约不一致。");
  }
  const rows = new Map<number, LocalSeriesRow>();
  const columns = new Map<string, Float32Array>();
  const pendingRows = new Map<number, Promise<LocalSeriesRow>>();
  let generation = 0;
  const checkGeneration = (expected: number) => {
    if (expected !== generation) throw new DOMException("本地时序缓存已清理，请重新读取。", "AbortError");
  };
  let file: Promise<Blob> | null = null;
  const getFile = () => {
    if (file) return file;
    const loading = loadFile(storage!).then(source => {
      if (source.size !== storage!.pointCount * storage!.recordBytes) throw new Error("本地时序文件损坏或已被浏览器清理。");
      return source;
    }).catch(error => { if (file === loading) file = null; throw error; });
    file = loading;
    return loading;
  };
  const processedValue = (value: number) => value === -2_147_483_648 ? NaN : value / 10;
  const value = (row: number, index: number, kind: LocalSeriesKind) => {
    if (!storage) return kind === "observed" ? (result.observedSeries?.[row * epochs + index] ?? NaN) : processedValue(result.displacementSeries[row * result.timeSteps + index]);
    const loaded = rows.get(row);
    if (loaded) return loaded[kind][index];
    const column = columns.get(kind + ":" + index);
    if (column) return column[row];
    if (kind === "observed" && index === epochs - 1) return result.observedDisplacement?.[row] ?? NaN;
    if (kind === "processed" && index === result.timeSteps - 1) return result.processedDisplacement?.[row] ?? NaN;
    return NaN;
  };
  const checkRow = (row: number) => { if (!Number.isInteger(row) || row < 0 || row >= count) throw new Error("本地时序点位索引无效。"); };
  const readRow = async (row: number): Promise<LocalSeriesRow> => {
    checkRow(row);
    if (rows.has(row)) return rows.get(row)!;
    if (pendingRows.has(row)) return pendingRows.get(row)!;
    const requestGeneration = generation;
    const read = (async () => {
      let loaded: LocalSeriesRow;
      if (!storage) loaded = {
        processed: Array.from({ length: result.timeSteps }, (_, index) => value(row, index, "processed")),
        observed: Array.from({ length: epochs }, (_, index) => value(row, index, "observed")),
        mask: result.observedMask?.slice(row * epochs, (row + 1) * epochs) ?? new Uint8Array(epochs),
      };
      else {
        const source = await getFile();
        checkGeneration(requestGeneration);
        const buffer = await source.slice(row * storage.recordBytes, (row + 1) * storage.recordBytes).arrayBuffer();
        checkGeneration(requestGeneration);
        if (buffer.byteLength !== storage.recordBytes) throw new Error("本地时序记录损坏或已被浏览器清理。");
        loaded = {
          processed: Array.from(new Int32Array(buffer, 0, storage.timeSteps), processedValue),
          observed: Array.from(new Float32Array(buffer, storage.timeSteps * 4, storage.observedEpochs)),
          mask: new Uint8Array(buffer, (storage.timeSteps + storage.observedEpochs) * 4, storage.observedEpochs).slice(),
        };
      }
      if (rows.size >= 64) rows.delete(rows.keys().next().value!);
      rows.set(row, loaded);
      return loaded;
    })();
    pendingRows.set(row, read);
    try { return await read; } finally { if (pendingRows.get(row) === read) pendingRows.delete(row); }
  };
  return {
    kind: storage ? "opfs" : "memory", storage, pointCount: count, timeSteps: result.timeSteps, observedEpochs: epochs,
    view(row, kind = "processed") {
      checkRow(row);
      return numericSeriesView(kind === "observed" ? epochs : result.timeSteps, index => value(row, index, kind));
    },
    maskView(row) {
      checkRow(row);
      return numericSeriesView(epochs, index => {
        if (!storage) return result.observedMask?.[row * epochs + index] ?? NaN;
        const loaded = rows.get(row); if (loaded) return loaded.mask[index];
        const column = columns.get("observed:" + index);
        if (column) return Number.isFinite(column[row]) ? 1 : 0;
        if (index === epochs - 1 && result.observedDisplacement) return Number.isFinite(result.observedDisplacement[row]) ? 1 : 0;
        return NaN; // Unloaded is unknown, not a source missing-observation assertion.
      });
    },
    readRow,
    async readColumn(index, kind = "observed") {
      const length = kind === "observed" ? epochs : result.timeSteps;
      if (!Number.isInteger(index) || index < 0 || index >= length) throw new Error("本地时序日期索引无效。");
      const key = kind + ":" + index;
      if (columns.has(key)) return columns.get(key)!;
      const requestGeneration = generation;
      const output = new Float32Array(count);
      if (!storage) {
        for (let row = 0; row < count; row += 1) output[row] = value(row, index, kind);
      } else {
        const source = await getFile();
        checkGeneration(requestGeneration);
        const batchRows = Math.max(1, Math.floor(4 * 1024 * 1024 / storage.recordBytes));
        for (let start = 0; start < count; start += batchRows) {
          const end = Math.min(count, start + batchRows);
          const buffer = await source.slice(start * storage.recordBytes, end * storage.recordBytes).arrayBuffer();
          checkGeneration(requestGeneration);
          if (buffer.byteLength !== (end - start) * storage.recordBytes) throw new Error("本地时序记录损坏或已被浏览器清理。");
          const data = new DataView(buffer);
          for (let row = start; row < end; row += 1) {
            const offset = (row - start) * storage.recordBytes;
            output[row] = kind === "processed" ? processedValue(data.getInt32(offset + index * 4, true))
              : data.getUint8(offset + (storage.timeSteps + storage.observedEpochs) * 4 + index) ? data.getFloat32(offset + storage.timeSteps * 4 + index * 4, true) : NaN;
          }
          await new Promise(resolve => setTimeout(resolve, 0));
          checkGeneration(requestGeneration);
        }
      }
      if (columns.size >= 3) columns.delete(columns.keys().next().value!);
      columns.set(key, output);
      return output;
    },
    async readStageVelocity(start, end, dates, isCancelled = () => false) {
      const requestGeneration = generation;
      if (!Number.isInteger(start) || !Number.isInteger(end) || dates.length !== result.timeSteps) throw new Error("阶段速率区间与日期轴不一致。");
      const first = Math.max(0, Math.min(start, end)), last = Math.min(result.timeSteps - 1, Math.max(start, end));
      const length = Math.max(0, last - first + 1), output = new Float64Array(count);
      // Keep slopePerYear's date scale, summation order and two-pass OLS formula.
      // The shared x terms can be computed once without changing the per-row statistic.
      const times = dates.slice(first, last + 1).map(date => Date.parse(date + "T00:00:00Z") / (365.25 * 86400000));
      if (length < 2 || times.some(time => !Number.isFinite(time))) return output;
      const meanTime = times.reduce((sum, time) => sum + time, 0) / length;
      const centered = times.map(time => time - meanTime);
      let denominator = 0;
      for (const time of centered) denominator += time ** 2;
      if (!denominator) return output;
      const scratch = new Float64Array(length);
      const computeRow = (row: number, read: (index: number) => number) => {
        let sum = 0;
        for (let index = 0; index < length; index += 1) { scratch[index] = read(first + index); sum += scratch[index]; }
        const meanValue = sum / length;
        let numerator = 0;
        for (let index = 0; index < length; index += 1) numerator += centered[index] * (scratch[index] - meanValue);
        output[row] = numerator / denominator;
      };
      const source = storage ? await getFile() : null;
      checkGeneration(requestGeneration);
      const batchRows = storage ? Math.max(1, Math.floor(4 * 1024 * 1024 / storage.recordBytes)) : 1024;
      for (let offset = 0; offset < count; offset += batchRows) {
        if (isCancelled()) throw new DOMException("已取消阶段速率计算。", "AbortError");
        checkGeneration(requestGeneration);
        const finish = Math.min(count, offset + batchRows);
        if (storage && source) {
          const buffer = await source.slice(offset * storage.recordBytes, finish * storage.recordBytes).arrayBuffer();
          checkGeneration(requestGeneration);
          if (buffer.byteLength !== (finish - offset) * storage.recordBytes) throw new Error("本地时序记录损坏或已被浏览器清理。");
          const data = new DataView(buffer);
          for (let row = offset; row < finish; row += 1) {
            const byteOffset = (row - offset) * storage.recordBytes;
            computeRow(row, index => processedValue(data.getInt32(byteOffset + index * 4, true)));
          }
        } else for (let row = offset; row < finish; row += 1) computeRow(row, index => value(row, index, "processed"));
        if (finish < count) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (isCancelled()) throw new DOMException("已取消阶段速率计算。", "AbortError");
      checkGeneration(requestGeneration);
      return output;
    },
    hasRow(row) { return !storage || rows.has(row); },
    clear() { generation += 1; rows.clear(); columns.clear(); pendingRows.clear(); file = null; },
  };
}
