import type { GisBounds, GisLayer } from "./gis-layer";
import type { AiEvidence, LocalAiResult } from "./ai-evidence";
import { analyzeRoadRisk, type InsarSpatialMetric } from "./road-landslide-analysis";
import { retrieveKnowledge } from "./rag-retriever";
import { runBatchedSpatialTask } from "./spatial-analysis";

export type AiPointMetric = InsarSpatialMetric & { name?: string; coherence?: number; missingRate?: number; modeConfidence?: number };
export type LocalAiContext = { points: AiPointMetric[]; allPoints?: AiPointMetric[]; scopeLabel: string; scopeBounds?: GisBounds | null; activePoint?: AiPointMetric | null; layers: GisLayer[] };

const UNSUPPORTED = /预测.*(时间|日期)|什么时候.*发生|灾害.*发生(时间|日期)|发生日期|确定.*原因|天气预报|法律责任|自动处置|替我.*确认/;

function format(value: number | null, digits = 1) { return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function modeKey(value: string | undefined) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (/stable|稳定/.test(mode)) return "stable";
  if (/accelerat|加速/.test(mode)) return "accelerating";
  if (/decelerat|减速/.test(mode)) return "decelerating";
  if (/piecewise|stepwise|分段|阶跃/.test(mode)) return "piecewise";
  if (/linear|线性/.test(mode)) return "linear";
  if (/undefined|未定义/.test(mode)) return "undefined";
  return "unclassified";
}
const modeLabel = (key: string) => ({ stable: "稳定型", linear: "线性型", piecewise: "分段型", decelerating: "减速型", accelerating: "加速型", undefined: "未定义型", unclassified: "未分类" })[key] ?? key;
const percentage = (count: number, total: number) => total ? count / total * 100 : 0;

