import type { InsarPoint } from "../data/site.js";
import { renderedDisplacementAt } from "./insar-v2.js";
import { aggregateAoiSeries, type AoiAggregateMethod } from "./aoi-analysis.js";
import { displacementAt, isPriorityQualityReliable, type PriorityDeformationSelection } from "./priority-deformation.js";
import { roundInsarValue } from "./insar-precision.js";

export type ExportCell = string | number | boolean | null | undefined;

export type AnalysisRuleSummaryInput = {
  datasetName: string;
  datasetId: string;
  analysisId?: string | null;
  anomalyScope?: string;
  timeRange: { startDate: string; endDate: string };
  displayMode: string;
  displayRange: string;
  patternVisibility: string;
  activeFilter: string;
  coherenceThreshold: number;
  anomalyRadiusMeters: number;
  anomalyMinimumPoints: number;
  selectionSource: string;
  selectedPointCount: number;
  priorityRuleVersion: string;
  priorityDirection: "both" | "negative" | "positive";
  priorityEvaluationDate: string;
  priorityAnomalyCount: number;
  priorityIsolatedCount: number;
  priorityExcludedCount: number;
  priorityDisplacementThresholdMm: number | null;
  priorityVelocityThresholdMmPerYear: number | null;
  priorityCandidateCount: number;
  priorityReliableCount: number;
  priorityLimitedCount: number;
};

export type AnalysisRuleSummary = {
  title: string;
  items: Array<{ label: string; value: string; detail: string }>;
  boundary: string;
  text: string;
};

