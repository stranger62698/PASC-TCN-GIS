export const PRIVATE_DATASET_ENDPOINT = "/api/private-datasets";
export const PRIVATE_DATASET_CHUNK_SIZE = 4 * 1024 * 1024;

type ErrorBody = { error?: unknown; code?: unknown; retryable?: unknown; requestId?: unknown };

export class PrivateDatasetRequestError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  requestId?: string;
  constructor(message: string, status: number, code: string, retryable: boolean, requestId?: string) {
    super(message);
    this.name = "PrivateDatasetRequestError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.requestId = requestId;
  }
}

function responseError(response: Response, fallback: string, body?: ErrorBody | null) {
  const nested = body?.error && typeof body.error === "object" ? body.error as { message?: unknown; code?: unknown; retryable?: unknown } : null;
  const serverMessage = typeof body?.error === "string" ? body.error : nested?.message;
  const code = body?.code ?? nested?.code;
  const inferredCode = response.status === 401 ? "PRIVATE_DATASET_AUTH_REQUIRED" : response.status === 404 ? "PRIVATE_DATASET_ENDPOINT_MISSING" : "PRIVATE_DATASET_REQUEST_FAILED";
  const message = typeof serverMessage === "string" && serverMessage.trim() ? serverMessage : response.status === 401 ? "登录状态已过期，请重新登录后重试；当前文件和字段映射仍保留。" : response.status === 404 ? `${fallback}：生产接口不存在或尚未部署。` : `${fallback}（HTTP ${response.status}）。`;
  return new PrivateDatasetRequestError(message, response.status,
    typeof code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : inferredCode,
    typeof (body?.retryable ?? nested?.retryable) === "boolean" ? Boolean(body?.retryable ?? nested?.retryable) : response.status === 408 || response.status === 429 || response.status >= 500,
    typeof body?.requestId === "string" ? body.requestId.slice(0, 100) : undefined);
}

async function privateDatasetFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  try { return await fetchImpl(url, init); }
  catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new PrivateDatasetRequestError("无法连接云端数据服务，请检查网络后重试；当前文件和字段映射仍保留。", 0, "PRIVATE_DATASET_NETWORK_UNAVAILABLE", true);
  }
}

export function privateDatasetUrl(parameters: Record<string, string | number>) {
  const query = new URLSearchParams(Object.entries(parameters).map(([key, value]) => [key, String(value)]));
  return `${PRIVATE_DATASET_ENDPOINT}?${query.toString()}`;
}

export async function readPrivateDatasetResponse<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try { body = JSON.parse(text) as unknown; }
    catch {
      if (!response.ok) throw responseError(response, fallback);
      throw new PrivateDatasetRequestError(`${fallback}：服务返回了无效数据。`, response.status, "PRIVATE_DATASET_RESPONSE_INVALID", true);
    }
  }
  if (!response.ok) {
    throw responseError(response, fallback, body && typeof body === "object" && !Array.isArray(body) ? body as ErrorBody : null);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new PrivateDatasetRequestError(`${fallback}：服务没有返回有效数据。`, response.status, "PRIVATE_DATASET_RESPONSE_INVALID", true);
  return body as T;
}

export async function listPrivateDatasets<T>(fetchImpl: typeof fetch = fetch) {
  const response = await privateDatasetFetch(fetchImpl, privateDatasetUrl({ op: "list" }), { credentials: "include", cache: "no-store" });
  return readPrivateDatasetResponse<T>(response, "私有数据服务暂时不可用");
}

export async function uploadPrivateDatasetChunk(
  datasetId: string,
  index: number,
  body: Blob,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await privateDatasetFetch(fetchImpl, privateDatasetUrl({ op: "chunk", id: datasetId, index }), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body,
  });
  return readPrivateDatasetResponse<{ ok: true; index: number }>(response, `第 ${index + 1} 个分块上传失败`);
}

export async function completePrivateDataset<T>(
  datasetId: string,
  metadata: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await privateDatasetFetch(fetchImpl, privateDatasetUrl({ op: "complete", id: datasetId }), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  return readPrivateDatasetResponse<T>(response, "数据集登记失败");
}

export async function patchPrivateDataset<T>(
  datasetId: string,
  patch: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await privateDatasetFetch(fetchImpl, privateDatasetUrl({ id: datasetId }), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readPrivateDatasetResponse<T>(response, "数据集更新失败");
}

export async function deletePrivateDataset(datasetId: string, fetchImpl: typeof fetch = fetch) {
  const response = await privateDatasetFetch(fetchImpl, privateDatasetUrl({ id: datasetId }), { method: "DELETE", credentials: "include" });
  return readPrivateDatasetResponse<{ ok: true }>(response, "数据集删除失败");
}

export async function readPrivateDatasetSource(datasetId: string, chunks: number, fetchImpl: typeof fetch = fetch) {
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > 520) throw new Error("私有数据分块信息无效");
  const pieces: Uint8Array[] = [];
  let totalBytes = 0;
  for (let index = 0; index < chunks; index += 1) {
    const response = await privateDatasetFetch(fetchImpl, privateDatasetUrl({ op: "chunk", id: datasetId, index }), { credentials: "include", cache: "no-store" });
    if (!response.ok) {
      await readPrivateDatasetResponse(response, `第 ${index + 1} 个分块读取失败`);
      throw new Error(`第 ${index + 1} 个分块读取失败`);
    }
    const piece = new Uint8Array(await response.arrayBuffer());
    pieces.push(piece);
    totalBytes += piece.byteLength;
  }
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  pieces.forEach(piece => { combined.set(piece, offset); offset += piece.byteLength; });
  return new TextDecoder("utf-8").decode(combined);
}
