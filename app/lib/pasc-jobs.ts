import { PASC_CONTRACT_VERSION, PASC_MODEL_VERSION } from "../types/pasc";

export const PASC_JOB_CHUNK_SIZE = 256;
export const PASC_JOB_MAX_ATTEMPTS = 3;
export const PASC_JOB_LEASE_MS = 5 * 60 * 1000;
export const PASC_JOB_MAP_LIMITS = { overview: 500, regional: 2000, detail: 5000 } as const;

export type PascJobStatus = "queued" | "running" | "retry_wait" | "cancelling" | "cancelled" | "completed" | "failed";
export type PascJobStage = "queued" | "claimed" | "downloading" | "validating" | "preprocessing" | "inference" | "writing" | "finalizing" | "completed" | "cancelled" | "failed";
export type PascArtifactKind = "validation" | "preprocessed" | "predictions" | "summary" | "audit" | "errors" | "map_level_0" | "map_level_1" | "map_level_2";

export type PascJobRow = {
  id: string;
  owner_id: string;
  dataset_id: string;
  dataset_name?: string;
  idempotency_key: string;
  contract_version: string;
  model_version: string;
  webgis_version: string;
  service_version: string | null;
  status: PascJobStatus;
  stage: PascJobStage;
  progress: number;
  total_points: number;
  processed_points: number;
  predicted_points: number;
  unsupported_points: number;
  chunk_size: number;
  current_chunk: number;
  total_chunks: number;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: number | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  worker_id: string | null;
  cancel_requested: number;
  request_json: string;
  summary_json: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  started_at: number | null;
  completed_at: number | null;
};

export type PascJobArtifactRow = {
  id: string;
  job_id: string;
  owner_id: string;
  kind: PascArtifactKind;
  chunk_index: number;
  attempt: number;
  object_key: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  record_count: number;
  created_at: number;
};

export type PascJobRequestConfig = {
  datasetName: string;
  mapping: Record<string, unknown>;
  settings: {
    displacementUnit: string;
    velocityUnit: string;
    signConvention: string;
    preprocessingState: string;
  };
  dateColumns: string[];
  sourceSizeBytes: number;
};

export type PascJobProgressInput = {
  stage: PascJobStage;
  progress: number;
  processedPoints: number;
  predictedPoints: number;
  unsupportedPoints: number;
  currentChunk: number;
  totalChunks: number;
  totalPoints?: number;
  message?: string;
};

