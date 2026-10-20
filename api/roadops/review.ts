import type { VercelRequest, VercelResponse } from "@vercel/node";
import { USER_DATA_LOCAL_ONLY, localDataOnlyResponse } from "../../app/lib/data-processing-policy.js";
import { runRoadIssueTypeSafeReview } from "../../app/lib/roadops-typesafe.js";
import type { RoadEvidence, RoadIssue, RoadSegment } from "../../app/lib/roadops-quality.js";

const MAX_BODY_BYTES = 20_000;
const respond = (response: VercelResponse, status: number, body: unknown) => { response.setHeader("Cache-Control", "private, no-store"); return response.status(status).json(body); };
const fail = (response: VercelResponse, code: string, message: string, status: number, retryable = false) => respond(response, status, { error: { code, message, retryable } });

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (USER_DATA_LOCAL_ONLY) return respond(response, 403, localDataOnlyResponse());
  if (request.method !== "POST") return fail(response, "ROADOPS_TYPESAFE_METHOD", "仅支持 POST 请求。", 405);
  const origin = String(request.headers.origin ?? ""), host = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  if (origin) { try { if (new URL(origin).host !== host) return fail(response, "ROADOPS_TYPESAFE_ORIGIN", "请求来源验证失败。", 403); } catch { return fail(response, "ROADOPS_TYPESAFE_ORIGIN", "请求来源验证失败。", 403); } }
  const text = typeof request.body === "string" ? request.body : JSON.stringify(request.body ?? {});
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return fail(response, "ROADOPS_TYPESAFE_BODY_LIMIT", "语义复核请求超过 20 KB。", 413);
  let payload: { issue?: RoadIssue; segments?: RoadSegment[]; evidences?: RoadEvidence[] };
  try { payload = JSON.parse(text); } catch { return fail(response, "ROADOPS_TYPESAFE_BAD_REQUEST", "语义复核请求必须是 JSON。", 422); }
  if (!payload.issue?.id || !Array.isArray(payload.segments) || !Array.isArray(payload.evidences)) return fail(response, "ROADOPS_TYPESAFE_BAD_REQUEST", "语义复核请求缺少问题、道路或证据。", 422);
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return fail(response, "ROADOPS_TYPESAFE_NOT_CONFIGURED", "TypeSafe 为可选能力；服务器尚未配置 TYPESAFE_API_KEY。", 503);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const assessment = await runRoadIssueTypeSafeReview({ apiKey, issue: payload.issue, segments: payload.segments, evidences: payload.evidences, model: process.env.TYPESAFE_MODEL || undefined, signal: controller.signal });
    return respond(response, 200, { assessment });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "TypeSafe 语义复核超时。" : error instanceof Error ? error.message : "TypeSafe 语义复核失败。";
    return fail(response, "ROADOPS_TYPESAFE_FAILED", message, 502, true);
  } finally { clearTimeout(timeout); }
}
