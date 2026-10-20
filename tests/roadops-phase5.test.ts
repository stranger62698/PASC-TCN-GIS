import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseRoadOpsDrivingPlan, roadOpsPlanningForRequest, type RoadOpsDrivingRequest } from "../app/lib/roadops-driving";
import { createRoadOpsDrivingService, RoadOpsDrivingError } from "../app/lib/roadops-driving-server";

const input: RoadOpsDrivingRequest = {
  schemaVersion: "roadops-driving-request-v1",
  startId: "origin",
  endId: "terminal",
  returnToStart: false,
  workMinutes: 240,
  strategy: "1",
  points: [
    { id: "origin", name: "驻点", coordinate: [110.45, 20.02], role: "origin", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "驻点" },
    { id: "terminal", name: "收队点", coordinate: [110.50, 20.00], role: "destination", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "收队点" },
    { id: "candidate-a", name: "核查点 A", coordinate: [110.47, 20.03], role: "candidate", dwellMinutes: 20, inspectionValue: 9, required: true, sourceFeatureId: "way/1", sourceRoadName: "道路 A" },
    { id: "candidate-b", name: "核查点 B", coordinate: [110.48, 20.01], role: "candidate", dwellMinutes: 20, inspectionValue: 7, required: false, sourceFeatureId: "way/2", sourceRoadName: "道路 B" },
  ],
};

const fakeDidi = (finalDurationSeconds = 840) => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: String(url), body });
    if (String(url).includes("/convert")) {
      const results = String(body.locations).split(";").map((pair: string) => { const [lng, lat] = pair.split(",").map(Number); return { lng, lat }; });
      return new Response(JSON.stringify({ status: 10000, msg: "OK", results }), { status: 200 });
    }
    const packs = body.packs as Array<{ origin: string; destination: string; need_polyline: boolean }>;
    const results = packs.map((pack, index) => ({ errcode: 0, errmsg: "ok", routes: [{ dist: pack.need_polyline ? 7_200 : 900 + index * 17, duration: pack.need_polyline ? finalDurationSeconds : 90 + index * 3, geo_list: pack.need_polyline ? [{ longitude: 110.45, latitude: 20.02 }, { longitude: 110.47, latitude: 20.03 }, { longitude: 110.50, latitude: 20.00 }] : [] }] }));
    return new Response(JSON.stringify({ status: 10000, msg: "OK", results }), { status: 200 });
  };
  return { calls, fetchImpl };
};

test("controlled Didi closure uses convert, one directed matrix and one final polyline", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "10", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "10", DIDI_ROUTE_QPS_LIMIT: "10" }, fetchImpl: mock.fetchImpl, now: () => Date.UTC(2026, 8, 22), minimumUpstreamGapMs: 0 });
  const plan = await service.plan(input, "tester");
  assert.equal(plan.mode, "didi_live");
  assert.deepEqual(plan.planning, { requestedStrategy: "1", orderMode: "optimize", orderingObjective: "duration" });
  assert.equal(plan.drivingDurationSeconds, 840);
  assert.equal(plan.usage.upstreamRequests, 3);
  assert.equal(mock.calls.length, 3);
  assert.match(mock.calls[0].url, /\/convert\?key=/);
  assert.match(mock.calls[1].url, /\/routeplanv3\?key=/);
  assert.equal((mock.calls[1].body as { packs: unknown[] }).packs.length, input.points.length * (input.points.length - 1));
  assert.equal((mock.calls[2].body as { packs: Array<{ need_polyline: boolean; waypoints: string }> }).packs[0].need_polyline, true);
  assert.ok((mock.calls[2].body as { packs: Array<{ waypoints: string }> }).packs[0].waypoints.includes(";"));
  assert.equal(plan.map.features[0].properties.source, "didi_web_service");
  assert.ok(plan.map.features[0].geometry.coordinates.length >= 2);
  assert.doesNotMatch(JSON.stringify(plan), /unit-key/);
});

test("same normalized input hits server cache without another upstream call", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "10", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "10" }, fetchImpl: mock.fetchImpl, now: () => Date.UTC(2026, 8, 22), minimumUpstreamGapMs: 0 });
  await service.plan(input, "tester");
  const second = await service.plan(input, "tester");
  assert.equal(second.usage.cached, true);
  assert.equal(second.usage.upstreamRequests, 0);
  assert.equal(mock.calls.length, 3);
});

