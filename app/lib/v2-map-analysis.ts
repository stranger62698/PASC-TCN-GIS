import type { InsarPoint } from "../data/site.js";
import { pascDisplayName } from "./pasc.js";
import type { RenderAttribute } from "./insar-v2.js";

export type PrimaryAnalysisMode = Extract<RenderAttribute, "velocity" | "displacement" | "mode">;
export type PatternVisibility = "all" | "anomaly" | "anomaly_with_undefined";

export const PRIMARY_ANALYSIS_MODES: ReadonlyArray<{ value: PrimaryAnalysisMode; label: string; description: string }> = [
  { value: "velocity", label: "速率", description: "长期变化速度" },
  { value: "displacement", label: "累计形变", description: "当前期变化量" },
  { value: "mode", label: "PASC 模式", description: "形变演化方式" },
];

const anomalyModes = new Set(["线性型", "分段型", "减速型", "加速型"]);

export function isPointVisibleForPattern(point: Pick<InsarPoint, "mode">, visibility: PatternVisibility) {
  if (visibility === "all") return true;
  const mode = pascDisplayName(point.mode);
  return anomalyModes.has(mode) || (visibility === "anomaly_with_undefined" && mode === "未定义型");
}

export function filterPointsForPattern<T extends Pick<InsarPoint, "mode">>(points: readonly T[], visibility: PatternVisibility) {
  return visibility === "all" ? [...points] : points.filter(point => isPointVisibleForPattern(point, visibility));
}

export function patternPointOpacity(mode: string) {
  const normalized = pascDisplayName(mode);
  if (normalized === "稳定型") return 0.22;
  if (normalized === "加速型") return 1;
  if (anomalyModes.has(normalized)) return 0.9;
  if (normalized === "未定义型") return 0.55;
  return 0.35;
}

export function formatFiniteValue(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}