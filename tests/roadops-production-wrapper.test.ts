import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRoadOpsDrivingRequest, ROADOPS_DRIVING_MAX_BODY_BYTES, type RoadOpsDrivingHttpInput, type RoadOpsDrivingHttpResult, type RoadOpsDrivingService } from "../app/lib/roadops-driving-server.js";
import type { RoadOpsDrivingPlan } from "../app/lib/roadops-driving.js";
import { authorizeRoadOpsDrivingRequest, roadOpsDrivingMalformedJson, roadOpsDrivingServiceUnavailable, type RoadOpsDrivingAccessInput, type RoadOpsDrivingSessionResolver } from "../server/roadops-driving-access.js";

const payload = {
  schemaVersion: "roadops-driving-request-v1", startId: "a", endId: "b", returnToStart: false, workMinutes: 120, strategy: "1",
  points: [
    { id: "a", name: "A", coordinate: [110, 20], role: "origin", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "A" },
    { id: "b", name: "B", coordinate: [111, 21], role: "destination", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "B" },
  ],
  identity: "user:forged-body",
};
const baseHeaders = { host: "roadops.example", origin: "https://roadops.example", "content-type": "application/json" };
type Snapshot = { status: number; headers: Record<string, string>; body: unknown };
type VercelHandler = (request: VercelRequest, response: VercelResponse) => Promise<unknown>;
type AppHandler = (request: Request) => Promise<Response>;

function harness(options: { production?: boolean; resolveUser?: RoadOpsDrivingSessionResolver; initializationError?: string; bodyError?: unknown; bodyValue?: unknown } = {}) {
  const calls = { bodyReads: 0, serviceCreations: 0, authorizations: 0, plans: [] as Array<{ identity: string; payload: unknown }>, requests: [] as RoadOpsDrivingHttpInput[] };
  const service: RoadOpsDrivingService = {
    plan: async (value, identity) => {
      calls.plans.push({ payload: value, identity });
      return { schemaVersion: "roadops-driving-plan-v1" } as RoadOpsDrivingPlan;
    },
    usage: () => ({ cached: false, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 100, dailyRemaining: 100, perIdentityUsed: 0, perIdentityLimit: 20 }),
  };

  // Execute the actual wrapper source with isolated dependencies. The VM has a
  // synthetic deployment flag, so no real environment or session secret is read.
  function load<T>(path: string): T {
    const compiled = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const isolatedModule = { exports: {} };
    runInNewContext(compiled, {
      module: isolatedModule, exports: isolatedModule.exports, URL, Response,
      process: { env: { VERCEL: options.production === false ? undefined : "1" } },
      require: (specifier: string) => {
        if (specifier.includes("roadops-driving-production")) return {
          getProductionRoadOpsDrivingService: () => {
            calls.serviceCreations += 1;
            if (options.initializationError) throw new Error(options.initializationError);
            return service;
          },
        };
        if (specifier.includes("roadops-driving-access")) return {
          roadOpsDrivingServiceUnavailable,
          roadOpsDrivingMalformedJson,
          authorizeRoadOpsDrivingRequest: (input: RoadOpsDrivingAccessInput) => {
            calls.authorizations += 1;
            return authorizeRoadOpsDrivingRequest(input, options.resolveUser);
          },
        };
        if (specifier.includes("roadops-driving-server")) return {
          ROADOPS_DRIVING_MAX_BODY_BYTES,
          handleRoadOpsDrivingRequest: (input: RoadOpsDrivingHttpInput, selectedService?: RoadOpsDrivingService) => {
            calls.requests.push(input);
            return handleRoadOpsDrivingRequest(input, selectedService ?? service);
          },
        };
        throw new Error(`Unexpected wrapper dependency: ${specifier}`);
      },
    }, { filename: path, timeout: 1_000 });
    return isolatedModule.exports as T;
  }

  const vercel = load<{ default: VercelHandler }>("api/roadops/driving.ts").default;
  const app = load<{ POST: AppHandler }>("app/api/roadops/driving/route.ts").POST;

  async function request(kind: "vercel" | "app", headers: Record<string, string> = baseHeaders, method = "POST", poisonBody = false): Promise<Snapshot> {
    if (kind === "app") {
      const incoming = {
        method, url: "https://roadops.example/api/roadops/driving", headers: new Headers(headers), signal: new AbortController().signal,
        text: async () => {
          calls.bodyReads += 1;
          if (poisonBody) throw new Error("PRIVATE_BODY_ACCESS_ERROR");
          return JSON.stringify(payload);
        },
      } as Request;
      const response = await app(incoming);
      return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
    }

    const incoming = { method, headers } as unknown as VercelRequest;
    Object.defineProperty(incoming, "body", { get: () => {
      calls.bodyReads += 1;
      if (options.bodyError) throw options.bodyError;
      if (poisonBody) throw new Error("PRIVATE_BODY_ACCESS_ERROR");
      return options.bodyValue ?? payload;
    } });
    const snapshot: Snapshot = { status: 0, headers: {}, body: undefined };
    const response = {
      setHeader: (name: string, value: string) => { snapshot.headers[name.toLowerCase()] = value; return response; },
      status: (status: number) => { snapshot.status = status; return response; },
      json: (body: unknown) => { snapshot.body = body; return response; },
    } as unknown as VercelResponse;
    await vercel(incoming, response);
    return snapshot;
  }
  return { calls, request };
}

