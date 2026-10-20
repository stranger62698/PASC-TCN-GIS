import { aggregateLocalMatrix, computePrioritySnapshot, type LocalComputeRequest, type LocalComputeResponse } from "../lib/local-analysis-compute";
import { aggregateStoredAoi } from "../lib/local-aoi-storage";
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<LocalComputeRequest>) => void) | null; postMessage: (value: LocalComputeResponse, transfer?: Transferable[]) => void };
scope.onmessage = event => {
  const message = event.data;
  void (async () => {
    try {
      if (message.type === "PRIORITY") {
        const result = computePrioritySnapshot(message.snapshot);
        scope.postMessage({ type: "PRIORITY", runId: message.runId, result }, Object.values(result.indices).map(indices => indices.buffer as ArrayBuffer));
      } else {
        const input = message.input;
        if (input.rows.length !== input.modes.length) throw new Error("区域点位与模式数量不匹配。");
        let result;
        if (input.matrix) result = aggregateLocalMatrix(input.matrix, input.modes, input.dates, input.method);
        else {
          if (!input.storage) throw new Error("区域分析缺少本地时序。");
          const root = await navigator.storage.getDirectory(), directory = await root.getDirectoryHandle(input.storage.directory);
          const file = await (await directory.getFileHandle(input.storage.fileName)).getFile();
          result = await aggregateStoredAoi(input, file);
        }
        scope.postMessage({ type: "AOI", runId: message.runId, result });
      }
    } catch (error) { scope.postMessage({ type: "ERROR", runId: message.runId, message: error instanceof Error ? error.message : "本地分析失败，请重试。" }); }
  })();
};
