"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { requireAccountSession, useAccountSession } from "../lib/account-session";
import { AccountRequired } from "./AccountRequired";
import { trackEvent } from "../lib/analytics";
import {
  PRIVATE_DATASET_CHUNK_SIZE,
  PrivateDatasetRequestError,
  completePrivateDataset,
  deletePrivateDataset,
  listPrivateDatasets,
  patchPrivateDataset,
  uploadPrivateDatasetChunk,
} from "../lib/private-datasets-client";
import {
  inspectCsv,
  parseMappedCsv,
  type CsvInspection,
  type CsvMapping,
  type DatasetParseResult,
  type QualityReport,
} from "../lib/insar-v2";
import { PascCompatibilityCheck } from "./PascCompatibilityCheck";
import { PascJobPanel } from "./PascJobPanel";
import { PageHero, PageShell } from "./SiteShell";
import { MapWorkspace, type WorkspaceLocalImport } from "./MapWorkspace";
import { PASC_LOCAL_HARD_FILE_BYTES } from "../lib/pasc-local-limits";
import { analyzePascDateColumns, uniqueSortedDateColumns } from "../lib/pasc-schema";
import { LOCAL_DATA_ONLY_MESSAGE, USER_DATA_LOCAL_ONLY } from "../lib/data-processing-policy";

type ImportDecision = "recommended" | "keep-all";
type DatasetMeta = {
  id: string;
  name: string;
  size: number;
  chunks: number;
  uploadedAt: string;
  updatedAt?: string;
  analysisReady: boolean;
  status?: "archived" | "ready";
  schemaStatus?: "pending" | "validated";
  version?: number;
  parentId?: string;
  mapping?: CsvMapping;
  qualityReport?: QualityReport;
  processStatus?: "uploaded" | "mapped" | "validated" | "converted";
  importDecision?: ImportDecision;
  pointCount?: number;
  recommendedFilter?: { coherenceMin: number } | null;
};
type AccountInfo = { userId: string; email: string; roles: string[]; usedBytes: number; maxUserBytes: number; maxFileSize: number; isAdmin: boolean };
type ImportStage = "idle" | "reading" | "mapping" | "quality" | "uploading" | "success" | "error";
type Preflight = { file: File; text?: string; inspection?: CsvInspection; mapping?: CsvMapping; result?: DatasetParseResult; largeFile?: boolean; error?: string };
type DatasetAccountResponse = { items?: DatasetMeta[]; account?: AccountInfo };
type ClassificationResponse = { job?: { jobId?: string }; created?: boolean; error?: { message?: string } };

const DIRECT_ANALYSIS_LIMIT = 300 * 1024 * 1024;
const COHERENCE_LIMIT = 0.75;
const lifecycle = [
  ["01", USER_DATA_LOCAL_ONLY ? "选择数据" : "上传数据", "选择 CSV，原始文件只读检查，不修改任何字段。"],
  ["02", "识别字段", "自动识别经纬度、速率、相干性、模式和时间序列。"],
  ["03", "检查数据", "统计缺测、低相干、重复坐标和无法解析的时间字段。"],
  ["04", "用户确认", USER_DATA_LOCAL_ONLY ? "确认映射及筛选后在本机分析，结果可下载到电脑。" : "确认映射及推荐筛选后，再保存私有数据资产。"],
];
const mappingFields: Array<[keyof Pick<CsvMapping, "lon" | "lat" | "velocity" | "coherence" | "mode">, string, boolean]> = [
  ["lon", "经度", true], ["lat", "纬度", true], ["velocity", "形变速率", false], ["coherence", "相干性", false], ["mode", "形变模式", false],
];