function denied(result: Snapshot, status: number) {
  assert.equal(result.status, status);
  assert.equal(result.headers["cache-control"], "private, no-store");
  const body = result.body as { error: { code: string; message: string; retryable: boolean; fallbackAvailable: boolean } };
  assert.equal(body.error.retryable, false);
  assert.equal(body.error.fallbackAvailable, false);
  return body.error;
}

test("both production wrappers reject method, origin and unsigned sessions before body access or service initialization", async () => {
  const cases: Array<{ method: string; headers: Record<string, string>; status: number }> = [
    { method: "GET", headers: { ...baseHeaders, origin: "" }, status: 405 },
    { method: "POST", headers: { ...baseHeaders, origin: "" }, status: 403 },
    { method: "POST", headers: { ...baseHeaders, origin: "http://roadops.example" }, status: 403 },
    { method: "POST", headers: { ...baseHeaders, origin: "https://evil.example", "x-forwarded-host": "evil.example" }, status: 403 },
    { method: "POST", headers: { ...baseHeaders }, status: 401 },
    { method: "POST", headers: { ...baseHeaders, cookie: "lanjifyw_session=unsigned-session" }, status: 401 },
    { method: "POST", headers: { ...baseHeaders, "x-forwarded-host": "evil.example", "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": "203.0.113.8" }, status: 401 },
    { method: "POST", headers: { ...baseHeaders, cookie: "lanjifyw_session=%" }, status: 503 },
  ];
  for (const kind of ["vercel", "app"] as const) {
    for (const item of cases) {
      const { calls, request } = harness();
      denied(await request(kind, item.headers, item.method, true), item.status);
      assert.equal(calls.bodyReads, 0, `${kind} ${item.status}: body must stay unread`);
      assert.equal(calls.serviceCreations, 0, `${kind} ${item.status}: service must stay uninitialized`);
      assert.equal(calls.requests.length, 0);
      assert.equal(calls.plans.length, 0);
    }
  }
});

test("both production wrappers bind supplier requests to the verified user id and keep cookies private", async () => {
  for (const kind of ["vercel", "app"] as const) {
    const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }) });
    const response = await request(kind, { ...baseHeaders, cookie: "lanjifyw_session=isolated-resolver-cookie", "x-forwarded-host": "evil.example", "x-forwarded-for": "203.0.113.7", "cf-connecting-ip": "203.0.113.8" });
    assert.equal(response.status, 200);
    assert.equal(calls.serviceCreations, 1);
    assert.equal(calls.plans.length, 1);
    assert.equal(calls.plans[0].identity, "user:verified-user");
    assert.equal(calls.requests[0].identity, "user:verified-user");
    assert.equal(calls.requests[0].host, "roadops.example");
    assert.doesNotMatch(JSON.stringify(calls.requests), /isolated-resolver-cookie/);
  }
});

test("both production wrappers fail closed on initialization errors without exposing exception text", async () => {
  for (const kind of ["vercel", "app"] as const) {
    const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }), initializationError: "PRIVATE_INITIALIZATION_ERROR_VALUE" });
    const response = await request(kind);
    const error = denied(response, 503);
    assert.equal(error.code, "ROADOPS_DIDI_SERVICE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE_INITIALIZATION_ERROR_VALUE|stack/);
    assert.equal(calls.serviceCreations, 1);
    assert.equal(calls.plans.length, 0);
  }
});

test("authenticated requests retain shared JSON media type and byte limit checks before planning", async () => {
  for (const kind of ["vercel", "app"] as const) {
    for (const contentType of ["", "text/plain"]) {
      const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }) });
      const error = denied(await request(kind, { ...baseHeaders, "content-type": contentType }), 415);
      assert.equal(error.code, "ROADOPS_DIDI_CONTENT_TYPE");
      assert.equal(calls.plans.length, 0);
    }
    const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }) });
    const error = denied(await request(kind, { ...baseHeaders, "content-length": String(ROADOPS_DRIVING_MAX_BODY_BYTES + 1) }, "POST", true), 413);
    assert.equal(error.code, "ROADOPS_DIDI_BODY_LIMIT");
    assert.equal(calls.bodyReads, 0);
    assert.equal(calls.plans.length, 0);
  }
});

