"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { demoDates, demoPoints, type InsarPoint } from "../data/site";
import { AnalysisProvider, colorForMode, deformationModeOrder, normalizedMode, useAnalysisContext, type AnalysisMapView, type SelectedRegionStats } from "../lib/analysis-context";
import { interpretRegionalAnalysis, type RegionalAnalysisInput, type RegionalInterpretation } from "../lib/ai-analysis";
import { trackEvent } from "../lib/analytics";
import { inspectCsv, parseMappedCsv, parseQgisRamp, stageVelocity, type CsvInspection, type CsvMapping, type DatasetParseResult, type RenderAttribute, type RenderStyle } from "../lib/insar-v2";
import { buildPascOnlineRequestBatches, filterPascOnlinePoints, mergePascOnlineResults, onlineErrorMessage, type PascOnlineFilter, type PascOnlineRunState } from "../lib/pasc-online";
import { parsePascMapPreview, pascMapLevelForZoom, type PascPublicJob } from "../lib/pasc-job-client";
import { listPrivateDatasets, patchPrivateDataset, readPrivateDatasetSource } from "../lib/private-datasets-client";
import { PascAnalysisPanel } from "./PascAnalysisPanel";
import { PascCompatibilityCheck } from "./PascCompatibilityCheck";
import { PascPatternLegend } from "./PascPatternLegend";
import { PascOnlineRecognition } from "./PascOnlineRecognition";
import { PascRegionStats } from "./PascRegionStats";

const MapCanvas = dynamic(() => import("./WebGisMap"), { ssr: false, loading: () => <div className="map-loading">正在初始化 WebGIS 地图…</div> });
const defaultColors = ["#e94b4b", "#ff8a34", "#eee3b1", "#0a9c93", "#1677ff"];
const attributeNames: Record<RenderAttribute, string> = { velocity: "年均速率", displacement: "当前期累计形变", stageVelocity: "阶段速率", mode: "形变模式", coherence: "相干性", missing: "缺测率" };
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

type AnomalySummary = {
    total: number;
    clearSubsidence: number;
    accelerating: number;
    pattern: number;
    excludedLowQuality: number;
};

