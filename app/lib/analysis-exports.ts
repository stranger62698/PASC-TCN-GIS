import type { InsarPoint } from "../data/site.js";
import { aggregateAoiSeries, type AoiAggregateMethod } from "./aoi-analysis.js";

export type ExportCell = string | number | boolean | null | undefined;

export type AnalysisRuleSummaryInput = {
  datasetName: string;
  datasetId: string;
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
    [point.id, point.name, point.lon, point.lat, point.velocity, point.coherence || null, point.missingRate, point.mode, point.modeSource || "", point.pasc?.confidence ?? point.modeConfidence ?? null],
    [],
    ["date", "displacement_mm"],
    ...pointDates(point).map((date, index) => [date, point.series[index]]),
  ];
  return csvText(rows);
}

export function comparisonCsv(points: readonly InsarPoint[]) {
  const rows: ExportCell[][] = [["point_id", "name", "date", "displacement_mm", "velocity_mm_per_year", "mode", "coherence", "missing_rate"]];
  points.forEach(point => pointDates(point).forEach((date, index) => rows.push([point.id, point.name, date, point.series[index], point.velocity, point.mode, point.coherence || null, point.missingRate])));
  return csvText(rows);
}

export function aoiPointsCsv(points: readonly InsarPoint[], timeIndex: number) {
  return csvText([
    ["point_id", "name", "longitude", "latitude", "velocity_mm_per_year", "current_displacement_mm", "current_date", "coherence", "missing_rate", "mode", "mode_source"],
    ...points.map(point => {
      const index = Math.min(Math.max(0, timeIndex), Math.max(0, point.series.length - 1));
      return [point.id, point.name, point.lon, point.lat, point.velocity, point.series[index] ?? point.displacement, pointDates(point)[index] || "", point.coherence || null, point.missingRate, point.mode, point.modeSource || ""];
    }),
  ]);
}

export function aoiSeriesCsv(points: readonly InsarPoint[], method: AoiAggregateMethod, enabledModes: readonly string[], normalizeMode: (mode: string) => string) {
  const aggregate = aggregateAoiSeries([...points], method, point => normalizeMode(point.mode));
  const groups = aggregate.groups.filter(group => enabledModes.includes(group.mode));
  return csvText([
    ["date", `aoi_${method}_displacement_mm`, ...groups.map(group => `${group.mode}_displacement_mm`)],
    ...aggregate.dates.map((date, index) => [date, aggregate.overall[index], ...groups.map(group => group.values[index])]),
  ]);
}

export function buildAnalysisRuleSummary(input: AnalysisRuleSummaryInput): AnalysisRuleSummary {
  const items = [
    { label: "数据集", value: input.datasetName, detail: input.datasetId || "本地 / 公开数据" },
    { label: "时间范围", value: `${input.timeRange.startDate}—${input.timeRange.endDate}`, detail: "沿用当前地图分析上下文" },
    { label: "地图表达", value: input.displayMode, detail: input.displayRange },
    { label: "PASC 显示", value: input.patternVisibility, detail: "只改变显示，不删除原始点" },
    { label: "当前筛选", value: input.activeFilter, detail: `低相干阈值 ${input.coherenceThreshold.toFixed(2)}；高缺测阈值 20%` },
    { label: "异常候选规则", value: "速率 ≤ −3 mm/yr，或加速型 / 分段型", detail: "先排除低相干或高缺测点；不是风险评分" },
    { label: "空间支持规则", value: `邻域 ${input.anomalyRadiusMeters} m · 最少 ${input.anomalyMinimumPoints} 点`, detail: "密度连通与分析包络，不是工程边界" },
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

function readableStyles() {
  return [...document.styleSheets].flatMap(sheet => {
    try { return [...sheet.cssRules].map(rule => rule.cssText); }
    catch { return []; }
  }).join("\n");
}

export async function downloadSvgPng(svg: SVGSVGElement, filename: string, scale = 2) {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = readableStyles();
  clone.prepend(style);
  const viewBox = svg.viewBox.baseVal, rect = svg.getBoundingClientRect(), width = Math.max(1, viewBox.width || rect.width || 800), height = Math.max(1, viewBox.height || rect.height || 450);
  clone.setAttribute("width", String(width)); clone.setAttribute("height", String(height));
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
