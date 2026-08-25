import { randomUUID } from "node:crypto";
import { get, list, put } from "@vercel/blob";
import type { CsvMapping } from "../app/lib/insar-v2.js";
import { parseMappedCsv } from "../app/lib/insar-v2.js";
import { PHASE_E_MAX_POINTS, runPascOnlineProxy, type PascOnlineRequest, type PascOnlineResponse } from "../app/lib/pasc-online.js";
import { PASC_LARGE_MAX_POINTS, buildPascDurableRequestBatches } from "../app/lib/pasc-large.js";
import { PASC_CONTRACT_VERSION, PASC_MODEL_VERSION } from "../app/types/pasc.js";

export const PASC_LARGE_TOPIC = "pasc-large-jobs";
export const PASC_LARGE_MAX_SOURCE_BYTES = 256 * 1024 * 1024;
export const PASC_LARGE_MAX_ATTEMPTS = 8;

export type PascLargeMessage = {
  kind: "prepare" | "infer";
  ownerId: string;
  jobId: string;
  batchIndex?: number;
};

export type PascLargeJobStatus = "queued" | "running" | "retry_wait" | "cancelling" | "cancelled" | "completed" | "failed";

type BatchSummary = PascOnlineResponse["summary"];

export type PascLargeJob = {
  jobId: string;
  ownerId: string;
  datasetId: string;
  datasetName: string;
  sourceChunks: number;
  sourceBytes: number;
  mapping: CsvMapping;
  contractVersion: string;
  modelVersion: string;
  webgisVersion: string;
  serviceVersion: string | null;
  status: PascLargeJobStatus;
  stage: string;
  progress: number;
  points: { total: number; processed: number; predicted: number; unsupported: number };
  chunks: { current: number; total: number; size: number };
  attempts: { current: number; maximum: number };
  retryAt: string | null;
  cancelRequested: boolean;
  summary: Record<string, number>;
  batchSummaries: Record<string, BatchSummary>;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type PascPublicLargeJob = Omit<PascLargeJob, "ownerId" | "sourceChunks" | "sourceBytes" | "mapping" | "batchSummaries">;

type DatasetMeta = {
  id: string;
  name: string;
  size: number;
  chunks: number;
  mapping?: CsvMapping;
  qualityReport?: { validPoints?: number };
  schemaStatus?: string;
};

export type PascLargeEnqueue = (message: PascLargeMessage, idempotencyKey: string, delaySeconds?: number) => Promise<void>;

const identifier = (value: string, label: string) => {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) throw new Error(`${label} 无效。`);
  return value;
};
const userPrefix = (ownerId: string) => `users/${identifier(ownerId, "用户标识")}/`;
const jobPrefix = (ownerId: string, jobId: string) => `${userPrefix(ownerId)}pasc-jobs/${identifier(jobId, "任务标识")}/`;
const jobMetaPath = (ownerId: string, jobId: string) => `${jobPrefix(ownerId, jobId)}meta.json`;
const requestPath = (ownerId: string, jobId: string, index: number) => `${jobPrefix(ownerId, jobId)}requests/${index}.json`;
const resultPath = (ownerId: string, jobId: string, index: number) => `${jobPrefix(ownerId, jobId)}results/${index}.json`;
const datasetMetaPath = (ownerId: string, datasetId: string) => `${userPrefix(ownerId)}meta/${identifier(datasetId, "数据集标识")}.json`;
const datasetChunkPath = (ownerId: string, datasetId: string, index: number) => `${userPrefix(ownerId)}datasets/${identifier(datasetId, "数据集标识")}/chunks/${index}`;

async function readPrivateJson<T>(pathname: string): Promise<T | null> {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json() as Promise<T>;
}

