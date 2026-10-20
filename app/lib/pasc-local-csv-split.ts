import { PASC_LOCAL_MAX_CSV_RECORD_BYTES, PASC_LOCAL_SPLIT_PART_BYTES, PASC_LOCAL_SPLIT_PART_ROWS, PASC_LOCAL_STREAM_CHUNK_BYTES } from "./pasc-local-limits";

type LocalWritable = { write: (value: Uint8Array<ArrayBuffer> | string) => Promise<unknown>; close: () => Promise<unknown>; abort: () => Promise<unknown> };
type LocalFile = { createWritable: () => Promise<LocalWritable>; getFile: () => Promise<File> };
export type LocalSplitDirectory = {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<LocalSplitDirectory>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<LocalFile>;
  removeEntry: (name: string) => Promise<unknown>;
};
export type LocalCsvSplit = {
  schemaVersion: "local-csv-split-v1";
  directory: string;
  sourceName: string;
  sourceBytes: number;
  partCount: number;
  rowCount: number;
  maxPartBytes: number;
  maxPartRows: number;
};
type SplitOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: number, detail: string) => void;
  rootProvider?: () => Promise<LocalSplitDirectory>;
  maxPartBytes?: number;
  maxPartRows?: number;
  chunkBytes?: number;
};
const localRoot = () => navigator.storage.getDirectory();
const partName = (index: number) => `part-${String(index).padStart(6, "0")}.csv`;
const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("已取消本机分片。", "AbortError"); };
function concatenate(pieces: Uint8Array[], length: number) {
  const output = new Uint8Array(length); let offset = 0;
  for (const piece of pieces) { output.set(piece, offset); offset += piece.length; }
  return output;
}

/** Byte-preserving records: quoted newlines, escaped quotes, UTF-8 and CRLF can span chunks. */
async function* csvRecords(file: File, chunkBytes: number, signal?: AbortSignal): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  let pieces: Uint8Array[] = [], buffered = 0, inQuotes = false, pendingQuote = false, pendingCr = false;
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    cancelled(signal);
    const end = Math.min(file.size, offset + chunkBytes);
    const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    if (chunk.length !== end - offset) throw new Error("本机原文件读取不完整，请重新选择文件；未保存不完整分片。");
    let start = 0;
    const record = (end: number) => {
      const length = buffered + end - start;
      if (length > PASC_LOCAL_MAX_CSV_RECORD_BYTES) throw new Error("CSV 单行超过 8 MiB，请检查超长字段或未闭合引号；原文件未上传。");
      const value = concatenate([...pieces, chunk.subarray(start, end)], length);
      pieces = []; buffered = 0; start = end; return value;
    };
    for (let index = 0; index < chunk.length; index += 1) {
      if (index % 65536 === 0) cancelled(signal);
      const byte = chunk[index];
      if (pendingCr) {
        pendingCr = false;
        if (byte === 10) { yield record(index + 1); continue; }
        yield record(index);
      }
      if (buffered + index - start + 1 > PASC_LOCAL_MAX_CSV_RECORD_BYTES) throw new Error("CSV 单行超过 8 MiB，请检查超长字段或未闭合引号；原文件未上传。");
      if (pendingQuote) {
        pendingQuote = false;
        if (byte === 34) continue;
        inQuotes = false;
      }
      if (byte === 34) { if (inQuotes) pendingQuote = true; else inQuotes = true; }
      else if (!inQuotes && byte === 13) pendingCr = true;
      else if (!inQuotes && byte === 10) yield record(index + 1);
    }
    if (start < chunk.length) { pieces.push(chunk.subarray(start)); buffered += chunk.length - start; }
  }
  if (pendingQuote) inQuotes = false;
  if (inQuotes) throw new Error("CSV 格式错误：引号未闭合，未生成可用分片。");
  if (buffered) yield concatenate(pieces, buffered);
}

function validateSplit(split: LocalCsvSplit) {
  if (!/^lanjifyw-local-csv-[a-zA-Z0-9_-]+$/.test(split.directory) || !Number.isSafeInteger(split.partCount) || split.partCount < 1) throw new Error("本机分片目录无效，未访问其他文件。");
}

