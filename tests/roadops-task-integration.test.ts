import assert from "node:assert/strict";
import test from "node:test";
import type { RoadOpsDrivingPlan } from "../app/lib/roadops-driving";
import { createRoadOpsDrivingService, handleRoadOpsDrivingRequest, type RoadOpsDrivingService } from "../app/lib/roadops-driving-server";
import type { FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { buildFieldTaskReport } from "../app/lib/roadops-task-report";
import { bindFieldTaskRoute, compileFieldTaskRouting } from "../app/lib/roadops-task-routing";
import { makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";

/** Offline contract integration only. All fetch calls terminate inside this mock. */
const timestamp = Date.parse("2026-10-09T00:30:00.000Z");
type RoutePack = { origin: string; destination: string; need_polyline: boolean; show_fields?: string; waypoints?: string };
type Call = { path: string; body: { locations?: string; packs?: RoutePack[] } };

function makeMockService(missingLeg?: number) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://lbs.xiaojukeji.com");
    assert.equal(url.searchParams.get("key"), "TEST_FP2_INTEGRATION_KEY");
    const body = JSON.parse(String(init?.body ?? "{}")) as Call["body"];
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/api/v2/convert") {
      assert.equal(typeof body.locations, "string");
      return Response.json({ status: 10000, msg: "OK", results: body.locations!.split(";").map(pair => {
        const [lng, lat] = pair.split(",").map(Number); return { lng, lat };
      }) });
    }
    assert.equal(url.pathname, "/api/v2/routeplanv3", "unexpected upstream endpoint must never fall through to a real fetch");
    assert.ok(body.packs?.length);
    return Response.json({ status: 10000, results: body.packs.map((pack, index) => {
      if (pack.need_polyline && index === missingLeg) return { errcode: 1, errmsg: "simulated missing leg", routes: [] };
      const [fromLng, fromLat] = pack.origin.split(",").map(Number), [toLng, toLat] = pack.destination.split(",").map(Number);
      const duration = fromLng < toLng ? 600 : 1620;
      return { errcode: 0, routes: [{ dist: duration * 10, duration,
        geo_list: pack.need_polyline ? [
          { longitude: fromLng, latitude: fromLat },
          { longitude: (fromLng + toLng) / 2, latitude: (fromLat + toLat) / 2 + 0.002 },
          { longitude: toLng, latitude: toLat },
        ] : [],
        segments: pack.need_polyline ? [{ status: 1, distance: duration * 10, start_index: 0, end_index: 2 }] : [],
        cost: { tolls: "0" }, tag: "测试/模拟 · 非真实路线",
      }] };
    }) });
  };
  const service = createRoadOpsDrivingService({ env: {
    DIDI_MAP_WEB_SERVICE_KEY: "TEST_FP2_INTEGRATION_KEY", DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "100",
  }, fetchImpl, now: () => timestamp, minimumUpstreamGapMs: 0 });
  return { service, calls };
}

/** Outside China so the mock's identity conversion is also the service's identity inverse. */
function outsideChina(plan: FieldTaskPlan) {
  const transform = ([lng, lat]: [number, number]): [number, number] => [Number((-122.45 + lng - 110.3).toFixed(6)), Number((37.78 + lat - 20).toFixed(6))];
  plan.stops.forEach(stop => { stop.coordinate = transform(stop.coordinate!); });
  plan.tasks.forEach(task => { task.targetCoordinate = transform(task.targetCoordinate!); });
  return plan;
}

async function submit(plan: FieldTaskPlan, service: RoadOpsDrivingService) {
  const issued = compileFieldTaskRouting(plan);
  assert.ok(issued.request);
  const result = await handleRoadOpsDrivingRequest({ method: "POST", origin: "http://127.0.0.1:4193", host: "127.0.0.1:4193",
    bodyText: JSON.stringify(issued.request), identity: "synthetic-fp2-integration" }, service);
  // Exercise the wire boundary too, rather than binding a service object directly.
  const body = JSON.parse(JSON.stringify(result.body)) as { plan?: RoadOpsDrivingPlan; error?: { code: string; fallbackAvailable: boolean; usage: { upstreamRequests: number } } };
  return { issued, result, body };
}

