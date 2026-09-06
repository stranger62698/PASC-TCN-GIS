"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PASC_LOCAL_CLASS_NAMES, type PascLocalSettings } from "../lib/pasc-local-preprocess";
import { assertLocalFileSize, isStreamingLocalFile, localBrowserCapabilities } from "../lib/pasc-local-limits";
import { prepareLargeLocalStorage } from "../lib/pasc-local-opfs";
import { getSession, type AuthUser } from "../lib/auth-client";
import {
  PASC_LOCAL_WORKER_URL,
  type PascLocalCompletePayload,
  type PascLocalTaskState,
  type PascLocalWorkerRequest,
  type PascLocalWorkerResponse,
} from "../lib/pasc-local-worker-protocol";

const defaultSettings: PascLocalSettings = {
  displacementUnit: "mm",
  velocityUnit: "mm/year",
  signConvention: "subsidence_negative",
  preprocessingState: "raw",
};

const stateLabels: Record<PascLocalTaskState, string> = {
  idle: "等待选择本地 CSV",
  loading_file: "正在读取本地文件",
  parsing: "正在解析 CSV",
  streaming: "正在分块分析",
  preprocessing: "正在预处理",
  loading_model: "正在加载本地模型",
  predicting: "正在本地分类",
  finalizing: "正在生成结果",
  ready: "本地分析完成",
  error: "本地分析失败",
  cancelled: "任务已取消",
};

function formatBytes(bytes: number) {
  if (bytes < 1_048_576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1_048_576).toFixed(1) + " MB";
}