function csvCell(value: ExportCell) {
  if (value === null || value === undefined || (typeof value === "number" && !Number.isFinite(value))) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvText(rows: readonly (readonly ExportCell[])[]) {
  return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function safeExportName(value: string, fallback = "lanjifyw-insar") {
  const withoutControls = [...value.trim()].map(character => character.charCodeAt(0) < 32 ? "-" : character).join("");
  const normalized = withoutControls.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/[. -]+$/g, "").slice(0, 96);
  return normalized || fallback;
}

const pointDates = (point: InsarPoint) => point.dates?.length === point.series.length ? point.dates : point.series.map((_, index) => `epoch_${index + 1}`);

export function pointCsv(point: InsarPoint) {
  const rows: ExportCell[][] = [
    ["point_id", "name", "longitude", "latitude", "velocity_mm_per_year", "coherence", "missing_rate", "mode", "mode_source", "mode_confidence"],
    [point.id, point.name, point.lon, point.lat, roundInsarValue(point.velocity), point.coherence || null, point.missingRate, point.mode, point.modeSource || "", point.pasc?.confidence ?? point.modeConfidence ?? null],
    [],
    ["date", point.observedDates ? "processed_displacement_mm" : "displacement_mm"],
    ...pointDates(point).map((date, index) => [date, roundInsarValue(point.series[index])]),
  ];
  if (point.observedDates && point.observedSeries) rows.push([], ["observed_date", "observed_displacement_mm", "observation_present"], ...point.observedDates.map((date, index) => { const present = Number.isFinite(point.observedSeries![index]) && (!point.observedMask || !!point.observedMask[index]); return [date, present ? point.observedSeries![index] : null, present] as ExportCell[]; }));
  return csvText(rows);
}

export function comparisonCsv(points: readonly InsarPoint[]) {
  const rows: ExportCell[][] = [["point_id", "name", "date", "displacement_mm", "velocity_mm_per_year", "mode", "coherence", "missing_rate"]];
  points.forEach(point => pointDates(point).forEach((date, index) => rows.push([point.id, point.name, date, roundInsarValue(point.series[index]), roundInsarValue(point.velocity), point.mode, point.coherence || null, point.missingRate])));
  return csvText(rows);
}

export function aoiPointsCsv(points: readonly InsarPoint[], timeIndex: number) {
  return csvText([
    ["point_id", "name", "longitude", "latitude", "velocity_mm_per_year", "current_displacement_mm", "current_date", "coherence", "missing_rate", "mode", "mode_source"],
    ...points.map(point => {
      const index = Math.min(Math.max(0, timeIndex), Math.max(0, point.series.length - 1));
      return [point.id, point.name, point.lon, point.lat, roundInsarValue(point.velocity), roundInsarValue(renderedDisplacementAt(point, index)), pointDates(point)[index] || "", point.coherence || null, point.missingRate, point.mode, point.modeSource || ""];
    }),
  ]);
}

/** Export detection evidence independently of the map playback date. */
export function anomalyPointsCsv(points: readonly InsarPoint[], selection: PriorityDeformationSelection, evaluationIndex: number, provenance?: { datasetId: string; analysisId: string | null; scope: string }) {
  const options = selection.options;
  const regionById = new Map(selection.regions.regions.flatMap(region => region.pointIds.map(id => [id, region.id] as const)));
  const excludedIds = new Set(selection.excludedLowQuality.map(point => point.id));
  return csvText([
    ["point_id", "longitude", "latitude", "velocity_mm_per_year", "evaluation_displacement_mm", "evaluation_date", "result_status", "quality_status", "region_id", "rule_version", "min_abs_velocity_mm_per_year", "min_abs_displacement_mm", "direction", "radius_m", "minimum_distinct_locations", "coherence_threshold", "max_missing_rate", "data_notes", "dataset_id", "analysis_id", "analysis_scope"],
    ...points.map(point => {
      const regionId = regionById.get(point.id);
      return [point.id, point.lon, point.lat, point.velocity, displacementAt(point, evaluationIndex, options.evaluationDate), options.evaluationDate || pointDates(point)[evaluationIndex],
        regionId ? "clustered_anomaly" : excludedIds.has(point.id) ? "quality_excluded" : selection.regions.status === "too_large" ? "unassessed" : "isolated_candidate",
        excludedIds.has(point.id) ? "excluded" : isPriorityQualityReliable(point, options.coherenceThreshold, options.maxMissingRate) ? "reliable" : "needs_verification", regionId || "", selection.ruleVersion,
        options.velocityMmPerYear, options.displacementMm, options.direction, options.radiusMeters, options.minimumPoints, options.coherenceThreshold, options.maxMissingRate, (point.warnings ?? []).join(" | "), provenance?.datasetId, provenance?.analysisId, provenance?.scope];
    }),
  ]);
}

export function aoiSeriesCsv(points: readonly InsarPoint[], method: AoiAggregateMethod, enabledModes: readonly string[], normalizeMode: (mode: string) => string) {
  const aggregate = aggregateAoiSeries([...points], method, point => normalizeMode(point.mode));
  const groups = aggregate.groups.filter(group => enabledModes.includes(group.mode));
  const roundObserved = (value: number | null) => value === null ? null : roundInsarValue(value);
  return csvText([
    ["date", `aoi_${method}_displacement_mm`, ...groups.map(group => `${group.mode}_displacement_mm`)],
    ...aggregate.dates.map((date, index) => [date, roundObserved(aggregate.overall[index]), ...groups.map(group => roundObserved(group.values[index]))]),
  ]);
}

export function buildAnalysisRuleSummary(input: AnalysisRuleSummaryInput): AnalysisRuleSummary {
  const items = [
    { label: "数据集", value: input.datasetName, detail: input.datasetId || "本地 / 公开数据" },
    { label: "分析身份与范围", value: input.analysisId || "当前分析", detail: input.anomalyScope || "全数据" },
    { label: "时间范围", value: `${input.timeRange.startDate}—${input.timeRange.endDate}`, detail: "沿用当前地图分析上下文" },
    { label: "地图表达", value: input.displayMode, detail: input.displayRange },
    { label: "PASC 显示", value: input.patternVisibility, detail: "只改变显示，不删除原始点" },
    { label: "当前筛选", value: input.activeFilter, detail: `低相干阈值 ${input.coherenceThreshold.toFixed(2)}；高缺测阈值 20%` },
    { label: "异常发现规则", value: `双指标达标 AND 同向聚集 · ${input.priorityDirection === "both" ? "正负双向分别聚集" : input.priorityDirection === "negative" ? "仅负向" : "仅正向"}`, detail: `全期 |年均速率| ≥ ${input.priorityVelocityThresholdMmPerYear?.toFixed(2) ?? "不可计算"} mm/yr，且 ${input.priorityEvaluationDate || "末期"} |累计形变量| ≥ ${input.priorityDisplacementThresholdMm?.toFixed(2) ?? "不可计算"} mm，两者同号；规则 ${input.priorityRuleVersion}；时间轴仅回看，模式不作为准入条件` },
    { label: "筛选结果分层", value: `聚集异常 ${input.priorityAnomalyCount} 点 · 离散待查 ${input.priorityIsolatedCount} 点`, detail: `质量门控后候选 ${input.priorityCandidateCount} 点；异常中质量可靠 ${input.priorityReliableCount} 点、质量待核实 ${input.priorityLimitedCount} 点；质量排除 ${input.priorityExcludedCount} 点；离散点与排除点不计异常` },
    { label: "空间支持规则", value: `邻域 ${input.anomalyRadiusMeters} m · 最少 ${input.anomalyMinimumPoints} 点`, detail: "DBSCAN 同向密度连通，核心邻域含自身、重复坐标只计一次；边界为分析包络，不是工程边界" },
    { label: "当前分析对象", value: input.selectionSource, detail: `${input.selectedPointCount.toLocaleString()} 个真实监测点` },
  ];
  const boundary = "结果仅描述当前数据、筛选规则与空间邻近关系，不构成工程安全判断、灾害预测、风险等级或处置建议。";
  const text = ["澜迹 InSAR · 当前分析规则摘要", "", ...items.flatMap(item => [`${item.label}：${item.value}`, `  ${item.detail}`]), "", `边界说明：${boundary}`].join("\r\n");
  return { title: "当前分析规则摘要", items, boundary, text };
}

export function downloadText(content: string, filename: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type }), link = document.createElement("a"), url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// SVG exports have no surrounding page: resolve ancestor selectors and CSS variables
// before cloning so curves, axes and translucent regions keep their actual appearance.
const svgPresentationProperties = [
  "color", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-dasharray", "stroke-dashoffset", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "opacity", "vector-effect", "paint-order", "font-family", "font-size", "font-weight", "font-style",
  "font-variant", "letter-spacing", "word-spacing", "text-anchor", "dominant-baseline", "alignment-baseline",
  "text-decoration", "visibility", "display", "shape-rendering", "text-rendering",
] as const;

