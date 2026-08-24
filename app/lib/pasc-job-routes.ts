import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../chatgpt-auth";
import { PASC_CONTRACT_VERSION, PASC_MODEL_VERSION } from "../types/pasc";
import {
  artifactObjectKey,
  claimPascJob,
  completePascJob,
  createPascJob,
  failPascJob,
  getPascArtifact,
  getPascJob,
  listOwnerPascJobs,
  listPascArtifacts,
  mapArtifactKindForZoom,
  parseJsonRecord,
  pascJobView,
  requestPascJobCancellation,
  updatePascJobProgress,
  upsertPascArtifact,
  type PascArtifactKind,
  type PascJobProgressInput,
  type PascJobRequestConfig,
  type PascJobRow,
} from "./pasc-jobs";

const NO_STORE = { "cache-control": "private, no-store" };
const WEBGIS_VERSION = "0.1.0-phase-f";
const ARTIFACT_KINDS = new Set<PascArtifactKind>([
  "validation", "preprocessed", "predictions", "summary", "audit", "errors",
  "map_level_0", "map_level_1", "map_level_2",
]);

type RouteContext = { params: Promise<{ jobId: string; artifactId?: string }> };
type DatasetJobRow = {
  id: string;
  name: string;
  source_key: string;
  status: string;
  point_count: number;
  schema_json: string | null;
};

function response(value: unknown, status = 200) {
  return Response.json(value, { status, headers: NO_STORE });
}

function errorResponse(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
  return response({ contractVersion: PASC_CONTRACT_VERSION, error: { code, message, details } }, status);
}

function runtimeSecret(name: string) {
  const binding = (env as unknown as Record<string, unknown>)[name];
  if (typeof binding === "string") return binding.trim();
  return (typeof process !== "undefined" ? process.env[name] : "")?.trim() ?? "";
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function consumerAuthorized(request: Request) {
  const configured = runtimeSecret("PASC_CONSUMER_API_KEY");
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (configured.length < 32 || provided.length < 32) return false;
  const [left, right] = await Promise.all([digest(configured), digest(provided)]);
  let different = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    different |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return different === 0;
}

function jobConfig(row: PascJobRow) {
  return parseJsonRecord(row.request_json) as PascJobRequestConfig;
}

function mappingConfig(dataset: DatasetJobRow): PascJobRequestConfig | null {
  const schema = parseJsonRecord(dataset.schema_json);
  const mapping = schema.mapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return null;
  const record = mapping as Record<string, unknown>;
  const dateColumns = Array.isArray(record.timeCols) ? record.timeCols.filter(value => typeof value === "string" && value).slice(0, 1000) as string[] : [];
  const displacementUnit = record.displacementUnit;
  const velocityUnit = record.velocityUnit;
  const signConvention = record.signConvention;
  const preprocessingState = record.preprocessingState;
  if (
    typeof record.lon !== "string" || !record.lon ||
    typeof record.lat !== "string" || !record.lat ||
    dateColumns.length < 40 ||
    !["mm", "cm", "m"].includes(String(displacementUnit)) ||
    (record.velocity && !["mm/year", "cm/year", "m/year"].includes(String(velocityUnit))) ||
    !["toward_satellite_positive", "away_from_satellite_positive"].includes(String(signConvention)) ||
    !["raw", "already_smoothed"].includes(String(preprocessingState))
  ) return null;
  return {
    datasetName: dataset.name,
    mapping: record,
    settings: {
      displacementUnit: String(displacementUnit),
      velocityUnit: record.velocity ? String(velocityUnit) : "mm/year",
      signConvention: String(signConvention),
      preprocessingState: String(preprocessingState),
    },
    dateColumns,
    sourceSizeBytes: Number(schema.size ?? 0),
  };
}

async function ownerJob(requestContext: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return { failure: errorResponse("PASC_JOB_AUTH_REQUIRED", "请先登录后再访问任务。", 401) };
  const { jobId } = await requestContext.params;
  const job = await getPascJob(env.DB, jobId, user.userId);
  if (!job) return { failure: errorResponse("PASC_JOB_NOT_FOUND", "任务不存在。", 404) };
  return { user, job };
}

export async function publicJobsGET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return errorResponse("PASC_JOB_AUTH_REQUIRED", "请先登录后再访问任务。", 401);
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 50);
  const rows = await listOwnerPascJobs(env.DB, user.userId, limit);
  return response({ contractVersion: PASC_CONTRACT_VERSION, jobs: rows.map(pascJobView) });
}