export function parseJsonRecord(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function clampJobProgress(current: number, next: number, terminal = false) {
  if (terminal) return 100;
  const finite = Number.isFinite(next) ? next : current;
  return Math.max(current, Math.min(99.5, Math.max(0, finite)));
}

export function nextFailureState(attemptCount: number, maxAttempts: number, retryable: boolean, cancelRequested: boolean) {
  if (cancelRequested) return { status: "cancelled" as const, delayMs: 0 };
  if (retryable && attemptCount < maxAttempts) {
    return { status: "retry_wait" as const, delayMs: Math.min(15 * 60 * 1000, 30_000 * (2 ** Math.max(0, attemptCount - 1))) };
  }
  return { status: "failed" as const, delayMs: 0 };
}

export function mapArtifactKindForZoom(zoom: number): PascArtifactKind {
  if (zoom >= 13) return "map_level_2";
  if (zoom >= 10) return "map_level_1";
  return "map_level_0";
}

export function artifactObjectKey(ownerId: string, jobId: string, attempt: number, kind: PascArtifactKind, chunkIndex = -1) {
  const safeOwner = ownerId.replace(/[^A-Za-z0-9_.-]/g, "_");
  const safeJob = jobId.replace(/[^A-Za-z0-9_.-]/g, "_");
  const suffix = chunkIndex >= 0 ? "-chunk-" + String(chunkIndex).padStart(6, "0") : "";
  const extension = kind.startsWith("map_level_") || kind === "summary" || kind === "audit" || kind === "validation" ? ".json" : kind === "errors" ? ".csv.gz" : ".ndjson.gz";
  return "jobs/" + safeOwner + "/" + safeJob + "/attempt-" + attempt + "/" + kind + suffix + extension;
}

export function pascJobView(row: PascJobRow) {
  return {
    jobId: row.id,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name ?? parseJsonRecord(row.request_json).datasetName ?? row.dataset_id,
    contractVersion: row.contract_version,
    modelVersion: row.model_version,
    webgisVersion: row.webgis_version,
    serviceVersion: row.service_version,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    points: {
      total: row.total_points,
      processed: row.processed_points,
      predicted: row.predicted_points,
      unsupported: row.unsupported_points,
    },
    chunks: { current: row.current_chunk, total: row.total_chunks, size: row.chunk_size },
    attempts: { current: row.attempt_count, maximum: row.max_attempts },
    retryAt: row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    cancelRequested: Boolean(row.cancel_requested),
    summary: parseJsonRecord(row.summary_json),
    error: row.error_code ? { code: row.error_code, message: row.error_message ?? "任务失败" } : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
  };
}

async function addEvent(db: D1Database, job: Pick<PascJobRow, "id" | "owner_id" | "status" | "progress">, eventType: string, message: string, data: Record<string, unknown> = {}, now = Date.now()) {
  await db.prepare("INSERT INTO pasc_job_events (job_id, owner_id, event_type, status, progress, message, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(job.id, job.owner_id, eventType, job.status, job.progress, message.slice(0, 500), JSON.stringify(data), now).run();
}

export async function getPascJob(db: D1Database, jobId: string, ownerId?: string) {
  const sql = "SELECT j.*, d.name AS dataset_name FROM pasc_jobs j JOIN datasets d ON d.id = j.dataset_id WHERE j.id = ?" + (ownerId ? " AND j.owner_id = ?" : "");
  return ownerId
    ? db.prepare(sql).bind(jobId, ownerId).first<PascJobRow>()
    : db.prepare(sql).bind(jobId).first<PascJobRow>();
}

export async function listOwnerPascJobs(db: D1Database, ownerId: string, limit = 50) {
  const result = await db.prepare("SELECT j.*, d.name AS dataset_name FROM pasc_jobs j JOIN datasets d ON d.id = j.dataset_id WHERE j.owner_id = ? ORDER BY j.created_at DESC LIMIT ?")
    .bind(ownerId, Math.max(1, Math.min(100, limit))).all<PascJobRow>();
  return result.results ?? [];
}

export async function createPascJob(db: D1Database, input: {
  ownerId: string;
  datasetId: string;
  idempotencyKey: string;
  request: PascJobRequestConfig;
  totalPoints: number;
  chunkSize?: number;
  webgisVersion: string;
}) {
  const existing = await db.prepare("SELECT j.*, d.name AS dataset_name FROM pasc_jobs j JOIN datasets d ON d.id = j.dataset_id WHERE j.owner_id = ? AND j.idempotency_key = ?")
    .bind(input.ownerId, input.idempotencyKey).first<PascJobRow>();
  if (existing) return { row: existing, reused: true };
  const now = Date.now();
  const id = "job_" + crypto.randomUUID();
  const chunkSize = Math.max(40, Math.min(512, Math.floor(input.chunkSize ?? PASC_JOB_CHUNK_SIZE)));
  try {
    await db.batch([
      db.prepare("INSERT INTO pasc_jobs (id, owner_id, dataset_id, idempotency_key, contract_version, model_version, webgis_version, status, stage, progress, total_points, processed_points, predicted_points, unsupported_points, chunk_size, current_chunk, total_chunks, attempt_count, max_attempts, cancel_requested, request_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'queued', 0, ?, 0, 0, 0, ?, 0, ?, 0, ?, 0, ?, ?, ?)")
        .bind(id, input.ownerId, input.datasetId, input.idempotencyKey, PASC_CONTRACT_VERSION, PASC_MODEL_VERSION, input.webgisVersion, Math.max(0, input.totalPoints), chunkSize, input.totalPoints > 0 ? Math.ceil(input.totalPoints / chunkSize) : 0, PASC_JOB_MAX_ATTEMPTS, JSON.stringify(input.request), now, now),
      db.prepare("INSERT INTO pasc_job_events (job_id, owner_id, event_type, status, progress, message, data_json, created_at) VALUES (?, ?, 'created', 'queued', 0, '任务已进入持久队列', ?, ?)")
        .bind(id, input.ownerId, JSON.stringify({ datasetId: input.datasetId, chunkSize }), now),
    ]);
  } catch (error) {
    const raced = await db.prepare("SELECT j.*, d.name AS dataset_name FROM pasc_jobs j JOIN datasets d ON d.id = j.dataset_id WHERE j.owner_id = ? AND j.idempotency_key = ?")
      .bind(input.ownerId, input.idempotencyKey).first<PascJobRow>();
    if (raced) return { row: raced, reused: true };
    throw error;
  }
  const row = await getPascJob(db, id, input.ownerId);
  if (!row) throw new Error("PASC job insert did not persist");
  return { row, reused: false };
}

export async function requestPascJobCancellation(db: D1Database, jobId: string, ownerId: string) {
  const row = await getPascJob(db, jobId, ownerId);
  if (!row) return null;
  if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") return row;
  const now = Date.now();
  const status: PascJobStatus = row.status === "running" ? "cancelling" : "cancelled";
  const completedAt = status === "cancelled" ? now : null;
  await db.prepare("UPDATE pasc_jobs SET cancel_requested = 1, status = ?, stage = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ? AND owner_id = ?")
    .bind(status, status === "cancelled" ? "cancelled" : row.stage, now, completedAt, jobId, ownerId).run();
  const updated = await getPascJob(db, jobId, ownerId);
  if (updated) await addEvent(db, updated, "cancel_requested", status === "cancelled" ? "任务已取消" : "已请求取消，消费者将在分块边界停止", {}, now);
  return updated;
}

export async function claimPascJob(db: D1Database, workerId: string, leaseMs = PASC_JOB_LEASE_MS) {
  const now = Date.now();
  const candidate = await db.prepare("SELECT * FROM pasc_jobs WHERE cancel_requested = 0 AND attempt_count < max_attempts AND ((status = 'queued') OR (status = 'retry_wait' AND COALESCE(next_attempt_at, 0) <= ?) OR (status = 'running' AND COALESCE(lease_expires_at, 0) <= ?)) ORDER BY created_at ASC LIMIT 1")
    .bind(now, now).first<PascJobRow>();
  if (!candidate) return null;
  const token = crypto.randomUUID();
  const expires = now + Math.max(60_000, leaseMs);
  const updated = await db.prepare("UPDATE pasc_jobs SET status = 'running', stage = 'claimed', attempt_count = attempt_count + 1, lease_token = ?, lease_expires_at = ?, worker_id = ?, next_attempt_at = NULL, error_code = NULL, error_message = NULL, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND cancel_requested = 0 AND attempt_count = ? AND ((status = 'queued') OR (status = 'retry_wait' AND COALESCE(next_attempt_at, 0) <= ?) OR (status = 'running' AND COALESCE(lease_expires_at, 0) <= ?))")
    .bind(token, expires, workerId.slice(0, 120), now, now, candidate.id, candidate.attempt_count, now, now).run();
  if (!updated.meta.changes) return null;
  const row = await getPascJob(db, candidate.id);
  if (!row) return null;
  await addEvent(db, row, candidate.status === "running" ? "recovered" : "claimed", candidate.status === "running" ? "过期租约已恢复并重新认领" : "Python 消费者已认领任务", { workerId, leaseExpiresAt: expires }, now);
  return row;
}

export async function updatePascJobProgress(db: D1Database, jobId: string, leaseToken: string, input: PascJobProgressInput, leaseMs = PASC_JOB_LEASE_MS) {
  const row = await db.prepare("SELECT * FROM pasc_jobs WHERE id = ? AND lease_token = ? AND status IN ('running','cancelling')")
    .bind(jobId, leaseToken).first<PascJobRow>();
  if (!row) return null;
  const now = Date.now();
  const progress = clampJobProgress(row.progress, input.progress);
  await db.prepare("UPDATE pasc_jobs SET stage = ?, progress = ?, total_points = ?, processed_points = ?, predicted_points = ?, unsupported_points = ?, current_chunk = ?, total_chunks = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_token = ? AND status IN ('running','cancelling')")
    .bind(input.stage, progress, Math.max(row.total_points, input.totalPoints ?? 0), Math.max(row.processed_points, input.processedPoints), Math.max(row.predicted_points, input.predictedPoints), Math.max(row.unsupported_points, input.unsupportedPoints), Math.max(row.current_chunk, input.currentChunk), Math.max(row.total_chunks, input.totalChunks), now + Math.max(60_000, leaseMs), now, jobId, leaseToken).run();
  const updated = await getPascJob(db, jobId);
  if (updated && input.message) await addEvent(db, updated, "progress", input.message, { stage: input.stage, currentChunk: input.currentChunk }, now);
  return updated;
}

export async function failPascJob(db: D1Database, jobId: string, leaseToken: string, code: string, message: string, retryable = true) {
  const row = await db.prepare("SELECT * FROM pasc_jobs WHERE id = ? AND lease_token = ? AND status IN ('running','cancelling')")
    .bind(jobId, leaseToken).first<PascJobRow>();
  if (!row) return null;
  const outcome = nextFailureState(row.attempt_count, row.max_attempts, retryable, Boolean(row.cancel_requested));
  const now = Date.now();
  const terminal = outcome.status === "failed" || outcome.status === "cancelled";
  await db.prepare("UPDATE pasc_jobs SET status = ?, stage = ?, next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL, worker_id = NULL, error_code = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND lease_token = ?")
    .bind(outcome.status, outcome.status === "cancelled" ? "cancelled" : outcome.status === "failed" ? "failed" : row.stage, outcome.delayMs ? now + outcome.delayMs : null, code.slice(0, 120), message.slice(0, 1000), terminal ? now : null, now, jobId, leaseToken).run();
  const updated = await getPascJob(db, jobId);
  if (updated) await addEvent(db, updated, outcome.status, outcome.status === "retry_wait" ? "分块失败，等待自动重试" : message, { code, retryable, attempt: row.attempt_count }, now);
  return updated;
}

export async function completePascJob(db: D1Database, jobId: string, leaseToken: string, summary: Record<string, unknown>, model: {
  serviceVersion: string;
  buildHash: string;
  manifestSha256: string;
  assetSha256: Record<string, string>;
}) {
  const row = await db.prepare("SELECT * FROM pasc_jobs WHERE id = ? AND lease_token = ? AND status IN ('running','cancelling')")
    .bind(jobId, leaseToken).first<PascJobRow>();
  if (!row) return null;
  if (row.cancel_requested) return failPascJob(db, jobId, leaseToken, "PASC_JOB_CANCELLED", "任务已按用户请求取消。", false);
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE pasc_jobs SET status = 'completed', stage = 'completed', progress = 100, summary_json = ?, service_version = ?, lease_token = NULL, lease_expires_at = NULL, worker_id = NULL, error_code = NULL, error_message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND lease_token = ?")
      .bind(JSON.stringify(summary), model.serviceVersion, now, now, jobId, leaseToken),
    db.prepare("INSERT INTO model_versions (model_version, contract_version, service_version, build_hash, manifest_sha256, asset_sha256_json, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(model_version) DO UPDATE SET service_version = excluded.service_version, build_hash = excluded.build_hash, manifest_sha256 = excluded.manifest_sha256, asset_sha256_json = excluded.asset_sha256_json, active = 1")
      .bind(PASC_MODEL_VERSION, PASC_CONTRACT_VERSION, model.serviceVersion, model.buildHash, model.manifestSha256, JSON.stringify(model.assetSha256), now),
  ]);
  const updated = await getPascJob(db, jobId);
  if (updated) await addEvent(db, updated, "completed", "任务完成，结果与审计工件已回写", { modelBuildHash: model.buildHash }, now);
  return updated;
}

