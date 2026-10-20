import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  createRoadOpsDrivingService,
  handleRoadOpsDrivingRequest,
  ROADOPS_DRIVING_MAX_BODY_BYTES,
  type RoadOpsDrivingService,
} from "../app/lib/roadops-driving-server";

type LocalServerOptions = {
  staticRoot: string;
  env?: Record<string, string | undefined>;
  service?: RoadOpsDrivingService;
  usageCarryover?: { date: string; used: number };
};

const identity = "local:browser";
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".geojson": "application/geo+json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".wasm": "application/wasm", ".bin": "application/octet-stream",
  ".traineddata": "application/octet-stream",
};

const json = (response: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store",
    "x-content-type-options": "nosniff", "content-length": Buffer.byteLength(text), ...extra,
  });
  response.end(text);
};
const error = (response: ServerResponse, status: number, code: string, message: string, close = false) => {
  json(response, status, { error: { code, message, retryable: false } }, close ? { connection: "close" } : {});
};
const contained = (root: string, candidate: string) => {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
};

// Stream into a bounded buffer. Declared length is only a fast rejection; chunked
// and incorrectly declared requests still receive the same byte limit.
const readBody = (request: IncomingMessage) => new Promise<string>((resolveBody, reject) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const cleanup = () => {
    request.off("data", onData); request.off("end", onEnd);
    request.off("error", onError); request.off("aborted", onAborted);
  };
  const fail = (code: string) => { cleanup(); request.resume(); reject(new Error(code)); };
  const onData = (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > ROADOPS_DRIVING_MAX_BODY_BYTES) { fail("BODY_LIMIT"); return; }
    chunks.push(chunk);
  };
  const onEnd = () => { cleanup(); resolveBody(Buffer.concat(chunks).toString("utf8")); };
  const onError = () => fail("BODY_READ");
  const onAborted = () => fail("BODY_ABORTED");
  request.on("data", onData); request.once("end", onEnd);
  request.once("error", onError); request.once("aborted", onAborted);
});

