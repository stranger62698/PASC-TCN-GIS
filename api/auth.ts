import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  authenticateUser,
  clearSessionCookie,
  createSessionToken,
  createUser,
  getRequestUser,
  sessionCookie,
  AuthError,
} from "../server/auth.js";

const json = (response: VercelResponse, status: number, body: unknown) => {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(body);
};

const MAX_BODY_BYTES = 4_096;
const requestBody = (request: VercelRequest): Record<string, unknown> => {
  if (!/^application\/json(?:\s*;|$)/i.test(String(request.headers["content-type"] ?? ""))) throw new AuthError("AUTH_CONTENT_TYPE", 415, "认证请求必须使用 JSON。");
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new AuthError("AUTH_BODY_TOO_LARGE", 413, "认证请求过大。");
  let body: unknown;
  try {
    const value: unknown = request.body;
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) throw new AuthError("AUTH_INVALID_JSON", 400, "认证请求必须包含有效的 JSON 对象。");
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new AuthError("AUTH_BODY_TOO_LARGE", 413, "认证请求过大。");
    body = JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("AUTH_INVALID_JSON", 400, "认证请求必须包含有效的 JSON 对象。");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError("AUTH_INVALID_JSON", 400, "认证请求必须包含有效的 JSON 对象。");
  return body as Record<string, unknown>;
};

const sameOrigin = (request: VercelRequest) => {
  const origin = String(request.headers.origin ?? ""), host = String(request.headers.host ?? "");
  if (!/^https?:\/\/[^/]+\/?$/i.test(origin) || /[\s\\?#]/.test(origin) || !/^[a-z\d.:[\]-]+$/i.test(host)) return false;
  try {
    const source = new URL(origin), expected = new URL(`https://${host}`);
    const localHttp = source.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname);
    return !source.username && !source.password && source.host === expected.host && (source.protocol === "https:" || localHttp);
  } catch { return false; }
};

type AuthDependencies = {
  createUser: typeof createUser;
  authenticateUser: typeof authenticateUser;
  getRequestUser: typeof getRequestUser;
  createSessionToken: typeof createSessionToken;
  logError: (diagnostic: { operation: string; code: string; status: number }) => void;
};

export function createAuthHandler(dependencies: Partial<AuthDependencies> = {}) {
  const services = { createUser, authenticateUser, getRequestUser, createSessionToken, logError: (diagnostic: { operation: string; code: string; status: number }) => console.error("auth request failed", diagnostic), ...dependencies };
  return async function handler(request: VercelRequest, response: VercelResponse) {
  const op = String(request.query.op || "session");
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(String(request.headers.host ?? ""));
  const secureCookie = !localHost || String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim() !== "http";
  try {
    if (request.method === "GET" && op === "session") {
      const user = services.getRequestUser(request.headers.cookie);
      return json(response, 200, { authenticated: Boolean(user), user });
    }
    if (request.method === "POST" && !sameOrigin(request)) throw new AuthError("AUTH_ORIGIN_REJECTED", 403, "请从本站发起认证请求。");
    if (request.method === "POST" && op === "register") {
      const input = requestBody(request);
      const user = await services.createUser(input.email, input.password, input.username);
      response.setHeader("Set-Cookie", sessionCookie(services.createSessionToken(user), secureCookie));
      return json(response, 201, { ok: true, user });
    }
    if (request.method === "POST" && op === "login") {
      const input = requestBody(request);
      const user = await services.authenticateUser(input.email, input.password);
      if (!user) return json(response, 401, { error: "邮箱或密码错误" });
      response.setHeader("Set-Cookie", sessionCookie(services.createSessionToken(user), secureCookie));
      return json(response, 200, { ok: true, user });
    }
    if (request.method === "POST" && op === "logout") {
      response.setHeader("Set-Cookie", clearSessionCookie(secureCookie));
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && op === "forgot") {
      return json(response, 503, { error: "密码找回邮件服务尚未配置。请联系站点管理员重置，后续可接入 Resend 邮件服务。" });
    }
    return json(response, 405, { error: "不支持的认证请求" });
  } catch (error) {
    const status = error instanceof AuthError ? error.status : 503;
    const code = error instanceof AuthError ? error.code : "AUTH_UNAVAILABLE";
    if (status >= 500) services.logError({ operation: ["session", "register", "login", "logout", "forgot"].includes(op) ? op : "unknown", code, status });
    if (status === 429) response.setHeader("Retry-After", "900");
    return json(response, status, { error: error instanceof AuthError ? error.message : "认证服务暂时不可用，请稍后重试", code });
  }
  };
}

export default createAuthHandler();