for (const optimize of [false, true]) {
  test(`FP2 integration ${optimize ? "optimized" : "fixed"} return uses directed AB/BA and separate departure/final tasks`, async () => {
    const plan = outsideChina(makeSimulatedReturnPlan()); plan.optimize = optimize;
    plan.tasks[0].dwellMinutes = 0.5; plan.tasks[1].dwellMinutes = 20; plan.tasks.at(-1)!.dwellMinutes = 15;
    const mock = makeMockService(), { issued, result, body } = await submit(plan, mock.service);
    assert.equal(result.status, 200); assert.equal(result.headers["cache-control"], "private, no-store");
    const receipt = bindFieldTaskRoute(plan, body, issued), report = buildFieldTaskReport(plan, receipt, { assessedAt: new Date(timestamp).toISOString() });
    assert.deepEqual(receipt.legs.map(leg => leg.durationSeconds), [600, 1620]);
    assert.deepEqual(report.legs.map(leg => leg.drivingMinutes), [10, 27]);
    assert.equal(report.totals.drivingMinutes, 37); assert.equal(report.totals.dwellMinutes, 35.5);
    assert.equal(report.totals.bufferMinutes, 30); assert.equal(report.totals.totalMinutes, 102.5);
    assert.equal(report.status, "needs_review"); assert.equal(report.providerHasRoute, true);
    assert.equal(report.visits.length, 3); assert.equal(report.visits[0].stopId, report.visits[2].stopId);
    assert.notEqual(report.visits[0].visitId, report.visits[2].visitId);
    assert.deepEqual(report.visits.map(visit => visit.dwellMinutes), [0.5, 20, 15]);
    assert.equal(report.visits[2].arrivalMinutes, 57.5); assert.equal(report.visits[2].departureMinutes, 72.5);
    assert.equal(new Set(report.visits.flatMap(visit => visit.tasks.map(task => task.taskId))).size, plan.tasks.length);
    assert.ok(report.visits.flatMap(visit => visit.tasks).every(task => task.accessStatus === "needs_review" && task.lastMileMinutes === null));
    assert.equal(mock.calls.length, optimize ? 3 : 2); assert.equal(body.plan!.usage.upstreamRequests, mock.calls.length);
    assert.equal(mock.calls.at(-1)!.body.packs!.length, 2);
    assert.ok(mock.calls.at(-1)!.body.packs!.every(pack => pack.need_polyline && pack.show_fields === "segments,cost" && !("waypoints" in pack)));
    assert.ok(receipt.legs.every(leg => leg.coordinates.length === 3), "supplier bend vertices remain in each occurrence leg");
    assert.doesNotMatch(JSON.stringify(body), /TEST_FP2_INTEGRATION_KEY/);
  });

  test(`FP2 integration ${optimize ? "optimized" : "fixed"} shared station keeps three 180-minute tasks and only two driving legs`, async () => {
    const plan = outsideChina(makeSimulatedSharedStopPlan()); plan.optimize = optimize;
    plan.tasks.forEach(task => { task.dwellMinutes = plan.visits[1].taskIds.includes(task.taskId) ? 180 : 0; task.accessNote = "私有备注不得发送"; });
    const mock = makeMockService(), { issued, result, body } = await submit(plan, mock.service);
    assert.equal(result.status, 200);
    const receipt = bindFieldTaskRoute(plan, body, issued), report = buildFieldTaskReport(plan, receipt, { assessedAt: new Date(timestamp).toISOString() });
    assert.equal(issued.request!.points.length, 3); assert.ok(issued.request!.points.every(point => point.dwellMinutes === 0));
    assert.equal(report.visits.length, 3); assert.deepEqual(report.visits[1].tasks.map(task => task.taskId), plan.visits[1].taskIds);
    assert.deepEqual(report.visits[1].tasks.map(task => task.dwellMinutes), [180, 180, 180]);
    assert.equal(report.visits[1].dwellMinutes, 540); assert.equal(report.visits[1].arrivalMinutes, 10); assert.equal(report.visits[1].departureMinutes, 550);
    assert.equal(report.totals.dwellMinutes, 540); assert.equal(report.totals.totalMinutes, 590); assert.equal(report.totals.overtimeMinutes, 110);
    assert.equal(report.status, "blocked"); assert.equal(report.legs.length, 2); assert.equal(receipt.legs.length, 2);
    assert.equal(mock.calls.at(-1)!.body.packs!.length, 2, "three tasks at one explicit stop must not produce extra driving packs");
    assert.equal(body.plan!.field!.routePackCount, optimize ? 8 : 2, "matrix pairs and final legs remain packs, not HTTP requests");
    assert.equal(body.plan!.usage.upstreamRequests, optimize ? 3 : 2);
    assert.doesNotMatch(JSON.stringify(issued.request), /私有备注|accessNote|targetCoordinate|模拟核查/);
    assert.doesNotMatch(JSON.stringify(mock.calls), /私有备注|accessNote|targetCoordinate|模拟核查/);
    assert.ok(report.issues.some(issue => issue.code === "target_transfer_unverified"));
  });
}

