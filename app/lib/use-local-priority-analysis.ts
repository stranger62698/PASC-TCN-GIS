import { useEffect, useMemo, useState } from "react";
import type { InsarPoint } from "../data/site";
import { normalizedMode } from "./analysis-context";
import { createPrioritySnapshot, prioritySnapshotTransfers, restorePrioritySelection, type LocalComputeResponse } from "./local-analysis-compute";
import { selectPriorityDeformationPoints, type PriorityDeformationOptions, type PriorityDeformationSelection } from "./priority-deformation";
export function useLocalPriorityAnalysis(points: InsarPoint[], timeIndex: number, options: PriorityDeformationOptions, revision = 0) {
  const signature = JSON.stringify(options);
  const empty = useMemo(() => selectPriorityDeformationPoints([], timeIndex, JSON.parse(signature)), [signature, timeIndex]);
  const [result, setResult] = useState<{ points: InsarPoint[]; signature: string; timeIndex: number; revision: number; selection: PriorityDeformationSelection; state: string; error: string } | null>(null);
  useEffect(() => {
    let active = true;
    let worker: Worker | null = null;
    const resolved = JSON.parse(signature) as PriorityDeformationOptions;
    const publish = (selection: PriorityDeformationSelection, state: string, error = "") => {
      if (active) setResult({ points, signature, timeIndex, revision, selection, state, error });
    };
    queueMicrotask(() => {
      if (!active) return;
      if (!points.length) { publish(empty, "ready"); return; }
      publish(empty, "running");
      try {
        worker = new Worker(new URL("../workers/local-analysis.worker.ts", import.meta.url), { type: "module", name: "local-anomaly-analysis" });
        worker.onmessage = event => {
          if (!active) return;
          const message = event.data as LocalComputeResponse;
          if (message.type === "PRIORITY") { publish(restorePrioritySelection(message.result, points), "ready"); worker?.terminate(); }
          else if (message.type === "ERROR") { publish(empty, "error", message.message); worker?.terminate(); }
        };
        worker.onerror = event => { publish(empty, "error", event.message || "本地异常组件未能加载，请刷新后重试。"); worker?.terminate(); };
        const snapshot = createPrioritySnapshot(points, timeIndex, resolved, point => normalizedMode(point.mode));
        worker.postMessage({ type: "PRIORITY", runId: 1, snapshot }, prioritySnapshotTransfers(snapshot));
      } catch (error) { publish(empty, "error", error instanceof Error ? error.message : "无法启动本地异常计算。"); worker?.terminate(); }
    });
    return () => { active = false; worker?.terminate(); };
  }, [points, timeIndex, signature, revision, empty]);
  if (!result || result.points !== points || result.timeIndex !== timeIndex || result.signature !== signature || result.revision !== revision) return { selection: empty, state: points.length ? "running" : "idle", error: "" };
  return result;
}