test("input order uses only conversion plus one real route and retains every waypoint even over time", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "2", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "2" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan({ ...input, orderMode: "input", workMinutes: 30 }, "tester");
  assert.equal(mock.calls.length, 2);
  assert.equal(plan.usage.upstreamRequests, 2);
  assert.deepEqual(plan.stopOrder, ["origin", "candidate-a", "candidate-b", "terminal"]);
  assert.deepEqual(plan.selectedCandidateIds, ["candidate-a", "candidate-b"]);
  assert.deepEqual(plan.excluded, []);
  assert.equal(plan.status, "infeasible");
  assert.equal(plan.dwellMinutes, 40);
  assert.equal(plan.overtimeMinutes, 24);
  const packs = (mock.calls[1].body as { packs: Array<{ waypoints: string; strategy: string; need_polyline: boolean }> }).packs;
  assert.equal(packs.length, 1);
  assert.equal(packs[0].waypoints, "110.47,20.03;110.48,20.01");
  assert.equal(packs[0].strategy, "1");
  assert.equal(packs[0].need_polyline, true);
  assert.equal((await service.plan({ ...input, orderMode: "input", workMinutes: 30 }, "tester")).usage.cached, true);
});

test("manual cache separates waypoint order, route strategy and optimization mode", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "30" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const manual = { ...input, orderMode: "input" as const };
  const first = await service.plan(manual, "tester");
  const reversed = await service.plan({ ...manual, points: [...input.points].reverse() }, "tester");
  assert.deepEqual(reversed.stopOrder, ["origin", "candidate-b", "candidate-a", "terminal"]);
  const timeFirst = await service.plan({ ...manual, strategy: "2" }, "tester");
  const optimized = await service.plan({ ...manual, orderMode: "optimize" }, "tester");
  assert.equal(new Set([first, reversed, timeFirst, optimized].map(plan => plan.inputFingerprint)).size, 4);
  assert.equal(mock.calls.length, 9);
  assert.equal((await service.plan(manual, "tester")).usage.upstreamRequests, 0);
});

test("manual return trip visits selected waypoints and returns to origin in two requests", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan({ ...input, orderMode: "input", returnToStart: true, points: input.points.filter(point => point.id !== input.endId) }, "tester");
  assert.deepEqual(plan.stopOrder, ["origin", "candidate-a", "candidate-b", "origin"]);
  assert.equal(plan.usage.upstreamRequests, 2);
  const final = (mock.calls[1].body as { packs: Array<{ origin: string; destination: string }> }).packs[0];
  assert.equal(final.origin, final.destination);
});

test("manual mode rejects insufficient budget and malformed points without upstream requests", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "1" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  await assert.rejects(service.plan({ ...input, orderMode: "input" }, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_BUDGET_EXHAUSTED" && error.usage?.upstreamRequests === 0);
  await assert.rejects(service.plan({ ...input, orderMode: "input", points: input.points.map(point => ({ ...point, role: "candidate" })) }, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_BAD_REQUEST");
  assert.equal(mock.calls.length, 0);
});

test("required unreachable points produce an error instead of a route silently omitting them", async () => {
  const mock = fakeDidi();
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await mock.fetchImpl(url, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.packs?.[0]?.need_polyline === false) return Response.json({ status: 10000, results: body.packs.map(() => ({ errcode: 1, routes: [] })) });
    return response;
  };
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl, minimumUpstreamGapMs: 0 });
  await assert.rejects(service.plan(input, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_UNREACHABLE" && error.usage?.upstreamRequests === 2);
  assert.equal(mock.calls.length, 2);
});

test("return-to-start request does not require the unused destination", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan({ ...input, returnToStart: true, points: input.points.filter(point => point.id !== input.endId) }, "tester");
  assert.equal(plan.stopOrder[0], input.startId);
  assert.equal(plan.stopOrder.at(-1), input.startId);
  assert.equal(plan.usage.upstreamRequests, 3);
  const final = (mock.calls[2].body as { packs: Array<{ origin: string; destination: string }> }).packs[0];
  assert.equal(final.destination, final.origin);
});

test("concurrent identical requests share the completed cache instead of spending twice", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const [first, second] = await Promise.all([service.plan(input, "first"), service.plan({ ...input, points: [...input.points].reverse() }, "second")]);
  assert.equal(mock.calls.length, 3);
  assert.equal(first.usage.upstreamRequests, 3);
  assert.equal(second.usage.upstreamRequests, 0);
  assert.equal(second.usage.cached, true);
  assert.equal(second.usage.perIdentityUsed, 0);
});

