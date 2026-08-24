"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CsvMapping } from "../lib/insar-v2";
import type { PascJobArtifact, PascJobEvent, PascPublicJob } from "../lib/pasc-job-client";

type DatasetOption = { id: string; name: string; pointCount?: number; qualityReport?: { validPoints?: number }; mapping?: CsvMapping; status?: string };
type JobDetail = { job: PascPublicJob; events: PascJobEvent[] };
const activeStatuses = new Set(["queued", "running", "retry_wait", "cancelling"]);
const statusLabels: Record<string, string> = { queued: "排队中", running: "处理中", retry_wait: "等待重试", cancelling: "正在取消", cancelled: "已取消", completed: "已完成", failed: "失败" };
const stageLabels: Record<string, string> = { queued: "持久队列", claimed: "已认领", downloading: "流式读取", validating: "校验", preprocessing: "预处理", inference: "分块推理", writing: "写回工件", finalizing: "收尾", completed: "完成", cancelled: "取消", failed: "失败" };
const artifactLabels: Record<string, string> = { validation: "校验报告", predictions: "分块预测", summary: "任务摘要", audit: "模型审计", errors: "未支持点", map_level_0: "概览地图", map_level_1: "区域地图", map_level_2: "细节地图", preprocessed: "封存预处理" };

