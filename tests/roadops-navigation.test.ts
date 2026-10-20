import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addNavigationWaypoint, buildNavigationRequest, createNavigationDraft, moveNavigationWaypoint, navigationFieldVisits, navigationRouteSignature, navigationMapPoints, navigationPickLabel, parseNavigationResponse, setNavigationCoordinate, swapNavigationEndpoints, updateNavigationPoint, type NavigationDraft } from "../app/lib/roadops-navigation";
import { handleRoadOpsDrivingRequest, sanitizeRoadOpsDrivingRequest, type RoadOpsDrivingService } from "../app/lib/roadops-driving-server";
import { parseRoadOpsDrivingPlan, readRoadOpsDrivingResponse, roadOpsDrivingError, roadOpsPlanningForRequest, type RoadOpsDrivingPlan, type RoadOpsDrivingRequest } from "../app/lib/roadops-driving";

function completeDraft(): NavigationDraft {
  let draft = createNavigationDraft();
  draft = setNavigationCoordinate(draft, draft.origin.id, [110.33, 20.04]);
  draft = setNavigationCoordinate(draft, draft.destination.id, [110.37, 20.02]);
  return draft;
}

test("navigation opens with empty user inputs and no fixture points", () => {
  const draft = createNavigationDraft();
  assert.equal(draft.origin.coordinate, null);
  assert.equal(draft.destination.coordinate, null);
  assert.deepEqual(draft.waypoints, []);
  assert.deepEqual(navigationMapPoints(draft), []);
  assert.equal(draft.optimize, false);
  assert.throws(() => buildNavigationRequest(draft), /选择起点/);
});

test("request preserves selected coordinates and input order; candidates are always required", () => {
  let draft = completeDraft();
  draft = addNavigationWaypoint(draft);
  draft = setNavigationCoordinate(draft, draft.waypoints[0].id, [110.35, 20.03]);
  const request = buildNavigationRequest(draft);
  assert.equal(request.orderMode, "input");
  assert.equal(request.returnToStart, false);
  assert.equal(request.workMinutes, 480);
  assert.equal(request.detailMode, "field");
  assert.equal(request.planningGoal, "time");
  assert.equal(request.bufferSeconds, 1800);
  assert.equal(request.drivingBudgetSeconds, (480 - 20 - 30) * 60);
  assert.deepEqual(request.points.map(point => point.id), [draft.origin.id, draft.waypoints[0].id, draft.destination.id]);
  assert.deepEqual(request.points.map(point => point.coordinate), [[110.33, 20.04], [110.35, 20.03], [110.37, 20.02]]);
  assert.equal(request.points[1].required, true);
  assert.deepEqual(request.points.map(point => point.dwellMinutes), [0, 20, 0]);
  assert.ok(request.points.every(point => point.sourceFeatureId === null));
});

test("explicit optimize changes only order strategy, not required visits", () => {
  let draft = addNavigationWaypoint(completeDraft());
  draft = setNavigationCoordinate(draft, draft.waypoints[0].id, [110.35, 20.03]);
  const ordinary = buildNavigationRequest(draft);
  const optimized = buildNavigationRequest({ ...draft, optimize: true });
  assert.equal(optimized.orderMode, "optimize");
  assert.deepEqual(ordinary.points, optimized.points);
});

test("normal navigation has independent complete-task goals and directs subset objectives to the task editor", () => {
  const draft = completeDraft();
  assert.equal(buildNavigationRequest({ ...draft, strategy: "5" }).planningGoal, "distance");
  const independent = buildNavigationRequest({ ...draft, strategy: "5", planningGoal: "time" });
  assert.equal(independent.strategy, "5"); assert.equal(independent.planningGoal, "time");
  for (const planningGoal of ["coverage", "priority"] as const) assert.throws(() => buildNavigationRequest({ ...draft, planningGoal }), /完整外业任务入口/);
});