function formatBytes(value = 0) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024).toFixed(1)} KB`;
}
function downloadTemplate() {
  const csv = [
    "point_id,longitude,latitude,velocity,label,coherence,project_name,D20200101,D20200113,D20200125",
    "P-001,110.3284,20.04539,-2.31,Stable,0.91,示例研究区,0,-0.8,-1.1",
    "P-002,110.3385,20.05542,-8.24,Linear,0.89,示例研究区,0,-3.9,-5.1",
  ].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "lanjifyw-insar-template.csv";
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
function enrichQuality(result: DatasetParseResult, inspection: CsvInspection, mapping: CsvMapping, text: string): QualityReport {
  const totalRows = Math.max(0, text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()).length - 1);
  const coordinates = new Set<string>();
  let duplicateCoordinates = 0;
  result.points.forEach((point) => {
    const key = `${point.lon.toFixed(8)},${point.lat.toFixed(8)}`;
    if (coordinates.has(key)) duplicateCoordinates += 1;
    else coordinates.add(key);
  });
  return {
    ...result.quality,
    totalRows,
    validPoints: result.points.length,
    duplicateCoordinates,
    unparsedTimeColumns: inspection.unparsedTimeColumns,
    coherenceProvided: Boolean(mapping.coherence),
  };
}

async function createAutomaticClassification(datasetId: string) {
  if (USER_DATA_LOCAL_ONLY) throw new Error(LOCAL_DATA_ONLY_MESSAGE);
  const response = await fetch("/api/pasc-jobs?op=create", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ datasetId }),
  });
  const text = await response.text();
  let body: ClassificationResponse | null = null;
  try { body = text ? JSON.parse(text) as ClassificationResponse : null; } catch { body = null; }
  if (!response.ok || !body?.job?.jobId) {
    throw new Error(body?.error?.message || `后台分类任务创建失败（HTTP ${response.status}）。`);
  }
  return body;
}

export function DatasetPage() {
  return <AccountRequired><DatasetPageContent /></AccountRequired>;
}
function DatasetPageContent() {
  const { user, logout } = useAccountSession();
  const [items, setItems] = useState<DatasetMeta[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<ImportStage>("idle");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [decision, setDecision] = useState<ImportDecision | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importedDatasetId, setImportedDatasetId] = useState("");
  const [replaceParent, setReplaceParent] = useState<DatasetMeta | null>(null);
  const [report, setReport] = useState<DatasetMeta | null>(null);
  const [serviceError, setServiceError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failedStage, setFailedStage] = useState<ImportStage | null>(null);
  const [uploadError, setUploadError] = useState<Error | null>(null);
  const [localImport, setLocalImport] = useState<WorkspaceLocalImport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stateCardRef = useRef<HTMLDivElement>(null);
  const refreshRun = useRef(0);
  const uploadInFlight = useRef(false);
  const uploadAttempt = useRef<{ file: File; parentId?: string; datasetId: string } | null>(null);

  const refresh = async () => {
    if (USER_DATA_LOCAL_ONLY) return { error: new Error(LOCAL_DATA_ONLY_MESSAGE) };
    const run = ++refreshRun.current;
    setRefreshing(true);
    try {
      const data = await listPrivateDatasets<DatasetAccountResponse>();
      if (!Array.isArray(data.items) || !data.account || !Number.isFinite(data.account.maxFileSize) || !Number.isFinite(data.account.maxUserBytes) || !Number.isFinite(data.account.usedBytes)) throw new Error("云端数据服务未返回有效账户信息，请稍后重试。");
      if (run === refreshRun.current) {
        setItems([...data.items].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)));
        setAccount(data.account);
        setServiceError(null);
      }
      return { data };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("私有数据服务暂时不可用，请稍后重试。");
      if (run === refreshRun.current) setServiceError(failure);
      return { error: failure };
    } finally {
      if (run === refreshRun.current) setRefreshing(false);
    }
  };
  useEffect(() => {
    if (!USER_DATA_LOCAL_ONLY && user) void refresh();
    // Cloud dataset reads remain disabled under the local-only data policy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!preflight || stage === "success") return;
    const confirmLeave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", confirmLeave);
    return () => window.removeEventListener("beforeunload", confirmLeave);
  }, [preflight, stage]);
  useEffect(() => {
    if (!localImport && (stage === "error" || stage === "success")) stateCardRef.current?.focus();
  }, [stage, localImport]);

  const quality = preflight?.result?.quality;
  const detectedDates = useMemo(() => preflight?.inspection ? uniqueSortedDateColumns(preflight.inspection.dateAnalysis) : [], [preflight]);
  const selectedDates = useMemo(() => preflight?.inspection && preflight.mapping ? uniqueSortedDateColumns(analyzePascDateColumns(preflight.inspection.headers, preflight.mapping.timeCols)) : [], [preflight]);
  const displayedStage = stage === "error" ? failedStage : stage;
  const currentStep = displayedStage === "mapping" || displayedStage === "reading" ? 2 : displayedStage === "quality" ? 3 : displayedStage === "uploading" || displayedStage === "success" ? 4 : 1;
  const lowRatio = quality?.validPoints ? quality.lowCoherence / quality.validPoints : 0;
  const canConfirmMapping = Boolean(preflight?.mapping?.lon && preflight.mapping.lat && preflight.mapping.displacementUnit && preflight.mapping.displacementUnit !== "unknown" && (!preflight.mapping.velocity || (preflight.mapping.velocityUnit && preflight.mapping.velocityUnit !== "unknown")) && preflight.mapping.signConvention && preflight.mapping.signConvention !== "unknown" && preflight.mapping.preprocessingState && preflight.mapping.preprocessingState !== "unknown");
  const accountName = String(user?.name || user?.email || "访客");
  const usage = account ? Math.min(100, account.usedBytes / account.maxUserBytes * 100) : 0;

  const resetImport = () => {
    setPreflight(null);
    setStage("idle");
    setDecision(null);
    setProgress(0);
    setMessage("");
    setImportedDatasetId("");
    setReplaceParent(null);
    setFailedStage(null);
    setUploadError(null);
    uploadAttempt.current = null;
    if (fileRef.current) fileRef.current.value = "";
  };
  const prepareFile = async (file?: File) => {
    if (!file) return;
    if (!await requireAccountSession()) return;
    setMessage("");
    setDecision(null);
    setFailedStage(null);
    setUploadError(null);
    uploadAttempt.current = null;
    if (!/\.csv$/i.test(file.name)) {
      setPreflight({ file, error: "仅支持 CSV 文件" }); setStage("error"); return;
    }
    if (file.size > DIRECT_ANALYSIS_LIMIT) {
      setPreflight({ file, largeFile: true });
      setStage("quality");
      return;
    }
    setStage("reading");
    try {
      const text = await file.text();
      const inspection = inspectCsv(text);
      setPreflight({ file, text, inspection, mapping: { ...inspection.mapping, timeCols: [...inspection.mapping.timeCols] } });
      setStage("mapping");
    } catch (error) {
      setPreflight({ file, error: error instanceof Error ? error.message : "CSV 读取失败" });
      setStage("error");
    }
  };
  const updateMapping = (field: keyof Pick<CsvMapping, "lon" | "lat" | "velocity" | "coherence" | "mode">, value: string) => {
    setPreflight((current) => current?.mapping ? { ...current, mapping: { ...current.mapping, [field]: value } } : current);
  };
  const toggleTimeField = (header: string) => {
    setPreflight((current) => {
      if (!current?.mapping) return current;
      const selected = current.mapping.timeCols.includes(header);
      const changed = selected ? current.mapping.timeCols.filter((field) => field !== header) : [...current.mapping.timeCols, header];
      const parsed = analyzePascDateColumns(current.inspection?.headers ?? [], changed).sorted.map(date => date.original);
      const parsedFields = new Set(parsed);
      // Retain unparseable manual choices so confirmation can explain the error.
      const timeCols = [...parsed, ...changed.filter(field => !parsedFields.has(field))];
      return { ...current, mapping: { ...current.mapping, timeCols } };
    });
  };
  const confirmMapping = async () => {
    if (!preflight?.text || !preflight.mapping || !preflight.inspection) return;
    if (!await requireAccountSession()) return;
    try {
      const parsed = parseMappedCsv(preflight.text, preflight.file.name, preflight.mapping, true);
      parsed.datasetTitle = preflight.file.name;
      parsed.quality = enrichQuality(parsed, preflight.inspection, preflight.mapping, preflight.text);
      trackEvent("dataset_loaded", { dataset_type: "local_preflight", point_count: parsed.points.length, period_count: parsed.periods, invalid_count: parsed.invalid });
      setPreflight({ ...preflight, result: parsed });
      setStage("quality");
      setDecision(null);
    } catch (error) {
      setPreflight({ ...preflight, error: error instanceof Error ? error.message : "字段映射检查失败" });
      setFailedStage("mapping");
      setStage("error");
    }
  };
  const uploadOriginal = async (choice: ImportDecision) => {
    if (USER_DATA_LOCAL_ONLY) { setMessage(LOCAL_DATA_ONLY_MESSAGE); return; }
    if (!preflight?.file || !user || uploadInFlight.current) return;
    uploadInFlight.current = true;
    const file = preflight.file;
    const parentId = replaceParent?.id;
    let chunks = 0;
    setDecision(choice);
    setStage("uploading");
    setMessage(`正在保存原始文件 ${file.name}`);
    setProgress(0);
    setUploadError(null);
    try {
      const readiness = await refresh();
      if (readiness.error) throw readiness.error;
      const currentAccount = readiness.data?.account;
      if (!currentAccount) throw new Error("云端账户信息不可用，请稍后重试。");
      if (file.size > currentAccount.maxFileSize) throw new Error(`单个文件超过 ${formatBytes(currentAccount.maxFileSize)} 限制。`);
      const existingAttempt = uploadAttempt.current;
      const alreadySaved = readiness.data?.items?.find(item => item.id === existingAttempt?.datasetId);
      if (currentAccount.usedBytes + (alreadySaved ? 0 : file.size) > currentAccount.maxUserBytes) throw new Error("账户容量不足，请清理云端空间或使用本机分析。");
      if (!existingAttempt || existingAttempt.file !== file || existingAttempt.parentId !== parentId) uploadAttempt.current = { file, parentId, datasetId: crypto.randomUUID() };
      const datasetId = uploadAttempt.current!.datasetId;
      const partSize = PRIVATE_DATASET_CHUNK_SIZE;
      chunks = Math.ceil(file.size / partSize);
      trackEvent("dataset_upload_start", { source: "private_storage", file_size_bytes: file.size, chunk_count: chunks, replaces_version: Boolean(parentId) });
      try { localStorage.setItem("lanjifyw-upload-session", JSON.stringify({ id: datasetId, name: file.name, size: file.size, chunks, parentId, startedAt: new Date().toISOString() })); } catch { /* Optional session marker must not block saving. */ }
      for (let index = 0; !alreadySaved && index < chunks; index += 1) {
        const body = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize));
        await uploadPrivateDatasetChunk(datasetId, index, body);
        setProgress(Math.round(((index + 1) / chunks) * 86));
      }
      await completePrivateDataset<{ ok: true; item: DatasetMeta }>(datasetId, {
        name: file.name,
        size: file.size,
        chunks,
        parentId,
        analysisReady: file.size <= DIRECT_ANALYSIS_LIMIT && Boolean(preflight.result),
        mapping: preflight.mapping,
        qualityReport: quality,
        importDecision: choice,
        recommendedFilter: choice === "recommended" ? { coherenceMin: COHERENCE_LIMIT } : null,
      });
      setProgress(92);
      const supportsAutomaticClassification = Boolean(preflight.mapping?.timeCols?.length && preflight.mapping.timeCols.length >= 20 && (quality?.validPoints ?? 0) > 0);
      let completionMessage = parentId ? "新版本已保存，旧版本未被覆盖。" : "数据已按当前账户私有保存。";
      if (supportsAutomaticClassification) {
        setMessage("原始 CSV 已保存，正在自动创建后台分类任务…");
        try {
          const classification = await createAutomaticClassification(datasetId);
          completionMessage += classification.created === false
            ? " 已恢复该数据集的现有后台分类任务。"
            : " 后台分类已自动启动，关闭页面不会中断。";
        } catch (classificationError) {
          completionMessage += ` 自动分类未能启动：${classificationError instanceof Error ? classificationError.message : "后台服务暂时不可用"}，可在下方任务中心重试。`;
        }
      } else {
        completionMessage += " 当前数据不足 20 个有效观测期，未启动 PASC-TCN 自动分类。";
      }
      setProgress(100);
      setImportedDatasetId(datasetId);
      setStage("success");
      setMessage(completionMessage);
      trackEvent("dataset_upload_success", { source: "private_storage", file_size_bytes: file.size, chunk_count: chunks, point_count: quality?.validPoints ?? null });
      try { localStorage.removeItem("lanjifyw-upload-session"); } catch { /* The confirmed cloud save remains successful. */ }
      await refresh();
    } catch (error) {
      trackEvent("dataset_upload_fail", { source: "private_storage", reason: "storage_or_network_failed", file_size_bytes: file.size, chunk_count: chunks });
      setPreflight({ ...preflight, error: error instanceof Error ? error.message : "上传失败" });
      setUploadError(error instanceof Error ? error : new Error("上传失败"));
      setFailedStage("uploading");
      setStage("error");
    } finally {
      uploadInFlight.current = false;
    }
  };
  const chooseDecision = async (choice: ImportDecision) => {
    if (!await requireAccountSession()) return;
    setDecision(choice);
    if (USER_DATA_LOCAL_ONLY) {
      if (preflight?.result?.points.length) setLocalImport({ file: preflight.file, inspection: preflight.inspection, mapping: preflight.mapping, result: preflight.result, coherenceMin: choice === "recommended" ? COHERENCE_LIMIT : undefined });
      return;
    }
    if (user) uploadOriginal(choice);
    else setMessage("本地质检已完成。登录后可保存原始 CSV、字段映射和筛选偏好。浏览器未上传文件。\n");
  };
  const openLocalAnalysis = async () => {
    if (!preflight || (!preflight.result?.points.length && !preflight.largeFile) || (!USER_DATA_LOCAL_ONLY && preflight.file.size > PASC_LOCAL_HARD_FILE_BYTES)) return;
    if (!await requireAccountSession()) return;
    setLocalImport({ file: preflight.file, inspection: preflight.inspection, mapping: preflight.mapping, result: preflight.result, coherenceMin: decision === "recommended" ? COHERENCE_LIMIT : undefined });
  };
  const updateDataset = async (item: DatasetMeta, patch: Partial<DatasetMeta>) => {
    if (USER_DATA_LOCAL_ONLY) { setMessage(LOCAL_DATA_ONLY_MESSAGE); return; }
    try {
      await patchPrivateDataset(item.id, patch as Record<string, unknown>);
      setMessage("数据集信息已更新"); setRenaming(null); await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "更新失败"); }
  };
  const remove = async (id: string) => {
    if (USER_DATA_LOCAL_ONLY) { setMessage(LOCAL_DATA_ONLY_MESSAGE); return; }
    if (!confirm("确认删除这个私有数据集及其全部分块？此操作不可恢复。")) return;
    try { await deletePrivateDataset(id); setMessage("数据集已删除"); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); }
  };
  const signOut = async () => { await logout(); window.location.href = "/login"; };

  if (localImport) return <div className="map-route-shell"><MapWorkspace initialImport={localImport} onReturnToImport={() => setLocalImport(null)} /></div>;
  return <PageShell>
    <PageHero eyebrow="DATA ONBOARDING" title="InSAR 数据接入与质量检查" description={USER_DATA_LOCAL_ONLY ? `当前账户：${accountName}。所有 CSV 均在访问者自己的电脑处理。小文件可先检查字段，大文件进入本机分块分析；不会上传云端或创建服务器分类任务。` : user ? `当前账户：${accountName}。字段识别、质量检查与保存确认，为形变分析和核查目标筛选提供数据基础；原始 CSV 保持不变。` : "请登录后导入个人数据。"}/>
    <section className="section dataset-layout phase-six-datasets">
      <aside>
        <b>数据空间</b><Link className="active" href="/datasets">{USER_DATA_LOCAL_ONLY ? "本机数据导入" : <>我的数据集 <span>{items.length}</span></>}</Link><Link href="/map">地图工作台</Link><Link href="/statistics">区域统计</Link><Link href="/platform">存储架构</Link>
        {user ? <button onClick={signOut}>退出登录</button> : <Link href="/login">登录 / 注册</Link>}
      </aside>
      <div>
        {USER_DATA_LOCAL_ONLY && <div className="phase-six-guest-banner"><b>已登录 · 本机数据模式</b><span>账户用于访问管理，文件与计算留在当前电脑，云端存储和后台分类已关闭。本机缓存按浏览器与网站域名隔离，换域名或清理浏览器后需重新选择原始文件；请及时下载结果。</span></div>}
        {!USER_DATA_LOCAL_ONLY && user && serviceError && <div className="raw-data-boundary" role="status"><b>云端数据空间暂不可用</b><span>{serviceError.message} 本地字段检查和地图分析仍可继续。</span><button type="button" className="button ghost" disabled={refreshing || stage === "uploading"} onClick={() => void refresh()}>{refreshing ? "正在检查连接…" : "重试云端连接"}</button></div>}
        {!USER_DATA_LOCAL_ONLY && user && account && <div className="account-strip">
          <article><span>账户隔离</span><b>{account.isAdmin ? "管理员" : "普通用户"}</b><small>{account.email}</small></article>
          <article><span>容量使用</span><b>{formatBytes(account.usedBytes)} / {formatBytes(account.maxUserBytes)}</b><i><em style={{ width: `${usage}%` }}/></i></article>
          <article><span>文件限制</span><b>{formatBytes(account.maxFileSize)}</b><small>超过 300 MB 转后台流式处理</small></article>
        </div>}

        <div className="dataset-import-workflow">
          <div className="import-stepper" aria-label="CSV 导入进度">
            {lifecycle.map(([number, title], index) => <div className={currentStep >= index + 1 ? "active" : ""} key={number}><b>{number}</b><span>{title}</span></div>)}
          </div>
          {(stage === "idle" || stage === "reading") && <div className="upload-zone phase-six-upload">
            <img src="/insar-satellite-v2.png" alt=""/><span className="eyebrow">NON-DESTRUCTIVE IMPORT</span>
            <h2>{replaceParent ? `创建新版本：${replaceParent.name}` : "选择 InSAR CSV 开始检查"}</h2>
            <p>{USER_DATA_LOCAL_ONLY ? "文件只在当前电脑读取，确认设置后再开始本机分析。不会上传原始 CSV、静默删除行或覆盖原文件。" : "系统先在本地识别字段和检查质量，只有用户确认后才保存。不会静默删除行、覆盖原文件或修改字段。"}</p>
            <button className="button primary" disabled={stage === "reading"} onClick={() => fileRef.current?.click()}>{stage === "reading" ? "正在读取…" : "选择 CSV"}</button>
            <button className="button ghost" onClick={downloadTemplate}>下载 CSV 模板</button>
            {replaceParent && <button className="button ghost" onClick={resetImport}>取消新版本</button>}
            <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => prepareFile(event.target.files?.[0])}/>
            <small>日期列会自动识别并按时间排序，支持 D20240101、D_20240101、20240101、D_2024-01-01 等表头。必需：经度、纬度；速率可选，缺失时按逐点真实日期最小二乘计算。Level 2 需要至少 2 个时间值，Level 3 PASC 候选需要至少 20 个；20—39 期仅供探索性判读。</small>
          </div>}

          {stage === "mapping" && preflight?.inspection && preflight.mapping && <div className="field-recognition-panel">
            <div className="quality-status"><span className="eyebrow">FIELD RECOGNITION</span><b>已读取 {preflight.file.name}</b><small>{formatBytes(preflight.file.size)} · 共 {preflight.inspection.headers.length} 个字段</small></div>
            <div className="recognition-grid">
              <article><span>经纬度</span><b>{preflight.mapping.lon && preflight.mapping.lat ? "已识别" : "需要确认"}</b><small>{preflight.mapping.lon || "—"} / {preflight.mapping.lat || "—"}</small></article>
              <article><span>时间序列</span><b>已自动找到 {detectedDates.length} 期</b><small>{detectedDates.length ? `${detectedDates[0].canonical} 至 ${detectedDates.at(-1)!.canonical}` : "未找到可解析的日期列"}</small></article>
              <article><span>形变速率</span><b>{preflight.mapping.velocity || "未提供"}</b><small>可选；可由真实日期计算</small></article>
              <article><span>相干性</span><b>{preflight.mapping.coherence || "未提供"}</b><small>可选质量字段</small></article>
            </div>
            <h3>确认字段映射</h3>
            <div className="mapping-confirm-grid">
              {mappingFields.map(([field, label, required]) => <label key={field}><span>{label}{required && <i>必需</i>}</span><select value={preflight.mapping?.[field] || ""} onChange={(event) => updateMapping(field, event.target.value)}><option value="">{required ? "请选择字段" : "不使用"}</option>{preflight.inspection?.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}
            </div>
            <div className="mapping-confirm-grid pasc-contract-confirm-grid">
              <label><span>形变单位<i>必需</i></span><select value={preflight.mapping.displacementUnit ?? "unknown"} onChange={(event) => setPreflight({ ...preflight, mapping: { ...preflight.mapping!, displacementUnit: event.target.value as CsvMapping["displacementUnit"] } })}><option value="unknown">请选择</option><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
              <label><span>速率单位{preflight.mapping.velocity && <i>必需</i>}</span><select value={preflight.mapping.velocityUnit ?? "unknown"} onChange={(event) => setPreflight({ ...preflight, mapping: { ...preflight.mapping!, velocityUnit: event.target.value as CsvMapping["velocityUnit"] } })}><option value="unknown">未提供 / 请选择</option><option value="mm/year">mm/year</option><option value="cm/year">cm/year</option><option value="m/year">m/year</option></select></label>
              <label><span>形变正负号<i>必需</i></span><select value={preflight.mapping.signConvention ?? "unknown"} onChange={(event) => setPreflight({ ...preflight, mapping: { ...preflight.mapping!, signConvention: event.target.value as CsvMapping["signConvention"] } })}><option value="unknown">请选择</option><option value="toward_satellite_positive">朝卫星为正</option><option value="away_from_satellite_positive">远离卫星为正</option></select></label>
              <label><span>预处理状态<i>必需</i></span><select value={preflight.mapping.preprocessingState ?? "unknown"} onChange={(event) => setPreflight({ ...preflight, mapping: { ...preflight.mapping!, preprocessingState: event.target.value as CsvMapping["preprocessingState"] } })}><option value="unknown">请选择</option><option value="raw">raw</option><option value="already_smoothed">already_smoothed</option></select></label>
            </div>
            <small className="mapping-contract-note">单位、正负号和预处理状态必须由用户确认，系统不按数值大小猜测。</small>
            <div className="time-field-confirm"><span>累计形变时间列</span><b>{selectedDates.length} 期 / {preflight.mapping.timeCols.length} 列已选择</b><small>{selectedDates.length ? `${selectedDates[0].canonical} 至 ${selectedDates.at(-1)!.canonical} · ` : "无有效日期 · "}{preflight.mapping.timeCols.slice(0, 10).join("、")}{preflight.mapping.timeCols.length > 10 ? " …" : ""}</small></div>
            <small className="mapping-contract-note">可手动增减时间字段，日期将按时间先后排列。当前仅识别字段；确认前不会运行分类或上传文件。</small>
            <details className="time-field-picker"><summary>手动增减时间字段</summary><div>{preflight.inspection.headers.map((header) => <label key={header}><input type="checkbox" checked={preflight.mapping?.timeCols.includes(header) || false} onChange={() => toggleTimeField(header)}/><span>{header}</span></label>)}</div></details>
            {preflight.inspection.warnings.length > 0 && <div className="dataset-inline-error">{preflight.inspection.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
            <div className="workflow-actions"><button className="button ghost" onClick={resetImport}>重新选择</button><button className="button primary" disabled={!canConfirmMapping} onClick={confirmMapping}>确认映射并检查数据</button></div>
          </div>}

          {stage === "quality" && preflight?.largeFile && <div className="large-file-review">
            <span className="eyebrow">LARGE FILE ROUTE</span><h2>{USER_DATA_LOCAL_ONLY ? "大文件在本机分块分析" : "大文件需要后台流式质检"}</h2><p>{preflight.file.name} · {formatBytes(preflight.file.size)}</p>
            <p>{USER_DATA_LOCAL_ONLY ? "为避免一次性占满内存，此处不整文件读取。继续后由本机分析面板读取表头，确认设置后分块处理；资源检查也在当前浏览器完成，不会转交云端。" : "浏览器不会一次读取超过 300 MB 的 CSV。生产流程应分片上传原始文件，再由后台逐行识别字段、生成质检报告并转换为 GeoParquet / PostGIS / PMTiles。"}</p>
            <div className="raw-data-boundary"><b>当前阶段未执行质检</b><span>尚未完整读取文件，不会把“未检查”显示成“检查通过”。请在本机分析面板核对字段与处理结果。</span></div>
            <div className="workflow-actions"><button className="button ghost" onClick={resetImport}>重新选择</button>{USER_DATA_LOCAL_ONLY ? <button className="button primary" type="button" onClick={openLocalAnalysis}>继续本机分块分析</button> : user ? <button className="button primary" onClick={() => uploadOriginal("keep-all")}>仅归档原始 CSV</button> : <Link className="button primary" href="/login">登录后归档</Link>}</div>
            {!USER_DATA_LOCAL_ONLY && preflight.file.size <= PASC_LOCAL_HARD_FILE_BYTES && <div className="workflow-actions"><button className="button ghost" type="button" onClick={openLocalAnalysis}>使用此文件进行本机分析</button></div>}
          </div>}

          {stage === "quality" && quality && <div className="quality-review-panel">
            <div className="quality-status"><span className="eyebrow">DATA QUALITY REVIEW</span><b>字段映射完成，等待用户确认</b><small>{preflight?.file.name} · 原始文件尚未修改</small></div>
            <div className="quality-metric-grid">
              <article><span>总监测行 / 有效点</span><b>{quality.totalRows?.toLocaleString()} / {quality.validPoints?.toLocaleString()}</b><small>过滤无效记录 {quality.invalid}</small></article>
              <article><span>时间序列缺测率</span><b>{(quality.missingRate * 100).toFixed(2)}%</b><small>{quality.timeColumns.length} 期已识别</small></article>
              <article><span>低相干点</span><b>{quality.coherenceProvided ? quality.lowCoherence.toLocaleString() : "未提供"}</b><small>{quality.coherenceProvided ? `< ${COHERENCE_LIMIT} · ${(lowRatio * 100).toFixed(1)}%` : "无法执行相干性筛选"}</small></article>
              <article><span>重复坐标</span><b>{quality.duplicateCoordinates?.toLocaleString()}</b><small>仅报告，不自动删除</small></article>
              <article><span>无法解析时间字段</span><b>{quality.unparsedTimeColumns?.length || 0}</b><small>{quality.unparsedTimeColumns?.slice(0, 3).join("、") || "未发现"}</small></article>
              <article><span>速率离群值</span><b>{quality.outlierVelocity}</b><small>采用 IQR 统计提示</small></article>
            </div>
            <PascCompatibilityCheck summary={quality.compatibility} />
            {quality.coherenceProvided && quality.lowCoherence > 0 ? <div className="recommendation-card">
              <div><span className="eyebrow">RECOMMENDATION</span><h3>检测到 {quality.lowCoherence} 个低相干点</h3><p>建议在地图分析中默认过滤相干性低于 {COHERENCE_LIMIT} 的点。该选择只保存为分析偏好，不会删除原始行。</p></div>
              <button className={`button ${decision === "recommended" ? "primary" : "ghost"}`} onClick={() => chooseDecision("recommended")}>{USER_DATA_LOCAL_ONLY ? "应用推荐筛选并看图" : "应用推荐筛选"}</button>
              <button className={`button ${decision === "keep-all" ? "primary" : "ghost"}`} onClick={() => chooseDecision("keep-all")}>{USER_DATA_LOCAL_ONLY ? "保留全部数据并看图" : "保留全部数据"}</button>
            </div> : <div className="recommendation-card"><div><span className="eyebrow">RECOMMENDATION</span><h3>{quality.coherenceProvided ? "未发现低相干点" : "CSV 未提供相干性字段"}</h3><p>{quality.coherenceProvided ? "无需应用低相干筛选，可保留全部有效点。" : "系统不会虚构质量结论；后续仍可补充 coherence 字段重新导入。"}</p></div><button className="button primary" onClick={() => chooseDecision("keep-all")}>{USER_DATA_LOCAL_ONLY ? "确认并在本机看图" : "确认并保留有效数据"}</button></div>}
            <div className="raw-data-boundary"><b>数据边界</b><span>{USER_DATA_LOCAL_ONLY ? "原始 CSV 保留在当前电脑；无效行、重复坐标、低相干点仅进入本机报告和筛选配置，不上传或静默删除。" : "原始 CSV 原样保存；无效行、重复坐标、低相干点仅进入报告和筛选配置，不静默删除。"}</span></div>
            {(preflight?.result?.errors.length || quality.warnings.length) > 0 && <details className="quality-error-report"><summary>查看错误与质量提示</summary><div>{preflight?.result?.errors.slice(0, 12).map((error) => <span key={error}>{error}</span>)}{quality.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div></details>}
            {!USER_DATA_LOCAL_ONLY && !user && decision && <div className="workflow-actions"><button className="button ghost" onClick={() => setStage("mapping")}>返回修改映射</button><Link className="button primary" href="/login">登录并保存结果</Link></div>}
            {Boolean(preflight?.result?.points.length) && <div className="workflow-actions"><button className="button ghost" type="button" onClick={openLocalAnalysis}>使用此文件进行本机分析</button><small>保留当前文件与字段映射，无需云端保存。</small></div>}
          </div>}

          {stage === "uploading" && <div className="dataset-state-card loading"><span className="eyebrow">PRIVATE UPLOAD</span><h2>正在保存原始 CSV 与质检元数据</h2><p>{message}</p><div className="upload-progress"><i style={{ width: `${progress}%` }}/><span>{progress}%</span></div></div>}
          {stage === "success" && <div className="dataset-state-card success" ref={stateCardRef} tabIndex={-1}><span className="eyebrow">IMPORT COMPLETE</span><h2>数据接入完成</h2><p>{message}</p><div className="workflow-actions"><button className="button ghost" onClick={resetImport}>继续导入</button><a className="button primary" href="#pasc-job-console">查看实时分类进度</a><Link className="button ghost" href={importedDatasetId ? `/map?dataset=${encodeURIComponent(importedDatasetId)}` : "/map"}>进入地图查看数据</Link></div></div>}
          {stage === "error" && <div className="dataset-state-card error" role="alert" ref={stateCardRef} tabIndex={-1}><span className="eyebrow">{failedStage === "uploading" ? "CLOUD SAVE INCOMPLETE" : "IMPORT ERROR"}</span><h2>{failedStage === "uploading" ? "云端保存未完成" : "本次导入未完成"}</h2><p>{preflight?.error || "请检查文件后重试"}</p>
            {failedStage === "uploading" && <p>已保留当前文件、字段映射和质检结果。云端保存尚未确认完成，请保留此页面后重试，或继续本机分析。</p>}
            {uploadError instanceof PrivateDatasetRequestError && <small>错误代码：{uploadError.code}{uploadError.requestId ? ` · 请求编号：${uploadError.requestId}` : ""}</small>}
            <div className="workflow-actions">
              {failedStage === "uploading" && user && <button type="button" className="button primary" onClick={() => void uploadOriginal(decision ?? "keep-all")}>重试云端保存</button>}
              {failedStage === "uploading" && uploadError instanceof PrivateDatasetRequestError && uploadError.status === 401 && <a className="button ghost" href="/login" target="_blank" rel="noopener noreferrer">在新标签页重新登录</a>}
              {(preflight?.result?.points.length || preflight?.largeFile) && (USER_DATA_LOCAL_ONLY || preflight.file.size <= PASC_LOCAL_HARD_FILE_BYTES) ? <button type="button" className="button ghost" onClick={openLocalAnalysis}>使用此文件进行本机分析</button> : null}
              {failedStage === "uploading" && <button type="button" className="button ghost" onClick={() => { setStage("quality"); setUploadError(null); }}>返回质检结果</button>}
              {failedStage === "mapping" && <button type="button" className="button primary" onClick={() => setStage("mapping")}>返回修改字段映射</button>}
              <button type="button" className="button ghost" onClick={resetImport}>重新选择文件</button>
            </div>
          </div>}
        </div>

        <div className="product-checklist phase-six-flow"><span className="eyebrow">DATA WORKFLOW</span><h2>数据接入流程</h2>{lifecycle.map(([number, title, description]) => <article key={number}><b>{number}</b><span>{title}</span><small>{description}</small></article>)}</div>

        {!USER_DATA_LOCAL_ONLY && user && <PascJobPanel datasets={items} />}

        {!USER_DATA_LOCAL_ONLY && user && <div className="dataset-table private-table product-table">
          <div><b>数据集名称</b><b>流程状态</b><b>质检摘要</b><b>文件大小</b><b>操作</b></div>
          {items.length === 0 && <div className="empty-dataset">当前账户还没有保存的数据集。可以先上传海口示例 CSV 或自己的 InSAR 点数据。</div>}
          {items.map((item) => <div key={item.id}>
            <span>{renaming === item.id ? <input className="rename-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)}/> : <strong>{item.name}</strong>}<small>v{item.version || 1} · {new Date(item.uploadedAt).toLocaleString("zh-CN")} · {item.id.slice(0, 8)}</small></span>
            <span><i className={item.analysisReady ? "ready" : "archived"}>{item.processStatus || "uploaded"}</i><small>{item.mapping ? "字段映射已保存" : "待字段映射"}</small></span>
            <span><b>{item.qualityReport ? `${item.qualityReport.invalid} 无效行` : "待质检"}</b><small>{item.qualityReport ? `缺测 ${(item.qualityReport.missingRate * 100).toFixed(1)}% · 低相干 ${item.qualityReport.lowCoherence} · ${item.importDecision === "recommended" ? "推荐筛选" : "保留全部"}` : "尚未生成报告"}</small></span>
            <span>{formatBytes(item.size)}<small>{item.chunks} 个分块 · {item.analysisReady ? "可在线分析" : "仅归档"}</small></span>
            <span className="dataset-actions">{item.analysisReady && <Link href={`/map?dataset=${item.id}`}>打开</Link>}{renaming === item.id ? <button onClick={() => updateDataset(item, { name: renameValue })}>保存</button> : <button onClick={() => { setRenaming(item.id); setRenameValue(item.name); }}>重命名</button>}<button onClick={() => { resetImport(); setReplaceParent(item); fileRef.current?.click(); }}>重新导入</button><button onClick={() => setReport(item)}>质检</button><button onClick={() => remove(item.id)}>删除</button></span>
          </div>)}
        </div>}
      </div>
    </section>
    {report && <div className="config-backdrop" onMouseDown={() => setReport(null)}><section className="config-dialog" onMouseDown={(event) => event.stopPropagation()}><button className="dialog-close" onClick={() => setReport(null)}>×</button><span className="eyebrow">QUALITY REPORT</span><h2>{report.name}</h2>{report.qualityReport ? <><div className="report-metrics"><article><b>{report.qualityReport.validPoints ?? "—"}</b><span>有效点</span></article><article><b>{(report.qualityReport.missingRate * 100).toFixed(1)}%</b><span>缺测率</span></article><article><b>{report.qualityReport.lowCoherence}</b><span>低相干点</span></article><article><b>{report.qualityReport.duplicateCoordinates ?? 0}</b><span>重复坐标</span></article></div><div className="quality-detail"><b>时间列识别</b><p>{report.qualityReport.timeColumns.slice(0, 12).join("、")}{report.qualityReport.timeColumns.length > 12 ? " …" : ""}</p><b>导入确认</b><span>{report.importDecision === "recommended" ? `默认过滤相干性 < ${report.recommendedFilter?.coherenceMin ?? COHERENCE_LIMIT}` : "保留全部有效数据"}</span></div></> : <p className="success-report">该数据集尚未生成质检报告，原始文件不会因此被修改。</p>}</section></div>}
  </PageShell>;
}