export async function publicJobsPOST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return errorResponse("PASC_JOB_AUTH_REQUIRED", "请先登录后再创建任务。", 401);
  let body: { datasetId?: unknown; idempotencyKey?: unknown; chunkSize?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return errorResponse("PASC_BAD_REQUEST", "任务请求必须是 UTF-8 JSON。", 422); }
  const datasetId = typeof body.datasetId === "string" ? body.datasetId : "";
  const idempotencyKey = (request.headers.get("idempotency-key") ?? (typeof body.idempotencyKey === "string" ? body.idempotencyKey : "")).trim();
  if (!datasetId || idempotencyKey.length < 16 || idempotencyKey.length > 160) {
    return errorResponse("PASC_JOB_REQUEST_INVALID", "必须提供数据集和 16—160 字符幂等键。", 422);
  }
  const dataset = await env.DB.prepare("SELECT id, name, source_key, status, point_count, schema_json FROM datasets WHERE id = ? AND owner_id = ?")
    .bind(datasetId, user.userId).first<DatasetJobRow>();
  if (!dataset) return errorResponse("PASC_DATASET_NOT_FOUND", "数据集不存在。", 404);
  if (dataset.status === "archived") return errorResponse("PASC_DATASET_NOT_READY", "已归档数据集不能创建任务。", 409);
  const config = mappingConfig(dataset);
  if (!config) return errorResponse("PASC_JOB_MAPPING_REQUIRED", "创建大数据任务前必须确认字段、至少 40 个日期列、单位、符号和平滑状态。", 422);
  const created = await createPascJob(env.DB, {
    ownerId: user.userId,
    datasetId,
    idempotencyKey,
    request: config,
    totalPoints: Math.max(0, Number(dataset.point_count ?? 0)),
    chunkSize: Number(body.chunkSize ?? 256),
    webgisVersion: WEBGIS_VERSION,
  });
  const mappingKey = "datasets/" + user.userId.replace(/[^A-Za-z0-9_.-]/g, "_") + "/" + datasetId.replace(/[^A-Za-z0-9_.-]/g, "_") + "/mapping.json";
  await env.DATASETS.put(mappingKey, JSON.stringify({ contractVersion: PASC_CONTRACT_VERSION, datasetId, mapping: config.mapping, settings: config.settings, dateColumns: config.dateColumns }), {
    httpMetadata: { contentType: "application/json; charset=utf-8" },
    customMetadata: { ownerId: user.userId, datasetId, kind: "mapping" },
  });
  return response({ contractVersion: PASC_CONTRACT_VERSION, reused: created.reused, job: pascJobView(created.row) }, created.reused ? 200 : 202);
}

export async function publicJobGET(_request: Request, context: RouteContext) {
  const found = await ownerJob(context);
  if ("failure" in found) return found.failure;
  const eventsResult = await env.DB.prepare("SELECT event_type, status, progress, message, data_json, created_at FROM pasc_job_events WHERE job_id = ? AND owner_id = ? ORDER BY created_at DESC LIMIT 30")
    .bind(found.job.id, found.user.userId).all<{ event_type: string; status: string; progress: number; message: string; data_json: string | null; created_at: number }>();
  return response({
    contractVersion: PASC_CONTRACT_VERSION,
    job: pascJobView(found.job),
    events: (eventsResult.results ?? []).map(item => ({
      type: item.event_type,
      status: item.status,
      progress: item.progress,
      message: item.message,
      data: parseJsonRecord(item.data_json),
      createdAt: new Date(item.created_at).toISOString(),
    })),
  });
}

export async function publicJobSummaryGET(_request: Request, context: RouteContext) {
  const found = await ownerJob(context);
  if ("failure" in found) return found.failure;
  return response({ contractVersion: PASC_CONTRACT_VERSION, jobId: found.job.id, status: found.job.status, summary: parseJsonRecord(found.job.summary_json) });
}