test("normal navigation preserves exact zero and sub-minute driving budgets without counting dwell twice", () => {
  const draft = updateNavigationPoint({ ...completeDraft(), workMinutes: 30, bufferMinutes: 29.75 }, completeDraft().destination.id, { dwellMinutes: 0.125 });
  const input = buildNavigationRequest(draft), sanitized = sanitizeRoadOpsDrivingRequest(input);
  assert.equal(input.drivingBudgetSeconds, 7.5); assert.equal(sanitized.drivingBudgetSeconds, 7.5);
  assert.equal(sanitized.points.find(point => point.role === "destination")?.dwellMinutes, 0.125);
  assert.equal(sanitized.workMinutes, 30); assert.equal(input.fieldTasks, undefined);
  assert.equal(buildNavigationRequest({ ...completeDraft(), workMinutes: 30, bufferMinutes: 30 }).drivingBudgetSeconds, 0);
  assert.throws(() => buildNavigationRequest({ ...draft, bufferMinutes: 30 }), /已超过可用工时/);
});

test("vehicle arrival is routed separately from the field target; private review notes stay local", () => {
  let draft = completeDraft();
  draft = setNavigationCoordinate(draft, `vehicle:${draft.destination.id}`, [110.368, 20.022]);
  draft = updateNavigationPoint(draft, draft.destination.id, { dwellMinutes: 15, accessReview: "confirmed", accessNote: "现场核实备注，不上传地图服务" });
  const request = buildNavigationRequest(draft), visit = navigationFieldVisits(draft)[1];
  assert.deepEqual(request.points[1].coordinate, [110.368, 20.022]);
  assert.deepEqual(visit.coordinate, [110.37, 20.02]);
  assert.deepEqual(visit.vehicleCoordinate, [110.368, 20.022]);
  assert.equal(visit.accessReview, "confirmed");
  assert.equal(request.points[1].dwellMinutes, 15);
  assert.doesNotMatch(JSON.stringify(request), /accessNote|accessReview|现场核实备注/);
  assert.deepEqual(navigationMapPoints(draft)[1].coordinate, [110.368, 20.022]);
  assert.equal(navigationPickLabel(draft, `vehicle:${draft.destination.id}`), "终点车辆到达点");
  const moved = setNavigationCoordinate(draft, draft.destination.id, [110.38, 20.03]);
  assert.equal(moved.destination.vehicleCoordinate, null);
  assert.equal(moved.destination.accessReview, "unknown");
  assert.equal(moved.destination.accessNote, "");
});

test("notes and start-clock edits stay local; solver budgets, dwell and goals invalidate the route", () => {
  const draft = completeDraft(), signature = navigationRouteSignature(draft);
  const notes = updateNavigationPoint(draft, draft.destination.id, { name: "现场核查", accessReview: "blocked", accessNote: "禁入" });
  assert.equal(navigationRouteSignature({ ...notes, startTime: "09:00" }), signature);
  assert.notEqual(navigationRouteSignature({ ...draft, bufferMinutes: 45 }), signature);
  assert.notEqual(navigationRouteSignature({ ...draft, workMinutes: 360 }), signature);
  assert.notEqual(navigationRouteSignature({ ...draft, planningGoal: "distance" }), signature);
  assert.notEqual(navigationRouteSignature(updateNavigationPoint(draft, draft.destination.id, { dwellMinutes: 30 })), signature);
  assert.notEqual(navigationRouteSignature({ ...draft, strategy: "2" }), signature);
  assert.notEqual(navigationRouteSignature(setNavigationCoordinate(draft, `vehicle:${draft.destination.id}`, [110.375, 20.02])), signature);
  assert.throws(() => buildNavigationRequest({ ...draft, startTime: "28:00" }), /出发时间/);
  assert.throws(() => buildNavigationRequest({ ...draft, bufferMinutes: -1 }), /机动时间/);
  assert.throws(() => buildNavigationRequest({ ...draft, workMinutes: 15 }), /工时/);
  assert.throws(() => buildNavigationRequest(updateNavigationPoint(draft, draft.destination.id, { dwellMinutes: 181 })), /停留/);
});

test("missing destination and any unselected waypoint block the request", () => {
  const draft = completeDraft();
  assert.throws(() => buildNavigationRequest(setNavigationCoordinate(draft, draft.destination.id, null)), /选择终点/);
  assert.throws(() => buildNavigationRequest(addNavigationWaypoint(draft)), /选择途经点 1/);
});

