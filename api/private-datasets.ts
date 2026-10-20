import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import { getRequestUser } from "../server/auth.js";
import { USER_DATA_LOCAL_ONLY, localDataOnlyResponse } from "../app/lib/data-processing-policy.js";
import {
  listPrivateDatasetMetas, listPrivateDatasetPaths, readPrivateDatasetMeta, validatePrivateDatasetUpload,
  normalizePrivateDatasetConfirmation, privateDatasetConfirmationKey,
  privateDatasetFailure, PrivateDatasetError, PRIVATE_DATASET_MAX_FILE_BYTES as MAX_FILE_SIZE,
  PRIVATE_DATASET_MAX_USER_BYTES as MAX_USER_BYTES, type DatasetMeta, type PrivateDatasetReader,
} from "../server/private-dataset-storage.js";

export type PrivateDatasetDependencies = {
  storage: PrivateDatasetReader & {
    put: (pathname: string, body: string | Buffer, options: { access: "private"; addRandomSuffix: false; allowOverwrite?: boolean; contentType: string }) => Promise<unknown>;
    del: (paths: string[]) => Promise<unknown>;
  };
  resolveUser: typeof getRequestUser;
  logError: (diagnostic: { requestId: string; operation: string; code: string; status: number; retryable: boolean }) => void;
};