export async function publicJobArtifactsGET(_request: Request, context: RouteContext) {
  const found = await ownerJob(context);
  if ("failure" in found) return found.failure;
  const items = await listPascArtifacts(env.DB, found.job.id, found.user.userId, found.job.attempt_count);
  return response({
    contractVersion: PASC_CONTRACT_VERSION,
    jobId: found.job.id,
    artifacts: items.map(item => ({
      id: item.id,
      kind: item.kind,
      chunkIndex: item.chunk_index,
      contentType: item.content_type,
      sizeBytes: item.size_bytes,
      sha256: item.sha256,
      recordCount: item.record_count,
      downloadUrl: "/v1/jobs/" + found.job.id + "/artifacts/" + encodeURIComponent(item.id),
      createdAt: new Date(item.created_at).toISOString(),
    })),
  });
}

export async function publicJobArtifactGET(_request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return errorResponse("PASC_JOB_AUTH_REQUIRED", "请先登录后再下载任务工件。", 401);
  const { jobId, artifactId = "" } = await context.params;
  const artifact = await getPascArtifact(env.DB, jobId, user.userId, decodeURIComponent(artifactId));
  if (!artifact) return errorResponse("PASC_ARTIFACT_NOT_FOUND", "任务工件不存在。", 404);
  const object = await env.DATASETS.get(artifact.object_key);
  if (!object || !("body" in object)) return errorResponse("PASC_ARTIFACT_NOT_FOUND", "任务工件对象不存在。", 404);
  return new Response(object.body, {
    headers: {
      "content-type": artifact.content_type,
      "content-length": String(artifact.size_bytes),
      "content-disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(artifact.kind + (artifact.chunk_index >= 0 ? "-" + artifact.chunk_index : "")),
      "etag": object.httpEtag,
      "cache-control": "private, no-store",
    },
  });
}

export async function publicJobCancelPOST(_request: Request, context: RouteContext) {
  const user = await getChatGPTUser();
  if (!user) return errorResponse("PASC_JOB_AUTH_REQUIRED", "请先登录后再取消任务。", 401);
  const { jobId } = await context.params;
  const job = await requestPascJobCancellation(env.DB, jobId, user.userId);
  if (!job) return errorResponse("PASC_JOB_NOT_FOUND", "任务不存在。", 404);
  return response({ contractVersion: PASC_CONTRACT_VERSION, job: pascJobView(job) }, 202);
}

export async function publicJobMapGET(request: Request, context: RouteContext) {
  const found = await ownerJob(context);
  if ("failure" in found) return found.failure;
  if (found.job.status !== "completed") return errorResponse("PASC_JOB_NOT_COMPLETE", "任务完成后才能加载结果地图。", 409);
  const zoom = Number(new URL(request.url).searchParams.get("zoom") ?? 9);
  const kind = mapArtifactKindForZoom(Number.isFinite(zoom) ? zoom : 9);
  const artifact = await env.DB.prepare("SELECT * FROM pasc_artifacts WHERE job_id = ? AND owner_id = ? AND attempt = ? AND kind = ? AND chunk_index = -1")
    .bind(found.job.id, found.user.userId, found.job.attempt_count, kind).first<{ object_key: string; content_type: string; size_bytes: number }>();
  if (!artifact) return errorResponse("PASC_MAP_ARTIFACT_NOT_FOUND", "当前层级结果地图尚未生成。", 404);
  const object = await env.DATASETS.get(artifact.object_key);
  if (!object || !("body" in object)) return errorResponse("PASC_MAP_ARTIFACT_NOT_FOUND", "结果地图对象不存在。", 404);
  return new Response(object.body, { headers: { "content-type": artifact.content_type, "content-length": String(artifact.size_bytes), "cache-control": "private, no-store", "x-pasc-map-level": kind } });
}