export function PascLocalPrototype() {
  const [file, setFile] = useState<File | null>(null);
  const [settings, setSettings] = useState(defaultSettings);
  const [batchSize, setBatchSize] = useState<256 | 512 | 1024 | 2048>(256);
  const [state, setState] = useState<PascLocalTaskState>("idle");
  const [progress, setProgress] = useState(0);
  const [detail, setDetail] = useState("原始 CSV 仅交给浏览器 Worker，不会上传。");
  const [result, setResult] = useState<PascLocalCompletePayload | null>(null);
  const [account, setAccount] = useState<AuthUser | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const busy = !["idle", "ready", "error", "cancelled"].includes(state);
  useEffect(() => () => workerRef.current?.terminate(), []);
  useEffect(() => { void getSession().then(setAccount).catch(() => setAccount(null)); }, []);

  const previews = useMemo(() => {
    if (!result) return [];
    return result.pointIds.slice(0, 8).map((pointId, index) => ({
      pointId,
      mode: PASC_LOCAL_CLASS_NAMES[result.modeIndex[index]],
      confidence: result.confidence[index],
    }));
  }, [result]);

  const start = async () => {
    if (!file || busy) return;
    if (isStreamingLocalFile(file.size) && !account) {
      setState("error");
      setDetail("300 MB 以上大文件模式需要先登录；CSV 仍只交给浏览器 Worker。");
      return;
    }
    try {
      assertLocalFileSize(file.size, localBrowserCapabilities());
      if (isStreamingLocalFile(file.size)) await prepareLargeLocalStorage(file.size);
    } catch (error) {
      setState("error");
      setDetail(error instanceof Error ? error.message : String(error));
      return;
    }
    workerRef.current?.terminate();
    const worker = new Worker(PASC_LOCAL_WORKER_URL, { type: "module", name: "pasc-local-analysis" });
    workerRef.current = worker;
    setResult(null);
    setProgress(0);
    setState("loading_file");
    setDetail("正在把 File 对象交给本地 Worker");
    worker.addEventListener("message", event => {
      const message = event.data as PascLocalWorkerResponse;
      if (message.type === "PROGRESS") {
        setState(message.state);
        setProgress(message.progress);
        setDetail(message.detail);
      } else if (message.type === "BATCH_DONE") {
        console.debug("[PASC local worker] batch", message.completed, message.total, message.elapsedMs);
      } else if (message.type === "COMPLETE") {
        console.debug("[PASC local worker] complete provider=" + message.result.provider + "; batch=" + message.result.batchSize + "; points=" + message.result.pointIds.length);
        setResult(message.result);
        setState("ready");
        setProgress(1);
        setDetail("完成 · " + (message.result.totalPredictedPoints ?? message.result.pointIds.length).toLocaleString() + " 个点已得到 mode + confidence");
        worker.terminate();
        workerRef.current = null;
      } else if (message.type === "CANCELLED") {
        setState("cancelled");
        setDetail("本地 Worker 已停止，未产生服务器任务或进度文件。");
        worker.terminate();
        workerRef.current = null;
      } else {
        setState("error");
        setDetail(message.message);
        worker.terminate();
        workerRef.current = null;
      }
    });
    worker.addEventListener("error", event => {
      setState("error");
      setDetail(event.message || "本地 Worker 加载失败。请先生成 Phase 3 本地资产。");
      worker.terminate();
      workerRef.current = null;
    });
    const request: PascLocalWorkerRequest = { type: "START", file, settings, batchSize };
    worker.postMessage(request);
  };

  const cancel = () => {
    if (!workerRef.current) return;
    workerRef.current.postMessage({ type: "CANCEL" } satisfies PascLocalWorkerRequest);
    setDetail("正在取消当前批次…");
  };

  return (
    <main className={"pasc-local-prototype is-" + state} data-phase3-status={state}>
      <section className="pasc-local-console" aria-labelledby="pasc-local-title">
        <header>
          <div>
            <small>PHASE 03 · PRIVATE LOCAL PIPELINE</small>
            <h1 id="pasc-local-title">浏览器本地 PASC 分析</h1>
            <p>CSV 解析、12 天插值、SG、归一化与 ONNX 分批推理全部在独立 Worker 内完成。</p>
          </div>
          <span aria-hidden="true">PASC-TCN</span>
        </header>

        <div className="pasc-local-privacy">
          <b>LOCAL / NO UPLOAD</b>
          <span>原始 CSV 不经过 Vercel Blob，也不创建服务器 meta.json。</span>
        </div>

        <label className={"pasc-local-drop " + (file ? "has-file" : "")}>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={event => {
              const next = event.target.files?.[0] ?? null;
              setFile(next);
              setResult(null);
              setState("idle");
              setProgress(0);
              setDetail(next ? "文件已就绪；开始后由 File.stream() 分块读取。" : "原始 CSV 仅交给浏览器 Worker，不会上传。");
            }}
          />
          <span>{file ? "CSV READY" : "SELECT CSV"}</span>
          <div>
            <b>{file?.name ?? "选择本机时序 InSAR CSV"}</b>
            <small>{file ? formatBytes(file.size) + " · 未上传" : "至少 20 个真实日期字段；推荐 248 期"}</small>
          </div>
        </label>

        <div className="pasc-local-settings">
          <label>
            <span>位移单位</span>
            <select disabled={busy} value={settings.displacementUnit} onChange={event => setSettings(current => ({ ...current, displacementUnit: event.target.value as PascLocalSettings["displacementUnit"] }))}>
              <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option>
            </select>
          </label>
          <label>
            <span>速率单位</span>
            <select disabled={busy} value={settings.velocityUnit} onChange={event => setSettings(current => ({ ...current, velocityUnit: event.target.value as PascLocalSettings["velocityUnit"] }))}>
              <option value="mm/year">mm/year</option><option value="cm/year">cm/year</option><option value="m/year">m/year</option>
            </select>
          </label>
          <label>
            <span>预处理状态</span>
            <select disabled={busy} value={settings.preprocessingState} onChange={event => setSettings(current => ({ ...current, preprocessingState: event.target.value as PascLocalSettings["preprocessingState"] }))}>
              <option value="raw">原始时序 · 执行 SG</option><option value="already_smoothed">已平滑 · 跳过 SG</option>
            </select>
          </label>
          <label>
            <span>形变正负号</span>
            <select disabled={busy} value={settings.signConvention} onChange={event => setSettings(current => ({ ...current, signConvention: event.target.value as PascLocalSettings["signConvention"] }))}>
              <option value="subsidence_negative">沉降为负</option><option value="subsidence_positive">沉降为正</option><option value="model_native">模型原生</option>
            </select>
          </label>
          <label>
            <span>推理批量</span>
            <select disabled={busy} value={batchSize} onChange={event => setBatchSize(Number(event.target.value) as 256 | 512 | 1024 | 2048)}>
              <option value="256">256 · 推荐</option><option value="512">512</option><option value="1024">1024 · 上限</option><option value="2048" disabled>2048 · 超出 WebGPU 缓冲限制</option>
            </select>
          </label>
        </div>

        <div className="pasc-local-status" role="status" aria-live="polite">
          <i aria-hidden="true" />
          <div>
            <b>{stateLabels[state]}</b>
            <small>{detail}</small>
          </div>
          <strong>{Math.round(progress * 100)}%</strong>
        </div>
        <div className="pasc-local-progress" aria-hidden="true"><span style={{ width: Math.round(progress * 100) + "%" }} /></div>

        <div className="pasc-local-actions">
          <button type="button" disabled={!file || busy} onClick={() => void start()}>开始本地分析</button>
          <button type="button" className="is-secondary" disabled={!busy} onClick={cancel}>取消任务</button>
        </div>

        {result && (
          <section className="pasc-local-result" aria-label="本地分类结果">
            <div className="pasc-local-metrics">
              <article><small>有效点</small><b>{result.pointIds.length.toLocaleString()}</b></article>
              <article><small>标准节点</small><b>{result.timeSteps}</b></article>
              <article><small>批量</small><b>{result.batchSize}</b></article>
              <article><small>耗时</small><b>{(result.elapsedMs / 1000).toFixed(1)}s</b></article>
            </div>
            <div className="pasc-local-distribution">
              {PASC_LOCAL_CLASS_NAMES.map((name, index) => (
                <div key={name}>
                  <span>{name}</span>
                  <i><em style={{ width: (result.classCounts[index] / result.pointIds.length * 100) + "%" }} /></i>
                  <b>{result.classCounts[index].toLocaleString()}</b>
                </div>
              ))}
            </div>
            <table>
              <thead><tr><th>POINT ID</th><th>MODE</th><th>CONFIDENCE</th></tr></thead>
              <tbody>{previews.map(item => <tr key={item.pointId}><td>{item.pointId}</td><td>{item.mode}</td><td>{(item.confidence * 100).toFixed(1)}%</td></tr>)}</tbody>
            </table>
          </section>
        )}

        <footer>
          <span>本页保留为独立管线验证入口；正式地图已接入 Local adapter 与浏览器本地导出。</span>
          <code>worker · typed arrays · no blob task</code>
        </footer>
      </section>
    </main>
  );
}
