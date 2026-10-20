"use client";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { AccountRequired } from "./AccountRequired";
import { PERSONAL_DATA_ACCESS_EVENT, requireAccountSession, useAccountSession } from "../lib/account-session";
import { publicWorkspaceAccess } from "../lib/data-processing-policy";
import { ResizableAnalysisPanel } from "./ResizableAnalysisPanel";
import { DEFAULT_PANEL_WIDTH } from "../lib/workspace-panel-width";
import { useChartWidth } from "../lib/use-chart-width";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { demoDates, demoPoints, type InsarPoint } from "../data/site";
import { AnalysisProvider, colorForMode, deformationModeOrder, normalizedMode, useAnalysisContext, type AnalysisMapView, type SelectedRegionStats } from "../lib/analysis-context";
import { buildDeepSeekWebPrompt, parseDeepSeekWebInterpretation, sanitizeRegionalInterpretation, type RegionalInterpretation } from "../lib/ai-analysis";
import { analysisSummaryBytes, buildAnalysisSummary } from "../lib/ai-summary";
import { trackEvent } from "../lib/analytics";
import { GRASS_BCYR_COLORS, INSAR_RED_GREEN_COLORS, inspectCsv, parseMappedCsv, parseQgisRamp, stageVelocity, type CsvInspection, type CsvMapping, type DatasetParseResult, type RenderAttribute, type RenderStyle } from "../lib/insar-v2";
import { PASC_AUTO_CLASSIFY_MAX_POINTS, PHASE_E_MAX_POINTS, buildPascOnlineRequestBatches, filterPascOnlinePoints, mergePascOnlineResults, onlineErrorMessage, type PascOnlineFilter, type PascOnlineRunState } from "../lib/pasc-online";
import { parsePascMapPreview, pascMapLevelForZoom, type PascPublicJob } from "../lib/pasc-job-client";
import { filterPointsForModes, filterPointsForPattern, type PatternVisibility } from "../lib/v2-map-analysis";
import { deriveTemporalStageAnalysis, pascModeExplanation, pointDataQuality, topPascCandidates, type TemporalStageAnalysis } from "../lib/pasc-product";
import { rectangleGeometry, summarizeAoi, type AoiAggregateMethod, type AoiCoordinate } from "../lib/aoi-analysis";
import { type AnomalyRegion } from "../lib/anomaly-regions";
import { buildDataBackedQuickCases, comparisonColor, currentDisplacement, MAX_COMPARE_POINTS, summarizeComparison, updateComparison, type DataBackedQuickCase } from "../lib/point-comparison";
import { csvText, anomalyPointsCsv, aoiPointsCsv, aoiSeriesCsv, buildAnalysisRuleSummary, comparisonCsv, downloadSvgPng, downloadText, pointCsv, safeExportName } from "../lib/analysis-exports";
import { listPrivateDatasets, patchPrivateDataset, readPrivateDatasetSource } from "../lib/private-datasets-client";
import { PascAnalysisPanel } from "./PascAnalysisPanel";
import { PascCompatibilityCheck } from "./PascCompatibilityCheck";
import { PascPatternLegend } from "./PascPatternLegend";
import { PascOnlineRecognition } from "./PascOnlineRecognition";
import { PascLocalWebGis } from "./PascLocalWebGis";
import type { PascLocalMapDataset } from "../lib/pasc-local-map-adapter";
import { PascRegionStats } from "./PascRegionStats";
import { WorkspaceHeader, type WorkspaceSection } from "./WorkspaceHeader";
import { AoiTimeSeriesChart } from "./AoiTimeSeriesChart";
import { AnomalyRegionPanel } from "./AnomalyRegionPanel";
import { DataBackedCasePanel } from "./DataBackedCasePanel";
import { AnalysisRuleSummary } from "./AnalysisRuleSummary";
import { InspectionActionPanel } from "./InspectionActionPanel";
import { buildInspectionBrief, buildInspectionCandidates } from "../lib/inspection-action";
import { GisLayerPanel } from "./GisLayerPanel";
import { AiEvidencePanel } from "./AiEvidencePanel";
import { importGisFile } from "../lib/gis-import";
import { getGeometryBounds, type GisLayer } from "../lib/gis-layer";
import { loadRoadOpsOsmLayer } from "../lib/roadops-osm";
import type { RoadRiskEvidenceInput } from "../lib/roadops-quality";
import type { RoadOpsRouteMapPlan } from "../lib/roadops-route";
import type { RoadOpsDrivingPlan } from "../lib/roadops-driving";
import { createNavigationDraft, navigationMapPoints, navigationFieldVisits, navigationPickLabel, navigationRouteSignature, setNavigationCoordinate, type NavigationDraft } from "../lib/roadops-navigation";
import { RoadNavigationPanel } from "./RoadNavigationPanel";
import { RoadFieldTaskPanel, type FieldTaskResult } from "./RoadFieldTaskPanel";
import { fieldTaskPlanToNavigationDraft, parseFieldTaskPlan, type FieldTaskPlan } from "../lib/roadops-task-plan";
import { fieldTaskMapPoints, fieldTaskTargetPoints, fieldTaskRouteMap } from "../lib/roadops-task-map";
import { setFieldTaskTargetCoordinate, setFieldVehicleStopCoordinate } from "../lib/roadops-task-editor";
import { syncFieldTaskPlanMetadata } from "../lib/roadops-task-session";
import type { EvidenceAction } from "../lib/ai-evidence";
import { SpatialGridIndex } from "../lib/spatial-analysis";
import { confirmPrimaryInsarLink, insarCandidates, photoCoordinateConflict, primaryInsarPoint, reconcileInsarLinks, rejectInsarLink, type FieldObservation, type NewFieldObservationInput } from "../lib/field-observation";
import { loadFieldObservations, saveFieldObservations } from "../lib/field-observation-store";
import { FieldObservationPanel } from "./FieldObservationPanel";
import { FieldObservationEvidence } from "./FieldObservationEvidence";
import { FieldPhotoLightbox } from "./FieldPhotoLightbox";
import { displacementAt, DEFAULT_PRIORITY_OPTIONS, normalizePriorityOptions, formatPriorityDeformationRule, type PriorityDeformationOptions } from "../lib/priority-deformation";
import { AnomalyRuleControls } from "./AnomalyRuleControls";
import { resolveLocalAnomalyScope } from "../lib/local-anomaly-scope";
import { useLocalPriorityAnalysis } from "../lib/use-local-priority-analysis";
import { loadLocalAoiSeries } from "../lib/local-aoi-client";
import { addInspectionPointToNavigation, addInspectionRegionToNavigation } from "../lib/inspection-to-navigation";
import { createLocalAnalysisId, type LocalAnalysisSession } from "../lib/local-analysis-session";
import { localSettingsForWorkspaceImport, workspaceImportCoherenceMinimum, workspaceImportVisiblePointIds, type WorkspaceLocalImport } from "../lib/workspace-local-import";
import { analyzePascDateColumns, uniqueSortedDateColumns } from "../lib/pasc-schema";
import { LOCAL_DATA_ONLY_MESSAGE, USER_DATA_LOCAL_ONLY } from "../lib/data-processing-policy";

export type { WorkspaceLocalImport } from "../lib/workspace-local-import";

const MapCanvas = dynamic(() => import("./WebGisMap"), { ssr: false, loading: () => <div className="map-loading">正在初始化 WebGIS 地图…</div> });
type ColorRampPreset = { id: string; label: string; hint: string; colors: readonly string[] };
const colorRampPresets: ColorRampPreset[] = [
    { id: "red-green", label: "红 → 绿", hint: "推荐 · 减少蓝色", colors: INSAR_RED_GREEN_COLORS },
    { id: "traffic", label: "红黄绿", hint: "风险分级", colors: ["#b91c1c", "#ef4444", "#f59e0b", "#fde047", "#84cc16", "#15803d"] },
    { id: "heat", label: "暖色热力", hint: "无蓝色", colors: ["#7f1d1d", "#dc2626", "#f97316", "#facc15", "#fff7bc"] },
    { id: "bcyr", label: "GRASS bcyr", hint: "经典蓝青黄红", colors: [...GRASS_BCYR_COLORS].reverse() },
];
const defaultColors = [...INSAR_RED_GREEN_COLORS];
const rampSignature = (colors: readonly string[]) => colors.join(",").toLowerCase();
const defaultColorRange = (attribute: RenderAttribute): { min: number; max: number; interval: number } => {
    if (attribute === "displacement") return { min: -100, max: 100, interval: 20 };
    if (attribute === "velocity" || attribute === "stageVelocity") return { min: -12.5, max: 12.5, interval: 2.5 };
    if (attribute === "coherence") return { min: 0, max: 1, interval: .2 };
    return { min: 0, max: 100, interval: 20 };
};
const FIELD_ASSOCIATION_LIMIT_METERS = 500;
const attributeNames: Record<RenderAttribute, string> = { velocity: "年均速率", displacement: "当前期累计形变", stageVelocity: "阶段速率", mode: "形变模式", coherence: "相干性", missing: "缺测率" };
type MapToolIconName = "layers" | "select" | "workspace" | "analysis" | "tools" | "statistics" | "screenshot" | "rules" | "export" | "import";
function MapToolIcon({ name }: { name: MapToolIconName }) {
    const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
    if (name === "layers") return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></svg>;
    if (name === "select") return <svg {...common}><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>;
    if (name === "workspace") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M8 4v16M8 9h13" /></svg>;
    if (name === "analysis") return <svg {...common}><path d="M4 19V5M4 19h16" /><path d="m7 15 4-5 3 3 5-7" /><circle cx="11" cy="10" r="1" /><circle cx="14" cy="13" r="1" /><circle cx="19" cy="6" r="1" /></svg>;
    if (name === "tools") return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
    if (name === "statistics") return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>;
    if (name === "screenshot") return <svg {...common}><path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" /><circle cx="9" cy="10" r="2" /><circle cx="9" cy="16" r="2" /><path d="m10.8 11 6.2 5M10.8 15 17 10" /></svg>;
    if (name === "rules") return <svg {...common}><path d="M6 3h10l3 3v15H6zM16 3v4h3" /><path d="m9 11 1.4 1.4L13 9.8M9 17h6" /></svg>;
    if (name === "export") return <svg {...common}><path d="M5 16v4h14v-4M12 16V4M8 8l4-4 4 4" /></svg>;
    return <svg {...common}><path d="M5 16v4h14v-4M12 4v12M8 12l4 4 4-4" /></svg>;
}
type PublicDemoId = "haikou" | "landslide" | "road";
const publicDemos: Record<PublicDemoId, { datasetId: string; file: string; title: string; label: string; summary: string; fullSummary: string; fullHint: string; dataNote: string; publishedIsFull?: boolean }> = {
    haikou: { datasetId: "demo-xinbu-island-dense", file: "/data/xinbu-island-insar.csv", title: "海南新埠岛建筑密集形变 · 210 期 PASC-TCN", label: "新埠岛建筑", summary: "9,069 点 · 210 期原始时序", fullSummary: "9,069 点 · 210 期原始文件", fullHint: "当前网页已使用完整原始密集点文件；包含 2017-03-22 至 2025-05-03 的 210 期累计形变、速率、相干性、六类概率与空间可靠性，但未包含建筑轮廓面。", dataNote: "原始密集点 · 210 期时序 · 含 PASC 分类与空间可靠性", publishedIsFull: true },
    landslide: { datasetId: "demo-lajia-landslide", file: "/data/lajia-landslide-insar.csv", title: "拉加镇滑坡 · 时序 InSAR", label: "拉加镇滑坡", summary: "11,354 点 · 58 期", fullSummary: "11,354 点 · 本机原表", fullHint: "选择拉加镇滑坡完整 CSV；全部处理仍在当前浏览器完成。", dataNote: "形变值精度 0.1 mm，未提供分类" },
    road: { datasetId: "demo-haikou-jiangdong-road", file: "/data/haikou-jiangdong-road-insar.csv", title: "海口江东新区主要道路 · 时序 InSAR", label: "江东新区道路", summary: "11,383 点 · 175 期", fullSummary: "27,123 点 · 本机原表", fullHint: "选择江东新区道路 34.9 MB 完整 CSV；文件不会上传。", dataNote: "真实道路监测结果 · 25 m 确定性空间抽样" },
};
const fieldLabels: {
    key: keyof Pick<CsvMapping, "lon" | "lat" | "velocity" | "id" | "mode" | "modeSource" | "confidence" | "coherence" | "location">;
    label: string;
    required?: boolean;
}[] = [{ key: "lon", label: "经度", required: true }, { key: "lat", label: "纬度", required: true }, { key: "velocity", label: "平均速率（可选）" }, { key: "id", label: "点位编号" }, { key: "mode", label: "形变模式（优先 PASC label）" }, { key: "modeSource", label: "模式来源 / 模型名称" }, { key: "confidence", label: "模式置信度" }, { key: "coherence", label: "相干性 / 精度" }, { key: "location", label: "研究区名称" }];
const axisDate = (value: string) => { const digits = (value || "").replace(/\D/g, ""); return digits.length >= 6 ? `${digits.slice(0, 4)}.${digits.slice(4, 6)}` : value; };
const stageLabelsForPreview = (level: string) => level === "map_level_0" ? "概览层" : level === "map_level_1" ? "区域层" : "细节层";
type PointInsight = {
    status: string;
    recentVelocity: number | null;
    recentStartDate: string;
    modeLabel: string;
    modeSource: string;
    confidenceLabel: string;
    explanation: string[];
};

const emptyPascOnlineRun: PascOnlineRunState = { status: "idle", error: "", completedAt: null, summary: null, serviceVersion: null, buildHash: null, processedPoints: 0, totalPoints: 0, completedBatches: 0, totalBatches: 0 };
const PASC_MAP_JOB_POLL_MS = 15_000;
const PASC_MAP_HIDDEN_WAIT_MS = 1_000;

type ExportOperation = { state: "idle" | "running" | "success" | "error"; message: string };
const idleExportOperation: ExportOperation = { state: "idle", message: "" };

const pointBounds = (items: InsarPoint[]): [number, number, number, number] => {
    if (!items.length) return [0, 0, 0, 0];
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const point of items) { west = Math.min(west, point.lon); south = Math.min(south, point.lat); east = Math.max(east, point.lon); north = Math.max(north, point.lat); }
    return [west, south, east, north];
};

const buildVelocityHistogram = (items: InsarPoint[], binCount = 9) => {
    if (!items.length) return [];
    let minimum = Number.POSITIVE_INFINITY, maximum = Number.NEGATIVE_INFINITY, validCount = 0;
    items.forEach(point => { if (!Number.isFinite(point.velocity)) return; minimum = Math.min(minimum, point.velocity); maximum = Math.max(maximum, point.velocity); validCount += 1; });
    if (!validCount) return [];
    if (minimum === maximum) return [{ min: minimum - .5, max: maximum + .5, count: validCount }];
    const width = (maximum - minimum) / binCount;
    const bins = Array.from({ length: binCount }, (_, index) => ({ min: minimum + index * width, max: index === binCount - 1 ? maximum : minimum + (index + 1) * width, count: 0 }));
    items.forEach(point => { if (!Number.isFinite(point.velocity)) return; const index = Math.min(binCount - 1, Math.floor((point.velocity - minimum) / width)); bins[index].count += 1; });
    return bins;
};

function observationTime(value: string) {
    const parts = (value || "").match(/((?:19|20)\d{2})\D?(\d{1,2})?\D?(\d{1,2})?/);
    if (!parts) return Number.NaN;
    return Date.UTC(Number(parts[1]), Math.max(0, Number(parts[2] || 1) - 1), Number(parts[3] || 1));
}

function buildPointInsight(point: InsarPoint, coherenceThreshold: number): PointInsight {
    const dates = point.dates?.length ? point.dates : demoDates.slice(0, point.series.length);
    const lastIndex = Math.max(0, point.series.length - 1);
    const lastTime = observationTime(dates[lastIndex] || "");
    let recentStart = Math.max(0, lastIndex - 12);
    if (Number.isFinite(lastTime)) {
        const oneYearAgo = lastTime - 365.25 * 86400000;
        const found = dates.findIndex((date, index) => index < lastIndex && observationTime(date) >= oneYearAgo);
        if (found >= 0) recentStart = found;
    }
    if (recentStart >= lastIndex) recentStart = Math.max(0, lastIndex - 1);
    const recentVelocity = lastIndex > recentStart ? stageVelocity(point, recentStart, lastIndex) : null;
    const modeLabel = normalizedMode(point.mode);
    const qualityConcern = point.coherence > 0 && point.coherence < coherenceThreshold;
    let status = "缓慢变化";
    if (qualityConcern) status = "质量需关注";
    else if (modeLabel === "稳定型") status = "总体稳定";
    else if (modeLabel === "线性型") status = "线性变化";
    else if (modeLabel === "分段型") status = "阶段变化";
    else if (modeLabel === "减速型") status = "减速变化";
    else if (modeLabel === "加速型") status = "加速变化";
    else if (modeLabel === "未定义型") status = "模式未定义";
    else if ((recentVelocity ?? point.velocity) < -1) status = "持续沉降";
    else if ((recentVelocity ?? point.velocity) > 1) status = "持续抬升";

    const direction = point.velocity < -1 ? "沉降" : point.velocity > 1 ? "抬升" : "缓慢变化";
    const explanation = [
        `该点长期序列表现为${direction}趋势，长期速率为 ${point.velocity.toFixed(1)} mm/yr。`,
    ];
    if (recentVelocity !== null) {
        const longMagnitude = Math.abs(point.velocity);
        const recentMagnitude = Math.abs(recentVelocity);
        if (longMagnitude > 0.2 && recentMagnitude > longMagnitude * 1.25) explanation.push(`近一年变化速度为 ${recentVelocity.toFixed(1)} mm/yr，高于长期变化水平。`);
        else if (longMagnitude > 0.2 && recentMagnitude < longMagnitude * 0.75) explanation.push(`近一年变化速度为 ${recentVelocity.toFixed(1)} mm/yr，低于长期变化水平。`);
        else explanation.push(`近一年变化速度为 ${recentVelocity.toFixed(1)} mm/yr，与长期水平接近。`);
    } else {
        explanation.push("当前有效观测不足以计算近一年速率。");
    }
    if (modeLabel === "未分类") explanation.push("CSV 未提供可用的形变模式结果。");
    else explanation.push(`现有形变模式字段标记为“${modeLabel}”。`);
    explanation.push(qualityConcern ? "当前相干性低于用户设置的质量阈值，解释时应优先核查数据质量。" : "建议结合相干性，并查看周边监测点是否存在一致变化。");

    const confidence = point.modeConfidence;
    return {
        status,
        recentVelocity,
        recentStartDate: dates[recentStart] || "—",
        modeLabel: modeLabel === "未分类" ? "暂无识别结果" : modeLabel,
        modeSource: point.modeSource?.trim() || "未提供",
        confidenceLabel: confidence !== null && confidence !== undefined && Number.isFinite(confidence) ? `${(confidence * 100).toFixed(0)}%` : "未提供",
        explanation,
    };
}