export async function internalClaimPOST(request: Request) {
  if (!await consumerAuthorized(request)) return errorResponse("PASC_CONSUMER_AUTH_FAILED", "消费者鉴权失败。", 401);
  let body: { workerId?: unknown; leaseSeconds?: unknown } = {};
  try { body = await request.json() as typeof body; } catch { body = {}; }
  const workerId = typeof body.workerId === "string" && body.workerId.trim() ? body.workerId.trim().slice(0, 120) : "python-consumer";
  const leaseMs = Math.max(60, Math.min(1800, Number(body.leaseSeconds ?? 300))) * 1000;
  const job = await claimPascJob(env.DB, workerId, leaseMs);
  if (!job) return new Response(null, { status: 204, headers: NO_STORE });
  const config = jobConfig(job);
  return response({
    contractVersion: PASC_CONTRACT_VERSION,
    job: pascJobView(job),
    leaseToken: job.lease_token,
    attempt: job.attempt_count,
    sourcePath: "/v1/internal/jobs/" + job.id + "/source",
    progressPath: "/v1/internal/jobs/" + job.id + "/progress",
    artifactPath: "/v1/internal/jobs/" + job.id + "/artifacts",
    completePath: "/v1/internal/jobs/" + job.id + "/complete",
    failPath: "/v1/internal/jobs/" + job.id + "/fail",
    request: config,
  });
}

async function internalJob(request: Request, context: RouteContext) {
  if (!await consumerAuthorized(request)) return { failure: errorResponse("PASC_CONSUMER_AUTH_FAILED", "消费者鉴权失败。", 401) };
  const { jobId } = await context.params;
  const job = await getPascJob(env.DB, jobId);
  if (!job) return { failure: errorResponse("PASC_JOB_NOT_FOUND", "任务不存在。", 404) };
  return { job };
}

function leaseToken(request: Request) {
  return (request.headers.get("x-pasc-lease-token") ?? "").trim();
}

export async function internalSourceGET(request: Request, context: RouteContext) {
  const found = await internalJob(request, context);
  if ("failure" in found) return found.failure;
  if (!leaseToken(request) || leaseToken(request) !== found.job.lease_token) return errorResponse("PASC_JOB_LEASE_INVALID", "任务租约无效。", 409);
  const dataset = await env.DB.prepare("SELECT source_key, name FROM datasets WHERE id = ? AND owner_id = ?")
    .bind(found.job.dataset_id, found.job.owner_id).first<{ source_key: string; name: string }>();
  if (!dataset) return errorResponse("PASC_DATASET_NOT_FOUND", "任务数据集不存在。", 404);
  const object = await env.DATASETS.get(dataset.source_key);
  if (!object || !("body" in object)) return errorResponse("PASC_DATASET_SOURCE_NOT_FOUND", "任务原始文件不存在。", 404);
  return new Response(object.body, {
    headers: {
      "content-type": object.httpMetadata?.contentType ?? "text/csv; charset=utf-8",
      "content-length": String(object.size),
      "cache-control": "private, no-store",
    },
  });
}

export async function internalProgressPOST(request: Request, context: RouteContext) {
  const found = await internalJob(request, context);
  if ("failure" in found) return found.failure;
  const token = leaseToken(request);
  let input: PascJobProgressInput;
  try { input = await request.json() as PascJobProgressInput; }
  catch { return errorResponse("PASC_BAD_REQUEST", "进度请求必须是 UTF-8 JSON。", 422); }
  const job = await updatePascJobProgress(env.DB, found.job.id, token, input);
  if (!job) return errorResponse("PASC_JOB_LEASE_INVALID", "任务租约无效或已过期。", 409);
  return response({ contractVersion: PASC_CONTRACT_VERSION, job: pascJobView(job), cancelRequested: Boolean(job.cancel_requested) });
}