test("concurrent different requests are paced and count only their own HTTP attempts", async () => {
  const mock = fakeDidi(), startedAt: number[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    startedAt.push(Date.now());
    return mock.fetchImpl(url, init);
  };
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl, minimumUpstreamGapMs: 20 });
  const [first, second] = await Promise.all([service.plan(input, "first"), service.plan({ ...input, workMinutes: 241 }, "second")]);
  assert.equal(mock.calls.length, 6);
  assert.equal(first.usage.upstreamRequests, 3);
  assert.equal(second.usage.upstreamRequests, 3);
  assert.equal(second.usage.dailyUsed, 6);
  for (let index = 1; index < startedAt.length; index += 1) assert.ok(startedAt[index] - startedAt[index - 1] >= 18, "upstream start times must observe the single-instance pacing interval");
});

test("queued budget preflight prevents two partial plans from consuming the final budget", async () => {
  const mock = fakeDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "5" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const [first, second] = await Promise.allSettled([service.plan(input, "first"), service.plan({ ...input, workMinutes: 241 }, "second")]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  if (second.status === "rejected") {
    assert.ok(second.reason instanceof RoadOpsDrivingError);
    assert.equal(second.reason.code, "ROADOPS_DIDI_BUDGET_EXHAUSTED");
    assert.ok(second.reason.usage, "budget errors must expose the actual request count");
    assert.equal(second.reason.usage.upstreamRequests, 0);
  }
  assert.equal(mock.calls.length, 3);
  assert.equal((await service.plan(input, "third")).usage.cached, true, "failed queued plans must not poison the queue or cache");
});

test("request counts remain correct when a plan crosses Asia/Shanghai midnight", async () => {
  const mock = fakeDidi();
  let timestamp = Date.UTC(2026, 8, 22, 15, 59, 59);
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await mock.fetchImpl(url, init);
    timestamp = Date.UTC(2026, 8, 22, 16, 0, 1);
    return response;
  };
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl, now: () => timestamp, minimumUpstreamGapMs: 0 });
  const plan = await service.plan(input, "tester");
  assert.equal(plan.usage.upstreamRequests, 3);
  assert.equal(plan.usage.dailyUsed, 2);
  assert.equal(plan.usage.perIdentityUsed, 2);
});

test("failed stages report actual HTTP attempts and never retry automatically", async () => {
  for (const failureAt of [1, 2, 3]) {
    const mock = fakeDidi();
    let attempts = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      attempts += 1;
      return attempts === failureAt ? new Response("upstream unavailable", { status: 503 }) : mock.fetchImpl(url, init);
    };
    const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl, minimumUpstreamGapMs: 0 });
    await assert.rejects(service.plan(input, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_UPSTREAM_HTTP" && error.usage?.upstreamRequests === failureAt && error.usage?.dailyUsed === failureAt);
    assert.equal(attempts, failureAt);
  }
});

