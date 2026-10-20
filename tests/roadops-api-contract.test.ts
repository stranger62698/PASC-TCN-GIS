import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { roadOpsUsageLabel } from "../app/lib/roadops-driving";
import { createRoadOpsDrivingService, handleRoadOpsDrivingRequest, ROADOPS_DRIVING_MAX_BODY_BYTES, RoadOpsDrivingError, sanitizeRoadOpsDrivingRequest, type RoadOpsDrivingService } from "../app/lib/roadops-driving-server";

const base = { schemaVersion: "roadops-driving-request-v1", startId: "a", endId: "b", returnToStart: false, workMinutes: 120, strategy: "1", points: [
  { id: "a", name: "A", coordinate: [110, 20], role: "origin", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "A" },
  { id: "b", name: "B", coordinate: [111, 21], role: "destination", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "B" },
] };

test("usage text distinguishes persisted shared account quotas from restartable process counters", () => {
  const usage = { cached: false, upstreamRequests: 2, dailyUsed: 2, dailyBudget: 100, dailyRemaining: 98, perIdentityUsed: 2, perIdentityLimit: 20 };
  assert.match(roadOpsUsageLabel(usage), /本进程当日计数.*重启重置.*非持久配额/);
  const shared = roadOpsUsageLabel({ ...usage, budgetScope: "shared" });
  assert.match(shared, /本站共享当日计数 2\/100.*当前账号 2\/20.*非滴图账单/);
  assert.doesNotMatch(shared, /重启重置|本进程/);
});

test("shared handler rejects methods, cross-origin requests and oversized bodies", async () => {
  const never: RoadOpsDrivingService = { plan: async () => { throw new Error("must not run"); }, usage: () => ({ cached: false, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 50, dailyRemaining: 50, perIdentityUsed: 0, perIdentityLimit: 20 }) };
  const method = await handleRoadOpsDrivingRequest({ method: "GET", origin: "", host: "localhost", bodyText: "{}", identity: "test" }, never);
  const origin = await handleRoadOpsDrivingRequest({ method: "POST", origin: "https://evil.example", host: "localhost", bodyText: "{}", identity: "test" }, never);
  const body = await handleRoadOpsDrivingRequest({ method: "POST", origin: "", host: "localhost", bodyText: "x".repeat(ROADOPS_DRIVING_MAX_BODY_BYTES + 1), identity: "test" }, never);
  assert.equal(method.status, 405);
  assert.equal(origin.status, 403);
  assert.equal(body.status, 413);
});

test("request sanitizer bounds point count, coordinates and candidate count", () => {
  assert.equal(sanitizeRoadOpsDrivingRequest(base).points.length, 2);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, points: [...base.points, { ...base.points[0], id: "c", coordinate: [181, 20], role: "candidate" }] }), /WGS84/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, points: Array.from({ length: 9 }, (_, index) => ({ ...base.points[0], id: `p-${index}`, role: index ? "candidate" : "origin" })), endId: "p-1" }), /规划点数/);
});

test("request sanitizer normalizes the effective destination for return trips", () => {
  const loop = sanitizeRoadOpsDrivingRequest({ ...base, endId: "unused-destination", returnToStart: true, points: [base.points[0], { ...base.points[1], role: "candidate" }] });
  assert.equal(loop.endId, loop.startId);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, endId: "unused-destination", returnToStart: false }), /终点/);
});

test("shared handler returns structured errors without claiming an offline route exists", async () => {
  const service: RoadOpsDrivingService = {
    plan: async () => { throw new RoadOpsDrivingError("ROADOPS_DIDI_TIMEOUT", "滴图驾车规划超时，未生成新的驾车路线。", 504, true); },
    usage: () => ({ cached: false, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 50, dailyRemaining: 50, perIdentityUsed: 0, perIdentityLimit: 20 }),
  };
  const result = await handleRoadOpsDrivingRequest({ method: "POST", origin: "http://localhost", host: "localhost", bodyText: JSON.stringify(base), identity: "test" }, service);
  assert.equal(result.status, 504);
  assert.deepEqual(result.body, { error: { code: "ROADOPS_DIDI_TIMEOUT", message: "滴图驾车规划超时，未生成新的驾车路线。", retryable: true, fallbackAvailable: false, usage: undefined } });
  assert.equal(result.headers["cache-control"], "private, no-store");
});

