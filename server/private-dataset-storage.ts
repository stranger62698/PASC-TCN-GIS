import {
  BlobAccessError, BlobError, BlobServiceNotAvailable, BlobServiceRateLimited,
  BlobStoreNotFoundError, BlobStoreSuspendedError, BlobUnknownError,
} from "@vercel/blob";

export type DatasetMeta = {
  id: string;
  name: string;
  size: number;
  chunks: number;
  uploadedAt: string;
  updatedAt: string;
  analysisReady: boolean;
  status: "archived" | "ready";
  schemaStatus: "pending" | "validated";
  version: number;
  parentId?: string;
  mapping?: Record<string, unknown>;
  qualityReport?: Record<string, unknown>;
  processStatus?: "uploaded" | "mapped" | "validated" | "converted";
  importDecision?: "recommended" | "keep-all";
  recommendedFilter?: { coherenceMin: number } | null;
};

export const PRIVATE_DATASET_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;
export const PRIVATE_DATASET_MAX_USER_BYTES = 5 * 1024 * 1024 * 1024;
export const PRIVATE_DATASET_CHUNK_BYTES = 4 * 1024 * 1024;

export type PrivateDatasetReader = {
  list: (options: { prefix: string; limit: number; cursor?: string }) => Promise<{ blobs: Array<{ pathname: string }>; hasMore: boolean; cursor?: string }>;
  get: (pathname: string, options: { access: "private"; useCache: false }) => Promise<{ statusCode: 200; stream: ReadableStream<Uint8Array> } | { statusCode: 304; stream: null } | null>;
};

export class PrivateDatasetError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly retryable = false) {
    super(message);
    this.name = "PrivateDatasetError";
  }
}

export function validatePrivateDatasetUpload(size: unknown, chunks: unknown): { size: number; chunks: number } {
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size <= 0) {
    throw new PrivateDatasetError("PRIVATE_DATASET_INVALID_UPLOAD", "文件大小必须是有效的正整数字节数。", 400);
  }
  if (size > PRIVATE_DATASET_MAX_FILE_BYTES) {
    throw new PrivateDatasetError("PRIVATE_DATASET_INVALID_UPLOAD", "单个 CSV 不得超过 2 GB", 413);
  }
  if (typeof chunks !== "number" || !Number.isSafeInteger(chunks) || chunks < 1 || chunks > 520 || chunks !== Math.ceil(size / PRIVATE_DATASET_CHUNK_BYTES)) {
    throw new PrivateDatasetError("PRIVATE_DATASET_INVALID_UPLOAD", "分块数量与文件大小不一致，请重新上传。", 400);
  }
  return { size, chunks };
}

export function normalizePrivateDatasetConfirmation(input: Partial<DatasetMeta>): Pick<DatasetMeta, "analysisReady" | "importDecision" | "recommendedFilter" | "mapping" | "qualityReport"> {
  return {
    analysisReady: Boolean(input.analysisReady),
    importDecision: input.importDecision === "recommended" ? "recommended" : "keep-all",
    recommendedFilter: input.recommendedFilter && Number.isFinite(Number(input.recommendedFilter.coherenceMin))
      ? { coherenceMin: Math.max(0, Math.min(1, Number(input.recommendedFilter.coherenceMin))) } : null,
    mapping: input.mapping ?? undefined,
    qualityReport: input.qualityReport ?? undefined,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/** Compare the confirmation that will be persisted, independently of JSON object key order. */
export function privateDatasetConfirmationKey(input: Partial<DatasetMeta>): string {
  return canonicalJson(normalizePrivateDatasetConfirmation(input));
}

const invalidManifest = () => new PrivateDatasetError("PRIVATE_DATASET_MANIFEST_INVALID", "私有数据清单损坏，无法可靠计算账户容量，请联系管理员修复。", 409);

export async function readPrivateDatasetMeta(pathname: string, storage: PrivateDatasetReader): Promise<DatasetMeta | null> {
  // Metadata is mutable; a cached value could restore an old name or undercount quota.
  const result = await storage.get(pathname, { access: "private", useCache: false });
  if (!result) return null;
  if (result.statusCode !== 200) throw invalidManifest();
  let value: unknown;
  try { value = await new Response(result.stream).json(); }
  catch (error) { if (error instanceof SyntaxError) throw invalidManifest(); throw error; }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidManifest();
  const meta = value as Partial<DatasetMeta>;
  if (typeof meta.id !== "string" || !/^[a-zA-Z0-9_-]{8,80}$/.test(meta.id) || !pathname.endsWith(`/${meta.id}.json`)
    || typeof meta.name !== "string" || !meta.name.trim()) throw invalidManifest();
  try { validatePrivateDatasetUpload(meta.size, meta.chunks); }
  catch { throw invalidManifest(); }
  return meta as DatasetMeta;
}

/** Follow every page, with cursor guards so malformed provider responses cannot loop forever. */
export async function listPrivateDatasetPaths(prefix: string, storage: PrivateDatasetReader): Promise<string[]> {
  const paths = new Set<string>(), cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await storage.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const blob of page.blobs) paths.add(blob.pathname);
    if (!page.hasMore) return [...paths];
    if (!page.cursor || cursors.has(page.cursor)) {
      throw new PrivateDatasetError("PRIVATE_DATASET_STORAGE_RESPONSE_INVALID", "私有数据清单分页读取失败，请稍后重试。", 502, true);
    }
    cursor = page.cursor; cursors.add(cursor);
  } while (cursor);
  return [...paths];
}

