import { runRoadIssueTypeSafeReview } from "../../../lib/roadops-typesafe";
import type { RoadEvidence, RoadIssue, RoadSegment } from "../../../lib/roadops-quality";

const MAX_BODY_BYTES = 20_000;
const noStore = { "cache-control": "private, no-store" };
const errorResponse = (code: string, message: string, status: number, retryable = false) => Response.json({ error: { code, message, retryable } }, { status, headers: noStore });

export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return errorResponse("ROADOPS_TYPESAFE_BODY_LIMIT", "语义复核请求超过 20 KB。", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return errorResponse("ROADOPS_TYPESAFE_BODY_LIMIT", "语义复核请求超过 20 KB。", 413);
  let payload: { issue?: RoadIssue; segments?: RoadSegment[]; evidences?: RoadEvidence[] };
  try { payload = JSON.parse(text); }
  catch { return errorResponse("ROADOPS_TYPESAFE_BAD_REQUEST", "语义复核请求必须是 JSON。", 422); }
  if (!payload.issue?.id || !Array.isArray(payload.segments) || !Array.isArray(payload.evidences)) return errorResponse("ROADOPS_TYPESAFE_BAD_REQUEST", "语义复核请求缺少问题、道路或证据。", 422);
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) return errorResponse("ROADOPS_TYPESAFE_NOT_CONFIGURED", "TypeSafe 为可选能力；服务器尚未配置 TYPESAFE_API_KEY。", 503);
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 8_000);
  const abort = () => controller.abort(); request.signal.addEventListener("abort", abort, { once: true });
  try {
    const assessment = await runRoadIssueTypeSafeReview({ apiKey, issue: payload.issue, segments: payload.segments, evidences: payload.evidences, model: process.env.TYPESAFE_MODEL || undefined, signal: controller.signal });
    return Response.json({ assessment }, { headers: noStore });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "TypeSafe 语义复核超时。" : error instanceof Error ? error.message : "TypeSafe 语义复核失败。";
    return errorResponse("ROADOPS_TYPESAFE_FAILED", message, 502, true);
  } finally { clearTimeout(timeout); request.signal.removeEventListener("abort", abort); }
}