test("already cancelled plans make no upstream request", async () => {
  const mock = fakeDidi(), controller = new AbortController();
  controller.abort();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  await assert.rejects(service.plan(input, "tester", controller.signal), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_CANCELLED" && error.usage?.upstreamRequests === 0);
  assert.equal(mock.calls.length, 0);
});

test("budget preflight and missing key fail before any upstream request", async () => {
  const mock = fakeDidi();
  const limited = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "2", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "2" }, fetchImpl: mock.fetchImpl, now: () => Date.UTC(2026, 8, 22), minimumUpstreamGapMs: 0 });
  await assert.rejects(limited.plan(input, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_BUDGET_EXHAUSTED");
  const missing = createRoadOpsDrivingService({ env: {}, fetchImpl: mock.fetchImpl, now: () => Date.UTC(2026, 8, 22), minimumUpstreamGapMs: 0 });
  await assert.rejects(missing.plan(input, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_NOT_CONFIGURED");
  assert.equal(mock.calls.length, 0);
});

test("checked-in replay is deterministic, explicitly non-live and contains no Didi response", () => {
  const text = readFileSync("public/data/roadops/jiangdong-didi-contract-replay.json", "utf8");
  const manifest = JSON.parse(readFileSync("public/data/roadops/jiangdong-didi-contract-replay.manifest.json", "utf8"));
  const plan = parseRoadOpsDrivingPlan(JSON.parse(text));
  assert.equal(plan.mode, "didi_replay");
  assert.equal(plan.provider, "didi_contract_replay");
  assert.equal(plan.usage.upstreamRequests, 0);
  assert.equal(manifest.containsDidiResponse, false);
  assert.equal(manifest.outputSha256, createHash("sha256").update(text).digest("hex"));
  assert.ok(plan.map.features[0].geometry.coordinates.length > 100);
});

test("Phase 5 UI requires explicit click and preserves offline fallback", () => {
  const source = readFileSync("app/components/RoadRoutePlannerPanel.tsx", "utf8");
  assert.match(source, /onClick=\{runLiveDriving\}/);
  assert.match(source, /生成实时驾车路线/);
  assert.match(source, /脱敏契约回放/);
  assert.match(source, /setRouteMode\("offline"\); setDrivingStatus\("error"\)/);
  assert.match(source, /Key 仅存服务端/);
  const effects = [...source.matchAll(/useEffect\(\(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/g)].map(match => match[0]).join("\n");
  assert.doesNotMatch(effects, /api\/roadops\/driving/);
});

const fieldInput: RoadOpsDrivingRequest = {
  ...input, orderMode: "input", detailMode: "field",
  // Synthetic coordinates outside China make the mock conversion an identity,
  // allowing endpoint-offset checks independently of coordinate transformation.
  points: input.points.map((point, index) => ({ ...point, coordinate: [-122.45 + index * 0.01, 37.78 + index * 0.01] })),
};

type MockFieldRoute = {
  dist: number; duration: number;
  geo_list: Array<{ longitude: number; latitude: number }>;
  segments?: Array<{ status: number; distance: number; start_index: number; end_index: number }>;
  cost?: { tolls: string };
  tag?: string;
};

const fakeFieldDidi = (change?: (route: MockFieldRoute, index: number) => MockFieldRoute | null) => {
  const mock = fakeDidi();
  const fetchImpl: typeof fetch = async (url, init) => {
    const response = await mock.fetchImpl(url, init);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.packs?.[0]?.show_fields !== "segments,cost") return response;
    const results = body.packs.map((pack: { origin: string; destination: string }, index: number) => {
      const from = pack.origin.split(",").map(Number), to = pack.destination.split(",").map(Number);
      let route: MockFieldRoute | null = {
        dist: 1_000 + index * 500, duration: 300 + index * 60,
        geo_list: [{ longitude: from[0], latitude: from[1] }, { longitude: (from[0] + to[0]) / 2, latitude: (from[1] + to[1]) / 2 + 0.002 }, { longitude: to[0], latitude: to[1] }],
        segments: [{ status: index % 5, distance: 1_000 + index * 500, start_index: 0, end_index: 2 }],
        cost: { tolls: index === 0 ? "12.5" : "0" }, tag: "滴图返回标签",
      };
      if (change) route = change(route, index);
      return route ? { errcode: 0, routes: [route] } : { errcode: 1, routes: [] };
    });
    return Response.json({ status: 10000, results });
  };
  return { ...mock, fetchImpl };
};

test("planning objective maps all supported strategies and defaults omitted order mode to optimization", () => {
  for (const strategy of ["1", "2", "5", "11", "13"] as const) {
    const optimize = { requestedStrategy: strategy, orderMode: "optimize", orderingObjective: strategy === "5" ? "distance" : "duration" };
    assert.deepEqual(roadOpsPlanningForRequest({ ...input, strategy }), optimize);
    assert.deepEqual(roadOpsPlanningForRequest({ ...input, strategy, orderMode: "optimize" }), optimize);
    assert.deepEqual(roadOpsPlanningForRequest({ ...input, strategy, orderMode: "input" }), { requestedStrategy: strategy, orderMode: "input", orderingObjective: "input_order" });
  }
});

for (const detailMode of [undefined, "field"] as const) {
  test(`${detailMode ?? "overview"} forwards five strategies in both order modes, isolates caches and echoes exact seconds`, async () => {
    const mock = detailMode === "field" ? fakeFieldDidi((route, index) => ({ ...route, duration: 301 + index * 60 })) : fakeDidi(841);
    const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key", DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "100" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
    const fingerprints = new Set<string>();
    for (const strategy of ["1", "2", "5", "11", "13"] as const) {
      for (const orderMode of ["input", "optimize"] as const) {
        const request = { ...fieldInput, strategy, orderMode, detailMode };
        const before = mock.calls.length;
        const plan = parseRoadOpsDrivingPlan(await service.plan(request, "strategy-test"));
        assert.equal(plan.usage.cached, false, `${strategy}/${orderMode} must get its own cold cache entry`);
        assert.equal(mock.calls.length - before, orderMode === "input" ? 2 : 3);
        assert.deepEqual(plan.planning, { requestedStrategy: strategy, orderMode, orderingObjective: orderMode === "input" ? "input_order" : strategy === "5" ? "distance" : "duration" });
        assert.equal(plan.drivingDurationSeconds, detailMode === "field" ? 1083 : 841, "provider seconds must not be reconstructed from rounded minutes");
        assert.equal(plan.drivingMinutes, detailMode === "field" ? 18.1 : 14);
        const routeCalls = mock.calls.slice(before).filter(call => call.url.includes("/routeplanv3"));
        assert.equal(routeCalls.length, orderMode === "input" ? 1 : 2);
        for (const call of routeCalls) {
          const packs = (call.body as { packs: Array<{ strategy: string }> }).packs;
          assert.ok(packs.length > 0);
          assert.ok(packs.every(pack => pack.strategy === strategy), "both directed matrix and final polyline packs must forward the requested strategy");
        }
        fingerprints.add(plan.inputFingerprint);
        const cached = parseRoadOpsDrivingPlan(await service.plan(request, "strategy-test"));
        assert.equal(mock.calls.length - before, orderMode === "input" ? 2 : 3);
        assert.equal(cached.usage.cached, true);
        assert.equal(cached.usage.upstreamRequests, 0);
        assert.equal(cached.inputFingerprint, plan.inputFingerprint);
        assert.deepEqual(cached.planning, plan.planning);
        assert.equal(cached.drivingDurationSeconds, plan.drivingDurationSeconds);
      }
    }
    assert.equal(fingerprints.size, 10, "strategy and input/optimize mode each participate in cache isolation");
    const before = mock.calls.length;
    const legacyOrder = await service.plan({ ...fieldInput, detailMode, strategy: "5", orderMode: undefined }, "strategy-test");
    assert.equal(legacyOrder.usage.cached, true, "omitted mode is normalized to optimize");
    assert.equal(mock.calls.length, before);
    assert.deepEqual(legacyOrder.planning, { requestedStrategy: "5", orderMode: "optimize", orderingObjective: "distance" });
  });
}

test("distance strategy 5 and duration strategy 2 choose different directed visit orders when objectives disagree", async context => {
  const points = fieldInput.points.map(point => ({ ...point, required: point.role === "candidate" }));
  const coordinateKey = (pair: string) => pair.split(",").map(value => Number(Number(value).toFixed(6))).join(",");
  const idsByCoordinate = new Map(points.map(point => [coordinateKey(point.coordinate.join(",")), point.id]));
  const costs = new Map<string, { dist: number; duration: number }>([
    ["origin/candidate-a", { dist: 100, duration: 200 }],
    ["candidate-a/candidate-b", { dist: 100, duration: 200 }],
    ["candidate-b/terminal", { dist: 100, duration: 200 }],
    ["origin/candidate-b", { dist: 1000, duration: 30 }],
    ["candidate-b/candidate-a", { dist: 1000, duration: 30 }],
    ["candidate-a/terminal", { dist: 1000, duration: 30 }],
    ["candidate-b/origin", { dist: 100, duration: 200 }],
    ["candidate-a/origin", { dist: 1000, duration: 30 }],
  ]);
  const strategyPacks: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (String(url).includes("/convert")) {
      return Response.json({ status: 10000, results: String(body.locations).split(";").map((pair: string) => { const [lng, lat] = pair.split(",").map(Number); return { lng, lat }; }) });
    }
    const results = body.packs.map((pack: { origin: string; destination: string; strategy: string; need_polyline: boolean }) => {
      strategyPacks.push(pack.strategy);
      const from = pack.origin.split(",").map(Number), to = pack.destination.split(",").map(Number);
      const cost = costs.get(`${idsByCoordinate.get(coordinateKey(pack.origin))}/${idsByCoordinate.get(coordinateKey(pack.destination))}`) ?? { dist: 5000, duration: 900 };
      return { errcode: 0, routes: [{ ...cost, geo_list: pack.need_polyline ? [{ longitude: from[0], latitude: from[1] }, { longitude: to[0], latitude: to[1] }] : [] }] };
    });
    return Response.json({ status: 10000, results });
  };
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl, minimumUpstreamGapMs: 0 });
  const request = { ...fieldInput, points, orderMode: "optimize" as const };
  const distance = parseRoadOpsDrivingPlan(await service.plan({ ...request, strategy: "5" }, "objective-test"));
  const distancePackCount = strategyPacks.length;
  const duration = parseRoadOpsDrivingPlan(await service.plan({ ...request, strategy: "2" }, "objective-test"));
  assert.deepEqual(distance.stopOrder, ["origin", "candidate-a", "candidate-b", "terminal"]);
  assert.deepEqual(duration.stopOrder, ["origin", "candidate-b", "candidate-a", "terminal"]);
  assert.equal(distance.totalDistanceMeters, 300);
  assert.equal(distance.drivingDurationSeconds, 600);
  assert.equal(duration.totalDistanceMeters, 3000);
  assert.equal(duration.drivingDurationSeconds, 90);
  assert.ok(strategyPacks.slice(0, distancePackCount).every(strategy => strategy === "5"));
  assert.ok(strategyPacks.slice(distancePackCount).every(strategy => strategy === "2"));
  assert.equal(distance.planning?.orderingObjective, "distance");
  assert.equal(duration.planning?.orderingObjective, "duration");
  assert.notEqual(distance.inputFingerprint, duration.inputFingerprint);

  await context.test("distance ordering reserves destination inspection before assessing route feasibility", async () => {
    const constrainedPoints = points.map(point => ({ ...point, dwellMinutes: point.role === "destination" ? 25 : 0 }));
    const constrained = parseRoadOpsDrivingPlan(await service.plan({ ...request, points: constrainedPoints, workMinutes: 30, strategy: "5" }, "objective-test"));
    assert.deepEqual(constrained.stopOrder, ["origin", "candidate-b", "candidate-a", "terminal"], "choose the longer fast route when the shorter route would exceed the complete work window");
    assert.equal(constrained.totalDistanceMeters, 3000);
    assert.equal(constrained.drivingDurationSeconds, 90);
    assert.equal(constrained.drivingMinutes, 1.5);
    assert.equal(constrained.dwellMinutes, 25);
    assert.equal(constrained.totalMinutes, 26.5);
    assert.equal(constrained.workMinutes, 30);
    assert.equal(constrained.overtimeMinutes, 0);
    assert.equal(constrained.status, "ready");
  });

  await context.test("distance ordering reserves return-arrival origin inspection exactly once", async () => {
    const returnPoints = points.filter(point => point.role !== "destination").map(point => ({ ...point, dwellMinutes: point.role === "origin" ? 25 : 0 }));
    const returned = parseRoadOpsDrivingPlan(await service.plan({ ...request, points: returnPoints, returnToStart: true, workMinutes: 30, strategy: "5" }, "objective-test"));
    assert.deepEqual(returned.stopOrder, ["origin", "candidate-b", "candidate-a", "origin"]);
    assert.equal(returned.totalDistanceMeters, 3000);
    assert.equal(returned.drivingDurationSeconds, 90);
    assert.equal(returned.drivingMinutes, 1.5);
    assert.equal(returned.dwellMinutes, 25);
    assert.equal(returned.totalMinutes, 26.5);
    assert.equal(returned.workMinutes, 30);
    assert.equal(returned.overtimeMinutes, 0);
    assert.equal(returned.status, "ready");
  });
});

