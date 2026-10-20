"use client";

import { useEffect, useRef, useState } from "react";
import { AccountRequired } from "./AccountRequired";
import { requireAccountSession } from "../lib/account-session";

import { discardLocalTemporaryResults, localTemporaryStorageBytes } from "../lib/local-analysis-cleanup";
import { createLocalAnalysisSession, type LocalAnalysisSession } from "../lib/local-analysis-session";
import { mergeLocalImportFieldMapping } from "../lib/workspace-local-import";
import { downloadText, safeExportName } from "../lib/analysis-exports";
import { exportOriginalWithPascFields } from "../lib/pasc-local-export";
import { adaptLocalPredictionToMapData, localPredictionCsv, type PascLocalMapDataset } from "../lib/pasc-local-map-adapter";
import { assertLocalFileSize, friendlyLocalAnalysisError, isStreamingLocalFile, localBrowserCapabilities, localDatasetWarning, requiresLocalCsvSplit, PASC_LOCAL_QUICK_POINTS, PASC_LOCAL_RECOMMENDED_POINTS, PASC_LOCAL_SPLIT_PART_ROWS } from "../lib/pasc-local-limits";
import { discardLocalCsvSplit, readLocalCsvSplitPart, splitLocalCsv, type LocalCsvSplit } from "../lib/pasc-local-csv-split";
import { prepareLargeLocalStorage, saveOpfsResult } from "../lib/pasc-local-opfs";
import { inspectLocalCsv, resolveLocalCsvFields, type PascLocalCsvInspection, type PascLocalField, type PascLocalFieldMapping, type PascLocalSettings } from "../lib/pasc-local-preprocess";
import {
  PASC_LOCAL_WORKER_URL,
  type PascLocalCompletePayload,
  type PascLocalTaskState,
  type PascLocalWorkerRequest,
  type PascLocalWorkerResponse,
} from "../lib/pasc-local-worker-protocol";

type PascLocalWebGisProps = {
  file: File | null;
  onChooseFile: () => void;
  onApplied: (dataset: PascLocalMapDataset, session?: LocalAnalysisSession) => void;
  onFilter: (filter: "lowConfidence" | "limitedReference") => void;
  onDiscard?: () => void;
  initialSettings?: Partial<PascLocalSettings>;
};

const defaultSettings: PascLocalSettings = {
  displacementUnit: "mm",
  velocityUnit: "mm/year",
  signConvention: "subsidence_negative",
  preprocessingState: "raw",
};

const labels: Record<PascLocalTaskState, string> = {
  idle: "等待本地 CSV",
  loading_file: "正在读取文件",
  parsing: "正在流式解析",
  streaming: "正在分块分析",
  preprocessing: "正在预处理",
  loading_model: "正在加载 ONNX",
  predicting: "正在本地分类",
  finalizing: "正在适配 WebGIS",
  ready: "结果已接入地图",
  error: "本地分析失败",
  cancelled: "任务已取消",
};

