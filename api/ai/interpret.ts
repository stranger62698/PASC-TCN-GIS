import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRequestUser } from "../../server/auth.js";
import { analysisSummaryKey, sanitizeAnalysisSummary } from "../../app/lib/ai-summary.js";
import {
  AI_INTERPRET_REQUEST_MAX_BYTES,
  AI_INTERPRET_TIMEOUT_MS,
  AiProviderError,
  resolveAiProviderConfig,
  resolvePersonalAiProviderConfig,
  runAiInterpretationProvider,
} from "../../app/lib/ai-provider.js";
import type { RegionalInterpretation } from "../../app/lib/ai-analysis.js";

const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT = 20;
const CACHE_TTL_MS = 15 * 60 * 1_000;

type RateEntry = { startedAt: number; count: number };
type CacheEntry = { expiresAt: number; interpretation: RegionalInterpretation };

const rateEntries = new Map<string, RateEntry>();
const resultCache = new Map<string, CacheEntry>();

const json = (response: VercelResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  response.setHeader("Cache-Control", "private, no-store");
  Object.entries(headers).forEach(([name, value]) => response.setHeader(name, value));
  return response.status(status).json(body);
};

const fail = (response: VercelResponse, code: string, message: string, status: number, retryable = false, headers: Record<string, string> = {}) =>
  json(response, status, { error: { code, message, retryable } }, headers);

const validOrigin = (request: VercelRequest) => {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const expectedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "");
    return new URL(origin).host === expectedHost;
  } catch {
    return false;
  }
};

const bodyText = (request: VercelRequest) => {
  if (typeof request.body === "string") return request.body;
  return JSON.stringify(request.body ?? {});
};

const safeRequestUser = (request: VercelRequest) => {
  try { return getRequestUser(request.headers.cookie); }
  catch { return null; }
};

const requestIdentity = (request: VercelRequest, userId?: string) => {
  if (userId) return `user:${userId}`;
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const connecting = String(request.headers["cf-connecting-ip"] || "").trim();
  return `anonymous:${connecting || forwarded || "vercel"}`;
};

const consumeRateLimit = (identity: string, now: number) => {
  const current = rateEntries.get(identity);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateEntries.set(identity, { startedAt: now, count: 1 });
    return 0;
  }
  if (current.count >= RATE_LIMIT) return Math.ceil((RATE_WINDOW_MS - (now - current.startedAt)) / 1_000);
  current.count += 1;
  return 0;
};

const pruneMemory = (now: number) => {
  if (resultCache.size > 200) resultCache.forEach((entry, key) => { if (entry.expiresAt <= now) resultCache.delete(key); });
  if (rateEntries.size > 500) rateEntries.forEach((entry, key) => { if (now - entry.startedAt >= RATE_WINDOW_MS) rateEntries.delete(key); });
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return fail(response, "AI_METHOD_NOT_ALLOWED", "仅支持 POST 请求。", 405);
  if (!validOrigin(request)) return fail(response, "AI_ORIGIN_REJECTED", "请求来源验证失败。", 403);

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > AI_INTERPRET_REQUEST_MAX_BYTES) {
    return fail(response, "AI_BODY_LIMIT_EXCEEDED", "AI 摘要请求超过 20 KB 限制。", 413);
  }

  let text: string;
  try { text = bodyText(request); }
  catch { return fail(response, "AI_BAD_REQUEST", "AI 解读请求必须是 UTF-8 JSON。", 422); }
  if (Buffer.byteLength(text, "utf8") > AI_INTERPRET_REQUEST_MAX_BYTES) {
    return fail(response, "AI_BODY_LIMIT_EXCEEDED", "AI 摘要请求超过 20 KB 限制。", 413);
  }

  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { return fail(response, "AI_BAD_REQUEST", "AI 解读请求必须是 UTF-8 JSON。", 422); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fail(response, "AI_BAD_REQUEST", "AI 解读请求格式无效。", 422);

  const requestPayload = payload as { summary?: unknown; personalProvider?: unknown };
  let summary;
  try { summary = sanitizeAnalysisSummary(requestPayload.summary); }
  catch (error) { return fail(response, "AI_SUMMARY_INVALID", error instanceof Error ? error.message : "AnalysisSummary 无效。", 422); }

  let personalConfig: ReturnType<typeof resolvePersonalAiProviderConfig>;
  try { personalConfig = resolvePersonalAiProviderConfig(requestPayload.personalProvider); }
  catch (error) {
    if (error instanceof AiProviderError) return fail(response, error.code, error.message, error.status, error.retryable);
    return fail(response, "AI_PERSONAL_CREDENTIAL_INVALID", "个人 API 配置格式无效。", 422);
  }

  const user = safeRequestUser(request);
  const allowAnonymous = process.env.AI_ALLOW_ANONYMOUS === "true";
  const allowAnonymousPersonal = process.env.AI_ALLOW_PERSONAL_ANONYMOUS !== "false";
  if (!user && !allowAnonymous && !(personalConfig && allowAnonymousPersonal)) {
    return fail(response, "AI_AUTH_REQUIRED", "请先登录后再使用站点 AI 额度，或切换到个人 API。", 401);
  }

  try {
    const config = personalConfig ?? resolveAiProviderConfig(process.env);
    const credentialMode = personalConfig ? "personal" : "site";
    const identity = requestIdentity(request, user?.id);
    const now = Date.now();
    pruneMemory(now);
    const cacheKey = `${identity}:${credentialMode}:${config.provider}:${config.model}:${analysisSummaryKey(summary)}`;
    const cached = resultCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return json(response, 200, { interpretation: { ...cached.interpretation, cached: true } });

    const retryAfter = consumeRateLimit(identity, now);
    if (retryAfter) return fail(response, "AI_RATE_LIMITED", "AI 解读请求过于频繁，请稍后重试。", 429, true, { "Retry-After": String(retryAfter) });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_INTERPRET_TIMEOUT_MS);
    try {
      const interpretation = await runAiInterpretationProvider(summary, config, { signal: controller.signal });
      resultCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, interpretation });
      return json(response, 200, { interpretation });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof AiProviderError) return fail(response, error.code, error.message, error.status, error.retryable);
    console.error("AI interpretation error", error);
    return fail(response, "AI_INTERPRETATION_FAILED", "AI 区域解读失败；当前地图数据与已有结果已保留。", 502, true);
  }
}
