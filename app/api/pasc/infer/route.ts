import { getChatGPTUser } from "../../../chatgpt-auth";
import {
  PHASE_E_MAX_BODY_BYTES,
  PascProxyError,
  runPascOnlineProxy,
} from "../../../lib/pasc-online";
import { PASC_CONTRACT_VERSION } from "../../../types/pasc";

const noStoreHeaders = { "cache-control": "no-store" };

function errorResponse(code: string, message: string, status: number, details: Record<string, unknown> = {}) {
  return Response.json(
    {
      contractVersion: PASC_CONTRACT_VERSION,
      error: { code, message, details },
    },
    { status, headers: noStoreHeaders },
  );
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return errorResponse("PASC_PHASE_E_AUTH_REQUIRED", "请先登录后再使用在线识别。", 401);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > PHASE_E_MAX_BODY_BYTES) {
    return errorResponse("PASC_PHASE_E_BODY_LIMIT_EXCEEDED", "在线识别请求超过 8 MiB 限制。", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > PHASE_E_MAX_BODY_BYTES) {
    return errorResponse("PASC_PHASE_E_BODY_LIMIT_EXCEEDED", "在线识别请求超过 8 MiB 限制。", 413);
  }
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { return errorResponse("PASC_BAD_REQUEST", "在线识别请求必须是 UTF-8 JSON。", 422); }

  const runtimeEnv = typeof process !== "undefined" ? process.env : {};
  try {
    const result = await runPascOnlineProxy(payload, {
      serviceBaseUrl: runtimeEnv.PASC_SERVICE_BASE_URL ?? "",
      serviceApiKey: runtimeEnv.PASC_SERVICE_API_KEY ?? "",
    });
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof PascProxyError) {
      return errorResponse(error.code, error.message, error.status, error.details);
    }
    return errorResponse("PASC_PHASE_E_PROXY_FAILED", "在线识别代理失败；当前地图数据与已有结果已保留。", 502);
  }
}
