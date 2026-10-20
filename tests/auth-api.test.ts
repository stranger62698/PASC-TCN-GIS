import assert from "node:assert/strict";
import test from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createAuthHandler } from "../api/auth.js";
import { AuthError } from "../server/auth.js";

const user = { id: "fixture-user", email: "fixture@example.invalid", name: "Fixture user", roles: [] };
function fixture(options: { loginError?: Error; registerError?: Error } = {}) {
  const calls = { login: 0, register: 0, session: 0, tokens: 0, bodyReads: 0, logs: [] as unknown[] };
  const handler = createAuthHandler({
    authenticateUser: async () => { calls.login += 1; if (options.loginError) throw options.loginError; return user; },
    createUser: async () => { calls.register += 1; if (options.registerError) throw options.registerError; return user; },
    getRequestUser: () => { calls.session += 1; return null; },
    createSessionToken: () => { calls.tokens += 1; return "fixture-signed-token"; },
    logError: diagnostic => calls.logs.push(diagnostic),
  });
  async function request(op: string, settings: { method?: string; headers?: Record<string, string>; body?: unknown; poisonBody?: boolean } = {}) {
    const snapshot = { status: 0, headers: {} as Record<string, string>, body: {} as Record<string, unknown> };
    const incoming = { method: settings.method ?? "POST", query: { op }, headers: { host: "auth.example", origin: "https://auth.example", "content-type": "application/json", ...settings.headers } } as unknown as VercelRequest;
    Object.defineProperty(incoming, "body", { get: () => { calls.bodyReads += 1; if (settings.poisonBody) throw new Error("private parser detail"); return Object.hasOwn(settings, "body") ? settings.body : { email: user.email, password: "fixture-pass", username: user.name }; } });
    const response = {
      setHeader: (name: string, value: string) => { snapshot.headers[name.toLowerCase()] = value; return response; },
      status: (status: number) => { snapshot.status = status; return response; },
      json: (body: Record<string, unknown>) => { snapshot.body = body; return response; },
    } as unknown as VercelResponse;
    await handler(incoming, response);
    return snapshot;
  }
  return { calls, request };
}

test("session GET remains read-only and never invokes account writes, attempt counters or body parsing", async () => {
  const { calls, request } = fixture();
  for (let index = 0; index < 3; index += 1) {
    const response = await request("session", { method: "GET", poisonBody: true, headers: { origin: "" } });
    assert.equal(response.status, 200);
    assert.equal(response.body.authenticated, false);
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.deepEqual({ ...calls, logs: [] }, { login: 0, register: 0, session: 3, tokens: 0, bodyReads: 0, logs: [] });
});

test("cross-origin, missing-origin and malformed origins are rejected before reading credentials or invoking storage", async () => {
  for (const origin of ["", "null", "https://evil.example", "http://auth.example", "https://user@auth.example", "https://auth.example/path", "https://auth.example?x=1", " https://auth.example", "https:\\auth.example"]) {
    const { calls, request } = fixture();
    const response = await request("login", { headers: { origin }, poisonBody: true });
    assert.equal(response.status, 403, origin);
    assert.equal(response.body.code, "AUTH_ORIGIN_REJECTED");
    assert.equal(calls.bodyReads + calls.login + calls.register + calls.tokens, 0);
  }
});

test("media type and declared oversize requests reject before lazy JSON body parsing", async () => {
  for (const [headers, status] of [[{ "content-type": "text/plain" }, 415], [{ "content-length": "5000" }, 413]] as const) {
    const { calls, request } = fixture();
    const response = await request("register", { headers, poisonBody: true });
    assert.equal(response.status, status);
    assert.equal(calls.bodyReads + calls.register + calls.tokens, 0);
  }
});

test("malformed JSON, primitives, arrays and actual byte oversize cannot reach account handlers", async () => {
  for (const [body, status] of [["{", 400], ["null", 400], ["[]", 400], ["42", 400], [{ email: "x".repeat(5000) }, 413]] as const) {
    const { calls, request } = fixture();
    const response = await request("login", { body });
    assert.equal(response.status, status);
    assert.equal(calls.login + calls.tokens, 0);
  }
  const { calls, request } = fixture();
  assert.equal((await request("login", { poisonBody: true })).status, 400);
  assert.equal(calls.login, 0);
});

test("successful same-origin registration/login retain signed HttpOnly cookies; remote cookies are always Secure", async () => {
  const { calls, request } = fixture();
  for (const op of ["register", "login"]) {
    const response = await request(op, { headers: { "x-forwarded-proto": "http" } });
    assert.equal(response.status, op === "register" ? 201 : 200);
    assert.deepEqual(response.body.user, user);
    assert.match(response.headers["set-cookie"], /lanjifyw_session=fixture-signed-token;.*HttpOnly; Secure; SameSite=Lax/);
  }
  assert.equal(calls.tokens, 2);
});

test("rate limits and storage failures never mint cookies or expose raw errors/credentials in responses or logs", async () => {
  const limited = fixture({ loginError: new AuthError("AUTH_RATE_LIMITED", 429, "稍后重试") });
  const response = await limited.request("login");
  assert.equal(response.status, 429);
  assert.equal(response.headers["retry-after"], "900");
  assert.equal(response.headers["set-cookie"], undefined);
  assert.equal(limited.calls.tokens, 0);
  const failed = fixture({ loginError: new Error("private password fixture-pass credential detail") });
  const unavailable = await failed.request("login");
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(JSON.stringify({ unavailable, logs: failed.calls.logs }), /fixture-pass|credential detail|fixture@example/);
  assert.deepEqual(failed.calls.logs, [{ operation: "login", code: "AUTH_UNAVAILABLE", status: 503 }]);
  assert.equal(failed.calls.tokens, 0);
});

test("logout still clears the existing cookie without parsing a body or mutating accounts", async () => {
  const { calls, request } = fixture();
  const response = await request("logout", { poisonBody: true, headers: { "content-type": "" } });
  assert.equal(response.status, 200);
  assert.match(response.headers["set-cookie"], /Max-Age=0/);
  assert.equal(calls.bodyReads + calls.login + calls.register, 0);
});
