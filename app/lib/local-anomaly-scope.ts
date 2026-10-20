import type { InsarPoint } from "../data/site";
/** An explicit user-selected scope; filtering never substitutes a sample. */
export function resolveLocalAnomalyScope(points: InsarPoint[], pointIds: readonly string[] | null): InsarPoint[] {
  if (pointIds === null) return points;
  const ids = new Set(pointIds);
  if (!ids.size || ids.size !== pointIds.length) throw new Error("异常分析选区为空或点位编号重复，请重新圈选。");
  const selected = points.filter(point => ids.has(point.id));
  if (selected.length !== ids.size) throw new Error("异常分析选区与当前数据不匹配，请重新圈选。");
  return selected;
}
