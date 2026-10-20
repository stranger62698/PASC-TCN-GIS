import assert from "node:assert/strict";
import test from "node:test";
import type { RoadOpsDrivingRequest } from "../app/lib/roadops-driving.js";
import { createRoadOpsDrivingService, RoadOpsDrivingError, type RoadOpsSharedQuota } from "../app/lib/roadops-driving-server.js";
import { createSharedRoadOpsQuota, SharedQuotaError, type SharedQuotaStore } from "../app/lib/roadops-shared-quota.js";

const input: RoadOpsDrivingRequest = {
  schemaVersion: "roadops-driving-request-v1", startId: "origin", endId: "destination", returnToStart: false, workMinutes: 240, strategy: "1", orderMode: "input",
  points: [
    { id: "origin", name: "驻点", coordinate: [110.45, 20.02], role: "origin", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "驻点" },
    { id: "destination", name: "收队点", coordinate: [110.50, 20.00], role: "destination", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "收队点" },
    { id: "candidate", name: "检查点", coordinate: [110.47, 20.03], role: "candidate", dwellMinutes: 15, inspectionValue: 10, required: true, sourceFeatureId: "way/1", sourceRoadName: "测试道路" },
  ],
};
// Explicit test-only configuration; no process.env or production credentials.
const env = { DIDI_MAP_WEB_SERVICE_KEY: "TEST_offline-shared-quota-unit-token", DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "20" };

type TestLedger = { dailyUsed: number; lease: { remainingRequests: number; reservedRequests: number } | null };
class MemoryCas implements SharedQuotaStore {
  value: unknown | null = null;
  revision = 0;
  writes = 0;
  failRead = false;
  failWrite: ((value: TestLedger) => boolean) | null = null;
  afterWrite: (() => void) | null = null;

  async read(): Promise<{ etag: string; value: unknown } | null> {
    if (this.failRead) throw new Error("offline simulated storage read failure");
    return this.value === null ? null : { etag: String(this.revision), value: structuredClone(this.value) };
  }

  async compareAndSwap(etag: string | null, value: unknown) {
    this.writes += 1;
    if (this.failWrite?.(value as TestLedger)) throw new Error("offline simulated storage write failure");
    if (etag !== (this.value === null ? null : String(this.revision))) return false;
    this.value = structuredClone(value);
    this.revision += 1;
    this.afterWrite?.();
    return true;
  }
}

const isDrivingError = (code: string, upstreamRequests: number, status?: number) => (error: unknown) => error instanceof RoadOpsDrivingError && error.code === code && error.usage?.upstreamRequests === upstreamRequests && (status === undefined || error.status === status);
const sharedFailure = () => new SharedQuotaError("ROADOPS_QUOTA_UNAVAILABLE", 503, "离线共享额度故障。");