test("manual request validates point roles, duplicate coordinates and ordering modes", () => {
  assert.equal(sanitizeRoadOpsDrivingRequest(base).orderMode, "optimize");
  assert.equal(sanitizeRoadOpsDrivingRequest({ ...base, orderMode: "input" }).orderMode, "input");
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, orderMode: "random" }), /顺序模式/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, points: [base.points[0], { ...base.points[1], role: "candidate" }] }), /角色/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, points: [{ ...base.points[0], role: "destination" }, base.points[1]] }), /角色/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, points: [...base.points, { ...base.points[1], id: "c", role: "destination", coordinate: [112, 22] }] }), /角色/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, points: [base.points[0], { ...base.points[1], coordinate: base.points[0].coordinate }] }), /重合点位/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, startId: "a", endId: "a" }), /返回起点/);
});

test("field detail is explicitly enabled and rejected for unsupported versions", () => {
  assert.equal(sanitizeRoadOpsDrivingRequest(base).detailMode, undefined);
  assert.equal(sanitizeRoadOpsDrivingRequest({ ...base, detailMode: "field" }).detailMode, "field");
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, detailMode: "turn_by_turn" }), /明细模式/);
  assert.throws(() => sanitizeRoadOpsDrivingRequest({ ...base, detailMode: false }), /明细模式/);
});

test("App Route and Vercel wrapper both use the shared handler and server-only key", () => {
  const appRoute = requireText("app/api/roadops/driving/route.ts"), vercel = requireText("api/roadops/driving.ts"), server = requireText("app/lib/roadops-driving-server.ts");
  assert.match(appRoute, /handleRoadOpsDrivingRequest/);
  assert.match(vercel, /handleRoadOpsDrivingRequest/);
  assert.match(server, /DIDI_MAP_WEB_SERVICE_KEY/);
  assert.match(server, /from "\.\/roadops-route\.js"/, "The production Node ESM dependency must include its emitted .js extension");
  assert.doesNotMatch(requireText("app/components/RoadRoutePlannerPanel.tsx"), /DIDI_MAP_WEB_SERVICE_KEY|\?key=/);
});

function requireText(path: string) {
  return readFileSync(path, "utf8");
}

test("explicit local carry-over seeds both counters and resets only on the Shanghai date boundary", () => {
  let now = Date.parse("2026-09-27T15:59:59Z");
  const service = createRoadOpsDrivingService({ env: { DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "100" }, now: () => now, initialUsage: { date: "2026-09-27", used: 8, identity: "local:browser" } });
  assert.equal(service.usage("local:browser").dailyUsed, 8);
  assert.equal(service.usage("local:browser").dailyRemaining, 92);
  assert.equal(service.usage("local:browser").perIdentityUsed, 8);
  assert.equal(service.usage("other").perIdentityUsed, 0);
  now = Date.parse("2026-09-27T16:00:00Z");
  assert.equal(service.usage("local:browser").dailyUsed, 0);
  assert.equal(service.usage("local:browser").perIdentityUsed, 0);
  assert.equal(service.usage("local:browser").dailyRemaining, 100);
});

test("service carry-over rejects stale/future dates and malformed counters", () => {
  const now = () => Date.parse("2026-09-27T16:00:00Z");
  for (const date of ["2026-09-27", "2026-09-29", "2026-99-99", ""]) {
    assert.throws(() => createRoadOpsDrivingService({ env: {}, now, initialUsage: { date, used: 8, identity: "local:browser" } }), /Asia\/Shanghai/);
  }
  for (const used of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createRoadOpsDrivingService({ env: {}, now, initialUsage: { date: "2026-09-28", used, identity: "local:browser" } }), /Asia\/Shanghai/);
  }
  const defaults = createRoadOpsDrivingService({ env: {}, now }).usage("local:browser");
  assert.equal(defaults.dailyUsed, 0); assert.equal(defaults.dailyBudget, 50); assert.equal(defaults.perIdentityLimit, 20);
});

test("insufficient local carry-over budget reports remaining counts without contacting Didi", async () => {
  let calls = 0;
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "TEST_LOCAL_DUMMY_KEY", DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "100" }, now: () => Date.parse("2026-09-27T16:00:00Z"), initialUsage: { date: "2026-09-28", used: 99, identity: "local:browser" }, fetchImpl: async () => { calls += 1; throw new Error("must not call upstream"); } });
  await assert.rejects(service.plan(base, "local:browser"), (cause: unknown) => {
    assert.ok(cause instanceof RoadOpsDrivingError);
    assert.equal(cause.code, "ROADOPS_DIDI_BUDGET_EXHAUSTED");
    assert.match(cause.message, /总额度剩余 1 次/);
    assert.match(cause.message, /不是滴图官方余额/);
    return true;
  });
  assert.equal(calls, 0); assert.equal(service.usage("local:browser").dailyUsed, 99);
});