test("client parser validates optional planning and raw seconds without requiring them on old artifacts", async () => {
  const mock = fakeDidi(841);
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan({ ...input, orderMode: "input" }, "parser-test");
  const legacy = { ...plan, planning: undefined, drivingDurationSeconds: undefined };
  assert.equal(parseRoadOpsDrivingPlan(legacy), legacy);
  for (const planning of [null, [], { ...plan.planning, requestedStrategy: "9" }, { ...plan.planning, orderMode: "auto" }, { ...plan.planning, orderingObjective: "distance" }]) {
    assert.throws(() => parseRoadOpsDrivingPlan({ ...plan, planning }), /策略回显/);
  }
  for (const drivingDurationSeconds of [-1, Infinity, "841", 3000]) {
    assert.throws(() => parseRoadOpsDrivingPlan({ ...plan, drivingDurationSeconds }), /精确耗时/);
  }
});

test("field mode batches every consecutive driving leg with genuine polylines and returned traffic/cost", async () => {
  const mock = fakeFieldDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = parseRoadOpsDrivingPlan(await service.plan(fieldInput, "tester"));
  assert.equal(mock.calls.length, 2);
  assert.equal(plan.usage.upstreamRequests, 2);
  assert.equal(plan.field?.routePackCount, 3, "packs must not be mislabeled as HTTP attempts");
  assert.equal(plan.field?.guidance, "geometry_only");
  assert.equal(plan.field?.legs.length, 3);
  assert.equal(plan.map.features.length, 3);
  assert.deepEqual(plan.stopOrder, ["origin", "candidate-a", "candidate-b", "terminal"]);
  assert.equal(plan.totalDistanceMeters, 4_500);
  assert.equal(plan.drivingMinutes, 18);
  assert.equal(plan.totalMinutes, 58);
  assert.equal(plan.field?.legs[0].tollsYuan, 12.5);
  assert.equal(plan.field?.legs[0].tag, "滴图返回标签");
  assert.deepEqual(plan.field?.legs[1].traffic, [{ status: 1, distanceMeters: 1_500, startIndex: 0, endIndex: 2 }]);
  assert.ok(plan.field?.access.every(access => access.offsetMeters === 0 && access.status === "near_route"));
  const packs = (mock.calls[1].body as { packs: Array<Record<string, unknown>> }).packs;
  assert.equal(packs.length, 3);
  assert.ok(packs.every(pack => pack.need_polyline === true && pack.show_fields === "segments,cost" && !("waypoints" in pack)));
  assert.equal(packs[0].destination, packs[1].origin);
  assert.equal(packs[1].destination, packs[2].origin);
  for (const [index, leg] of plan.field!.legs.entries()) {
    assert.equal(plan.map.features[index].id, leg.id);
    assert.deepEqual(plan.map.features[index].geometry.coordinates, leg.coordinates);
    assert.equal(leg.coordinates.length, 3, "provider bend vertices must not become a two-point shortcut");
  }
  assert.ok(plan.field!.limitations.some(text => text.includes("不返回道路名和逐转向指令")));
  assert.doesNotMatch(JSON.stringify(plan.field), /"instructions"|"maneuver"|"roadName"|unit-key/);
});

