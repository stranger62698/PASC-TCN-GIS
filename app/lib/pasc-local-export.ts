import { parsePascDateHeader, resolvePascField } from "./pasc-schema";
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

function sourceDescriptor(headers: string[]) {
  const cleanHeaders = [...headers];
  cleanHeaders[0] = cleanHeaders[0]?.replace(/^\uFEFF/, "") ?? "";
  const idIndex = cleanHeaders.indexOf(resolvePascField(cleanHeaders, "point_id").field);
  const longitudeIndex = cleanHeaders.indexOf(resolvePascField(cleanHeaders, "longitude").field);
  const latitudeIndex = cleanHeaders.indexOf(resolvePascField(cleanHeaders, "latitude").field);
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

function validSourceRow(cells: string[], descriptor: ReturnType<typeof sourceDescriptor>) {
  const longitude = Number(cells[descriptor.longitudeIndex]);
  const latitude = Number(cells[descriptor.latitudeIndex]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90 || (longitude === 0 && latitude === 0)) return false;
  let validEpochs = 0;
  for (const group of descriptor.dateGroups) {
    if (group.some(index => cells[index]?.trim() !== "" && Number.isFinite(Number(cells[index])))) validEpochs += 1;
  }
  return validEpochs >= 20;
}

function inMemoryPredictions(result: PascLocalCompletePayload) {
  return result.pointIds.map((pointId, index) => {
    const definition = PASC_CLASSES[result.modeIndex[index]];
    const source = result.spatialReferenceSource[index] === 1 ? "frozen_training_reference" : result.spatialReferenceSource[index] === 2 ? "uploaded_research_area" : "none";
    return {
      pointId,
      fields: [
        definition?.nameZh ?? "未分类",
        definition?.name ?? "Undefined",
        result.confidence[index]?.toFixed(6) ?? "",
        result.spatialReliability[index]?.toFixed(6) ?? "",
        result.spatialGateMean[index]?.toFixed(6) ?? "",
        source,
      ] as PredictionFields,
    };
  });
}

export async function exportOriginalWithPascFields(input: {
  source: File;
  result: PascLocalCompletePayload;
  suggestedName: string;
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

  const sourceIterator = csvRows(input.source);
  const sourceHeader = await sourceIterator.next();
  if (sourceHeader.done) throw new Error("原始 CSV 为空。");
  const descriptor = sourceDescriptor(sourceHeader.value);
  await append(csvLine([...descriptor.headers, ...appendedHeaders]));

  const storedFile = await opfsResultFile(input.result);
  const storedIterator = storedFile ? csvRows(storedFile) : null;
  let storedIndexes: Record<string, number> | null = null;
  if (storedIterator) {
    const storedHeader = await storedIterator.next();
    if (storedHeader.done) throw new Error("浏览器本地完整分类结果为空。");
    storedIndexes = Object.fromEntries(storedHeader.value.map((header, index) => [header.replace(/^\uFEFF/, ""), index]));
  }
  const memory = storedIterator ? null : inMemoryPredictions(input.result);
  let validIndex = 0;
  let processedRows = 0;

  for await (const cells of sourceIterator) {
    let prediction: PredictionFields | null = null;
    if (validSourceRow(cells, descriptor)) {
      const pointId = descriptor.idIndex >= 0 && cells[descriptor.idIndex]?.trim() ? cells[descriptor.idIndex].trim() : String(validIndex + 1);
      validIndex += 1;
      if (storedIterator && storedIndexes) {
        const stored = await storedIterator.next();
        if (!stored.done) {
          const row = stored.value;
          const storedPointId = row[storedIndexes.point_id] ?? "";
          if (storedPointId !== pointId) throw new Error(`分类结果与原始 CSV 点位顺序不一致：${pointId}。`);
          prediction = [
            row[storedIndexes.mode] ?? "",
            row[storedIndexes.mode_name] ?? "",
            row[storedIndexes.confidence] ?? "",
            row[storedIndexes.spatial_reliability] ?? "",
            row[storedIndexes.spatial_gate_mean] ?? "",
            row[storedIndexes.spatial_reference] ?? "",
          ];
        }
      } else {
        const item = memory?.[validIndex - 1];
        if (item && item.pointId !== pointId) throw new Error(`分类结果与原始 CSV 点位顺序不一致：${pointId}。`);
        prediction = item?.fields ?? null;
      }
    }
    await append(csvLine([...cells, ...(prediction ?? ["", "", "", "", "", ""])]));
    processedRows += 1;
    if (processedRows % 1000 === 0) {
      input.onProgress?.(Math.min(0.99, processedRows / Math.max(input.result.totalRows, processedRows + 1)), `正在回填第 ${processedRows.toLocaleString()} 行`);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
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
  input.onProgress?.(1, `已导出 ${processedRows.toLocaleString()} 行，原始字段全部保留`);
}
