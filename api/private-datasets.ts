import type { VercelRequest, VercelResponse } from "@vercel/node";
import { del, get, list, put } from "@vercel/blob";
import { getRequestUser } from "../server/auth.js";

type DatasetMeta = {
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

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;
const MAX_USER_BYTES = 5 * 1024 * 1024 * 1024;
const validId = (value: unknown) => (/^[a-zA-Z0-9_-]{8,80}$/.test(String(value || "")) ? String(value) : null);
const json = (response: VercelResponse, body: unknown, status = 200) => {
  response.setHeader("Cache-Control", "private, no-store");
  return response.status(status).json(body);
};
const bodyJson = (request: VercelRequest) =>
  typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};

const readBlobJson = async <T,>(pathname: string): Promise<T | null> => {
  const result = await get(pathname, { access: "private" });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).json() as Promise<T>;
};

const listMetas = async (prefix: string) => {
  const result = await list({ prefix: `${prefix}meta/`, limit: 1000 });
  return (await Promise.all(result.blobs.map((blob) => readBlobJson<DatasetMeta>(blob.pathname)))).filter(Boolean) as DatasetMeta[];
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

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = getRequestUser(request.headers.cookie);
  if (!user) return json(response, { error: "请先登录" }, 401);
  if (!validOrigin(request)) return json(response, { error: "请求来源验证失败" }, 403);
  const op = String(request.query.op || "list");
  const id = validId(request.query.id);
  const prefix = `users/${user.id}/`;

  try {
    if (request.method === "GET" && op === "list") {
      const items = await listMetas(prefix);
      const usedBytes = items.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
      return json(response, { items, account: { userId: user.id, email: user.email, roles: user.roles, usedBytes, maxUserBytes: MAX_USER_BYTES, maxFileSize: MAX_FILE_SIZE, isAdmin: user.roles.includes("admin") } });
    }
    if (request.method === "GET" && op === "chunk" && id) {
      const index = Number(request.query.index);
      if (!Number.isInteger(index) || index < 0) return json(response, { error: "分块编号无效" }, 400);
      const result = await get(`${prefix}datasets/${id}/chunks/${index}`, { access: "private" });
      if (!result || result.statusCode !== 200) return json(response, { error: "分块不存在" }, 404);
      response.setHeader("Content-Type", "text/csv;charset=utf-8");
      response.setHeader("Cache-Control", "private, no-store");
      return result.stream.pipeTo(new WritableStream({
        write(chunk) { response.write(Buffer.from(chunk)); },
        close() { response.end(); },
        abort() { response.end(); },
      }));
    }
    if (request.method === "POST" && op === "chunk" && id) {
      const index = Number(request.query.index);
      if (!Number.isInteger(index) || index < 0) return json(response, { error: "分块编号无效" }, 400);
      const data = await rawBody(request);
      if (data.byteLength > 4.25 * 1024 * 1024) return json(response, { error: "单个分块不得超过 4.25 MB" }, 413);
      await put(`${prefix}datasets/${id}/chunks/${index}`, data, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "text/csv" });
      return json(response, { ok: true, index });
    }
    if (request.method === "POST" && op === "complete" && id) {
      const input = bodyJson(request) as Partial<DatasetMeta>;
      const now = new Date().toISOString();
      const size = Number(input.size) || 0;
      const chunks = Number(input.chunks) || 0;
      if (size > MAX_FILE_SIZE) return json(response, { error: "单个 CSV 不得超过 2 GB" }, 413);
      if (chunks < 1 || chunks > 520) return json(response, { error: "分块数量无效" }, 400);
      const items = await listMetas(prefix);
      if (items.reduce((sum, item) => sum + (Number(item.size) || 0), 0) + size > MAX_USER_BYTES) return json(response, { error: "当前账户已超过 5 GB 私有数据容量限制" }, 413);
      const name = String(input.name || "未命名数据集").slice(0, 160);
      const hasValidatedImport = Boolean(input.mapping && input.qualityReport);
      const recommendedFilter = input.recommendedFilter && Number.isFinite(Number(input.recommendedFilter.coherenceMin))
        ? { coherenceMin: Math.max(0, Math.min(1, Number(input.recommendedFilter.coherenceMin))) }
        : null;
      const meta: DatasetMeta = {
        id, name, size, chunks, uploadedAt: now, updatedAt: now,
        analysisReady: Boolean(input.analysisReady),
        status: input.analysisReady ? "ready" : "archived",
        schemaStatus: hasValidatedImport ? "validated" : "pending",
        version: items.filter((item) => item.name === name).length + 1,
        parentId: input.parentId,
        mapping: input.mapping,
        qualityReport: input.qualityReport,
        processStatus: hasValidatedImport ? "validated" : "uploaded",
        importDecision: input.importDecision === "recommended" ? "recommended" : "keep-all",
        recommendedFilter,
      };
      await put(`${prefix}meta/${id}.json`, JSON.stringify(meta), { access: "private", addRandomSuffix: false, contentType: "application/json" });
      return json(response, { ok: true, item: meta });
    }
    if (request.method === "PATCH" && id) {
      const pathname = `${prefix}meta/${id}.json`;
      const current = await readBlobJson<DatasetMeta>(pathname);
      if (!current) return json(response, { error: "数据集不存在" }, 404);
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
      await put(pathname, JSON.stringify(next), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json" });
      return json(response, { ok: true, item: next });
    }
    if (request.method === "DELETE" && id) {
      const chunks = await list({ prefix: `${prefix}datasets/${id}/`, limit: 1000 });
      await del([...chunks.blobs.map((blob) => blob.pathname), `${prefix}meta/${id}.json`]);
      return json(response, { ok: true });
    }
    return json(response, { error: "不支持的请求" }, 405);
  } catch (error) {
    console.error("private dataset error", error);
    return json(response, { error: "私有数据服务暂时不可用" }, 500);
  }
}
