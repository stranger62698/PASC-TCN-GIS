import { getChatGPTUser } from "../../../chatgpt-auth";
import { analysisSummaryKey, sanitizeAnalysisSummary } from "../../../lib/ai-summary";
import {
  AI_INTERPRET_REQUEST_MAX_BYTES,
  AI_INTERPRET_TIMEOUT_MS,
  AiProviderError,
  resolveAiProviderConfig,
  resolvePersonalAiProviderConfig,
  runAiInterpretationProvider,
} from "../../../lib/ai-provider";
import type { RegionalInterpretation } from "../../../lib/ai-analysis";

const noStoreHeaders = { "cache-control": "no-store" };
const RATE_WINDOW_MS = 10 * 60 * 1_000;
const RATE_LIMIT = 20;
const CACHE_TTL_MS = 15 * 60 * 1_000;

type RateEntry = { startedAt: number; count: number };
type CacheEntry = { expiresAt: number; interpretation: RegionalInterpretation };

const rateEntries = new Map<string, RateEntry>();
const resultCache = new Map<string, CacheEntry>();

const errorResponse = (code: string, message: string, status: number, retryable = false, headers: Record<string, string> = {}) => Response.json(
  { error: { code, message, retryable } },
  { status, headers: { ...noStoreHeaders, ...headers } },
);

const requestIdentity = (request: Request, userId?: string) => {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const connecting = request.headers.get("cf-connecting-ip")?.trim();
  return `anonymous:${connecting || forwarded || "local"}`;
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

export async function POST(request: Request) {
  const runtimeEnv = typeof process !== "undefined" ? process.env : {};
  const user = await getChatGPTUser();
  const allowAnonymous = runtimeEnv.AI_ALLOW_ANONYMOUS === "true" || (runtimeEnv.NODE_ENV !== "production" && runtimeEnv.AI_ALLOW_ANONYMOUS_LOCAL !== "false");
  const allowAnonymousPersonal = runtimeEnv.AI_ALLOW_PERSONAL_ANONYMOUS !== "false";

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > AI_INTERPRET_REQUEST_MAX_BYTES) return errorResponse("AI_BODY_LIMIT_EXCEEDED", "AI 摘要请求超过 20 KB 限制。", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > AI_INTERPRET_REQUEST_MAX_BYTES) return errorResponse("AI_BODY_LIMIT_EXCEEDED", "AI 摘要请求超过 20 KB 限制。", 413);

  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { return errorResponse("AI_BAD_REQUEST", "AI 解读请求必须是 UTF-8 JSON。", 422); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return errorResponse("AI_BAD_REQUEST", "AI 解读请求格式无效。", 422);

  const requestPayload = payload as { summary?: unknown; personalProvider?: unknown };
  let summary;
  try { summary = sanitizeAnalysisSummary((payload as { summary?: unknown }).summary); }
  catch (error) { return errorResponse("AI_SUMMARY_INVALID", error instanceof Error ? error.message : "AnalysisSummary 无效。", 422); }

  let personalConfig: ReturnType<typeof resolvePersonalAiProviderConfig>;
  try { personalConfig = resolvePersonalAiProviderConfig(requestPayload.personalProvider); }
  catch (error) {
    if (error instanceof AiProviderError) return errorResponse(error.code, error.message, error.status, error.retryable);
    return errorResponse("AI_PERSONAL_CREDENTIAL_INVALID", "个人 API 配置格式无效。", 422);
  }
  if (!user && !allowAnonymous && !(personalConfig && allowAnonymousPersonal)) return errorResponse("AI_AUTH_REQUIRED", "请先登录后再使用站点 AI 额度。", 401);

  try {
    const config = personalConfig ?? resolveAiProviderConfig(runtimeEnv);
    const credentialMode = personalConfig ? "personal" : "site";
    const identity = requestIdentity(request, user?.userId);
    const now = Date.now();
    pruneMemory(now);
    const cacheKey = `${identity}:${credentialMode}:${config.provider}:${config.model}:${analysisSummaryKey(summary)}`;
    const cached = resultCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return Response.json({ interpretation: { ...cached.interpretation, cached: true } }, { headers: noStoreHeaders });

    const retryAfter = consumeRateLimit(identity, now);
    if (retryAfter) return errorResponse("AI_RATE_LIMITED", "AI 解读请求过于频繁，请稍后重试。", 429, true, { "retry-after": String(retryAfter) });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_INTERPRET_TIMEOUT_MS);
    const abort = () => controller.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    try {
      const interpretation = await runAiInterpretationProvider(summary, config, { signal: controller.signal });
      resultCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, interpretation });
      return Response.json({ interpretation }, { headers: noStoreHeaders });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", abort);
    }
  } catch (error) {
    if (error instanceof AiProviderError) return errorResponse(error.code, error.message, error.status, error.retryable);
    return errorResponse("AI_INTERPRETATION_FAILED", "AI 区域解读失败；当前地图数据与已有结果已保留。", 502, true);
  }
}
