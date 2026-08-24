import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  authenticateUser,
  clearSessionCookie,
  createSessionToken,
  createUser,
  getRequestUser,
  sessionCookie,
} from "../server/auth.js";

const json = (response: VercelResponse, status: number, body: unknown) => {
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(body);
};

const requestBody = (request: VercelRequest) =>
  typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const op = String(request.query.op || "session");
  const secureCookie = String(request.headers["x-forwarded-proto"] || "https").split(",")[0].trim() === "https";
  try {
    if (request.method === "GET" && op === "session") {
      const user = getRequestUser(request.headers.cookie);
      return json(response, 200, { authenticated: Boolean(user), user });
    }
    if (request.method === "POST" && op === "register") {
      const input = requestBody(request);
      const user = await createUser(input.email, input.password, input.username);
      response.setHeader("Set-Cookie", sessionCookie(createSessionToken(user), secureCookie));
      return json(response, 201, { ok: true, user });
    }
    if (request.method === "POST" && op === "login") {
      const input = requestBody(request);
      const user = await authenticateUser(input.email, input.password);
      if (!user) return json(response, 401, { error: "邮箱或密码错误" });
      response.setHeader("Set-Cookie", sessionCookie(createSessionToken(user), secureCookie));
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
    const message = error instanceof Error ? error.message : "认证服务暂时不可用";
    const status = /已经注册|长度|有效邮箱/.test(message) ? 400 : 500;
    console.error("auth error", error);
    return json(response, status, { error: status === 500 ? "认证服务暂时不可用，请稍后重试" : message });
  }
}