test("FP2 integration a missing required final leg returns HTTP 422 without a partial plan, retry or line fallback", async () => {
  for (const optimize of [false, true]) {
    const plan = outsideChina(makeSimulatedReturnPlan()); plan.optimize = optimize;
    const mock = makeMockService(1), { issued, result, body } = await submit(plan, mock.service);
    assert.equal(result.status, 422); assert.equal(result.headers["cache-control"], "private, no-store");
    assert.equal(body.plan, undefined); assert.equal(body.error!.code, "ROADOPS_DIDI_UNREACHABLE");
    assert.equal(body.error!.fallbackAvailable, false); assert.equal(body.error!.usage.upstreamRequests, optimize ? 3 : 2);
    assert.equal(mock.calls.length, optimize ? 3 : 2, "unavailable final leg must not cause an automatic retry");
    assert.throws(() => bindFieldTaskRoute(plan, body, issued), /缺少 plan/);
  }
});

test("FP2 integration cached provider response makes zero new HTTP calls yet rebuilds current local dwell safely", async () => {
  const plan = outsideChina(makeSimulatedSharedStopPlan()), mock = makeMockService();
  plan.optimize = true;
  const first = await submit(plan, mock.service), count = mock.calls.length, dailyUsed = mock.service.usage("synthetic-fp2-integration").dailyUsed;
  const updated = structuredClone(plan); updated.revision += 1; updated.tasks[1].dwellMinutes = 180;
  const second = await submit(updated, mock.service);
  assert.equal(second.result.status, 200); assert.equal(mock.calls.length, count); assert.equal(count, 3);
  assert.equal(second.body.plan!.usage.cached, true); assert.equal(second.body.plan!.usage.upstreamRequests, 0);
  assert.equal(second.body.plan!.field!.routePackCount, 0); assert.equal(mock.service.usage("synthetic-fp2-integration").dailyUsed, dailyUsed);
  assert.throws(() => bindFieldTaskRoute(updated, first.body, first.issued), /旧结果未绑定/);
  const receipt = bindFieldTaskRoute(updated, second.body, second.issued), report = buildFieldTaskReport(updated, receipt, { assessedAt: new Date(timestamp).toISOString() });
  assert.equal(receipt.revision, updated.revision); assert.equal(report.totals.dwellMinutes, 220);
  assert.equal(report.totals.totalMinutes, 270); assert.equal(report.visits[1].tasks[0].dwellMinutes, 180);
});