test("invalid finite/range coordinates and duplicates at server precision are rejected", () => {
  const draft = completeDraft();
  for (const coordinate of [[NaN, 20], [Infinity, 20], [181, 20], [110, -91]] as [number, number][]) {
    assert.throws(() => buildNavigationRequest(setNavigationCoordinate(draft, draft.origin.id, coordinate)), /坐标无效/);
  }
  assert.throws(() => buildNavigationRequest(setNavigationCoordinate(draft, draft.destination.id, [110.33000001, 20.04000001])), /不能重合/);
});

test("only six waypoints are allowed and newly added tasks do not reuse deleted identities", () => {
  let draft = completeDraft();
  for (let index = 0; index < 6; index += 1) {
    draft = addNavigationWaypoint(draft);
    draft = setNavigationCoordinate(draft, draft.waypoints[index].id, [110.34 + index / 100, 20.06]);
  }
  assert.equal(buildNavigationRequest(draft).points.length, 8);
  assert.throws(() => addNavigationWaypoint(draft), /最多添加 6/);
  assert.throws(() => buildNavigationRequest({ ...draft, waypoints: [...draft.waypoints, { ...draft.waypoints[0], id: "extra" }] }), /最多支持 6/);
  const refilled = addNavigationWaypoint({ ...draft, waypoints: draft.waypoints.slice(1) });
  assert.equal(new Set(refilled.waypoints.map(point => point.id)).size, 6);
  assert.ok(!refilled.waypoints.some(point => point.id === draft.waypoints[0].id));
});

test("map projections preserve selected points only and do not mutate input coordinates", () => {
  const draft = addNavigationWaypoint(completeDraft());
  const points = navigationMapPoints(draft);
  assert.deepEqual(points.map(point => point.index), [0, 2]);
  points[0].coordinate[0] = 99;
  assert.equal(draft.origin.coordinate?.[0], 110.33);
  assert.equal(navigationPickLabel(draft, draft.waypoints[0].id), "途经点 1");
});

test("reordering affects ordered visits; exchanging endpoints preserves their roles and waypoint order", () => {
  let draft = addNavigationWaypoint(addNavigationWaypoint(completeDraft()));
  draft = setNavigationCoordinate(draft, draft.waypoints[0].id, [110.35, 20.03]);
  draft = setNavigationCoordinate(draft, draft.waypoints[1].id, [110.36, 20.025]);
  const moved = moveNavigationWaypoint(draft, draft.waypoints[1].id, -1);
  assert.deepEqual(buildNavigationRequest(moved).points.map(point => point.id), [draft.origin.id, draft.waypoints[1].id, draft.waypoints[0].id, draft.destination.id]);
  assert.deepEqual(buildNavigationRequest(moved).points.map(point => point.name), ["起点", "途经点 1", "途经点 2", "终点"]);
  assert.deepEqual(navigationMapPoints(moved).map(point => point.name), ["起点", "途经点 1", "途经点 2", "终点"]);
  const swapped = swapNavigationEndpoints(moved);
  assert.deepEqual(swapped.origin.coordinate, draft.destination.coordinate);
  assert.deepEqual(swapped.destination.coordinate, draft.origin.coordinate);
  assert.equal(swapped.origin.role, "origin");
  assert.deepEqual(swapped.waypoints, moved.waypoints);
  assert.equal(moveNavigationWaypoint(draft, draft.waypoints[0].id, -1), draft);
});

test("invalid duplicate ids, roles and strategies cannot build requests", () => {
  const draft = completeDraft();
  assert.throws(() => buildNavigationRequest({ ...draft, destination: { ...draft.destination, id: draft.origin.id } }), /标识重复/);
  assert.throws(() => buildNavigationRequest({ ...draft, destination: { ...draft.destination, role: "origin" } }), /角色无效/);
  assert.throws(() => buildNavigationRequest({ ...draft, strategy: "invalid" as NavigationDraft["strategy"] }), /有效的驾车策略/);
});

