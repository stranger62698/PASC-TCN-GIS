import { parsePascDateHeader } from "./pasc-schema";
import { normalizeLocalCsvHeaders, resolveLocalCsvFields, type PascLocalFieldMapping } from "./pasc-local-preprocess";
import { PASC_CLASSES } from "./pasc";
import type { PascLocalCompletePayload } from "./pasc-local-worker-protocol";

type ExportProgress = (progress: number, detail: string) => void;
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

type PredictionFields = [string, string, string, string, string, string];

const appendedHeaders = [
  "pasc_mode",
  "pasc_mode_name",
  "pasc_confidence",
  "pasc_spatial_reliability",
  "pasc_spatial_gate_mean",
  "pasc_spatial_reference",
  "pasc_status",
  "pasc_status_reason",
  "pasc_effective_observations",
];

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvLine(values: Array<string | number | null | undefined>) {
  return values.map(csvCell).join(",") + "\r\n";
}

async function* csvRows(file: File): AsyncGenerator<string[]> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let quotePending = false;
  let skipLineFeed = false;
  const ready: string[][] = [];
  const emit = () => {
    row.push(field);
    field = "";
    if (row.some(value => value.trim() !== "")) ready.push(row);
    row = [];
  };
  const consume = (text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === "\n") continue;
      }
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
        if (character === "\r") skipLineFeed = true;
        emit();
      } else {
        field += character;
      }
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consume(decoder.decode(value, { stream: true }));
      while (ready.length) yield ready.shift()!;
    }
    consume(decoder.decode());
    if (quotePending) { quotePending = false; inQuotes = false; }
    if (inQuotes) throw new Error("CSV 格式错误：引号未闭合。");
    if (field || row.length) emit();
    while (ready.length) yield ready.shift()!;
  } finally {
    reader.releaseLock();
  }
}

async function opfsResultFile(result: PascLocalCompletePayload) {
  if (!result.resultStorage) return null;
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle(result.resultStorage.directory);
  const handle = await folder.getFileHandle(result.resultStorage.fileName);
  return handle.getFile();
}

function sourceDescriptor(headers: string[], mapping?: PascLocalFieldMapping) {
  const cleanHeaders = normalizeLocalCsvHeaders(headers);
  const fields = resolveLocalCsvFields(cleanHeaders, mapping);
  const idIndex = cleanHeaders.indexOf(fields.point_id);
  const longitudeIndex = cleanHeaders.indexOf(fields.longitude);
  const latitudeIndex = cleanHeaders.indexOf(fields.latitude);
  if (longitudeIndex < 0 || latitudeIndex < 0) throw new Error("无法自动识别经度和纬度字段。");
  const groups = new Map<number, number[]>();
  cleanHeaders.forEach((header, index) => {
    const parsed = parsePascDateHeader(header);
    if (parsed) groups.set(parsed.timestamp, [...(groups.get(parsed.timestamp) ?? []), index]);
  });
  const dateGroups = [...groups.values()];
  if (dateGroups.length < 20) throw new Error("本地 PASC 分析至少需要 20 个可解析日期字段。");
  return { headers: cleanHeaders, idIndex, longitudeIndex, latitudeIndex, dateGroups };
}

function sourceRowState(cells: string[], descriptor: ReturnType<typeof sourceDescriptor>) {
  const longitude = cells[descriptor.longitudeIndex]?.trim() ? Number(cells[descriptor.longitudeIndex]) : NaN;
  const latitude = cells[descriptor.latitudeIndex]?.trim() ? Number(cells[descriptor.latitudeIndex]) : NaN;
  const coordinatesValid = Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90 && (longitude !== 0 || latitude !== 0);
  let effectiveEpochs = 0;
  for (const group of descriptor.dateGroups) {
    const values = group.map(index => cells[index]?.trim() ? Number(cells[index]) : NaN).filter(Number.isFinite);
    if (new Set(values.map(value => value.toPrecision(14))).size > 1) throw new Error("原始 CSV 存在同日重复字段冲突，已停止导出。");
    if (values.length) effectiveEpochs += 1;
  }
  const coordinateReason = !Number.isFinite(longitude) || !Number.isFinite(latitude)
    ? "coordinates_missing_or_non_numeric"
    : longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90
      ? "coordinates_out_of_range"
      : longitude === 0 && latitude === 0 ? "zero_coordinate_pair" : "";
  return { longitude, latitude, coordinatesValid, coordinateReason, effectiveEpochs, eligible: effectiveEpochs >= 20 };
}

