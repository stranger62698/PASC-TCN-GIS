export const PRIVATE_DATASET_ENDPOINT = "/api/private-datasets";
export const PRIVATE_DATASET_CHUNK_SIZE = 4 * 1024 * 1024;

type ErrorBody = { error?: unknown };

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
      if (!response.ok) throw new Error(response.status === 404 ? `${fallback}：生产接口不存在或尚未部署。` : fallback);
      throw new Error(`${fallback}：服务返回了无效数据。`);
    }
  }
  if (!response.ok) {
    const error = body && typeof body === "object" ? (body as ErrorBody).error : null;
    throw new Error(typeof error === "string" && error.trim() ? error : fallback);
  }
  if (!body || typeof body !== "object") throw new Error(`${fallback}：服务没有返回有效数据。`);
  return body as T;
}

export async function listPrivateDatasets<T>(fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(privateDatasetUrl({ op: "list" }), { credentials: "include", cache: "no-store" });
  return readPrivateDatasetResponse<T>(response, "私有数据服务暂时不可用");
}

export async function uploadPrivateDatasetChunk(
  datasetId: string,
  index: number,
  body: Blob,
  fetchImpl: typeof fetch = fetch,
) {
  const response = await fetchImpl(privateDatasetUrl({ op: "chunk", id: datasetId, index }), {
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
  const response = await fetchImpl(privateDatasetUrl({ op: "complete", id: datasetId }), {
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
  const response = await fetchImpl(privateDatasetUrl({ id: datasetId }), {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return readPrivateDatasetResponse<T>(response, "数据集更新失败");
}

export async function deletePrivateDataset(datasetId: string, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(privateDatasetUrl({ id: datasetId }), { method: "DELETE", credentials: "include" });
  return readPrivateDatasetResponse<{ ok: true }>(response, "数据集删除失败");
}

export async function readPrivateDatasetSource(datasetId: string, chunks: number, fetchImpl: typeof fetch = fetch) {
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > 520) throw new Error("私有数据分块信息无效");
  const pieces: Uint8Array[] = [];
  let totalBytes = 0;
  for (let index = 0; index < chunks; index += 1) {
    const response = await fetchImpl(privateDatasetUrl({ op: "chunk", id: datasetId, index }), { credentials: "include", cache: "no-store" });
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