export function cloneSvgForExport(svg: SVGSVGElement) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>("*")];
  originals.forEach((node, index) => {
    const computed = getComputedStyle(node);
    const target = copies[index];
    if (!target?.style) return;
    svgPresentationProperties.forEach(property => {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    });
  });
  // Live hover overlays are interaction feedback, not part of an exported result.
  clone.querySelectorAll("style,.chart-hover,.compare-hover,.aoi-hover-line,.aoi-hover-point").forEach(node => node.remove());
  const viewBox = svg.viewBox.baseVal, rect = svg.getBoundingClientRect();
  const originalWidth = Math.max(1, viewBox.width || rect.width || 800);
  const originalHeight = Math.max(1, viewBox.height || rect.height || 450);
  let minX = viewBox.x || 0, minY = viewBox.y || 0;
  let maxX = minX + originalWidth, maxY = minY + originalHeight;
  try {
    const bounds = svg.getBBox();
    if ([bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
      minX = Math.min(minX, bounds.x); minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width); maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  } catch { /* A detached SVG can still export using its declared viewBox. */ }
  const padding = 8, width = maxX - minX + padding * 2, height = maxY - minY + padding * 2;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${minX - padding} ${minY - padding} ${width} ${height}`);
  clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
  clone.style.removeProperty("width"); clone.style.removeProperty("height");
  clone.style.removeProperty("max-width"); clone.style.removeProperty("max-height");
  return { clone, width, height };
}

export async function downloadSvgPng(svg: SVGSVGElement, filename: string, scale = 2) {
  await document.fonts?.ready;
  const { clone, width, height } = cloneSvgForExport(svg);
  const source = new XMLSerializer().serializeToString(clone), url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const next = new Image(), timer = window.setTimeout(() => reject(new Error("图表导出超时，请重试")), 8000); next.onload = () => { window.clearTimeout(timer); resolve(next); }; next.onerror = () => { window.clearTimeout(timer); reject(new Error("图表图像编码失败")); }; next.src = url; });
    const canvas = document.createElement("canvas"); canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d"); if (!context) throw new Error("浏览器无法创建图表画布");
    context.scale(scale, scale); context.fillStyle = "#ffffff"; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG 生成失败")), "image/png"));
    const pngUrl = URL.createObjectURL(png), link = document.createElement("a"); link.href = pngUrl; link.download = filename; link.click(); URL.revokeObjectURL(pngUrl);
  } finally { URL.revokeObjectURL(url); }
}
