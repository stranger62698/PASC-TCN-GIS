import type { InsarPoint } from "../data/site";
import type { CsvMapping } from "./insar-v2";
import { PHASE_E_MAX_POINTS, buildPascOnlineRequest, type PascOnlineRequest } from "./pasc-online.js";
import { PASC_EXPERIMENTAL_MIN_STEPS } from "./pasc.js";

export const PASC_LARGE_MAX_POINTS = 100_000;

export function buildPascDurableRequestBatches(
  points: InsarPoint[],
  datasetName: string,
  preprocessingState: CsvMapping["preprocessingState"],
) {
  const candidates = points.filter(point => (point.effectiveEpochCount ?? point.series.length) >= PASC_EXPERIMENTAL_MIN_STEPS);
  if (!candidates.length) throw new Error("当前数据没有达到 20 个有效期的 PASC 候选点。");
  if (candidates.length > PASC_LARGE_MAX_POINTS) {
    throw new Error(`后台任务最多处理 ${PASC_LARGE_MAX_POINTS.toLocaleString()} 个候选点。`);
  }
  const requests: PascOnlineRequest[] = [];
  for (let index = 0; index < candidates.length; index += PHASE_E_MAX_POINTS) {
    requests.push(buildPascOnlineRequest(candidates.slice(index, index + PHASE_E_MAX_POINTS), datasetName, preprocessingState));
  }
  return requests;
}