export function PascLocalWebGis(props: PascLocalWebGisProps) {
  return <AccountRequired><PascLocalWebGisContent {...props} /></AccountRequired>;
}
function PascLocalWebGisContent({ file: sourceFile, onChooseFile, onApplied, onFilter, onDiscard, initialSettings }: PascLocalWebGisProps) {
  const [localSplit, setLocalSplit] = useState<LocalCsvSplit | null>(null);
  const [selectedPart, setSelectedPart] = useState<{ index: number; file: File } | null>(null);
  const [partIndex, setPartIndex] = useState(1);
  const [partRows, setPartRows] = useState(PASC_LOCAL_SPLIT_PART_ROWS);
  const [splitting, setSplitting] = useState(false);
  const splitAbortRef = useRef<AbortController | null>(null);
  const file = selectedPart?.file ?? sourceFile;
  const [settings, setSettings] = useState<PascLocalSettings>(() => ({ ...defaultSettings, ...initialSettings }));
  const [settingsConfirmed, setSettingsConfirmed] = useState(!initialSettings);
  const [batchSize, setBatchSize] = useState<256 | 512 | 1024>(256);
  const [analysisScope, setAnalysisScope] = useState<"quick" | "full">("full");
  const [state, setState] = useState<PascLocalTaskState>("idle");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("数据默认在浏览器本地处理，原始 CSV 不会上传服务器。");
  const [inspection, setInspection] = useState<PascLocalCsvInspection | null>(null);
  const [fieldError, setFieldError] = useState("");
  const [result, setResult] = useState<PascLocalCompletePayload | null>(null);
  const [exporting, setExporting] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const activeRunRef = useRef(0);
  const authorizationPending = useRef(false);
  const preparingRef = useRef(false);
  const resultSessionRef = useRef<LocalAnalysisSession | null>(null);
  const resultSettingsRef = useRef<PascLocalSettings | null>(null);
  const resultFieldMappingRef = useRef<PascLocalFieldMapping>({});
  const busy = splitting || !["idle", "ready", "error", "cancelled"].includes(state);
  const largeSourceFile = Boolean(file && isStreamingLocalFile(file.size));
  const largeFileMode = largeSourceFile && analysisScope === "full";

  useEffect(() => () => { activeRunRef.current += 1; preparingRef.current = false; splitAbortRef.current?.abort(); workerRef.current?.terminate(); }, []);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setSelectedPart(null); setLocalSplit(null); setSplitting(false); setPartIndex(1); } });
    return () => { active = false; splitAbortRef.current?.abort(); };
  }, [sourceFile]);
  useEffect(() => {
    if (!busy) return;
    const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [busy]);

  useEffect(() => {
    let cancelled = false;
    activeRunRef.current += 1; preparingRef.current = false; workerRef.current?.terminate(); workerRef.current = null;
    resultSessionRef.current = null;
    queueMicrotask(() => { if (!cancelled) {
      setResult(null); setInspection(null); setFieldError(""); setState("idle"); setProgress(0);
      setSettingsConfirmed(!initialSettings);
      setSettings(current => ({ ...current, ...initialSettings, fieldMapping: initialSettings?.fieldMapping }));
    } });
    if (!file) return;
    void inspectLocalCsv(file).then(found => {
      if (cancelled) return;
      setInspection(found);
      setSettings(current => ({ ...current, fieldMapping: mergeLocalImportFieldMapping(Object.fromEntries(Object.entries(found.fields).map(([key, value]) => [key, value.field])), current.fieldMapping) }));
      setFieldError("");
    }).catch(error => { if (!cancelled) setFieldError(error instanceof Error ? error.message : "无法读取 CSV 字段"); });
    return () => { cancelled = true; };
  }, [file, initialSettings]);

  const authorizeLocalAction = async () => {
    if (authorizationPending.current) return false;
    authorizationPending.current = true;
    const run = activeRunRef.current;
    try { return Boolean(await requireAccountSession()) && run === activeRunRef.current; }
    finally { authorizationPending.current = false; }
  };
  const start = async () => {
    if (!await authorizeLocalAction()) return;
    if (!file || busy || exporting || preparingRef.current || !inspection || fieldError || !settingsConfirmed) return;
    if (analysisScope === "full" && requiresLocalCsvSplit(file.size)) { await splitSource(); return; }
    if (!settings.fieldMapping?.longitude || !settings.fieldMapping?.latitude || inspection.dateCount < 20) { setFieldError("请补全经纬度字段，并提供至少 20 期可解析日期。"); return; }
    try { resolveLocalCsvFields(inspection.headers, settings.fieldMapping); }
    catch (error) { setFieldError(error instanceof Error ? error.message : "请核对字段映射。"); return; }
    const runId = ++activeRunRef.current;
    const frozenSettings = structuredClone(settings);
    preparingRef.current = true;
    setState("loading_file"); setDetail("正在检查本地文件身份与运行资源…");
    try {
      assertLocalFileSize(file.size, localBrowserCapabilities(), analysisScope === "full");
      if (largeFileMode) await prepareLargeLocalStorage(file.size);
      if (runId !== activeRunRef.current) return;
    }
    catch (error) { if (runId === activeRunRef.current) { preparingRef.current = false; setState("error"); setDetail(friendlyLocalAnalysisError(error)); } return; }
    let session: LocalAnalysisSession;
    let worker: Worker;
    try {
      session = await createLocalAnalysisSession(file, frozenSettings, { analysisScope, batchSize });
      if (runId !== activeRunRef.current) return;
      workerRef.current?.terminate();
      worker = new Worker(PASC_LOCAL_WORKER_URL, { type: "module", name: "pasc-local-webgis" });
    } catch (error) { if (runId === activeRunRef.current) { preparingRef.current = false; setState("error"); setDetail(friendlyLocalAnalysisError(error)); } return; }
    preparingRef.current = false;
    workerRef.current = worker;
    resultFieldMappingRef.current = { ...frozenSettings.fieldMapping };
    setResult(null);
    setProgress(0);
    setState("loading_file");
    setDetail(analysisScope === "quick" ? `快速验证只读取前 ${PASC_LOCAL_QUICK_POINTS.toLocaleString()} 个有效点；适合先检查字段和流程。` : largeFileMode ? "已启用 8 MiB 分块与 OPFS 本地结果；不会创建服务器任务。" : "完整模式将分析全部有效点；不会创建服务器任务。");
    worker.addEventListener("message", event => {
      if (runId !== activeRunRef.current || workerRef.current !== worker) return;
      const message = event.data as PascLocalWorkerResponse;
      if (message.type === "PROGRESS") {
        setState(message.state);
        setProgress(message.progress);
        setDetail(message.detail);
        return;
      }
      if (message.type === "BATCH_DONE") return;
      if (message.type === "COMPLETE") {
        try {
          setState("finalizing");
          const dataset = adaptLocalPredictionToMapData(message.result, file.name);
          resultSessionRef.current = session;
          resultSettingsRef.current = frozenSettings;
          onApplied(dataset, session);
          setResult(message.result);
          setState("ready");
          setProgress(1);
          const total = message.result.totalPredictedPoints ?? dataset.points.length;
          const scope = selectedPart && localSplit ? `当前为第 ${selectedPart.index} / ${localSplit.partCount} 片；地图、统计及空间参考仅对应当前片。` : "";
          setDetail(scope + (message.result.sourceTruncated ? `快速验证完成：已分析前 ${dataset.points.length.toLocaleString()} 个有效点。确认流程后可切换完整分析。` : message.result.mapSampled ? `已完成 ${total.toLocaleString()} 点；地图显示 ${dataset.points.length.toLocaleString()} 点本地抽样，完整结果保存在当前设备。` : `${dataset.points.length.toLocaleString()} 个结果已适配到原地图、图表与统计组件。`));
        } catch (error) {
          setState("error");
          setDetail(friendlyLocalAnalysisError(error));
        } finally {
          worker.terminate();
          workerRef.current = null;
        }
        return;
      }
      setState(message.type === "CANCELLED" ? "cancelled" : "error");
      setDetail(message.type === "CANCELLED" ? "本地 Worker 已停止；未创建服务器任务或进度文件。" : friendlyLocalAnalysisError(message.message));
      worker.terminate();
      workerRef.current = null;
    });
    worker.addEventListener("error", event => {
      if (runId !== activeRunRef.current || workerRef.current !== worker) return;
      setState("error");
      setDetail(friendlyLocalAnalysisError(event.message || "本地分析组件加载失败，请检查网络连接后重试。"));
      worker.terminate();
      workerRef.current = null;
    });
    worker.postMessage({ type: "START", file, settings: frozenSettings, batchSize, analysisScope, quickPointLimit: PASC_LOCAL_QUICK_POINTS } satisfies PascLocalWorkerRequest);
  };

  const cancel = () => {
    activeRunRef.current += 1; preparingRef.current = false;
    splitAbortRef.current?.abort(); setSplitting(false);
    workerRef.current?.terminate(); workerRef.current = null;
    setState("cancelled"); setProgress(0); setDetail("本地计算已停止，原始文件保留，可重新开始分析。");
  };

  const splitSource = async () => {
    if (!await authorizeLocalAction()) return;
    if (!sourceFile || busy || exporting) return;
    if (localSplit) { setDetail("已有本机分片，请选择分片分析或先清理当前分片任务。"); return; }
    const runId = ++activeRunRef.current, controller = new AbortController();
    splitAbortRef.current = controller;
    setSplitting(true); setState("loading_file"); setProgress(0); setDetail("正在检查您电脑的本地磁盘空间…");
    try {
      assertLocalFileSize(sourceFile.size, localBrowserCapabilities());
      await prepareLargeLocalStorage(sourceFile.size);
      if (runId !== activeRunRef.current || controller.signal.aborted) return;
      const split = await splitLocalCsv(sourceFile, { maxPartRows: partRows, signal: controller.signal, onProgress: (value, message) => {
        if (runId === activeRunRef.current) { setProgress(value); setDetail(message); }
      } });
      if (runId !== activeRunRef.current) return;
      setLocalSplit(split); setPartIndex(1);
      const first = await readLocalCsvSplitPart(split, 1);
      if (runId !== activeRunRef.current) return;
      setSelectedPart({ index: 1, file: first }); setState("idle"); setProgress(0);
      setDetail(`已在您电脑生成 ${split.partCount.toLocaleString()} 个分片。当前选择第 1 片，请核对字段后开始分析；各片不会被当作完整研究区统一结论。`);
    } catch (error) {
      if (runId === activeRunRef.current) { setState(controller.signal.aborted ? "cancelled" : "error"); setDetail(friendlyLocalAnalysisError(error)); }
    } finally {
      if (splitAbortRef.current === controller) splitAbortRef.current = null;
      if (runId === activeRunRef.current) setSplitting(false);
    }
  };

  const choosePart = async () => {
    if (!await authorizeLocalAction()) return;
    if (!localSplit || busy || exporting) return;
    const runId = ++activeRunRef.current;
    setExporting(true);
    try {
      const part = await readLocalCsvSplitPart(localSplit, partIndex);
      if (runId === activeRunRef.current) { setSelectedPart({ index: partIndex, file: part }); setDetail(`已选择第 ${partIndex} / ${localSplit.partCount} 片；分析仅覆盖当前片。`); }
    } catch (error) { if (runId === activeRunRef.current) setDetail(friendlyLocalAnalysisError(error)); }
    finally { setExporting(false); }
  };

  const savePart = async () => {
    if (!localSplit || busy || exporting) return;
    setExporting(true);
    try {
      const part = await readLocalCsvSplitPart(localSplit, partIndex);
      await saveOpfsResult({ kind: "opfs", directory: localSplit.directory, fileName: part.name, byteLength: part.size }, `${safeExportName(localSplit.sourceName.replace(/\.[^.]+$/, ""))}-part-${partIndex}.csv`);
      setDetail(`第 ${partIndex} 片已从本机存储保存，可在此设备重新选择分析；未上传服务器。`);
    } catch (error) { setDetail(friendlyLocalAnalysisError(error)); }
    finally { setExporting(false); }
  };

  const clearParts = async () => {
    if (!localSplit || busy || exporting) return;
    setExporting(true);
    try {
      await discardLocalCsvSplit(localSplit);
      setLocalSplit(null); setSelectedPart(null); setResult(null); setState("idle"); setProgress(0); onDiscard?.();
      setDetail("当前本机临时分片已清理；您选择的原始文件和其他任务文件保持不变。");
    } catch (error) { setDetail(friendlyLocalAnalysisError(error)); }
    finally { setExporting(false); }
  };

  const discardResult = async () => {
    if (!result || busy || exporting) return;
    setExporting(true);
    try { await discardLocalTemporaryResults(result); setDetail("当前临时结果已清理；原始 CSV 保留，可重新分析。"); }
    catch (error) { setDetail("部分临时文件未能清理：" + friendlyLocalAnalysisError(error)); }
    finally { activeRunRef.current += 1; resultSessionRef.current = null; resultSettingsRef.current = null; setResult(null); setState("idle"); setProgress(0); setExporting(false); onDiscard?.(); }
  };

  const exportResult = async () => {
    if (!result) return;
    const outputName = `${safeExportName(file?.name.replace(/\.[^.]+$/, "") ?? "pasc-local")}-pasc-local.csv`;
    if (!result.resultStorage) {
      downloadText(localPredictionCsv(result), outputName, "text/csv;charset=utf-8");
      return;
    }
    setExporting(true);
    try {
      await saveOpfsResult(result.resultStorage, outputName);
      setDetail("完整分类结果已从浏览器本地 OPFS 保存到您选择的位置。");
    } catch (error) {
      setDetail(friendlyLocalAnalysisError(error));
    } finally {
      setExporting(false);
    }
  };

  const exportOriginal = async () => {
    if (!result || !file) return;
    const outputName = `${safeExportName(file.name.replace(/\.[^.]+$/, ""))}-with-pasc.csv`;
    setExporting(true);
    try {
      await exportOriginalWithPascFields({
        source: file,
        result,
        suggestedName: outputName,
        fieldMapping: resultFieldMappingRef.current,
        onProgress: (value, message) => {
          setProgress(value);
          setDetail(message);
        },
      });
      setDetail(result.sourceTruncated ? "已保留全部原始行；快速验证范围内的点已追加分类字段，其余行留空。" : "已保留全部原始字段，并追加 PASC 模式、置信度与空间可靠性字段。");
    } catch (error) {
      setDetail(friendlyLocalAnalysisError(error));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className={`pasc-local-webgis is-${state}`} data-local-analysis-state={state}>
      <header><div><small>本机计算 · 文件不上传</small><h3>浏览器本地 PASC 分析</h3></div><span>{file ? "已选文件" : "浏览器"}</span></header>
      <p className="pasc-local-webgis-privacy"><b>隐私边界</b> 文件仅在当前设备中存储和分析，不上传服务器。超过 1 GiB 可先在本机分片；建议使用桌面版 Chrome 或 Edge。</p>
      <p className="pasc-local-webgis-privacy"><a href="/data/insar-user-template.csv" download>下载 CSV 格式示例</a> · 日期列使用 D20240101 或 2024-01-01；坐标为 WGS84 经纬度。示例为合成数据。</p>
      {sourceFile && <details className="pasc-local-webgis-warning" open={isStreamingLocalFile(sourceFile.size) || Boolean(localSplit)} data-local-csv-split>
        <summary>本机分片 · 大 CSV 建议使用</summary>
        <p>超过 300 MB 建议先分片，超过 1 GiB 完整分析须先分片。每片最多 25,000 行 / 128 MiB，全部原始字段和完整 CSV 行保留在您电脑。每片独立分析，跨片空间邻域不合并。</p>
        <label>每片最多行数 <input aria-label="本机分片每片行数" type="number" min={1} max={PASC_LOCAL_SPLIT_PART_ROWS} value={partRows} disabled={busy || exporting || Boolean(localSplit)} onChange={event => setPartRows(Math.max(1, Math.min(PASC_LOCAL_SPLIT_PART_ROWS, Math.floor(Number(event.target.value)) || 1)))} /></label>
        <button type="button" disabled={busy || exporting || Boolean(localSplit)} onClick={() => void splitSource()}>{splitting ? "正在您电脑上拆分…" : "在本机拆分原始 CSV"}</button>
        {localSplit && <div data-local-split-ready>
          <p>{localSplit.sourceName} 已生成 {localSplit.partCount.toLocaleString()} 片 / {localSplit.rowCount.toLocaleString()} 行。{selectedPart ? `当前分析第 ${selectedPart.index} 片。` : "当前为原文件快速验证。"}原文件未上传。</p>
          <label>分片编号 <input aria-label="本机分片编号" type="number" min={1} max={localSplit.partCount} value={partIndex} disabled={busy || exporting} onChange={event => setPartIndex(Math.max(1, Math.min(localSplit.partCount, Math.floor(Number(event.target.value)) || 1)))} /></label>
          <button type="button" disabled={busy || exporting} onClick={() => void choosePart()}>选择此分片分析</button>
          <button type="button" disabled={busy || exporting} onClick={() => void savePart()}>保存此分片到本机磁盘</button>
          <button type="button" disabled={busy || exporting} onClick={() => { setSelectedPart(null); setAnalysisScope("quick"); }}>返回原文件快速验证</button>
          <button type="button" disabled={busy || exporting} onClick={() => void clearParts()}>清理本次临时分片</button>
        </div>}
      </details>}
      <fieldset className="pasc-local-scope" disabled={busy}>
        <legend>选择处理深度</legend>
        <button type="button" className={analysisScope === "quick" ? "active" : ""} aria-pressed={analysisScope === "quick"} onClick={() => setAnalysisScope("quick")}><b>快速验证</b><span>前 {PASC_LOCAL_QUICK_POINTS.toLocaleString()} 个有效点</span><small>先确认字段、单位和分类效果</small></button>
        <button type="button" className={analysisScope === "full" ? "active" : ""} aria-pressed={analysisScope === "full"} onClick={() => setAnalysisScope("full")}><b>完整分析</b><span>全部有效点</span><small>结果可回填到原始 CSV</small></button>
      </fieldset>
      <button className="pasc-local-webgis-file" type="button" disabled={busy || exporting} onClick={onChooseFile}>
        <span>{file?.name ?? "选择时序 InSAR CSV"}</span><small>{file ? `${(file.size / 1_048_576).toFixed(1)} MB · ${largeFileMode ? "大文件分块模式" : "未上传"}` : "自动读取字段 · 至少 20 个有效日期"}</small>
      </button>
      {file && localDatasetWarning(file.size, result?.totalPredictedPoints ?? result?.pointIds.length) && <p className="pasc-local-webgis-warning"><b>大型数据提醒</b>{analysisScope === "quick" ? `快速验证达到 ${PASC_LOCAL_QUICK_POINTS.toLocaleString()} 个有效点后即停止读取，不代表全量类别比例。` : largeFileMode ? "建议先使用本机分片。直接分析仍有全点元数据内存开销；单次最多 100,000 行，并受时序内存预算保护。分片与结果只占用您设备的磁盘。" : `${localDatasetWarning(file.size, result?.pointIds.length)} 已超过 ${PASC_LOCAL_RECOMMENDED_POINTS.toLocaleString()} 点的推荐规模，建议先运行快速验证，再执行完整分析。`}</p>}

      {file && !inspection && !fieldError && <p role="status">正在本机读取字段名称…</p>}
      {inspection && <fieldset className="pasc-local-field-mapping" disabled={busy || exporting}>
        <legend>已识别字段 · 可纠正</legend>
        <p>{inspection.dateCount} 个日期：{inspection.startDate}—{inspection.endDate}。坐标须为 WGS84 经纬度。</p>
        {([["point_id", "点位编号"], ["longitude", "经度（必需）"], ["latitude", "纬度（必需）"], ["velocity", "年均速率"], ["coherence", "相干性"]] as [PascLocalField, string][]).map(([key, label]) => <label key={key}><span>{label}</span><select aria-label={`本地 CSV ${label}`} value={settings.fieldMapping?.[key] ?? ""} onChange={event => { setSettings(current => ({ ...current, fieldMapping: { ...current.fieldMapping, [key]: event.target.value } })); setFieldError(""); }}>
          <option value="">{key === "longitude" || key === "latitude" ? "请选择对应列" : key === "velocity" ? "未提供 · 按时序计算" : key === "point_id" ? "未提供 · 自动编号" : "未提供 · 标记质量待核实"}</option>
          {inspection.headers.map(header => <option key={header} value={header}>{header}</option>)}
        </select>{inspection.fields[key].requiresConfirmation && <small>无法确定或存在多个候选，请核对所选列。</small>}</label>)}
        {inspection.dateCount < 20 && <p role="alert">不足 20 期。日期列可使用 D20240101 或 2024-01-01 格式。</p>}
      </fieldset>}
      {fieldError && <p className="pasc-local-webgis-warning" role="alert">{fieldError}</p>}
      <div className="pasc-local-webgis-settings">
        <label><span>位移单位</span><select disabled={busy} value={settings.displacementUnit} onChange={event => setSettings(current => ({ ...current, displacementUnit: event.target.value as PascLocalSettings["displacementUnit"] }))}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
        <label><span>速率单位</span><select disabled={busy} value={settings.velocityUnit} onChange={event => setSettings(current => ({ ...current, velocityUnit: event.target.value as PascLocalSettings["velocityUnit"] }))}><option value="mm/year">mm/year</option><option value="cm/year">cm/year</option><option value="m/year">m/year</option></select></label>
        <label><span>预处理</span><select disabled={busy} value={settings.preprocessingState} onChange={event => setSettings(current => ({ ...current, preprocessingState: event.target.value as PascLocalSettings["preprocessingState"] }))}><option value="raw">原始 · 执行 SG</option><option value="already_smoothed">已平滑 · 跳过 SG</option></select></label>
        <label><span>正负号</span><select disabled={busy} value={settings.signConvention} onChange={event => setSettings(current => ({ ...current, signConvention: event.target.value as PascLocalSettings["signConvention"] }))}><option value="subsidence_negative">沉降为负</option><option value="subsidence_positive">沉降为正</option><option value="model_native">模型原生</option></select></label>
        <label><span>批量</span><select disabled={busy} value={batchSize} onChange={event => setBatchSize(Number(event.target.value) as 256 | 512 | 1024)}><option value="256">256 · 推荐</option><option value="512">512</option><option value="1024">1024 · 上限</option></select></label>
      </div>
      {initialSettings && <label className="pasc-local-webgis-warning"><input type="checkbox" checked={settingsConfirmed} disabled={busy} onChange={event => setSettingsConfirmed(event.target.checked)} /> 我已核对字段、单位、正负号与预处理。本机分类使用文件中全部可解析日期列。</label>}
      <div className="pasc-local-webgis-status" role="status" aria-live="polite"><span><b>{labels[state]}</b><small>{detail}</small></span><strong>{Math.round(progress * 100)}%</strong></div>
      <div className="pasc-local-webgis-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="pasc-local-webgis-actions">
        <button type="button" disabled={!file || busy || exporting || !inspection || Boolean(fieldError) || !settingsConfirmed || inspection.dateCount < 20 || !settings.fieldMapping?.longitude || !settings.fieldMapping?.latitude} onClick={() => void start()}>{analysisScope === "full" && file && requiresLocalCsvSplit(file.size) ? "先在本机拆分大 CSV" : state === "ready" ? `重新执行${analysisScope === "quick" ? "快速验证" : "完整分析"}` : analysisScope === "quick" ? "开始快速验证并接入地图" : "开始完整分析并接入地图"}</button>
        <button type="button" className="secondary" disabled={!busy} onClick={cancel}>取消</button>
      </div>
      {result && <div className="pasc-local-webgis-result" data-performance={JSON.stringify({ fileSizeBytes: result.fileSizeBytes, timeSteps: result.timeSteps, csvParsingMs: result.csvParsingMs, preprocessingMs: result.preprocessingMs, modelLoadingMs: result.modelLoadingMs, inferenceMs: result.inferenceMs, totalMs: result.elapsedMs, averageBatchMs: result.averageBatchMs, batchCount: result.batchCount, provider: result.provider, batchSize: result.batchSize })}>
        <div><span>{result.mapSampled ? "完成 / 地图" : "有效点"}</span><b>{result.mapSampled ? `${(result.totalPredictedPoints ?? result.pointIds.length).toLocaleString()} / ${result.pointIds.length.toLocaleString()}` : result.pointIds.length.toLocaleString()}</b></div><div><span>节点</span><b>{result.timeSteps}</b></div><div><span>引擎</span><b>{result.provider.toUpperCase()}</b></div><div><span>耗时</span><b>{(result.elapsedMs / 1000).toFixed(1)}s</b></div>
        <section className="pasc-local-webgis-performance"><span>CSV 解析 <b>{result.csvParsingMs.toFixed(0)} ms</b></span><span>预处理 <b>{result.preprocessingMs.toFixed(0)} ms</b></span><span>模型加载 <b>{result.modelLoadingMs.toFixed(0)} ms</b></span><span>ONNX 推理 <b>{result.inferenceMs.toFixed(0)} ms</b></span><span>平均 batch <b>{result.averageBatchMs.toFixed(1)} ms</b></span><span>文件 <b>{(result.fileSizeBytes / 1_048_576).toFixed(1)} MB</b></span></section>
        <p role="status">数据检查：坐标/编号无效 {result.invalidRows.toLocaleString()} 行；不足 20 期的合法点保留为未分类。{result.invalidReasons && Object.entries(result.invalidReasons).map(([reason, count]) => <span key={reason}> {({ invalidCoordinate: "坐标无效", insufficientEpochs: "分类不适用", duplicateIds: "重复编号" } as Record<string, string>)[reason] ?? reason} {String(count)}；</span>)}</p>
        <button type="button" onClick={() => downloadText(JSON.stringify({ schemaVersion: "local-analysis-summary-v1", session: resultSessionRef.current, settings: resultSettingsRef.current, analysisScope: result.analysisScope, totalRows: result.totalRows, pointCount: result.pointIds.length, totalPredictedPoints: result.totalPredictedPoints, invalidRows: result.invalidRows, invalidReasons: result.invalidReasons, invalidExamples: result.invalidExamples, observedDates: result.observedDates, modelProvider: result.provider, note: "会话摘要不包含原始CSV或完整分类数据；刷新后需要重新选择原文件并分析。大型文件指纹为首中尾采样，详见coverage。" }, null, 2), safeExportName(file?.name ?? "local") + "-analysis-summary.json", "application/json;charset=utf-8")}>保存分析摘要与数据检查</button>
        <p>当前临时结果占用 {(localTemporaryStorageBytes(result) / 1_048_576).toFixed(1)} MB 浏览器存储；导出后可清理，刷新页面需重新选择原文件。</p>
        <button type="button" disabled={exporting} onClick={() => void discardResult()}>清理当前临时分析结果</button>
        <footer><button type="button" disabled={exporting} onClick={() => void exportResult()}>{exporting ? "正在保存…" : result.resultStorage ? "保存完整结果 CSV" : "导出分类结果"}</button><button type="button" className="original-export" disabled={exporting} onClick={() => void exportOriginal()}>导出原始数据＋分类字段</button><button type="button" onClick={() => onFilter("lowConfidence")}>筛选低置信度</button><button type="button" onClick={() => onFilter("limitedReference")}>筛选空间受限</button></footer>
      </div>}
      <small className="pasc-local-webgis-boundary">登录后使用本机分析，不上传原始 CSV。首次使用需下载模型与运行组件；之后使用本机 CPU / GPU 计算。大文件完整结果保存在当前浏览器，需导出后自行留存。</small>
    </section>
  );
}