/** Never accumulates point metadata or a list of every part; each part has a deterministic name. */
export async function splitLocalCsv(file: File, options: SplitOptions = {}): Promise<LocalCsvSplit> {
  const maxPartBytes = options.maxPartBytes ?? PASC_LOCAL_SPLIT_PART_BYTES, maxPartRows = options.maxPartRows ?? PASC_LOCAL_SPLIT_PART_ROWS;
  const chunkBytes = options.chunkBytes ?? PASC_LOCAL_STREAM_CHUNK_BYTES;
  if (![file.size, maxPartBytes, maxPartRows, chunkBytes].every(value => Number.isSafeInteger(value) && value > 0)
    || maxPartBytes > PASC_LOCAL_SPLIT_PART_BYTES || maxPartRows > PASC_LOCAL_SPLIT_PART_ROWS || chunkBytes > PASC_LOCAL_STREAM_CHUNK_BYTES) throw new Error("本机分片大小或行数设置无效。");
  cancelled(options.signal);
  const root = await (options.rootProvider ?? localRoot)();
  const directory = `lanjifyw-local-csv-${crypto.randomUUID()}`;
  const folder = await root.getDirectoryHandle(directory, { create: true });
  let header: Uint8Array<ArrayBuffer> | null = null, headerPieces: Uint8Array[] = [], headerBytes = 0;
  let writable: LocalWritable | null = null, created = 0, partRows = 0, partBytes = 0, rowCount = 0, processed = 0, reported = 0;
  const buffer = new Uint8Array(Math.min(1024 * 1024, maxPartBytes)); let used = 0;
  const flush = async () => { if (used && writable) { await writable.write(buffer.subarray(0, used)); used = 0; } };
  const append = async (value: Uint8Array<ArrayBuffer>) => {
    if (value.length > buffer.length - used) await flush();
    if (value.length >= buffer.length) await writable!.write(value);
    else { buffer.set(value, used); used += value.length; }
  };
  const closePart = async () => { if (writable) { await flush(); await writable.close(); writable = null; } };
  try {
    for await (const record of csvRecords(file, chunkBytes, options.signal)) {
      cancelled(options.signal); processed += record.length;
      if (!header) {
        headerPieces.push(record); headerBytes += record.length;
        if (headerBytes > PASC_LOCAL_MAX_CSV_RECORD_BYTES) throw new Error("CSV 标题行超过 8 MiB，请检查字段和引号。");
        if (/^[\s,"]*$/.test(new TextDecoder().decode(record))) continue;
        const terminated = record.at(-1) === 10 || record.at(-1) === 13;
        if (!terminated) { headerPieces.push(Uint8Array.of(10)); headerBytes += 1; }
        header = concatenate(headerPieces, headerBytes); headerPieces = [];
        continue;
      }
      if (header.length + record.length > maxPartBytes) throw new Error("单条 CSV 记录超出本机分片预算，请检查字段；原文件保持不变。");
      if (writable && (partRows >= maxPartRows || partBytes + record.length > maxPartBytes)) await closePart();
      if (!writable) {
        created += 1;
        writable = await (await folder.getFileHandle(partName(created), { create: true })).createWritable();
        partRows = 0; partBytes = header.length; await append(header);
      }
      await append(record); partRows += 1; rowCount += 1; partBytes += record.length;
      if (processed - reported >= chunkBytes) {
        reported = processed;
        options.onProgress?.(processed / file.size, `正在本机分片 · ${created.toLocaleString()} 片 · ${rowCount.toLocaleString()} 行`);
      }
    }
    if (!rowCount) throw new Error("CSV 没有可拆分的数据行。");
    await closePart(); cancelled(options.signal);
    const result: LocalCsvSplit = { schemaVersion: "local-csv-split-v1", directory, sourceName: file.name, sourceBytes: file.size, partCount: created, rowCount, maxPartBytes, maxPartRows };
    writable = await (await folder.getFileHandle("manifest.json", { create: true })).createWritable();
    await writable.write(JSON.stringify(result)); await writable.close(); writable = null;
    cancelled(options.signal);
    options.onProgress?.(1, `本机分片完成：${created.toLocaleString()} 片；可选择分片分析或保存到本机磁盘。`);
    return result;
  } catch (error) {
    await writable?.abort().catch(() => undefined);
    for (let index = 1; index <= created; index += 1) await folder.removeEntry(partName(index)).catch(() => undefined);
    await folder.removeEntry("manifest.json").catch(() => undefined);
    await root.removeEntry(directory).catch(() => undefined);
    throw error;
  }
}

export async function readLocalCsvSplitPart(split: LocalCsvSplit, index: number, rootProvider: () => Promise<LocalSplitDirectory> = localRoot): Promise<File> {
  validateSplit(split);
  if (!Number.isSafeInteger(index) || index < 1 || index > split.partCount) throw new Error("本机分片编号无效。");
  return (await (await (await rootProvider()).getDirectoryHandle(split.directory)).getFileHandle(partName(index))).getFile();
}

/** Only this explicitly named temporary job; no recursive or origin-wide deletion. */
export async function discardLocalCsvSplit(split: LocalCsvSplit, rootProvider: () => Promise<LocalSplitDirectory> = localRoot): Promise<void> {
  validateSplit(split);
  const root = await rootProvider(), folder = await root.getDirectoryHandle(split.directory);
  const remove = async (name: string) => { try { await folder.removeEntry(name); } catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; } };
  for (let index = 1; index <= split.partCount; index += 1) await remove(partName(index));
  await remove("manifest.json"); await root.removeEntry(split.directory);
}