function predictionFields(result: PascLocalCompletePayload, index: number): PredictionFields {
  const definition = PASC_CLASSES[result.modeIndex[index]];
  if (!definition || !Number.isFinite(result.confidence[index])) throw new Error("分类结果缺少有效类别或置信度，已停止导出。");
  const source = result.spatialReferenceSource[index] === 1 ? "frozen_training_reference" : result.spatialReferenceSource[index] === 2 ? "uploaded_research_area" : "none";
  const format = (value: number) => Number.isFinite(value) ? value.toFixed(6) : "";
  return [definition.nameZh, definition.name, format(result.confidence[index]), format(result.spatialReliability[index]), format(result.spatialGateMean[index]), source];
}

export async function exportOriginalWithPascFields(input: {
  source: File;
  result: PascLocalCompletePayload;
  suggestedName: string;
  fieldMapping?: PascLocalFieldMapping;
  onProgress?: ExportProgress;
}) {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker && input.source.size > 100 * 1024 * 1024) {
    throw new Error("导出大型原始表需要桌面版 Chrome 或 Edge，以便流式写入本地文件。");
  }
  const destination = picker ? await picker({
    suggestedName: input.suggestedName,
    types: [{ description: "带 PASC 分类字段的 CSV", accept: { "text/csv": [".csv"] } }],
  }) : null;
  const writable = destination ? await destination.createWritable() : null;
  const sourceIterator = csvRows(input.source);
  let storedIterator: AsyncGenerator<string[]> | null = null;
  try {
    const fallbackParts: BlobPart[] = [];
    let writeBuffer = "\uFEFF";
    const flush = async (force = false) => {
      if (!force && writeBuffer.length < 1024 * 1024) return;
      if (writable) await writable.write(writeBuffer);
      else fallbackParts.push(writeBuffer);
      writeBuffer = "";
    };
    const append = async (line: string) => {
      writeBuffer += line;
      await flush();
    };

    const sourceHeader = await sourceIterator.next();
    if (sourceHeader.done) throw new Error("原始 CSV 为空。");
    const descriptor = sourceDescriptor(sourceHeader.value, input.fieldMapping);
    const outputHeaders = sourceHeader.value.map(header => header.replace(/^\uFEFF/, ""));
    const outputIndexes = appendedHeaders.map(header => {
      const existing = descriptor.headers.indexOf(header);
      if (existing >= 0) return existing;
      outputHeaders.push(header);
      return outputHeaders.length - 1;
    });
    await append(csvLine(outputHeaders));

    const storedFile = await opfsResultFile(input.result);
    storedIterator = storedFile ? csvRows(storedFile) : null;
    let storedIndexes: Record<string, number> | null = null;
    if (storedIterator) {
      const storedHeader = await storedIterator.next();
      if (storedHeader.done) throw new Error("浏览器本地完整分类结果为空。");
      storedIndexes = Object.fromEntries(storedHeader.value.map((header, index) => [header.replace(/^\uFEFF/, ""), index]));
    }
    const result = input.result;
    const modern = Boolean(result.sourceRowNumbers || result.classificationEligible || result.observedDates);
    const legacyStoredSample = Boolean(storedIterator && result.mapSampled && !modern);
    const expectedMapRows = result.pointIds.length;
    if (result.sourceRowNumbers && result.sourceRowNumbers.length !== expectedMapRows) throw new Error("分类结果源行号数量不一致。");
    if (result.classificationEligible && result.classificationEligible.length !== expectedMapRows) throw new Error("分类适用标记数量不一致。");
    if (new Set(result.pointIds).size !== expectedMapRows) throw new Error("分类结果存在重复点编号。");
    if (result.sourceRowNumbers) for (let index = 0; index < expectedMapRows; index += 1) {
      if (result.sourceRowNumbers[index] < 2 || (index > 0 && result.sourceRowNumbers[index] <= result.sourceRowNumbers[index - 1])) throw new Error("分类结果源行号顺序无效。");
    }
    const expectedClassified = result.classificationEligible
      ? result.classificationEligible.reduce((sum, value) => sum + (value === 1 ? 1 : 0), 0)
      : (result.totalPredictedPoints ?? expectedMapRows);
    if (modern && result.totalPredictedPoints !== undefined && result.totalPredictedPoints !== expectedClassified) throw new Error("分类点数与适用标记不一致。");
    const sourceIds = new Set<string>();
    let validIndex = 0, processedRows = 0, mappedRows = 0, classifiedRows = 0, unsupportedRows = 0, unprocessedRows = 0, invalidCoordinates = 0;

    for await (const cells of sourceIterator) {
      const rowNumber = processedRows + 2;
      if (cells.length > descriptor.headers.length) throw new Error("原始 CSV 第 " + rowNumber + " 行列数超过表头，已停止导出。");
      const state = sourceRowState(cells, descriptor);
      const generatedId = modern ? String(processedRows + 1) : String(validIndex + 1);
      const pointId = descriptor.idIndex >= 0 && cells[descriptor.idIndex]?.trim() ? cells[descriptor.idIndex].trim() : generatedId;
      // Modern identities include every nonempty source row, including invalid coordinates.
      if (modern && sourceIds.has(pointId)) throw new Error("原始 CSV 第 " + rowNumber + " 行存在重复点编号：" + pointId + "。");
      if (modern) sourceIds.add(pointId);
      let prediction: PredictionFields | null = null;
      let status = state.coordinatesValid ? "not_processed" : "invalid_coordinate";
      let statusReason = state.coordinatesValid
        ? result.analysisScope === "quick" ? "outside_quick_analysis_scope" : "outside_analysis_result"
        : state.coordinateReason;
      const eligibleSourceRow = state.coordinatesValid && (modern || state.eligible);
      let matchesResult = false;
      if (result.sourceRowNumbers) {
        const expectedRow = result.sourceRowNumbers[mappedRows];
        if (expectedRow !== undefined && expectedRow < rowNumber) throw new Error("分类结果与原始 CSV 源行号不一致。");
        matchesResult = expectedRow === rowNumber;
      } else {
        matchesResult = eligibleSourceRow && (legacyStoredSample || mappedRows < expectedMapRows);
      }
      if (matchesResult) {
        if (!state.coordinatesValid) throw new Error("分类结果指向原始 CSV 的无效坐标行，已停止导出。");
        if (!legacyStoredSample) {
          if (result.pointIds[mappedRows] !== pointId) throw new Error("分类结果与原始 CSV 点位顺序不一致：" + pointId + "。");
          if (Math.abs(result.longitude[mappedRows] - state.longitude) > 0.00005 || Math.abs(result.latitude[mappedRows] - state.latitude) > 0.00005) throw new Error("分类结果与原始 CSV 坐标不一致：" + pointId + "。");
          if (modern && (result.classificationEligible?.[mappedRows] !== 0) !== state.eligible) throw new Error("分类结果与原始 CSV 有效观测数量不一致：" + pointId + "。");
          if (result.effectiveEpochs && result.effectiveEpochs[mappedRows] !== state.effectiveEpochs) throw new Error("分类结果与原始 CSV 有效期数不一致：" + pointId + "。");
        }
        const eligible = legacyStoredSample ? state.eligible : result.classificationEligible?.[mappedRows] !== 0;
        status = eligible ? "classified" : "insufficient_observations";
        statusReason = eligible ? "" : "effective_observations_below_20";
        if (storedIterator && storedIndexes) {
          const stored = await storedIterator.next();
          if (stored.done) throw new Error("浏览器本地完整结果缺少源点记录。");
          const row = stored.value;
          if ((row[storedIndexes.point_id] ?? "") !== pointId) throw new Error("本地结果与原始 CSV 点位顺序不一致：" + pointId + "。");
          if (storedIndexes.source_row !== undefined && Number(row[storedIndexes.source_row]) !== rowNumber) throw new Error("本地结果与原始 CSV 源行号不一致。");
          if (storedIndexes.classification_status !== undefined && (row[storedIndexes.classification_status] === "classified") !== eligible) throw new Error("本地结果分类适用状态不一致。");
          if (eligible) {
            prediction = [row[storedIndexes.mode] ?? "", row[storedIndexes.mode_name] ?? "", row[storedIndexes.confidence] ?? "",
              row[storedIndexes.spatial_reliability] ?? "", row[storedIndexes.spatial_gate_mean] ?? "", row[storedIndexes.spatial_reference] ?? ""];
            if (!PASC_CLASSES.some(item => item.name === prediction![1]) || !prediction[2].trim() || !Number.isFinite(Number(prediction[2]))) throw new Error("本地分类结果缺少有效类别或置信度。");
            if (!legacyStoredSample) {
              const definition = PASC_CLASSES[result.modeIndex[mappedRows]];
              // Stored Float32 text and the six-decimal memory export represent the same value.
              if (!definition || prediction[0] !== definition.nameZh || prediction[1] !== definition.name
                || !Number.isFinite(result.confidence[mappedRows]) || Math.abs(Number(prediction[2]) - result.confidence[mappedRows]) > 0.0000005) {
                throw new Error("本地分类结果与当前点位类别或置信度不一致。");
              }
            }
          }
        } else if (eligible) prediction = predictionFields(result, mappedRows);
        mappedRows += 1;
        if (eligible) classifiedRows += 1;
        else unsupportedRows += 1;
      } else if (!state.coordinatesValid) invalidCoordinates += 1;
      else unprocessedRows += 1;
      if (!modern && state.coordinatesValid && state.eligible) validIndex += 1;
      const outputRow = Array.from({ length: outputHeaders.length }, (_, index) => cells[index] ?? "");
      const outputValues = [...(prediction ?? ["", "", "", "", "", ""]), status, statusReason, String(state.effectiveEpochs)];
      outputIndexes.forEach((column, index) => { outputRow[column] = outputValues[index]; });
      await append(csvLine(outputRow)); processedRows += 1;
      if (processedRows % 1000 === 0) {
        input.onProgress?.(Math.min(0.99, processedRows / Math.max(result.totalRows, processedRows + 1)), "正在回填第 " + processedRows.toLocaleString() + " 行");
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    if (modern && !result.sourceTruncated && result.analysisScope !== "quick"
      && (unprocessedRows > 0 || processedRows !== result.totalRows || invalidCoordinates !== result.invalidRows)) {
      throw new Error("原始 CSV 范围与完整分析结果不一致，请使用分析时的原始文件。");
    }
    if ((!legacyStoredSample && mappedRows !== expectedMapRows) || classifiedRows !== expectedClassified) throw new Error("地图点位或分类结果未能完整回填，请重新选择分析时使用的原始 CSV。");
    if (storedIterator && !(await storedIterator.next()).done) throw new Error("浏览器本地结果含未匹配的源点记录，已停止导出。");
    await flush(true);
    if (writable) await writable.close();
    else {
      const url = URL.createObjectURL(new Blob(fallbackParts, { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = input.suggestedName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    input.onProgress?.(1, "已导出 " + processedRows.toLocaleString() + " 行：分类 " + classifiedRows.toLocaleString() + " 点，未分类 " + unsupportedRows.toLocaleString() + " 点；原始字段全部保留");
    return { sourceRows: processedRows, mappedRows, classifiedRows, unsupportedRows, unprocessedRows, invalidCoordinates };

  } catch (error) {
    if (writable) await writable.abort().catch(() => {});
    throw error;
  } finally {
    await sourceIterator.return(undefined);
    await storedIterator?.return(undefined);
  }
}
