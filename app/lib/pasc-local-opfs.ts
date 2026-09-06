import type { PascLocalCompletePayload } from "./pasc-local-worker-protocol";

type OpfsResultStorage = NonNullable<PascLocalCompletePayload["resultStorage"]>;
type SavePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
};

export async function prepareLargeLocalStorage(fileSizeBytes: number) {
  if (!navigator.storage?.getDirectory) throw new Error("OPFS 本地结果存储不可用。");
  await navigator.storage.persist?.().catch(() => false);
  const estimate = await navigator.storage.estimate();
  const available = Math.max(0, (estimate.quota ?? 0) - (estimate.usage ?? 0));
  const recommended = Math.max(192 * 1024 * 1024, Math.ceil(fileSizeBytes * 0.35));
  if (estimate.quota && available < recommended) {
    throw new Error(`浏览器本地磁盘空间不足：大文件分析建议至少保留 ${(recommended / 1_073_741_824).toFixed(1)} GiB 可用空间。`);
  }
  return { availableBytes: available, recommendedBytes: recommended };
}

export async function saveOpfsResult(storage: OpfsResultStorage, suggestedName: string) {
  const root = await navigator.storage.getDirectory();
  const folder = await root.getDirectoryHandle(storage.directory);
  const handle = await folder.getFileHandle(storage.fileName);
  const file = await handle.getFile();
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (picker) {
    const destination = await picker({
      suggestedName,
      types: [{ description: "CSV 结果", accept: { "text/csv": [".csv"] } }],
    });
    const writable = await destination.createWritable();
    await file.stream().pipeTo(writable);
    return;
  }
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
