import { getRequestUser, type SessionUser } from "./auth.js";
import type { RoadOpsDrivingHttpResult } from "../app/lib/roadops-driving-server.js";

export type RoadOpsDrivingAccessInput = {
  method: string;
  origin: string;
  requestOrigin: string;
  cookieHeader?: string;
};

export type RoadOpsDrivingSessionResolver = (
  cookieHeader?: string,
) => Pick<SessionUser, "id"> | null | Promise<Pick<SessionUser, "id"> | null>;

export type RoadOpsDrivingAccessResult = { identity: string } | RoadOpsDrivingHttpResult;

const reject = (status: number, code: string, message: string): RoadOpsDrivingHttpResult => ({
  status,
  headers: {
    "cache-control": "private, no-store",
    "content-type": "application/json; charset=utf-8",
    ...(status === 405 ? { allow: "POST" } : {}),
  },
  body: { error: { code, message, retryable: false, fallbackAvailable: false } },
});

export const roadOpsDrivingServiceUnavailable = (): RoadOpsDrivingHttpResult =>
  reject(503, "ROADOPS_DIDI_SERVICE_UNAVAILABLE", "驾车规划服务暂时不可用，请稍后重试。");

export const roadOpsDrivingMalformedJson = (): RoadOpsDrivingHttpResult =>
  reject(422, "ROADOPS_DIDI_BAD_REQUEST", "驾车规划请求必须是 UTF-8 JSON。");

const httpsOrigin = (value: string): string | null => {
  // Origin must be a complete HTTPS origin, without credentials or URL extras.
  // Reject whitespace and backslashes before URL parsing can normalize them.
  if (!/^https:\/\/[^/]+\/?$/i.test(value) || /[\s\\?#]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.host || url.username || url.password || url.pathname !== "/") return null;
    return url.origin;
  } catch {
    return null;
  }
};

/** Authorize before reading the request body or constructing a provider service. */
export async function authorizeRoadOpsDrivingRequest(
  input: RoadOpsDrivingAccessInput,
  resolveUser: RoadOpsDrivingSessionResolver = getRequestUser,
): Promise<RoadOpsDrivingAccessResult> {
  if (input.method !== "POST") return reject(405, "ROADOPS_DIDI_METHOD", "仅支持 POST 请求。");

  const origin = httpsOrigin(input.origin), expectedOrigin = httpsOrigin(input.requestOrigin);
  if (!origin || !expectedOrigin || origin !== expectedOrigin) {
    return reject(403, "ROADOPS_DIDI_ORIGIN", "请求来源验证失败，请从本站发起驾车规划。");
  }

  try {
    const user = await resolveUser(input.cookieHeader);
    if (!user || typeof user.id !== "string" || !user.id.trim()) {
      return reject(401, "ROADOPS_DIDI_LOGIN_REQUIRED", "请登录后规划驾车路线。");
    }
    return { identity: `user:${user.id}` };
  } catch {
    return reject(503, "ROADOPS_DIDI_AUTH_UNAVAILABLE", "登录状态验证暂时不可用，请稍后重试。");
  }
}