const pointBounds = (items: InsarPoint[]): [number, number, number, number] => items.length ? [
    Math.min(...items.map(point => point.lon)),
    Math.min(...items.map(point => point.lat)),
    Math.max(...items.map(point => point.lon)),
    Math.max(...items.map(point => point.lat)),
] : [0, 0, 0, 0];

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
        `该点长期序列表现为${direction}趋势，长期速率为 ${point.velocity.toFixed(2)} mm/yr。`,
    ];
    if (recentVelocity !== null) {
        const longMagnitude = Math.abs(point.velocity);
        const recentMagnitude = Math.abs(recentVelocity);
        if (longMagnitude > 0.2 && recentMagnitude > longMagnitude * 1.25) explanation.push(`近一年变化速度为 ${recentVelocity.toFixed(2)} mm/yr，高于长期变化水平。`);
        else if (longMagnitude > 0.2 && recentMagnitude < longMagnitude * 0.75) explanation.push(`近一年变化速度为 ${recentVelocity.toFixed(2)} mm/yr，低于长期变化水平。`);
        else explanation.push(`近一年变化速度为 ${recentVelocity.toFixed(2)} mm/yr，与长期水平接近。`);
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

function TimeSeriesChart({ point, showTrend, timeIndex }: {
    point: InsarPoint;
    showTrend: boolean;
    timeIndex: number;
}) {
    const sourceValues = point.series;
    const sourceDates = point.dates?.length ? point.dates : demoDates.slice(0, sourceValues.length);
    const [zoomStart, setZoomStart] = useState(0);
    const [zoomEnd, setZoomEnd] = useState(Math.max(1, sourceValues.length - 1));
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const safeEnd = Math.min(sourceValues.length - 1, Math.max(1, zoomEnd));
    const safeStart = Math.max(0, Math.min(zoomStart, safeEnd - 1));
    const values = sourceValues.slice(safeStart, safeEnd + 1);
    const dates = sourceDates.slice(safeStart, safeEnd + 1);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const range = hi - lo || 1;
    const count = Math.max(1, values.length - 1);
    const width = 400, height = 250, left = 54, right = 18, top = 20, bottom = 46;
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

    const handleHover = (event: ReactMouseEvent<SVGSVGElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / rect.width) * width;
        const next = Math.max(0, Math.min(count, Math.round(((svgX - left) / plotW) * count)));
        setHoverIndex(next);
    };

    return (
        <div className="series-chart phase-three-series">
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${point.name}累计形变时序曲线，横轴为观测日期，纵轴为累计形变毫米`} onMouseMove={handleHover} onMouseLeave={() => setHoverIndex(null)}>
                <g className="chart-grid">
                    {yTicks.map((tick, index) => <line key={`y-${index}`} x1={left} y1={tick.pos} x2={width - right} y2={tick.pos} />)}
                    {xTicks.map((tick, index) => <line key={`x-${index}`} x1={x(tick)} y1={top} x2={x(tick)} y2={height - bottom} />)}
                </g>
                <g className="chart-axes">
                    <line x1={left} y1={top} x2={left} y2={height - bottom} />
                    <line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
                    {yTicks.map((tick, index) => <g key={`yl-${index}`}><line x1={left - 4} y1={tick.pos} x2={left} y2={tick.pos} /><text x={left - 7} y={tick.pos + 4} textAnchor="end">{tick.value.toFixed(1)}</text></g>)}
                    {xTicks.map((tick, index) => <g key={`xl-${index}`}><line x1={x(tick)} y1={height - bottom} x2={x(tick)} y2={height - bottom + 4} /><text x={x(tick)} y={height - bottom + 16} textAnchor="middle">{axisDate(dates[tick] || String(tick))}</text></g>)}
                    <text className="axis-title" x={(left + width - right) / 2} y={height - 7} textAnchor="middle">观测日期</text>
                    <text className="axis-title" transform={`translate(14 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle">累计形变 (mm)</text>
                </g>
                {showTrend && <polyline className="trend-line" points={trend} />}
                <polyline className="data-line" points={points} />
                {values.map((value, index) => (index % dotStep === 0 || index === count) ? <circle className="observed-dot" key={index} cx={x(index)} cy={y(value)} r="2.2" /> : null)}
                {currentVisible && <circle className="current-time-dot" cx={x(currentLocalIndex)} cy={y(values[currentLocalIndex] ?? values.at(-1) ?? 0)} r="3.6" />}
                <rect className="chart-hit-area" x={left} y={top} width={plotW} height={plotH} />
                {hoverIndex !== null && hoveredValue !== null && (
                    <g className="chart-hover">
                        <line x1={hoverX} y1={top} x2={hoverX} y2={height - bottom} />
                        <circle cx={hoverX} cy={hoverY} r="4" />
                        <rect x={tooltipX} y={Math.max(top + 4, hoverY - 43)} width="136" height="38" rx="7" />
                        <text x={tooltipX + 8} y={Math.max(top + 19, hoverY - 28)}>{dates[hoverIndex] || "—"}</text>
                        <text x={tooltipX + 8} y={Math.max(top + 34, hoverY - 13)}>{hoveredValue.toFixed(2)} mm</text>
                    </g>
                )}
                <g className="chart-legend">
                    <rect x={width - 137} y={top + 7} width="124" height={showTrend ? 38 : 22} rx="6" />
                    <line x1={width - 128} y1={top + 19} x2={width - 104} y2={top + 19} /><circle cx={width - 116} cy={top + 19} r="2.6" /><text x={width - 99} y={top + 23}>监测值</text>
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
        </div>
    );
}
function CompareChart({ points }: {
    points: InsarPoint[];
}) {
    const shown = points.slice(0, 30), values = shown.flatMap(p => p.series), lo = Math.min(...values), hi = Math.max(...values), range = hi - lo || 1, width = 400, height = 235, left = 54, right = 18, top = 18, bottom = 44, plotW = width - left - right, plotH = height - top - bottom, maxCount = Math.max(1, ...shown.map(p => p.series.length - 1)), x = (i: number, count: number) => left + (i / Math.max(1, count)) * plotW, y = (v: number) => top + ((hi - v) / range) * plotH, color = (j: number) => `hsl(${(j * 47) % 360} 88% 45%)`, yTicks = Array.from({ length: 5 }, (_, i) => ({ value: hi - (range * i) / 4, pos: top + (plotH * i) / 4 })), xTicks = Array.from({ length: 5 }, (_, i) => Math.round((maxCount * i) / 4)), dates = shown[0]?.dates || [];
    return <div className="compare-chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="多点累计形变时序对比，横轴为观测日期，纵轴为累计形变毫米"><g className="chart-grid">{yTicks.map((tick, i) => <line key={`y-${i}`} x1={left} y1={tick.pos} x2={width - right} y2={tick.pos}/>)}{xTicks.map((tick, i) => <line key={`x-${i}`} x1={x(tick, maxCount)} y1={top} x2={x(tick, maxCount)} y2={height - bottom}/>)}</g><g className="chart-axes"><line x1={left} y1={top} x2={left} y2={height - bottom}/><line x1={left} y1={height - bottom} x2={width - right} y2={height - bottom}/>{yTicks.map((tick, i) => <text key={i} x={left - 7} y={tick.pos + 4} textAnchor="end">{tick.value.toFixed(1)}</text>)}{xTicks.map((tick, i) => <text key={i} x={x(tick, maxCount)} y={height - bottom + 16} textAnchor="middle">{axisDate(dates[tick] || String(tick))}</text>)}<text className="axis-title" x={(left + width - right) / 2} y={height - 6} textAnchor="middle">观测日期</text><text className="axis-title" transform={`translate(14 ${(top + height - bottom) / 2}) rotate(-90)`} textAnchor="middle">累计形变 (mm)</text></g>{shown.map((p, j) => <polyline key={p.id} style={{ stroke: color(j) }} points={p.series.map((v, i) => `${x(i, p.series.length - 1)},${y(v)}`).join(" ")}/>)}</svg><div>{shown.slice(0, 12).map((p, j) => <span key={p.id}><i style={{ background: color(j) }}/>{p.id}</span>)}{shown.length > 12 && <span>+ {shown.length - 12} 条</span>}</div></div>;
}
export function MapWorkspace() {
    return <AnalysisProvider><MapWorkspaceView /></AnalysisProvider>;
}
function MapWorkspaceView() {
    const { analysis, isReady: isAnalysisReady, updateAnalysis } = useAnalysisContext();
    const [points, setPoints] = useState<InsarPoint[]>(demoPoints), [selected, setSelected] = useState<InsarPoint | null>(demoPoints[1]), [datasetTitle, setDatasetTitle] = useState("海口示例 · 时序 InSAR"), [visible, setVisible] = useState({ points: true, boundary: true, risk: true, quality: false }), [base, setBase] = useState("osm"), [status, setStatus] = useState("正在加载公开示例数据…"), [showTrend, setShowTrend] = useState(true), [tdtKey, setTdtKey] = useState(""), [keyDraft, setKeyDraft] = useState(""), [customBasemap, setCustomBasemap] = useState(""), [customDraft, setCustomDraft] = useState(""), [baseOpacity, setBaseOpacity] = useState(1), [sourceOpen, setSourceOpen] = useState(false), [guideOpen, setGuideOpen] = useState(false), [mappingOpen, setMappingOpen] = useState(false), [reportOpen, setReportOpen] = useState(false), [inspection, setInspection] = useState<CsvInspection | null>(null), [mapping, setMapping] = useState<CsvMapping | null>(null), [pending, setPending] = useState<{
        text: string;
        name: string;
        file?: File;
    } | null>(null), [parseReport, setParseReport] = useState<DatasetParseResult | null>(null), [privateDatasetId, setPrivateDatasetId] = useState(""), [leftWidth, setLeftWidth] = useState(270), [rightWidth, setRightWidth] = useState(430), [leftCollapsed, setLeftCollapsed] = useState(false), [rightCollapsed, setRightCollapsed] = useState(false), [timeIndex, setTimeIndex] = useState(0), [rangeStart, setRangeStart] = useState(0), [rangeEnd, setRangeEnd] = useState(1), [attribute, setAttributeState] = useState<RenderAttribute>("velocity"), [styleMin, setStyleMin] = useState(-30), [styleMax, setStyleMax] = useState(30), [interval, setInterval] = useState(15), [colors, setColors] = useState(defaultColors), [threshold, setThreshold] = useState(-10), [coherenceThreshold, setCoherenceThreshold] = useState(.75), [selectionMode, setSelectionMode] = useState<"single" | "compare" | "compareBox" | "box">("single"), [compareIds, setCompareIds] = useState<string[]>([]), [curveIds, setCurveIds] = useState<string[]>([]), [boxPoints, setBoxPoints] = useState<InsarPoint[]>([]), [busy, setBusy] = useState(""), [dataReady, setDataReady] = useState(false);
    const [leftTab, setLeftTab] = useState<"data" | "layers" | "filters">("data"), [rightTab, setRightTab] = useState<"point" | "region" | "pasc" | "ai">("point"), [activeFilter, setActiveFilter] = useState<"none" | "velocity" | "coherence" | "anomaly" | "pascLowConfidence" | "pascLimitedSpatial">("none");
    const [aiStatus, setAiStatus] = useState<"idle" | "loading" | "success" | "error">("idle"), [aiResult, setAiResult] = useState<RegionalInterpretation | null>(null), [aiError, setAiError] = useState(""), [evidenceOpen, setEvidenceOpen] = useState(false);
    const [pascOnlineRun, setPascOnlineRun] = useState<PascOnlineRunState>(emptyPascOnlineRun);
    const [jobPreviewId, setJobPreviewId] = useState("");
    const jobPreviewLevel = useRef("");
    const pascRunId = useRef(0);
    const restoreRequested = useRef(false), restoredContextKey = useRef("");
    const fileRef = useRef<HTMLInputElement>(null), qgisRef = useRef<HTMLInputElement>(null), riskCount = useMemo(() => points.filter(p => Math.abs(p.velocity) >= 3).length, [points]), qualityCount = useMemo(() => points.filter(p => (p.coherence > 0 && p.coherence < coherenceThreshold) || p.missingRate > .2).length, [points, coherenceThreshold]), periodCount = Math.max(1, points[0]?.series.length || 1), currentDate = points[0]?.dates?.[Math.min(timeIndex, periodCount - 1)] || "—";
    const renderStyle: RenderStyle = useMemo(() => ({ attribute, min: styleMin, max: styleMax, interval, timeIndex, rangeStart, rangeEnd, colors }), [attribute, styleMin, styleMax, interval, timeIndex, rangeStart, rangeEnd, colors]);
    const compared = compareIds.map(id => points.find(p => p.id === id)).filter(Boolean) as InsarPoint[], curves = compared.filter(p => curveIds.includes(p.id)), boxIds = useMemo(() => boxPoints.map(p => p.id), [boxPoints]);
    const anomalyDiscovery = useMemo(() => {
        const summary: AnomalySummary = { total: 0, clearSubsidence: 0, accelerating: 0, pattern: 0, excludedLowQuality: 0 };
        const chosen = points.filter(point => {
            const lowQuality = point.missingRate > .2 || (point.coherence > 0 && point.coherence < coherenceThreshold);
            if (lowQuality) { summary.excludedLowQuality++; return false; }
            const mode = normalizedMode(point.mode), clearSubsidence = point.velocity <= -3, accelerating = mode === "加速型", pattern = mode === "分段型";
            if (clearSubsidence) summary.clearSubsidence++;
            if (accelerating) summary.accelerating++;
            if (pattern) summary.pattern++;
            return clearSubsidence || accelerating || pattern;
        });
        summary.total = chosen.length;
        return { points: chosen, summary };
    }, [points, coherenceThreshold]);
    const boxStats = useMemo(() => boxPoints.length ? {
        avg: boxPoints.reduce((sum, point) => sum + point.velocity, 0) / boxPoints.length,
        minVelocity: Math.min(...boxPoints.map(point => point.velocity)),
        maxVelocity: Math.max(...boxPoints.map(point => point.velocity)),
        max: Math.max(...boxPoints.map(point => Math.abs(point.series[Math.min(timeIndex, point.series.length - 1)] ?? point.displacement))),
        averageCurrent: boxPoints.reduce((sum, point) => sum + (point.series[Math.min(timeIndex, point.series.length - 1)] ?? point.displacement), 0) / boxPoints.length,
        averageCoherence: (() => { const supplied = boxPoints.filter(point => point.coherence > 0); return supplied.length ? supplied.reduce((sum, point) => sum + point.coherence, 0) / supplied.length : null; })(),
        quality: boxPoints.filter(point => (point.coherence > 0 && point.coherence < coherenceThreshold) || point.missingRate > .2).length,
        modes: boxPoints.reduce((acc, point) => { const mode = normalizedMode(point.mode); acc[mode] = (acc[mode] || 0) + 1; return acc; }, {} as Record<string, number>),
    } : null, [boxPoints, coherenceThreshold, timeIndex]);
    const compareStats = useMemo(() => compared.length ? { avgVelocity: compared.reduce((s, p) => s + p.velocity, 0) / compared.length, avgCurrent: compared.reduce((s, p) => s + (p.series[Math.min(timeIndex, p.series.length - 1)] ?? p.displacement), 0) / compared.length, avgCoherence: compared.reduce((s, p) => s + p.coherence, 0) / compared.length } : null, [compared, timeIndex]);
    const pascCandidateCount = parseReport?.compatibility.pascCandidatePoints ?? points.filter(point => (point.effectiveEpochCount ?? point.series.length) >= 40).length;
    const pascBlockingIssues = (parseReport?.compatibility.issues ?? []).filter(issue => issue.severity === "error" || issue.severity === "confirmation").map(issue => issue.message);
    const pascLowConfidenceCount = points.filter(point => point.pasc?.lowConfidence).length;
    const pascLimitedReferenceCount = points.filter(point => point.pasc?.spatialApplicability === "limited_reference").length;
    const filteredPointCount = activeFilter !== "none" || analysis.selectedRegion ? boxPoints.length : points.length;
    const contextRegionStats = useMemo<SelectedRegionStats | null>(() => boxStats ? { pointCount: boxPoints.length, averageVelocity: boxStats.avg, maximumDisplacement: boxStats.max, qualityCount: boxStats.quality, modeCounts: boxStats.modes, averageDisplacement: boxStats.averageCurrent, averageCoherence: boxStats.averageCoherence, minimumVelocity: boxStats.minVelocity, maximumVelocity: boxStats.maxVelocity, velocityHistogram: buildVelocityHistogram(boxPoints) } : null, [boxStats, boxPoints]);
    const regionalAiInput = useMemo<RegionalAnalysisInput | null>(() => {
        if (!boxStats || !boxPoints.length) return null;
        const modeSources = [...new Set(boxPoints.map(point => point.modeSource?.trim()).filter(Boolean) as string[])];
        const descriptions = { none: "未启用额外筛选", velocity: `速率 ≤ ${threshold} mm/yr`, coherence: `相干性 < ${coherenceThreshold.toFixed(2)}`, anomaly: "明显沉降 / 加速沉降 / 阶段形变，已排除低质量点", pascLowConfidence: "PASC 低置信度结果", pascLimitedSpatial: "PASC 空间适用性有限结果" } as const;
        return {
            datasetName: datasetTitle,
            regionLabel: analysis.selectedRegion?.label || (activeFilter === "none" ? "自定义矩形区域" : "当前筛选结果"),
            selectionSource: analysis.selectedRegion?.source || "unknown",
            pointCount: boxPoints.length,
            timeRange: { startDate: points[0]?.dates?.[rangeStart] || "—", endDate: points[0]?.dates?.[rangeEnd] || "—" },
            filterDescription: descriptions[activeFilter],
            meanVelocity: boxStats.avg,
            averageDisplacement: boxStats.averageCurrent,
            maximumDisplacement: boxStats.max,
            averageCoherence: boxStats.averageCoherence,
            qualityCount: boxStats.quality,
            patternDistribution: Object.fromEntries(Object.entries(boxStats.modes).map(([mode, count]) => [mode, count / boxPoints.length * 100])),
            modeSource: modeSources.length ? modeSources.slice(0, 3).join("、") : null,
        };
    }, [boxStats, boxPoints, threshold, coherenceThreshold, datasetTitle, analysis.selectedRegion, activeFilter, points, rangeStart, rangeEnd]);
    const aiContextSignature = regionalAiInput ? JSON.stringify(regionalAiInput) : "no-region";
    useEffect(() => { setAiStatus("idle"); setAiResult(null); setAiError(""); setEvidenceOpen(false); }, [aiContextSignature]);
    useEffect(() => {
        if (!dataReady || (restoreRequested.current && !restoredContextKey.current)) return;
        const dates = points[0]?.dates || [], start = Math.min(rangeStart, Math.max(0, dates.length - 1)), end = Math.min(rangeEnd, Math.max(0, dates.length - 1));
        const descriptions = { none: "未启用", velocity: `速率 ≤ ${threshold} mm/yr`, coherence: `相干性 < ${coherenceThreshold.toFixed(2)}`, anomaly: "明显沉降 / 加速沉降 / 阶段形变，已排除低质量点", pascLowConfidence: "PASC 低置信度结果", pascLimitedSpatial: "PASC 空间适用性有限结果" } as const;
        updateAnalysis({ datasetId: privateDatasetId || "demo-haikou", datasetName: datasetTitle, timeRange: { startIndex: start, endIndex: end, startDate: dates[start] || "—", endDate: dates[end] || "—" }, filters: { active: activeFilter, velocityMax: activeFilter === "velocity" ? threshold : null, coherenceMin: activeFilter === "coherence" || activeFilter === "anomaly" ? coherenceThreshold : null, resultCount: filteredPointCount, description: descriptions[activeFilter] }, activeColorMode: attribute, selectedPointId: selected?.id || null, selectedRegionStats: contextRegionStats });
    }, [privateDatasetId, datasetTitle, points, rangeStart, rangeEnd, activeFilter, threshold, coherenceThreshold, filteredPointCount, attribute, selected?.id, contextRegionStats, updateAnalysis, dataReady]);
    const handleMapViewChange = useCallback((mapView: AnalysisMapView) => {
        if (restoreRequested.current && !restoredContextKey.current) return;
        updateAnalysis({ mapView });
    }, [updateAnalysis]);
    useEffect(() => { const stored = localStorage.getItem("lanjifyw-tianditu-key") || "", custom = localStorage.getItem("lanjifyw-custom-basemap") || ""; setTdtKey(stored); setKeyDraft(stored); setCustomBasemap(custom); setCustomDraft(custom); }, []);
    useEffect(() => { const params = new URLSearchParams(window.location.search); if (!params.get("dataset")) trackEvent("demo_start", { demo_id: "haikou-public", entry: params.get("demo") ? "explicit_demo" : "map_default" }); }, []);
    useEffect(() => { if (new URLSearchParams(window.location.search).get("intent") === "upload") {
        setGuideOpen(true);
        setStatus("上传自己的数据：请确认 CSV 字段要求，然后选择本地文件。");
    } }, []);
    const saveAnalysisMeta = async (id: string, nextMapping: CsvMapping, result: DatasetParseResult) => { await patchPrivateDataset(id, { mapping: nextMapping, qualityReport: result.quality, schemaStatus: "validated", processStatus: "validated" }).catch(() => null); };
    const applyResult = (result: DatasetParseResult, label: string, preserveAnalysis = false) => { pascRunId.current += 1; setPascOnlineRun(emptyPascOnlineRun); setPoints(result.points); setSelected(null); setDatasetTitle(result.datasetTitle); setTimeIndex(result.periods - 1); setRangeStart(0); setRangeEnd(result.periods - 1); setCompareIds([]); setCurveIds([]); setBoxPoints([]); setActiveFilter("none"); setRightTab("point"); if (!preserveAnalysis) updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null }); setParseReport(result); setDataReady(true); setStatus(`${label} · ${result.points.length.toLocaleString()} 点 · ${result.periods} 期 · 模式字段 ${result.modeField} · 过滤 ${result.invalid} 条`); trackEvent("dataset_loaded", { dataset_type: privateDatasetId ? "private" : label.includes("公开示例") ? "demo" : "local", point_count: result.points.length, period_count: result.periods, invalid_count: result.invalid }); };
    const loadShowcaseDemo = () => { setBusy("正在加载六类 Showcase Demo…"); fetch("/data/haikou-pasc-showcase.csv").then(response => { if (!response.ok) throw new Error("Showcase Demo 不可用"); return response.text(); }).then(text => { const found = inspectCsv(text), demoMapping: CsvMapping = { ...found.mapping, displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "toward_satellite_positive", preprocessingState: "already_smoothed" }, result = parseMappedCsv(text, "海口 PASC Showcase.csv", demoMapping, false); result.datasetTitle = "海口 PASC-TCN 248 期 Showcase Demo"; setPrivateDatasetId(""); applyResult(result, "海口 PASC Showcase Demo"); setStatus(`Showcase Demo · ${result.points.length.toLocaleString()} 点 · 248 期 · 每类 500 点；仅用于六类界面覆盖，不代表科学类别比例`); }).catch(error => setStatus(error instanceof Error ? error.message : "Showcase Demo 加载失败")).finally(() => setBusy("")); };
    useEffect(() => { const params = new URLSearchParams(window.location.search); restoreRequested.current = params.get("restore") === "analysis"; const previewJobId = params.get("job"); if (previewJobId) { jobPreviewLevel.current = ""; setJobPreviewId(previewJobId); setStatus("正在读取 Phase F 多级地图预览…"); return; } const privateId = params.get("dataset"); if (privateId) {
        setPrivateDatasetId(privateId);
        setBusy("正在读取账户私有数据…");
        listPrivateDatasets<{ items?: Array<{ id: string; name: string; chunks: number; analysisReady: boolean; mapping?: CsvMapping }> }>().then(async (list) => { const meta = (list.items || []).find(item => item.id === privateId); if (!meta)
            throw new Error("当前账户中不存在该数据集"); if (!meta.analysisReady)
            throw new Error("该数据集仅完成私有归档，文件过大，暂不支持浏览器直接分析。");
            const text = await readPrivateDatasetSource(privateId, meta.chunks), found = inspectCsv(text), saved = meta.mapping as CsvMapping | undefined, nextMapping = saved?.lon ? { ...found.mapping, ...saved } : found.mapping, result = parseMappedCsv(text, meta.name, nextMapping, true); setInspection(found); setMapping(nextMapping); applyResult(result, meta.name, restoreRequested.current); if (!saved?.lon)
            await saveAnalysisMeta(privateId, nextMapping, result);
            await runPascOnlineRecognition(result.points, meta.name, nextMapping.preprocessingState);
        }).catch(e => setStatus(e instanceof Error ? e.message : "私有数据读取失败")).finally(() => setBusy(""));
        return;
    } fetch("/data/haikou-insar.csv").then(r => { if (!r.ok)
        throw new Error(); return r.text(); }).then(text => { const found = inspectCsv(text), demoMapping: CsvMapping = { ...found.mapping, displacementUnit: "mm", velocityUnit: "mm/year", signConvention: "toward_satellite_positive", preprocessingState: "already_smoothed" }, result = parseMappedCsv(text, "海口示例数据.csv", demoMapping, false); result.datasetTitle = "海口 PASC-TCN 248 期 Spatial Demo"; applyResult(result, "海口 PASC Spatial Demo", restoreRequested.current); }).catch(() => setStatus("演示数据 · 可选择本地 CSV")); }, []);
    useEffect(() => {
        if (!jobPreviewId) return;
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
            setTimeIndex(0); setRangeStart(0); setRangeEnd(0); setCompareIds([]); setCurveIds([]); setBoxPoints([]); setActiveFilter("none"); setRightTab("pasc");
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
        const currentDatasetId = privateDatasetId || "demo-haikou";
        if (analysis.datasetId !== currentDatasetId) return;
        const restoredPoints = analysis.selectedRegion?.pointIds.map(id => points.find(point => point.id === id)).filter(Boolean) as InsarPoint[] | undefined;
        const maxIndex = Math.max(0, (points[0]?.series.length || 1) - 1), start = Math.min(analysis.timeRange.startIndex, maxIndex), end = Math.min(analysis.timeRange.endIndex, maxIndex);
        setRangeStart(Math.min(start, end)); setRangeEnd(Math.max(start, end)); setTimeIndex(Math.max(start, end)); setAttribute(analysis.activeColorMode);
        if (analysis.filters.velocityMax !== null) setThreshold(analysis.filters.velocityMax);
        if (analysis.filters.coherenceMin !== null) setCoherenceThreshold(analysis.filters.coherenceMin);
        setActiveFilter(analysis.filters.active);
        if (restoredPoints?.length) { setBoxPoints(restoredPoints); setSelectionMode(analysis.selectedRegion?.source === "rectangle" ? "box" : "single"); setRightTab("region"); }
        if (analysis.selectedPointId) { const point = points.find(item => item.id === analysis.selectedPointId); if (point) { setSelected(point); setRightTab("point"); } }
        restoredContextKey.current = `${analysis.datasetId}:${analysis.timeRange.startIndex}:${analysis.timeRange.endIndex}:${analysis.selectedRegion?.pointIds.length || 0}`;
        setStatus("已恢复地图范围、时间区间、筛选条件与分析对象");
    }, [analysis, dataReady, isAnalysisReady, points, privateDatasetId]);
    const inspectFile = async (file?: File) => { if (!file)
        return; trackEvent("dataset_upload_start", { source: "map_local", file_size_bytes: file.size }); if (file.size > 300 * 1024 * 1024) {
        trackEvent("dataset_upload_fail", { source: "map_local", reason: "browser_size_limit", file_size_bytes: file.size });
        setStatus("文件超过 300 MB：浏览器直接解析风险较高，请登录后采用分块私有存储或转换为 Parquet");
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
        void runPascOnlineRecognition(result.points, result.datasetTitle, mapping.preprocessingState);
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
    }
    else if (next === "displacement") {
        setStyleMin(-50);
        setStyleMax(50);
        setInterval(25);
    }
    else {
        setStyleMin(-30);
        setStyleMax(30);
        setInterval(15);
    } };
    const selectPoint = useCallback((point: InsarPoint) => { trackEvent("point_click", { selection_mode: selectionMode, deformation_mode: normalizedMode(point.mode), result_count: 1 }); setRightTab("point"); if (selectionMode === "compare" || selectionMode === "compareBox") {
        setCompareIds(ids => { const removing = ids.includes(point.id); if (removing) {
            setCurveIds(current => current.filter(id => id !== point.id));
            setSelected(current => current?.id === point.id ? null : current);
            return ids.filter(id => id !== point.id);
        } const next = [...ids, point.id].slice(-30); setCurveIds(current => [...current.filter(id => next.includes(id)), point.id].slice(-30)); setSelected(point); return next; });
    }
    else
        setSelected(point); }, [selectionMode]);
    const toggleCurve = (id: string) => setCurveIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
    const removeCompared = (id: string) => { setCompareIds(ids => ids.filter(item => item !== id)); setCurveIds(ids => ids.filter(item => item !== id)); setSelected(current => current?.id === id ? null : current); };
    const clearSelection = () => { setSelected(null); setCompareIds([]); setCurveIds([]); setBoxPoints([]); setActiveFilter("none"); updateAnalysis({ selectedPointId: null, selectedRegion: null, selectedRegionStats: null }); setStatus("已取消全部选择与地图高亮"); };
    const clearRegionSelection = () => { setBoxPoints([]); setActiveFilter("none"); updateAnalysis({ selectedRegion: null, selectedRegionStats: null }); setStatus("已清除区域选择与筛选结果"); };
    const handleBoxSelect = useCallback((chosen: InsarPoint[], bounds: [
        number,
        number,
        number,
        number
    ]) => { trackEvent("region_select", { selection_type: "rectangle", result_count: chosen.length }); setSelectionMode("box"); setRightTab("region"); setActiveFilter("none"); setSelected(null); setCompareIds([]); setCurveIds([]); setBoxPoints(chosen); updateAnalysis({ selectedPointId: null, selectedRegion: { bounds, pointIds: chosen.map(point => point.id), label: "自定义矩形区域", source: "rectangle" } }); setStatus(`矩形区域统计：已框选 ${chosen.length.toLocaleString()} 个点。矩形框选不进入多点曲线，避免大范围时序分析卡顿。`); }, [updateAnalysis]);
    const chooseBase = (value: string) => { setBase(value); if ((value.startsWith("tdt") && !tdtKey) || value === "custom")
        setSourceOpen(true); }, saveKey = () => { const value = keyDraft.trim(), custom = customDraft.trim(); localStorage.setItem("lanjifyw-tianditu-key", value); localStorage.setItem("lanjifyw-custom-basemap", custom); setTdtKey(value); setCustomBasemap(custom); setSourceOpen(false); if (value || custom)
        setStatus("图源配置已保存在当前浏览器"); };
    const startResize = (side: "left" | "right", event: ReactPointerEvent) => { event.preventDefault(); const startX = event.clientX, startWidth = side === "left" ? leftWidth : rightWidth, move = (e: PointerEvent) => { const delta = side === "left" ? e.clientX - startX : startX - e.clientX, next = Math.max(side === "left" ? 230 : 360, Math.min(side === "left" ? 480 : 620, startWidth + delta)); side === "left" ? setLeftWidth(next) : setRightWidth(next); }, stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); }; window.addEventListener("pointermove", move); window.addEventListener("pointerup", stop); };
    const trackNavPointer = (event: ReactPointerEvent<HTMLElement>) => { const target = (event.target as HTMLElement).closest<HTMLElement>(".topbar-tool,nav>a"); if (!target)
        return; const rect = target.getBoundingClientRect(); target.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`); target.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`); };
    useEffect(() => { const move = (event: PointerEvent) => { const target = (event.target as HTMLElement).closest<HTMLElement>(".spotlight-card,.selection-summary>div,.schema-grid article,.report-metrics article"); if (!target)
        return; target.classList.add("spotlight-card"); const rect = target.getBoundingClientRect(); target.style.setProperty("--pointer-x", `${((event.clientX - rect.left) / rect.width) * 100}%`); target.style.setProperty("--pointer-y", `${((event.clientY - rect.top) / rect.height) * 100}%`); }; window.addEventListener("pointermove", move); return () => window.removeEventListener("pointermove", move); }, []);
    const importRamp = async (file?: File) => { if (!file)
        return; const parsed = parseQgisRamp(await file.text()); if (parsed.length < 2) {
        setStatus("未从 QGIS QML/XML 中识别到至少两个颜色");
        return;
    } setColors(parsed); setStatus(`已导入 QGIS 色带 · ${parsed.length} 个颜色节点`); };
    const applyThreshold = () => { const chosen = points.filter(p => p.velocity <= threshold); trackEvent("filter_apply", { filter_type: "velocity", threshold, result_count: chosen.length }); trackEvent("region_select", { selection_type: "velocity_filter", result_count: chosen.length }); setSelectionMode("single"); setActiveFilter("velocity"); setBoxPoints(chosen); setRightTab("region"); setSelected(null); updateAnalysis({ selectedPointId: null, selectedRegion: { bounds: pointBounds(chosen), pointIds: chosen.map(point => point.id), label: `速率 ≤ ${threshold} mm/yr`, source: "filter" } }); setStatus(`阈值筛选：速率 ≤ ${threshold} mm/yr · ${chosen.length.toLocaleString()} 点`); };
    const setSafeCoherenceThreshold = (value: number) => setCoherenceThreshold(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));
    const applyCoherenceFilter = () => { const chosen = points.filter(p => p.coherence > 0 && p.coherence < coherenceThreshold); trackEvent("filter_apply", { filter_type: "coherence", threshold: coherenceThreshold, result_count: chosen.length }); trackEvent("region_select", { selection_type: "coherence_filter", result_count: chosen.length }); setSelectionMode("single"); setActiveFilter("coherence"); setAttribute("coherence"); setBoxPoints(chosen); setVisible(v => ({ ...v, quality: true })); setRightTab("region"); setSelected(null); updateAnalysis({ selectedPointId: null, selectedRegion: { bounds: pointBounds(chosen), pointIds: chosen.map(point => point.id), label: `低相干 < ${coherenceThreshold.toFixed(2)}`, source: "filter" } }); setStatus(`低相干筛选：相干性 < ${coherenceThreshold.toFixed(2)} · ${chosen.length.toLocaleString()} 点`); };
    const discoverAnomalies = () => {
        const chosen = anomalyDiscovery.points, bounds = pointBounds(chosen);
        trackEvent("filter_apply", { filter_type: "anomaly_discovery", result_count: chosen.length, excluded_low_quality: anomalyDiscovery.summary.excludedLowQuality });
        trackEvent("region_select", { selection_type: "anomaly_discovery", result_count: chosen.length });
        setSelectionMode("single"); setActiveFilter("anomaly"); setAttribute("velocity"); setBoxPoints(chosen); setSelected(null); setCompareIds([]); setCurveIds([]); setRightTab("region"); setLeftTab("filters"); setVisible(value => ({ ...value, points: true }));
        updateAnalysis({ selectedPointId: null, selectedRegion: chosen.length ? { bounds, pointIds: chosen.map(point => point.id), label: "异常点筛选结果", source: "anomaly" } : null });
        setStatus(chosen.length ? `发现 ${chosen.length.toLocaleString()} 个异常监测点；已排除 ${anomalyDiscovery.summary.excludedLowQuality.toLocaleString()} 个低质量点。` : "当前数据未筛选出符合既定规则的异常监测点。" );
    };
    const runPascOnlineRecognition = async (
        sourcePoints: InsarPoint[] = points,
        sourceTitle: string = datasetTitle,
        sourcePreprocessing: CsvMapping["preprocessingState"] = mapping?.preprocessingState,
    ) => {
        const runId = ++pascRunId.current;
        try {
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
    };
    const applyPascResultFilter = (filter: PascOnlineFilter) => {
        const chosen = filterPascOnlinePoints(points, filter);
        const active = filter === "lowConfidence" ? "pascLowConfidence" : "pascLimitedSpatial";
        const label = filter === "lowConfidence" ? "PASC 低置信度结果" : "PASC 空间适用性有限结果";
        setSelectionMode("single"); setActiveFilter(active); setAttribute("mode"); setBoxPoints(chosen); setSelected(null); setCompareIds([]); setCurveIds([]); setRightTab("region");
        updateAnalysis({ selectedPointId: null, selectedRegion: chosen.length ? { bounds: pointBounds(chosen), pointIds: chosen.map(point => point.id), label, source: "filter" } : null });
        setStatus(`${label} · ${chosen.length.toLocaleString()} 点 · 已使用 PASC 六类固定色`);
    };
    const runAiInterpretation = async () => {
        if (!regionalAiInput) { trackEvent("ai_analysis_fail", { reason: "missing_region_context" }); setAiStatus("error"); setAiError("请先在“区域分析”中框选区域，或运行“发现异常”建立分析对象。"); return; }
        trackEvent("ai_analysis_start", { point_count: regionalAiInput.pointCount, selection_source: regionalAiInput.selectionSource });
        setAiStatus("loading"); setAiError(""); setAiResult(null);
        try { const result = await interpretRegionalAnalysis(regionalAiInput); trackEvent("ai_analysis_success", { point_count: regionalAiInput.pointCount, engine: result.engineLabel }); setAiResult(result); setAiStatus("success"); }
        catch (error) { trackEvent("ai_analysis_fail", { reason: "interpretation_failed", point_count: regionalAiInput.pointCount }); setAiError(error instanceof Error ? error.message : "区域解读生成失败，请检查当前分析对象后重试。"); setAiStatus("error"); }
    };
    const showPrimaryModes = () => { setAttribute("mode"); setRightTab("region"); setStatus("已切换为形变模式着色，并保留当前区域分析结果"); };
    const downloadAiSummary = () => {
        if (!aiResult || !regionalAiInput) return;
        const lines = ["澜迹 InSAR · 区域分析摘要", "", `数据集：${regionalAiInput.datasetName}`, `分析范围：${regionalAiInput.regionLabel}`, `有效点数：${regionalAiInput.pointCount}`, `时间范围：${regionalAiInput.timeRange.startDate}—${regionalAiInput.timeRange.endDate}`, `筛选条件：${regionalAiInput.filterDescription}`, `模式来源：${regionalAiInput.modeSource || "未提供"}`, `解释引擎：${aiResult.engineLabel}`, "", "区域概况", aiResult.overview, "", "主要发现", ...aiResult.findings.map((item, index) => `${index + 1}. ${item}`), "", "值得关注", aiResult.attention, "", "建议下一步", aiResult.nextStep, "", "边界说明：本摘要仅解释程序统计结果，不构成安全判断、灾害预测或处置建议。"], blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" }), link = document.createElement("a");
        link.href = URL.createObjectURL(blob); link.download = `${datasetTitle.replace(/\s/g, "-")}-区域分析摘要.txt`; link.click(); URL.revokeObjectURL(link.href); trackEvent("analysis_export", { export_type: "ai_summary", point_count: regionalAiInput.pointCount });
    };
    const captureMap = async () => { const node = document.querySelector<HTMLElement>(".gis-map"); if (!node)
        return; setBusy("正在生成地图截图…"); try {
        const html2canvas = (await import("html2canvas")).default, canvas = await html2canvas(node, { useCORS: true, backgroundColor: "#eef3f7", scale: 2 }), a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = `${datasetTitle.replace(/\s/g, "-")}-${currentDate}.png`;
        a.click();
        trackEvent("analysis_export", { export_type: "map_png", point_count: filteredPointCount });
    }
    catch {
        setStatus("底图跨域限制导致截图失败，可切换 Esri Light Gray 后重试");
    }
    finally {
        setBusy("");
    } };
    const exportPoint = () => { if (!selected)
        return; const dates = selected.dates?.length ? selected.dates : demoDates.slice(0, selected.series.length), rows: (string | number)[][] = [["point_id", "longitude", "latitude", "velocity", "coherence", "missing_rate", "mode", "mode_source", "mode_confidence"], [selected.id, selected.lon, selected.lat, selected.velocity, selected.coherence, selected.missingRate, selected.mode, selected.modeSource || "", selected.modeConfidence ?? ""], ["date", "displacement"], ...dates.map((d, i) => [d, selected.series[i]])], blob = new Blob(["\uFEFF" + rows.map(r => r.join(",")).join("\n")], { type: "text/csv;charset=utf-8" }), a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${selected.id}-timeseries.csv`; a.click(); URL.revokeObjectURL(a.href); trackEvent("analysis_export", { export_type: "point_csv", period_count: selected.series.length }); };
    const printAnalysis = () => { trackEvent("analysis_export", { export_type: "print_report", point_count: filteredPointCount }); window.print(); };
    const shellStyle = { "--left-panel": leftCollapsed ? "0px" : `${leftWidth}px`, "--right-panel": rightCollapsed ? "0px" : `${rightWidth}px` } as CSSProperties, currentValue = selected ? (selected.series[Math.min(timeIndex, selected.series.length - 1)] ?? selected.displacement) : 0;
    const selectedInsight = selected ? buildPointInsight(selected, coherenceThreshold) : null;
    return (
        <main className="map-page phase-two-workspace">
            <header className="map-topbar phase-two-topbar">
                <Link className="site-brand" href="/">
                    <img src="/insar-satellite-v2.png" alt="" />
                    <span><b>LANJIFYW</b><small>INSAR WEBGIS</small></span>
                </Link>
                <section className="analysis-status-strip" aria-label="当前分析上下文">
                    <article className="dataset-status-cell"><small>当前数据集</small><b title={datasetTitle}>{datasetTitle}</b><span title={busy || status}>{busy || status}</span></article>
                    <article><small>时间范围</small><b>{analysis.timeRange.startDate}—{analysis.timeRange.endDate}</b></article>
                    <article><small>当前点数</small><b>{filteredPointCount.toLocaleString()}</b></article>
                </section>
                <button className={"phase-four-discover " + (activeFilter === "anomaly" ? "active" : "")} onClick={discoverAnomalies}>
                    <span>DISCOVERY</span><b>发现异常</b><small>一次筛选重点监测点</small>
                </button>
                <div className="analysis-color-toggle" role="group" aria-label="地图主着色方式">
                    <small>主着色</small>
                    <button className={attribute === "displacement" ? "active" : ""} onClick={() => setAttribute("displacement")}>形变量</button>
                    <button className={attribute === "mode" ? "active" : ""} onClick={() => setAttribute("mode")}>形变模式</button>
                </div>
                <nav className="phase-two-actions" onPointerMove={trackNavPointer}>
                    <Link className="topbar-tool" href="/statistics">区域统计</Link>
                    <button className="topbar-tool" onClick={captureMap}>地图截图</button>
                    <button className="topbar-tool" onClick={printAnalysis}>导出报告</button>
                    <Link href="/">返回首页</Link>
                    <button className="button primary small" onClick={() => fileRef.current?.click()}>导入 CSV</button>
                    <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={e => inspectFile(e.target.files?.[0])} />
                </nav>
            </header>

            <section className="gis-shell phase-two-shell" style={shellStyle}>
                <aside className={"gis-left phase-two-left " + (leftCollapsed ? "is-collapsed" : "")}>
                    <div className="panel-head"><span>分析控制</span><b>WORKSPACE</b></div>
                    <div className="workspace-tabs left-workspace-tabs" role="tablist" aria-label="左侧工作区">
                        <button role="tab" aria-selected={leftTab === "data"} className={leftTab === "data" ? "active" : ""} onClick={() => setLeftTab("data")}>数据</button>
                        <button role="tab" aria-selected={leftTab === "layers"} className={leftTab === "layers" ? "active" : ""} onClick={() => setLeftTab("layers")}>图层</button>
                        <button role="tab" aria-selected={leftTab === "filters"} className={leftTab === "filters" ? "active" : ""} onClick={() => setLeftTab("filters")}>筛选</button>
                    </div>

                    {leftTab === "data" && (
                        <div className="workspace-tab-panel data-tab-panel" role="tabpanel">
                            <div className="dataset-card">
                                <small>LOCAL / PRIVATE DATA</small>
                                <b>{datasetTitle}</b>
                                <span>{points.length.toLocaleString()} 个有效点 · 当前 {currentDate}</span>
                                <button onClick={() => fileRef.current?.click()}>＋ 字段映射导入 CSV</button>
                                <button onClick={() => setGuideOpen(true)}>查看 CSV 数据规范</button>
                                <button onClick={loadShowcaseDemo}>加载六类 Showcase Demo</button>
                                {parseReport && <button onClick={() => setReportOpen(true)}>查看导入与质量报告</button>}
                            </div>
                            <div className="context-note">
                                <small>ANALYSIS CONTEXT</small>
                                <b>数据状态已同步</b>
                                <span>数据集、时间范围、筛选条件与地图视图会在当前浏览器会话中保持一致。</span>
                            </div>
                        </div>
                    )}

                    {leftTab === "layers" && (
                        <div className="workspace-tab-panel" role="tabpanel">
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
                                {[["points", "InSAR 监测点", points.length], ["risk", "重点形变点", riskCount], ["quality", "低相干 / 高缺测", qualityCount], ["boundary", "数据外包范围", 0]].map(([k, n, c]) => (
                                    <label key={String(k)}>
                                        <input type="checkbox" checked={visible[k as keyof typeof visible]} onChange={e => setVisible(v => ({ ...v, [k]: e.target.checked }))} />
                                        <i className={"layer-dot " + k} /><span>{n}</span>
                                        {Number(c) > 0 && <b>{Number(c).toLocaleString()}</b>}
                                    </label>
                                ))}
                            </div>
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

                    {leftTab === "filters" && (
                        <div className="workspace-tab-panel" role="tabpanel">
                            <section className={"anomaly-discovery-card " + (activeFilter === "anomaly" ? "active" : "")}>
                                <small>GUIDED DISCOVERY</small>
                                <h3>先看值得关注的点</h3>
                                <p>一次筛选明显沉降、加速沉降和阶段形变点，并排除低相干或高缺测观测。</p>
                                <button onClick={discoverAnomalies}>{activeFilter === "anomaly" ? "重新发现异常" : "发现异常"} ↗</button>
                                <span>规则透明：速率 ≤ −3 mm/yr，或模式字段为加速沉降 / 阶段形变。</span>
                            </section>
                            <div className="renderer-panel">
                                <small>符号化属性</small>
                                <select value={attribute} onChange={e => setAttribute(e.target.value as RenderAttribute)}>
                                    {Object.entries(attributeNames).map(([k, n]) => <option value={k} key={k}>{n}</option>)}
                                </select>
                                {attribute !== "mode" && (
                                    <div className="renderer-inputs">
                                        <label>最小值<input type="number" value={styleMin} step="any" onChange={e => setStyleMin(+e.target.value)} /></label>
                                        <label>最大值<input type="number" value={styleMax} step="any" onChange={e => setStyleMax(+e.target.value)} /></label>
                                        <label>间距<input type="number" value={interval} step="any" min="0" onChange={e => setInterval(+e.target.value)} /></label>
                                    </div>
                                )}
                                <div className="ramp-preview" style={{ background: "linear-gradient(90deg," + colors.join(",") + ")" }} />
                                <button onClick={() => qgisRef.current?.click()}>导入 QGIS 色带（QML / XML）</button>
                                <input ref={qgisRef} hidden type="file" accept=".qml,.xml,.txt" onChange={e => importRamp(e.target.files?.[0])} />
                            </div>
                            <div className="renderer-panel time-analysis">
                                <small>时间区间 · 阶段速率</small>
                                <label>起始期<select value={rangeStart} onChange={e => setRangeStart(+e.target.value)}>{points[0]?.dates?.map((d, i) => <option value={i} key={d}>{d}</option>)}</select></label>
                                <label>结束期<select value={rangeEnd} onChange={e => setRangeEnd(+e.target.value)}>{points[0]?.dates?.map((d, i) => <option value={i} key={d}>{d}</option>)}</select></label>
                                <button onClick={() => setAttribute("stageVelocity")}>计算并按阶段速率显示</button>
                            </div>
                            <div className="renderer-panel threshold-analysis">
                                <small>阈值筛选 · 预警辅助</small>
                                <label>沉降阈值<input type="number" value={threshold} step="1" onChange={e => setThreshold(+e.target.value)} /></label>
                                <button onClick={applyThreshold}>筛选速率 ≤ {threshold} mm/yr</button>
                                <label>低相干阈值<input type="number" min="0" max="1" step="0.01" value={coherenceThreshold} onChange={e => setSafeCoherenceThreshold(+e.target.value)} /></label>
                                <button onClick={applyCoherenceFilter}>过滤相干性 &lt; {coherenceThreshold.toFixed(2)}</button>
                                <span>相干性取值为 0—1，筛选结果会同步进入右侧区域分析。</span>
                            </div>
                            {activeFilter !== "none" && <button className="clear-filter-button" onClick={clearRegionSelection}>清除当前筛选</button>}
                        </div>
                    )}
                </aside>

                <div className="panel-resizer left" onPointerDown={e => startResize("left", e)} role="separator">
                    <button onPointerDown={e => e.stopPropagation()} onClick={() => setLeftCollapsed(v => !v)}>{leftCollapsed ? "›" : "‹"}</button>
                </div>

                <MapCanvas
                    points={points}
                    selected={selected}
                    onSelect={selectPoint}
                    onBoxSelect={handleBoxSelect}
                    onViewChange={handleMapViewChange}
                    visible={visible}
                    base={base}
                    tdtKey={tdtKey}
                    customBasemap={customBasemap}
                    baseOpacity={baseOpacity}
                    coherenceThreshold={coherenceThreshold}
                    layoutToken={leftWidth + "-" + rightWidth + "-" + leftCollapsed + "-" + rightCollapsed}
                    renderStyle={renderStyle}
                    compareIds={compareIds}
                    boxIds={boxIds}
                    selectionMode={selectionMode}
                    highlightKind={activeFilter === "anomaly" ? "anomaly" : activeFilter === "none" ? "region" : "filter"}
                    showSelectionRectangle={analysis.selectedRegion?.source === "rectangle"}
                    selectionBounds={analysis.selectedRegion?.bounds || null}
                    initialView={restoreRequested.current ? analysis.mapView : null}
                />

                <div className="panel-resizer right" onPointerDown={e => startResize("right", e)} role="separator">
                    <button onPointerDown={e => e.stopPropagation()} onClick={() => setRightCollapsed(v => !v)}>{rightCollapsed ? "‹" : "›"}</button>
                </div>

                <aside className={"gis-detail phase-two-detail " + (rightCollapsed ? "is-collapsed" : "")}>
                    <div className="panel-head"><span>分析结果</span><b>{rightTab.toUpperCase()}</b></div>
                    <div className="workspace-tabs right-workspace-tabs" role="tablist" aria-label="右侧分析工作区">
                        <button role="tab" aria-selected={rightTab === "point"} className={rightTab === "point" ? "active" : ""} onClick={() => setRightTab("point")}>点位分析</button>
                        <button role="tab" aria-selected={rightTab === "region"} className={rightTab === "region" ? "active" : ""} onClick={() => setRightTab("region")}>区域分析</button>
                        <button role="tab" aria-selected={rightTab === "ai"} className={rightTab === "ai" ? "active" : ""} onClick={() => setRightTab("ai")}>AI 解读</button>
                        <button role="tab" aria-selected={rightTab === "pasc"} className={rightTab === "pasc" ? "active" : ""} onClick={() => setRightTab("pasc")}>PASC</button>
                    </div>

                    {rightTab === "point" && (
                        <div className="workspace-tab-panel point-analysis-tab" role="tabpanel">
                            <div className="analysis-mode-tools">
                                <span>选点方式</span>
                                <div>
                                    <button className={selectionMode === "single" ? "active" : ""} onClick={() => setSelectionMode("single")}>单点</button>
                                    <button className={selectionMode === "compare" ? "active" : ""} onClick={() => setSelectionMode("compare")}>多点对比</button>
                                    <button disabled={!selected && !compareIds.length} onClick={clearSelection}>取消选择</button>
                                </div>
                            </div>

                            {compared.length > 0 && (
                                <section className="compare-panel">
                                    <div className="chart-head"><div><small>MULTI-POINT · {compared.length}/30</small><h3>多点时间序列对比</h3></div><span>已显示 {curves.length} 条</span></div>
                                    <div className="curve-list-head"><span>勾选需要显示的曲线</span><div><button onClick={() => setCurveIds(compareIds)}>全选</button><button onClick={() => setCurveIds([])}>全不选</button></div></div>
                                    <div className="curve-checklist">
                                        {compared.map((p, j) => (
                                            <div className={"curve-row " + (selected?.id === p.id ? "is-focused" : "")} key={p.id}>
                                                <label><input type="checkbox" checked={curveIds.includes(p.id)} onChange={() => toggleCurve(p.id)} /><i style={{ background: "hsl(" + ((j * 47) % 360) + " 88% 52%)" }} /><span>{p.id}</span><small>{normalizedMode(p.mode)} · {p.velocity.toFixed(2)} mm/yr</small></label>
                                                <button onClick={() => setSelected(p)}>详情</button>
                                                <button className="curve-remove" aria-label={"移除点位 " + p.id} onClick={() => removeCompared(p.id)}>×</button>
                                            </div>
                                        ))}
                                    </div>
                                    {compareStats && (
                                        <div className="compare-summary">
                                            <article><span>平均速率</span><b>{compareStats.avgVelocity.toFixed(2)}</b><small>mm/yr</small></article>
                                            <article><span>平均当前形变</span><b>{compareStats.avgCurrent.toFixed(2)}</b><small>mm</small></article>
                                            <article><span>平均相干性</span><b>{compareStats.avgCoherence ? compareStats.avgCoherence.toFixed(2) : "—"}</b><small>0—1</small></article>
                                        </div>
                                    )}
                                    {curves.length ? <CompareChart points={curves} /> : <div className="empty-curves">请在上方勾选要显示的时序曲线</div>}
                                </section>
                            )}

                            {selected && selectedInsight ? (
                                <>
                                    <div className="point-title phase-three-point-title">
                                        <span className="point-section-label">POINT INTELLIGENCE</span>
                                        <span className={selectedInsight.status === "质量需关注" ? "status-pill danger" : "status-pill"}>{selectedInsight.status}</span>
                                        <h2>{selected.id}</h2>
                                        <p>{selected.lon.toFixed(6)}° E · {selected.lat.toFixed(6)}° N</p>
                                    </div>
                                    <section className="point-mode-result" aria-label="点位模式结果">
                                        <article><span>形变模式</span><b>{selectedInsight.modeLabel}</b></article>
                                        <article><span>模式来源</span><b>{selectedInsight.modeSource}</b></article>
                                        <article><span>模式置信度</span><b>{selectedInsight.confidenceLabel}</b><small>仅显示 CSV / 模型真实提供值</small></article>
                                    </section>
                                    <div className="point-metrics phase-three-metrics">
                                        <article><span>{currentDate} 累计形变</span><b>{currentValue.toFixed(2)}</b><small>mm</small></article>
                                        <article><span>长期速率</span><b>{selected.velocity.toFixed(2)}</b><small>mm / yr</small></article>
                                        <article><span>近一年速率</span><b>{selectedInsight.recentVelocity === null ? "—" : selectedInsight.recentVelocity.toFixed(2)}</b><small>{selectedInsight.recentStartDate}—{selected.updated}</small></article>
                                        <article className="quality-metric"><span>相干性 / 缺测率</span><b>{selected.coherence ? selected.coherence.toFixed(2) : "未提供"}</b><small>{(selected.missingRate * 100).toFixed(1)}% 缺测</small></article>
                                    </div>
                                    <div className="chart-head"><div><small>TIME SERIES · {selected.series.length} 期</small><h3>累计形变时间序列</h3></div><span>mm</span></div>
                                    <TimeSeriesChart key={selected.id} point={selected} showTrend={showTrend} timeIndex={timeIndex} />
                                    <div className="chart-toggles"><label><input type="checkbox" checked={showTrend} onChange={e => setShowTrend(e.target.checked)} />线性拟合趋势</label><span>阶段速率 {stageVelocity(selected, rangeStart, rangeEnd).toFixed(2)} mm/yr</span></div>
                                    <section className="point-explanation">
                                        <span>PROGRAMMATIC INTERPRETATION</span>
                                        <h3>点位解释</h3>
                                        {selectedInsight.explanation.map(sentence => <p key={sentence}>{sentence}</p>)}
                                        <small>解释仅基于当前点位数值、质量指标和已有模式字段，不构成工程安全判断或灾害预警。</small>
                                    </section>
                                    <dl className="point-fields"><div><dt>点位编号</dt><dd>{selected.id}</dd></div><div><dt>当前渲染</dt><dd>{attributeNames[attribute]}</dd></div><div><dt>最近观测</dt><dd>{selected.updated}</dd></div><div><dt>有效期数</dt><dd>{selected.series.length} 期</dd></div></dl>
                                    <button className="button primary export-button" onClick={exportPoint}>导出单点 CSV ↓</button>
                                </>
                            ) : !compared.length && (
                                <section className="point-empty"><b>尚未选择监测点</b><span>选择“单点”查看完整时序，或选择“多点对比”建立最多 30 条曲线。</span></section>
                            )}
                        </div>
                    )}

                    {rightTab === "region" && (
                        <div className="workspace-tab-panel region-analysis-tab" role="tabpanel">
                            <div className="analysis-mode-tools">
                                <span>区域工具</span>
                                <div>
                                    <button className={selectionMode === "box" ? "active" : ""} onClick={() => setSelectionMode("box")}>矩形框选</button>
                                    <button disabled={!boxPoints.length} onClick={clearRegionSelection}>清除区域</button>
                                </div>
                            </div>
                            {boxStats ? (
                                <section className={"selection-summary phase-four-region-summary " + (activeFilter === "anomaly" ? "is-anomaly" : "")}>
                                    <header>
                                        <small>{activeFilter === "anomaly" ? "ANOMALY DISCOVERY" : "REGION ANALYSIS"}</small>
                                        <h3>{analysis.selectedRegion?.label || (activeFilter === "none" ? "自定义分析区域" : "当前筛选结果")}</h3>
                                        <p>{analysis.timeRange.startDate}—{analysis.timeRange.endDate} · 当前期 {currentDate}</p>
                                    </header>
                                    {activeFilter === "anomaly" && <div className="anomaly-result-banner"><b>发现 {anomalyDiscovery.summary.total.toLocaleString()} 个异常监测点</b><span>结果是点位筛选，不代表已识别空间聚集区。</span></div>}
                                    <div><span>{activeFilter === "none" ? "区域点数" : "筛选点数"}</span><b>{boxPoints.length.toLocaleString()}</b><small>个有效监测点</small></div>
                                    <div><span>平均速率</span><b>{boxStats.avg.toFixed(2)}</b><small>mm/yr</small></div>
                                    <div><span>平均当前形变</span><b>{boxStats.averageCurrent.toFixed(2)}</b><small>mm</small></div>
                                    <div><span>最大累计量</span><b>{boxStats.max.toFixed(2)}</b><small>mm · 绝对值</small></div>
                                    <div><span>速率范围</span><b>{boxStats.minVelocity.toFixed(1)}—{boxStats.maxVelocity.toFixed(1)}</b><small>mm/yr</small></div>
                                    <div><span>平均相干性</span><b>{boxStats.averageCoherence === null ? "未提供" : boxStats.averageCoherence.toFixed(2)}</b><small>{boxStats.quality} 个质量关注点</small></div>
                                    {activeFilter === "anomaly" && <div className="anomaly-rule-stats"><span>筛选依据</span><small>明显沉降 · {anomalyDiscovery.summary.clearSubsidence.toLocaleString()}</small><small>加速沉降模式 · {anomalyDiscovery.summary.accelerating.toLocaleString()}</small><small>阶段形变模式 · {anomalyDiscovery.summary.pattern.toLocaleString()}</small><small>排除低质量 · {anomalyDiscovery.summary.excludedLowQuality.toLocaleString()}</small></div>}
                                    <div className="mode-breakdown"><span>形变模式统计</span>{deformationModeOrder.filter(mode => boxStats.modes[mode]).map(mode => <small key={mode} style={{ borderLeft: "4px solid " + colorForMode(mode) }}>{mode} · {boxStats.modes[mode].toLocaleString()} 点 · {((boxStats.modes[mode] / boxPoints.length) * 100).toFixed(0)}%</small>)}</div>
                                    <div className="region-summary-actions"><Link href="/statistics">进入区域统计</Link><button onClick={clearRegionSelection}>清除区域与结果</button></div>
                                </section>
                            ) : (
                                <section className="region-empty"><b>{activeFilter === "anomaly" ? "暂无可靠异常筛选结果" : "尚未建立分析区域"}</b><span>{activeFilter === "anomaly" ? "当前数据没有通过质量规则且符合异常筛选条件的监测点。" : "点击“矩形框选”后在地图拖动，统计结果会保留在右侧；阈值筛选结果也会汇总到这里。"}</span></section>
                            )}
                        </div>
                    )}

                    {rightTab === "pasc" && (
                        <div className="workspace-tab-panel pasc-workspace-tab" role="tabpanel">
                            <PascOnlineRecognition
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
                            />
                            <PascCompatibilityCheck summary={parseReport?.compatibility ?? null} />
                            <PascAnalysisPanel point={selected} />
                            <PascRegionStats points={boxPoints.length ? boxPoints : points} />
                            <PascPatternLegend />
                        </div>
                    )}

                    {rightTab === "ai" && (
                        <div className="workspace-tab-panel ai-analysis-tab" role="tabpanel">
                            <section className="ai-context-panel phase-five-ai-panel">
                                <header className="ai-panel-heading"><div><small>CONTEXT-BOUND INTERPRETATION</small><h3>AI 区域解读</h3></div><span>本地演示引擎</span></header>
                                <p>系统仅向解释器提供当前区域的结构化统计摘要，不传输成千上万个原始监测点。数值和空间关系仍由程序与 GIS 计算。</p>
                                <div className="ai-input-summary">
                                    <div><span>分析对象</span><b>{regionalAiInput?.regionLabel || "尚未建立区域"}</b></div>
                                    <div><span>有效点数</span><b>{regionalAiInput?.pointCount.toLocaleString() || "—"}</b></div>
                                    <div><span>时间范围</span><b>{regionalAiInput ? `${regionalAiInput.timeRange.startDate}—${regionalAiInput.timeRange.endDate}` : "—"}</b></div>
                                    <div><span>输入规模</span><b>{regionalAiInput ? `${Object.keys(regionalAiInput.patternDistribution).length} 类模式摘要` : "—"}</b></div>
                                </div>

                                {aiStatus === "idle" && <div className="ai-idle-state"><span>READY FOR INTERPRETATION</span><b>{regionalAiInput ? "结构化区域结果已准备" : "请先建立区域分析对象"}</b><p>{regionalAiInput ? "点击后按固定结构生成区域概况、主要发现、值得关注和建议下一步。" : "可前往区域分析使用矩形框选，或者运行一次异常发现。"}</p><button onClick={runAiInterpretation}>开始区域解读 ↗</button></div>}
                                {aiStatus === "loading" && <div className="ai-loading-state" role="status"><i/><b>正在解释结构化区域结果</b><span>正在组织区域概况、主要发现与分析依据…</span></div>}
                                {aiStatus === "error" && <div className="ai-error-state" role="alert"><span>AI ANALYSIS ERROR</span><b>暂时无法生成解读</b><p>{aiError}</p><div><button onClick={() => setRightTab("region")}>返回区域分析</button><button onClick={runAiInterpretation}>重新尝试</button></div></div>}
                                {aiStatus === "success" && aiResult && regionalAiInput && <div className="ai-result-card">
                                    <div className="ai-result-meta"><span>已生成 · {new Date(aiResult.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span><b>{aiResult.engineLabel}</b></div>
                                    <article><span>区域概况</span><p>{aiResult.overview}</p></article>
                                    <article><span>主要发现</span><ol>{aiResult.findings.map(finding => <li key={finding}>{finding}</li>)}</ol></article>
                                    <article><span>值得关注</span><p>{aiResult.attention}</p></article>
                                    <article><span>建议下一步</span><p>{aiResult.nextStep}</p></article>
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
                            </section>
                        </div>
                    )}
                </aside>
            </section>

            <footer className="timeline-bar phase-two-timeline">
                <span>{points[0]?.dates?.[0] || "起始"}</span>
                <input type="range" min="0" max={Math.max(0, periodCount - 1)} value={Math.min(timeIndex, periodCount - 1)} onChange={e => { setTimeIndex(+e.target.value); if (attribute !== "displacement") setAttribute("displacement"); }} aria-label="观测日期与累计形变渲染时间轴" />
                <b>{currentDate}</b><small>{timeIndex + 1} / {periodCount} 期</small>
            </footer>

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
                        <p>确认系统识别结果。带 * 的字段必须指定；日期列按列名自动识别。</p>
                        <div className="mapping-grid">{fieldLabels.map(field => <label key={field.key}><span>{field.label}{field.required ? " *" : ""}</span><select value={mapping[field.key]} onChange={e => setMapping({ ...mapping, [field.key]: e.target.value })}><option value="">— 不使用 —</option>{inspection.headers.map(h => <option value={h} key={h}>{h}</option>)}</select></label>)}</div>
                        <div className="pasc-mapping-confirmations">
                            <label><span>形变单位 *</span><select value={mapping.displacementUnit ?? "unknown"} onChange={e => setMapping({ ...mapping, displacementUnit: e.target.value as CsvMapping["displacementUnit"] })}><option value="unknown">待确认</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
                            <label><span>速率单位</span><select value={mapping.velocityUnit ?? "unknown"} onChange={e => setMapping({ ...mapping, velocityUnit: e.target.value as CsvMapping["velocityUnit"] })}><option value="unknown">待确认 / 未提供</option><option value="mm/year">mm/year</option><option value="cm/year">cm/year</option><option value="m/year">m/year</option></select></label>
                            <label><span>形变正负号 *</span><select value={mapping.signConvention ?? "unknown"} onChange={e => setMapping({ ...mapping, signConvention: e.target.value as CsvMapping["signConvention"] })}><option value="unknown">待确认</option><option value="toward_satellite_positive">朝卫星为正</option><option value="away_from_satellite_positive">远离卫星为正</option></select></label>
                            <label><span>预处理状态 *</span><select value={mapping.preprocessingState ?? "unknown"} onChange={e => setMapping({ ...mapping, preprocessingState: e.target.value as CsvMapping["preprocessingState"] })}><option value="unknown">待确认</option><option value="raw">raw</option><option value="already_smoothed">already_smoothed</option></select></label>
                        </div>
                        <div className="mapping-dates"><b>累计形变日期列</b><span>已识别 {mapping.timeCols.length} 列</span><small>{mapping.timeCols.slice(0, 6).join("、")}{mapping.timeCols.length > 6 ? " …" : ""}</small></div>
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
                        <button className="dialog-close" onClick={() => setGuideOpen(false)}>×</button><span className="eyebrow">CSV SCHEMA</span><h2>CSV 数据规范</h2>
                        <div className="schema-grid"><article><b>能力字段</b><p>经纬度必需；velocity 可缺失，有至少 2 个真实日期值时按最小二乘计算。40 期仅为实验门槛。</p></article><article><b>PASC 六分类</b><p>固定 Stable、Linear、Piecewise、Decelerating、Accelerating、Undefined；Stepwise 只标 legacy。</p></article><article><b>确认项</b><p>单位、符号和 raw / already_smoothed 必须明确确认，禁止按数值猜测。</p></article><article><b>本阶段边界</b><p>Phase A 只做兼容性与离线结果展示，不执行 Adapter、SG 或在线推理。</p></article></div>
                        <div className="csv-example"><code>point_id,longitude,latitude,velocity,label,mode_source,confidence,coherence,D20200101,D20200113</code></div>
                        <div className="dialog-actions"><button className="button ghost" onClick={() => setGuideOpen(false)}>继续体验示例</button><button className="button primary" onClick={() => { setGuideOpen(false); fileRef.current?.click(); }}>选择本地 CSV</button></div>
                    </section>
                </div>
            )}
        </main>
    );
}