test("field mode cache is distinct from overview and cached results report zero new packs", async () => {
  const mock = fakeFieldDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const overview = await service.plan({ ...fieldInput, detailMode: undefined }, "tester");
  const field = await service.plan(fieldInput, "tester");
  const cached = await service.plan(fieldInput, "tester");
  assert.equal(overview.field, undefined);
  assert.notEqual(overview.inputFingerprint, field.inputFingerprint);
  assert.equal(field.field?.routePackCount, 3);
  assert.equal(cached.field?.routePackCount, 0);
  assert.equal(cached.usage.cached, true);
  assert.equal(cached.usage.upstreamRequests, 0);
  assert.equal(mock.calls.length, 4);
  assert.equal(field.field?.routePackCount, 3, "cache response must not mutate an already returned plan");
});

test("field duration includes destination inspection but not the initial departure dwell", async () => {
  const mock = fakeFieldDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const points = fieldInput.points.map(point => ({ ...point, dwellMinutes: point.role === "origin" ? 15 : point.role === "destination" ? 30 : point.dwellMinutes }));
  const plan = await service.plan({ ...fieldInput, points, workMinutes: 60 }, "tester");
  assert.equal(plan.drivingMinutes, 18);
  assert.equal(plan.dwellMinutes, 70);
  assert.equal(plan.totalMinutes, 88);
  assert.equal(plan.overtimeMinutes, 28);
  assert.equal(plan.status, "infeasible");
  const returned = await service.plan({ ...fieldInput, returnToStart: true, points: points.filter(point => point.role !== "destination") }, "tester");
  assert.equal(returned.dwellMinutes, 55, "returning to origin counts one arrival dwell, not departure plus arrival");
});

