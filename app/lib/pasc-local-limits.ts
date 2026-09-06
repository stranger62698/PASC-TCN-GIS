export const PASC_LOCAL_RECOMMENDED_POINTS = 21_610;
export const PASC_LOCAL_WARNING_FILE_BYTES = 28 * 1024 * 1024;
export const PASC_LOCAL_STREAMING_FILE_BYTES = 300 * 1024 * 1024;
export const PASC_LOCAL_HARD_FILE_BYTES = 1024 * 1024 * 1024;
export const PASC_LOCAL_STREAM_CHUNK_BYTES = 8 * 1024 * 1024;
export const PASC_LOCAL_MAP_SAMPLE_POINTS = 25_000;
export const PASC_LOCAL_QUICK_POINTS = 5_000;
export const PASC_LOCAL_LARGE_DATASET_MESSAGE = "该数据集较大，分析速度、浏览器本地磁盘和内存占用取决于您的设备性能。";

export type PascLocalBrowserCapabilities = {
  desktopChromium: boolean;
  fileStream: boolean;
  worker: boolean;
  opfs: boolean;
};

export function localBrowserCapabilities(): PascLocalBrowserCapabilities {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { desktopChromium: false, fileStream: false, worker: false, opfs: false };
  }
  const agent = navigator.userAgent;
  return {
    desktopChromium: /(?:Chrome|Chromium|Edg)\//.test(agent) && !/(?:Android|Mobile|CriOS|EdgiOS)/.test(agent),
    fileStream: typeof File !== "undefined" && "stream" in File.prototype,
    worker: typeof Worker !== "undefined",
    opfs: Boolean(navigator.storage?.getDirectory),
  };
}

export function isStreamingLocalFile(fileSizeBytes: number) {
  return fileSizeBytes > PASC_LOCAL_STREAMING_FILE_BYTES;
}

export function localDatasetWarning(fileSizeBytes: number, pointCount = 0) {
  return fileSizeBytes >= PASC_LOCAL_WARNING_FILE_BYTES || pointCount > PASC_LOCAL_RECOMMENDED_POINTS
    ? PASC_LOCAL_LARGE_DATASET_MESSAGE
    : "";
}

export function assertLocalFileSize(fileSizeBytes: number, capabilities?: PascLocalBrowserCapabilities, requireOpfs = true) {
  if (fileSizeBytes > PASC_LOCAL_HARD_FILE_BYTES) throw new Error("文件超过 1 GiB 本地分析上限；请拆分 CSV 后再分析。原文件不会自动上传。");
  if (isStreamingLocalFile(fileSizeBytes) && capabilities) {
    if (!capabilities.desktopChromium) throw new Error("300 MB 以上文件仅支持桌面版 Chrome 或 Edge 本地分析。");
    if (!capabilities.fileStream || !capabilities.worker) throw new Error("当前浏览器缺少大文件流式分析能力，请升级桌面版 Chrome 或 Edge。");
    if (requireOpfs && !capabilities.opfs) throw new Error("当前浏览器不支持 OPFS 本地结果存储，无法安全分析 300 MB 以上文件。");
  }
}

export function friendlyLocalAnalysisError(input: unknown) {
  const raw = input instanceof Error ? input.message : String(input || "");
  const message = raw.split("\n", 1)[0];
  if (/引号未闭合|CSV 格式/i.test(message)) return "CSV 格式错误：存在未闭合引号或损坏的字段，请修复后重试。";
  if (/经度和纬度|longitude|latitude/i.test(message)) return "缺少可识别的经度或纬度字段，请检查字段名与坐标值。";
  if (/至少需要 20|日期字段/i.test(message)) return "可解析日期字段不足：本地 PASC 至少需要 20 期时序。";
  if (/没有可用于|NaN|valid monitoring/i.test(message)) return "没有有效监测点：请检查 NaN、坐标范围和每行有效时序数量。";
  if (/时间步|time.?step|契约不匹配/i.test(message)) return "时序长度与模型/空间参考契约不匹配，请检查日期轴和预处理设置。";
  if (/out of memory|allocation|Array buffer|2 GiB|memory/i.test(message)) return "浏览器内存不足：请关闭其他页面、改用 batch 256 或拆分 CSV 后重试。原文件不会上传。";
  if (/OPFS|Origin Private File System|本地结果存储/i.test(message)) return "浏览器本地结果存储不可用：请使用桌面版 Chrome 或 Edge，并确认当前站点允许本地存储。";
  if (/桌面版 Chrome|大文件流式分析能力/i.test(message)) return message;
  if (/WebAssembly|WASM|wasm/i.test(message)) return "WASM 初始化失败：请刷新页面、确认浏览器允许 WebAssembly，并检查本地运行时资产。";
  if (/ONNX|model|Worker 加载|worker/i.test(message)) return "本地 ONNX 模型或 Worker 加载失败，请重新生成私有本地资产并刷新页面。";
  return message || "本地分析失败；地图与原始 CSV 均未被修改或上传。";
}