async function summarizePoints(points: AiPointMetric[]) {
  let velocitySum = 0; let velocityCount = 0; let minVelocity: number | null = null; let maxVelocity: number | null = null; let anomalyCount = 0; let acceleratingCount = 0; let qualityCount = 0;
  const velocities: number[] = [], modeCounts: Record<string, number> = {};
  await runBatchedSpatialTask(points, (point) => {
    if (Number.isFinite(point.velocity)) { velocitySum += point.velocity; velocityCount += 1; velocities.push(point.velocity); minVelocity = minVelocity === null ? point.velocity : Math.min(minVelocity, point.velocity); maxVelocity = maxVelocity === null ? point.velocity : Math.max(maxVelocity, point.velocity); }
    const mode = modeKey(point.mode); modeCounts[mode] = (modeCounts[mode] ?? 0) + 1;
    if (point.velocity <= -3 || mode === "accelerating" || mode === "piecewise") anomalyCount += 1;
    if (mode === "accelerating") acceleratingCount += 1;
    if ((point.coherence ?? 1) < 0.75 || (point.missingRate ?? 0) > 0.2) qualityCount += 1;
  });
  velocities.sort((left, right) => left - right);
  const middle = Math.floor(velocities.length / 2), medianVelocity = velocities.length ? (velocities.length % 2 ? velocities[middle] : (velocities[middle - 1] + velocities[middle]) / 2) : null;
  const modes = Object.entries(modeCounts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return { count: points.length, averageVelocity: velocityCount ? velocitySum / velocityCount : null, medianVelocity, minVelocity, maxVelocity, anomalyCount, acceleratingCount, qualityCount, modeCounts, modes, dominantMode: modes[0]?.[0] ?? "unclassified" };
}

export function classifyLocalAiIntent(query: string) {
  if (UNSUPPORTED.test(query)) return "boundary" as const;
  if (/道路|公路|路网|road|滑坡/.test(query)) return "road-risk" as const;
  if (/对比|比较|compare/.test(query)) return "scope-compare" as const;
  if (/图层|空间关系|叠加|关联/.test(query)) return "layer-analysis" as const;
  if (/当前点|选中点|这个点|point/.test(query)) return "point" as const;
  if (/模式分布|主要模式|当前范围.*模式|区域.*模式/.test(query)) return "mode-summary" as const;
  if (/解释|什么是|为什么|怎么|方法|PASC|Undefined|模式|相干性|缺测率|Evidence/.test(query)) return "knowledge" as const;
  return "scope-summary" as const;
}

export async function runLocalAiTools(query: string, context: LocalAiContext, options: { signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {}): Promise<LocalAiResult> {
  const cleanQuery = query.trim();
  if (!cleanQuery) throw new Error("请输入问题");
  const intent = classifyLocalAiIntent(cleanQuery);
  const evidence: AiEvidence[] = [{ id: "scope", kind: "scope", label: "分析范围", detail: `${context.scopeLabel}（${context.points.length.toLocaleString()} 点）`, action: context.points.length ? { type: "focus-points", pointIds: context.points.slice(0, 5000).map((point) => point.id) } : undefined }];
  const matches = retrieveKnowledge(cleanQuery, 3);
  matches.forEach((match) => evidence.push({ id: `rag-${match.id}`, kind: "rag", label: match.title, detail: `${match.source} · 相关度 ${match.score}` }));

  if (intent === "boundary") {
    evidence.push({ id: "boundary", kind: "warning", label: "能力边界", detail: "本地助手不预测灾害发生时间、不判定因果，也不替代人工确认。" });
    return { answer: "这个问题超出当前本地证据能力。我可以基于现有 InSAR、PASC-TCN、道路和滑坡图层给出候选筛查与可追溯统计，但不能给出确定的发生时间、因果结论或自动处置决定。", evidence, toolNames: [], createdAt: new Date().toISOString(), boundaryLimited: true };
  }

  if (intent === "road-risk") {
    const roadLayers = context.layers.filter((layer) => layer.visible && layer.role === "road");
    if (!roadLayers.length) {
      evidence.push({ id: "road-missing", kind: "warning", label: "缺少道路图层", detail: "请在左侧 GIS 图层导入线图层，并将角色设为“道路”。" });
      return { answer: "当前范围已有 InSAR 点，但没有可用于道路缓冲分析的道路线图层。导入 GeoJSON 或 Shapefile ZIP，并把图层角色设为“道路”后即可本地计算。", evidence, toolNames: ["check_gis_layers"], createdAt: new Date().toISOString(), boundaryLimited: false };
    }
    const risks = await analyzeRoadRisk({ points: context.points, layers: context.layers, signal: options.signal, onProgress: options.onProgress });
    const top = risks.slice(0, 5);
    evidence.push({ id: "tool-road", kind: "tool", label: "道路缓冲与相交分析", detail: `空间索引 + 分批计算，完成 ${risks.length} 个道路要素，默认缓冲 200 m` });
    top.forEach((item, index) => evidence.push({ id: `road-${item.featureId}`, kind: "tool", label: `候选 ${index + 1}：${item.name}`, detail: `评分 ${item.score}；${item.reasons.join("；")}`, action: { type: "focus-feature", layerId: item.layerId, featureId: item.featureId } }));
    const answer = top.length ? `已完成道路候选筛查。优先核查 ${top[0].name}：评分 ${top[0].score}，缓冲区 ${top[0].pointCount} 点，其中 ${top[0].anomalyCount} 个异常点，最不利速率 ${format(top[0].minVelocity)} mm/yr。评分只用于排序，仍需人工确认。` : "道路分析已完成，但当前范围没有形成候选结果。";
    return { answer, evidence, toolNames: ["road_buffer_intersection", "rank_inspection_candidates"], createdAt: new Date().toISOString(), boundaryLimited: false };
  }

  if (intent === "layer-analysis") {
    const visible = context.layers.filter(layer => layer.visible);
    const overlapping = context.scopeBounds ? visible.filter(layer => { const bounds = layer.bounds; return Boolean(bounds && !(bounds.east < context.scopeBounds!.west || bounds.west > context.scopeBounds!.east || bounds.north < context.scopeBounds!.south || bounds.south > context.scopeBounds!.north)); }) : visible;
    if (!visible.length) {
      evidence.push({ id: "layer-missing", kind: "warning", label: "尚未加载业务图层", detail: "可以在左侧图层面板导入建筑、道路、滑坡或其他 GeoJSON / Shapefile 数据。" });
      return { answer: "当前只有 InSAR 监测点，尚未加载可关联的 GIS 图层。导入建筑轮廓、道路或其他业务对象后，可以继续检查图层覆盖范围并在地图定位相关要素。", evidence, toolNames: ["check_gis_layers"], createdAt: new Date().toISOString(), boundaryLimited: false };
    }
    overlapping.slice(0, 8).forEach(layer => evidence.push({ id: `layer-${layer.id}`, kind: "tool", label: layer.name, detail: `${layer.featureCount.toLocaleString()} 个要素 · ${layer.geometryTypes.join(" / ")} · 图层范围与当前分析范围相交`, action: { type: "focus-layer", layerId: layer.id } }));
    const names = overlapping.slice(0, 4).map(layer => layer.name).join("、");
    const answer = overlapping.length ? `当前已加载 ${visible.length} 个可见 GIS 图层，其中 ${overlapping.length} 个图层的范围与当前分析范围相交：${names}${overlapping.length > 4 ? "等" : ""}。这一步确认的是范围关联；建筑归属、道路缓冲或滑坡相交仍需按具体几何继续计算。` : `当前已加载 ${visible.length} 个可见 GIS 图层，但它们的图层范围与当前分析范围没有相交。可以先检查坐标系、图层位置和当前地图范围。`;
    return { answer, evidence, toolNames: ["compare_layer_bounds"], createdAt: new Date().toISOString(), boundaryLimited: false };
  }

  if (intent === "point" && context.activePoint) {
    const point = context.activePoint;
    evidence.push({ id: "tool-point", kind: "tool", label: "读取选中点", detail: `${point.name ?? point.id}；速率 ${format(point.velocity)} mm/yr；模式 ${point.mode ?? "—"}；相干性 ${format(point.coherence ?? null, 2)}`, action: { type: "focus-points", pointIds: [point.id] } });
    return { answer: `选中点 ${point.name ?? point.id} 的速率为 ${format(point.velocity)} mm/yr，PASC-TCN 模式为 ${point.mode ?? "未识别"}。${(point.coherence ?? 1) < 0.4 || (point.missingRate ?? 0) > 0.35 ? "数据质量指标偏弱，应降低结论权重。" : "建议结合邻域一致性和地图图层继续核查。"}`, evidence, toolNames: ["get_selected_point"], createdAt: new Date().toISOString(), boundaryLimited: false };
  }

  if (intent === "knowledge") {
    const answer = matches.length ? matches.map((match) => match.content).join("\n") : "当前内置知识库没有找到足够相关的说明。可以换用更具体的 InSAR、PASC-TCN、道路缓冲或滑坡相交关键词。";
    return { answer, evidence, toolNames: ["retrieve_local_knowledge"], createdAt: new Date().toISOString(), boundaryLimited: false };
  }

  if (intent === "mode-summary") {
    const stats = await summarizePoints(context.points);
    const leading = stats.modes.slice(0, 4).map(([mode, count]) => `${modeLabel(mode)} ${count.toLocaleString()} 点（${percentage(count, stats.count).toFixed(1)}%）`);
    evidence.push({ id: "tool-modes", kind: "tool", label: "形变模式统计", detail: leading.join("；"), action: context.points.length ? { type: "focus-points", pointIds: context.points.slice(0, 5000).map(point => point.id) } : undefined });
    return { answer: `${context.scopeLabel}以${modeLabel(stats.dominantMode)}为主，共 ${stats.modeCounts[stats.dominantMode]?.toLocaleString() ?? 0} 点。主要构成为：${leading.join("；")}。加速型共有 ${stats.acceleratingCount.toLocaleString()} 点；模式用于描述时序形态，应结合速率、质量和空间一致性共同判断。`, evidence, toolNames: ["summarize_deformation_modes"], createdAt: new Date().toISOString(), boundaryLimited: false };
  }

  if (intent === "scope-compare") {
    const baseline = context.allPoints ?? context.points;
    const [scopeStats, baselineStats] = await Promise.all([summarizePoints(context.points), summarizePoints(baseline)]);
    const scopeAnomalyRate = percentage(scopeStats.anomalyCount, scopeStats.count), baselineAnomalyRate = percentage(baselineStats.anomalyCount, baselineStats.count), velocityDifference = (scopeStats.averageVelocity ?? 0) - (baselineStats.averageVelocity ?? 0);
    const detail = context.scopeLabel + " " + scopeStats.count + " 点 vs 全数据集 " + baselineStats.count + " 点；候选率 " + scopeAnomalyRate.toFixed(1) + "% vs " + baselineAnomalyRate.toFixed(1) + "%";
    evidence.push({ id: "tool-compare", kind: "tool", label: "范围对比", detail, action: context.points.length ? { type: "focus-points", pointIds: context.points.slice(0, 5000).map(point => point.id) } : undefined });
    const answer = `${context.scopeLabel}平均速率 ${format(scopeStats.averageVelocity)} mm/yr，比全数据集${velocityDifference < 0 ? "更负" : "更正"} ${Math.abs(velocityDifference).toFixed(1)} mm/yr；候选点比例为 ${scopeAnomalyRate.toFixed(1)}%，全数据集为 ${baselineAnomalyRate.toFixed(1)}%。当前区域以${modeLabel(scopeStats.dominantMode)}为主，全数据集以${modeLabel(baselineStats.dominantMode)}为主。该对比用于识别相对差异，范围大小和点密度不同，不能直接解释为风险倍数。`;
    return { answer, evidence, toolNames: ["compare_scope_statistics"], createdAt: new Date().toISOString(), boundaryLimited: false };
  }

  const stats = await summarizePoints(context.points);
  evidence.push({ id: "tool-stats", kind: "tool", label: "范围统计", detail: `${stats.count.toLocaleString()} 点；平均 / 中位速率 ${format(stats.averageVelocity)} / ${format(stats.medianVelocity)} mm/yr；候选 ${stats.anomalyCount}；低质量 ${stats.qualityCount}`, action: context.points.length ? { type: "focus-points", pointIds: context.points.slice(0, 5000).map((point) => point.id) } : undefined });
  return { answer: `${context.scopeLabel}共 ${stats.count.toLocaleString()} 个点，平均速率 ${format(stats.averageVelocity)} mm/yr，中位速率 ${format(stats.medianVelocity)} mm/yr，范围为 ${format(stats.minVelocity)}—${format(stats.maxVelocity)} mm/yr。\n形变模式以${modeLabel(stats.dominantMode)}为主；按当前透明规则识别 ${stats.anomalyCount.toLocaleString()} 个候选点，其中加速型 ${stats.acceleratingCount.toLocaleString()} 个。\n另有 ${stats.qualityCount.toLocaleString()} 个点需要先检查相干性或缺测情况。结果用于确定复核顺序，不替代人工判断。`, evidence, toolNames: ["summarize_scope"], createdAt: new Date().toISOString(), boundaryLimited: false };
}