test("field optimization counts matrix packs separately from HTTP requests", async () => {
  const mock = fakeFieldDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan({ ...fieldInput, orderMode: "optimize" }, "tester");
  assert.equal(plan.usage.upstreamRequests, 3);
  assert.equal(plan.field?.routePackCount, input.points.length * (input.points.length - 1) + plan.stopOrder.length - 1);
  assert.equal(plan.field?.legs.length, plan.stopOrder.length - 1);
  assert.equal(parseRoadOpsDrivingPlan(plan), plan);
});

test("one unreachable field leg fails the entire plan with leg number, without straight-line substitution", async () => {
  const mock = fakeFieldDidi((route, index) => index === 1 ? null : route);
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  await assert.rejects(service.plan(fieldInput, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && error.code === "ROADOPS_DIDI_UNREACHABLE" && /第 2 段/.test(error.message) && /整条行程未生成/.test(error.message) && error.usage?.upstreamRequests === 2);
  assert.equal(mock.calls.length, 2, "no automatic retry of unavailable legs");
});

test("malformed or missing field geometry fails atomically and identifies the offending leg", async () => {
  for (const geometry of [[], [{ longitude: 0, latitude: 0 }], [{ longitude: 190, latitude: 20 }, { longitude: 110, latitude: 20 }], [{ longitude: 110, latitude: 20 }, { longitude: 110, latitude: 20 }]]) {
    const mock = fakeFieldDidi((route, index) => index === 2 ? { ...route, geo_list: geometry } : route);
    const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
    await assert.rejects(service.plan(fieldInput, "tester"), (error: unknown) => error instanceof RoadOpsDrivingError && /第 3 段/.test(error.message) && error.usage?.upstreamRequests === 2);
    assert.equal(mock.calls.length, 2);
  }
});

test("access checks compare selected points to arrival and departure endpoints and retain the larger gap", async () => {
  const mock = fakeFieldDidi((route, index) => {
    if (index === 0) route.geo_list.at(-1)!.latitude += 0.001;
    if (index === 1) route.geo_list[0].latitude += 0.003;
    return route;
  });
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan(fieldInput, "tester");
  const access = plan.field!.access.find(item => item.pointId === "candidate-a")!;
  assert.equal(access.status, "far_from_route");
  assert.ok(access.offsetMeters > 330 && access.offsetMeters < 335);
  assert.equal(access.thresholdMeters, 50);
  assert.deepEqual(access.roadCoordinate, plan.field!.legs[1].coordinates[0]);
  assert.ok(plan.field!.limitations.some(text => text.includes("靠近路线不代表入口开放")));
  assert.equal(parseRoadOpsDrivingPlan(plan), plan);
});

test("field return trips assess one origin against both outbound and inbound endpoints", async () => {
  const mock = fakeFieldDidi((route, index) => {
    if (index === 2) route.geo_list.at(-1)!.latitude += 0.001;
    return route;
  });
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan({ ...fieldInput, returnToStart: true, points: fieldInput.points.filter(point => point.id !== fieldInput.endId) }, "tester");
  assert.equal(plan.field?.legs.at(-1)?.toId, fieldInput.startId);
  assert.equal(plan.field?.access.length, 3);
  assert.equal(plan.field?.access.find(access => access.pointId === fieldInput.startId)?.status, "far_from_route");
  assert.equal(parseRoadOpsDrivingPlan(plan), plan);
});

test("missing cost/traffic remains unknown and invalid segment indices are never exposed", async () => {
  const mock = fakeFieldDidi((route, index) => index === 0 ? { ...route, cost: undefined, tag: undefined, segments: undefined } : { ...route, cost: { tolls: "not-a-cost" }, segments: [{ status: 9, distance: 12, start_index: 0, end_index: 2 }, { status: 1, distance: 10, start_index: 0, end_index: 999 }] });
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan(fieldInput, "tester");
  assert.ok(plan.field!.legs.every(leg => leg.tollsYuan === null && leg.traffic.length === 0));
  assert.equal(plan.field!.legs[0].tag, null);
  assert.equal(parseRoadOpsDrivingPlan(plan), plan);
});

test("client parser rejects mismatched field contracts rather than presenting unchecked guidance", async () => {
  const mock = fakeFieldDidi();
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "unit-key" }, fetchImpl: mock.fetchImpl, minimumUpstreamGapMs: 0 });
  const plan = await service.plan(fieldInput, "tester");
  const cases = [
    { ...plan, field: null },
    { ...plan, field: { ...plan.field, guidance: "turn_by_turn" } },
    { ...plan, field: { ...plan.field, legs: plan.field!.legs.slice(1) } },
    { ...plan, totalDistanceMeters: 1 },
    { ...plan, field: { ...plan.field, access: [] } },
    { ...plan, field: { ...plan.field, legs: plan.field!.legs.map((leg, index) => index === 1 ? { ...leg, fromId: "wrong" } : leg) } },
    { ...plan, field: { ...plan.field, access: plan.field!.access.map(access => ({ ...access, status: "far_from_route" })) } },
  ];
  for (const invalid of cases) assert.throws(() => parseRoadOpsDrivingPlan(invalid), /外业分段/);
});