export async function createRoadOpsLocalServer(options: LocalServerOptions) {
  const staticRoot = await realpath(resolve(options.staticRoot));
  const index = await realpath(resolve(staticRoot, "index.html"));
  if (!contained(staticRoot, index) || !(await stat(index)).isFile()) throw new Error("Local static index is unavailable.");
  const env = options.env ?? process.env;
  const service = options.service ?? createRoadOpsDrivingService({ env, ...(options.usageCarryover ? { initialUsage: { ...options.usageCarryover, identity } } : {}) });

  const server = createServer(async (request, response) => {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => { if (!response.writableEnded) controller.abort(); });
    try {
      // Reject DNS rebinding and spoofed forwarding headers. Binding to loopback
      // is performed by the launcher; the exact listener port is checked here.
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
      const host = request.headers.host ?? "";
      if (!allowedHosts.has(host)) { error(response, 403, "ROADOPS_LOCAL_HOST", "仅允许本机访问。"); return; }
      const origin = request.headers.origin ?? "";
      if (origin && origin !== `http://${host}` || request.headers["sec-fetch-site"] === "cross-site") {
        error(response, 403, "ROADOPS_DIDI_ORIGIN", "请求来源验证失败。"); return;
      }
      const rawPath = (request.url ?? "/").split("?")[0];
      let pathname: string;
      try { pathname = decodeURIComponent(rawPath); }
      catch { error(response, 400, "ROADOPS_LOCAL_PATH", "路径编码无效。"); return; }
      const segments = pathname.split("/").filter(Boolean);
      if (!pathname.startsWith("/") || /[\\%:]/.test(pathname) || [...pathname].some(character => character.charCodeAt(0) < 32)
        || segments.some(part => part.startsWith(".") || ["node_modules", "scripts", "artifacts"].includes(part.toLowerCase()))) {
        error(response, 403, "ROADOPS_LOCAL_PATH", "不允许访问此路径。"); return;
      }

      if (pathname === "/api/roadops/health") {
        if (request.method !== "GET") { error(response, 405, "ROADOPS_LOCAL_METHOD", "仅支持 GET 请求。"); return; }
        const usage = service.usage(identity);
        json(response, 200, {
          ok: true, provider: "didi_web_service", configured: Boolean(env.DIDI_MAP_WEB_SERVICE_KEY?.trim()),
          localOnly: true, capabilities: { driving: true, walking: false, cycling: false, transit: false },
          budget: { scope: "server_process_http_attempts", dailyBudget: usage.dailyBudget, dailyUsed: usage.dailyUsed, dailyRemaining: usage.dailyRemaining },
        });
        return;
      }
      if (pathname === "/api/roadops/driving") {
        if (request.method !== "POST") { error(response, 405, "ROADOPS_DIDI_METHOD", "仅支持 POST 请求。"); return; }
        if ((request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase() !== "application/json") {
          error(response, 415, "ROADOPS_LOCAL_CONTENT_TYPE", "请提交 application/json 请求。"); return;
        }
        if (Number(request.headers["content-length"] ?? 0) > ROADOPS_DRIVING_MAX_BODY_BYTES) {
          request.resume(); error(response, 413, "ROADOPS_DIDI_BODY_LIMIT", "驾车规划请求超过 48 KB。", true); return;
        }
        let bodyText: string;
        try { bodyText = await readBody(request); }
        catch (cause) {
          if (cause instanceof Error && cause.message === "BODY_LIMIT") error(response, 413, "ROADOPS_DIDI_BODY_LIMIT", "驾车规划请求超过 48 KB。", true);
          else if (!response.destroyed) error(response, 400, "ROADOPS_LOCAL_BODY", "请求正文读取失败。", true);
          return;
        }
        const result = await handleRoadOpsDrivingRequest({ method: "POST", origin, host, bodyText, identity, signal: controller.signal }, service);
        if (!response.destroyed) json(response, result.status, result.body, result.headers);
        return;
      }
      if (pathname === "/api" || pathname.startsWith("/api/")) {
        error(response, 404, "ROADOPS_LOCAL_API_NOT_FOUND", "此本地服务未提供该接口。"); return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") { error(response, 405, "ROADOPS_LOCAL_METHOD", "静态资源仅支持 GET/HEAD。"); return; }

      let target = resolve(staticRoot, ...segments);
      if (!contained(staticRoot, target)) { error(response, 403, "ROADOPS_LOCAL_PATH", "不允许访问此路径。"); return; }
      let info;
      try {
        info = await stat(target);
        if (info.isDirectory()) { target = resolve(target, "index.html"); info = await stat(target); }
      } catch {
        // Extensionless client routes use the SPA entry; missing assets never do.
        if (extname(pathname)) { error(response, 404, "ROADOPS_LOCAL_NOT_FOUND", "资源不存在。"); return; }
        target = index; info = await stat(target);
      }
      const canonical = await realpath(target);
      const contentType = contentTypes[extname(canonical).toLowerCase()];
      if (!contained(staticRoot, canonical) || !info.isFile() || !contentType) {
        error(response, 403, "ROADOPS_LOCAL_PATH", "不允许访问此文件。"); return;
      }
      response.writeHead(200, {
        "content-type": contentType, "content-length": info.size,
        "cache-control": "no-cache", "x-content-type-options": "nosniff",
        "referrer-policy": "strict-origin-when-cross-origin",
      });
      if (request.method === "HEAD") response.end();
      else await pipeline(createReadStream(canonical), response);
    } catch {
      // Never log thrown upstream errors, URLs, environment variables or secrets.
      if (!response.headersSent && !response.destroyed) error(response, 500, "ROADOPS_LOCAL_FAILED", "本地服务发生错误。");
      else if (!response.destroyed) response.destroy();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.on("clientError", (_cause, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"); });
  return server;
}