test("both production wrappers sanitize unexpected body reader failures", async () => {
  for (const kind of ["vercel", "app"] as const) {
    const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }) });
    const response = await request(kind, baseHeaders, "POST", true);
    denied(response, 503);
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE_BODY_ACCESS_ERROR|stack/);
    assert.equal(calls.serviceCreations, 0);
    assert.equal(calls.plans.length, 0);
  }
});

test("Vercel lazy JSON parser failures return 422 before service initialization", async () => {
  const apiError = Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
  const malformed = Object.assign(new Error("PRIVATE_MALFORMED_JSON_MESSAGE"), { name: "MalformedJson", statusCode: 400 });
  const coded = Object.assign(new Error("PRIVATE_MALFORMED_JSON_MESSAGE"), { code: "MalformedJson", statusCode: 400 });
  for (const bodyError of [apiError, malformed, coded, new SyntaxError("PRIVATE_JSON_SYNTAX_ERROR")]) {
    const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }), bodyError, initializationError: "SERVICE_MUST_NOT_INITIALIZE" });
    const response = await request("vercel");
    const error = denied(response, 422);
    assert.equal(error.code, "ROADOPS_DIDI_BAD_REQUEST");
    assert.equal(error.message, "驾车规划请求必须是 UTF-8 JSON。");
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE_|Invalid JSON|SERVICE_MUST_NOT_INITIALIZE|stack/);
    assert.equal(calls.bodyReads, 1);
    assert.equal(calls.serviceCreations, 0);
    assert.equal(calls.requests.length, 0);
    assert.equal(calls.plans.length, 0);
  }
});

test("Vercel unknown 400 body failures remain safe 503 errors", async () => {
  const bodyError = Object.assign(new Error("PRIVATE_UNKNOWN_BODY_FAILURE"), { statusCode: 400 });
  const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }), bodyError });
  const response = await request("vercel");
  assert.equal(denied(response, 503).code, "ROADOPS_DIDI_SERVICE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(response), /PRIVATE_UNKNOWN_BODY_FAILURE|stack/);
  assert.equal(calls.serviceCreations, 0);
  assert.equal(calls.plans.length, 0);
});

test("Vercel lazy malformed body is not read before rejecting unsigned sessions", async () => {
  const bodyError = Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
  const { calls, request } = harness({ bodyError });
  assert.equal(denied(await request("vercel"), 401).code, "ROADOPS_DIDI_LOGIN_REQUIRED");
  assert.equal(calls.bodyReads, 0);
  assert.equal(calls.serviceCreations, 0);
});

test("Vercel raw malformed JSON still passes through shared validation as 422", async () => {
  const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }), bodyValue: "{" });
  assert.equal(denied(await request("vercel"), 422).code, "ROADOPS_DIDI_BAD_REQUEST");
  assert.equal(calls.bodyReads, 1);
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.plans.length, 0);
});

test("local App route keeps anonymous requests and missing content type compatible", async () => {
  const { calls, request } = harness({ production: false });
  const response = await request("app", { host: "roadops.example", origin: "https://roadops.example" });
  assert.equal(response.status, 200);
  assert.equal(calls.authorizations, 0);
  assert.equal(calls.serviceCreations, 0);
  assert.equal(calls.requests[0].contentType, undefined);
  assert.equal(calls.plans[0].identity, "local:browser");
});

test("Vercel wrapper preserves normalized HTTPS default ports during the shared handler check", async () => {
  const { calls, request } = harness({ resolveUser: () => ({ id: "verified-user" }) });
  const response = await request("vercel", { ...baseHeaders, host: "ROADOPS.example:443", origin: "https://ROADOPS.example:443" });
  assert.equal(response.status, 200);
  assert.equal(calls.requests[0].host, "roadops.example");
});

test("service unavailable result follows the shared HTTP error contract", () => {
  const result: RoadOpsDrivingHttpResult = roadOpsDrivingServiceUnavailable();
  assert.equal(result.status, 503);
  assert.equal(result.headers["cache-control"], "private, no-store");
  assert.deepEqual(result.body, { error: { code: "ROADOPS_DIDI_SERVICE_UNAVAILABLE", message: "驾车规划服务暂时不可用，请稍后重试。", retryable: false, fallbackAvailable: false } });
});
