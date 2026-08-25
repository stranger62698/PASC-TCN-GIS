import type { VercelRequest, VercelResponse } from "@vercel/node";
import { QueueClient } from "@vercel/queue";
import { getRequestUser } from "../server/auth.js";
import {
  PASC_LARGE_TOPIC,
  cancelPascLargeJob,
  createPascLargeJob,
  getPascLargeJob,
  listPascLargeJobs,
  publicPascLargeJob,
  readPascLargeResult,
  retryPascLargeJob,
  type PascLargeEnqueue,
} from "../server/pasc-large-jobs.js";

const queue = new QueueClient({ region: "iad1" });
const enqueue: PascLargeEnqueue = async (message, idempotencyKey, delaySeconds = 0) => {
  await queue.send(PASC_LARGE_TOPIC, message, { idempotencyKey, retentionSeconds: 604800, delaySeconds });
};
const validId = (value: unknown) => (/^[a-zA-Z0-9_-]{8,80}$/.test(String(value || "")) ? String(value) : null);
const bodyJson = (request: VercelRequest) => typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
const json = (response: VercelResponse, value: unknown, status = 200) => {
  response.setHeader("Cache-Control", "private, no-store");
  return response.status(status).json(value);
};
const validOrigin = (request: VercelRequest) => {
  if (request.method === "GET" || !request.headers.origin) return true;
  try {
    const expectedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "");
    return new URL(request.headers.origin).host === expectedHost;
  } catch { return false; }
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const user = getRequestUser(request.headers.cookie);
  if (!user) return json(response, { error: { code: "AUTH_REQUIRED", message: "请先登录。" } }, 401);
  if (!validOrigin(request)) return json(response, { error: { code: "ORIGIN_REJECTED", message: "请求来源验证失败。" } }, 403);
  const op = String(request.query.op || "list");
  const jobId = validId(request.query.id);
  try {
    if (request.method === "GET" && op === "list") {
      const jobs = (await listPascLargeJobs(user.id)).map(publicPascLargeJob);
      return json(response, { jobs });
    }
    if (request.method === "GET" && op === "detail" && jobId) {
      const job = await getPascLargeJob(user.id, jobId);
      return job ? json(response, { job: publicPascLargeJob(job), events: [] }) : json(response, { error: { code: "NOT_FOUND", message: "任务不存在。" } }, 404);
    }
    if (request.method === "GET" && op === "result" && jobId) {
      const index = Number(request.query.index);
      const result = await readPascLargeResult(user.id, jobId, index);
      return result ? json(response, result) : json(response, { error: { code: "NOT_FOUND", message: "结果分块尚未生成。" } }, 404);
    }
    if (request.method === "POST" && op === "create") {
      const input = bodyJson(request) as { datasetId?: unknown };
      const datasetId = validId(input.datasetId);
      if (!datasetId) return json(response, { error: { code: "BAD_REQUEST", message: "数据集标识无效。" } }, 400);
      const created = await createPascLargeJob(user.id, datasetId, enqueue);
      return json(response, { job: publicPascLargeJob(created.job), created: created.created }, created.created ? 202 : 200);
    }
    if (request.method === "POST" && op === "cancel" && jobId) {
      const job = await cancelPascLargeJob(user.id, jobId);
      return job ? json(response, { job: publicPascLargeJob(job) }) : json(response, { error: { code: "NOT_FOUND", message: "任务不存在。" } }, 404);
    }
    if (request.method === "POST" && op === "retry" && jobId) {
      const job = await retryPascLargeJob(user.id, jobId, enqueue);
      return job ? json(response, { job: publicPascLargeJob(job) }) : json(response, { error: { code: "NOT_FOUND", message: "任务不存在。" } }, 404);
    }
    return json(response, { error: { code: "METHOD_NOT_ALLOWED", message: "不支持的任务请求。" } }, 405);
  } catch (error) {
    console.error("pasc large jobs error", error);
    return json(response, { error: { code: "PASC_LARGE_JOB_ERROR", message: error instanceof Error ? error.message : "后台分类服务暂时不可用。" } }, 500);
  }
}