async function writePrivateJson(pathname: string, value: unknown) {
  await put(pathname, JSON.stringify(value), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

async function readPrivateBytes(pathname: string) {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) throw new Error("私有 CSV 分块不存在或已被删除。");
  return new Uint8Array(await new Response(result.stream).arrayBuffer());
}

function validMapping(value: unknown): value is CsvMapping {
  if (!value || typeof value !== "object") return false;
  const mapping = value as Partial<CsvMapping>;
  return Boolean(
    mapping.lon && mapping.lat && Array.isArray(mapping.timeCols) && mapping.timeCols.length >= 20
    && (mapping.displacementUnit === "mm" || mapping.displacementUnit === "cm" || mapping.displacementUnit === "m")
    && (mapping.signConvention === "toward_satellite_positive" || mapping.signConvention === "away_from_satellite_positive")
    && (mapping.preprocessingState === "raw" || mapping.preprocessingState === "already_smoothed"),
  );
}

export function publicPascLargeJob(job: PascLargeJob): PascPublicLargeJob {
  const { ownerId, sourceChunks, sourceBytes, mapping, batchSummaries, ...value } = job;
  void ownerId; void sourceChunks; void sourceBytes; void mapping; void batchSummaries;
  return value;
}

export async function getPascLargeJob(ownerId: string, jobId: string) {
  return readPrivateJson<PascLargeJob>(jobMetaPath(ownerId, jobId));
}

export async function listPascLargeJobs(ownerId: string) {
  const prefix = `${userPrefix(ownerId)}pasc-jobs/`;
  const found = await list({ prefix, limit: 1000 });
  const metaPaths = found.blobs.map(blob => blob.pathname).filter(pathname => pathname.endsWith("/meta.json"));
  const jobs = (await Promise.all(metaPaths.map(pathname => readPrivateJson<PascLargeJob>(pathname)))).filter(Boolean) as PascLargeJob[];
  return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function createPascLargeJob(ownerId: string, datasetId: string, enqueue: PascLargeEnqueue) {
  const existing = (await listPascLargeJobs(ownerId)).find(job => job.datasetId === datasetId && !["cancelled", "failed"].includes(job.status));
  if (existing) return { job: existing, created: false };
  const dataset = await readPrivateJson<DatasetMeta>(datasetMetaPath(ownerId, datasetId));
  if (!dataset) throw new Error("私有数据集不存在。");
  if (!validMapping(dataset.mapping)) throw new Error("请先确认经纬度、至少 20 个日期列、单位、正负号和预处理状态。");
  if (!Number.isInteger(dataset.chunks) || dataset.chunks < 1 || dataset.chunks > 520) throw new Error("私有数据集分块信息无效。");
  if (!Number.isFinite(dataset.size) || dataset.size <= 0 || dataset.size > PASC_LARGE_MAX_SOURCE_BYTES) {
    throw new Error("当前后台分类支持不超过 256 MB 的已映射 CSV；请先按空间范围拆分更大的数据集。");
  }
  const estimated = Number(dataset.qualityReport?.validPoints ?? 0);
  if (estimated > PASC_LARGE_MAX_POINTS) throw new Error(`当前任务最多处理 ${PASC_LARGE_MAX_POINTS.toLocaleString()} 个候选点。`);
  const now = new Date().toISOString();
  const jobId = randomUUID();
  const job: PascLargeJob = {
    jobId,
    ownerId,
    datasetId,
    datasetName: dataset.name,
    sourceChunks: dataset.chunks,
    sourceBytes: dataset.size,
    mapping: dataset.mapping,
    contractVersion: PASC_CONTRACT_VERSION,
    modelVersion: PASC_MODEL_VERSION,
    webgisVersion: "phase-g-large-v1",
    serviceVersion: null,
    status: "queued",
    stage: "queued",
    progress: 0,
    points: { total: Math.max(0, estimated), processed: 0, predicted: 0, unsupported: 0 },
    chunks: { current: 0, total: 0, size: PHASE_E_MAX_POINTS },
    attempts: { current: 0, maximum: PASC_LARGE_MAX_ATTEMPTS },
    retryAt: null,
    cancelRequested: false,
    summary: {},
    batchSummaries: {},
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };
  await writePrivateJson(jobMetaPath(ownerId, jobId), job);
  await enqueue({ kind: "prepare", ownerId, jobId }, `${jobId}:prepare`);
  return { job, created: true };
}

async function saveJob(job: PascLargeJob) {
  job.updatedAt = new Date().toISOString();
  await writePrivateJson(jobMetaPath(job.ownerId, job.jobId), job);
}

async function preparePascLargeJob(job: PascLargeJob, enqueue: PascLargeEnqueue) {
  if (job.cancelRequested) {
    job.status = "cancelled";
    job.stage = "cancelled";
    job.completedAt = new Date().toISOString();
    await saveJob(job);
    return;
  }
  job.status = "running";
  job.stage = "downloading";
  job.startedAt ??= new Date().toISOString();
  job.error = null;
  await saveJob(job);
  const parts: Uint8Array[] = [];
  for (let index = 0; index < job.sourceChunks; index += 1) parts.push(await readPrivateBytes(datasetChunkPath(job.ownerId, job.datasetId, index)));
  job.stage = "validating";
  await saveJob(job);
  const parsed = parseMappedCsv(Buffer.concat(parts.map(part => Buffer.from(part))).toString("utf8"), job.datasetName, job.mapping, true);
  const requests = buildPascDurableRequestBatches(parsed.points, job.datasetName, job.mapping.preprocessingState);
  job.points.total = requests.reduce((sum, request) => sum + request.points.length, 0);
  job.chunks.total = requests.length;
  job.stage = "preprocessing";
  await saveJob(job);
  for (let index = 0; index < requests.length; index += 4) {
    await Promise.all(requests.slice(index, index + 4).map((request, offset) => writePrivateJson(requestPath(job.ownerId, job.jobId, index + offset), request)));
  }
  job.stage = "inference";
  job.progress = 0;
  await saveJob(job);
  await enqueue({ kind: "infer", ownerId: job.ownerId, jobId: job.jobId, batchIndex: 0 }, `${job.jobId}:infer:0`);
}

function aggregateBatchSummaries(job: PascLargeJob) {
  const values = Object.values(job.batchSummaries);
  return values.reduce((total, item) => ({
    points: total.points + item.points,
    predicted: total.predicted + item.predicted,
    lowConfidence: total.lowConfidence + item.lowConfidence,
    limitedReference: total.limitedReference + item.limitedReference,
  }), { points: 0, predicted: 0, lowConfidence: 0, limitedReference: 0 });
}

async function inferPascLargeBatch(job: PascLargeJob, batchIndex: number, enqueue: PascLargeEnqueue) {
  if (!Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= job.chunks.total) throw new Error("任务批次编号无效。");
  if (job.cancelRequested) {
    job.status = "cancelled";
    job.stage = "cancelled";
    job.completedAt = new Date().toISOString();
    await saveJob(job);
    return;
  }
  const existing = await readPrivateJson<PascOnlineResponse>(resultPath(job.ownerId, job.jobId, batchIndex));
  let response = existing;
  if (!response) {
    const request = await readPrivateJson<PascOnlineRequest>(requestPath(job.ownerId, job.jobId, batchIndex));
    if (!request) throw new Error("任务请求分块不存在，请重试任务准备阶段。");
    response = await runPascOnlineProxy(request, {
      serviceBaseUrl: process.env.PASC_SERVICE_BASE_URL || "",
      serviceApiKey: process.env.PASC_SERVICE_API_KEY || "",
      timeoutMs: 240_000,
    }) as PascOnlineResponse;
    await writePrivateJson(resultPath(job.ownerId, job.jobId, batchIndex), response);
  }
  job.status = "running";
  job.stage = "inference";
  job.error = null;
  job.retryAt = null;
  job.serviceVersion = response.serviceVersion;
  job.batchSummaries[String(batchIndex)] = response.summary;
  const summary = aggregateBatchSummaries(job);
  const completed = Object.keys(job.batchSummaries).length;
  job.points.processed = summary.points;
  job.points.predicted = summary.predicted;
  job.points.unsupported = Math.max(0, summary.points - summary.predicted);
  job.chunks.current = completed;
  job.summary = summary;
  job.progress = job.chunks.total ? Math.min(100, completed / job.chunks.total * 100) : 0;
  if (completed >= job.chunks.total) {
    job.status = "completed";
    job.stage = "completed";
    job.progress = 100;
    job.completedAt = new Date().toISOString();
    await saveJob(job);
    return;
  }
  await saveJob(job);
  const nextIndex = batchIndex + 1;
  await enqueue({ kind: "infer", ownerId: job.ownerId, jobId: job.jobId, batchIndex: nextIndex }, `${job.jobId}:infer:${nextIndex}`);
}

export async function processPascLargeMessage(message: PascLargeMessage, deliveryCount: number, enqueue: PascLargeEnqueue) {
  if (!message || (message.kind !== "prepare" && message.kind !== "infer")) throw new Error("队列消息无效。");
  const job = await getPascLargeJob(message.ownerId, message.jobId);
  if (!job || ["completed", "cancelled"].includes(job.status)) return;
  job.attempts.current = Math.max(job.attempts.current, deliveryCount);
  await saveJob(job);
  if (message.kind === "prepare") await preparePascLargeJob(job, enqueue);
  else await inferPascLargeBatch(job, Number(message.batchIndex), enqueue);
}

export async function markPascLargeRetry(message: PascLargeMessage, deliveryCount: number, error: unknown) {
  const job = await getPascLargeJob(message.ownerId, message.jobId);
  if (!job || ["completed", "cancelled"].includes(job.status)) return;
  const messageText = error instanceof Error ? error.message : "后台分类暂时失败。";
  job.attempts.current = Math.max(job.attempts.current, deliveryCount);
  job.error = { code: "PASC_LARGE_BATCH_FAILED", message: messageText };
  if (deliveryCount >= PASC_LARGE_MAX_ATTEMPTS) {
    job.status = "failed";
    job.stage = "failed";
    job.retryAt = null;
    job.completedAt = new Date().toISOString();
  } else {
    const afterSeconds = Math.min(900, 15 * 2 ** Math.max(0, deliveryCount - 1));
    job.status = "retry_wait";
    job.stage = message.kind === "prepare" ? "validating" : "inference";
    job.retryAt = new Date(Date.now() + afterSeconds * 1000).toISOString();
  }
  await saveJob(job);
}

export async function cancelPascLargeJob(ownerId: string, jobId: string) {
  const job = await getPascLargeJob(ownerId, jobId);
  if (!job) return null;
  if (!["completed", "cancelled", "failed"].includes(job.status)) {
    job.cancelRequested = true;
    job.status = "cancelling";
    job.stage = "cancelling";
    await saveJob(job);
  }
  return job;
}

export async function retryPascLargeJob(ownerId: string, jobId: string, enqueue: PascLargeEnqueue) {
  const job = await getPascLargeJob(ownerId, jobId);
  if (!job) return null;
  if (job.status !== "failed" && job.status !== "cancelled") throw new Error("只有失败或已取消的任务可以重试。");
  job.cancelRequested = false;
  job.status = "queued";
  job.stage = job.chunks.total ? "inference" : "queued";
  job.error = null;
  job.retryAt = null;
  job.completedAt = null;
  await saveJob(job);
  const nextIndex = Math.min(job.chunks.current, Math.max(0, job.chunks.total - 1));
  const message: PascLargeMessage = job.chunks.total
    ? { kind: "infer", ownerId, jobId, batchIndex: nextIndex }
    : { kind: "prepare", ownerId, jobId };
  await enqueue(message, `${jobId}:manual-retry:${Date.now()}`);
  return job;
}

export async function readPascLargeResult(ownerId: string, jobId: string, batchIndex: number) {
  const job = await getPascLargeJob(ownerId, jobId);
  if (!job || !Number.isInteger(batchIndex) || batchIndex < 0 || batchIndex >= job.chunks.total) return null;
  return readPrivateJson<PascOnlineResponse>(resultPath(ownerId, jobId, batchIndex));
}