export async function upsertPascArtifact(db: D1Database, input: Omit<PascJobArtifactRow, "id" | "created_at">) {
  const id = input.job_id + ":" + input.attempt + ":" + input.kind + ":" + input.chunk_index;
  const now = Date.now();
  await db.prepare("INSERT INTO pasc_artifacts (id, job_id, owner_id, kind, chunk_index, attempt, object_key, content_type, size_bytes, sha256, record_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(job_id, kind, chunk_index, attempt) DO UPDATE SET object_key = excluded.object_key, content_type = excluded.content_type, size_bytes = excluded.size_bytes, sha256 = excluded.sha256, record_count = excluded.record_count, created_at = excluded.created_at")
    .bind(id, input.job_id, input.owner_id, input.kind, input.chunk_index, input.attempt, input.object_key, input.content_type, input.size_bytes, input.sha256, input.record_count, now).run();
  return db.prepare("SELECT * FROM pasc_artifacts WHERE job_id = ? AND kind = ? AND chunk_index = ? AND attempt = ?")
    .bind(input.job_id, input.kind, input.chunk_index, input.attempt).first<PascJobArtifactRow>();
}

export async function listPascArtifacts(db: D1Database, jobId: string, ownerId: string, attempt: number) {
  const result = await db.prepare("SELECT * FROM pasc_artifacts WHERE job_id = ? AND owner_id = ? AND attempt = ? ORDER BY kind, chunk_index")
    .bind(jobId, ownerId, attempt).all<PascJobArtifactRow>();
  return result.results ?? [];
}

export async function getPascArtifact(db: D1Database, jobId: string, ownerId: string, artifactId: string) {
  return db.prepare("SELECT * FROM pasc_artifacts WHERE id = ? AND job_id = ? AND owner_id = ?")
    .bind(artifactId, jobId, ownerId).first<PascJobArtifactRow>();
}