function context(options: { dailyBudget?: number; perIdentityLimit?: number; failAt?: number; failure?: "http" | "network" | "convert" } = {}) {
  const store = new MemoryCas();
  let timestamp = Date.UTC(2026, 9, 9, 4);
  const now = () => timestamp;
  const advance = (milliseconds: number) => { timestamp += milliseconds; };
  const events: string[] = [];
  const calls: string[] = [];
  const quota = createSharedRoadOpsQuota({ store, now, dailyBudget: options.dailyBudget, perIdentityLimit: options.perIdentityLimit });
  const instrument = (source: RoadOpsSharedQuota = quota, failurePhase?: "reserve" | "attempt"): RoadOpsSharedQuota => ({
    usage: identity => source.usage(identity),
    reserve: async (identity, requests) => {
      events.push(`reserve:${requests}`);
      if (failurePhase === "reserve") throw sharedFailure();
      const lease = await source.reserve(identity, requests);
      return {
        beforeAttempt: async () => {
          events.push("beforeAttempt");
          if (failurePhase === "attempt") throw sharedFailure();
          await lease.beforeAttempt();
        },
        close: async () => { events.push("close"); await lease.close(); },
      };
    },
  });
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const kind = String(url).includes("/convert") ? "convert" : body.packs[0]?.need_polyline === false ? "matrix" : "route";
    events.push(`fetch:${kind}`);
    calls.push(kind);
    advance(1_000);
    if (calls.length === options.failAt) {
      if (options.failure === "network") throw new TypeError("offline simulated transport failure");
      if (options.failure === "convert") return Response.json({ status: 40100, results: [] });
      return new Response("offline simulated provider failure", { status: 503 });
    }
    if (kind === "convert") {
      return Response.json({ status: 10000, results: String(body.locations).split(";").map(pair => { const [lng, lat] = pair.split(",").map(Number); return { lng, lat }; }) });
    }
    return Response.json({ status: 10000, results: body.packs.map((pack: { need_polyline: boolean }, index: number) => ({ errcode: 0, routes: [{ dist: pack.need_polyline ? 7_200 : 900 + index * 10, duration: pack.need_polyline ? 600 : 60 + index * 3, geo_list: pack.need_polyline ? [{ longitude: 110.45, latitude: 20.02 }, { longitude: 110.47, latitude: 20.03 }, { longitude: 110.50, latitude: 20.00 }] : [] }] })) });
  };
  const service = (sharedQuota: RoadOpsSharedQuota | undefined = instrument()) => createRoadOpsDrivingService({ env, fetchImpl, now, minimumUpstreamGapMs: 0, requireSharedQuota: true, ...(sharedQuota ? { sharedQuota } : {}) });
  return { store, quota, now, advance, events, calls, instrument, fetchImpl, service };
}

test("manual planning reserves two attempts before conversion and route HTTP, then closes", async () => {
  const fixture = context();
  const plan = await fixture.service().plan(input, "alice");
  assert.deepEqual(fixture.events, ["reserve:2", "beforeAttempt", "fetch:convert", "beforeAttempt", "fetch:route", "close"]);
  assert.equal(plan.usage.upstreamRequests, 2);
  assert.equal(plan.usage.dailyUsed, 2);
  assert.equal(plan.usage.dailyRemaining, 98);
  assert.deepEqual(plan.stopOrder, ["origin", "candidate", "destination"]);
  assert.ok(plan.map.features[0].geometry.coordinates.length >= 2);
  assert.doesNotMatch(JSON.stringify(plan), /TEST_offline-shared-quota-unit-token/);
});

test("optimized planning reserves three attempts and gates matrix and polyline independently", async () => {
  const fixture = context();
  const plan = await fixture.service().plan({ ...input, orderMode: "optimize" }, "alice");
  assert.deepEqual(fixture.events, ["reserve:3", "beforeAttempt", "fetch:convert", "beforeAttempt", "fetch:matrix", "beforeAttempt", "fetch:route", "close"]);
  assert.equal(plan.usage.upstreamRequests, 3);
  assert.equal(plan.usage.dailyUsed, 3);
  assert.equal(plan.usage.perIdentityUsed, 3);
});

test("required shared protection without a configured quota prevents every HTTP request", async () => {
  const fixture = context();
  const service = createRoadOpsDrivingService({ env, fetchImpl: fixture.fetchImpl, now: fixture.now, minimumUpstreamGapMs: 0, requireSharedQuota: true });
  await assert.rejects(service.plan(input, "alice"), isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503));
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, []);
});

test("shared storage read failure prevents reserve, fetch, and local fallback", async () => {
  const fixture = context();
  fixture.store.failRead = true;
  await assert.rejects(fixture.service().plan(input, "alice"), isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503));
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.store.writes, 0);
});

test("shared reserve rejection prevents every HTTP request and creates no releasable lease", async () => {
  const fixture = context();
  await assert.rejects(fixture.service(fixture.instrument(fixture.quota, "reserve")).plan(input, "alice"), isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503));
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, ["reserve:2"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 0);
});

test("attempt rejection releases all unsent reservation and never falls back to local quota", async () => {
  const fixture = context();
  await assert.rejects(fixture.service(fixture.instrument(fixture.quota, "attempt")).plan(input, "alice"), isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503));
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, ["reserve:2", "beforeAttempt", "close"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 0);
});

