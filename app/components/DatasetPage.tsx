"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getSession, signOut as logout, type AuthUser } from "../lib/auth-client";
import { trackEvent } from "../lib/analytics";
import {
  inspectCsv,
  parseMappedCsv,
  type CsvInspection,
  type CsvMapping,
  type DatasetParseResult,
  type QualityReport,
} from "../lib/insar";
import { PageHero, PageShell } from "./SiteShell";

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
  recommendedFilter?: { coherenceMin: number } | null;
};
type AccountInfo = { userId: string; email: string; roles: string[]; usedBytes: number; maxUserBytes: number; maxFileSize: number; isAdmin: boolean };
type ImportStage = "idle" | "reading" | "mapping" | "quality" | "uploading" | "success" | "error";
type Preflight = { file: File; text?: string; inspection?: CsvInspection; mapping?: CsvMapping; result?: DatasetParseResult; largeFile?: boolean; error?: string };

const CHUNK = 4 * 1024 * 1024;
const DIRECT_ANALYSIS_LIMIT = 300 * 1024 * 1024;
const COHERENCE_LIMIT = 0.75;
const lifecycle = [
  ["01", "上传数据", "选择 CSV，原始文件只读检查，不修改任何字段。"],
  ["02", "识别字段", "自动识别经纬度、速率、相干性、模式和时间序列。"],
  ["03", "检查数据", "统计缺测、低相干、重复坐标和无法解析的时间字段。"],
  ["04", "用户确认", "确认映射及推荐筛选后，再保存私有数据资产。"],
];
const mappingFields: Array<[keyof Pick<CsvMapping, "lon" | "lat" | "velocity" | "coherence" | "mode">, string, boolean]> = [
  ["lon", "经度", true], ["lat", "纬度", true], ["velocity", "形变速率", true], ["coherence", "相干性", false], ["mode", "形变模式", false],
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

export function DatasetPage() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DatasetMeta[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [stage, setStage] = useState<ImportStage>("idle");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [decision, setDecision] = useState<ImportDecision | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [replaceParent, setReplaceParent] = useState<DatasetMeta | null>(null);
  const [report, setReport] = useState<DatasetMeta | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const response = await fetch("/api/private-datasets?op=list", { credentials: "include", cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      setItems((data.items || []).sort((a: DatasetMeta, b: DatasetMeta) => b.uploadedAt.localeCompare(a.uploadedAt)));
      setAccount(data.account || null);
    } else if (response.status !== 401) setMessage("私有数据服务暂时不可用，请稍后重试");
  };
  useEffect(() => {
    getSession().then((current) => {
      setUser(current);
      setLoading(false);
      if (current) refresh();
    }).catch(() => setLoading(false));
  }, []);

  const quality = preflight?.result?.quality;
  const currentStep = stage === "mapping" || stage === "reading" ? 2 : stage === "quality" ? 3 : stage === "uploading" || stage === "success" ? 4 : 1;
  const lowRatio = quality?.validPoints ? quality.lowCoherence / quality.validPoints : 0;
  const canConfirmMapping = Boolean(preflight?.mapping?.lon && preflight?.mapping?.lat && preflight?.mapping?.velocity && (preflight?.mapping?.timeCols.length || 0) >= 2);
  const accountName = String(user?.name || user?.email || "访客");
  const usage = account ? Math.min(100, account.usedBytes / account.maxUserBytes * 100) : 0;

  const resetImport = () => {
    setPreflight(null);
    setStage("idle");
    setDecision(null);
    setProgress(0);
    setMessage("");
    setReplaceParent(null);
    if (fileRef.current) fileRef.current.value = "";
  };
  const prepareFile = async (file?: File) => {
    if (!file) return;
    setMessage("");
    setDecision(null);
    if (!/\.csv$/i.test(file.name)) {
      setPreflight({ file, error: "仅支持 CSV 文件" }); setStage("error"); return;
    }
    if (account && file.size > account.maxFileSize) {
      setPreflight({ file, error: `单个文件超过 ${formatBytes(account.maxFileSize)} 限制` }); setStage("error"); return;
    }
    if (account && account.usedBytes + file.size > account.maxUserBytes) {
      setPreflight({ file, error: `账户容量不足，当前剩余 ${formatBytes(account.maxUserBytes - account.usedBytes)}` }); setStage("error"); return;
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
      return { ...current, mapping: { ...current.mapping, timeCols: selected ? current.mapping.timeCols.filter((field) => field !== header) : [...current.mapping.timeCols, header] } };
    });
  };
  const confirmMapping = () => {
    if (!preflight?.text || !preflight.mapping || !preflight.inspection) return;
    try {
      const parsed = parseMappedCsv(preflight.text, preflight.file.name, preflight.mapping, true);
      parsed.quality = enrichQuality(parsed, preflight.inspection, preflight.mapping, preflight.text);
      trackEvent("dataset_loaded", { dataset_type: "local_preflight", point_count: parsed.points.length, period_count: parsed.periods, invalid_count: parsed.invalid });
      setPreflight({ ...preflight, result: parsed });
      setStage("quality");
      setDecision(null);
    } catch (error) {
      setPreflight({ ...preflight, error: error instanceof Error ? error.message : "字段映射检查失败" });
      setStage("error");
    }
  };
  const uploadOriginal = async (choice: ImportDecision) => {
    if (!preflight?.file || !user) return;
    const file = preflight.file;
    const id = crypto.randomUUID().replace(/-/g, "");
    const chunks = Math.ceil(file.size / CHUNK);
    const parentId = replaceParent?.id;
    setDecision(choice);
    setStage("uploading");
    setMessage(`正在保存原始文件 ${file.name}`);
    setProgress(0);
    trackEvent("dataset_upload_start", { source: "private_storage", file_size_bytes: file.size, chunk_count: chunks, replaces_version: Boolean(parentId) });
    localStorage.setItem("lanjifyw-upload-session", JSON.stringify({ id, name: file.name, size: file.size, chunks, parentId, startedAt: new Date().toISOString() }));
    try {
      for (let index = 0; index < chunks; index += 1) {
        const body = await file.slice(index * CHUNK, Math.min(file.size, (index + 1) * CHUNK)).arrayBuffer();
        const response = await fetch(`/api/private-datasets?op=chunk&id=${id}&index=${index}`, { method: "POST", body, credentials: "include", headers: { "Content-Type": "application/octet-stream" } });
        if (!response.ok) throw new Error((await response.json()).error || `第 ${index + 1} 个分块上传失败`);
        setProgress(Math.round(((index + 1) / chunks) * 86));
      }
      const done = await fetch(`/api/private-datasets?op=complete&id=${id}`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name, size: file.size, chunks, parentId,
          analysisReady: file.size <= DIRECT_ANALYSIS_LIMIT && Boolean(preflight.result),
          mapping: preflight.mapping,
          qualityReport: quality,
          importDecision: choice,
          recommendedFilter: choice === "recommended" ? { coherenceMin: COHERENCE_LIMIT } : null,
        }),
      });
      if (!done.ok) throw new Error((await done.json()).error || "数据集登记失败");
      setProgress(100);
      setStage("success");
      setMessage(parentId ? "新版本已保存，旧版本未被覆盖" : "数据已按当前账户私有保存");
      trackEvent("dataset_upload_success", { source: "private_storage", file_size_bytes: file.size, chunk_count: chunks, point_count: quality?.validPoints ?? null });
      localStorage.removeItem("lanjifyw-upload-session");
      await refresh();
    } catch (error) {
      trackEvent("dataset_upload_fail", { source: "private_storage", reason: "storage_or_network_failed", file_size_bytes: file.size, chunk_count: chunks });
      setPreflight({ ...preflight, error: error instanceof Error ? error.message : "上传失败" });
      setStage("error");
    }
  };
  const chooseDecision = (choice: ImportDecision) => {
    setDecision(choice);
    if (user) uploadOriginal(choice);
    else setMessage("本地质检已完成。登录后可保存原始 CSV、字段映射和筛选偏好。浏览器未上传文件。\n");
  };
  const updateDataset = async (item: DatasetMeta, patch: Partial<DatasetMeta>) => {
    const response = await fetch(`/api/private-datasets?id=${item.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!response.ok) { setMessage("更新失败"); return; }
    setMessage("数据集信息已更新"); setRenaming(null); await refresh();
  };
  const remove = async (id: string) => {
    if (!confirm("确认删除这个私有数据集及其全部分块？此操作不可恢复。")) return;
    const response = await fetch(`/api/private-datasets?id=${id}`, { method: "DELETE", credentials: "include" });
    if (response.ok) { setMessage("数据集已删除"); await refresh(); } else setMessage("删除失败");
  };
  const signOut = async () => { await logout(); window.location.href = "/login"; };

  if (loading) return <div className="auth-loading">正在检查账户…</div>;
  return <PageShell>
    <PageHero eyebrow="PHASE 6 · DATA ONBOARDING" title="把 InSAR CSV 稳定接入分析流程" description={user ? `当前账户：${accountName}。先识别、再质检、确认后保存；原始 CSV 始终保持不变。` : "无需登录即可在浏览器完成小型 CSV 的字段识别与质检；登录后才会私有保存文件和配置。"}/>
    <section className="section dataset-layout phase-six-datasets">
      <aside>
        <b>数据空间</b><Link className="active" href="/datasets">我的数据集 <span>{items.length}</span></Link><Link href="/map">地图工作台</Link><Link href="/statistics">区域统计</Link><Link href="/platform">存储架构</Link>
        {user ? <button onClick={signOut}>退出登录</button> : <Link href="/login">登录 / 注册</Link>}
      </aside>
      <div>
        {!user && <div className="phase-six-guest-banner"><b>访客检查模式</b><span>文件仅在当前浏览器中解析，不会上传。完成质检后可登录保存。</span><Link href="/login">登录保存</Link></div>}
        {user && account && <div className="account-strip">
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
            <p>系统先在本地识别字段和检查质量，只有用户确认后才保存。不会静默删除行、覆盖原文件或修改字段。</p>
            <button className="button primary" disabled={stage === "reading"} onClick={() => fileRef.current?.click()}>{stage === "reading" ? "正在读取…" : "选择 CSV"}</button>
            <button className="button ghost" onClick={downloadTemplate}>下载 CSV 模板</button>
            {replaceParent && <button className="button ghost" onClick={resetImport}>取消新版本</button>}
            <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => prepareFile(event.target.files?.[0])}/>
            <small>必需：经度、纬度、速率、至少 2 个累计形变时间列；可选：label、coherence、project_name。</small>
          </div>}

          {stage === "mapping" && preflight?.inspection && preflight.mapping && <div className="field-recognition-panel">
            <div className="quality-status"><span className="eyebrow">FIELD RECOGNITION</span><b>已读取 {preflight.file.name}</b><small>{formatBytes(preflight.file.size)} · 共 {preflight.inspection.headers.length} 个字段</small></div>
            <div className="recognition-grid">
              <article><span>经纬度</span><b>{preflight.mapping.lon && preflight.mapping.lat ? "已识别" : "需要确认"}</b><small>{preflight.mapping.lon || "—"} / {preflight.mapping.lat || "—"}</small></article>
              <article><span>时间序列</span><b>{preflight.mapping.timeCols.length} 期</b><small>{preflight.mapping.timeCols.slice(0, 2).join(" → ") || "未识别"}</small></article>
              <article><span>形变速率</span><b>{preflight.mapping.velocity || "需要确认"}</b><small>必需字段</small></article>
              <article><span>相干性</span><b>{preflight.mapping.coherence || "未提供"}</b><small>可选质量字段</small></article>
            </div>
            <h3>确认字段映射</h3>
            <div className="mapping-confirm-grid">
              {mappingFields.map(([field, label, required]) => <label key={field}><span>{label}{required && <i>必需</i>}</span><select value={preflight.mapping?.[field] || ""} onChange={(event) => updateMapping(field, event.target.value)}><option value="">{required ? "请选择字段" : "不使用"}</option>{preflight.inspection?.headers.map((header) => <option key={header} value={header}>{header}</option>)}</select></label>)}
            </div>
            <div className="time-field-confirm"><span>累计形变时间列</span><b>{preflight.mapping.timeCols.length} 个已选择</b><small>{preflight.mapping.timeCols.slice(0, 10).join("、")}{preflight.mapping.timeCols.length > 10 ? " …" : ""}</small></div>
            <details className="time-field-picker"><summary>手动增减时间字段</summary><div>{preflight.inspection.headers.map((header) => <label key={header}><input type="checkbox" checked={preflight.mapping?.timeCols.includes(header) || false} onChange={() => toggleTimeField(header)}/><span>{header}</span></label>)}</div></details>
            {preflight.inspection.warnings.length > 0 && <div className="dataset-inline-error">{preflight.inspection.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
            <div className="workflow-actions"><button className="button ghost" onClick={resetImport}>重新选择</button><button className="button primary" disabled={!canConfirmMapping} onClick={confirmMapping}>确认映射并检查数据</button></div>
          </div>}

          {stage === "quality" && preflight?.largeFile && <div className="large-file-review">
            <span className="eyebrow">LARGE FILE ROUTE</span><h2>大文件需要后台流式质检</h2><p>{preflight.file.name} · {formatBytes(preflight.file.size)}</p>
            <p>浏览器不会一次读取超过 300 MB 的 CSV。生产流程应分片上传原始文件，再由后台逐行识别字段、生成质检报告并转换为 GeoParquet / PostGIS / PMTiles。</p>
            <div className="raw-data-boundary"><b>当前阶段未执行质检</b><span>为避免误报，不会把“未检查”显示成“检查通过”。Phase 6 保留清晰的待处理状态。</span></div>
            <div className="workflow-actions"><button className="button ghost" onClick={resetImport}>重新选择</button>{user ? <button className="button primary" onClick={() => uploadOriginal("keep-all")}>仅归档原始 CSV</button> : <Link className="button primary" href="/login">登录后归档</Link>}</div>
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
            {quality.coherenceProvided && quality.lowCoherence > 0 ? <div className="recommendation-card">
              <div><span className="eyebrow">RECOMMENDATION</span><h3>检测到 {quality.lowCoherence} 个低相干点</h3><p>建议在地图分析中默认过滤相干性低于 {COHERENCE_LIMIT} 的点。该选择只保存为分析偏好，不会删除原始行。</p></div>
              <button className={`button ${decision === "recommended" ? "primary" : "ghost"}`} onClick={() => chooseDecision("recommended")}>应用推荐筛选</button>
              <button className={`button ${decision === "keep-all" ? "primary" : "ghost"}`} onClick={() => chooseDecision("keep-all")}>保留全部数据</button>
            </div> : <div className="recommendation-card"><div><span className="eyebrow">RECOMMENDATION</span><h3>{quality.coherenceProvided ? "未发现低相干点" : "CSV 未提供相干性字段"}</h3><p>{quality.coherenceProvided ? "无需应用低相干筛选，可保留全部有效点。" : "系统不会虚构质量结论；后续仍可补充 coherence 字段重新导入。"}</p></div><button className="button primary" onClick={() => chooseDecision("keep-all")}>确认并保留有效数据</button></div>}
            <div className="raw-data-boundary"><b>数据边界</b><span>原始 CSV 原样保存；无效行、重复坐标、低相干点仅进入报告和筛选配置，不静默删除。</span></div>
            {(preflight?.result?.errors.length || quality.warnings.length) > 0 && <details className="quality-error-report"><summary>查看错误与质量提示</summary><div>{preflight?.result?.errors.slice(0, 12).map((error) => <span key={error}>{error}</span>)}{quality.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div></details>}
            {!user && decision && <div className="workflow-actions"><button className="button ghost" onClick={() => setStage("mapping")}>返回修改映射</button><Link className="button primary" href="/login">登录并保存结果</Link></div>}
          </div>}

          {stage === "uploading" && <div className="dataset-state-card loading"><span className="eyebrow">PRIVATE UPLOAD</span><h2>正在保存原始 CSV 与质检元数据</h2><p>{message}</p><div className="upload-progress"><i style={{ width: `${progress}%` }}/><span>{progress}%</span></div></div>}
          {stage === "success" && <div className="dataset-state-card success"><span className="eyebrow">IMPORT COMPLETE</span><h2>数据接入完成</h2><p>{message}</p><div className="workflow-actions"><button className="button ghost" onClick={resetImport}>继续导入</button><Link className="button primary" href="/map">进入地图分析</Link></div></div>}
          {stage === "error" && <div className="dataset-state-card error"><span className="eyebrow">IMPORT ERROR</span><h2>本次导入未完成</h2><p>{preflight?.error || "请检查文件后重试"}</p><button className="button primary" onClick={resetImport}>返回并重新选择</button></div>}
        </div>

        <div className="product-checklist phase-six-flow"><span className="eyebrow">PRODUCT FLOW</span><h2>Phase 6 数据接入闭环</h2>{lifecycle.map(([number, title, description]) => <article key={number}><b>{number}</b><span>{title}</span><small>{description}</small></article>)}</div>

        {user && <div className="dataset-table private-table product-table">
          <div><b>数据集名称</b><b>流程状态</b><b>质检摘要</b><b>文件大小</b><b>操作</b></div>
          {items.length === 0 && <div className="empty-dataset">当前账户还没有保存的数据集。可以先上传海口示例 CSV 或自己的 InSAR 点数据。</div>}
          {items.map((item) => <div key={item.id}>
            <span>{renaming === item.id ? <input className="rename-input" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus/> : <strong>{item.name}</strong>}<small>v{item.version || 1} · {new Date(item.uploadedAt).toLocaleString("zh-CN")} · {item.id.slice(0, 8)}</small></span>
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