test("navigation module has no fixture/OSM dependency and panel uses the tested response parser", () => {
  const model = readFileSync("app/lib/roadops-navigation.ts", "utf8");
  const panel = readFileSync("app/components/RoadNavigationPanel.tsx", "utf8");
  assert.doesNotMatch(model, /loadRoadOps|fetch\(|roadops-osm|roadops-fixture/);
  assert.match(panel, /fetch\("\/api\/roadops\/driving"/);
  assert.match(panel, /readRoadOpsDrivingResponse\(response\)/);
  assert.match(panel, /parseNavigationResponse\(raw, request\)/);
  assert.doesNotMatch(panel, /didi_contract_replay|loadRoadOpsOsmLayer/);
});

function samplePlan(request: RoadOpsDrivingRequest): RoadOpsDrivingPlan {
  const dwellMinutes = request.points.reduce((sum, point) => sum + point.dwellMinutes, 0);
  const totalMinutes = 5 + dwellMinutes + (request.bufferSeconds ?? 0) / 60;
  return {
    schemaVersion: "roadops-driving-plan-v1", provider: "didi_web_service", mode: "didi_live", generatedAt: "2026-09-26T00:00:00.000Z", inputFingerprint: "unit-test", planning: roadOpsPlanningForRequest(request), status: "ready",
    stopOrder: request.points.map(point => point.id), selectedCandidateIds: request.points.filter(point => point.role === "candidate").map(point => point.id), excluded: [],
    totalDistanceMeters: 2000, drivingMinutes: 5, drivingDurationSeconds: 300, dwellMinutes, totalMinutes, workMinutes: request.workMinutes, overtimeMinutes: Math.max(0, totalMinutes - request.workMinutes),
    map: {
      fixtureId: "unit-test-only", mode: "didi_live", bounds: null,
      stops: request.points.map((point, index) => ({ ...point, defaultDwellMinutes: point.dwellMinutes, reachable: true, markerRole: point.role === "origin" ? "start" : point.role === "destination" ? "end" : "waypoint", visitIndex: point.role === "candidate" ? index : null })),
      features: [{ type: "Feature", id: "unit-test-route", properties: { from: request.startId, to: request.endId, distanceMeters: 2000, durationSeconds: 300, source: "didi_web_service" }, geometry: { type: "LineString", coordinates: request.points.map(point => point.coordinate) } }],
    },
    usage: { cached: false, upstreamRequests: 2, dailyUsed: 2, dailyBudget: 50, dailyRemaining: 48, perIdentityUsed: 2, perIdentityLimit: 20 }, boundary: "unit-test-only",
  };
}

test("frontend parses the actual HTTP handler success envelope after a JSON round trip", async () => {
  const request = buildNavigationRequest(completeDraft());
  const plan = samplePlan(request);
  const service: RoadOpsDrivingService = { plan: async payload => { assert.deepEqual(payload, request); return plan; }, usage: () => plan.usage };
  const response = await handleRoadOpsDrivingRequest({ method: "POST", origin: "http://127.0.0.1:4192", host: "127.0.0.1:4192", bodyText: JSON.stringify(request), identity: "navigation-contract-test" }, service);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { plan });
  const raw = await readRoadOpsDrivingResponse(new Response(JSON.stringify(response.body), { status: response.status, headers: response.headers }));
  assert.deepEqual(parseNavigationResponse(raw, request), plan);
  assert.throws(() => parseNavigationResponse(plan, request), /缺少 plan/);
  assert.throws(() => parseNavigationResponse({ plan: null }, request), /响应为空/);
  assert.throws(() => parseNavigationResponse({ error: { message: "unavailable" } }, request), /缺少 plan/);
});

test("HTML preview and proxy responses identify the missing API instead of route-data or login failures", async () => {
  for (const status of [200, 401, 502]) {
    const response = new Response("<!doctype html><title>Static preview</title>", { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
    await assert.rejects(readRoadOpsDrivingResponse(response), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.match(error.message, /网页.*静态预览.*API/s);
      assert.doesNotMatch(error.message, /需要登录|缺少 plan/);
      return true;
    });
  }
});

test("malformed JSON and unknown response formats fail clearly while JSON service errors remain intact", async () => {
  await assert.rejects(readRoadOpsDrivingResponse(new Response("{invalid", { status: 200, headers: { "Content-Type": "application/json" } })), /JSON 无法解析（HTTP 200）/);
  await assert.rejects(readRoadOpsDrivingResponse(new Response("Unavailable", { status: 503 })), /未返回 JSON（HTTP 503）/);
  const body = { error: { code: "ROADOPS_UNAVAILABLE", message: "路线服务维护中", retryable: false, fallbackAvailable: false } };
  const raw = await readRoadOpsDrivingResponse(new Response(JSON.stringify(body), { status: 503, headers: { "Content-Type": "application/json" } }));
  assert.equal(roadOpsDrivingError(raw, "fallback"), body.error.message);
  const auth = { error: { message: "登录会话已过期" } };
  assert.deepEqual(await readRoadOpsDrivingResponse(new Response(JSON.stringify(auth), { status: 401, headers: { "Content-Type": "application/problem+json" } })), auth);
});

test("navigation response rejects replay, missing routes and omitted or repeated mandatory stops", () => {
  let draft = addNavigationWaypoint(completeDraft());
  draft = setNavigationCoordinate(draft, draft.waypoints[0].id, [110.35, 20.03]);
  const request = buildNavigationRequest(draft), plan = samplePlan(request);
  assert.throws(() => parseNavigationResponse({ plan: { ...plan, mode: "didi_replay", provider: "didi_contract_replay" } }, request), /真实驾车路线/);
  assert.throws(() => parseNavigationResponse({ plan: { ...plan, map: { ...plan.map, features: [] } } }, request), /真实驾车路线/);
  assert.throws(() => parseNavigationResponse({ plan: { ...plan, stopOrder: [request.startId, request.endId] } }, request), /全部指定点位/);
  assert.throws(() => parseNavigationResponse({ plan: { ...plan, stopOrder: [request.startId, request.startId, request.endId] } }, request), /全部指定点位/);
});

test("navigation binds only the strategy, order mode and objective echoed for the current request", () => {
  const request = buildNavigationRequest({ ...completeDraft(), strategy: "2", optimize: true });
  const plan = samplePlan(request);
  assert.deepEqual(parseNavigationResponse({ plan }, request), plan);
  for (const planning of [
    undefined,
    { ...plan.planning!, requestedStrategy: "1" as const },
    { ...plan.planning!, orderingObjective: "distance" as const },
    { requestedStrategy: "2" as const, orderMode: "input" as const, orderingObjective: "input_order" as const },
    { ...plan.planning!, planningGoal: "distance" as const, orderingObjective: "distance" as const },
    { ...plan.planning!, drivingBudgetSeconds: plan.planning!.drivingBudgetSeconds! + 1 },
    { ...plan.planning!, bufferSeconds: plan.planning!.bufferSeconds! + 1 },
  ]) {
    assert.throws(() => parseNavigationResponse({ plan: { ...plan, planning } }, request), /策略|排序目标/);
  }
  const legacy = { ...plan, planning: undefined, drivingDurationSeconds: undefined };
  assert.equal(parseRoadOpsDrivingPlan(legacy), legacy, "legacy artifacts remain readable without a current request binding");
  assert.throws(() => parseNavigationResponse({ plan: legacy }, request), /策略|排序目标/);
});

test("input response must retain waypoint order while explicit optimization may permute it", () => {
  let draft = addNavigationWaypoint(addNavigationWaypoint(completeDraft()));
  draft = setNavigationCoordinate(draft, draft.waypoints[0].id, [110.35, 20.03]);
  draft = setNavigationCoordinate(draft, draft.waypoints[1].id, [110.36, 20.025]);
  const request = buildNavigationRequest(draft), plan = samplePlan(request);
  const reordered = { ...plan, stopOrder: [request.startId, draft.waypoints[1].id, draft.waypoints[0].id, request.endId] };
  assert.throws(() => parseNavigationResponse({ plan: reordered }, request), /手动途经顺序/);
  const optimizedRequest = { ...request, orderMode: "optimize" as const };
  assert.deepEqual(parseNavigationResponse({ plan: { ...reordered, planning: roadOpsPlanningForRequest(optimizedRequest) } }, optimizedRequest).stopOrder, reordered.stopOrder);
});