const validId = (value: unknown) => (/^[a-zA-Z0-9_-]{8,80}$/.test(String(value || "")) ? String(value) : null);
const json = (response: VercelResponse, body: unknown, status = 200) => {
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("Content-Type", "application/json;charset=utf-8");
  return response.status(status).json(body);
};
const bodyJson = (request: VercelRequest): Partial<DatasetMeta> => {
  let value: unknown;
  try { value = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body; }
  catch { throw new PrivateDatasetError("PRIVATE_DATASET_INVALID_REQUEST", "请求必须包含有效的 JSON 数据。", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PrivateDatasetError("PRIVATE_DATASET_INVALID_REQUEST", "请求必须包含有效的 JSON 对象。", 400);
  return value as Partial<DatasetMeta>;
};

const rawBody = async (request: VercelRequest) => {
  if (Buffer.isBuffer(request.body)) return request.body;
  if (request.body instanceof Uint8Array) return Buffer.from(request.body);
  if (typeof request.body === "string") return Buffer.from(request.body);
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const validOrigin = (request: VercelRequest) => {
  const origin = request.headers.origin;
  if (!origin || request.method === "GET") return true;
  try {
    const expectedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "");
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
};

export function createPrivateDatasetHandler(dependencies: Partial<PrivateDatasetDependencies> = {}) {
  const storage = dependencies.storage ?? { del, get, list, put };
  const resolveUser = dependencies.resolveUser ?? getRequestUser;
  const logError = dependencies.logError ?? (diagnostic => console.error("private dataset error", diagnostic));
  return async function handler(request: VercelRequest, response: VercelResponse) {
    const op = String(request.query.op || "list");
    const id = validId(request.query.id);
    const operation = request.method === "GET" && op === "list" ? "list"
      : request.method === "GET" && op === "chunk" ? "read-chunk"
      : request.method === "POST" && op === "chunk" ? "upload-chunk"
      : request.method === "POST" && op === "complete" ? "complete"
      : request.method === "PATCH" ? "update" : request.method === "DELETE" ? "delete" : "unsupported";
    const requestId = randomUUID();
    response.setHeader("X-Request-Id", requestId);
    const fail = (error: string, status: number, code: string, retryable = false) => json(response, { error, code, retryable, operation, requestId }, status);

    try {
      const user = resolveUser(request.headers.cookie);
      if (!user) return fail("请先登录", 401, "PRIVATE_DATASET_LOGIN_REQUIRED");
      if (!validOrigin(request)) return fail("请求来源验证失败", 403, "PRIVATE_DATASET_ORIGIN_REJECTED");
      const prefix = `users/${user.id}/`;
      if (request.method === "GET" && op === "list") {
        const items = await listPrivateDatasetMetas(prefix, storage);
        const usedBytes = items.reduce((sum, item) => sum + item.size, 0);
        return json(response, { items, account: { userId: user.id, email: user.email, roles: user.roles, usedBytes, maxUserBytes: MAX_USER_BYTES, maxFileSize: MAX_FILE_SIZE, isAdmin: user.roles.includes("admin") } });
      }
      if (request.method === "GET" && op === "chunk" && id) {
        const index = Number(request.query.index);
        if (!Number.isInteger(index) || index < 0 || index >= 520) return fail("分块编号无效", 400, "PRIVATE_DATASET_INVALID_CHUNK");
        const result = await storage.get(`${prefix}datasets/${id}/chunks/${index}`, { access: "private", useCache: false });
        if (!result || result.statusCode !== 200) return fail("分块不存在", 404, "PRIVATE_DATASET_CHUNK_NOT_FOUND");
        response.setHeader("Content-Type", "text/csv;charset=utf-8");
        response.setHeader("Cache-Control", "private, no-store");
        await result.stream.pipeTo(new WritableStream({
          write(chunk) { response.write(Buffer.from(chunk)); },
          close() { response.end(); },
          abort() { response.end(); },
        }));
        return;
      }
      if (request.method === "POST" && op === "chunk" && id) {
        const index = Number(request.query.index);
        if (!Number.isInteger(index) || index < 0 || index >= 520) return fail("分块编号无效", 400, "PRIVATE_DATASET_INVALID_CHUNK");
        const data = await rawBody(request);
        if (data.byteLength > 4.25 * 1024 * 1024) return fail("单个分块不得超过 4.25 MB", 413, "PRIVATE_DATASET_CHUNK_TOO_LARGE");
        await storage.put(`${prefix}datasets/${id}/chunks/${index}`, data, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "text/csv" });
        return json(response, { ok: true, index });
      }
      if (request.method === "POST" && op === "complete" && id) {
        const input = bodyJson(request);
        const now = new Date().toISOString();
        const { size, chunks } = validatePrivateDatasetUpload(input.size, input.chunks);
        const name = String(input.name || "未命名数据集").trim().slice(0, 160) || "未命名数据集";
        const parentId = input.parentId === undefined ? undefined : validId(input.parentId);
        if (parentId === null) return fail("父数据集编号无效", 400, "PRIVATE_DATASET_INVALID_UPLOAD");
        const confirmation = normalizePrivateDatasetConfirmation(input);
        const confirmationKey = privateDatasetConfirmationKey(confirmation);
        const existingResult = (existing: DatasetMeta) => {
          if (existing.name !== name || existing.size !== size || existing.chunks !== chunks || existing.parentId !== parentId
            || privateDatasetConfirmationKey(existing) !== confirmationKey) {
            throw new PrivateDatasetError("PRIVATE_DATASET_IMPORT_CONFLICT", "该导入已保存，当前确认配置与已保存记录不一致；请查看已有数据或重新选择创建新版本。", 409);
          }
          return json(response, { ok: true, item: existing });
        };
        const pathname = `${prefix}meta/${id}.json`;
        const existing = await readPrivateDatasetMeta(pathname, storage);
        if (existing) return existingResult(existing);
        const items = await listPrivateDatasetMetas(prefix, storage);
        const concurrent = items.find(item => item.id === id);
        if (concurrent) return existingResult(concurrent);
        if (items.reduce((sum, item) => sum + item.size, 0) + size > MAX_USER_BYTES) return fail("当前账户已超过 5 GB 私有数据容量限制", 413, "PRIVATE_DATASET_QUOTA_EXCEEDED");
        const hasValidatedImport = Boolean(confirmation.mapping && confirmation.qualityReport);
        const meta: DatasetMeta = {
          id, name, size, chunks, uploadedAt: now, updatedAt: now,
          ...confirmation,
          status: confirmation.analysisReady ? "ready" : "archived",
          schemaStatus: hasValidatedImport ? "validated" : "pending",
          version: items.filter((item) => item.name === name).length + 1,
          parentId,
          processStatus: hasValidatedImport ? "validated" : "uploaded",
        };
        try { await storage.put(pathname, JSON.stringify(meta), { access: "private", addRandomSuffix: false, contentType: "application/json" }); }
        catch (error) {
          // A transport failure can happen after the write committed, or another retry can win.
          const committed = await readPrivateDatasetMeta(pathname, storage);
          if (committed) return existingResult(committed);
          throw error;
        }
        return json(response, { ok: true, item: meta });
      }
      if (request.method === "PATCH" && id) {
        const pathname = `${prefix}meta/${id}.json`;
        const current = await readPrivateDatasetMeta(pathname, storage);
        if (!current) return fail("数据集不存在", 404, "PRIVATE_DATASET_NOT_FOUND");
        const input = bodyJson(request) as Partial<DatasetMeta>;
        const next: DatasetMeta = {
          ...current,
          name: String(input.name || current.name).trim().slice(0, 160) || current.name,
          schemaStatus: input.schemaStatus === "validated" ? "validated" : current.schemaStatus,
          mapping: input.mapping ?? current.mapping,
          qualityReport: input.qualityReport ?? current.qualityReport,
          processStatus: input.processStatus ?? current.processStatus,
          importDecision: input.importDecision === "recommended" || input.importDecision === "keep-all" ? input.importDecision : current.importDecision,
          recommendedFilter: input.recommendedFilter === null ? null : input.recommendedFilter ?? current.recommendedFilter,
          updatedAt: new Date().toISOString(),
        };
        await storage.put(pathname, JSON.stringify(next), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
        return json(response, { ok: true, item: next });
      }
      if (request.method === "DELETE" && id) {
        const chunks = await listPrivateDatasetPaths(`${prefix}datasets/${id}/`, storage);
        await storage.del([...chunks, `${prefix}meta/${id}.json`]);
        return json(response, { ok: true });
      }
      return fail("不支持的请求", 405, "PRIVATE_DATASET_METHOD_NOT_ALLOWED");
    } catch (error) {
      const failure = privateDatasetFailure(error);
      logError({ requestId, operation, code: failure.code, status: failure.status, retryable: failure.retryable });
      if (response.headersSent) { response.destroy(); return; }
      if (failure.retryAfterSeconds) response.setHeader("Retry-After", String(failure.retryAfterSeconds));
      return fail(failure.error, failure.status, failure.code, failure.retryable);
    }
  };
}

const cloudHandler = createPrivateDatasetHandler();
export default function handler(request: VercelRequest, response: VercelResponse) {
  if (USER_DATA_LOCAL_ONLY) return json(response, localDataOnlyResponse(), 403);
  return cloudHandler(request, response);
}