export async function listPrivateDatasetMetas(prefix: string, storage: PrivateDatasetReader): Promise<DatasetMeta[]> {
  const paths = await listPrivateDatasetPaths(`${prefix}meta/`, storage), items: DatasetMeta[] = [];
  // Bound concurrent reads instead of sending up to 1,000 requests at once.
  for (let start = 0; start < paths.length; start += 16) {
    const batch = await Promise.all(paths.slice(start, start + 16).map(path => readPrivateDatasetMeta(path, storage)));
    for (const item of batch) {
      if (!item) throw new PrivateDatasetError("PRIVATE_DATASET_MANIFEST_UNAVAILABLE", "私有数据清单读取不完整，请刷新后重试。", 409, true);
      items.push(item);
    }
  }
  return items;
}

export type PrivateDatasetFailure = { status: number; code: string; error: string; retryable: boolean; retryAfterSeconds?: number };

/** Only fixed public messages escape this boundary; SDK messages may contain internal details. */
export function privateDatasetFailure(error: unknown): PrivateDatasetFailure {
  if (error instanceof PrivateDatasetError) return { status: error.status, code: error.code, error: error.message, retryable: error.retryable };
  const message = error instanceof Error ? error.message : "";
  if (error instanceof BlobStoreNotFoundError || (error instanceof BlobError && /^Vercel Blob: (?:No blob credentials found\.|No read-write token found\.|Invalid token: unable to extract store ID|oidcToken was passed, but no storeId was found\.)/.test(message))) {
    return { status: 503, code: "PRIVATE_DATASET_STORAGE_CONFIGURATION", error: "私有数据存储尚未正确配置，请联系管理员。", retryable: false };
  }
  if (message === "AUTH_SECRET 未配置") {
    return { status: 503, code: "PRIVATE_DATASET_AUTH_CONFIGURATION", error: "登录验证服务尚未正确配置，请联系管理员。", retryable: false };
  }
  if (error instanceof BlobStoreSuspendedError) {
    return { status: 503, code: "PRIVATE_DATASET_STORAGE_SUSPENDED", error: "Vercel 私有数据存储已暂停，云端保存暂不可用。请联系管理员检查存储用量与恢复条件，或继续本机分析。", retryable: false };
  }
  if (error instanceof BlobAccessError || (error instanceof BlobError && /^Vercel Blob: (?:Failed to fetch blob: (?:401|403)(?:\s|$)|OIDC is enabled for this project, but not for the)/.test(message))) {
    return { status: 503, code: "PRIVATE_DATASET_STORAGE_ACCESS_DENIED", error: "私有数据存储授权不可用，请联系管理员。", retryable: false };
  }
  if (error instanceof BlobServiceRateLimited || (error instanceof BlobError && /^Vercel Blob: Failed to fetch blob: 429(?:\s|$)/.test(message))) {
    const seconds = error instanceof BlobServiceRateLimited ? error.retryAfter : 0;
    return { status: 429, code: "PRIVATE_DATASET_RATE_LIMITED", error: "私有数据请求过于频繁，请稍后重试。", retryable: true,
      ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfterSeconds: Math.min(86400, Math.ceil(seconds)) } : {}) };
  }
  if (error instanceof BlobServiceNotAvailable || error instanceof BlobUnknownError || (error instanceof TypeError && /^(?:fetch failed|Network request failed|Network request timed out)$/i.test(message))
    || (error instanceof BlobError && /^Vercel Blob: Failed to fetch blob: 5\d\d(?:\s|$)/.test(message))) {
    return { status: 503, code: "PRIVATE_DATASET_STORAGE_UNAVAILABLE", error: "私有数据存储服务暂时不可用，请稍后重试。", retryable: true };
  }
  return { status: 500, code: "PRIVATE_DATASET_REQUEST_FAILED", error: "私有数据服务暂时不可用", retryable: false };
}
