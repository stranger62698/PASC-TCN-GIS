import type { PascLocalCompletePayload } from "./pasc-local-worker-protocol";
type LocalDirectory = { getDirectoryHandle: (name: string) => Promise<LocalDirectory>; removeEntry: (name: string) => Promise<void> };
const safeName = (value: string) => !!value && value !== "." && value !== ".." && !/[\\/]/.test(value) && !value.includes(String.fromCharCode(0));
export function localTemporaryStorageBytes(result: PascLocalCompletePayload): number {
  return (result.resultStorage?.byteLength ?? 0) + (result.seriesStorage ? result.seriesStorage.pointCount * result.seriesStorage.recordBytes : 0);
}
/** Removes only this result's named files, never an origin-wide or recursive directory. */
export async function discardLocalTemporaryResults(result: PascLocalCompletePayload, rootProvider: () => Promise<LocalDirectory> = () => navigator.storage.getDirectory()): Promise<number> {
  const files = [result.resultStorage, result.seriesStorage].filter((item): item is NonNullable<typeof item> => !!item);
  if (files.some(file => !safeName(file.directory) || !safeName(file.fileName))) throw new Error("临时结果路径无效，未清理浏览器文件。");
  if (!files.length) return 0;
  const root = await rootProvider();
  const unique = new Set<string>(); let removed = 0;
  for (const file of files) {
    const key = file.directory + "/" + file.fileName; if (unique.has(key)) continue; unique.add(key);
    try { await (await root.getDirectoryHandle(file.directory)).removeEntry(file.fileName); removed += 1; }
    catch (error) { if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error; }
  }
  return removed;
}