function readError(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const error = (body as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return fallback;
}
function formatBytes(value: number) { return value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`; }
function eligible(dataset: DatasetOption) {
  const mapping = dataset.mapping;
  return Boolean(mapping?.lon && mapping.lat && mapping.timeCols?.length >= 40 && ["mm", "cm", "m"].includes(String(mapping.displacementUnit)) && ["toward_satellite_positive", "away_from_satellite_positive"].includes(String(mapping.signConvention)) && ["raw", "already_smoothed"].includes(String(mapping.preprocessingState)));
}

export function PascJobPanel({ datasets }: { datasets: DatasetOption[] }) {
  const available = useMemo(() => datasets.filter(eligible), [datasets]);
  const [datasetId, setDatasetId] = useState("");
  const [jobs, setJobs] = useState<PascPublicJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [artifacts, setArtifacts] = useState<PascJobArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const idempotency = useRef(new Map<string, string>());

  const selectedDatasetId = datasetId || available[0]?.id || "";

  const loadDetail = useCallback(async (jobId: string) => {
    const [jobResponse, artifactsResponse] = await Promise.all([
      fetch(`/v1/jobs/${jobId}`, { credentials: "include", cache: "no-store" }),
      fetch(`/v1/jobs/${jobId}/artifacts`, { credentials: "include", cache: "no-store" }),
    ]);
    if (!jobResponse.ok) throw new Error(readError(await jobResponse.json().catch(() => null), "任务详情读取失败。"));
    const jobBody = await jobResponse.json() as JobDetail;
    setDetail(jobBody);
    if (artifactsResponse.ok) setArtifacts(((await artifactsResponse.json()) as { artifacts?: PascJobArtifact[] }).artifacts ?? []);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/v1/jobs?limit=50", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error(readError(await response.json().catch(() => null), "任务列表读取失败。"));
      const next = ((await response.json()) as { jobs?: PascPublicJob[] }).jobs ?? [];
      setJobs(next);
      const activeId = selectedId || next[0]?.jobId || "";
      if (activeId) { setSelectedId(activeId); await loadDetail(activeId); }
      else { setDetail(null); setArtifacts([]); }
      if (!quiet) setMessage("");
    } catch (error) {
      if (!quiet) setMessage(error instanceof Error ? error.message : "任务服务暂时不可用。");
    } finally { setLoading(false); }
  }, [loadDetail, selectedId]);

  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    if (!jobs.some(job => activeStatuses.has(job.status))) return;
    const timer = window.setInterval(() => void refresh(true), 4000);
    return () => window.clearInterval(timer);
  }, [jobs, refresh]);

  const createJob = async () => {
    if (!selectedDatasetId || creating) return;
    setCreating(true); setMessage("");
    const key = idempotency.current.get(selectedDatasetId) ?? `phase-f:${selectedDatasetId}:${crypto.randomUUID()}`;
    idempotency.current.set(selectedDatasetId, key);
    try {
      const response = await fetch("/v1/jobs", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ datasetId: selectedDatasetId, chunkSize: 256 }) });
      const body = await response.json().catch(() => null) as { job?: PascPublicJob } | null;
      if (!response.ok || !body?.job) throw new Error(readError(body, "无法创建大数据任务。"));
      idempotency.current.delete(selectedDatasetId);
      setSelectedId(body.job.jobId); setDetail({ job: body.job, events: [] }); setArtifacts([]);
      setMessage(response.status === 200 ? "已恢复同一幂等任务，没有重复创建。" : "任务已进入持久队列。关闭页面不会中断处理。");
      await refresh(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法创建大数据任务。"); }
    finally { setCreating(false); }
  };

  const cancelJob = async (jobId: string) => {
    setMessage("");
    const response = await fetch(`/v1/jobs/${jobId}/cancel`, { method: "POST", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setMessage(readError(body, "取消请求失败。")); return; }
    setMessage("取消请求已持久化；运行中的任务会在分块边界停止。");
    await refresh(true);
  };

  const selectJob = async (jobId: string) => {
    setSelectedId(jobId); setMessage("");
    try { await loadDetail(jobId); } catch (error) { setMessage(error instanceof Error ? error.message : "任务详情读取失败。"); }
  };

  const selected = detail?.job ?? jobs.find(job => job.jobId === selectedId) ?? null;
  const summary = selected?.summary ?? {};
  return (
    <section className="pasc-job-console" aria-label="PASC-TCN 大数据任务中心">
      <header className="pasc-job-console-head">
        <div><small>PHASE F · DURABLE PIPELINE</small><h2>大数据识别任务</h2><p>原始 CSV 留在私有对象存储；Python 消费者按 256 点分块执行冻结模型，状态、重试与结果可恢复。</p></div>
        <div className="pasc-job-create">
          <label><span>选择已确认映射的数据集</span><select value={selectedDatasetId} onChange={event => setDatasetId(event.target.value)} disabled={!available.length}>{available.length ? available.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name} · {(dataset.qualityReport?.validPoints ?? dataset.pointCount ?? 0).toLocaleString()} 点</option>) : <option>暂无可提交数据集</option>}</select></label>
          <button disabled={!selectedDatasetId || creating} onClick={createJob}>{creating ? "正在创建…" : "创建后台任务"}</button>
        </div>
      </header>
      {!available.length && <div className="pasc-job-boundary"><b>尚不能创建任务</b><span>请先为私有数据集确认经纬度、至少 40 个日期列、单位、正负号和预处理状态。</span></div>}
      {message && <div className="pasc-job-message" role="status">{message}</div>}
      <div className="pasc-job-layout">
        <aside className="pasc-job-list" aria-label="任务列表">
          <div><b>最近任务</b><button onClick={() => void refresh()} disabled={loading}>{loading ? "读取中" : "刷新"}</button></div>
          {!loading && !jobs.length && <p>还没有大数据识别任务。</p>}
          {jobs.map(job => <button key={job.jobId} className={selectedId === job.jobId ? "active" : ""} onClick={() => void selectJob(job.jobId)}><span><b>{job.datasetName}</b><i className={`is-${job.status}`}>{statusLabels[job.status] ?? job.status}</i></span><small>{stageLabels[job.stage] ?? job.stage} · {job.progress.toFixed(1)}%</small><em><i style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}/></em></button>)}
        </aside>
        <div className="pasc-job-detail">
          {!selected && <div className="pasc-job-empty"><b>任务状态会在这里持续更新</b><span>排队、租约恢复、自动重试、取消与结果工件都可追踪。</span></div>}
          {selected && <>
            <div className="pasc-job-status-row"><div><span>{statusLabels[selected.status] ?? selected.status}</span><h3>{selected.datasetName}</h3><code>{selected.jobId}</code></div><b>{selected.progress.toFixed(1)}%</b></div>
            <div className="pasc-job-progress"><i style={{ width: `${Math.max(0, Math.min(100, selected.progress))}%` }}/></div>
            <div className="pasc-job-metrics">
              <article><span>阶段</span><b>{stageLabels[selected.stage] ?? selected.stage}</b><small>{selected.chunks.current} / {selected.chunks.total || "?"} 分块</small></article>
              <article><span>处理点数</span><b>{selected.points.processed.toLocaleString()}</b><small>识别 {selected.points.predicted.toLocaleString()} · 不支持 {selected.points.unsupported.toLocaleString()}</small></article>
              <article><span>执行尝试</span><b>{selected.attempts.current} / {selected.attempts.maximum}</b><small>{selected.retryAt ? `预计 ${new Date(selected.retryAt).toLocaleTimeString("zh-CN")} 重试` : "租约过期可自动恢复"}</small></article>
              <article><span>模型执行器</span><b>{selected.serviceVersion ?? "等待消费者"}</b><small>{selected.modelVersion}</small></article>
            </div>
            {selected.error && <div className="pasc-job-error" role="alert"><b>{selected.error.code}</b><span>{selected.error.message}</span></div>}
            {selected.status === "completed" && <div className="pasc-job-summary"><span>结果摘要</span><b>{Number(summary.predicted ?? selected.points.predicted).toLocaleString()} 点已识别</b><small>低置信度 {Number(summary.lowConfidence ?? 0).toLocaleString()} · 空间受限 {Number(summary.limitedReference ?? 0).toLocaleString()} · 最多仅显示 5,000 个抽样点</small></div>}
            <div className="pasc-job-actions">
              {activeStatuses.has(selected.status) && <button onClick={() => void cancelJob(selected.jobId)} disabled={selected.cancelRequested}>{selected.cancelRequested ? "已请求取消" : "取消任务"}</button>}
              {selected.status === "completed" && <Link className="primary" href={`/map?job=${encodeURIComponent(selected.jobId)}`}>加载多级地图预览 ↗</Link>}
              <button onClick={() => void loadDetail(selected.jobId)}>刷新详情</button>
            </div>
            {artifacts.length > 0 && <details className="pasc-job-artifacts"><summary>结果与审计工件 · {artifacts.length}</summary><div>{artifacts.filter(item => item.kind !== "preprocessed").map(item => <a key={item.id} href={item.downloadUrl}><span><b>{artifactLabels[item.kind] ?? item.kind}{item.chunkIndex >= 0 ? ` · ${item.chunkIndex + 1}` : ""}</b><small>{item.recordCount.toLocaleString()} 条 · {formatBytes(item.sizeBytes)} · SHA {item.sha256.slice(0, 10)}</small></span><i>下载</i></a>)}</div></details>}
            {detail?.events?.length ? <details className="pasc-job-events"><summary>执行时间线 · {detail.events.length}</summary><ol>{detail.events.map((event, index) => <li key={`${event.createdAt}-${index}`}><i/><span><b>{event.message}</b><small>{new Date(event.createdAt).toLocaleString("zh-CN")} · {event.progress.toFixed(1)}%</small></span></li>)}</ol></details> : null}
          </>}
        </div>
      </div>
      <footer><b>数据边界</b><span>任务详情不返回租约、消费者密钥、字段映射或完整时序；地图按缩放级别加载 500 / 2,000 / 5,000 个确定性抽样点。</span></footer>
    </section>
  );
}
