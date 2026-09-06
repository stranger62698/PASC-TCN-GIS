"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { downloadText, safeExportName } from "../lib/analysis-exports";
import { exportOriginalWithPascFields } from "../lib/pasc-local-export";
import { adaptLocalPredictionToMapData, localPredictionCsv, type PascLocalMapDataset } from "../lib/pasc-local-map-adapter";
import { assertLocalFileSize, friendlyLocalAnalysisError, isStreamingLocalFile, localBrowserCapabilities, localDatasetWarning, PASC_LOCAL_QUICK_POINTS, PASC_LOCAL_RECOMMENDED_POINTS } from "../lib/pasc-local-limits";
import { prepareLargeLocalStorage, saveOpfsResult } from "../lib/pasc-local-opfs";
import type { PascLocalSettings } from "../lib/pasc-local-preprocess";
import {
  PASC_LOCAL_WORKER_URL,
  type PascLocalCompletePayload,
  type PascLocalTaskState,
  type PascLocalWorkerRequest,
  type PascLocalWorkerResponse,
} from "../lib/pasc-local-worker-protocol";

type PascLocalWebGisProps = {
  file: File | null;
  authenticated: boolean;
  onChooseFile: () => void;
  onApplied: (dataset: PascLocalMapDataset) => void;
  onFilter: (filter: "lowConfidence" | "limitedReference") => void;
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

export function PascLocalWebGis({ file, authenticated, onChooseFile, onApplied, onFilter }: PascLocalWebGisProps) {
  const [settings, setSettings] = useState(defaultSettings);
  const [batchSize, setBatchSize] = useState<256 | 512 | 1024>(256);
  const [analysisScope, setAnalysisScope] = useState<"quick" | "full">("full");
  const [state, setState] = useState<PascLocalTaskState>("idle");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("数据默认在浏览器本地处理，原始 CSV 不会上传服务器。");
  const [result, setResult] = useState<PascLocalCompletePayload | null>(null);
  const [exporting, setExporting] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const busy = !["idle", "ready", "error", "cancelled"].includes(state);
  const largeSourceFile = Boolean(file && isStreamingLocalFile(file.size));
  const largeFileMode = largeSourceFile && analysisScope === "full";

  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => {
    if (!busy) return;
    const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [busy]);

  const start = async () => {
    if (!file || busy) return;
    if (largeFileMode && !authenticated) {
      setState("error");
      setDetail("300 MB 以上大文件模式需要先登录；登录只解锁功能，原始 CSV 仍不会上传。");
      return;
    }
    try {
      assertLocalFileSize(file.size, localBrowserCapabilities(), analysisScope === "full");
      if (largeFileMode) await prepareLargeLocalStorage(file.size);
    }
    catch (error) { setState("error"); setDetail(friendlyLocalAnalysisError(error)); return; }
    workerRef.current?.terminate();
    const worker = new Worker(PASC_LOCAL_WORKER_URL, { type: "module", name: "pasc-local-webgis" });
    workerRef.current = worker;
    setResult(null);
    setProgress(0);
    setState("loading_file");
    setDetail(analysisScope === "quick" ? `快速验证只读取前 ${PASC_LOCAL_QUICK_POINTS.toLocaleString()} 个有效点；适合先检查字段和流程。` : largeFileMode ? "已启用 8 MiB 分块与 OPFS 本地结果；不会创建服务器任务。" : "完整模式将分析全部有效点；不会创建服务器任务。");
    worker.addEventListener("message", event => {
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
          onApplied(dataset);
          setResult(message.result);
          setState("ready");
          setProgress(1);
          const total = message.result.totalPredictedPoints ?? dataset.points.length;
          setDetail(message.result.sourceTruncated ? `快速验证完成：已分析前 ${dataset.points.length.toLocaleString()} 个有效点。确认流程后可切换完整分析。` : message.result.mapSampled ? `已完成 ${total.toLocaleString()} 点；地图显示 ${dataset.points.length.toLocaleString()} 点本地抽样，完整结果保存在当前设备。` : `${dataset.points.length.toLocaleString()} 个结果已适配到原地图、图表与统计组件。`);
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
      setState("error");
      setDetail(friendlyLocalAnalysisError(event.message || "本地 Worker 加载失败，请先生成私有本地模型资产。"));
      worker.terminate();
      workerRef.current = null;
    });
    worker.postMessage({ type: "START", file, settings, batchSize, analysisScope, quickPointLimit: PASC_LOCAL_QUICK_POINTS } satisfies PascLocalWorkerRequest);
  };

  const cancel = () => {
    workerRef.current?.postMessage({ type: "CANCEL" } satisfies PascLocalWorkerRequest);
    setDetail("正在取消当前推理批次…");
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
      <header><div><small>LOCAL ONNX · NO TASK BLOB</small><h3>浏览器本地 PASC 分析</h3></div><span>{file ? "CSV READY" : "LOCAL"}</span></header>
      <p className="pasc-local-webgis-privacy"><b>隐私边界</b> 文件仅在当前设备中分析，不上传服务器。支持最大 1 GiB，建议使用桌面版 Chrome 或 Edge。</p>
      <fieldset className="pasc-local-scope" disabled={busy}>
        <legend>选择处理深度</legend>
        <button type="button" className={analysisScope === "quick" ? "active" : ""} aria-pressed={analysisScope === "quick"} onClick={() => setAnalysisScope("quick")}><b>快速验证</b><span>前 {PASC_LOCAL_QUICK_POINTS.toLocaleString()} 个有效点</span><small>先确认字段、单位和分类效果</small></button>
        <button type="button" className={analysisScope === "full" ? "active" : ""} aria-pressed={analysisScope === "full"} onClick={() => setAnalysisScope("full")}><b>完整分析</b><span>全部有效点</span><small>结果可回填到原始 CSV</small></button>
      </fieldset>
      <button className="pasc-local-webgis-file" type="button" disabled={busy} onClick={onChooseFile}>
        <span>{file?.name ?? "选择时序 InSAR CSV"}</span><small>{file ? `${(file.size / 1_048_576).toFixed(1)} MB · ${largeFileMode ? "大文件分块模式" : "未上传"}` : "至少 20 个日期字段；推荐 248 期"}</small>
      </button>
      {file && localDatasetWarning(file.size, result?.totalPredictedPoints ?? result?.pointIds.length) && <p className="pasc-local-webgis-warning"><b>大型数据提醒</b>{analysisScope === "quick" ? `快速验证达到 ${PASC_LOCAL_QUICK_POINTS.toLocaleString()} 个有效点后即停止读取，不代表全量类别比例。` : largeFileMode ? "将以 8 MiB 数据块预处理并逐批执行 ONNX；完整分类结果写入当前浏览器 OPFS，地图最多显示 25,000 个确定性抽样点。" : `${localDatasetWarning(file.size, result?.pointIds.length)} 已超过 ${PASC_LOCAL_RECOMMENDED_POINTS.toLocaleString()} 点的推荐规模，建议先运行快速验证，再执行完整分析。`}</p>}
      {largeFileMode && !authenticated && <p className="pasc-local-webgis-login"><b>登录解锁大文件模式</b><span>登录只验证使用权限，不会接收或保存您的 CSV。</span><Link href="/login">登录 / 注册 →</Link></p>}
      <div className="pasc-local-webgis-settings">
        <label><span>位移单位</span><select disabled={busy} value={settings.displacementUnit} onChange={event => setSettings(current => ({ ...current, displacementUnit: event.target.value as PascLocalSettings["displacementUnit"] }))}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
        <label><span>速率单位</span><select disabled={busy} value={settings.velocityUnit} onChange={event => setSettings(current => ({ ...current, velocityUnit: event.target.value as PascLocalSettings["velocityUnit"] }))}><option value="mm/year">mm/year</option><option value="cm/year">cm/year</option><option value="m/year">m/year</option></select></label>
        <label><span>预处理</span><select disabled={busy} value={settings.preprocessingState} onChange={event => setSettings(current => ({ ...current, preprocessingState: event.target.value as PascLocalSettings["preprocessingState"] }))}><option value="raw">原始 · 执行 SG</option><option value="already_smoothed">已平滑 · 跳过 SG</option></select></label>
        <label><span>正负号</span><select disabled={busy} value={settings.signConvention} onChange={event => setSettings(current => ({ ...current, signConvention: event.target.value as PascLocalSettings["signConvention"] }))}><option value="subsidence_negative">沉降为负</option><option value="subsidence_positive">沉降为正</option><option value="model_native">模型原生</option></select></label>
        <label><span>批量</span><select disabled={busy} value={batchSize} onChange={event => setBatchSize(Number(event.target.value) as 256 | 512 | 1024)}><option value="256">256 · 推荐</option><option value="512">512</option><option value="1024">1024 · 上限</option></select></label>
      </div>
      <div className="pasc-local-webgis-status" role="status" aria-live="polite"><span><b>{labels[state]}</b><small>{detail}</small></span><strong>{Math.round(progress * 100)}%</strong></div>
      <div className="pasc-local-webgis-progress" aria-hidden="true"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <div className="pasc-local-webgis-actions">
        <button type="button" disabled={!file || busy || (largeFileMode && !authenticated)} onClick={() => void start()}>{state === "ready" ? `重新执行${analysisScope === "quick" ? "快速验证" : "完整分析"}` : analysisScope === "quick" ? "开始快速验证并接入地图" : "开始完整分析并接入地图"}</button>
        <button type="button" className="secondary" disabled={!busy} onClick={cancel}>取消</button>
      </div>
      {result && <div className="pasc-local-webgis-result" data-performance={JSON.stringify({ fileSizeBytes: result.fileSizeBytes, timeSteps: result.timeSteps, csvParsingMs: result.csvParsingMs, preprocessingMs: result.preprocessingMs, modelLoadingMs: result.modelLoadingMs, inferenceMs: result.inferenceMs, totalMs: result.elapsedMs, averageBatchMs: result.averageBatchMs, batchCount: result.batchCount, provider: result.provider, batchSize: result.batchSize })}>
        <div><span>{result.mapSampled ? "完成 / 地图" : "有效点"}</span><b>{result.mapSampled ? `${(result.totalPredictedPoints ?? result.pointIds.length).toLocaleString()} / ${result.pointIds.length.toLocaleString()}` : result.pointIds.length.toLocaleString()}</b></div><div><span>节点</span><b>{result.timeSteps}</b></div><div><span>引擎</span><b>{result.provider.toUpperCase()}</b></div><div><span>耗时</span><b>{(result.elapsedMs / 1000).toFixed(1)}s</b></div>
        <section className="pasc-local-webgis-performance"><span>CSV 解析 <b>{result.csvParsingMs.toFixed(0)} ms</b></span><span>预处理 <b>{result.preprocessingMs.toFixed(0)} ms</b></span><span>模型加载 <b>{result.modelLoadingMs.toFixed(0)} ms</b></span><span>ONNX 推理 <b>{result.inferenceMs.toFixed(0)} ms</b></span><span>平均 batch <b>{result.averageBatchMs.toFixed(1)} ms</b></span><span>文件 <b>{(result.fileSizeBytes / 1_048_576).toFixed(1)} MB</b></span></section>
        <footer><button type="button" disabled={exporting} onClick={() => void exportResult()}>{exporting ? "正在保存…" : result.resultStorage ? "保存完整结果 CSV" : "导出分类结果"}</button><button type="button" className="original-export" disabled={exporting} onClick={() => void exportOriginal()}>导出原始数据＋分类字段</button><button type="button" onClick={() => onFilter("lowConfidence")}>筛选低置信度</button><button type="button" onClick={() => onFilter("limitedReference")}>筛选空间受限</button></footer>
      </div>}
      <small className="pasc-local-webgis-boundary">Local 不调用 request/result/progress Blob、上传 API、任务列表或任务状态轮询。大文件完整结果只写入当前浏览器 OPFS；地图抽样不等于只分析抽样点。</small>
    </section>
  );
}