function TimeSeriesChart({ point, showTrend, timeIndex, stageAnalysis, exportBusy, onExportChart }: {
    point: InsarPoint;
    showTrend: boolean;
    timeIndex: number;
    stageAnalysis: TemporalStageAnalysis | null;
    exportBusy: boolean;
    onExportChart: (svg: SVGSVGElement) => void;
}) {
    const sourceValues = point.series;
    const sourceDates = point.dates?.length ? point.dates : demoDates.slice(0, sourceValues.length);
    const [zoomStart, setZoomStart] = useState(0);
    const [zoomEnd, setZoomEnd] = useState(Math.max(1, sourceValues.length - 1));
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const svgRef = useRef<SVGSVGElement>(null);
    const safeEnd = Math.min(sourceValues.length - 1, Math.max(1, zoomEnd));
    const safeStart = Math.max(0, Math.min(zoomStart, safeEnd - 1));
    const values = sourceValues.slice(safeStart, safeEnd + 1);
    const dates = sourceDates.slice(safeStart, safeEnd + 1);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const range = hi - lo || 1;
    const count = Math.max(1, values.length - 1);
    const width = useChartWidth(svgRef, 400);
    const height = 260, left = 70, right = 18, top = 20, bottom = 46;
    const plotW = width - left - right, plotH = height - top - bottom;
    const x = (index: number) => left + (index / count) * plotW;
    const y = (value: number) => top + ((hi - value) / range) * plotH;
    const points = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
    const meanX = count / 2, meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
    let numerator = 0, denominator = 0;
    values.forEach((value, index) => { numerator += (index - meanX) * (value - meanY); denominator += (index - meanX) ** 2; });
    const slope = denominator ? numerator / denominator : 0;
    const intercept = meanY - slope * meanX;
    const trend = `${x(0)},${y(intercept)} ${x(count)},${y(intercept + slope * count)}`;
    const currentLocalIndex = timeIndex - safeStart;
    const currentVisible = currentLocalIndex >= 0 && currentLocalIndex <= count;
    const yTicks = Array.from({ length: 5 }, (_, index) => ({ value: hi - (range * index) / 4, pos: top + (plotH * index) / 4 }));
    const xTicks = Array.from({ length: 5 }, (_, index) => Math.round((count * index) / 4));
    const dotStep = Math.max(1, Math.ceil(values.length / 28));
    const hoveredValue = hoverIndex === null ? null : values[hoverIndex];
    const hoverX = hoverIndex === null ? 0 : x(hoverIndex);
    const hoverY = hoveredValue === null ? 0 : y(hoveredValue);
    const tooltipX = Math.min(width - 150, Math.max(left + 5, hoverX + 9));
    const changeLocalIndex = stageAnalysis ? stageAnalysis.changeIndex - safeStart : -1;
    const changeVisible = Boolean(stageAnalysis && changeLocalIndex > 0 && changeLocalIndex < count);
    const changeX = changeVisible ? x(changeLocalIndex) : 0;
    const zeroVisible = lo <= 0 && hi >= 0;

    const handleHover = (event: ReactMouseEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / rect.width) * width;
        const next = Math.max(0, Math.min(count, Math.round(((svgX - left) / plotW) * count)));
        setHoverIndex(next);
    };

    return (
        <div className="series-chart phase-three-series">
            <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${point.name}累计形变时序曲线，横轴为${point.observedDates ? "模型预处理日期" : "观测日期"}，纵轴为累计形变毫米`} onMouseMove={handleHover} onMouseLeave={() => setHoverIndex(null)}>
                {changeVisible && <g className="chart-stage-bands"><rect x={left} y={top} width={changeX - left} height={plotH} /><rect className="stage-two" x={changeX} y={top} width={width - right - changeX} height={plotH} /></g>}
                <g className="chart-grid">
                    {yTicks.map((tick, index) => <line key={`y-${index}`} x1={left} y1={tick.pos} x2={width - right} y2={tick.pos} />)}
                    {xTicks.map((tick, index) => <line key={`x-${index}`} x1={x(tick)} y1={top} x2={x(tick)} y2={height - bottom} />)}
                </g>
                <g className="chart-axes">
                    <line x1={left} y1={top} x2={left} y2={height - bottom} />
                    <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
                    {yTicks.map((tick, index) => <g key={`yl-${index}`}><line x1={left - 4} y1={tick.pos} x2={left} y2={tick.pos} /><text x={left - 7} y={tick.pos + 4} textAnchor="end">{tick.value.toFixed(1)}</text></g>)}
                    {xTicks.map((tick, index) => <g key={`xl-${index}`}><line x1={x(tick)} y1={height - bottom} x2={x(tick)} y2={height - bottom + 4} /><text x={x(tick)} y={height - bottom + 16} textAnchor={index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle"}>{axisDate(dates[tick] || String(tick))}</text></g>)}
                    <text className="axis-title" x={(left + width - right) / 2} y={height - 7} textAnchor="middle">{point.observedDates ? "模型预处理日期" : "观测日期"}</text>
                    <text className="axis-title" transform={`translate(14 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle">累计形变 (mm)</text>
                </g>
                {zeroVisible && <line className="chart-zero-line" x1={left} y1={y(0)} x2={width - right} y2={y(0)} />}
                {showTrend && <polyline fill="none" className="trend-line" points={trend} />}
                {changeVisible && <g className="chart-change-point"><line x1={changeX} y1={top} x2={changeX} y2={height - bottom} /><text x={Math.min(width - right - 4, changeX + 5)} y={top + 13}>候选变化点 {stageAnalysis?.changeDate}</text></g>}
                <polyline fill="none" className="data-line" points={points} />
                {values.map((value, index) => (index % dotStep === 0 || index === count) ? <circle className="observed-dot" key={index} cx={x(index)} cy={y(value)} r="2.2" /> : null)}
                {currentVisible && <circle className="current-time-dot" cx={x(currentLocalIndex)} cy={y(values[currentLocalIndex] ?? values.at(-1) ?? 0)} r="3.6" />}
                <rect className="chart-hit-area" x={left} y={top} width={plotW} height={plotH} />
                {hoverIndex !== null && hoveredValue !== null && (
                    <g className="chart-hover">
                        <line x1={hoverX} y1={top} x2={hoverX} y2={height - bottom} />
                        <circle cx={hoverX} cy={hoverY} r="4" />
                        <rect x={tooltipX} y={Math.max(top + 4, hoverY - 57)} width="136" height={stageAnalysis ? "52" : "38"} rx="7" />
                        <text x={tooltipX + 8} y={Math.max(top + 19, hoverY - 42)}>{dates[hoverIndex] || "—"}</text>
                        <text x={tooltipX + 8} y={Math.max(top + 34, hoverY - 27)}>{hoveredValue.toFixed(1)} mm</text>
                        {stageAnalysis && <text x={tooltipX + 8} y={Math.max(top + 49, hoverY - 12)}>{hoverIndex + safeStart < stageAnalysis.changeIndex ? "阶段 1" : "阶段 2"}</text>}
                    </g>
                )}
                <g className="chart-legend">
                    <rect x={width - 137} y={top + 7} width="124" height={showTrend ? 38 : 22} rx="6" />
                    <line x1={width - 128} y1={top + 19} x2={width - 104} y2={top + 19} /><circle cx={width - 116} cy={top + 19} r="2.6" /><text x={width - 99} y={top + 23}>{point.observedDates ? "预处理值" : "监测值"}</text>
                    {showTrend && <><line className="legend-trend" x1={width - 128} y1={top + 34} x2={width - 104} y2={top + 34} /><text x={width - 99} y={top + 38}>线性拟合</text></>}
                </g>
            </svg>
            <div className="chart-range-summary"><span>{dates[0] || "起始"}</span><span>范围 {lo.toFixed(1)}—{hi.toFixed(1)} mm</span><span>{dates.at(-1) || "最近"}</span></div>
            <div className="chart-zoom-controls">
                <div>
                    <label><span>缩放起点 {sourceDates[safeStart]}</span><input type="range" min="0" max={Math.max(0, safeEnd - 1)} value={safeStart} onChange={event => { setZoomStart(+event.target.value); setHoverIndex(null); }} /></label>
                    <label><span>缩放终点 {sourceDates[safeEnd]}</span><input type="range" min={Math.min(sourceValues.length - 1, safeStart + 1)} max={sourceValues.length - 1} value={safeEnd} onChange={event => { setZoomEnd(+event.target.value); setHoverIndex(null); }} /></label>
                </div>
                <button disabled={safeStart === 0 && safeEnd === sourceValues.length - 1} onClick={() => { setZoomStart(0); setZoomEnd(sourceValues.length - 1); setHoverIndex(null); }}>恢复全时段</button>
            </div>
            <div className="chart-export-actions single-chart-export"><button disabled={exportBusy} onClick={() => svgRef.current && onExportChart(svgRef.current)}>导出当前视图 PNG</button></div>
        </div>
    );
}
function CompareChart({ points, exportBusy, onExportData, onExportChart }: {
    points: InsarPoint[];
    exportBusy: boolean;
    onExportData: () => void;
    onExportChart: (svg: SVGSVGElement) => void;
}) {
    const shown = points.slice(0, MAX_COMPARE_POINTS), [hoverIndex, setHoverIndex] = useState<number | null>(null), svgRef = useRef<SVGSVGElement>(null), values = shown.flatMap(p => p.series).filter(Number.isFinite);
    const width = useChartWidth(svgRef, 400, Boolean(shown.length && values.length));
    if (!shown.length || !values.length) return null;
    const lo = Math.min(...values), hi = Math.max(...values), range = hi - lo || 1, height = 260, left = 70, right = 18, top = 18, bottom = 44, plotW = width - left - right, plotH = height - top - bottom, maxCount = Math.max(1, ...shown.map(p => p.series.length - 1)), x = (i: number, count: number) => left + (i / Math.max(1, count)) * plotW, y = (v: number) => top + ((hi - v) / range) * plotH, yTicks = Array.from({ length: 5 }, (_, i) => ({ value: hi - (range * i) / 4, pos: top + (plotH * i) / 4 })), xTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxCount * i) / 4)), dates = shown[0]?.dates || demoDates.slice(0, shown[0]?.series.length || 0);
    const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(), ratio = Math.max(0, Math.min(1, (((event.clientX - rect.left) / rect.width) * width - left) / plotW)); setHoverIndex(Math.round(ratio * maxCount)); };
    const pointIndexAtHover = (point: InsarPoint) => Math.round(((hoverIndex ?? 0) / maxCount) * Math.max(0, point.series.length - 1));
    const hoverDate = hoverIndex === null ? "" : dates[Math.round((hoverIndex / maxCount) * Math.max(0, dates.length - 1))] || `第 ${hoverIndex + 1} 期`;
    return <div className="compare-chart"><svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="最多五点累计形变时序对比，横轴为观测日期，纵轴为累计形变毫米" onPointerMove={pointerMove} onPointerLeave={() => setHoverIndex(null)}><g className="chart-grid">{yTicks.map((tick, i) => <line key={`y-${i}`} x1={left} y1={tick.pos} x2={width - right} y2={tick.pos}/>)}{xTicks.map((tick, i) => <line key={`x-${i}`} x1={x(tick, maxCount)} y1={top} x2={x(tick, maxCount)} y2={height - bottom}/>)}</g><g className="chart-axes"><line x1={left} y1={top} x2={left} y2={height - bottom}/><line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom}/>{yTicks.map((tick, i) => <text key={i} x={left - 7} y={tick.pos + 4} textAnchor="end">{tick.value.toFixed(1)}</text>)}{xTicks.map((tick, i) => <text key={i} x={x(tick, maxCount)} y={height - bottom + 16} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}>{axisDate(dates[Math.round((tick / maxCount) * Math.max(0, dates.length - 1))] || String(tick))}</text>)}<text className="axis-title" x={(left + width - right) / 2} y={height - 6} textAnchor="middle">观测日期</text><text className="axis-title" transform={`translate(14 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle">累计形变 (mm)</text></g>{shown.map((p, j) => <polyline key={p.id} fill="none" style={{ stroke: comparisonColor(j) }} points={p.series.map((v, i) => `${x(i, p.series.length - 1)},${y(v)}`).join(" ")}/>)}{hoverIndex !== null && <g className="compare-hover"><line x1={x(hoverIndex, maxCount)} y1={top} x2={x(hoverIndex, maxCount)} y2={height - bottom}/>{shown.map((point, index) => { const value = point.series[pointIndexAtHover(point)]; return Number.isFinite(value) ? <circle key={point.id} cx={x(pointIndexAtHover(point), point.series.length - 1)} cy={y(value)} r="3.8" style={{ fill: comparisonColor(index) }}/> : null; })}</g>}</svg><div className="compare-legend">{shown.map((p, j) => <span key={p.id}><i style={{ background: comparisonColor(j) }}/>{p.id}</span>)}</div>{hoverIndex !== null && <div className="compare-hover-readout"><b>{hoverDate}</b>{shown.map((point, index) => { const value = point.series[pointIndexAtHover(point)]; return <span key={point.id}><i style={{ background: comparisonColor(index) }}/>{point.id}<strong>{Number.isFinite(value) ? `${value.toFixed(1)} mm` : "—"}</strong></span>; })}</div>}<div className="chart-export-actions"><button disabled={exportBusy} onClick={onExportData}>导出对比数据 CSV</button><button disabled={exportBusy} onClick={() => svgRef.current && onExportChart(svgRef.current)}>导出对比图 PNG</button></div></div>;
}
type MapWorkspaceProps = { initialImport?: WorkspaceLocalImport; onReturnToImport?: () => void };

export function MapWorkspace(props: MapWorkspaceProps = {}) {
    const [requiresAccount, setRequiresAccount] = useState(() => !publicWorkspaceAccess(new URLSearchParams(typeof window === "undefined" ? "" : window.location.search), Boolean(props.initialImport)));
    useEffect(() => {
        const personalAccess = () => setRequiresAccount(true);
        window.addEventListener(PERSONAL_DATA_ACCESS_EVENT, personalAccess);
        return () => window.removeEventListener(PERSONAL_DATA_ACCESS_EVENT, personalAccess);
    }, []);
    return <AccountRequired publicAccess={!requiresAccount}><AnalysisProvider><MapWorkspaceView {...props} onRequireAccount={() => setRequiresAccount(true)} /></AnalysisProvider></AccountRequired>;
}
function MapWorkspaceView({ initialImport, onReturnToImport, onRequireAccount }: MapWorkspaceProps & { onRequireAccount: () => void }) {
    const accountSession = useAccountSession();
    const { analysis, isReady: isAnalysisReady, updateAnalysis } = useAnalysisContext();
    const [activePublicDemo, setActivePublicDemo] = useState<PublicDemoId>("haikou");
    const [demoDepth, setDemoDepth] = useState<"quick" | "full">("quick");
    const [points, setPoints] = useState<InsarPoint[]>(initialImport ? initialImport.result?.points ?? [] : demoPoints), [selected, setSelected] = useState<InsarPoint | null>(null), [datasetTitle, setDatasetTitle] = useState(initialImport?.result?.datasetTitle ?? initialImport?.file.name ?? "海口示例 · 时序 InSAR"), [visible, setVisible] = useState({ points: true, boundary: true, risk: false, quality: false }), [base, setBase] = useState("osm"), [status, setStatus] = useState(initialImport ? "正在接入本机导入数据…" : "正在加载公开示例数据…"), [showTrend, setShowTrend] = useState(true), [tdtKey, setTdtKey] = useState(""), [keyDraft, setKeyDraft] = useState(""), [customBasemap, setCustomBasemap] = useState(""), [customDraft, setCustomDraft] = useState(""), [baseOpacity, setBaseOpacity] = useState(1), [sourceOpen, setSourceOpen] = useState(false), [guideOpen, setGuideOpen] = useState(false), [mappingOpen, setMappingOpen] = useState(false), [reportOpen, setReportOpen] = useState(false), [inspection, setInspection] = useState<CsvInspection | null>(initialImport?.inspection ?? null), [mapping, setMapping] = useState<CsvMapping | null>(initialImport?.mapping ?? initialImport?.inspection?.mapping ?? null), [pending, setPending] = useState<{
        text: string;
        name: string;
        file?: File;
    } | null>(null), [parseReport, setParseReport] = useState<DatasetParseResult | null>(initialImport?.result ?? null), [privateDatasetId, setPrivateDatasetId] = useState(""), [timeIndex, setTimeIndex] = useState(0), [rangeStart, setRangeStart] = useState(0), [rangeEnd, setRangeEnd] = useState(1), [attribute, setAttributeState] = useState<RenderAttribute>("velocity"), [styleMin, setStyleMin] = useState(-12.5), [styleMax, setStyleMax] = useState(12.5), [interval, setInterval] = useState(2.5), [colors, setColors] = useState<string[]>(defaultColors), [pointSize, setPointSize] = useState(5), [priorityOptions, setPriorityOptions] = useState(() => normalizePriorityOptions(DEFAULT_PRIORITY_OPTIONS)), [threshold, setThreshold] = useState(-10), [coherenceThreshold, setCoherenceThreshold] = useState(.75), [selectionMode, setSelectionMode] = useState<"single" | "compare" | "compareBox" | "box" | "polygon">("single"), [compareIds, setCompareIds] = useState<string[]>([]), [curveIds, setCurveIds] = useState<string[]>([]), [storedBoxPoints, setBoxPoints] = useState<InsarPoint[]>([]), [busy, setBusy] = useState(""), [dataReady, setDataReady] = useState(false), [activeQuickCaseId, setActiveQuickCaseId] = useState<string | null>(null), [mapFocus, setMapFocus] = useState<{ bounds: [number, number, number, number]; token: number } | null>(null), [ruleSummaryOpen, setRuleSummaryOpen] = useState(false), [exportOperation, setExportOperation] = useState<ExportOperation>(idleExportOperation);
    const [leftTab, setLeftTab] = useState<"data" | "layers" | "route" | "field" | "filters" | "anomaly" | "time">("data"), [rightTab, setRightTab] = useState<"point" | "region" | "action" | "pasc" | "ai">("point"), [activeFilter, setActiveFilter] = useState<"none" | "velocity" | "coherence" | "anomaly" | "pascLowConfidence" | "pascLimitedSpatial">("none");
    const [navigationActive, setNavigationActive] = useState(false);
    const [navigationDraft, setNavigationDraft] = useState(createNavigationDraft);
    const [navigationPickId, setNavigationPickId] = useState<string | null>(null);
    const [navigationPlan, setNavigationPlan] = useState<RoadOpsDrivingPlan | null>(null);
    const [navigationBusy, setNavigationBusy] = useState(false);
    const [activeNavigationLegId, setActiveNavigationLegId] = useState<string | null>(null);
    const [fieldTaskPlan, setFieldTaskPlan] = useState<FieldTaskPlan | null>(null);
    const [fieldTaskStored, setFieldTaskStored] = useState(false);
    const [fieldTaskResult, setFieldTaskResult] = useState<FieldTaskResult | null>(null);
    const fieldSession = useRef({ plan: fieldTaskPlan, result: fieldTaskResult });
    const navigationBusyRef = useRef(false);
    const pendingTaskSave = useRef<FieldTaskPlan | null>(null);
    const navigationPoints = useMemo(() => fieldTaskPlan ? fieldTaskMapPoints(fieldTaskPlan) : navigationMapPoints(navigationDraft), [fieldTaskPlan, navigationDraft]);
    const navigationTargetPoints = useMemo(() => fieldTaskPlan ? fieldTaskTargetPoints(fieldTaskPlan) : navigationFieldVisits(navigationDraft).flatMap(point => point.vehicleCoordinate ? [{ id: point.id, name: point.name, coordinate: point.coordinate, vehicleCoordinate: point.vehicleCoordinate }] : []), [fieldTaskPlan, navigationDraft]);
    const fieldTaskMap = useMemo(() => {
        if (!fieldTaskPlan || !fieldTaskResult) return null;
        try { return fieldTaskRouteMap(fieldTaskPlan, fieldTaskResult.receipt); } catch { return null; }
    }, [fieldTaskPlan, fieldTaskResult]);
    const navigationPickText = fieldTaskPlan && navigationPickId ? navigationPickId.startsWith("task:") ? fieldTaskPlan.tasks.find(task => task.taskId === navigationPickId.slice(5))?.name ?? "核查目标" : "车辆停靠位置" : navigationPickId ? navigationPickLabel(navigationDraft, navigationPickId) : "";
    // Visibility has one owner; task memory is independent of analysis data.
    const [surface, setSurface] = useState<"left" | "right" | "export" | null>(null);
    const [drawerWidth, setDrawerWidth] = useState(DEFAULT_PANEL_WIDTH);
    const leftCollapsed = surface !== "left", rightCollapsed = surface !== "right";
    const setLeftCollapsed = useCallback((closed: boolean) => setSurface(current => closed ? current === "left" ? null : current : "left"), []);
    const setRightCollapsed = useCallback((closed: boolean) => setSurface(current => closed ? current === "right" ? null : current : "right"), []);
    const [swipeEnabled, setSwipeEnabled] = useState(false);
    const drawerTrigger = useRef<HTMLElement | null>(null);
    const rememberTrigger = () => { if (document.activeElement instanceof HTMLElement && !document.activeElement.closest(".workspace-task-drawer,.workspace-export-drawer")) drawerTrigger.current = document.activeElement; };
    const closeSurface = () => { setSurface(null); window.requestAnimationFrame(() => drawerTrigger.current?.focus()); };
    const openLeft = (tab: typeof leftTab) => { rememberTrigger(); setNavigationActive(tab === "route"); setNavigationPickId(null); setLeftTab(tab); setSurface("left"); if (tab === "route") { setSelectionMode("single"); setSwipeEnabled(false); } };
    const openRight = (tab: typeof rightTab) => { rememberTrigger(); setNavigationActive(false); setNavigationPickId(null); setRightTab(tab); setSurface("right"); };
    const activeSection: WorkspaceSection | null = surface === "export" ? "export" : surface === "left" ? leftTab === "data" ? "data" : leftTab === "layers" ? "layers" : leftTab === "route" ? "route" : leftTab === "field" ? "inspection" : "analysis" : surface === "right" ? rightTab === "action" ? "inspection" : "analysis" : null;
    const openSection = (section: WorkspaceSection) => {
        rememberTrigger();
        if (activeSection === section) { closeSurface(); return; }
        if (section === "data" || section === "layers" || section === "route") openLeft(section);
        else if (section === "inspection") openRight("action");
        else if (section === "export") setSurface("export");
        else openRight(rightTab === "action" ? "point" : rightTab);
    };
    const chooseSelection = (mode: typeof selectionMode) => {
        setSelectionMode(mode);
        if (mode === "box" || mode === "polygon") { setSwipeEnabled(false); setSurface(null); }
    };
    const changeNavigationDraft = (draft: NavigationDraft) => {
        if (navigationRouteSignature(draft) !== navigationRouteSignature(navigationDraft)) { setNavigationPlan(null); setActiveNavigationLegId(null); }
        setNavigationDraft(draft);
    };
    const acceptNavigationPlan = (plan: RoadOpsDrivingPlan | null) => { setNavigationPlan(plan); setActiveNavigationLegId(null); };
    const openFieldTasks = (plan: FieldTaskPlan, saved = false) => {
        const next = parseFieldTaskPlan(plan);
        fieldSession.current = { plan: next, result: null }; pendingTaskSave.current = null;
        setFieldTaskPlan(next); setFieldTaskStored(saved); setFieldTaskResult(null);
        setNavigationPlan(null); setNavigationPickId(null); setActiveNavigationLegId(null);
    };
    const changeFieldTasks = (plan: FieldTaskPlan) => {
        const next = parseFieldTaskPlan(plan);
        fieldSession.current = { plan: next, result: null };
        setFieldTaskPlan(next); setFieldTaskResult(null); setActiveNavigationLegId(null);
    };
    const saveFieldTaskMetadata = (saved: FieldTaskPlan) => {
        // An already-started autosave may finish during a paid route request. Defer metadata
        // until the issued snapshot has bound (or failed); never cancel/rebind an in-flight call.
        if (navigationBusyRef.current) { pendingTaskSave.current = saved; return; }
        const session = fieldSession.current;
        if (!session.plan) return;
        const next = syncFieldTaskPlanMetadata(session.plan, saved, session.result?.receipt ?? null);
        const result = next.receipt && session.result ? { ...session.result, receipt: next.receipt } : null;
        fieldSession.current = { plan: next.plan, result };
        setFieldTaskPlan(next.plan); setFieldTaskStored(true); setFieldTaskResult(result);
    };
    const acceptFieldTaskResult = (result: FieldTaskResult | null) => { fieldSession.current = { ...fieldSession.current, result }; setFieldTaskResult(result); setActiveNavigationLegId(null); };
    const adoptFieldTaskCandidate = (plan: FieldTaskPlan, result: FieldTaskResult | null) => {
        const snapshot = parseFieldTaskPlan(plan);
        if (result) fieldTaskRouteMap(snapshot, result.receipt);
        fieldSession.current = { plan: snapshot, result };
        setFieldTaskPlan(snapshot); setFieldTaskResult(result);
        setNavigationPlan(null); setNavigationPickId(null); setActiveNavigationLegId(null);
    };
    const setNavigationRequestBusy = (busy: boolean) => {
        navigationBusyRef.current = busy; setNavigationBusy(busy);
        if (!busy && pendingTaskSave.current) { const saved = pendingTaskSave.current; pendingTaskSave.current = null; saveFieldTaskMetadata(saved); }
    };
    const focusNavigationLeg = (id: string | null) => {
        setActiveNavigationLegId(id);
        const bounds = fieldTaskPlan ? id ? fieldTaskResult?.receipt.legs.find(leg => leg.id === id)?.bounds : fieldTaskMap?.bounds : id ? navigationPlan?.field?.legs.find(leg => leg.id === id)?.bounds : navigationPlan?.map.bounds;
        if (bounds) setMapFocus({ bounds, token: Date.now() });
        if (window.matchMedia("(max-width: 1023px)").matches) setSurface(null);
    };
    const focusNavigationPoint = (coordinate: [number, number]) => {
        setMapFocus({ bounds: [coordinate[0], coordinate[1], coordinate[0], coordinate[1]], token: Date.now() });
        if (window.matchMedia("(max-width: 1023px)").matches) setSurface(null);
    };
    const beginNavigationPick = (id: string | null) => {
        if (navigationBusy) return;
        setNavigationPickId(id);
        if (id && window.matchMedia("(max-width: 1023px)").matches) setSurface(null);
    };
    const pickNavigationCoordinate = (coordinate: [number, number]) => {
        if (!navigationPickId || navigationBusy) return;
        if (fieldTaskPlan) {
            try {
                const next = navigationPickId.startsWith("task:") ? setFieldTaskTargetCoordinate(fieldTaskPlan, navigationPickId.slice(5), coordinate) : setFieldVehicleStopCoordinate(fieldTaskPlan, navigationPickId.slice(5), coordinate);
                fieldSession.current = { plan: next, result: null };
                setFieldTaskPlan(next); setFieldTaskResult(null);
            } catch (error) { setStatus(error instanceof Error ? error.message : "选点未完成，原输入保留。"); return; }
        } else setNavigationDraft(current => setNavigationCoordinate(current, navigationPickId, coordinate));
        setNavigationPlan(null);
        setActiveNavigationLegId(null);
        setNavigationPickId(null);
        setLeftTab("route");
        setSurface("left");
    };
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[role=dialog]")) || document.querySelector(".config-backdrop,.field-photo-lightbox,.rule-summary-backdrop")) return;
            if (navigationPickId) { setNavigationPickId(null); setSurface("left"); return; }
            if (selectionMode === "box" || selectionMode === "polygon") { setSelectionMode("single"); return; }
            if (swipeEnabled) { setSwipeEnabled(false); return; }
            setSurface(null); window.requestAnimationFrame(() => drawerTrigger.current?.focus());
        };
        window.addEventListener("keydown", escape);
        return () => window.removeEventListener("keydown", escape);
    }, [selectionMode, swipeEnabled, navigationPickId]);
    const [patternVisibility, setPatternVisibility] = useState<PatternVisibility>("all");
    const [hiddenModes, setHiddenModes] = useState<string[]>([]);
    const [anomalyView, setAnomalyView] = useState<"clustered" | "isolated" | "excluded">("clustered");
    const anomalyRadiusMeters = priorityOptions.radiusMeters, anomalyMinimumPoints = priorityOptions.minimumPoints;
    const [aiStatus, setAiStatus] = useState<"idle" | "running" | "prepared" | "success" | "error">("idle"), [aiResult, setAiResult] = useState<RegionalInterpretation | null>(null), [aiError, setAiError] = useState(""), [aiPrompt, setAiPrompt] = useState(""), [aiResponseDraft, setAiResponseDraft] = useState(""), [evidenceOpen, setEvidenceOpen] = useState(false);
    const [aiAccessMode, setAiAccessMode] = useState<"site" | "personal">("site"), [personalAiProvider, setPersonalAiProvider] = useState<"bailian" | "deepseek">("bailian"), [personalAiKey, setPersonalAiKey] = useState(""), [showPersonalAiKey, setShowPersonalAiKey] = useState(false), [aiSettingsOpen, setAiSettingsOpen] = useState(false), [aiSettingsMessage, setAiSettingsMessage] = useState("");
    const [portfolioTourStep, setPortfolioTourStep] = useState<1 | 2 | 3 | null>(null);
    const [pascOnlineRun, setPascOnlineRun] = useState<PascOnlineRunState>(emptyPascOnlineRun);
    const [pascExecutionMode, setPascExecutionMode] = useState<"local" | "legacy">("local");
    const [localPascFile, setLocalPascFile] = useState<File | null>(initialImport?.file ?? null);
    const [importCoherenceMin, setImportCoherenceMin] = useState(() => workspaceImportCoherenceMinimum(initialImport?.coherenceMin));
    const [initialImportIdentity] = useState(() => initialImport ? { datasetId: "local-file-" + crypto.randomUUID(), analysisId: "local-analysis-" + crypto.randomUUID() } : null);
    const localImportSettings = useMemo(() => localPascFile && localPascFile === initialImport?.file ? localSettingsForWorkspaceImport(initialImport.mapping ?? initialImport.inspection?.mapping) : undefined, [localPascFile, initialImport]);
    const [priorityScopeIds, setPriorityScopeIds] = useState<string[] | null>(null);
    const [localDataset, setLocalDataset] = useState<PascLocalMapDataset | null>(null);
    const localDatasetRef = useRef<PascLocalMapDataset | null>(null);
    const [localAnalysisIdentity, setLocalAnalysisIdentity] = useState<{ datasetId: string; analysisId: string } | null>(initialImportIdentity);
    const [localSeriesRevision, setLocalSeriesRevision] = useState(0);
    const [localSeriesBusy, setLocalSeriesBusy] = useState(false);
    const [localSeriesError, setLocalSeriesError] = useState("");
    const localHydrationRun = useRef(0);
    const [livePascPoints, setLivePascPoints] = useState<InsarPoint[]>([]);
    const [gisLayers, setGisLayers] = useState<GisLayer[]>([]);
    const [activeGisFeatureId, setActiveGisFeatureId] = useState<string | null>(null);
    const [roadOpsRoutePlan, setRoadOpsRoutePlan] = useState<RoadOpsRouteMapPlan | null>(null);
    const [gisImportBusy, setGisImportBusy] = useState(false);
    const [gisImportMessage, setGisImportMessage] = useState("");
    const roadOpsOsmLoadStarted = useRef(false);
    const [fieldObservations, setFieldObservations] = useState<FieldObservation[]>([]);
    const [activeFieldObservationId, setActiveFieldObservationId] = useState<string | null>(null);
    const [activeFieldPhotoId, setActiveFieldPhotoId] = useState<string | null>(null);
    const [fieldLightboxPhotoId, setFieldLightboxPhotoId] = useState<string | null>(null);
    const [fieldStorageState, setFieldStorageState] = useState<"loading" | "ready" | "session" | "saving">("loading");
    const [fieldStorageHydrated, setFieldStorageHydrated] = useState(false);
    const fieldObservationUrls = useRef(new Set<string>());
    const [jobPreviewId, setJobPreviewId] = useState("");
    const jobPreviewLevel = useRef("");
    const pascRunId = useRef(0);
    const restoreRequested = useRef(false), restoredContextKey = useRef("");
    const deepLinkApplied = useRef(false);
    const fileRef = useRef<HTMLInputElement>(null), qgisRef = useRef<HTMLInputElement>(null);
    const datasetPeriodCount = useMemo(() => localDataset?.periods ?? points.reduce((maximum, point) => Math.max(maximum, point.series.length), 0), [points, localDataset]);
    const mappingDates = useMemo(() => inspection && mapping ? uniqueSortedDateColumns(analyzePascDateColumns(inspection.headers, mapping.timeCols)) : [], [inspection, mapping]);
    const detectionDate = useMemo(() => points.reduce((latest, point) => {
        const last = point.observedDates?.at(-1) || point.dates?.at(-1) || ""; return last > latest ? last : latest;
    }, ""), [points]);
    const priorityInput = useMemo(() => resolveLocalAnomalyScope(points, priorityScopeIds), [points, priorityScopeIds]);
    const anomalyScopeLabel = priorityScopeIds === null ? `全数据 ${points.length.toLocaleString()} 点` : `用户选区 ${priorityInput.length.toLocaleString()} 点`;
    const { selection: prioritySelection, state: priorityState, error: priorityError } = useLocalPriorityAnalysis(priorityInput, Math.max(0, datasetPeriodCount - 1), { ...priorityOptions, coherenceThreshold, evaluationDate: detectionDate || undefined }, 0);
    const roadRiskEvidenceInputs = useMemo<RoadRiskEvidenceInput[]>(() => {
        const insar = prioritySelection.anomalies.slice(0, 200).map(point => ({ id: `insar:${point.id}`, type: "insar" as const, longitude: point.lon, latitude: point.lat, capturedAt: detectionDate || null, confidence: point.modeConfidence ?? point.pasc?.confidence ?? null, summary: `重点形变候选 ${point.id} · 速率 ${point.velocity.toFixed(1)} mm/yr · 累计 ${displacementAt(point, Math.max(0, datasetPeriodCount - 1), detectionDate).toFixed(1)} mm · ${normalizedMode(point.mode)}` }));
        const photos = fieldObservations.flatMap(observation => observation.photos.map(photo => ({ id: `field-photo:${observation.id}:${photo.id}`, type: "field_photo" as const, longitude: observation.longitude, latitude: observation.latitude, capturedAt: photo.capturedAt ?? observation.capturedAt, confidence: photo.coordinateConfidence, summary: `现场照片 ${photo.name} · ${observation.name}${photo.note ? ` · ${photo.note.slice(0, 80)}` : observation.note ? ` · ${observation.note.slice(0, 80)}` : ""}` })));
        const landslides = gisLayers.filter(layer => layer.role === "landslide").flatMap(layer => layer.features.slice(0, 100).flatMap(feature => {
            const bounds = getGeometryBounds(feature.geometry);
            if (!bounds) return [];
            return [{ id: `landslide:${layer.id}:${feature.id}`, type: "landslide" as const, longitude: (bounds.west + bounds.east) / 2, latitude: (bounds.south + bounds.north) / 2, capturedAt: null, confidence: null, summary: `滑坡风险图层 ${layer.name} · 要素 ${feature.id} 中心点近似 · 采集时间未知（导入于 ${layer.importedAt}）` }];
        }));
        return [...insar, ...photos, ...landslides].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
    }, [prioritySelection.anomalies, fieldObservations, gisLayers, detectionDate, datasetPeriodCount]);
    const priorityPointIds = useMemo(() => prioritySelection.anomalies.map(point => point.id), [prioritySelection]);
    const anomalyDataNote = (points[0]?.warnings ?? []).filter(note => note.startsWith("分析范围：") || note.startsWith("时序口径：")).join(" ");
    const priorityLimitedPointIds = useMemo(() => prioritySelection.limited.map(point => point.id), [prioritySelection]);
    const priorityRule = useMemo(() => `${anomalyScopeLabel}；${formatPriorityDeformationRule(prioritySelection)}`, [prioritySelection, anomalyScopeLabel]);
    const effectiveLocalAnalysisId = useMemo(() => localAnalysisIdentity ? createLocalAnalysisId(localAnalysisIdentity.analysisId, { priorityOptions, coherenceThreshold, evaluationDate: detectionDate }, { pointCount: priorityInput.length, pointIds: priorityScopeIds }) : null, [localAnalysisIdentity, priorityOptions, coherenceThreshold, detectionDate, priorityInput.length, priorityScopeIds]);
    useEffect(() => { const timer = window.setTimeout(() => { setNavigationPlan(null); setActiveNavigationLegId(null); setFieldTaskResult(null); }, 0); return () => window.clearTimeout(timer); }, [effectiveLocalAnalysisId]);
    const riskCount = prioritySelection.anomalies.length, qualityCount = useMemo(() => points.filter(p => (p.coherenceSource !== "not_available" && p.coherenceSource !== "default" && Number.isFinite(p.coherence) && p.coherence < coherenceThreshold) || p.missingRate > .2).length, [points, coherenceThreshold]);
    const anomalyRegionResult = prioritySelection.regions;
    const activeAnomalyRegionId = analysis.selectedRegion?.source === "anomalyRegion" ? analysis.selectedRegion.regionId || null : null;
    const activeAnomalyRegion = anomalyRegionResult.regions.find(region => region.id === activeAnomalyRegionId) || null;
    const boxPoints = useMemo(() => {
        if (activeFilter !== "anomaly") return storedBoxPoints;
        if (activeAnomalyRegion) { const ids = new Set(activeAnomalyRegion.pointIds); return prioritySelection.anomalies.filter(point => ids.has(point.id)); }
        return anomalyView === "isolated" ? prioritySelection.isolated : anomalyView === "excluded" ? prioritySelection.excludedLowQuality : prioritySelection.anomalies;
    }, [activeFilter, storedBoxPoints, activeAnomalyRegion, prioritySelection, anomalyView]);
    useEffect(() => {
        if (activeFilter !== "anomaly") return;
        const label = activeAnomalyRegion ? `异常聚集区 ${activeAnomalyRegion.id}` : anomalyView === "isolated" ? "离散大值点 · 未形成聚集" : anomalyView === "excluded" ? "质量排除点 · 不计入异常" : "全部异常聚集点";
        updateAnalysis({ selectedRegion: boxPoints.length ? { bounds: activeAnomalyRegion?.bounds || pointBounds(boxPoints), pointIds: boxPoints.map(point => point.id), label, source: activeAnomalyRegion ? "anomalyRegion" : "anomaly", ...(activeAnomalyRegion ? { regionId: activeAnomalyRegion.id, geometry: activeAnomalyRegion.geometry } : {}) } : null });
    }, [activeFilter, boxPoints, activeAnomalyRegion, anomalyView, updateAnalysis]);
    const hasTimeSeries = datasetPeriodCount >= 2, periodCount = Math.max(1, datasetPeriodCount), currentDate = hasTimeSeries ? (points.find(point => point.dates?.length)?.dates?.[Math.min(timeIndex, periodCount - 1)] || "—") : "速率 / 分类结果";
    const activeFieldDatasetId = localAnalysisIdentity?.datasetId || privateDatasetId || publicDemos[activePublicDemo].datasetId;
    const currentNavigationAnalysisId = priorityState === "ready" ? effectiveLocalAnalysisId ?? createLocalAnalysisId(activeFieldDatasetId, { priorityOptions, coherenceThreshold, evaluationDate: detectionDate }, { pointIds: priorityScopeIds }) : null;
    const hasCoherence = points.some(point => Number.isFinite(point.coherence) && point.coherenceSource !== "not_available" && point.coherenceSource !== "default");
    const hasModes = points.some(point => normalizedMode(point.mode) !== "未分类");
    const renderStyle: RenderStyle = useMemo(() => ({ attribute, min: styleMin, max: styleMax, interval, timeIndex, rangeStart, rangeEnd, colors, dataRevision: localSeriesRevision }), [attribute, styleMin, styleMax, interval, timeIndex, rangeStart, rangeEnd, colors, localSeriesRevision]);
    const activeRamp = colorRampPresets.find(preset => rampSignature(preset.colors) === rampSignature(colors));
    useEffect(() => { if (attribute === "mode") return; const style = defaultColorRange(attribute); setStyleMin(style.min); setStyleMax(style.max); setInterval(style.interval); }, [attribute]);
    const compared = compareIds.map(id => points.find(p => p.id === id)).filter(Boolean) as InsarPoint[], curves = compared.filter(p => curveIds.includes(p.id)), boxIds = useMemo(() => boxPoints.map(p => p.id), [boxPoints]);
    const inspectionCandidates = useMemo(() => buildInspectionCandidates(anomalyRegionResult.regions), [anomalyRegionResult.regions]);
    const mapAnomalyRegions = useMemo(() => {
        if (activeFilter !== "anomaly" || anomalyView !== "clustered") return [];
        const sorted = [...anomalyRegionResult.regions].sort((a, b) => b.pointCount - a.pointCount || a.id.localeCompare(b.id)).slice(0, 500);
        const active = anomalyRegionResult.regions.find(region => region.id === activeAnomalyRegionId);
        return active && !sorted.some(region => region.id === active.id) ? [...sorted.slice(0, 499), active] : sorted;
    }, [activeFilter, anomalyRegionResult.regions, activeAnomalyRegionId, anomalyView]);
    const loadOptionalRoadBaseline = () => {
        if (roadOpsOsmLoadStarted.current) return;
        roadOpsOsmLoadStarted.current = true;
        setGisImportBusy(true);
        setGisImportMessage("正在加载江东新区 OSM 开源基线路网…");
        void loadRoadOpsOsmLayer().then(layer => {
            setGisLayers(current => current.some(item => item.id === layer.id) ? current : [layer, ...current]);
            setGisImportMessage(`已加载 ${layer.featureCount.toLocaleString()} 条 OSM 道路线；本地资产，不消耗地图 API 额度。`);
        }).catch(error => {
            roadOpsOsmLoadStarted.current = false;
            setGisImportMessage(error instanceof Error ? error.message : "RoadOps OSM 本地资产加载失败");
        }).finally(() => setGisImportBusy(false));
    };
    const selectedAoiGeometry = useMemo(() => {
        const region = analysis.selectedRegion;
        if (!region || (region.source !== "rectangle" && region.source !== "polygon" && region.source !== "anomalyRegion")) return null;
        return region.geometry || rectangleGeometry(region.bounds);
    }, [analysis.selectedRegion]);
    const loadSelectedAoiSeries = useCallback((method: AoiAggregateMethod, signal?: AbortSignal) => {
        if (!localDataset) return Promise.reject(new Error("本地分析来源已失效，请重新导入。"));
        return loadLocalAoiSeries(localDataset, boxPoints, method, signal);
    }, [localDataset, boxPoints]);
    useEffect(() => {
        if (!localDataset) return;
        let active = true;
        queueMicrotask(() => { if (active) { setLocalSeriesBusy(true); setLocalSeriesError(""); } });
        void (async () => {
            await localDataset.loadDisplayTime(timeIndex);
            if (attribute === "stageVelocity") { await localDataset.loadStageVelocity(rangeStart, rangeEnd); }
            if (active && localDatasetRef.current === localDataset) setLocalSeriesRevision(revision => revision + 1);
        })().catch(error => { if (active) setLocalSeriesError(error instanceof Error ? error.message : "本地时序读取失败，请重新导入。"); }).finally(() => { if (active) setLocalSeriesBusy(false); });
        return () => { active = false; };
    }, [localDataset, timeIndex, attribute, rangeStart, rangeEnd]);
    const boxStats = useMemo(() => {
        const summary = summarizeAoi(boxPoints, timeIndex, coherenceThreshold, point => normalizedMode(point.mode), selectedAoiGeometry);
        return summary ? {
            ...summary,
            dataRevision: localSeriesRevision,
            avg: summary.meanVelocity,
            minVelocity: summary.minimumVelocity,
            maxVelocity: summary.maximumVelocity,
            max: summary.maximumAbsoluteDisplacement,
            averageCurrent: summary.meanCurrentDisplacement,
            quality: summary.qualityConcernCount,
            modes: summary.modeCounts,
        } : null;
    }, [boxPoints, coherenceThreshold, timeIndex, selectedAoiGeometry, localSeriesRevision]);
    const compareStats = useMemo(() => { const summary = summarizeComparison(compared, timeIndex); return summary ? { ...summary, dataRevision: localSeriesRevision } : null; }, [compared, timeIndex, localSeriesRevision]);
    const dataBackedCases = useMemo(() => localDataset ? [] : buildDataBackedQuickCases(points), [points, localDataset]);
    const analysisRuleSummary = useMemo(() => buildAnalysisRuleSummary({
        datasetName: datasetTitle,
        datasetId: localAnalysisIdentity?.datasetId || privateDatasetId || publicDemos[activePublicDemo].datasetId,
        analysisId: currentNavigationAnalysisId,
        anomalyScope: anomalyScopeLabel,
        timeRange: analysis.timeRange,
        displayMode: attributeNames[attribute],
        displayRange: attribute === "mode" ? "PASC 固定六类配色" : `${styleMin}—${styleMax} · 间距 ${interval}`,
        patternVisibility: patternVisibility === "all" ? "显示全部模式" : patternVisibility === "anomaly_with_undefined" ? "异常模式 + 未定义型" : "仅异常模式",
        activeFilter: activeFilter === "none" ? "未启用额外筛选" : activeFilter === "velocity" ? `速率 ≤ ${threshold} mm/yr` : activeFilter === "coherence" ? `相干性 < ${coherenceThreshold.toFixed(2)}` : activeFilter === "anomaly" ? (anomalyView === "clustered" ? "双指标达标且空间聚集" : anomalyView === "isolated" ? "离散大值点，不计入异常" : "质量排除点，不计入异常") : activeFilter === "pascLowConfidence" ? "PASC 低置信度" : "PASC 空间适用性有限",
        coherenceThreshold,
        anomalyRadiusMeters,
        anomalyMinimumPoints,
        selectionSource: analysis.selectedRegion?.label || (selected ? `点位 ${selected.id}` : "尚未建立分析对象"),
        selectedPointCount: boxPoints.length || (selected ? 1 : 0),
        priorityRuleVersion: prioritySelection.ruleVersion,
        priorityDirection: prioritySelection.direction,
        priorityEvaluationDate: detectionDate,
        priorityAnomalyCount: prioritySelection.anomalies.length,
        priorityIsolatedCount: prioritySelection.isolated.length,
        priorityExcludedCount: prioritySelection.excludedLowQuality.length,
        priorityDisplacementThresholdMm: prioritySelection.thresholds.displacementMm,
        priorityVelocityThresholdMmPerYear: prioritySelection.thresholds.velocityMmPerYear,
        priorityCandidateCount: prioritySelection.candidates.length,
        priorityReliableCount: prioritySelection.reliable.length,
        priorityLimitedCount: prioritySelection.limited.length,
    }), [currentNavigationAnalysisId, anomalyScopeLabel, datasetTitle, localAnalysisIdentity, privateDatasetId, activePublicDemo, analysis.timeRange, analysis.selectedRegion, attribute, styleMin, styleMax, interval, patternVisibility, activeFilter, threshold, coherenceThreshold, anomalyRadiusMeters, anomalyMinimumPoints, boxPoints.length, selected, prioritySelection, detectionDate, anomalyView]);
    const pascCandidateCount = parseReport?.compatibility.pascCandidatePoints ?? points.filter(point => (point.effectiveEpochCount ?? point.series.length) >= 20).length;
    const pascBlockingIssues = (parseReport?.compatibility.issues ?? []).filter(issue => issue.severity === "error" || issue.severity === "confirmation").map(issue => issue.message);
    const pascLowConfidenceCount = points.filter(point => typeof point.modeConfidence === "number" && point.modeConfidence < 0.6).length;
    const pascLimitedReferenceCount = points.filter(point => point.spatialApplicability === "limited_reference").length;
    const importVisiblePointIds = useMemo(() => workspaceImportVisiblePointIds(points, importCoherenceMin), [points, importCoherenceMin]);
    const filteredPointCount = activeFilter !== "none" || analysis.selectedRegion ? boxPoints.length : importVisiblePointIds?.length ?? points.length;
    const filteredMapPointIds = useMemo(() => {
        const chosen = activeFilter === "none" ? null : boxPoints.map(point => point.id);
        if (!importVisiblePointIds) return chosen;
        if (!chosen) return importVisiblePointIds;
        const allowed = new Set(importVisiblePointIds);
        return chosen.filter(id => allowed.has(id));
    }, [activeFilter, boxPoints, importVisiblePointIds]);
    const filteredMapPointIdSet = useMemo(() => filteredMapPointIds ? new Set(filteredMapPointIds) : null, [filteredMapPointIds]);
    const patternVisiblePoints = useMemo(() => filterPointsForModes(filterPointsForPattern(points, patternVisibility), hiddenModes).filter(point => !filteredMapPointIdSet || filteredMapPointIdSet.has(point.id)), [points, patternVisibility, hiddenModes, filteredMapPointIdSet]);
    const mapVisiblePointCount = attribute === "mode" ? patternVisiblePoints.length : filteredMapPointIds?.length ?? points.length;
    const spatialPointIndex = useMemo(() => new SpatialGridIndex<InsarPoint>(0.01).load(points), [points]);
    const localAiPoints = useMemo(() => {
        if (boxPoints.length) return boxPoints;
        const bounds = analysis.mapView?.bounds;
        if (!bounds) return points;
        return spatialPointIndex.queryBounds({ west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3] });
    }, [boxPoints, points, spatialPointIndex, analysis.mapView?.bounds]);
    const localAiContext = useMemo(() => ({
        points: localAiPoints,
        allPoints: points,
        scopeLabel: boxPoints.length ? analysis.selectedRegion?.label || "当前筛选 / AOI" : "当前地图视野",
        scopeBounds: analysis.mapView?.bounds ? { west: analysis.mapView.bounds[0], south: analysis.mapView.bounds[1], east: analysis.mapView.bounds[2], north: analysis.mapView.bounds[3] } : null,
        activePoint: selected,
        layers: gisLayers,
    }), [localAiPoints, points, boxPoints.length, analysis.selectedRegion?.label, analysis.mapView?.bounds, selected, gisLayers]);
    const contextRegionStats = useMemo<SelectedRegionStats | null>(() => boxStats ? { pointCount: boxPoints.length, averageVelocity: boxStats.avg, maximumDisplacement: boxStats.max, timeSeriesAvailable: hasTimeSeries, qualityCount: boxStats.quality, modeCounts: boxStats.modes, averageDisplacement: boxStats.averageCurrent, averageCoherence: boxStats.averageCoherence, minimumVelocity: boxStats.minVelocity, maximumVelocity: boxStats.maxVelocity, areaKm2: boxStats.areaKm2, medianVelocity: boxStats.medianVelocity, medianDisplacement: boxStats.medianCurrentDisplacement, lowCoherenceCount: boxStats.lowCoherenceCount, missingDataCount: boxStats.missingDataCount, velocityHistogram: buildVelocityHistogram(boxPoints) } : null, [boxStats, boxPoints, hasTimeSeries]);
    const regionalAiInput = useMemo(() => {
        if (!boxStats || !boxPoints.length) return null;
        const modeSources = [...new Set(boxPoints.map(point => point.modeSource?.trim()).filter(Boolean) as string[])];
        const descriptions = { none: "未启用额外筛选", velocity: `速率 ≤ ${threshold} mm/yr`, coherence: `相干性 < ${coherenceThreshold.toFixed(2)}`, anomaly: `${priorityRule}；当前查看${anomalyView === "clustered" ? "异常聚集点" : anomalyView === "isolated" ? "离散候选，不计异常" : "质量排除点，不计异常"}`, pascLowConfidence: "PASC 低置信度结果", pascLimitedSpatial: "PASC 空间适用性有限结果" } as const;
        return {
            datasetName: datasetTitle,
            regionLabel: analysis.selectedRegion?.label || (activeFilter === "none" ? "自定义矩形区域" : "当前筛选结果"),
            selectionSource: analysis.selectedRegion?.source || "unknown",
            pointCount: boxPoints.length,
            timeRange: { startDate: points[0]?.dates?.[rangeStart] || "—", endDate: points[0]?.dates?.[rangeEnd] || "—" },
            filterDescription: `${descriptions[activeFilter]}${hasTimeSeries ? "" : "；源文件未提供逐期累计形变，累计形变统计为不可用占位，禁止作为 0 mm 结果解释"}`,
            meanVelocity: boxStats.avg,
            averageDisplacement: boxStats.averageCurrent,
            maximumDisplacement: boxStats.max,
            averageCoherence: boxStats.averageCoherence,
            qualityCount: boxStats.quality,
            patternDistribution: Object.fromEntries(Object.entries(boxStats.modes).map(([mode, count]) => [mode, count / boxPoints.length * 100])),
            modeSource: modeSources.length ? modeSources.slice(0, 3).join("、") : null,
        };
    }, [boxStats, boxPoints, threshold, coherenceThreshold, datasetTitle, analysis.selectedRegion, activeFilter, points, rangeStart, rangeEnd, hasTimeSeries, priorityRule, anomalyView]);
    const regionalAiSummary = useMemo(() => {
        if (!regionalAiInput || !boxPoints.length) return null;
        try { return buildAnalysisSummary({ points: boxPoints, anomalyPointIds: priorityPointIds, datasetLabel: datasetTitle, timeRange: regionalAiInput.timeRange, filterDescription: regionalAiInput.filterDescription, coherenceThreshold, selectedRegion: analysis.selectedRegion, selectedRegionAreaKm2: boxStats?.areaKm2, mapView: analysis.mapView }); }
        catch { return null; }
    }, [regionalAiInput, boxPoints, datasetTitle, coherenceThreshold, analysis.selectedRegion, analysis.mapView, boxStats?.areaKm2, priorityPointIds]);
    const aiContextSignature = regionalAiSummary ? JSON.stringify(regionalAiSummary) : "no-region";
    useEffect(() => { setAiStatus("idle"); setAiResult(null); setAiError(""); setEvidenceOpen(false); }, [aiContextSignature]);
    useEffect(() => {
        if (!dataReady || (restoreRequested.current && !restoredContextKey.current)) return;
        const dates = points[0]?.dates || [], start = Math.min(rangeStart, Math.max(0, dates.length - 1)), end = Math.min(rangeEnd, Math.max(0, dates.length - 1));
        const descriptions = { none: "未启用", velocity: `速率 ≤ ${threshold} mm/yr`, coherence: `相干性 < ${coherenceThreshold.toFixed(2)}`, anomaly: `${priorityRule}；当前查看${anomalyView === "clustered" ? "异常聚集点" : anomalyView === "isolated" ? "离散候选，不计异常" : "质量排除点，不计异常"}`, pascLowConfidence: "PASC 低置信度结果", pascLimitedSpatial: "PASC 空间适用性有限结果" } as const;
        updateAnalysis({ datasetId: localAnalysisIdentity?.datasetId || privateDatasetId || publicDemos[activePublicDemo].datasetId, datasetName: datasetTitle, timeRange: { startIndex: start, endIndex: end, startDate: dates[start] || "—", endDate: dates[end] || "—" }, filters: { active: activeFilter, velocityMax: activeFilter === "velocity" ? threshold : null, coherenceMin: activeFilter === "coherence" || activeFilter === "anomaly" ? coherenceThreshold : importCoherenceMin, resultCount: filteredPointCount, description: importCoherenceMin === null ? descriptions[activeFilter] : `${descriptions[activeFilter]}；导入显示相干性 ≥ ${importCoherenceMin.toFixed(2)}` }, activeColorMode: attribute, patternVisibility, selectedPointId: selected?.id || null, selectedRegionStats: contextRegionStats });
    }, [localAnalysisIdentity, privateDatasetId, activePublicDemo, datasetTitle, points, rangeStart, rangeEnd, activeFilter, threshold, coherenceThreshold, importCoherenceMin, filteredPointCount, attribute, patternVisibility, selected?.id, contextRegionStats, updateAnalysis, dataReady, priorityRule, anomalyView]);
    const handleMapViewChange = useCallback((mapView: AnalysisMapView) => {
        if (restoreRequested.current && !restoredContextKey.current) return;
        updateAnalysis({ mapView });
    }, [updateAnalysis]);
    useEffect(() => { const stored = localStorage.getItem("lanjifyw-tianditu-key") || "", custom = localStorage.getItem("lanjifyw-custom-basemap") || ""; setTdtKey(stored); setKeyDraft(stored); setCustomBasemap(custom); setCustomDraft(custom); }, []);
    useEffect(() => {
        const urls = fieldObservationUrls.current;
        return () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
    }, []);
    useEffect(() => {
        let cancelled = false;
        void loadFieldObservations().then(observations => {
            if (cancelled) {
                observations.forEach(observation => observation.photos.forEach(photo => URL.revokeObjectURL(photo.photoUrl)));
                return;
            }
            observations.forEach(observation => observation.photos.forEach(photo => fieldObservationUrls.current.add(photo.photoUrl)));
            setFieldObservations(observations);
            setFieldStorageState("ready");
        }).catch(() => setFieldStorageState("session")).finally(() => { if (!cancelled) setFieldStorageHydrated(true); });
        return () => { cancelled = true; };
    }, []);
    useEffect(() => {
        if (!fieldStorageHydrated) return;
        const timer = window.setTimeout(() => {
            setFieldStorageState(current => current === "session" ? current : "saving");
            void saveFieldObservations(fieldObservations).then(() => setFieldStorageState("ready")).catch(() => setFieldStorageState("session"));
        }, 180);
        return () => window.clearTimeout(timer);
    }, [fieldObservations, fieldStorageHydrated]);
    useEffect(() => {
        const pointIds = new Set(points.map(point => point.id));
        const timer = window.setTimeout(() => setFieldObservations(current => current.map(observation => reconcileInsarLinks(observation, activeFieldDatasetId, pointIds))), 0);
        return () => window.clearTimeout(timer);
    }, [activeFieldDatasetId, points]);
    useEffect(() => { if (initialImport) return; const params = new URLSearchParams(window.location.search); if (!params.get("dataset")) trackEvent("demo_start", { demo_id: params.get("demo") === "landslide" ? "lajia-landslide-public" : params.get("demo") === "road" ? "haikou-jiangdong-road-public" : "haikou-public", entry: params.get("demo") ? "explicit_demo" : "map_default" }); }, [initialImport]);
    useEffect(() => { if (initialImport || new URLSearchParams(window.location.search).get("tour") !== "portfolio") return; const taskTourTimer = window.setTimeout(() => { setPortfolioTourStep(1); setLeftCollapsed(true); setRightCollapsed(false); }, 0); return () => window.clearTimeout(taskTourTimer); }, [initialImport]);
    useEffect(() => {
        if (initialImport || !dataReady || deepLinkApplied.current) return;
        const params = new URLSearchParams(window.location.search);
        const requestedPanel = params.get("panel") || (params.get("demo") === "road" ? "route" : null);
        if (requestedPanel === "route") {
            const timer = window.setTimeout(() => { deepLinkApplied.current = true; setLeftTab("route"); setNavigationActive(true); setSelectionMode("single"); setSwipeEnabled(false); setSurface("left"); }, 0);
            return () => window.clearTimeout(timer);
        }
        if (requestedPanel !== "ai" && requestedPanel !== "action" && requestedPanel !== "field" && requestedPanel !== "filters") return;
        const settingsTimer = window.setTimeout(() => {
            deepLinkApplied.current = true;
            if (requestedPanel === "field" || requestedPanel === "filters") {
                setLeftTab(requestedPanel);
                setLeftCollapsed(false);
                setRightCollapsed(true);
                if (requestedPanel === "filters") setAttribute("mode");
                return;
            }
            setRightTab(requestedPanel);
            setRightCollapsed(false);
            setLeftCollapsed(true);
            if (requestedPanel === "ai" && params.get("settings") === "personal") {
                setAiAccessMode("personal");
                setAiSettingsOpen(true);
            }
        }, 0);
        return () => window.clearTimeout(settingsTimer);
    }, [initialImport, dataReady, setLeftCollapsed, setRightCollapsed]);
    useEffect(() => { if (!initialImport && new URLSearchParams(window.location.search).get("intent") === "upload") {
        setLeftTab("data"); setLeftCollapsed(false);
        setStatus("上传自己的数据：请确认 CSV 字段要求，然后选择本地文件。");
    } }, [initialImport]);
    const saveAnalysisMeta = async (id: string, nextMapping: CsvMapping, result: DatasetParseResult) => { if (USER_DATA_LOCAL_ONLY) return; await patchPrivateDataset(id, { mapping: nextMapping, qualityReport: result.quality, schemaStatus: "validated", processStatus: "validated" }).catch(() => null); };
    const applyResult = (result: DatasetParseResult, label: string, preserveAnalysis = false) => { localHydrationRun.current += 1; localDatasetRef.current = null; setLocalDataset(null); setPriorityScopeIds(null); setLocalAnalysisIdentity(null); setLocalSeriesError(""); setLocalSeriesBusy(false); setNavigationPlan(null); const lastPeriod = Math.max(0, result.periods - 1), periodLabel = result.periods ? `${result.periods} 期` : "速率 / 分类结果"; pascRunId.current += 1; setPascOnlineRun(emptyPascOnlineRun); setLivePascPoints([]); setPoints(result.points); setSelected(null); setDatasetTitle(result.datasetTitle); setTimeIndex(lastPeriod); setRangeStart(0); setRangeEnd(lastPeriod); if (!result.periods) setAttribute("velocity"); setCompareIds([]); setCurveIds([]); setActiveQuickCaseId(null); setMapFocus(null); setBoxPoints([]); setActiveFilter("none"); setRightTab("point"); if (!preserveAnalysis) { setPatternVisibility("all"); setHiddenModes([]); } if (!preserveAnalysis) updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null }); setParseReport(result); setDataReady(true); setStatus(`${label} · ${result.points.length.toLocaleString()} 点 · ${periodLabel} · 模式字段 ${result.modeField} · 过滤 ${result.invalid} 条`); trackEvent("dataset_loaded", { dataset_type: privateDatasetId ? "private" : label.includes("公开示例") ? "demo" : "local", point_count: result.points.length, period_count: result.periods, invalid_count: result.invalid }); };
    const loadPublicDemo = (demoId: PublicDemoId, options: { updateUrl?: boolean; preserveAnalysis?: boolean } = {}) => {
        setImportCoherenceMin(null);
        const demo = publicDemos[demoId];
        setBusy(`正在加载${demo.label}案例…`);
        setStatus(`正在读取${demo.label}公开示例数据…`);
        fetch(demo.file).then(response => {
            if (!response.ok) throw new Error(`${demo.label}示例数据不可用`);
            return response.text();
        }).then(text => {
            const found = inspectCsv(text);
            const demoMapping: CsvMapping = { ...found.mapping, displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "toward_satellite_positive", preprocessingState: "already_smoothed" };
            const result = parseMappedCsv(text, `${demo.label}示例数据.csv`, demoMapping, false);
            result.datasetTitle = demo.title;
            setPrivateDatasetId("");
            setActivePublicDemo(demoId);
            setDemoDepth("quick");
            setInspection(found);
            setMapping(demoMapping);
            applyResult(result, `${demo.label}公开示例`, options.preserveAnalysis);
            if (!options.preserveAnalysis && new URLSearchParams(window.location.search).get("panel") !== "filters") setAttributeState(result.periods ? "displacement" : "velocity");
            setMapFocus({ bounds: pointBounds(result.points), token: Date.now() });
            setStatus(`${demo.label}真实数据 · ${result.points.length.toLocaleString()} 点 · ${result.periods ? `${result.periods} 期` : "速率 / 分类结果"} · ${demo.dataNote}`);
            if (options.updateUrl) {
                const url = new URL(window.location.href);
                url.search = "";
                url.searchParams.set("demo", demoId);
                window.history.replaceState({}, "", url);
            }
        }).catch(error => setStatus(error instanceof Error ? error.message : `${demo.label}示例加载失败`)).finally(() => setBusy(""));
    };
    const chooseFullCaseFile = (demoId: PublicDemoId) => {
        if (accountSession.status !== "authenticated") { onRequireAccount(); return; }
        const demo = publicDemos[demoId];
        setActivePublicDemo(demoId);
        setDemoDepth("full");
        setPascExecutionMode("local");
        setRightTab("pasc");
        setRightCollapsed(false);
        setStatus(`${demo.label}完整数据：${demo.fullHint}`);
        fileRef.current?.click();
    };
    const chooseImportFile = () => {
        if (accountSession.status !== "authenticated") { onRequireAccount(); return; }
        fileRef.current?.click();
    };
    const applyLocalResult = (result: PascLocalMapDataset, session?: LocalAnalysisSession) => { localHydrationRun.current += 1; localDatasetRef.current = result; setLocalDataset(result); setPriorityScopeIds(null); setLocalAnalysisIdentity(session ? { datasetId: session.datasetId, analysisId: session.analysisId } : { datasetId: "local-file-" + crypto.randomUUID(), analysisId: "local-analysis-" + crypto.randomUUID() }); setLocalSeriesError(""); setLocalSeriesBusy(false); setNavigationPlan(null); setActiveNavigationLegId(null); if (fieldTaskPlan?.tasks.some(task => task.inspectionSource)) { setFieldTaskResult(null); setStatus("原考察任务来源已变化，请使用新的异常候选。"); } pascRunId.current += 1; setPascOnlineRun(emptyPascOnlineRun); setLivePascPoints([]); setPrivateDatasetId(""); setInspection(null); setMapping(null); setParseReport(null); setPoints(result.points); setSelected(null); setDatasetTitle(result.title); setTimeIndex(result.periods - 1); setRangeStart(0); setRangeEnd(result.periods - 1); setCompareIds([]); setCurveIds([]); setActiveQuickCaseId(null); setMapFocus({ bounds: pointBounds(result.points), token: Date.now() }); setBoxPoints([]); setActiveFilter("none"); setPatternVisibility("all"); setHiddenModes([]); setRightTab("pasc"); setAttribute("mode"); setVisible(current => ({ ...current, points: true })); updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null }); setDataReady(true); setStatus(`浏览器本地分析完成 · 全点 ${result.points.length.toLocaleString()} · 已分类 ${result.totalPredictedPoints.toLocaleString()} · ${result.periods} 期 · 无效 ${result.invalidRows.toLocaleString()} 行 · 原始 CSV 未上传`); trackEvent("dataset_loaded", { dataset_type: "local_onnx", point_count: result.totalPredictedPoints, map_point_count: result.points.length, period_count: result.periods, invalid_count: result.invalidRows }); };
    const discardLocalAnalysis = () => {
        localHydrationRun.current += 1; localDatasetRef.current = null; setLocalDataset(null); setLocalAnalysisIdentity(null); setPriorityScopeIds(null); setLocalSeriesBusy(false); setLocalSeriesError("");
        setPoints([]); setSelected(null); setBoxPoints([]); setCompareIds([]); setCurveIds([]); setLivePascPoints([]); setActiveFilter("none"); setNavigationPlan(null); setActiveNavigationLegId(null); setFieldTaskResult(null); setParseReport(null);
        updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null }); setStatus("当前临时分析结果已清理，考察目标保留但来源失效；可用原始文件重新分析。");
    };
    const loadShowcaseDemo = () => { setBusy("正在六类模式教学示例…"); fetch("/data/haikou-pasc-showcase.csv").then(response => { if (!response.ok) throw new Error("Showcase Demo 不可用"); return response.text(); }).then(text => { const found = inspectCsv(text), demoMapping: CsvMapping = { ...found.mapping, displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "toward_satellite_positive", preprocessingState: "already_smoothed" }, result = parseMappedCsv(text, "海口 PASC Showcase.csv", demoMapping, false); result.datasetTitle = "海口 PASC-TCN 248 期 Showcase Demo"; setPrivateDatasetId(""); applyResult(result, "海口 PASC Showcase Demo"); setStatus(`Showcase Demo · ${result.points.length.toLocaleString()} 点 · 248 期 · 每类 500 点；仅用于六类界面覆盖，不代表科学类别比例`); }).catch(error => setStatus(error instanceof Error ? error.message : "Showcase Demo 加载失败")).finally(() => setBusy("")); };
    useEffect(() => { if (initialImport) return; const params = new URLSearchParams(window.location.search); restoreRequested.current = params.get("restore") === "analysis";
        if (USER_DATA_LOCAL_ONLY && (params.get("job") || params.get("dataset") || params.get("source") === "local" || params.get("intent") === "upload")) {
            restoreRequested.current = false;
            setPascExecutionMode("local"); setPrivateDatasetId(""); setPoints([]); setSelected(null);
            setDatasetTitle("本机 CSV · 等待选择文件"); setDataReady(true); setLeftTab("data"); setSurface("left");
            setStatus("已登录，请选择当前电脑的 CSV。账户用于访问管理，文件、计算与结果留在当前设备，云端数据与分类服务已关闭。");
            return;
        }
        const previewJobId = params.get("job"); if (previewJobId) { setPascExecutionMode("legacy"); jobPreviewLevel.current = ""; setJobPreviewId(previewJobId); setStatus("正在读取 Phase F 多级地图预览…"); return; } const privateId = params.get("dataset"); if (privateId) {
        setPascExecutionMode("legacy");
        setPrivateDatasetId(privateId);
        setBusy("正在读取账户私有数据…");
        listPrivateDatasets<{ items?: Array<{ id: string; name: string; chunks: number; analysisReady: boolean; mapping?: CsvMapping }> }>().then(async (list) => { const meta = (list.items || []).find(item => item.id === privateId); if (!meta)
            throw new Error("当前账户中不存在该数据集"); if (!meta.analysisReady)
            throw new Error("该数据集仅完成私有归档，文件过大，暂不支持浏览器直接分析。");
            const text = await readPrivateDatasetSource(privateId, meta.chunks), found = inspectCsv(text), saved = meta.mapping as CsvMapping | undefined, nextMapping = saved?.lon ? { ...found.mapping, ...saved } : found.mapping, result = parseMappedCsv(text, meta.name, nextMapping, true); setInspection(found); setMapping(nextMapping); applyResult(result, meta.name, restoreRequested.current); if (!saved?.lon)
            await saveAnalysisMeta(privateId, nextMapping, result);
            const largeJobId = params.get("largeJob");
            if (largeJobId) await loadPascLargeJobResults(largeJobId, result.points);
            else await runPascOnlineRecognition(result.points, meta.name, nextMapping.preprocessingState, privateId);
        }).catch(e => setStatus(e instanceof Error ? e.message : "私有数据读取失败")).finally(() => setBusy(""));
        return;
    }
        const demoId: PublicDemoId = params.get("demo") === "landslide" ? "landslide" : params.get("demo") === "road" ? "road" : "haikou";
        if (params.get("scope") === "full") {
            setActivePublicDemo(demoId);
            setDemoDepth("full");
            setLeftTab("data");
            setPoints([]);
            setSelected(null);
            setDatasetTitle(`${publicDemos[demoId].label}完整数据 · 等待选择本机 CSV`);
            setStatus(`${publicDemos[demoId].label}完整数据入口已就绪；请在左侧选择本机完整 CSV。`);
            setDataReady(true);
            return;
        }
        loadPublicDemo(demoId, { preserveAnalysis: restoreRequested.current });
    }, [initialImport]);
    useEffect(() => {
        if (!initialImport || !initialImportIdentity || !isAnalysisReady) return;
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            const result = initialImport.result;
            if (result) applyResult(result, initialImport.file.name);
            else { setPoints([]); setDatasetTitle(initialImport.file.name); setDataReady(true); }
            setInspection(initialImport.inspection ?? null);
            setMapping(initialImport.mapping ?? initialImport.inspection?.mapping ?? null);
            setPrivateDatasetId("");
            setLocalAnalysisIdentity(initialImportIdentity);
            setImportCoherenceMin(workspaceImportCoherenceMinimum(initialImport.coherenceMin));
            setLocalPascFile(initialImport.file);
            setPascExecutionMode("local");
            setRightTab("pasc"); setSurface("right");
            if (result?.points.length) setMapFocus({ bounds: pointBounds(result.points), token: Date.now() });
            updateAnalysis({ datasetId: initialImportIdentity.datasetId, datasetName: result?.datasetTitle ?? initialImport.file.name, selectedPointId: null, selectedRegion: null, selectedRegionStats: null, mapView: null });
            setStatus(`${initialImport.file.name} · ${result ? "已接入已确认数据" : "等待本机分析"}；原始文件保留在当前页面，确认设置后可手动开始本机分类。`);
        });
        return () => { cancelled = true; };
        // Import initialization must not repeat when map controls or analysis state change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialImport, initialImportIdentity, isAnalysisReady]);
    useEffect(() => {
        if (USER_DATA_LOCAL_ONLY || !jobPreviewId) return;
        const zoom = analysis.mapView?.zoom ?? 9, level = pascMapLevelForZoom(zoom);
        if (jobPreviewLevel.current === level) return;
        jobPreviewLevel.current = level;
        const controller = new AbortController();
        setBusy(`正在加载 ${level === "map_level_0" ? "500 点概览" : level === "map_level_1" ? "2,000 点区域" : "5,000 点细节"}抽样…`);
        Promise.all([
            fetch(`/v1/jobs/${encodeURIComponent(jobPreviewId)}`, { credentials: "include", cache: "no-store", signal: controller.signal }),
            fetch(`/v1/jobs/${encodeURIComponent(jobPreviewId)}/map?zoom=${zoom}`, { credentials: "include", cache: "no-store", signal: controller.signal }),
        ]).then(async ([jobResponse, mapResponse]) => {
            const jobBody = await jobResponse.json().catch(() => null) as { job?: PascPublicJob; error?: { message?: string } } | null;
            if (!jobResponse.ok || !jobBody?.job) throw new Error(jobBody?.error?.message || "任务状态读取失败。");
            const mapBody = await mapResponse.json().catch(() => null) as { error?: { message?: string } } | null;
            if (!mapResponse.ok) throw new Error(mapBody?.error?.message || "任务地图预览读取失败。");
            const preview = parsePascMapPreview(mapBody);
            if (preview.jobId !== jobPreviewId) throw new Error("任务地图标识不匹配。");
            setPrivateDatasetId(jobBody.job.datasetId); setPoints(preview.points); setSelected(null); setDatasetTitle(`${jobBody.job.datasetName} · Phase F 抽样预览`);
            setTimeIndex(0); setRangeStart(0); setRangeEnd(0); setCompareIds([]); setCurveIds([]); setBoxPoints([]); setActiveFilter("none"); setPatternVisibility("all"); setRightTab("pasc");
            setAttributeState("mode"); setVisible(current => ({ ...current, points: true })); setInspection(null); setMapping(null); setParseReport(null); setDataReady(true);
            setStatus(`Phase F ${stageLabelsForPreview(level)} · 当前 ${preview.points.length.toLocaleString()} 个确定性抽样点 / 共 ${preview.totalPredictedPoints.toLocaleString()} 个识别结果；缩放地图会切换层级，不加载全量数据。`);
        }).catch(error => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            jobPreviewLevel.current = ""; setDataReady(true); setStatus(`${error instanceof Error ? error.message : "任务地图预览读取失败。"} 当前地图数据已保留。`);
        }).finally(() => { if (!controller.signal.aborted) setBusy(""); });
        return () => controller.abort();
    }, [jobPreviewId, analysis.mapView?.zoom]);
    useEffect(() => {
        if (!isAnalysisReady || !dataReady || !restoreRequested.current || restoredContextKey.current) return;
        const currentDatasetId = privateDatasetId || publicDemos[activePublicDemo].datasetId;
        if (analysis.datasetId !== currentDatasetId) return;
        const restoredPoints = analysis.selectedRegion?.pointIds.map(id => points.find(point => point.id === id)).filter(Boolean) as InsarPoint[] | undefined;
        const maxIndex = Math.max(0, (points[0]?.series.length || 1) - 1), start = Math.min(analysis.timeRange.startIndex, maxIndex), end = Math.min(analysis.timeRange.endIndex, maxIndex);
        setRangeStart(Math.min(start, end)); setRangeEnd(Math.max(start, end)); setTimeIndex(Math.max(start, end)); setAttribute(analysis.activeColorMode);
        if (analysis.filters.velocityMax !== null) setThreshold(analysis.filters.velocityMax);
        if (analysis.filters.coherenceMin !== null) setCoherenceThreshold(analysis.filters.coherenceMin);
        setActiveFilter(analysis.filters.active);
        setPatternVisibility(analysis.patternVisibility);
        if (restoredPoints?.length) { setBoxPoints(restoredPoints); setSelectionMode(analysis.selectedRegion?.source === "rectangle" ? "box" : analysis.selectedRegion?.source === "polygon" ? "polygon" : "single"); setRightTab("region"); }
        if (analysis.selectedPointId) { const point = points.find(item => item.id === analysis.selectedPointId); if (point) { setSelected(point); setRightTab("point"); } }
        restoredContextKey.current = `${analysis.datasetId}:${analysis.timeRange.startIndex}:${analysis.timeRange.endIndex}:${analysis.selectedRegion?.pointIds.length || 0}`;
        setStatus("已恢复地图范围、时间区间、筛选条件与分析对象");
    }, [analysis, dataReady, isAnalysisReady, points, privateDatasetId]);
    const inspectFile = async (file?: File) => { if (!file)
        return; if (!await requireAccountSession()) { onRequireAccount(); return; } onRequireAccount(); trackEvent("dataset_upload_start", { source: "map_local", file_size_bytes: file.size }); if (pascExecutionMode === "local" || USER_DATA_LOCAL_ONLY) {
        setImportCoherenceMin(null);
        localHydrationRun.current += 1;
        localDatasetRef.current = null; setLocalDataset(null); setPriorityScopeIds(null); setLocalAnalysisIdentity(null);
        setPoints([]); setSelected(null); setBoxPoints([]); setCompareIds([]); setCurveIds([]);
        setNavigationPlan(null); setFieldTaskResult(null); setActiveNavigationLegId(null);
        setPrivateDatasetId(""); setDatasetTitle(file.name); setActiveFilter("none");
        setLocalSeriesBusy(false); setLocalSeriesError("");
        updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null });
        setLocalPascFile(file);
        setRightTab("pasc");
        setRightCollapsed(false);
        setStatus(`${file.name} 已交给 Local 模式；确认单位、符号与预处理后开始浏览器本地分析。`);
        if (fileRef.current) fileRef.current.value = "";
        return;
    } if (file.size > 300 * 1024 * 1024) {
        trackEvent("dataset_upload_fail", { source: "map_local", reason: "browser_size_limit", file_size_bytes: file.size });
        setStatus("Legacy 字段映射不读取 300 MB 以上文件；请切换到 PASC 的 Local 模式，使用最高 1 GiB 的浏览器分块分析。");
        setGuideOpen(true);
        return;
    } setBusy("正在读取字段…"); try {
        const text = await file.text(), found = inspectCsv(text);
        setPending({ text, name: file.name, file });
        setInspection(found);
        setMapping(found.mapping);
        setMappingOpen(true);
    }
    catch (e) {
        trackEvent("dataset_upload_fail", { source: "map_local", reason: "read_failed", file_size_bytes: file.size });
        setStatus(e instanceof Error ? e.message : "CSV 读取失败");
    }
    finally {
        setBusy("");
        if (fileRef.current)
            fileRef.current.value = "";
    } };
    const confirmMapping = () => { if (!pending || !mapping)
        return; try {
        const result = parseMappedCsv(pending.text, pending.name, mapping, true);
        applyResult(result, pending.name, false);
        trackEvent("dataset_upload_success", { source: "map_local", point_count: result.points.length, period_count: result.periods, invalid_count: result.invalid });
        if (privateDatasetId)
            saveAnalysisMeta(privateDatasetId, mapping, result);
        setMappingOpen(false);
        setReportOpen(false);
        if (USER_DATA_LOCAL_ONLY) {
            setPascExecutionMode("local"); setLocalPascFile(pending.file ?? null); setRightTab("pasc"); setSurface("right"); setStatus(LOCAL_DATA_ONLY_MESSAGE);
        } else void runPascOnlineRecognition(result.points, result.datasetTitle, mapping.preprocessingState);
    }
    catch (e) {
        trackEvent("dataset_upload_fail", { source: "map_local", reason: "mapping_or_parse_failed" });
        setStatus(e instanceof Error ? e.message : "CSV 解析失败");
    } };
    const setAttribute = (next: RenderAttribute) => { if (next !== attribute && (next === "mode" || attribute === "mode")) trackEvent("pattern_view_switch", { from: attribute, to: next }); setAttributeState(next); if (next === "coherence") {
        setStyleMin(0);
        setStyleMax(1);
        setInterval(.2);
    }
    else if (next === "missing") {
        setStyleMin(0);
        setStyleMax(100);
        setInterval(20);
    } };
    const applyPatternVisibility = (next: PatternVisibility) => {
        const shown = filterPointsForPattern(points, next).length;
        setPatternVisibility(next);
        setAttribute("mode");
        setVisible(current => ({ ...current, points: true }));
        trackEvent("pattern_visibility_filter", { mode: next, result_count: shown, total_count: points.length });
        setStatus(next === "all" ? `已恢复全部 ${points.length.toLocaleString()} 个监测点。` : `PASC 异常优先显示：${shown.toLocaleString()} / ${points.length.toLocaleString()} 点；原始数据未被删除。`);
    };
    const toggleModeVisibility = (mode: string) => {
        setHiddenModes(current => {
            const hidden = current.includes(mode), next = hidden ? current.filter(item => item !== mode) : [...current, mode];
            const shown = filterPointsForModes(filterPointsForPattern(points, patternVisibility), next).length;
            setStatus(`${hidden ? "已显示" : "已隐藏"}“${mode}”，当前显示 ${shown.toLocaleString()} / ${points.length.toLocaleString()} 点。`);
            trackEvent("mode_legend_filter", { mode, hidden: !hidden, result_count: shown, total_count: points.length });
            return next;
        });
        setAttribute("mode");
        setVisible(current => ({ ...current, points: true }));
    };
    const selectHydratedPoint = useCallback((point: InsarPoint) => { trackEvent("point_click", { selection_mode: selectionMode, deformation_mode: normalizedMode(point.mode), result_count: 1 }); setRightTab("point"); setRightCollapsed(false); setLeftCollapsed(true); setActiveQuickCaseId(null); if (selectionMode === "compare" || selectionMode === "compareBox") {
        setCompareIds(ids => { const update = updateComparison(ids, point.id); if (update.action === "limit") { setStatus(`多点对比最多选择 ${MAX_COMPARE_POINTS} 个点；请先移除一个点再继续。`); return update.ids; } if (update.action === "removed") {
            setCurveIds(current => current.filter(id => id !== point.id));
            setSelected(current => current?.id === point.id ? null : current);
            return update.ids;
        } setCurveIds(current => [...current.filter(id => update.ids.includes(id)), point.id].slice(0, MAX_COMPARE_POINTS)); setSelected(point); setStatus(`已加入对比：${point.id} · ${update.ids.length}/${MAX_COMPARE_POINTS}`); return update.ids; });
    }
    else {
        setSelected(point);
        const linked = fieldObservations.find(observation => observation.links.some(link => link.datasetId === activeFieldDatasetId && link.insarPointId === point.id && link.status === "confirmed-primary"));
        setActiveFieldObservationId(linked?.id ?? null);
        setActiveFieldPhotoId(linked?.photos[0]?.id ?? null);
    } }, [selectionMode, fieldObservations, activeFieldDatasetId]);
    const selectPoint = useCallback((point: InsarPoint) => {
        const dataset = localDatasetRef.current;
        if (!dataset) { selectHydratedPoint(point); return; }
        const request = ++localHydrationRun.current;
        setLocalSeriesBusy(true); setLocalSeriesError("");
        void dataset.hydratePoints([point.id]).then(loaded => {
            if (request !== localHydrationRun.current || localDatasetRef.current !== dataset) return;
            if (!loaded[0]) throw new Error("当前点不属于这份CSV，请重新选择。");
            selectHydratedPoint({ ...loaded[0] }); setLocalSeriesRevision(revision => revision + 1);
        }).catch(error => { if (request === localHydrationRun.current) setLocalSeriesError(error instanceof Error ? error.message : "点位曲线读取失败。"); }).finally(() => { if (request === localHydrationRun.current) setLocalSeriesBusy(false); });
    }, [selectHydratedPoint]);
    const toggleCurve = (id: string) => setCurveIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
    const removeCompared = (id: string) => { setCompareIds(ids => ids.filter(item => item !== id)); setCurveIds(ids => ids.filter(item => item !== id)); setSelected(current => current?.id === id ? null : current); };
    const activateQuickCase = (item: DataBackedQuickCase) => {
        const chosen = item.pointIds.map(id => points.find(point => point.id === id)).filter(Boolean) as InsarPoint[], focus = chosen.find(point => point.id === item.focusPointId) || chosen[0];
        if (!focus) { setStatus("当前数据已变化，快捷案例没有可定位的点，请重新加载数据。"); return; }
        const ids = chosen.slice(0, MAX_COMPARE_POINTS).map(point => point.id);
        setActiveQuickCaseId(item.id); setSelectionMode(ids.length > 1 ? "compare" : "single"); setCompareIds(ids); setCurveIds(ids); setSelected(focus); setBoxPoints([]); setActiveFilter("none"); setRightTab("point"); setRightCollapsed(false); setLeftCollapsed(true); setMapFocus({ bounds: item.bounds, token: Date.now() });
        updateAnalysis({ selectedPointId: focus.id, selectedRegion: null, selectedRegionStats: null });
        setStatus(`已定位“${item.title}” · ${ids.length} 个真实监测点 · 已打开 ${focus.id} 详情。`);
        trackEvent("data_backed_case_open", { case_id: item.id, point_count: ids.length, dataset_type: privateDatasetId ? "private" : "public_or_local" });
    };
    const clearSelection = () => { setSelected(null); setActiveFieldObservationId(null); setCompareIds([]); setCurveIds([]); setActiveQuickCaseId(null); updateAnalysis({ selectedPointId: null }); setStatus("已清除选点，保留区域与筛选"); };
    const clearFilters = () => {
        setImportCoherenceMin(null);
        setActiveFilter("none"); setPatternVisibility("all"); setHiddenModes([]);
        if (analysis.selectedRegion?.source !== "rectangle" && analysis.selectedRegion?.source !== "polygon") {
            setBoxPoints([]); updateAnalysis({ selectedRegion: null, selectedRegionStats: null });
        }
        setStatus("已清除筛选条件，保留手绘区域与选点");
    };
    const clearRegionSelection = () => { setBoxPoints([]); setActiveFilter("none"); updateAnalysis({ selectedRegion: null, selectedRegionStats: null }); setStatus("已清除区域选择与筛选结果"); };
    const handleBoxSelect = useCallback((chosen: InsarPoint[], bounds: [
        number,
        number,
        number,
        number
    ]) => { trackEvent("region_select", { selection_type: "rectangle", result_count: chosen.length }); setSelectionMode("box"); setRightTab("region"); setRightCollapsed(false); setLeftCollapsed(true); setActiveFilter("none"); setSelected(null); setCompareIds([]); setCurveIds([]); setBoxPoints(chosen); updateAnalysis({ selectedPointId: null, selectedRegion: { bounds, geometry: rectangleGeometry(bounds), pointIds: chosen.map(point => point.id), label: "自定义矩形区域", source: "rectangle" } }); setStatus(`矩形区域统计：已框选 ${chosen.length.toLocaleString()} 个点。聚合时序默认使用中位数。`); }, [updateAnalysis]);
    const handlePolygonSelect = useCallback((chosen: InsarPoint[], bounds: [number, number, number, number], coordinates: AoiCoordinate[]) => {
        trackEvent("region_select", { selection_type: "polygon", result_count: chosen.length, vertex_count: coordinates.length });
        setSelectionMode("polygon"); setRightTab("region"); setRightCollapsed(false); setLeftCollapsed(true); setActiveFilter("none"); setSelected(null); setCompareIds([]); setCurveIds([]); setBoxPoints(chosen);
        updateAnalysis({ selectedPointId: null, selectedRegion: { bounds, geometry: { type: "polygon", coordinates }, pointIds: chosen.map(point => point.id), label: "自定义多边形区域", source: "polygon" } });
        setStatus(`多边形区域统计：${coordinates.length} 个顶点内选中 ${chosen.length.toLocaleString()} 个点。聚合时序默认使用中位数。`);
    }, [updateAnalysis]);
    const chooseBase = (value: string) => { setBase(value); if ((value.startsWith("tdt") && !tdtKey) || value === "custom")
        setSourceOpen(true); }, saveKey = () => { const value = keyDraft.trim(), custom = customDraft.trim(); localStorage.setItem("lanjifyw-tianditu-key", value); localStorage.setItem("lanjifyw-custom-basemap", custom); setTdtKey(value); setCustomBasemap(custom); setSourceOpen(false); if (value || custom)
        setStatus("图源配置已保存在当前浏览器"); };
    useEffect(() => { const move = (event: PointerEvent) => { const target = (event.target as HTMLElement).closest<HTMLElement>(".spotlight-card,.selection-summary>div,.schema-grid article,.report-metrics article"); if (!target)
        return; target.classList.add("spotlight-card"); const rect = target.getBoundingClientRect(); target.style.setProperty("--pointer-x", `${((event.clientX - rect.left) / rect.width) * 100}%`); target.style.setProperty("--pointer-y", `${((event.clientY - rect.top) / rect.height) * 100}%`); }; window.addEventListener("pointermove", move); return () => window.removeEventListener("pointermove", move); }, []);
    const importRamp = async (file?: File) => { if (!file)
        return; const parsed = parseQgisRamp(await file.text()); if (parsed.length < 2) {
        setStatus("未从 QGIS QML/XML 中识别到至少两个颜色");
        return;
    } setColors(parsed); setStatus(`已导入 QGIS 色带 · ${parsed.length} 个颜色节点`); };
    const selectColorRamp = (preset: ColorRampPreset) => {
        setColors([...preset.colors]);
        setStatus(`已切换色带：${preset.label}`);
    };
    const applyThreshold = () => { const chosen = points.filter(p => p.velocity <= threshold); trackEvent("filter_apply", { filter_type: "velocity", threshold, result_count: chosen.length }); trackEvent("region_select", { selection_type: "velocity_filter", result_count: chosen.length }); setSelectionMode("single"); setActiveFilter("velocity"); setBoxPoints(chosen); setRightTab("region"); setRightCollapsed(false); setLeftCollapsed(true); setSelected(null); updateAnalysis({ selectedPointId: null, selectedRegion: { bounds: pointBounds(chosen), pointIds: chosen.map(point => point.id), label: `速率 ≤ ${threshold} mm/yr`, source: "filter" } }); setStatus(`阈值筛选：速率 ≤ ${threshold} mm/yr · ${chosen.length.toLocaleString()} 点`); };
    const setSafeCoherenceThreshold = (value: number) => { setCoherenceThreshold(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))); if (activeFilter === "anomaly") updateAnalysis({ selectedRegion: null }); };
    const applyCoherenceFilter = () => { const chosen = points.filter(p => p.coherence > 0 && p.coherence < coherenceThreshold); trackEvent("filter_apply", { filter_type: "coherence", threshold: coherenceThreshold, result_count: chosen.length }); trackEvent("region_select", { selection_type: "coherence_filter", result_count: chosen.length }); setSelectionMode("single"); setActiveFilter("coherence"); setAttribute("coherence"); setBoxPoints(chosen); setVisible(v => ({ ...v, quality: true })); setRightTab("region"); setSelected(null); updateAnalysis({ selectedPointId: null, selectedRegion: { bounds: pointBounds(chosen), pointIds: chosen.map(point => point.id), label: `低相干 < ${coherenceThreshold.toFixed(2)}`, source: "filter" } }); setStatus(`低相干筛选：相干性 < ${coherenceThreshold.toFixed(2)} · ${chosen.length.toLocaleString()} 点`); };
    const showAllAnomalyPoints = (message?: string, view: typeof anomalyView = "clustered") => {
        setAnomalyView(view); setSelectionMode("single"); setActiveFilter("anomaly"); setAttribute("velocity"); setSelected(null); setCompareIds([]); setCurveIds([]); setPatternVisibility("all"); setHiddenModes([]); setRightTab("region"); setRightCollapsed(false); setLeftCollapsed(true); setLeftTab("anomaly"); setVisible(value => ({ ...value, points: true }));
        updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null });
        if (message) setStatus(message);
    };
    const discoverAnomalies = () => {
        trackEvent("filter_apply", { filter_type: "anomaly_discovery", result_count: prioritySelection.anomalies.length, excluded_low_quality: prioritySelection.excludedLowQuality.length });
        showAllAnomalyPoints(`发现 ${prioritySelection.anomalies.length.toLocaleString()} 个聚集异常点 · ${anomalyRegionResult.regions.length} 个区域；${prioritySelection.isolated.length} 个离散大值点单列待查。`);
    };
    const applyAnomalyRules = (options: PriorityDeformationOptions) => {
        const resolved = normalizePriorityOptions(options);
        setPriorityOptions(resolved); setCoherenceThreshold(resolved.coherenceThreshold);
        showAllAnomalyPoints("规则已应用，地图与统计已更新。异常需双指标达标且同向聚集。");
    };
    const focusAnomalyRegion = useCallback((region: AnomalyRegion) => {
        trackEvent("region_select", { selection_type: "anomaly_region", region_id: region.id, result_count: region.pointCount });
        setAnomalyView("clustered"); setSelectionMode("single"); setActiveFilter("anomaly"); setAttributeState("velocity"); setSelected(null); setCompareIds([]); setCurveIds([]); setPatternVisibility("all"); setHiddenModes([]); setRightTab("region"); setRightCollapsed(false); setLeftCollapsed(true);
        updateAnalysis({ selectedPointId: null, selectedRegion: { bounds: region.bounds, geometry: region.geometry, regionId: region.id, pointIds: region.pointIds, label: `异常聚集区 ${region.id}`, source: "anomalyRegion" } });
        setStatus(`正在查看 ${region.id}：${region.pointCount.toLocaleString()} 个双指标达标的同向聚集点。`);
    }, [updateAnalysis]);
    const useSelectedAnomalyScope = () => { if (!boxPoints.length) return; setPriorityScopeIds(boxPoints.map(point => point.id)); showAllAnomalyPoints("正在按所选范围完整重算异常；范围外点仍可在地图查看。"); openLeft("anomaly"); };
    const discoverInspectionCandidates = () => { discoverAnomalies(); setRightTab("action"); };
    const focusInspectionCandidate = (region: AnomalyRegion) => { focusAnomalyRegion(region); setRightTab("action"); };
    const inspectionNavigationContext = () => ({ datasetId: activeFieldDatasetId, analysisId: effectiveLocalAnalysisId ?? createLocalAnalysisId(activeFieldDatasetId, { priorityOptions, coherenceThreshold, evaluationDate: detectionDate }, { pointIds: priorityScopeIds }), datasetTitle, observationDate: detectionDate || currentDate, ruleSummary: priorityRule });
    const acceptInspectionNavigation = (next: NavigationDraft, added: boolean) => {
        setFieldTaskPlan(null); setFieldTaskResult(null); setFieldTaskStored(false);
        changeNavigationDraft(next); openLeft("route");
        setStatus(added ? "已加入真实考察目标，请确认车辆到达点和出发地后规划路线。" : "该考察目标已在行程中，请确认车辆到达点。");
    };
    const addPointToRoute = (point: InsarPoint) => {
        try { const result = addInspectionPointToNavigation(fieldTaskPlan ? fieldTaskPlanToNavigationDraft(fieldTaskPlan) : navigationDraft, point, inspectionNavigationContext()); acceptInspectionNavigation(result.draft, result.added); }
        catch (error) { setStatus(error instanceof Error ? error.message : "无法加入考察目标。"); }
    };
    const addRegionToRoute = (region: AnomalyRegion) => {
        try { const result = addInspectionRegionToNavigation(fieldTaskPlan ? fieldTaskPlanToNavigationDraft(fieldTaskPlan) : navigationDraft, region, prioritySelection.anomalies, inspectionNavigationContext()); acceptInspectionNavigation(result.draft, result.added); }
        catch (error) { setStatus(error instanceof Error ? error.message : "无法加入考察区域。"); }
    };
    const changeAnomalyRegionParameters = (radiusMeters: number, minimumPoints: number) => {
        applyAnomalyRules({ ...priorityOptions, coherenceThreshold, radiusMeters, minimumPoints });
    };
    async function loadPascLargeJobResults(jobId: string, sourcePoints: InsarPoint[], activeRunId?: number) {
        if (USER_DATA_LOCAL_ONLY) { setStatus(LOCAL_DATA_ONLY_MESSAGE); return; }
        const runId = activeRunId ?? ++pascRunId.current;
        setRightTab("pasc");
        setStatus("正在连接后台分类任务；已完成的批次会立即显示到地图…");
        const sourceById = new Map(sourcePoints.map(point => [point.id, point]));
        const classified = new Map<string, InsarPoint>();
        const summary = { points: 0, predicted: 0, lowConfidence: 0, limitedReference: 0 };
        let serviceVersion: string | null = null;
        let buildHash: string | null = null;
        let loadedChunks = 0;
        let finalJob: PascPublicJob | null = null;
        setPascOnlineRun({ ...emptyPascOnlineRun, status: "running", totalPoints: sourcePoints.length, totalBatches: Math.ceil(sourcePoints.length / PHASE_E_MAX_POINTS) });
        while (runId === pascRunId.current) {
            if (document.visibilityState !== "visible") {
                await new Promise(resolve => window.setTimeout(resolve, PASC_MAP_HIDDEN_WAIT_MS));
                continue;
            }
            const detailResponse = await fetch(`/api/pasc-jobs?op=detail&id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
            const detailBody = await detailResponse.json().catch(() => null) as { job?: PascPublicJob; error?: { message?: string } } | null;
            if (!detailResponse.ok || !detailBody?.job) throw new Error(detailBody?.error?.message || "后台分类任务读取失败。");
            const job = detailBody.job;
            finalJob = job;
            if (job.status === "failed" || job.status === "cancelled") throw new Error(job.error?.message || (job.status === "cancelled" ? "后台分类任务已取消。" : "后台分类任务失败。"));
            const availableChunks = Math.min(job.chunks.current, job.chunks.total);
            while (loadedChunks < availableChunks) {
                const index = loadedChunks;
                setStatus(`后台已完成第 ${index + 1} / ${job.chunks.total} 批，正在同步到形变模式图层…`);
                const response = await fetch(`/api/pasc-jobs?op=result&id=${encodeURIComponent(jobId)}&index=${index}`, { credentials: "include", cache: "no-store" });
                const body = await response.json().catch(() => null) as { points?: Array<{ pointId?: string }>; error?: { message?: string } } | null;
                if (!response.ok || !Array.isArray(body?.points)) throw new Error(body?.error?.message || `第 ${index + 1} 批结果读取失败。`);
                const batchPoints = body.points.map(item => sourceById.get(String(item.pointId || ""))).filter(Boolean) as InsarPoint[];
                const merged = mergePascOnlineResults(batchPoints, body);
                if (serviceVersion && serviceVersion !== merged.response.serviceVersion) throw new Error("后台分批结果的服务版本不一致。");
                if (buildHash && buildHash !== merged.response.modelPackage.buildHash) throw new Error("后台分批结果的模型包不一致。");
                serviceVersion = merged.response.serviceVersion;
                buildHash = merged.response.modelPackage.buildHash;
                merged.points.forEach(point => classified.set(point.id, point));
                summary.points += merged.response.summary.points;
                summary.predicted += merged.response.summary.predicted;
                summary.lowConfidence += merged.response.summary.lowConfidence;
                summary.limitedReference += merged.response.summary.limitedReference;
                loadedChunks += 1;
                setLivePascPoints([...classified.values()]);
                if (loadedChunks === 1) {
                    setAttribute("mode");
                    setVisible(current => ({ ...current, points: true }));
                }
                setPascOnlineRun({ status: "running", error: "", completedAt: null, summary: { ...summary }, serviceVersion, buildHash, processedPoints: summary.predicted, totalPoints: job.points.total, completedBatches: loadedChunks, totalBatches: job.chunks.total });
            }
            if (job.status === "completed" && loadedChunks >= job.chunks.total) break;
            const retry = job.status === "retry_wait" ? " · 服务正在自动重试" : "";
            setStatus(`后台分类 ${job.progress.toFixed(1)}% · 已上图 ${summary.predicted.toLocaleString()} 点${retry}`);
            await new Promise(resolve => window.setTimeout(resolve, PASC_MAP_JOB_POLL_MS));
        }
        if (runId !== pascRunId.current || !finalJob) return;
        const job = finalJob;
        const mergedPoints = sourcePoints.map(point => classified.get(point.id) ?? point);
        setPoints(mergedPoints);
        setLivePascPoints([]);
        setSelected(current => current ? mergedPoints.find(point => point.id === current.id) ?? null : null);
        setBoxPoints(current => current.map(point => classified.get(point.id) ?? point));
        setAttribute("mode");
        setVisible(current => ({ ...current, points: true }));
        setPascOnlineRun({ status: "success", error: "", completedAt: new Date().toISOString(), summary, serviceVersion, buildHash, processedPoints: summary.predicted, totalPoints: job.points.total, completedBatches: job.chunks.total, totalBatches: job.chunks.total });
        setStatus(`后台 PASC 自动分类完成 · ${summary.predicted.toLocaleString()} 点 · 共 ${job.chunks.total} 批 · 分类过程已逐批上图`);
    }
    async function runPascOnlineRecognition(
        sourcePoints: InsarPoint[] = points,
        sourceTitle: string = datasetTitle,
        sourcePreprocessing: CsvMapping["preprocessingState"] = mapping?.preprocessingState,
        sourceDatasetId: string = privateDatasetId,
    ) {
        if (USER_DATA_LOCAL_ONLY) { setPascExecutionMode("local"); setStatus(LOCAL_DATA_ONLY_MESSAGE); return; }
        const runId = ++pascRunId.current;
        setLivePascPoints([]);
        try {
            const candidateTotal = sourcePoints.filter(point => (point.effectiveEpochCount ?? point.series.length) >= 20).length;
            if (candidateTotal > PASC_AUTO_CLASSIFY_MAX_POINTS) {
                if (!sourceDatasetId) throw new Error(`当前 ${candidateTotal.toLocaleString()} 个候选点需要后台任务；请先登录并将 CSV 保存为私有数据集。`);
                setStatus(`正在创建 ${candidateTotal.toLocaleString()} 点后台自动分类任务…`);
                const response = await fetch("/api/pasc-jobs?op=create", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datasetId: sourceDatasetId }) });
                const body = await response.json().catch(() => null) as { job?: PascPublicJob; created?: boolean; error?: { message?: string } } | null;
                if (!response.ok || !body?.job) throw new Error(body?.error?.message || "后台分类任务创建失败。");
                setPascOnlineRun({ ...emptyPascOnlineRun, totalPoints: candidateTotal, totalBatches: Math.ceil(candidateTotal / PHASE_E_MAX_POINTS) });
                setStatus(`已进入后台自动分类 · ${candidateTotal.toLocaleString()} 点；本页将把已完成批次实时显示到形变模式图层。`);
                await loadPascLargeJobResults(body.job.jobId, sourcePoints, runId);
                return;
            }
            const requests = buildPascOnlineRequestBatches(sourcePoints, sourceTitle, sourcePreprocessing);
            const sourceById = new Map(sourcePoints.map(point => [point.id, point]));
            const classified = new Map<string, InsarPoint>();
            const summary = { points: 0, predicted: 0, lowConfidence: 0, limitedReference: 0 };
            let serviceVersion: string | null = null;
            let buildHash: string | null = null;
            const totalPoints = requests.reduce((total, request) => total + request.points.length, 0);
            setPascOnlineRun({ ...emptyPascOnlineRun, status: "running", totalPoints, totalBatches: requests.length });
            setRightTab("pasc");
            for (let index = 0; index < requests.length; index += 1) {
                if (runId !== pascRunId.current) return;
                const request = requests[index];
                setStatus(`正在自动识别第 ${index + 1} / ${requests.length} 批 · ${request.points.length.toLocaleString()} 个候选点…`);
                const response = await fetch("/api/pasc/infer", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(request),
                });
                const body = await response.json().catch(() => null);
                if (!response.ok) throw new Error(onlineErrorMessage(body));
                if (runId !== pascRunId.current) return;
                const batchPoints = request.points.map(item => sourceById.get(item.pointId)).filter(Boolean) as InsarPoint[];
                const merged = mergePascOnlineResults(batchPoints, body);
                if (serviceVersion && serviceVersion !== merged.response.serviceVersion) throw new Error("分批识别返回了不一致的服务版本；地图结果未更新。");
                if (buildHash && buildHash !== merged.response.modelPackage.buildHash) throw new Error("分批识别返回了不一致的模型包；地图结果未更新。");
                serviceVersion = merged.response.serviceVersion;
                buildHash = merged.response.modelPackage.buildHash;
                merged.points.forEach(point => classified.set(point.id, point));
                setLivePascPoints([...classified.values()]);
                if (index === 0) {
                    setAttribute("mode");
                    setVisible(current => ({ ...current, points: true }));
                }
                summary.points += merged.response.summary.points;
                summary.predicted += merged.response.summary.predicted;
                summary.lowConfidence += merged.response.summary.lowConfidence;
                summary.limitedReference += merged.response.summary.limitedReference;
                setPascOnlineRun({
                    status: "running", error: "", completedAt: null, summary: { ...summary }, serviceVersion, buildHash,
                    processedPoints: summary.predicted, totalPoints, completedBatches: index + 1, totalBatches: requests.length,
                });
            }
            if (runId !== pascRunId.current) return;
            const mergedPoints = sourcePoints.map(point => classified.get(point.id) ?? point);
            setPoints(mergedPoints);
            setLivePascPoints([]);
            setSelected(current => current ? mergedPoints.find(point => point.id === current.id) ?? null : null);
            setBoxPoints(current => current.map(point => classified.get(point.id) ?? point));
            setAttribute("mode");
            setVisible(current => ({ ...current, points: true }));
            setPascOnlineRun({
                status: "success", error: "", completedAt: new Date().toISOString(), summary,
                serviceVersion, buildHash, processedPoints: summary.predicted, totalPoints,
                completedBatches: requests.length, totalBatches: requests.length,
            });
            setStatus(`PASC 自动识别完成 · ${summary.predicted.toLocaleString()} 点 · 低置信度 ${summary.lowConfidence.toLocaleString()} · 空间受限 ${summary.limitedReference.toLocaleString()} · 地图已切换六类固定色`);
        } catch (error) {
            if (runId !== pascRunId.current) return;
            const message = error instanceof Error ? error.message : "自动识别失败；当前地图数据与已有结果已保留。";
            setPascOnlineRun(current => ({ ...current, status: "error", error: message }));
            setStatus(message);
        }
    }
    const applyPascResultFilter = (filter: PascOnlineFilter) => {
        const chosen = filterPascOnlinePoints(points, filter);
        const active = filter === "lowConfidence" ? "pascLowConfidence" : "pascLimitedSpatial";
        const label = filter === "lowConfidence" ? "PASC 低置信度结果" : "PASC 空间适用性有限结果";
        setSelectionMode("single"); setActiveFilter(active); setAttribute("mode"); setBoxPoints(chosen); setSelected(null); setCompareIds([]); setCurveIds([]); setRightTab("region"); setRightCollapsed(false); setLeftCollapsed(true);
        updateAnalysis({ selectedPointId: null, selectedRegion: chosen.length ? { bounds: pointBounds(chosen), pointIds: chosen.map(point => point.id), label, source: "filter" } : null });
        setStatus(`${label} · ${chosen.length.toLocaleString()} 点 · 已使用 PASC 六类固定色`);
    };
    const runAiInterpretation = async () => {
        if (USER_DATA_LOCAL_ONLY) { setAiStatus("error"); setAiError("本站已关闭外部 AI；请使用上方本机数据分析助手。"); return; }
        if (!regionalAiInput || !regionalAiSummary) { trackEvent("ai_analysis_fail", { reason: "missing_region_context" }); setAiStatus("error"); setAiError("请先在“区域分析”中框选区域，或运行“发现异常”建立分析对象。"); return; }
        if (aiAccessMode === "personal" && personalAiKey.trim().length < 8) { setAiStatus("error"); setAiError("请先在 AI 服务设置中填写有效的个人 API Key。"); return; }
        setAiStatus("running"); setAiResult(null); setAiError(""); setEvidenceOpen(false);
        trackEvent("ai_analysis_start", { point_count: regionalAiSummary.pointCount, selection_source: regionalAiInput.selectionSource, summary_bytes: analysisSummaryBytes(regionalAiSummary), credential_mode: aiAccessMode, provider: aiAccessMode === "personal" ? personalAiProvider : "site_default" });
        try {
            const requestPayload = aiAccessMode === "personal" ? { summary: regionalAiSummary, personalProvider: { provider: personalAiProvider, apiKey: personalAiKey.trim() } } : { summary: regionalAiSummary };
            const response = await fetch("/api/ai/interpret", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(requestPayload) });
            const body = await response.json().catch(() => null) as { interpretation?: unknown; error?: { message?: string } } | null;
            if (!response.ok || !body?.interpretation) throw new Error(body?.error?.message || "AI 服务没有返回有效结果。");
            const parsed = sanitizeRegionalInterpretation(body.interpretation);
            setAiResult(parsed); setAiStatus("success"); setStatus(`${parsed.engineLabel} · ${parsed.cached ? "已复用近期结果" : "解读完成"}`);
            trackEvent("ai_analysis_success", { point_count: regionalAiSummary.pointCount, engine: parsed.engine, provider: parsed.provider, cached: parsed.cached });
        } catch (error) {
            const message = error instanceof Error ? error.message : "AI 区域解读失败，请稍后重试。";
            setAiError(message); setAiStatus("error"); setStatus(message); trackEvent("ai_analysis_fail", { reason: message.slice(0, 120) });
        }
    };
    const prepareAiInterpretation = async () => {
        if (USER_DATA_LOCAL_ONLY) { setAiStatus("error"); setAiError("本站已关闭外部 AI；数据摘要保留在当前电脑。"); return; }
        if (!regionalAiInput || !regionalAiSummary) { trackEvent("ai_analysis_fail", { reason: "missing_region_context" }); setAiStatus("error"); setAiError("请先在“区域分析”中框选区域，或运行“发现异常”建立分析对象。"); return; }
        const prompt = buildDeepSeekWebPrompt(regionalAiSummary);
        setAiPrompt(prompt); setAiResult(null); setAiError(""); setAiStatus("prepared");
        trackEvent("ai_analysis_prepare", { point_count: regionalAiSummary.pointCount, selection_source: regionalAiInput.selectionSource, summary_bytes: analysisSummaryBytes(regionalAiSummary) });
        try { await navigator.clipboard.writeText(prompt); setStatus("受限摘要提示词已复制；请手动粘贴到 DeepSeek 免费网页版"); }
        catch { setStatus("浏览器未允许剪贴板；请从 AI 面板手动复制提示词"); }
    };
    const importAiInterpretation = () => {
        try { const parsed = parseDeepSeekWebInterpretation(aiResponseDraft); setAiResult(parsed); setAiStatus("success"); setAiError(""); trackEvent("ai_analysis_import", { point_count: regionalAiSummary?.pointCount ?? 0, engine: parsed.engineLabel }); }
        catch (error) { setAiError(error instanceof Error ? error.message : "无法导入 DeepSeek 返回结果。"); setAiStatus("error"); }
    };
    const showPrimaryModes = () => { setAttribute("mode"); setRightTab("region"); setStatus("已切换为形变模式着色，并保留当前区域分析结果"); };
    const runExport = async (label: string, task: () => void | Promise<void>) => {
        if (exportOperation.state === "running") return;
        setExportOperation({ state: "running", message: `正在生成${label}…` });
        try { await task(); setExportOperation({ state: "success", message: `${label}已生成并开始下载。` }); }
        catch (error) { const message = error instanceof Error ? error.message : `${label}生成失败`; setExportOperation({ state: "error", message }); setStatus(message); }
    };
    const downloadAiSummary = () => {
        if (!aiResult || !regionalAiInput) return;
        const lines = ["澜迹 InSAR · 区域 AI 解读", "", `数据集：${regionalAiInput.datasetName}`, `分析范围：${regionalAiInput.regionLabel}`, `有效点数：${regionalAiInput.pointCount}`, `时间范围：${regionalAiInput.timeRange.startDate}—${regionalAiInput.timeRange.endDate}`, `筛选条件：${regionalAiInput.filterDescription}`, `模式来源：${regionalAiInput.modeSource || "未提供"}`, `解释引擎：${aiResult.engineLabel}`, "", "1. 总体概况", aiResult.overview, "", "2. 主要形变模式", ...aiResult.mainPatterns.map((item, index) => `${index + 1}. ${item}`), "", "3. 值得关注的异常", ...aiResult.anomalies.map((item, index) => `${index + 1}. ${item}`), "", "4. 当前区域特征", ...aiResult.regionFeatures.map((item, index) => `${index + 1}. ${item}`), "", "5. 不确定性与使用建议", aiResult.uncertainty, ...aiResult.recommendations.map((item, index) => `${index + 1}. ${item}`), "", "边界说明：本摘要仅解释程序统计结果，不构成安全判断、灾害预测或处置建议。"];
        void runExport("区域分析摘要", () => { downloadText("\uFEFF" + lines.join("\r\n"), `${safeExportName(datasetTitle)}-区域分析摘要.txt`); trackEvent("analysis_export", { export_type: "ai_summary", point_count: regionalAiInput.pointCount }); });
    };
    const captureMap = () => void runExport("地图 PNG", async () => { const node = document.querySelector<HTMLElement>(".gis-map"); if (!node) throw new Error("地图尚未准备完成，请稍后重试"); setBusy("正在生成地图截图…"); try {
        const html2canvas = (await import("html2canvas")).default, canvas = await html2canvas(node, { useCORS: true, backgroundColor: "#eef3f7", scale: 2 }), a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${safeExportName(datasetTitle)}-${safeExportName(currentDate, "current")}.png`;
        a.click();
        trackEvent("analysis_export", { export_type: "map_png", point_count: filteredPointCount });
    }
    finally {
        setBusy("");
    } });
    const exportPoint = () => { if (!selected) return; void runExport("单点 CSV", () => { downloadText(pointCsv(selected), `${safeExportName(selected.id)}-timeseries.csv`, "text/csv;charset=utf-8"); trackEvent("analysis_export", { export_type: "point_csv", period_count: selected.series.length }); }); };
    const exportComparison = () => { if (!curves.length) return; void runExport("多点对比 CSV", () => { downloadText(comparisonCsv(curves), `${safeExportName(datasetTitle)}-多点对比.csv`, "text/csv;charset=utf-8"); trackEvent("analysis_export", { export_type: "comparison_csv", point_count: curves.length }); }); };
    const exportAoiPoints = () => { if (!boxPoints.length) return; void runExport("AOI 点位 CSV", () => { downloadText(activeFilter === "anomaly" ? anomalyPointsCsv(boxPoints, prioritySelection, Math.max(0, datasetPeriodCount - 1), { datasetId: activeFieldDatasetId, analysisId: currentNavigationAnalysisId, scope: anomalyScopeLabel }) : aoiPointsCsv(boxPoints, timeIndex), `${safeExportName(datasetTitle)}-AOI点位.csv`, "text/csv;charset=utf-8"); trackEvent("analysis_export", { export_type: "aoi_points_csv", point_count: boxPoints.length }); }); };
    const exportAoiSeries = (method: AoiAggregateMethod, enabledModes: string[]) => { if (!boxPoints.length) return; void runExport("AOI 聚合时序 CSV", async () => { if (localDataset) { const result = await loadSelectedAoiSeries(method); const groups = result.groups.filter(group => enabledModes.includes(group.mode)); const rows = [["date", "overall_" + method, ...groups.map(group => group.mode)], ...result.dates.map((date, index) => [date, result.overall[index], ...groups.map(group => group.values[index])])]; downloadText(csvText(rows), safeExportName(datasetTitle) + "-AOI-" + method + ".csv", "text/csv;charset=utf-8"); } else downloadText(aoiSeriesCsv(boxPoints, method, enabledModes, normalizedMode), `${safeExportName(datasetTitle)}-AOI-${method}.csv`, "text/csv;charset=utf-8"); trackEvent("analysis_export", { export_type: "aoi_series_csv", point_count: boxPoints.length, method }); }); };
    const exportChart = (svg: SVGSVGElement, scope: "point" | "comparison" | "aoi") => void runExport("图表 PNG", async () => { await downloadSvgPng(svg, `${safeExportName(datasetTitle)}-${scope}-chart.png`); trackEvent("analysis_export", { export_type: `${scope}_chart_png` }); });
    const exportRuleSummary = () => void runExport("规则摘要", () => { downloadText("\uFEFF" + analysisRuleSummary.text, `${safeExportName(datasetTitle)}-分析规则摘要.txt`); trackEvent("analysis_export", { export_type: "rule_summary" }); });
    const exportInspectionBrief = () => void runExport("空间研判简报", () => { downloadText("\uFEFF" + buildInspectionBrief(datasetTitle, currentDate, inspectionCandidates), `${safeExportName(datasetTitle)}-空间研判简报.txt`); trackEvent("analysis_export", { export_type: "inspection_brief", region_count: inspectionCandidates.length }); });
    const printAnalysis = () => { trackEvent("analysis_export", { export_type: "print_report", point_count: filteredPointCount }); window.print(); };
    const importGisLayer = async (file: File) => {
        setGisImportBusy(true);
        setGisImportMessage("正在本地解析 " + file.name + "…");
        try {
            const imported = await importGisFile(file);
            setGisLayers(current => [...current, ...imported]);
            setGisImportMessage("已导入 " + imported.reduce((sum, layer) => sum + layer.featureCount, 0).toLocaleString() + " 个要素；文件未上传。");
            const bounds = imported[0]?.bounds;
            if (bounds) setMapFocus({ bounds: [bounds.west, bounds.south, bounds.east, bounds.north], token: Date.now() });
        } catch (error) {
            setGisImportMessage(error instanceof Error ? error.message : "GIS 文件解析失败。");
        } finally {
            setGisImportBusy(false);
        }
    };
    const updateGisLayer = (id: string, patch: Partial<Pick<GisLayer, "visible" | "opacity" | "role">>) => setGisLayers(current => current.map(layer => layer.id === id ? { ...layer, ...patch } : layer));
    const focusGisLayer = (layer: GisLayer) => {
        if (!layer.bounds) return;
        setMapFocus({ bounds: [layer.bounds.west, layer.bounds.south, layer.bounds.east, layer.bounds.north], token: Date.now() });
    };
    const focusGisFeature = (layer: GisLayer, featureId: string) => {
        const feature = layer.features.find(item => item.id === featureId);
        if (!feature) return;
        const bounds = getGeometryBounds(feature.geometry);
        setActiveGisFeatureId(feature.id);
        if (bounds) setMapFocus({ bounds: [bounds.west, bounds.south, bounds.east, bounds.north], token: Date.now() });
    };
    const handleGisFeatureSelect = useCallback((_layerId: string, featureId: string) => {
        setActiveGisFeatureId(featureId);
        setLeftTab("layers");
        setLeftCollapsed(false);
        setRightCollapsed(true);
    }, []);
    const focusFieldObservation = useCallback((observation: FieldObservation) => {
        const linked = primaryInsarPoint(observation, points, activeFieldDatasetId);
        setActiveFieldObservationId(observation.id);
        setActiveFieldPhotoId(observation.photos[0]?.id ?? null);
        setLeftTab("field");
        setLeftCollapsed(true);
        setRightTab("point");
        setRightCollapsed(false);
        setSelectionMode("single");
        setSelected(linked?.point ?? null);
        const longitudes = linked ? [observation.longitude, linked.point.lon] : [observation.longitude];
        const latitudes = linked ? [observation.latitude, linked.point.lat] : [observation.latitude];
        setMapFocus({ bounds: [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)], token: Date.now() });
        setStatus(linked ? `考察点已打开；曲线来自已确认监测点 ${linked.point.id}，相距 ${Math.round(linked.distanceMeters)} 米。` : "考察点已打开。请在候选列表中人工确认主关联点，系统不会自动显示最近点曲线。");
    }, [points, activeFieldDatasetId]);
    const addFieldObservation = useCallback((input: NewFieldObservationInput) => {
        const now = new Date().toISOString();
        const base: FieldObservation = { id: `visit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: input.name, longitude: input.longitude, latitude: input.latitude, capturedAt: input.capturedAt, note: input.note, coordinateSource: input.coordinateSource, accuracyMeters: null, photos: [], links: [], associationRadiusMeters: FIELD_ASSOCIATION_LIMIT_METERS, createdAt: now, updatedAt: now };
        const photos = input.photos.map((photo, index) => {
            const photoUrl = URL.createObjectURL(photo.file);
            fieldObservationUrls.current.add(photoUrl);
            return { id: `${base.id}-photo-${index + 1}`, name: photo.file.name, photoUrl, blob: photo.file, capturedAt: photo.capturedAt, note: photo.note || "", exifLongitude: photo.exifLongitude, exifLatitude: photo.exifLatitude, coordinateSource: photo.coordinateSource, coordinateConfidence: photo.coordinateConfidence, coordinateConflict: photoCoordinateConflict({ exifLongitude: photo.exifLongitude, exifLatitude: photo.exifLatitude }, base) };
        });
        const observation: FieldObservation = { ...base, photos };
        setFieldObservations(current => [...current, observation]);
        focusFieldObservation(observation);
        trackEvent("field_observation_add", { coordinate_source: observation.coordinateSource, has_note: Boolean(observation.note), photo_count: photos.length });
    }, [focusFieldObservation]);
    const removeFieldObservation = useCallback((id: string) => {
        setFieldObservations(current => {
            const removed = current.find(observation => observation.id === id);
            removed?.photos.forEach(photo => { URL.revokeObjectURL(photo.photoUrl); fieldObservationUrls.current.delete(photo.photoUrl); });
            return current.filter(observation => observation.id !== id);
        });
        if (activeFieldObservationId === id) { setActiveFieldObservationId(null); setActiveFieldPhotoId(null); setSelected(null); }
    }, [activeFieldObservationId]);
    const removeFieldPhoto = useCallback((visitId: string, photoId: string) => {
        setFieldObservations(current => current.map(observation => {
            if (observation.id !== visitId) return observation;
            const photo = observation.photos.find(item => item.id === photoId);
            if (photo) { URL.revokeObjectURL(photo.photoUrl); fieldObservationUrls.current.delete(photo.photoUrl); }
            return { ...observation, photos: observation.photos.filter(item => item.id !== photoId), updatedAt: new Date().toISOString() };
        }));
        setActiveFieldPhotoId(current => current === photoId ? null : current);
    }, []);
    const changeFieldRadius = useCallback((visitId: string, radius: number) => {
        setFieldObservations(current => current.map(observation => observation.id === visitId ? { ...observation, associationRadiusMeters: radius, updatedAt: new Date().toISOString() } : observation));
    }, []);
    const openFieldPhoto = useCallback((visitId: string, photoId: string) => {
        setActiveFieldObservationId(visitId);
        setActiveFieldPhotoId(photoId);
        setFieldLightboxPhotoId(photoId);
    }, []);
    const inspectFieldCandidate = useCallback((point: InsarPoint) => {
        setMapFocus({ bounds: [point.lon, point.lat, point.lon, point.lat], token: Date.now() });
        setStatus(`已定位候选监测点 ${point.id}；尚未改变考察点主关联和曲线来源。`);
    }, []);
    const confirmFieldCandidate = useCallback((visitId: string, point: InsarPoint) => {
        setFieldObservations(current => current.map(observation => observation.id === visitId ? confirmPrimaryInsarLink(observation, activeFieldDatasetId, point, observation.associationRadiusMeters) : observation));
        setSelected(point);
        setRightTab("point");
        setSelectionMode("single");
        setMapFocus({ bounds: [point.lon, point.lat, point.lon, point.lat], token: Date.now() });
        setStatus(`已确认 ${point.id} 为考察点主关联；右侧曲线现由该真实点位驱动。`);
    }, [activeFieldDatasetId]);
    const rejectFieldCandidate = useCallback((visitId: string, point: InsarPoint) => {
        setFieldObservations(current => current.map(observation => observation.id === visitId ? rejectInsarLink(observation, activeFieldDatasetId, point, observation.associationRadiusMeters) : observation));
        setSelected(current => current?.id === point.id ? null : current);
        setStatus(`已排除候选监测点 ${point.id}。`);
    }, [activeFieldDatasetId]);
    const handleEvidenceAction = (action: EvidenceAction) => {
        if (action.type === "focus-points") {
            const ids = new Set(action.pointIds);
            const chosen = points.filter(point => ids.has(point.id));
            if (chosen.length) {
                setBoxPoints(chosen);
                setMapFocus({ bounds: pointBounds(chosen), token: Date.now() });
            }
            return;
        }
        const layer = gisLayers.find(item => item.id === action.layerId);
        if (!layer) return;
        if (action.type === "focus-layer") {
            focusGisLayer(layer);
            return;
        }
        const feature = layer.features.find(item => item.id === action.featureId);
        const bounds = feature ? getGeometryBounds(feature.geometry) : null;
        setActiveGisFeatureId(action.featureId);
        setLeftTab("layers");
        if (bounds) setMapFocus({ bounds: [bounds.west, bounds.south, bounds.east, bounds.north], token: Date.now() });
    };
    const shellStyle = {
        "--analysis-panel-width": `${drawerWidth}px`,
        "--drawer-width": surface && !(surface === "left" && leftTab === "data") ? `${drawerWidth}px` : "0px",
    } as CSSProperties, currentValue = selected ? (selected.series[Math.min(timeIndex, selected.series.length - 1)] ?? selected.displacement) : 0;
    const selectedInsight = selected ? buildPointInsight(selected, coherenceThreshold) : null;
    const selectedStageAnalysis = selected && selected.series.length >= 2 ? deriveTemporalStageAnalysis(selected) : null;
    const selectedTopTwo = selected ? topPascCandidates(selected.pasc) : [];
    const selectedDataQuality = selected ? pointDataQuality(selected, coherenceThreshold) : null;
    const selectedModeExplanation = selected ? pascModeExplanation(selected) : null;
    const activeFieldObservation = fieldObservations.find(observation => observation.id === activeFieldObservationId) ?? null;
    const activeFieldCandidates = activeFieldObservation ? insarCandidates(activeFieldObservation, points, activeFieldObservation.associationRadiusMeters, activeFieldDatasetId) : [];
    const activeFieldPrimary = activeFieldObservation ? primaryInsarPoint(activeFieldObservation, points, activeFieldDatasetId) : null;
    const leftTaskTitles = { data: "数据", layers: "图层与样式", route: "驾车出行规划", field: "现场记录", filters: "条件筛选", anomaly: "异常发现", time: "时间区间分析" };
    const rightTaskTitles = { point: "点位分析", region: "区域分析", action: "核查候选", ai: "AI 解读", pasc: "模式识别 · PASC" };
    const taskValue = surface === "left" ? leftTab : rightTab;
    const analysisNavigation = <label className="workspace-task-select">分析任务<select aria-label="分析任务" value={taskValue} onChange={event => {
        const value = event.target.value;
        if (value === "filters" || value === "anomaly") openLeft(value);
        else openRight(value as typeof rightTab);
    }}><option value="point">点位分析</option><option value="region">区域分析</option><option value="filters">条件筛选</option><option value="anomaly">异常发现</option><option value="pasc">模式识别 · PASC</option><option value="ai">AI 解读</option></select></label>;
    const inspectionNavigation = <div className="workspace-inspection-tabs" role="group" aria-label="核查任务"><button aria-pressed={surface === "right"} onClick={() => openRight("action")}>核查候选</button><button aria-pressed={surface === "left"} onClick={() => openLeft("field")}>现场记录</button></div>;
    return (
        <main data-local-priority-state={priorityState} data-local-dataset-id={localAnalysisIdentity?.datasetId ?? ""} data-local-analysis-id={effectiveLocalAnalysisId ?? ""} className={"map-page phase-two-workspace navigation-workspace" + (navigationActive ? " driving-workspace" : "")} aria-busy={!dataReady || Boolean(busy) || exportOperation.state === "running"}>
            <WorkspaceHeader active={activeSection} onChange={openSection} onHelp={() => setGuideOpen(true)} onReturnToImport={onReturnToImport} />
            <FieldPhotoLightbox observation={activeFieldObservation} photoId={fieldLightboxPhotoId} onClose={() => setFieldLightboxPhotoId(null)} onChange={photoId => { setActiveFieldPhotoId(photoId); setFieldLightboxPhotoId(photoId); }} />
            {localDataset && <nav className="local-workflow-progress" aria-label="CSV 分析到考察路线"><button onClick={() => openRight("pasc")}>1 · 本地分类 · {points.length.toLocaleString()} 点</button><button onClick={discoverInspectionCandidates} disabled={priorityState !== "ready"}>2 · 异常圈定 · {priorityState === "running" ? "计算中" : prioritySelection.anomalies.length.toLocaleString() + " 点"}</button><button onClick={() => openLeft("route")}>3 · 考察路线 · {navigationDraft.waypoints.filter(point => point.inspectionSource).length} 个目标</button></nav>}
            {(priorityError || localSeriesError) && <p className="local-workflow-error" role="alert">{priorityError || localSeriesError}</p>}
            {localSeriesBusy && <p className="local-workflow-error" role="status">正在从本机读取时序，请稍候…</p>}
            <input ref={fileRef} hidden type="file" accept=".csv,text/csv" disabled={accountSession.status !== "authenticated"} onChange={e => inspectFile(e.target.files?.[0])} />

            {portfolioTourStep !== null && <section className="portfolio-tour" aria-label="形变分析操作引导" aria-live="polite">
                <header><div><small>形变分析操作引导</small><b>9,069 个点、210 期时序的证据复核</b></div><button aria-label="退出产品体验引导" onClick={() => setPortfolioTourStep(null)}>×</button></header>
                <ol>
                    <li className={portfolioTourStep === 1 ? "active" : portfolioTourStep > 1 ? "done" : ""}><i>筛</i><span>发现异常<small>双指标达标且同向聚集</small></span></li>
                    <li className={portfolioTourStep === 2 ? "active" : portfolioTourStep > 2 ? "done" : ""}><i>证</i><span>查看证据<small>空间支持与区域统计</small></span></li>
                    <li className={portfolioTourStep === 3 ? "active" : ""}><i>释</i><span>{USER_DATA_LOCAL_ONLY ? "本机研判" : "AI 解读"}<small>{USER_DATA_LOCAL_ONLY ? "数据保留在当前电脑" : "只发送脱敏聚合摘要"}</small></span></li>
                </ol>
                {portfolioTourStep === 1 && <div className="portfolio-tour-action"><p>{dataReady ? "210 期原始密集案例已就绪。先筛选速率和累计量同时较大的点，再检查同向空间聚集与观测质量。" : "正在加载 9,069 点、210 期原始密集案例，请稍候。"}</p><button disabled={!dataReady} onClick={() => { discoverAnomalies(); setPortfolioTourStep(2); }}>发现异常候选 ↗</button></div>}
                {portfolioTourStep === 2 && <div className="portfolio-tour-action"><p>{activeAnomalyRegionId ? `已定位 ${activeAnomalyRegionId}，右侧展示点数、速率、质量、模式分布与聚合时序。` : `已找到 ${prioritySelection.anomalies.length.toLocaleString()} 个候选点和 ${anomalyRegionResult.regions.length.toLocaleString()} 个空间支持区域。先定位证据最多的区域。`}</p><button onClick={() => { const first = [...anomalyRegionResult.regions].sort((a, b) => b.pointCount - a.pointCount)[0]; if (first && !activeAnomalyRegionId) { focusAnomalyRegion(first); return; } setRightTab("ai"); setPortfolioTourStep(3); }}>{activeAnomalyRegionId ? "证据已核对，进入 AI 解读 ↗" : anomalyRegionResult.regions.length ? "定位首个异常区域 ↗" : "查看区域摘要并进入 AI ↗"}</button></div>}
                {portfolioTourStep === 3 && (USER_DATA_LOCAL_ONLY ? <div className="portfolio-tour-action"><p>在本机分析助手中查看当前区域的统计与证据。外部 AI 已关闭，文件与数据摘要保留在当前电脑；核查行程仍需手动确认。</p><button onClick={() => { setRightTab("ai"); setSurface("right"); setPortfolioTourStep(null); }}>查看本机分析助手 ↗</button></div> : <div className="portfolio-tour-action"><p>{aiStatus === "success" ? "AI 辅助解读已生成，可复核输入范围、点数、时间、筛选条件与质量证据。需现场核查时，可在“驾车”中手动选点并规划行程；入口与通行条件仍需人工核验。" : aiStatus === "error" ? "站点额度暂不可用，可在右侧切换个人 API，或使用网页备用流程。" : "仅发送不超过 12 KB 的聚合统计，不包含原始 CSV、点位编号或完整时序；解读结果需结合原始证据复核。"}</p><button disabled={!regionalAiSummary || aiStatus === "running"} onClick={() => { if (aiStatus === "success") setPortfolioTourStep(null); else void runAiInterpretation(); }}>{aiStatus === "success" ? "完成分析引导" : aiStatus === "running" ? "正在生成解读…" : "生成 AI 辅助解读 ↗"}</button><button className="tour-skip" onClick={() => setPortfolioTourStep(null)}>跳过解读，返回工作台</button></div>)}
            </section>}

            {exportOperation.state !== "idle" && <div className={`workspace-operation-state ${exportOperation.state}`} role={exportOperation.state === "error" ? "alert" : "status"} aria-live="polite"><i /> <span>{exportOperation.message}</span><button aria-label="关闭导出状态" onClick={() => setExportOperation(idleExportOperation)}>×</button></div>}

            <section className={"gis-shell phase-two-shell" + (surface && !(surface === "left" && leftTab === "data") ? " has-task-drawer" : "")} style={shellStyle}>
                {navigationActive && <div className={"road-navigation-map-hint" + (navigationPickId ? " is-picking" : "")} role="status">
                    <div><b>{navigationPickId ? `点击地图设置${navigationPickText}` : navigationBusy ? "滴图正在计算驾车路线…" : navigationPlan || fieldTaskResult ? "滴图驾车路线" : "从地图上的任意位置开始"}</b><span>{navigationPickId ? "可缩放、拖动寻找位置；按 Esc 取消。" : fieldTaskPlan ? "点选车辆停靠与核查目标；返程与同站任务分别管理。" : "点选起点、终点和途经点；不需要先导入路网。"}</span></div>
                    {navigationPickId ? <button onClick={() => { setNavigationPickId(null); setSurface("left"); }}>取消选点</button> : leftCollapsed && <button onClick={() => openLeft("route")}>编辑行程</button>}
                </div>}
                <button className="workspace-data-card" aria-expanded={surface === "left" && leftTab === "data"} onClick={() => openSection("data")} title={datasetTitle}>
                    <span>当前数据 <i aria-hidden="true">⌄</i></span><strong>{datasetTitle}</strong>
                    <small>{points.length.toLocaleString()} 点 · {periodCount} 期</small>
                </button>
                <div className="workspace-view-toolbar" role="group" aria-label="地图视图操作">
                    <WorkspaceSelect label="地图显示属性" value={attribute} onChange={setAttribute} icon={<MapToolIcon name="layers" />}
                        options={Object.entries(attributeNames).map(([key, name]) => ({ value: key as RenderAttribute, label: name, disabled: (!hasTimeSeries && (key === "displacement" || key === "stageVelocity")) || (key === "coherence" && !hasCoherence) || (key === "mode" && !hasModes) }))} />
                    <WorkspaceSelect label="地图选择方式" value={selectionMode} onChange={chooseSelection} icon={<MapToolIcon name="select" />}
                        options={[
                            { value: "single", label: "单点查看", description: "点击监测点，查看形变时序" },
                            { value: "compare", label: "多点对比", description: "选择多个点，对照变化曲线" },
                            { value: "box", label: "矩形框选", description: "拖拽框选，统计区域形变" },
                            { value: "polygon", label: "多边形框选", description: "沿边界选区，分析目标范围" },
                        ]} />
                    <button className="workspace-view-action" onClick={() => openLeft("layers")}><MapToolIcon name="layers" /><span>底图 / 图层</span></button>
                    <button className="workspace-view-action workspace-swipe-action" aria-pressed={swipeEnabled} disabled={!swipeEnabled && (!dataReady || !visible.points || !hasModes)} title="对照年均速率与已有形变模式；无分类数据时不可用" onClick={() => { if (!swipeEnabled) setSelectionMode("single"); setSwipeEnabled(value => !value); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M12 2v20M7 9v6M17 9v6" /></svg><span>{swipeEnabled ? "退出卷帘" : "卷帘对比"}</span></button>
                </div>
                {surface === "export" && <ResizableAnalysisPanel className="workspace-export-drawer" label="导出材料" collapsed={false} width={drawerWidth} onWidthChange={setDrawerWidth}>
                    <header className="panel-head"><span>导出材料</span><button aria-label="关闭导出" onClick={closeSurface}>×</button></header>
                    <div className="workspace-export-context"><b>{datasetTitle}</b><span>当前显示 {mapVisiblePointCount.toLocaleString()} 点 · {currentDate}</span><small>数据文件使用对应选点或选区，截图使用当前地图。</small></div>
                    <div className="workspace-export-actions">
                        <button disabled={!dataReady || exportOperation.state === "running"} onClick={captureMap}><MapToolIcon name="screenshot" /><span><b>地图截图</b><small>当前地图 PNG</small></span></button>
                        <button disabled={!selected || exportOperation.state === "running"} onClick={exportPoint}><MapToolIcon name="export" /><span><b>单点时序 CSV</b><small>{selected ? selected.id : "请先选择一个点"}</small></span></button>
                        <button disabled={!curves.length || exportOperation.state === "running"} onClick={exportComparison}><MapToolIcon name="export" /><span><b>多点对比 CSV</b><small>{curves.length} 条曲线</small></span></button>
                        <button disabled={!boxPoints.length || exportOperation.state === "running"} onClick={exportAoiPoints}><MapToolIcon name="export" /><span><b>区域点位 CSV</b><small>{boxPoints.length} 个分析对象点</small></span></button>
                        <button disabled={exportOperation.state === "running"} onClick={exportRuleSummary}><MapToolIcon name="rules" /><span><b>规则摘要 TXT</b><small>当前分析条件与依据</small></span></button>
                        <button disabled={!aiResult || !regionalAiInput || exportOperation.state === "running"} onClick={downloadAiSummary}><MapToolIcon name="rules" /><span><b>AI 解读摘要</b><small>{aiResult ? "导出当前解读" : "请先完成 AI 解读"}</small></span></button>
                        <button disabled={!inspectionCandidates.length || exportOperation.state === "running"} onClick={exportInspectionBrief}><MapToolIcon name="rules" /><span><b>核查简报 TXT</b><small>{inspectionCandidates.length} 个候选区域</small></span></button>
                        <button disabled={exportOperation.state === "running"} onClick={printAnalysis}><MapToolIcon name="export" /><span><b>打印 / 保存报告</b><small>打开浏览器打印视图</small></span></button>
                    </div>
                </ResizableAnalysisPanel>}
                <ResizableAnalysisPanel className={"gis-left phase-two-left workspace-task-drawer " + (leftTab === "data" ? "is-data-drawer " : "") + (leftCollapsed ? "is-collapsed" : "")} label={leftTaskTitles[leftTab]} collapsed={leftCollapsed} resizable={leftTab !== "data"} width={drawerWidth} onWidthChange={setDrawerWidth}>
                    <div className="panel-head"><span>{leftTaskTitles[leftTab]}</span><button aria-label="关闭任务面板" onClick={closeSurface}>×</button></div>
                    {(leftTab === "filters" || leftTab === "anomaly") && analysisNavigation}
                    {leftTab === "field" && inspectionNavigation}
                    <div hidden={leftTab !== "route"}>
                        {fieldTaskPlan ? <RoadFieldTaskPanel currentDatasetId={activeFieldDatasetId} currentAnalysisId={currentNavigationAnalysisId} plan={fieldTaskPlan} stored={fieldTaskStored} onChange={changeFieldTasks} onSaved={saveFieldTaskMetadata} onRestore={(plan, saved = true) => openFieldTasks(plan, saved)} pickId={navigationPickId} onPick={beginNavigationPick} result={fieldTaskResult} onResult={acceptFieldTaskResult} onAdopt={adoptFieldTaskCandidate} evidenceOptions={fieldObservations.flatMap(observation => observation.photos.map(photo => ({ id: `field-photo:${observation.id}:${photo.id}`, label: `${observation.name} · ${photo.name}` })))} onBusy={setNavigationRequestBusy} activeLegId={activeNavigationLegId} onFocusLeg={focusNavigationLeg} onFocusPoint={focusNavigationPoint} /> : <RoadNavigationPanel currentDatasetId={activeFieldDatasetId} currentAnalysisId={currentNavigationAnalysisId} draft={navigationDraft} onChange={changeNavigationDraft} pickId={navigationPickId} onPick={beginNavigationPick} plan={navigationPlan} onPlan={acceptNavigationPlan} onBusy={setNavigationRequestBusy} evidence={roadRiskEvidenceInputs} activeLegId={activeNavigationLegId} onFocusLeg={focusNavigationLeg} onFocusPoint={focusNavigationPoint} onOpenFieldTasks={openFieldTasks} />}
                    </div>
                    {leftTab === "data" && (
                        <div id="left-workspace-panel-data" className="workspace-tab-panel data-tab-panel" role="region" aria-label="数据详情">
                            <div className="dataset-card">
                                <small>公开案例数据</small>
                                <div className="public-demo-switch" aria-label="公开示例案例">
                                    {(Object.keys(publicDemos) as PublicDemoId[]).map(demoId => <button type="button" key={demoId} className={activePublicDemo === demoId && !privateDatasetId ? "active" : ""} disabled={Boolean(busy)} onClick={() => loadPublicDemo(demoId, { updateUrl: true })}><span>{publicDemos[demoId].label}</span><small>{publicDemos[demoId].summary}</small></button>)}
                                </div>
                                {publicDemos[activePublicDemo].publishedIsFull ? (
                                    <><div className="demo-depth-switch" aria-label={`${publicDemos[activePublicDemo].label}数据深度`}><button type="button" className="active" disabled={Boolean(busy)} onClick={() => loadPublicDemo(activePublicDemo, { updateUrl: true })}><b>原始密集数据</b><small>{publicDemos[activePublicDemo].fullSummary}</small></button></div><p className="demo-full-hint"><b>数据边界</b>{publicDemos[activePublicDemo].fullHint}</p></>
                                ) : (
                                    <><div className="demo-depth-switch" aria-label={`${publicDemos[activePublicDemo].label}数据深度`}><button type="button" className={demoDepth === "quick" ? "active" : ""} disabled={Boolean(busy)} onClick={() => loadPublicDemo(activePublicDemo, { updateUrl: true })}><b>快速示例</b><small>直接打开网页样本</small></button><button type="button" className={demoDepth === "full" ? "active" : ""} disabled={Boolean(busy)} onClick={() => chooseFullCaseFile(activePublicDemo)}><b>完整数据</b><small>{publicDemos[activePublicDemo].fullSummary}</small></button></div>{demoDepth === "full" && <p className="demo-full-hint"><b>本机完整数据</b>{publicDemos[activePublicDemo].fullHint}</p>}</>
                                )}
                                <b>{datasetTitle}</b>
                                <span>{points.length.toLocaleString()} 个有效点 · 当前 {currentDate}</span>
                                <button onClick={chooseImportFile}>＋ {pascExecutionMode === "local" ? "本地分析 CSV" : "Legacy 字段映射导入"}</button>
                                <p className="dataset-local-privacy">数据默认在浏览器本地处理，原始 CSV 不会上传服务器。</p>
                                <details className="workspace-details"><summary>数据详情与帮助</summary><p>观测覆盖：{points[0]?.dates?.[0] || "无时序"} — {points[0]?.dates?.at(-1) || "无时序"}</p><Link href="/datasets">我的数据</Link><button onClick={() => setGuideOpen(true)}>查看 CSV 数据规范</button>
                                <button onClick={loadShowcaseDemo}>六类模式教学示例</button>
                                {parseReport && <button onClick={() => setReportOpen(true)}>查看导入与质量报告</button>}</details>
                            </div>
                        </div>
                    )}

                    {leftTab === "layers" && (
                        <div id="left-workspace-panel-layers" className="workspace-tab-panel" role="region" aria-label="图层与样式">
                            <div className="layer-group">
                                <small>底图 · 单选</small>
                                {[["osm", "OpenStreetMap"], ["esri", "Esri World Imagery"], ["gray", "Esri Light Gray"], ["tdt_vec", "天地图矢量（需 Key）"], ["tdt_img", "天地图影像（需 Key）"], ["custom", "自定义 XYZ / WMTS"]].map(([k, n]) => (
                                    <label key={k}>
                                        <input type="radio" name="base" checked={base === k} onChange={() => chooseBase(k)} />
                                        <i className="radio-symbol" /><span>{n}</span>
                                    </label>
                                ))}
                                <button className="layer-config-button" onClick={() => setSourceOpen(true)}>配置地图服务</button>
                            </div>
                            <div className="layer-group">
                                <small>业务与质量图层</small>
                                {[["points", "InSAR 监测点", points.length], ["risk", "聚集异常线索", riskCount], ["quality", "低相干 / 高缺测", qualityCount], ["boundary", "数据外包范围", 0]].map(([k, n, c]) => (
                                    <label key={String(k)} title={k === "risk" ? priorityRule : undefined}>
                                        <input type="checkbox" checked={visible[k as keyof typeof visible]} onChange={e => setVisible(v => ({ ...v, [k]: e.target.checked }))} />
                                        <i className={"layer-dot " + k} /><span>{n}</span>
                                        {Number(c) > 0 && <b>{Number(c).toLocaleString()}</b>}
                                    </label>
                                ))}
                            </div>
                            <div className="renderer-panel">
                                <small>InSAR 样式</small>
                                <select value={attribute} onChange={e => setAttribute(e.target.value as RenderAttribute)}>
                                    {Object.entries(attributeNames).map(([k, n]) => <option value={k} key={k} disabled={(!hasTimeSeries && (k === "displacement" || k === "stageVelocity")) || (k === "coherence" && !hasCoherence) || (k === "mode" && !hasModes)}>{n}</option>)}
                                </select>
                                {attribute !== "mode" && (
                                    <div className="renderer-inputs">
                                        <label>最小值<input type="number" value={styleMin} step="any" onChange={e => setStyleMin(+e.target.value)} /></label>
                                        <label>最大值<input type="number" value={styleMax} step="any" onChange={e => setStyleMax(+e.target.value)} /></label>
                                        <label>间距<input type="number" value={interval} step="any" min="0" onChange={e => setInterval(+e.target.value)} /></label>
                                    </div>
                                )}
                                <fieldset className="ramp-presets">
                                    <legend>色带方案</legend>
                                    <div className="ramp-preset-grid">
                                        {colorRampPresets.map(preset => {
                                            const active = activeRamp?.id === preset.id;
                                            return <button type="button" className={active ? "is-active" : ""} aria-pressed={active} onClick={() => selectColorRamp(preset)} key={preset.id}>
                                                <i style={{ background: `linear-gradient(90deg,${preset.colors.join(",")})` }} />
                                                <span>{preset.label}<small>{preset.hint}</small></span>
                                                {active && <b aria-hidden="true">✓</b>}
                                            </button>;
                                        })}
                                    </div>
                                </fieldset>
                                <div className="ramp-preview" style={{ background: "linear-gradient(90deg," + colors.join(",") + ")" }} />
                                <span className="ramp-caption">{activeRamp ? `${activeRamp.label} · 低值 ${activeRamp.colors[0]} → 高值 ${activeRamp.colors.at(-1)}` : "自定义 QGIS 色带"}{attribute === "displacement" ? " · −100—100 mm / 20 mm" : attribute === "velocity" || attribute === "stageVelocity" ? " · −12.5—12.5 mm/yr / 2.5" : ""}</span>
                                <button onClick={() => qgisRef.current?.click()}>导入 QGIS 色带（QML / XML）</button>
                                <input ref={qgisRef} hidden type="file" accept=".qml,.xml,.txt" onChange={e => importRamp(e.target.files?.[0])} />
                            </div>
                            <label className="workspace-point-size">点大小<input aria-label="地图监测点大小" type="range" min="3" max="10" step="1" value={pointSize} onChange={e => setPointSize(Number(e.target.value))} /><b>{pointSize}px</b></label>
                            <details className="road-optional-baseline"><summary>路网质检实验（与驾车规划独立）</summary><p>仅用于历史质检实验；这些 OSM 道路线不参与滴图驾车规划。</p><button disabled={gisImportBusy || gisLayers.some(layer => layer.provenance?.kind === "osm")} onClick={loadOptionalRoadBaseline}>手动加载 OSM 质检样本</button></details>
                            <GisLayerPanel
                                layers={gisLayers}
                                activeFeatureId={activeGisFeatureId}
                                busy={gisImportBusy}
                                message={gisImportMessage}
                                onImport={file => void importGisLayer(file)}
                                onUpdate={updateGisLayer}
                                onRemove={id => { setGisLayers(current => current.filter(layer => layer.id !== id || layer.provenance?.builtIn)); setActiveGisFeatureId(null); }}
                                onFocus={focusGisLayer}
                                riskInputs={roadRiskEvidenceInputs}
                                onFocusFeature={focusGisFeature}
                                onRoutePlanChange={setRoadOpsRoutePlan}
                            />
                            <div className="map-source">
                                <b>地图数据来源</b>
                                <span>© OpenStreetMap contributors</span>
                                <span>Tiles © Esri</span>
                                <span>© 天地图（用户 Key）</span>
                                <span>Custom XYZ / WMTS（用户自定义）</span>
                                <label className="opacity-field">底图透明度
                                    <input type="range" min="0.35" max="1" step="0.05" value={baseOpacity} onChange={e => setBaseOpacity(+e.target.value)} />
                                </label>
                            </div>
                        </div>
                    )}

                    {leftTab === "field" && (
                        <div id="left-workspace-panel-field" className="workspace-tab-panel field-observation-tab" role="region" aria-label="现场记录">
                            <FieldObservationPanel
                                observations={fieldObservations}
                                activeId={activeFieldObservationId}
                                mapCenter={analysis.mapView?.center ?? [20.09, 110.35]}
                                storageState={fieldStorageState}
                                onAdd={addFieldObservation}
                                onSelect={focusFieldObservation}
                                onRemove={removeFieldObservation}
                            />
                        </div>
                    )}

                    {leftTab === "filters" && (
                        <div id="left-workspace-panel-filters" className="workspace-tab-panel" role="region" aria-label="条件筛选">
                            <section className="renderer-panel threshold-analysis">
                                <small>PASC 模式显示</small>

                                <span>{hasModes ? "按已有模式筛选地图显示，不删除原始数据。" : "当前数据没有分类结果，可先前往模式识别检查数据能力。"}</span>
                                <div className="pattern-toggle-row">
                                    <span><b>仅看异常模式</b><small>线性、分段、减速、加速</small></span>
                                    <input disabled={!hasModes} aria-label="仅看异常模式" id="pattern-anomaly-only" type="checkbox" checked={patternVisibility !== "all"} onChange={event => applyPatternVisibility(event.target.checked ? "anomaly" : "all")} />
                                </div>
                                <div className={"pattern-toggle-row secondary " + (patternVisibility === "all" ? "disabled" : "")}>
                                    <span><b>保留未定义型</b><small>与异常模式同时显示</small></span>
                                    <input aria-label="保留未定义型" id="pattern-include-undefined" type="checkbox" disabled={patternVisibility === "all"} checked={patternVisibility === "anomaly_with_undefined"} onChange={event => applyPatternVisibility(event.target.checked ? "anomaly_with_undefined" : "anomaly")} />
                                </div>
                                <span className="pattern-display-count">当前显示 <b>{mapVisiblePointCount.toLocaleString()}</b> / {points.length.toLocaleString()} 点</span>
                            </section>
                            <div className="renderer-panel threshold-analysis">
                                <small>阈值筛选 · 预警辅助</small>
                                <label>速率显示上限<input type="number" value={threshold} step="0.1" onChange={e => setThreshold(+e.target.value)} /></label>
                                <button onClick={applyThreshold}>筛选速率 ≤ {threshold} mm/yr</button>
                                <label>低相干阈值<input type="number" min="0" max="1" step="0.01" value={coherenceThreshold} onChange={e => setSafeCoherenceThreshold(+e.target.value)} /></label>
                                <button disabled={!hasCoherence} onClick={applyCoherenceFilter}>过滤相干性 &lt; {coherenceThreshold.toFixed(2)}</button>
                                <span>{hasCoherence ? "相干性取值为 0—1，筛选结果同步进入区域分析。" : "当前数据未提供相干性，不能使用相干性筛选。"}</span>
                            </div>
                            {(activeFilter !== "none" || patternVisibility !== "all" || hiddenModes.length > 0) && <button className="clear-filter-button" onClick={clearFilters}>清除当前筛选</button>}
                        </div>
                    )}
                    {leftTab === "anomaly" && <div className="workspace-tab-panel" aria-label="异常发现">
                        <section className="anomaly-discovery-card"><small>异常发现</small><h3>大幅形变，且集中分布</h3><p>双指标同时达标 → 核对质量 → 同向空间聚集。</p></section>
                        {anomalyDataNote && <p className="pasc-local-webgis-warning">{anomalyDataNote}</p>}
                        <section className="anomaly-scope-controls"><p>当前异常分析范围：{anomalyScopeLabel}。聚类候选超过 50,000 时保留未评估状态，可圈选较小范围重算。</p><button type="button" onClick={() => { clearFilters(); setSelectionMode("box"); setRightTab("region"); setRightCollapsed(false); setStatus("请在全点地图圈选范围，再点击“用当前选区发现异常”。"); }}>在全点地图圈选范围</button><button type="button" disabled={!boxPoints.length} onClick={useSelectedAnomalyScope}>用当前选区发现异常</button>{priorityScopeIds !== null && <button type="button" onClick={() => { setPriorityScopeIds(null); showAllAnomalyPoints("正在按全数据范围重算异常。"); }}>恢复全数据异常分析</button>}</section>
                        <AnomalyRuleControls key={JSON.stringify(prioritySelection.options)} options={prioritySelection.options} evaluationDate={detectionDate} onApply={applyAnomalyRules} />
                        <div className="anomaly-result-counts" aria-label="异常筛选统计"><span>幅值达标<b>{prioritySelection.amplitudeCandidates.length}</b></span><span>聚集异常<b>{prioritySelection.anomalies.length}</b></span><span>离散待查<b>{prioritySelection.isolated.length}</b></span><span>质量排除<b>{prioritySelection.excludedLowQuality.length}</b></span></div>
                        <p className="layer-rule-note">{priorityRule}</p>
                        <button className="workspace-text-action" onClick={() => setRuleSummaryOpen(true)}>查看当前分析依据</button>
                    </div>}
                    {leftTab === "time" && <div className="workspace-tab-panel" aria-label="时间区间分析">                            <div className="renderer-panel time-analysis">
                                <small>时间区间 · 阶段速率</small>
                                {hasTimeSeries ? <><label>起始期<select value={rangeStart} onChange={e => { const value = +e.target.value; setRangeStart(value); setRangeEnd(current => Math.max(value + 1, current)); }}>{points[0]?.dates?.map((d, i) => <option value={i} key={d} disabled={i === periodCount - 1}>{d}</option>)}</select></label><label>结束期<select value={rangeEnd} onChange={e => { const value = +e.target.value; setRangeEnd(value); setRangeStart(current => Math.min(value - 1, current)); }}>{points[0]?.dates?.map((d, i) => <option value={i} key={d} disabled={i === 0}>{d}</option>)}</select></label><button disabled={rangeEnd <= rangeStart} onClick={() => setAttribute("stageVelocity")}>计算并按阶段速率显示</button></> : <span>当前原始密集文件未提供逐期累计形变，阶段速率和时间轴不生成虚拟结果。</span>}
                            </div>
</div>}
                </ResizableAnalysisPanel>

                <MapCanvas
                    points={points}
                    livePascPoints={navigationActive ? [] : livePascPoints}
                    selected={selected}
                    onSelect={selectPoint}
                    onBoxSelect={handleBoxSelect}
                    onPolygonSelect={handlePolygonSelect}
                    onAnomalyRegionSelect={focusAnomalyRegion}
                    onViewChange={handleMapViewChange}
                    visible={navigationActive ? { points: false, boundary: false, risk: false, quality: false } : visible}
                    base={base}
                    tdtKey={tdtKey}
                    customBasemap={customBasemap}
                    baseOpacity={baseOpacity}
                    pointSize={pointSize}
                    onEditStyle={() => openLeft("layers")}
                    swipeEnabled={!navigationActive && swipeEnabled && visible.points && (selectionMode === "single" || selectionMode === "compare")}
                    coherenceThreshold={coherenceThreshold}
                    priorityPointIds={priorityPointIds}
                    priorityLimitedPointIds={priorityLimitedPointIds}
                    layoutToken={surface + "-" + leftTab}
                    renderStyle={renderStyle}
                    patternVisibility={attribute === "mode" ? patternVisibility : "all"}
                    hiddenModes={attribute === "mode" ? hiddenModes : []}
                    filteredPointIds={filteredMapPointIds}
                    onToggleMode={toggleModeVisibility}
                    onShowAllModes={() => { setHiddenModes([]); setStatus("已恢复显示全部形变类别。"); }}
                    compareIds={compareIds}
                    boxIds={activeFilter === "velocity" || activeFilter === "coherence" || activeFilter === "pascLowConfidence" || activeFilter === "pascLimitedSpatial" ? [] : boxIds}
                    selectionMode={selectionMode}
                    highlightKind={activeFilter === "anomaly" && anomalyView === "clustered" ? "anomaly" : activeFilter === "none" ? "region" : "filter"}
                    selectionGeometry={navigationActive || analysis.selectedRegion?.source === "anomalyRegion" ? null : selectedAoiGeometry}
                    anomalyRegions={navigationActive ? [] : mapAnomalyRegions}
                    activeAnomalyRegionId={activeAnomalyRegionId}
                    initialView={restoreRequested.current ? analysis.mapView : null}
                    focusBounds={mapFocus?.bounds || null}
                    focusToken={mapFocus?.token || 0}
                    gisLayers={navigationActive ? [] : gisLayers}
                    activeGisFeatureId={activeGisFeatureId}
                    onGisFeatureSelect={handleGisFeatureSelect}
                    roadOpsRoutePlan={navigationActive ? fieldTaskPlan ? fieldTaskMap : navigationPlan?.map ?? null : roadOpsRoutePlan}
                    navigationActive={navigationActive}
                    navigationPicking={navigationActive && Boolean(navigationPickId) && !navigationBusy}
                    navigationPoints={navigationPoints}
                    navigationActiveLegId={activeNavigationLegId}
                    onNavigationLegSelect={focusNavigationLeg}
                    navigationTargetPoints={navigationTargetPoints}
                    onNavigationPick={pickNavigationCoordinate}
                    fieldObservations={navigationActive ? [] : fieldObservations}
                    activeFieldObservationId={activeFieldObservationId}
                    onFieldObservationSelect={focusFieldObservation}
                    onFieldPhotoOpen={openFieldPhoto}
                />

                <ResizableAnalysisPanel collapsed={rightCollapsed} label={rightTaskTitles[rightTab]} width={drawerWidth} onWidthChange={setDrawerWidth} className={"gis-detail phase-two-detail analysis-workbench-panel workspace-task-drawer " + (rightCollapsed ? "is-collapsed" : "")}>
                    <div className="panel-head"><span>{rightTaskTitles[rightTab]}</span><button aria-label="关闭分析结果" onClick={closeSurface}>×</button></div>
                    {rightTab === "action" ? inspectionNavigation : analysisNavigation}
                    {rightTab === "point" && (
                        <div id="right-workspace-panel-point" className="workspace-tab-panel point-analysis-tab" role="region" aria-label="点位结果">
                            <DataBackedCasePanel cases={dataBackedCases} activeId={activeQuickCaseId} onActivate={activateQuickCase} />
                            <div className="analysis-mode-tools">
                                <span>选点方式</span>
                                <div>
                                    <button className={selectionMode === "single" ? "active" : ""} onClick={() => setSelectionMode("single")}>单点</button>
                                    <button className={selectionMode === "compare" ? "active" : ""} onClick={() => setSelectionMode("compare")}>多点对比</button>
                                    <button disabled={!selected && !compareIds.length} onClick={clearSelection}>取消选择</button>
                                </div>
                            </div>

                            {activeFieldObservation && <FieldObservationEvidence
                                observation={activeFieldObservation}
                                candidates={activeFieldCandidates}
                                primaryPointId={activeFieldPrimary?.point.id ?? null}
                                activePhotoId={activeFieldPhotoId}
                                onSelectPhoto={setActiveFieldPhotoId}
                                onOpenPhoto={photoId => openFieldPhoto(activeFieldObservation.id, photoId)}
                                onRemovePhoto={photoId => removeFieldPhoto(activeFieldObservation.id, photoId)}
                                onRadiusChange={radius => changeFieldRadius(activeFieldObservation.id, radius)}
                                onInspectCandidate={inspectFieldCandidate}
                                onConfirmCandidate={point => confirmFieldCandidate(activeFieldObservation.id, point)}
                                onRejectCandidate={point => rejectFieldCandidate(activeFieldObservation.id, point)}
                            />}

                            {compared.length > 0 && (
                                <section className="compare-panel">
                                    <div className="chart-head"><div><small>多点证据 · {compared.length}/{MAX_COMPARE_POINTS}</small><h3>多点时间序列对比</h3></div><span>已显示 {curves.length} 条</span></div>
                                    <div className="curve-list-head"><span>勾选需要显示的曲线</span><div><button onClick={() => setCurveIds(compareIds)}>全选</button><button onClick={() => setCurveIds([])}>全不选</button></div></div>
                                    <div className="curve-checklist">
                                        {compared.map((p, j) => (
                                            <div className={"curve-row " + (selected?.id === p.id ? "is-focused" : "")} key={p.id}>
                                                <label><input type="checkbox" checked={curveIds.includes(p.id)} onChange={() => toggleCurve(p.id)} /><i style={{ background: comparisonColor(j) }} /><span>{p.id}</span><small>{normalizedMode(p.mode)} · {p.velocity.toFixed(1)} mm/yr · 当前 {currentDisplacement(p, timeIndex).toFixed(1)} mm</small></label>
                                                <button onClick={() => setSelected(p)}>详情</button>
                                                <button className="curve-remove" aria-label={"移除点位 " + p.id} onClick={() => removeCompared(p.id)}>×</button>
                                            </div>
                                        ))}
                                    </div>
                                    {compareStats && (
                                        <div className="compare-summary">
                                            <article><span>平均速率</span><b>{compareStats.meanVelocity.toFixed(1)}</b><small>mm/yr</small></article>
                                            <article><span>速率跨度</span><b>{compareStats.velocitySpread.toFixed(1)}</b><small>{compareStats.minimumVelocity.toFixed(1)}—{compareStats.maximumVelocity.toFixed(1)}</small></article>
                                            <article><span>当前形变跨度</span><b>{compareStats.currentDisplacementSpread.toFixed(1)}</b><small>{compareStats.minimumCurrentDisplacement.toFixed(1)}—{compareStats.maximumCurrentDisplacement.toFixed(1)} mm</small></article>
                                            <article><span>模式 / 相干性</span><b>{compareStats.modeCount} 类</b><small>均值 {compareStats.meanCoherence === null ? "—" : compareStats.meanCoherence.toFixed(2)}</small></article>
                                        </div>
                                    )}
                                    {curves.length ? <CompareChart points={curves} exportBusy={exportOperation.state === "running"} onExportData={exportComparison} onExportChart={svg => exportChart(svg, "comparison")} /> : <div className="empty-curves">请在上方勾选要显示的时序曲线</div>}
                                </section>
                            )}

                            {selected && selectedInsight ? (
                                <>
                                    <div className="point-title phase-three-point-title">
                                        <span className="point-section-label">点位证据</span>
                                        <span className={selectedInsight.status === "质量需关注" ? "status-pill danger" : "status-pill"}>{selectedInsight.status}</span>
                                        <h2>{selected.id}</h2>
                                        <p>{selected.lon.toFixed(6)}° E · {selected.lat.toFixed(6)}° N</p>
                                    </div>
                                    <section className="point-mode-result" aria-label="点位模式结果">
                                        <article><span>AI 形变模式</span><b>{selectedInsight.modeLabel}</b></article>
                                        <article><span>模型置信度</span><b>{selectedInsight.confidenceLabel}</b><small>{selected.pasc?.lowConfidence ? "低置信度，建议复核" : "仅显示 CSV / 模型真实提供值"}</small></article>
                                        <article><span>数据质量</span><b>{selectedDataQuality?.label ?? "未评估"}</b><small>{selectedDataQuality?.reasons.join(" · ") ?? "未提供质量依据"}</small></article>
                                        <article className="wide"><span>模式来源</span><b>{selectedInsight.modeSource}</b></article>
                                    </section>
                                    {selectedTopTwo.length > 0 && <section className="point-top-two" aria-label="PASC Top-2 分类结果"><span>TOP-2</span>{selectedTopTwo.map((candidate, index) => <article key={candidate.name}><i style={{ background: candidate.color }} /><small>#{index + 1}</small><b>{candidate.nameZh}</b><strong>{(candidate.probability * 100).toFixed(1)}%</strong></article>)}</section>}
                                    <div className="point-metrics phase-three-metrics">
                                        {selected.series.length >= 2 ? <article><span>{currentDate} 累计形变</span><b>{currentValue.toFixed(1)}</b><small>mm</small></article> : <article><span>PASC 空间可靠性</span><b>{selected.pasc ? (selected.pasc.spatialReliability * 100).toFixed(1) : "—"}</b><small>{selected.pasc ? "% · 原始字段" : "未提供"}</small></article>}
                                        <article><span>长期速率</span><b>{selected.velocity.toFixed(1)}</b><small>mm / yr</small></article>
                                        <article><span>近一年速率</span><b>{selectedInsight.recentVelocity === null ? "—" : selectedInsight.recentVelocity.toFixed(2)}</b><small>{selected.series.length >= 2 ? `${selectedInsight.recentStartDate}—${selected.updated}` : "源文件未含逐期时序"}</small></article>
                                        <article className="quality-metric"><span>相干性 / 缺测率</span><b>{selected.coherence ? selected.coherence.toFixed(2) : "未提供"}</b><small>{(selected.missingRate * 100).toFixed(1)}% 缺测</small></article>
                                    </div>
                                    {selected.series.length >= 2 ? <><div className="chart-head"><div><small>时间序列 · {selected.series.length} 期</small><h3>{selected.observedDates ? "模型预处理时序" : "累计形变时间序列"}</h3></div><span>mm</span></div><TimeSeriesChart key={selected.id} point={selected} showTrend={showTrend} timeIndex={timeIndex} stageAnalysis={selectedStageAnalysis} exportBusy={exportOperation.state === "running"} onExportChart={svg => exportChart(svg, "point")} /><div className="chart-toggles"><label><input type="checkbox" checked={showTrend} onChange={e => setShowTrend(e.target.checked)} />线性拟合趋势</label><span>阶段速率 {stageVelocity(selected, rangeStart, rangeEnd).toFixed(1)} mm/yr</span></div></> : <section className="empty-curves timeseries-unavailable"><b>原始文件未提供逐期累计形变</b><span>该点仍保留速率、相干性、PASC 六类概率、置信度和空间可靠性；系统不会据此伪造时间序列。</span></section>}
                                    {selectedStageAnalysis && <section className="point-stage-analysis"><header><span>{selectedStageAnalysis.source === "provided" ? "变化点结果" : "候选变化点 · 序列估算"}</span><b>{selectedStageAnalysis.changeDate}</b></header><div><article><span>前阶段斜率</span><b>{selectedStageAnalysis.slopeBefore.toFixed(1)}</b><small>mm / yr</small></article><article><span>后阶段斜率</span><b>{selectedStageAnalysis.slopeAfter.toFixed(1)}</b><small>mm / yr</small></article></div><p>{selectedStageAnalysis.method}</p></section>}
                                    <section className="point-explanation">
                                        <span>规则化解读</span>
                                        <h3>点位解释</h3>
                                        {selectedModeExplanation && <p>{selectedModeExplanation}</p>}
                                        {selectedInsight.explanation.map(sentence => <p key={sentence}>{sentence}</p>)}
                                        <small>解释仅基于当前点位数值、质量指标和已有模式字段，不构成工程安全判断或灾害预警。</small>
                                    </section>
                                    <button className="workspace-text-action" onClick={() => addPointToRoute(selected)}>加入考察目标</button>
                                    {selected.observedSeries && <details className="local-observed-series"><summary>查看原始实测值与缺测标记</summary><p>异常依据使用真实观测；图表主曲线是模型预处理时序。</p><div style={{ maxHeight: 180, overflow: "auto" }}><table><thead><tr><th>日期</th><th>实测位移 mm</th></tr></thead><tbody>{selected.observedDates?.map((date, index) => <tr key={date}><td>{date}</td><td>{Number.isFinite(selected.observedSeries?.[index]) && (!selected.observedMask || selected.observedMask[index]) ? selected.observedSeries![index].toFixed(1) : "缺测"}</td></tr>)}</tbody></table></div></details>}
                                    <dl className="point-fields"><div><dt>点位编号</dt><dd>{selected.id}</dd></div><div><dt>当前渲染</dt><dd>{attributeNames[attribute]}</dd></div><div><dt>最近观测</dt><dd>{selected.updated}</dd></div><div><dt>有效期数</dt><dd>{selected.effectiveEpochCount ?? selected.series.length} 期实测</dd></div></dl>
                                    <button className="button primary export-button" disabled={exportOperation.state === "running"} onClick={exportPoint}>导出单点 CSV ↓</button>
                                </>
                            ) : !compared.length && !activeFieldObservation && (
                                <section className="point-empty"><b>尚未选择监测点</b><span>选择“单点”查看完整时序，或选择“多点对比”建立最多 {MAX_COMPARE_POINTS} 条曲线。</span></section>
                            )}
                        </div>
                    )}

                    {rightTab === "region" && (
                        <div id="right-workspace-panel-region" className="workspace-tab-panel region-analysis-tab" role="region" aria-label="区域结果">
                            <div className="analysis-mode-tools">
                                <span>区域工具</span>
                                <div>
                                    <button className={selectionMode === "box" ? "active" : ""} onClick={() => chooseSelection("box")}>矩形框选</button>
                                    <button className={selectionMode === "polygon" ? "active" : ""} onClick={() => chooseSelection("polygon")}>多边形 AOI</button>
                                    <button disabled={!analysis.selectedRegion} onClick={clearRegionSelection}>清除区域</button>
                                </div>
                            </div>
                            {activeFilter === "anomaly" && <AnomalyRegionPanel
                                result={anomalyRegionResult}
                                activeRegionId={activeAnomalyRegionId}
                                onSelect={focusAnomalyRegion}
                                onShowAll={() => showAllAnomalyPoints("已恢复全部异常聚集点。")}
                                onShowIsolated={() => showAllAnomalyPoints("正在查看离散大值点，它们不计入聚集异常。", "isolated")}
                                onShowExcluded={() => showAllAnomalyPoints("正在复核因质量排除的大值点，它们不计入异常。", "excluded")}
                                selection={prioritySelection}
                                view={anomalyView}
                                evaluationDate={detectionDate}
                                dataNote={anomalyDataNote}
                                onParametersChange={changeAnomalyRegionParameters}
                            />}
                            {boxStats ? (
                                <section className={"selection-summary phase-four-region-summary " + (activeFilter === "anomaly" ? "is-anomaly" : "")}>
                                    <header>
                                        <small>{activeFilter === "anomaly" ? "异常发现" : "区域分析"}</small>
                                        <h3>{analysis.selectedRegion?.label || (activeFilter === "none" ? "自定义分析区域" : "当前筛选结果")}</h3>
                                        <p>{analysis.timeRange.startDate}—{analysis.timeRange.endDate} · 当前期 {currentDate}</p>
                                    </header>
                                    {activeFilter === "anomaly" && <div className="anomaly-result-banner"><b>{activeAnomalyRegionId ? `正在分析异常聚集区 ${activeAnomalyRegionId}` : anomalyView === "clustered" ? `${prioritySelection.anomalies.length} 个聚集异常点` : anomalyView === "isolated" ? "离散大值点 · 不计入异常" : "质量排除点 · 不计入异常"}</b><span>发现依据：全期速率与 {detectionDate || "末期"} 累计量；下方当前形变统计随时间轴回看。</span></div>}
                                    <div><span>AOI 面积</span><b>{boxStats.areaKm2 === null ? "—" : boxStats.areaKm2 < 1 ? boxStats.areaKm2.toFixed(3) : boxStats.areaKm2.toFixed(2)}</b><small>{boxStats.areaKm2 === null ? "属性筛选无绘制面积" : "km² · WGS84 球面估算"}</small></div>
                                    <div><span>{activeFilter === "none" ? "区域点数" : "筛选点数"}</span><b>{boxPoints.length.toLocaleString()}</b><small>个有效监测点</small></div>
                                    <div><span>平均速率</span><b>{boxStats.avg.toFixed(1)}</b><small>mm/yr</small></div>
                                    <div><span>中位速率</span><b>{boxStats.medianVelocity.toFixed(1)}</b><small>mm/yr · 抗离群值</small></div>
                                    {hasTimeSeries ? <><div><span>平均 / 中位当前形变</span><b>{boxStats.averageCurrent.toFixed(1)} / {boxStats.medianCurrentDisplacement.toFixed(1)}</b><small>mm</small></div><div><span>最大累计量</span><b>{boxStats.max.toFixed(1)}</b><small>mm · 绝对值</small></div></> : <div><span>数据形态</span><b>原始密集点</b><small>源文件未提供逐期累计形变</small></div>}
                                    <div><span>速率范围</span><b>{boxStats.minVelocity.toFixed(1)}—{boxStats.maxVelocity.toFixed(1)}</b><small>mm/yr</small></div>
                                    <div><span>平均相干性</span><b>{boxStats.averageCoherence === null ? "未提供" : boxStats.averageCoherence.toFixed(2)}</b><small>{boxStats.lowCoherenceCount} 个低相干 · {boxStats.missingDataCount} 个高缺测</small></div>
                                    {activeFilter === "anomaly" && <div className="anomaly-rule-stats"><span>双指标 AND 同向聚集</span><small>|速率| ≥ {prioritySelection.thresholds.velocityMmPerYear} mm/yr</small><small>|累计量| ≥ {prioritySelection.thresholds.displacementMm} mm</small><small>邻域 {anomalyRadiusMeters} m · 至少 {anomalyMinimumPoints} 个不同位置</small><small>相干性待核实 · {boxPoints.filter(point => priorityLimitedPointIds.includes(point.id)).length}</small></div>}
                                    <div className="mode-breakdown"><span>形变模式统计</span>{deformationModeOrder.filter(mode => boxStats.modes[mode]).map(mode => <small key={mode} style={{ borderLeft: "4px solid " + colorForMode(mode) }}>{mode} · {boxStats.modes[mode].toLocaleString()} 点 · {((boxStats.modes[mode] / boxPoints.length) * 100).toFixed(0)}%</small>)}</div>
                                    <p className="layer-rule-note">异常分析范围：{anomalyScopeLabel}。圈选范围内的点并不自动视为异常。</p><button type="button" className="workspace-text-action" disabled={!boxPoints.length} onClick={useSelectedAnomalyScope}>用当前选区发现异常</button>{hasTimeSeries ? <AoiTimeSeriesChart points={boxPoints} loadSeries={localDataset ? loadSelectedAoiSeries : undefined} exportBusy={exportOperation.state === "running"} onExportData={exportAoiSeries} onExportChart={svg => exportChart(svg, "aoi")} /> : <div className="empty-curves timeseries-unavailable"><b>区域时序不可用</b><span>区域速率、相干性和形变模式统计仍来自当前框选的真实密集点。</span></div>}
                                    <div className="region-summary-actions phase-six-region-actions"><button disabled={exportOperation.state === "running"} onClick={exportAoiPoints}>导出 AOI 点位 CSV</button><Link href="/statistics">进入区域统计</Link><button onClick={clearRegionSelection}>清除区域与结果</button></div>
                                </section>
                            ) : (
                                <section className="region-empty"><b>{analysis.selectedRegion?.pointIdsComplete === false ? "已恢复分析范围，请重新圈选点位" : activeFilter === "anomaly" ? "当前视图没有符合条件的点" : analysis.selectedRegion ? "AOI 内没有监测点" : "尚未建立分析区域"}</b><span>{analysis.selectedRegion?.pointIdsComplete === false ? `上次选区包含 ${analysis.selectedRegion.pointCount?.toLocaleString() ?? "多"} 个点；恢复仅保留范围信息，重新圈选后才能统计和分析。` : activeFilter === "anomaly" ? `幅值达标 ${prioritySelection.amplitudeCandidates.length} 点；质量排除 ${prioritySelection.excludedLowQuality.length} 点；离散待查 ${prioritySelection.isolated.length} 点。可在上方分别复核；没有聚集结果不等于没有形变。` : analysis.selectedRegion ? "绘制几何已保留在地图上；请扩大区域或清除后重新绘制。" : "可拖动绘制矩形，或单击添加多边形顶点并双击完成；真实点位统计和聚合时序会保留在右侧。"}</span></section>
                            )}
                        </div>
                    )}

                    {rightTab === "action" && (
                        <div id="right-workspace-panel-action" className="workspace-tab-panel inspection-action-tab" role="region" aria-label="核查候选">
                            <InspectionActionPanel
                                regions={activeFilter === "anomaly" ? anomalyRegionResult.regions : []}
                                activeRegionId={activeAnomalyRegionId}
                                datasetTitle={datasetTitle}
                                observationDate={currentDate}
                                layers={gisLayers}
                                clusterRadiusMeters={anomalyRegionResult.parameters.radiusMeters}
                                clusterMinimumPoints={anomalyRegionResult.parameters.minimumPoints}
                                onDiscover={discoverInspectionCandidates}
                                onFocus={focusInspectionCandidate}
                                onAddRegionToNavigation={addRegionToRoute}
                                navigationBusy={priorityState !== "ready"}
                                onClearFocus={() => showAllAnomalyPoints("已取消当前空间分组，地图恢复显示全部异常候选点。")}
                                onOpenLayers={() => { setLeftCollapsed(false); setRightCollapsed(true); setLeftTab("layers"); }}
                                onOpenAi={() => { setRightTab("ai"); setRightCollapsed(false); setLeftCollapsed(true); }}
                                onExport={exportInspectionBrief}
                            />
                        </div>
                    )}

                    {(rightTab === "pasc" || Boolean(localPascFile)) && (
                        <div id="right-workspace-panel-pasc" hidden={rightTab !== "pasc"} style={rightTab !== "pasc" ? { display: "none" } : undefined} className="workspace-tab-panel pasc-workspace-tab" role="region" aria-label="模式识别">
                            <section className="pasc-execution-switch" aria-label="PASC 执行模式">
                                <div><small>执行方式</small><b>分析执行位置</b></div>
                                <span><button className={pascExecutionMode === "local" ? "active" : ""} onClick={() => setPascExecutionMode("local")}>浏览器本地 · 默认</button><button disabled={USER_DATA_LOCAL_ONLY} className={pascExecutionMode === "legacy" ? "active" : ""} onClick={() => { if (!USER_DATA_LOCAL_ONLY) setPascExecutionMode("legacy"); }}>{USER_DATA_LOCAL_ONLY ? "云端分析 · 已关闭" : "云端分析 · 备用"}</button></span>
                            </section>
                            <p className="layer-rule-note">日期列会自动识别并按时间排序，支持 D20240101、D_20240101、20240101、D_2024-01-01 等表头。选择文件后可查看实际期数与日期范围，核对设置后再开始分析。</p>
                            {USER_DATA_LOCAL_ONLY && <p className="layer-rule-note">所有大小的 CSV 均使用本机处理路径，不会转为云端任务。本机资源和缓存按当前浏览器、网站域名隔离；更换域名或清理浏览器后需重新选文件，请下载保存结果。</p>}
                            {pascExecutionMode === "local" || USER_DATA_LOCAL_ONLY ? <PascLocalWebGis
                                key={localPascFile ? `${localPascFile.name}:${localPascFile.size}:${localPascFile.lastModified}` : "no-local-file"}
                                file={localPascFile}
                                initialSettings={localImportSettings}
                                onChooseFile={chooseImportFile}
                                onApplied={applyLocalResult}
                                onDiscard={discardLocalAnalysis}
                                onFilter={applyPascResultFilter}
                            /> : <PascOnlineRecognition
                                totalPoints={points.length}
                                candidatePoints={pascCandidateCount}
                                mappingConfirmed={Boolean(parseReport && mapping)}
                                preprocessingState={mapping?.preprocessingState}
                                blockingIssues={pascBlockingIssues}
                                runState={pascOnlineRun}
                                lowConfidenceCount={pascLowConfidenceCount}
                                limitedReferenceCount={pascLimitedReferenceCount}
                                onRun={() => void runPascOnlineRecognition()}
                                onFilter={applyPascResultFilter}
                            />}
                            <PascCompatibilityCheck summary={parseReport?.compatibility ?? null} />
                            <PascAnalysisPanel point={selected} />
                            <PascRegionStats points={boxPoints.length ? boxPoints : points} />
                            <PascPatternLegend />
                        </div>
                    )}

                    {rightTab === "ai" && (
                        <div id="right-workspace-panel-ai" className="workspace-tab-panel ai-analysis-tab" role="region" aria-label="AI 解读">
                            <AiEvidencePanel context={localAiContext} onAction={handleEvidenceAction} />
                            {USER_DATA_LOCAL_ONLY ? <section className="ai-context-panel"><h3>外部 AI 已关闭</h3><p>数据摘要不会发送给站点后端或外部模型。上方分析助手在当前电脑处理当前数据。</p></section> : <section className="ai-context-panel phase-five-ai-panel">
                                <header className="ai-panel-heading"><div><small>可选增强 · 会消耗模型额度</small><h3>外部模型区域解读（可选）</h3></div><div className="ai-panel-heading-actions"><span>{aiAccessMode === "site" ? "可选站点额度" : (personalAiProvider === "bailian" ? "百炼" : "DeepSeek") + " · 个人额度"}</span><button type="button" onClick={() => setAiSettingsOpen(true)}>配置 API</button></div></header>
                                <p>上方分析助手直接处理当前数据。本区仅在你主动点击后调用外部模型，并且只发送不超过 12 KB 的脱敏聚合摘要。</p>
                                <div className="ai-input-summary">
                                    <div><span>分析对象</span><b>{regionalAiInput?.regionLabel || "尚未建立区域"}</b></div>
                                    <div><span>有效点数</span><b>{regionalAiInput?.pointCount.toLocaleString() || "—"}</b></div>
                                    <div><span>时间范围</span><b>{regionalAiInput ? `${regionalAiInput.timeRange.startDate}—${regionalAiInput.timeRange.endDate}` : "—"}</b></div>
                                    <div><span>AI 输入规模</span><b>{regionalAiSummary ? `${analysisSummaryBytes(regionalAiSummary).toLocaleString()} B · ${regionalAiSummary.modeDistribution.length} 类` : "—"}</b></div>
                                </div>

                                <details className="ai-service-settings" open={aiSettingsOpen} onToggle={event => setAiSettingsOpen(event.currentTarget.open)}>
                                    <summary><span>AI 服务与额度</span><b>{aiAccessMode === "site" ? "站点提供" : "使用我的 API Key"}</b></summary>
                                    <div className="ai-service-options" role="radiogroup" aria-label="AI 服务额度来源">
                                        <label aria-label="使用站点提供的 AI 额度" className={aiAccessMode === "site" ? "active" : ""}><input type="radio" name="ai-access-mode" checked={aiAccessMode === "site"} onChange={() => { setAiAccessMode("site"); setAiStatus("idle"); setAiError(""); }}/><span><b>站点提供</b><small>无需配置，直接点击分析；使用站点管理员的额度。</small></span></label>
                                        <label aria-label="使用我的个人 AI API Key" className={aiAccessMode === "personal" ? "active" : ""}><input type="radio" name="ai-access-mode" checked={aiAccessMode === "personal"} onChange={() => { setAiAccessMode("personal"); setAiStatus("idle"); setAiError(""); }}/><span><b>使用我的 API Key</b><small>使用你的模型额度；Key 只在本次页面会话中保存。</small></span></label>
                                    </div>
                                    {aiAccessMode === "personal" && <div className="ai-personal-key-panel">
                                        <label><span>模型服务</span><select aria-label="个人 API 模型服务" value={personalAiProvider} onChange={event => { setPersonalAiProvider(event.target.value as "bailian" | "deepseek"); setAiStatus("idle"); }}><option value="bailian">阿里云百炼（北京）</option><option value="deepseek">DeepSeek 官方 API</option></select></label>
                                        <div className="ai-key-help"><span>还没有 Key？</span><a href={personalAiProvider === "bailian" ? "https://help.aliyun.com/zh/model-studio/get-api-key" : "https://platform.deepseek.com/api_keys"} target="_blank" rel="noreferrer">{personalAiProvider === "bailian" ? "前往百炼官方说明创建 API Key" : "前往 DeepSeek 开放平台创建 API Key"} ↗</a>{personalAiProvider === "bailian" && <small>截图中的模型免费额度会由该 Key 调用时自动抵扣；建议保持“免费额度用完即停”开启，具体额度和有效期以控制台为准。</small>}</div>
                                        <label><span>API Key</span><div className="ai-key-field"><input aria-label="个人 AI API Key" type={showPersonalAiKey ? "text" : "password"} autoComplete="off" spellCheck={false} maxLength={512} value={personalAiKey} onChange={event => { setPersonalAiKey(event.target.value); setAiStatus("idle"); setAiError(""); setAiSettingsMessage(""); }} placeholder={personalAiProvider === "bailian" ? "粘贴百炼 API Key（sk-…）" : "粘贴 DeepSeek API Key"}/><button type="button" onClick={() => setShowPersonalAiKey(value => !value)}>{showPersonalAiKey ? "隐藏" : "显示"}</button></div></label>
                                        <div className="ai-personal-key-note"><span>仅本次会话</span><p>Key 不写入 Blob、数据库或浏览器持久存储，只随本次分析临时发送给本站后端。请只在可信部署中使用。</p>{personalAiKey && <button type="button" onClick={() => { setPersonalAiKey(""); setShowPersonalAiKey(false); setAiStatus("idle"); }}>清除 Key</button>}</div>
                                        <div className="ai-config-actions"><div>{personalAiKey.trim().length >= 8 ? <><i aria-hidden="true"/>已填写 · 尾号 {personalAiKey.trim().slice(-4)}</> : "Key 至少需要 8 个字符"}</div><button type="button" disabled={personalAiKey.trim().length < 8} onClick={() => { setAiSettingsMessage(`${personalAiProvider === "bailian" ? "阿里云百炼" : "DeepSeek"}已配置，可开始 AI 解读。`); setAiSettingsOpen(false); }}>完成配置</button></div>
                                    </div>}
                                </details>
                                {aiSettingsMessage && <p className="ai-config-success" role="status">{aiSettingsMessage}<button type="button" onClick={() => setAiSettingsOpen(true)}>修改</button></p>}

                                {localDataset && boxPoints.some(point => !point.localSeriesHydrated) && <p className="layer-rule-note">大文件选区的完整时序按需载入，当前不生成依赖全部曲线的 AI 摘要。可在区域分析计算全量原始观测时序。</p>}
                                {aiStatus === "idle" && <div className="ai-idle-state"><span>解读准备</span><b>{regionalAiSummary ? "区域摘要已准备" : "请先建立区域分析对象"}</b><p>{regionalAiSummary ? aiAccessMode === "site" ? "点击一次即可生成解读；使用站点额度，不需要任何配置。" : personalAiKey.trim().length >= 8 ? "将使用你的" + (personalAiProvider === "bailian" ? "百炼" : " DeepSeek") + "额度，Key 不会被保存。" : "请在上方 AI 服务设置中填写你的 API Key。" : "可前往区域分析使用矩形框选，或者运行一次异常发现。"}</p><button disabled={!regionalAiSummary || (aiAccessMode === "personal" && personalAiKey.trim().length < 8)} onClick={() => void runAiInterpretation()}>开始 AI 解读</button></div>}
                                {aiStatus === "running" && <div className="ai-loading-state" role="status"><i/><b>正在生成区域解读</b><span>{aiAccessMode === "site" ? "正在调用站点配置的模型，请稍候…" : "正在使用你的个人额度调用模型，Key 用后即丢…"}</span></div>}
                                {aiStatus === "error" && <div className="ai-error-state" role="alert"><span>解读中断</span><b>本次解读未完成</b><p>{aiError}</p><div><button onClick={() => void prepareAiInterpretation()}>使用免费网页备用</button><button onClick={() => void runAiInterpretation()}>重试 AI 解读</button></div></div>}
                                {aiStatus === "prepared" && <div className="ai-manual-flow">
                                    <div className="ai-manual-steps"><span>1 · 复制提示词</span><span>2 · 网页粘贴运行</span><span>3 · 粘贴 JSON</span></div>
                                    {aiError && <p className="ai-manual-error" role="alert">{aiError}</p>}
                                    <label><span>受限摘要提示词</span><textarea aria-label="DeepSeek 受限摘要提示词" readOnly value={aiPrompt} rows={6}/></label>
                                    <div className="ai-manual-actions"><button onClick={() => void prepareAiInterpretation()}>重新复制提示词</button><a href="https://chat.deepseek.com/" target="_blank" rel="noreferrer">打开 DeepSeek 免费网页版 ↗</a></div>
                                    <label><span>DeepSeek 返回的 JSON</span><textarea aria-label="DeepSeek 返回 JSON" value={aiResponseDraft} onChange={event => setAiResponseDraft(event.target.value)} rows={8} placeholder='粘贴包含 overview、mainPatterns、anomalies、regionFeatures、uncertainty、recommendations 的 JSON'/></label>
                                    <button className="ai-import-button" onClick={importAiInterpretation}>导入网页解读</button>
                                    <small>这是 API 未配置或暂时不可用时的备用流程；打开网页和粘贴均由你主动完成。</small>
                                </div>}
                                {aiStatus === "success" && aiResult && regionalAiInput && <div className="ai-result-card">
                                    <div className="ai-result-meta"><span>{aiResult.cached ? "近期缓存" : aiResult.provider === "manual" ? "已手动导入" : "AI 已生成"} · {new Date(aiResult.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span><b>{aiResult.engineLabel}</b></div>
                                    <article><span>1 · 总体概况</span><p>{aiResult.overview}</p></article>
                                    <article><span>2 · 主要形变模式</span><ol>{aiResult.mainPatterns.map(finding => <li key={finding}>{finding}</li>)}</ol></article>
                                    <article><span>3 · 值得关注的异常</span><ol>{aiResult.anomalies.map(finding => <li key={finding}>{finding}</li>)}</ol></article>
                                    <article><span>4 · 当前区域特征</span><ol>{aiResult.regionFeatures.map(finding => <li key={finding}>{finding}</li>)}</ol></article>
                                    <article className="ai-uncertainty"><span>5 · 不确定性与使用建议</span><p>{aiResult.uncertainty}</p><ol>{aiResult.recommendations.map(item => <li key={item}>{item}</li>)}</ol></article>
                                    <button className="ai-evidence-toggle" aria-expanded={evidenceOpen} onClick={() => setEvidenceOpen(value => !value)}>查看分析依据 <span>{evidenceOpen ? "收起" : "展开"}</span></button>
                                    {evidenceOpen && <dl className="ai-evidence-list">
                                        <div><dt>数据集</dt><dd>{regionalAiInput.datasetName}</dd></div>
                                        <div><dt>分析范围</dt><dd>{regionalAiInput.regionLabel}</dd></div>
                                        <div><dt>有效点数</dt><dd>{regionalAiInput.pointCount.toLocaleString()}</dd></div>
                                        <div><dt>时间范围</dt><dd>{regionalAiInput.timeRange.startDate}—{regionalAiInput.timeRange.endDate}</dd></div>
                                        <div><dt>筛选条件</dt><dd>{regionalAiInput.filterDescription}</dd></div>
                                        <div><dt>平均相干性</dt><dd>{regionalAiInput.averageCoherence == null ? "未提供" : regionalAiInput.averageCoherence.toFixed(2)}</dd></div>
                                        <div><dt>模式来源</dt><dd>{regionalAiInput.modeSource || "未提供"}</dd></div>
                                        <div><dt>解释引擎</dt><dd>{aiResult.engineLabel}</dd></div>
                                    </dl>}
                                    <div className="ai-next-actions"><span>继续分析</span><button onClick={discoverAnomalies}>定位异常点</button><button onClick={showPrimaryModes}>查看主要模式</button><button onClick={downloadAiSummary}>生成分析摘要</button></div>
                                    <small className="ai-boundary">结果只解释当前结构化统计，不构成工程安全判断、灾害预测或处置建议。</small>
                                </div>}
                            </section>}
                        </div>
                    )}
                </ResizableAnalysisPanel>
            </section>

            <section className="workspace-print-summary">
                <h1>InSAR 形变分析报告</h1><h2>{datasetTitle}</h2>
                <p>当前日期：{currentDate} · 显示 {mapVisiblePointCount.toLocaleString()} / {points.length.toLocaleString()} 点</p>
                <p>分析区间：{analysis.timeRange.startDate} — {analysis.timeRange.endDate}</p>
                <p>条件：{analysis.filters.description || "未启用"} · 区域：{analysis.selectedRegion?.label || "尚未建立区域"} · 选点：{selected?.id || "无"}</p>
            </section>
            <footer className="timeline-bar phase-two-timeline">
                {hasTimeSeries ? <><span>{points[0]?.dates?.[0] || "起始"}</span><input type="range" min="0" max={Math.max(0, periodCount - 1)} value={Math.min(timeIndex, periodCount - 1)} onChange={e => { setTimeIndex(+e.target.value); if (attribute !== "displacement") setAttribute("displacement"); }} aria-label={localDataset ? "模型预处理日期与累计形变渲染时间轴" : "观测日期与累计形变渲染时间轴"} /><b>{currentDate}</b><small>{timeIndex + 1} / {periodCount} {localDataset ? "模型节点" : "期"}</small></> : <><span>原始密集点结果</span><span className="timeline-static-note">逐期累计形变未随源文件提供</span><b>速率 / 分类</b><small>{points.length.toLocaleString()} 点</small></>}
                <button className="workspace-time-action" onClick={() => openLeft("time")}>区间分析</button>
            </footer>
            <div className="workspace-status-line" role="status">{navigationActive ? <><span>路线计算：滴图 Web 服务 · 当前底图独立于路线服务 · 选点不调用驾车接口</span><small className="workspace-boundary-note">非商业作品集 · 路线规划，非实时语音导航</small></> : <><span title={busy || status}>{busy || status}</span><b>{mapVisiblePointCount.toLocaleString()} / {points.length.toLocaleString()} 点显示</b><small className="workspace-boundary-note" title="本平台仅用于非商业作品集演示和现场辅助核查，不代表权威路网，也不构成工程安全判断。">作品集演示 · 非权威路网</small>{importCoherenceMin !== null && <button type="button" onClick={() => { setImportCoherenceMin(null); setStatus("已恢复显示全部有效点，原始数据未改变。"); }}>相干性 ≥ {importCoherenceMin.toFixed(2)} · 清除</button>}{activeFilter !== "none" && <button onClick={() => openLeft("filters")}>筛选已生效</button>}</>}</div>

            {sourceOpen && (
                <div className="config-backdrop" onMouseDown={() => setSourceOpen(false)}>
                    <section className="config-dialog" role="dialog" aria-modal="true" onMouseDown={e => e.stopPropagation()}>
                        <button className="dialog-close" onClick={() => setSourceOpen(false)}>×</button><span className="eyebrow">BASEMAP CONNECTION</span><h2>图源接入</h2>
                        <p>OSM 与 Esri 无需 Key。天地图需要浏览器端 Key，影像会同时加载影像和中文注记服务。</p>
                        <label className="key-field"><span>天地图 API Key</span><input value={keyDraft} onChange={e => setKeyDraft(e.target.value)} placeholder="粘贴天地图浏览器端 Key" /></label>
                        <label className="key-field"><span>自定义 XYZ / WMTS URL</span><input value={customDraft} onChange={e => setCustomDraft(e.target.value)} placeholder="例如 https://server/tiles/{z}/{x}/{y}.png" /></label>
                        <div className="source-status"><b>{tdtKey ? "已配置" : "尚未配置"}</b><span>Key 仅保存于当前浏览器。</span></div>
                        <div className="dialog-actions"><button className="button ghost" onClick={() => { setKeyDraft(""); localStorage.removeItem("lanjifyw-tianditu-key"); setTdtKey(""); }}>清除</button><button className="button primary" onClick={saveKey}>保存并加载</button></div>
                    </section>
                </div>
            )}

            {mappingOpen && inspection && mapping && (
                <div className="config-backdrop">
                    <section className="config-dialog mapping-dialog" role="dialog" aria-modal="true">
                        <button className="dialog-close" onClick={() => setMappingOpen(false)}>×</button><span className="eyebrow">FIELD MAPPING</span><h2>CSV 字段映射向导</h2>
                        <p>确认系统识别结果。带 * 的字段必须指定；日期列按列名自动识别并按时间排序，支持 D20240101、D_20240101、20240101、D_2024-01-01 等表头。</p>
                        <div className="mapping-grid">{fieldLabels.map(field => <label key={field.key}><span>{field.label}{field.required ? " *" : ""}</span><select value={mapping[field.key]} onChange={e => setMapping({ ...mapping, [field.key]: e.target.value })}><option value="">— 不使用 —</option>{inspection.headers.map(h => <option value={h} key={h}>{h}</option>)}</select></label>)}</div>
                        <div className="pasc-mapping-confirmations">
                            <label><span>形变单位 *</span><select value={mapping.displacementUnit ?? "unknown"} onChange={e => setMapping({ ...mapping, displacementUnit: e.target.value as CsvMapping["displacementUnit"] })}><option value="unknown">待确认</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
                            <label><span>速率单位</span><select value={mapping.velocityUnit ?? "unknown"} onChange={e => setMapping({ ...mapping, velocityUnit: e.target.value as CsvMapping["velocityUnit"] })}><option value="unknown">待确认 / 未提供</option><option value="mm/year">mm/year</option><option value="cm/year">cm/year</option><option value="m/year">m/year</option></select></label>
                            <label><span>形变正负号 *</span><select value={mapping.signConvention ?? "unknown"} onChange={e => setMapping({ ...mapping, signConvention: e.target.value as CsvMapping["signConvention"] })}><option value="unknown">待确认</option><option value="toward_satellite_positive">朝卫星为正</option><option value="away_from_satellite_positive">远离卫星为正</option></select></label>
                            <label><span>预处理状态 *</span><select value={mapping.preprocessingState ?? "unknown"} onChange={e => setMapping({ ...mapping, preprocessingState: e.target.value as CsvMapping["preprocessingState"] })}><option value="unknown">待确认</option><option value="raw">raw</option><option value="already_smoothed">already_smoothed</option></select></label>
                        </div>
                        <div className="mapping-dates"><b>累计形变日期列</b><span>已自动找到 {mappingDates.length} 期 · {mapping.timeCols.length} 列</span><small>{mappingDates.length ? `${mappingDates[0].canonical} 至 ${mappingDates.at(-1)!.canonical} · ` : "未找到有效日期 · "}{mapping.timeCols.slice(0, 6).join("、")}{mapping.timeCols.length > 6 ? " …" : ""}</small></div>
                        {inspection.warnings.length > 0 && <ul className="mapping-warnings">{inspection.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
                        <div className="dialog-actions"><button className="button ghost" onClick={() => setMappingOpen(false)}>取消</button><button className="button primary" onClick={confirmMapping}>验证并导入</button></div>
                    </section>
                </div>
            )}

            {reportOpen && parseReport && (
                <div className="config-backdrop" onMouseDown={() => setReportOpen(false)}>
                    <section className="config-dialog" onMouseDown={e => e.stopPropagation()}>
                        <button className="dialog-close" onClick={() => setReportOpen(false)}>×</button><span className="eyebrow">IMPORT REPORT</span><h2>CSV 导入与错误报告</h2>
                        <div className="report-metrics"><article><b>{parseReport.points.length.toLocaleString()}</b><span>有效点</span></article><article><b>{parseReport.invalid}</b><span>过滤行</span></article><article><b>{parseReport.periods}</b><span>观测期</span></article><article><b>{parseReport.modeField}</b><span>模式字段</span></article></div>
                        {parseReport.errors.length ? <ol className="error-list">{parseReport.errors.map((error, index) => <li key={index}>{error}</li>)}</ol> : <p className="success-report">未发现行级格式错误。</p>}
                    </section>
                </div>
            )}

            {guideOpen && (
                <div className="config-backdrop" onMouseDown={() => setGuideOpen(false)}>
                    <section className="config-dialog csv-guide" onMouseDown={e => e.stopPropagation()}>
                        <button className="dialog-close" onClick={() => setGuideOpen(false)}>×</button><span className="eyebrow">WORKSPACE GUIDE</span><h2>分析与外业核查指南</h2>
                        <div className="schema-grid"><article><b>数据字段</b><p>经纬度必需；velocity 可缺失，有至少 2 个真实日期值时按最小二乘计算。20 期为扩展实验门槛；20—39 期仅供探索性判读。</p></article><article><b>PASC 六分类</b><p>固定 Stable、Linear、Piecewise、Decelerating、Accelerating、Undefined；Stepwise 只标 legacy。</p></article><article><b>导入确认</b><p>单位、符号和 raw / already_smoothed 必须明确确认，禁止按数值猜测；字段导入不等于已执行模型识别。</p></article><article><b>外业驾车规划</b><p>在“驾车”中手动选择起点、终点与途经点，按需设置停留时间和访问顺序。路线由滴图 Web 服务生成，与 OSM 等底图独立。</p></article><article><b>进入条件核验</b><p>路线生成不等于入口已核验。停车、禁入、封路与最后一段接近方式需人工确认；本平台不提供实时导航或通行保证。</p></article><article><b>现场证据</b><p>在“核查”的现场记录中保存位置、照片与说明，复核监测点关联。现场记录与分析结果均需保留来源和适用边界。</p></article></div>
                        <div className="csv-example"><code>point_id,longitude,latitude,velocity,label,mode_source,confidence,coherence,D20200101,D20200113</code></div>
                        <div className="dialog-actions"><button className="button ghost" onClick={() => setGuideOpen(false)}>继续体验示例</button><button className="button primary" onClick={() => { setGuideOpen(false); chooseImportFile(); }}>选择本地 CSV</button></div>
                    </section>
                </div>
            )}
            {ruleSummaryOpen && <AnalysisRuleSummary summary={analysisRuleSummary} onClose={() => setRuleSummaryOpen(false)} onExport={exportRuleSummary} />}
        </main>
    );
}
