import type { InsarPoint } from "../data/site";
import { normalizedMode } from "./analysis-context";
import type { AoiAggregateMethod, AoiSeries } from "./aoi-analysis";
import type { PascLocalMapDataset } from "./pasc-local-map-adapter";
import type { LocalAoiRequest, LocalComputeResponse } from "./local-analysis-compute";
export async function loadLocalAoiSeries(dataset: PascLocalMapDataset, points: InsarPoint[], method: AoiAggregateMethod, signal?: AbortSignal): Promise<AoiSeries> {
  if (signal?.aborted) throw new DOMException("已取消区域计算。", "AbortError");
  const rows = Uint32Array.from(points, point => {
    if (point.localSeriesIndex === undefined || dataset.points[point.localSeriesIndex]?.id !== point.id) throw new Error("区域来源不匹配，请重新圈选。");
    return point.localSeriesIndex;
  });
  const dates = dataset.observedDates.length ? dataset.observedDates : dataset.points[0]?.dates ?? [];
  const kind = dataset.observedDates.length ? "observed" as const : "processed" as const;
  const input: LocalAoiRequest = { kind, rows, modes: points.map(point => normalizedMode(point.mode)), dates, method, storage: dataset.seriesStore?.storage };
  if (!input.storage) {
    const matrix = new Float32Array(points.length * dates.length);
    for (let start = 0; start < points.length; start += 256) {
      if (signal?.aborted) throw new DOMException("已取消区域计算。", "AbortError");
      for (let row = start; row < Math.min(points.length, start + 256); row += 1) {
        const point = points[row], series = kind === "observed" ? point.observedSeries ?? [] : point.series;
        for (let step = 0; step < dates.length; step += 1) matrix[row * dates.length + step] = kind === "observed" && point.observedMask && !point.observedMask[step] ? NaN : series[step];
      }
      if (start + 256 < points.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    input.matrix = matrix;
  }
  return new Promise((resolve, reject) => {
    let worker: Worker | null = null;
    const finish = () => { worker?.terminate(); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { finish(); reject(new DOMException("已取消区域计算。", "AbortError")); };
    if (signal?.aborted) { reject(new DOMException("已取消区域计算。", "AbortError")); return; }
    try {
      worker = new Worker(new URL("../workers/local-analysis.worker.ts", import.meta.url), { type: "module", name: "local-aoi-analysis" });
      worker.onmessage = event => {
        const message = event.data as LocalComputeResponse;
        if (message.type === "AOI") { finish(); resolve(message.result); }
        else if (message.type === "ERROR") { finish(); reject(new Error(message.message)); }
      };
      worker.onerror = event => { finish(); reject(new Error(event.message || "区域时序计算失败，请重试。")); };
      signal?.addEventListener("abort", cancel, { once: true });
      worker.postMessage({ type: "AOI", runId: 1, input }, [rows.buffer, ...(input.matrix ? [input.matrix.buffer] : [])]);
    } catch (error) { finish(); reject(error); }
  });
}
