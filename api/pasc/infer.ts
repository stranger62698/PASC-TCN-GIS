import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getRequestUser } from "../../server/auth.js";
import {
  PHASE_E_MAX_BODY_BYTES,
  PascProxyError,
  runPascOnlineProxy,
} from "../../app/lib/pasc-online.js";

const json = (response: VercelResponse, status: number, body: unknown) => {
  response.setHeader("Cache-Control", "private, no-store");
  return response.status(status).json(body);
};

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

const requestBody = (request: VercelRequest) => {
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return request.body || {};
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== "POST") return json(response, 405, { error: { code: "PASC_METHOD_NOT_ALLOWED", message: "仅支持 POST 请求。" } });
  const user = getRequestUser(request.headers.cookie);
  if (!user) return json(response, 401, { error: { code: "PASC_PHASE_E_AUTH_REQUIRED", message: "请先登录后再使用自动识别。" } });
  if (!validOrigin(request)) return json(response, 403, { error: { code: "PASC_ORIGIN_REJECTED", message: "请求来源验证失败。" } });

  try {
    const input = requestBody(request);
    if (Buffer.byteLength(JSON.stringify(input), "utf8") > PHASE_E_MAX_BODY_BYTES) {
      return json(response, 413, { error: { code: "PASC_PHASE_E_BODY_LIMIT_EXCEEDED", message: "单批在线识别请求超过 8 MiB 限制。" } });
    }
    const result = await runPascOnlineProxy(input, {
      serviceBaseUrl: process.env.PASC_SERVICE_BASE_URL || "",
      serviceApiKey: process.env.PASC_SERVICE_API_KEY || "",
    });
    return json(response, 200, result);
  } catch (error) {
    if (error instanceof PascProxyError) {
      return json(response, error.status, { error: { code: error.code, message: error.message, details: error.details } });
    }
    console.error("PASC inference proxy error", error);
    return json(response, 502, { error: { code: "PASC_PHASE_E_PROXY_FAILED", message: "在线识别代理失败；当前地图数据与已有结果已保留。" } });
  }
}
