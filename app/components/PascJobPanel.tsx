"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CsvMapping } from "../lib/insar-v2";
import type { PascJobEvent, PascPublicJob } from "../lib/pasc-job-client";

type DatasetOption = { id: string; name: string; pointCount?: number; qualityReport?: { validPoints?: number }; mapping?: CsvMapping; status?: string };
type JobDetail = { job: PascPublicJob; events: PascJobEvent[] };
const activeStatuses = new Set(["queued", "running", "retry_wait", "cancelling"]);
const statusLabels: Record<string, string> = { queued: "排队中", running: "处理中", retry_wait: "等待重试", cancelling: "正在取消", cancelled: "已取消", completed: "已完成", failed: "失败" };
const stageLabels: Record<string, string> = { queued: "持久队列", downloading: "读取私有 CSV", validating: "校验与解析", preprocessing: "生成分批请求", inference: "逐批推理", cancelling: "取消边界", completed: "完成", cancelled: "已取消", failed: "失败" };

function readError(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const error = (body as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return fallback;
}
function eligible(dataset: DatasetOption) {
  const mapping = dataset.mapping;
  return Boolean(mapping?.lon && mapping.lat && mapping.timeCols?.length >= 20 && ["mm", "cm", "m"].includes(String(mapping.displacementUnit)) && ["toward_satellite_positive", "away_from_satellite_positive"].includes(String(mapping.signConvention)) && ["raw", "already_smoothed"].includes(String(mapping.preprocessingState)));
}

export function PascJobPanel({ datasets }: { datasets: DatasetOption[] }) {
  const available = useMemo(() => datasets.filter(eligible), [datasets]);
  const [datasetId, setDatasetId] = useState("");
  const [jobs, setJobs] = useState<PascPublicJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");
  const selectedDatasetId = datasetId || available[0]?.id || "";

  const loadDetail = useCallback(async (jobId: string) => {
    const response = await fetch(`/api/pasc-jobs?op=detail&id=${encodeURIComponent(jobId)}`, { credentials: "include", cache: "no-store" });
    const body = await response.json().catch(() => null) as JobDetail | null;
    if (!response.ok || !body?.job) throw new Error(readError(body, "任务详情读取失败。"));
    setDetail(body);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/pasc-jobs?op=list", { credentials: "include", cache: "no-store" });
      const body = await response.json().catch(() => null) as { jobs?: PascPublicJob[] } | null;
      if (!response.ok) throw new Error(readError(body, "任务列表读取失败。"));
      const next = body?.jobs ?? [];
      setJobs(next);
      const activeId = selectedId || next[0]?.jobId || "";
      if (activeId) { setSelectedId(activeId); await loadDetail(activeId); }
      else setDetail(null);
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
    try {
      const response = await fetch("/api/pasc-jobs?op=create", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ datasetId: selectedDatasetId }) });
      const body = await response.json().catch(() => null) as { job?: PascPublicJob; created?: boolean } | null;
      if (!response.ok || !body?.job) throw new Error(readError(body, "无法创建大数据任务。"));
      setSelectedId(body.job.jobId); setDetail({ job: body.job, events: [] });
      setMessage(body.created === false ? "已恢复该数据集的现有任务，没有重复创建。" : "任务已进入持久队列；关闭页面不会中断。每批最多 500 点，系统会自动串行处理。 ");
      await refresh(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法创建大数据任务。"); }
    finally { setCreating(false); }
  };

  const mutateJob = async (jobId: string, op: "cancel" | "retry") => {
    setMessage("");
    const response = await fetch(`/api/pasc-jobs?op=${op}&id=${encodeURIComponent(jobId)}`, { method: "POST", credentials: "include" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setMessage(readError(body, op === "cancel" ? "取消请求失败。" : "重试请求失败。")); return; }
    setMessage(op === "cancel" ? "取消请求已保存；任务会在当前批次边界停止。" : "任务已重新进入持久队列。已完成的结果分块不会重复计算。");
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
        <div><small>LARGE INSAR · DURABLE QUEUE</small><h2>大数据自动分类</h2><p>适用于上万级监测点：私有 CSV 在服务器端解析，按最多 500 点逐批运行冻结 PASC-TCN，进度与结果持久保存，可自动重试。</p></div>
        <div className="pasc-job-create">
          <label><span>选择已确认映射的数据集</span><select value={selectedDatasetId} onChange={event => setDatasetId(event.target.value)} disabled={!available.length}>{available.length ? available.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name} · {(dataset.qualityReport?.validPoints ?? dataset.pointCount ?? 0).toLocaleString()} 点</option>) : <option>暂无可提交数据集</option>}</select></label>
          <button disabled={!selectedDatasetId || creating} onClick={createJob}>{creating ? "正在创建…" : "开始后台自动分类"}</button>
        </div>
      </header>
      {!available.length && <div className="pasc-job-boundary"><b>尚不能创建任务</b><span>请先为私有数据集确认经纬度、至少 20 个日期列、单位、正负号和预处理状态。</span></div>}
      {message && <div className="pasc-job-message" role="status">{message}</div>}
      <div className="pasc-job-layout">
        <aside className="pasc-job-list" aria-label="任务列表">
          <div><b>最近任务</b><button onClick={() => void refresh()} disabled={loading}>{loading ? "读取中" : "刷新"}</button></div>
          {!loading && !jobs.length && <p>还没有大数据分类任务。</p>}
          {jobs.map(job => <button key={job.jobId} className={selectedId === job.jobId ? "active" : ""} onClick={() => void selectJob(job.jobId)}><span><b>{job.datasetName}</b><i className={`is-${job.status}`}>{statusLabels[job.status] ?? job.status}</i></span><small>{stageLabels[job.stage] ?? job.stage} · {job.progress.toFixed(1)}%</small><em><i style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}/></em></button>)}
        </aside>
        <div className="pasc-job-detail">
          {!selected && <div className="pasc-job-empty"><b>任务状态会在这里持续更新</b><span>上传后的分类由服务器完成，访问者电脑的显卡不会参与模型推理。</span></div>}
          {selected && <>
            <div className="pasc-job-status-row"><div><span>{statusLabels[selected.status] ?? selected.status}</span><h3>{selected.datasetName}</h3><code>{selected.jobId}</code></div><b>{selected.progress.toFixed(1)}%</b></div>
            <div className="pasc-job-progress"><i style={{ width: `${Math.max(0, Math.min(100, selected.progress))}%` }}/></div>
            <div className="pasc-job-metrics">
              <article><span>阶段</span><b>{stageLabels[selected.stage] ?? selected.stage}</b><small>{selected.chunks.current} / {selected.chunks.total || "?"} 批 · 每批 ≤{selected.chunks.size}</small></article>
              <article><span>处理点数</span><b>{selected.points.processed.toLocaleString()}</b><small>识别 {selected.points.predicted.toLocaleString()} · 总候选 {selected.points.total.toLocaleString()}</small></article>
              <article><span>自动重试</span><b>{selected.attempts.current} / {selected.attempts.maximum}</b><small>{selected.retryAt ? `预计 ${new Date(selected.retryAt).toLocaleTimeString("zh-CN")} 重试` : "失败批次按指数退避恢复"}</small></article>
              <article><span>模型执行器</span><b>{selected.serviceVersion ?? "等待服务器"}</b><small>{selected.modelVersion}</small></article>
            </div>
            {selected.error && <div className="pasc-job-error" role="alert"><b>{selected.error.code}</b><span>{selected.error.message}</span></div>}
            {selected.status === "completed" && <div className="pasc-job-summary"><span>结果摘要</span><b>{Number(summary.predicted ?? selected.points.predicted).toLocaleString()} 点已分类</b><small>低置信度 {Number(summary.lowConfidence ?? 0).toLocaleString()} · 空间受限 {Number(summary.limitedReference ?? 0).toLocaleString()} · 完整结果可加载到原始地图</small></div>}
            <div className="pasc-job-actions">
              {activeStatuses.has(selected.status) && <button onClick={() => void mutateJob(selected.jobId, "cancel")} disabled={selected.cancelRequested}>{selected.cancelRequested ? "已请求取消" : "取消任务"}</button>}
              {(selected.status === "failed" || selected.status === "cancelled") && <button onClick={() => void mutateJob(selected.jobId, "retry")}>从已完成批次继续</button>}
              {selected.status === "completed" && <Link className="primary" href={`/map?dataset=${encodeURIComponent(selected.datasetId)}&largeJob=${encodeURIComponent(selected.jobId)}`}>加载完整分类地图 ↗</Link>}
              <button onClick={() => void loadDetail(selected.jobId)}>刷新详情</button>
            </div>
          </>}
        </div>
      </div>
      <footer><b>运行边界</b><span>浏览器只负责上传、显示进度和渲染地图；模型包、服务密钥与批处理均在服务器。当前单任务最多 100,000 个候选点、CSV 256 MB。</span></footer>
    </section>
  );
}