export async function internalArtifactPUT(request: Request, context: RouteContext) {
  const found = await internalJob(request, context);
  if ("failure" in found) return found.failure;
  const token = leaseToken(request);
  if (!token || token !== found.job.lease_token || !["running", "cancelling"].includes(found.job.status)) return errorResponse("PASC_JOB_LEASE_INVALID", "任务租约无效。", 409);
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") as PascArtifactKind | null;
  const chunkIndex = Number(url.searchParams.get("chunk") ?? -1);
  if (!kind || !ARTIFACT_KINDS.has(kind) || !Number.isInteger(chunkIndex) || chunkIndex < -1) return errorResponse("PASC_ARTIFACT_INVALID", "任务工件类型或分块编号无效。", 422);
  const sha256 = (request.headers.get("x-content-sha256") ?? "").toLowerCase();
  const recordCount = Math.max(0, Number(request.headers.get("x-record-count") ?? 0));
  const declaredLength = Math.max(0, Number(request.headers.get("content-length") ?? 0));
  if (!/^[a-f0-9]{64}$/.test(sha256) || !request.body) return errorResponse("PASC_ARTIFACT_INVALID", "任务工件缺少 SHA-256 或内容。", 422);
  const objectKey = artifactObjectKey(found.job.owner_id, found.job.id, found.job.attempt_count, kind, chunkIndex);
  const contentType = (request.headers.get("content-type") ?? "application/octet-stream").slice(0, 160);
  const stored = await env.DATASETS.put(objectKey, request.body, {
    httpMetadata: { contentType },
    customMetadata: { ownerId: found.job.owner_id, jobId: found.job.id, kind, sha256, attempt: String(found.job.attempt_count) },
  });
  const artifact = await upsertPascArtifact(env.DB, {
    job_id: found.job.id,
    owner_id: found.job.owner_id,
    kind,
    chunk_index: chunkIndex,
    attempt: found.job.attempt_count,
    object_key: objectKey,
    content_type: contentType,
    size_bytes: stored?.size ?? declaredLength,
    sha256,
    record_count: Math.floor(recordCount),
  });
  return response({ contractVersion: PASC_CONTRACT_VERSION, artifact: artifact ? { id: artifact.id, kind: artifact.kind, chunkIndex: artifact.chunk_index, sha256: artifact.sha256 } : null });
}

export async function internalCompletePOST(request: Request, context: RouteContext) {
  const found = await internalJob(request, context);
  if ("failure" in found) return found.failure;
  let body: { summary?: unknown; model?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return errorResponse("PASC_BAD_REQUEST", "完成请求必须是 UTF-8 JSON。", 422); }
  const summary = body.summary && typeof body.summary === "object" && !Array.isArray(body.summary) ? body.summary as Record<string, unknown> : null;
  const model = body.model && typeof body.model === "object" && !Array.isArray(body.model) ? body.model as Record<string, unknown> : null;
  if (!summary || !model || typeof model.serviceVersion !== "string" || typeof model.buildHash !== "string" || typeof model.manifestSha256 !== "string" || !model.assetSha256 || typeof model.assetSha256 !== "object") {
    return errorResponse("PASC_JOB_COMPLETION_INVALID", "任务完成摘要或模型溯源无效。", 422);
  }
  const job = await completePascJob(env.DB, found.job.id, leaseToken(request), summary, {
    serviceVersion: model.serviceVersion,
    buildHash: model.buildHash,
    manifestSha256: model.manifestSha256,
    assetSha256: model.assetSha256 as Record<string, string>,
  });
  if (!job) return errorResponse("PASC_JOB_LEASE_INVALID", "任务租约无效。", 409);
  return response({ contractVersion: PASC_CONTRACT_VERSION, modelVersion: PASC_MODEL_VERSION, job: pascJobView(job) });
}

export async function internalFailPOST(request: Request, context: RouteContext) {
  const found = await internalJob(request, context);
  if ("failure" in found) return found.failure;
  let body: { code?: unknown; message?: unknown; retryable?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return errorResponse("PASC_BAD_REQUEST", "失败请求必须是 UTF-8 JSON。", 422); }
  const code = typeof body.code === "string" ? body.code : "PASC_JOB_FAILED";
  const message = typeof body.message === "string" ? body.message : "大数据任务失败。";
  const job = await failPascJob(env.DB, found.job.id, leaseToken(request), code, message, body.retryable !== false);
  if (!job) return errorResponse("PASC_JOB_LEASE_INVALID", "任务租约无效。", 409);
  return response({ contractVersion: PASC_CONTRACT_VERSION, job: pascJobView(job) });
}
