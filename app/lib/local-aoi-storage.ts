import type { AoiSeries } from "./aoi-analysis";
import { aggregateLocalMatrix, type LocalAoiRequest } from "./local-analysis-compute";
import { localSeriesRecordBytes } from "./local-series-store";
const DEFAULT_MATRIX_BUDGET = 32 * 1024 * 1024;
export function validateStoredAoi(input: LocalAoiRequest, file: Blob) {
  const storage = input.storage;
  if (!storage || ![storage.pointCount, storage.timeSteps, storage.observedEpochs, storage.recordBytes].every(value => Number.isSafeInteger(value) && value > 0)
    || storage.recordBytes !== localSeriesRecordBytes(storage.timeSteps, storage.observedEpochs)
    || (input.kind === "observed" ? storage.observedEpochs : storage.timeSteps) !== input.dates.length || input.rows.length !== input.modes.length
    || !Number.isSafeInteger(storage.pointCount * storage.recordBytes) || file.size !== storage.pointCount * storage.recordBytes)
    throw new Error("本地时序文件、日期轴或存储布局不匹配，请重新导入。");
  const destinations = new Int32Array(storage.pointCount).fill(-1);
  input.rows.forEach((row, destination) => {
    if (row >= storage.pointCount || destinations[row] >= 0) throw new Error("区域点位索引失效或重复。");
    destinations[row] = destination;
  });
  return { storage, destinations };
}
/** Every selected row participates; date blocks bound median memory without sampling. */
export async function aggregateStoredAoi(input: LocalAoiRequest, file: Blob, matrixBudgetBytes = DEFAULT_MATRIX_BUDGET): Promise<AoiSeries> {
  const { storage, destinations } = validateStoredAoi(input, file);
  if (!input.rows.length) return { dates: input.dates, overall: input.dates.map(() => null), groups: [] };
  const epochs = input.kind === "observed" ? storage.observedEpochs : storage.timeSteps;
  const observed = input.kind === "observed";
  const rowsPerChunk = Math.max(1, Math.floor(4 * 1024 * 1024 / storage.recordBytes));
  const scan = async (consume: (values: Int32Array | Float32Array, destination: number) => void) => {
    for (let start = 0; start < storage.pointCount; start += rowsPerChunk) {
      const end = Math.min(storage.pointCount, start + rowsPerChunk);
      let needed = false;
      for (let row = start; row < end; row += 1) if (destinations[row] >= 0) { needed = true; break; }
      if (!needed) continue;
      const buffer = await file.slice(start * storage.recordBytes, end * storage.recordBytes).arrayBuffer();
      for (let row = start; row < end; row += 1) {
        const destination = destinations[row]; if (destination < 0) continue;
        const offset = (row - start) * storage.recordBytes;
        if (observed) {
          const values = new Float32Array(buffer, offset + storage.timeSteps * 4, storage.observedEpochs);
          const mask = new Uint8Array(buffer, offset + (storage.timeSteps + storage.observedEpochs) * 4, storage.observedEpochs);
          for (let step = 0; step < epochs; step += 1) if (!mask[step]) values[step] = NaN;
          consume(values, destination);
        } else consume(new Int32Array(buffer, offset, storage.timeSteps), destination);
      }
    }
  };
  if (input.method === "mean") {
    const modes = [...new Set(input.modes)], groupByMode = new Map(modes.map((mode, index) => [mode, index]));
    const rowGroups = Int32Array.from(input.modes, mode => groupByMode.get(mode)!);
    const counts = new Uint32Array(modes.length); for (const group of rowGroups) counts[group] += 1;
    const sums = new Float64Array((modes.length + 1) * epochs), valid = new Uint32Array(sums.length);
    await scan((values, row) => {
      const groupOffset = (rowGroups[row] + 1) * epochs;
      for (let step = 0; step < epochs; step += 1) {
        const value = observed ? values[step] : values[step] === -2_147_483_648 ? NaN : Math.fround(values[step] / 10);
        if (!Number.isFinite(value)) continue;
        sums[step] += value; valid[step] += 1; sums[groupOffset + step] += value; valid[groupOffset + step] += 1;
      }
    });
    const valuesAt = (offset: number) => input.dates.map((_, step) => valid[offset + step] ? sums[offset + step] / valid[offset + step] : null);
    return { dates: input.dates, overall: valuesAt(0), groups: modes.map((mode, index) => ({ mode, pointCount: counts[index], values: valuesAt((index + 1) * epochs) })) };
  }
  if (!Number.isFinite(matrixBudgetBytes) || matrixBudgetBytes <= 0) throw new Error("区域计算内存预算无效。");
  const datesPerBlock = Math.max(1, Math.min(epochs, Math.floor(matrixBudgetBytes / (input.rows.length * 4))));
  const combined: AoiSeries = { dates: input.dates, overall: [], groups: [] };
  for (let first = 0; first < epochs; first += datesPerBlock) {
    const last = Math.min(epochs, first + datesPerBlock), width = last - first;
    const matrix = new Float32Array(input.rows.length * width);
    await scan((values, row) => {
      for (let step = first; step < last; step += 1) matrix[row * width + step - first] = observed ? values[step] : values[step] === -2_147_483_648 ? NaN : values[step] / 10;
    });
    const block = aggregateLocalMatrix(matrix, input.modes, input.dates.slice(first, last), "median");
    combined.overall.push(...block.overall);
    if (first === 0) combined.groups = block.groups;
    else block.groups.forEach((group, index) => combined.groups[index].values.push(...group.values));
  }
  return combined;
}