test("failed permission CAS never reaches fetch and cleanup returns only the unattempted charge", async () => {
  const fixture = context();
  fixture.store.failWrite = state => !!state.lease && state.lease.remainingRequests < state.lease.reservedRequests;
  await assert.rejects(fixture.service().plan(input, "alice"), isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503));
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, ["reserve:2", "beforeAttempt", "close"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 0);
});

test("late committed permission is conservatively charged while transport remains blocked", async () => {
  const fixture = context();
  fixture.store.afterWrite = () => {
    const state = fixture.store.value as TestLedger;
    if (state.lease && state.lease.remainingRequests < state.lease.reservedRequests) fixture.advance(170_001);
  };
  await assert.rejects(fixture.service().plan(input, "alice"), isDrivingError("ROADOPS_QUOTA_LEASE_INVALID", 0, 429));
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, ["reserve:2", "beforeAttempt", "close"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 1);
});

test("provider HTTP failures keep the charged attempt, refund unused reservation, and never retry", async () => {
  const fixture = context({ failAt: 1, failure: "http" });
  let failure: RoadOpsDrivingError | undefined;
  await assert.rejects(fixture.service().plan(input, "alice"), error => {
    assert.ok(isDrivingError("ROADOPS_DIDI_UPSTREAM_HTTP", 1, 502)(error));
    failure = error as RoadOpsDrivingError;
    return true;
  });
  assert.deepEqual(fixture.calls, ["convert"]);
  assert.deepEqual(fixture.events, ["reserve:2", "beforeAttempt", "fetch:convert", "close"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 1);
  assert.equal(failure?.usage?.dailyUsed, 1, "error usage must reflect the persisted charge after unused attempts are released");
  assert.equal(failure?.usage?.dailyRemaining, 99);
});

test("provider network errors do not retry or spend the remaining route attempts", async () => {
  const fixture = context({ failAt: 1, failure: "network" });
  await assert.rejects(fixture.service().plan({ ...input, orderMode: "optimize" }, "alice"), isDrivingError("ROADOPS_DIDI_UPSTREAM_FAILED", 1, 502));
  assert.deepEqual(fixture.calls, ["convert"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 1);
});

test("failed directed matrix leaves exactly two attempted requests charged and sends no final route", async () => {
  const fixture = context({ failAt: 2, failure: "http" });
  await assert.rejects(fixture.service().plan({ ...input, orderMode: "optimize" }, "alice"), isDrivingError("ROADOPS_DIDI_UPSTREAM_HTTP", 2, 502));
  assert.deepEqual(fixture.calls, ["convert", "matrix"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 2);
  assert.equal(fixture.events.filter(event => event === "close").length, 1);
});

test("invalid conversion response stops subsequent HTTP and retains its attempted unit", async () => {
  const fixture = context({ failAt: 1, failure: "convert" });
  await assert.rejects(fixture.service().plan(input, "alice"), isDrivingError("ROADOPS_DIDI_CONVERT_FAILED", 1, 502));
  assert.deepEqual(fixture.calls, ["convert"]);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 1);
});

test("cache hit consults shared usage and adds no reservation, attempt, or provider HTTP", async () => {
  const fixture = context();
  const service = fixture.service();
  await service.plan(input, "alice");
  const priorEvents = [...fixture.events], priorWrites = fixture.store.writes;
  const cached = await service.plan(input, "bob");
  assert.equal(cached.usage.cached, true);
  assert.equal(cached.usage.upstreamRequests, 0);
  assert.equal(cached.usage.dailyUsed, 2);
  assert.equal(cached.usage.perIdentityUsed, 0);
  assert.deepEqual(fixture.events, priorEvents);
  assert.equal(fixture.store.writes, priorWrites);
  assert.equal(fixture.calls.length, 2);
});

test("cache cannot hide failed shared usage reads or substitute process-local counters", async () => {
  const fixture = context();
  const service = fixture.service();
  await service.plan(input, "alice");
  fixture.store.failRead = true;
  await assert.rejects(service.plan(input, "bob"), isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503));
  assert.equal(fixture.calls.length, 2);
});

test("different service and quota instances share both daily and identity limits", async () => {
  const fixture = context({ dailyBudget: 4, perIdentityLimit: 2 });
  const first = fixture.service();
  const otherQuota = createSharedRoadOpsQuota({ store: fixture.store, now: fixture.now, dailyBudget: 4, perIdentityLimit: 2 });
  const second = fixture.service(fixture.instrument(otherQuota));
  const firstPlan = await first.plan(input, "alice");
  assert.equal(firstPlan.usage.dailyUsed, 2);
  fixture.advance(1_000);
  await assert.rejects(second.plan({ ...input, workMinutes: 241 }, "alice"), isDrivingError("ROADOPS_DIDI_BUDGET_EXHAUSTED", 0, 429));
  assert.equal(fixture.calls.length, 2);
  const secondPlan = await second.plan({ ...input, workMinutes: 241 }, "bob");
  assert.equal(secondPlan.usage.dailyUsed, 4);
  assert.equal(secondPlan.usage.dailyRemaining, 0);
  await assert.rejects(first.plan({ ...input, workMinutes: 242 }, "charlie"), isDrivingError("ROADOPS_DIDI_BUDGET_EXHAUSTED", 0, 429));
  assert.equal(fixture.calls.length, 4);
});

test("concurrent different service instances cannot own or send under the same shared lease", async () => {
  const fixture = context({ dailyBudget: 2, perIdentityLimit: 2 });
  const secondQuota = createSharedRoadOpsQuota({ store: fixture.store, now: fixture.now, dailyBudget: 2, perIdentityLimit: 2 });
  const results = await Promise.allSettled([
    fixture.service().plan(input, "alice"),
    fixture.service(fixture.instrument(secondQuota)).plan({ ...input, workMinutes: 241 }, "bob"),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(failed.reason instanceof RoadOpsDrivingError);
  assert.equal(failed.reason.status, 429);
  assert.equal(failed.reason.usage?.upstreamRequests, 0);
  assert.equal(fixture.calls.length, 2);
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 2);
});

test("persistent shared read outage after one HTTP exposes no stale or process-local balance", async () => {
  const fixture = context();
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await fixture.fetchImpl(url, init);
    fixture.store.failRead = true;
    return response;
  };
  const service = createRoadOpsDrivingService({ env, fetchImpl, now: fixture.now, minimumUpstreamGapMs: 0, requireSharedQuota: true, sharedQuota: fixture.instrument() });
  await assert.rejects(service.plan(input, "alice"), error => {
    assert.ok(isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 1, 503)(error));
    assert.deepEqual((error as RoadOpsDrivingError).usage, { upstreamRequests: 1 }, "unreadable shared balance must be omitted instead of returning an earlier snapshot");
    return true;
  });
  assert.deepEqual(fixture.calls, ["convert"]);
  fixture.store.failRead = false;
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 2, "failed cleanup must conservatively retain its unknown unused charge");
});

test("uncertain committed reservation sends no HTTP, never retries, and reports its conservative charge", async () => {
  const fixture = context();
  fixture.store.afterWrite = () => {
    if ((fixture.store.value as TestLedger).lease) {
      fixture.store.afterWrite = null;
      throw new Error("offline simulated lost reservation response");
    }
  };
  await assert.rejects(fixture.service().plan(input, "alice"), error => {
    assert.ok(isDrivingError("ROADOPS_QUOTA_UNAVAILABLE", 0, 503)(error));
    assert.equal((error as RoadOpsDrivingError).usage?.dailyUsed, 2);
    return true;
  });
  assert.deepEqual(fixture.calls, []);
  assert.deepEqual(fixture.events, ["reserve:2"]);
  assert.equal(fixture.store.writes, 2, "only initial creation and one reservation write may be attempted");
  assert.equal((await fixture.quota.usage("alice")).dailyUsed, 2);
});
