import assert from "node:assert/strict";
import test from "node:test";
import { assertRoadOpsPlanningMatches, parseRoadOpsDrivingPlan, roadOpsPlanningForRequest, type RoadOpsDrivingRequest, type RoadOpsFieldRoutingTask } from "../app/lib/roadops-driving";
import { createRoadOpsDrivingService, sanitizeRoadOpsDrivingRequest } from "../app/lib/roadops-driving-server";
import { solveRoadOpsPersonalizedRoute, type RoadOpsRouteFixture } from "../app/lib/roadops-route";

function fixture(): RoadOpsRouteFixture {
  const ids = ["s", "a", "b", "t"];
  const points = ids.map((id, index) => ({ id, name: id, role: id === "s" ? "origin" as const : id === "t" ? "destination" as const : "candidate" as const, coordinate: [110 + index * 0.001, 20] as [number, number], defaultDwellMinutes: 0, inspectionValue: 0, reachable: true, sourceFeatureId: null, sourceRoadName: "测试停车点" }));
  const matrix: RoadOpsRouteFixture["matrix"] = Object.fromEntries(ids.map(from => [from, Object.fromEntries(ids.map(to => [to, from === to ? { distanceMeters: 0, durationSeconds: 0 } : null]))]));
  const assign = (from: string, to: string, distanceMeters: number, durationSeconds: number) => { matrix[from][to] = { distanceMeters, durationSeconds }; };
  assign("s", "t", 1000, 5); assign("s", "a", 1000, 10); assign("a", "b", 1000, 10); assign("b", "t", 1000, 10);
  assign("s", "b", 100, 100); assign("b", "a", 100, 100); assign("a", "t", 100, 100); assign("a", "s", 100, 100); assign("b", "s", 1000, 10);
  return { schemaVersion: "roadops-offline-route-fixture-v1", fixtureId: "personalized-synthetic", generatedAt: "2026-10-13T00:00:00Z", mode: "offline_demo", source: { datasetId: "synthetic", file: "test", sha256: "test", attribution: "synthetic", license: "test" }, limits: { maximumCandidates: 6, maximumMatrixPoints: 8 }, assumptions: { speedModel: "synthetic", directionalCost: "synthetic directed", liveTraffic: false, navigationUse: false }, points, matrix, legGeometries: { type: "FeatureCollection", name: "test", features: [] }, defaultPlan: { startId: "s", endId: "t", candidateIds: ["a", "b"], requiredIds: ["a", "b"], workMinutes: 30, returnToStart: false } };
}
const task = (taskId: string, pointId: string, dwellSeconds = 0, patch: Partial<RoadOpsFieldRoutingTask> = {}): RoadOpsFieldRoutingTask => ({ taskId, pointId, dwellSeconds, required: true, priority: "medium", eligible: true, ...patch });
function request(patch: Partial<RoadOpsDrivingRequest> = {}): RoadOpsDrivingRequest {
  return { schemaVersion: "roadops-driving-request-v1", startId: "s", endId: "t", returnToStart: false, workMinutes: 30, strategy: "11", orderMode: "optimize", detailMode: "field", planningGoal: "time", drivingBudgetSeconds: 1800, bufferSeconds: 0, points: fixture().points.map(point => ({ id: point.id, name: point.name, coordinate: point.coordinate, role: point.role, dwellMinutes: 0, inspectionValue: 0, required: true, sourceFeatureId: null, sourceRoadName: "测试停车点" })), fieldTasks: [task("task-a", "a"), task("task-b", "b")], ...patch };
}
function controlledRoads(costs = fixture(), finalMultiplier = 1) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const ids = new Map(costs.points.map(point => [point.coordinate.map(value => value.toFixed(6)).join(","), point.id]));
  const key = (coordinate: string) => coordinate.split(",").map(Number).map(value => value.toFixed(6)).join(",");
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")); calls.push({ body });
    if (typeof body.locations === "string") return new Response(JSON.stringify({ status: 10000, results: body.locations.split(";").map((pair: string) => { const [lng, lat] = pair.split(",").map(Number); return { lng, lat }; }) }));
    const results = (body.packs as Array<{ origin: string; destination: string; need_polyline: boolean }>).map(pack => {
      const from = ids.get(key(pack.origin))!, to = ids.get(key(pack.destination))!, leg = costs.matrix[from]?.[to];
      return leg ? { errcode: 0, routes: [{ dist: leg.distanceMeters, duration: leg.durationSeconds * (pack.need_polyline ? finalMultiplier : 1), geo_list: pack.need_polyline ? [pack.origin, pack.destination].map(pair => { const [longitude, latitude] = pair.split(",").map(Number); return { longitude, latitude }; }) : [] }] } : { errcode: 1, routes: [] };
    });
    return new Response(JSON.stringify({ status: 10000, results }));
  };
  const service = createRoadOpsDrivingService({ env: { DIDI_MAP_WEB_SERVICE_KEY: "TEST_PERSONALIZED_SYNTHETIC_DUMMY_KEY", DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "100" }, fetchImpl, minimumUpstreamGapMs: 0, now: () => Date.UTC(2026, 9, 13) });
  return { calls, service };
}

test("independent time and distance goals use exact directed orders without changing the road preference", () => {
  const fast = solveRoadOpsPersonalizedRoute(fixture(), request());
  const short = solveRoadOpsPersonalizedRoute(fixture(), request({ planningGoal: "distance" }));
  assert.deepEqual(fast.stopOrder, ["s", "a", "b", "t"]); assert.deepEqual(short.stopOrder, ["s", "b", "a", "t"]);
  assert.equal(fast.drivingSeconds, 30); assert.equal(short.distanceMeters, 300);
  assert.deepEqual(roadOpsPlanningForRequest(request({ planningGoal: "distance" })), { requestedStrategy: "11", orderMode: "optimize", orderingObjective: "distance", planningGoal: "distance", drivingBudgetSeconds: 1800, bufferSeconds: 0, fieldTasks: request().fieldTasks });
});

test("a sub-30-minute exact driving budget rejects the shortest overtime order in favor of a feasible order", () => {
  const input = request({ planningGoal: "distance", drivingBudgetSeconds: 60, bufferSeconds: 100, fieldTasks: [task("task-a", "a", 820), task("task-b", "b", 820)] });
  const sanitized = sanitizeRoadOpsDrivingRequest(input), plan = solveRoadOpsPersonalizedRoute(fixture(), sanitized);
  assert.equal(sanitized.workMinutes, 30); assert.equal(sanitized.drivingBudgetSeconds, 60);
  assert.deepEqual(plan.stopOrder, ["s", "a", "b", "t"]); assert.equal(plan.status, "ready"); assert.equal(plan.taskSelection.drivingBudgetSeconds, 60);
  const exact = solveRoadOpsPersonalizedRoute(fixture(), { ...input, drivingBudgetSeconds: 29.999 });
  assert.equal(exact.status, "infeasible"); assert.deepEqual(exact.taskSelection.selectedTaskIds, ["task-a", "task-b"]);
  assert.equal(sanitizeRoadOpsDrivingRequest({ ...input, drivingBudgetSeconds: 0 }).drivingBudgetSeconds, 0);
});

test("input order remains fixed even when the independent goal prefers another permutation", () => {
  const plan = solveRoadOpsPersonalizedRoute(fixture(), request({ planningGoal: "distance", orderMode: "input" }));
  assert.deepEqual(plan.stopOrder, ["s", "a", "b", "t"]);
});

test("six-stop exact search escapes a directed greedy trap and keeps the fixed endpoints", () => {
  const costs = fixture(), ids = ["s", "a", "b", "c", "d", "e", "f", "t"];
  costs.points = ids.map((id, index) => ({ ...costs.points[0], id, name: id, role: id === "s" ? "origin" : id === "t" ? "destination" : "candidate", coordinate: [110 + index * 0.001, 20] }));
  costs.matrix = Object.fromEntries(ids.map(from => [from, Object.fromEntries(ids.map(to => [to, { distanceMeters: from === to ? 0 : 1000, durationSeconds: from === to ? 0 : 1000 }]))]));
  costs.matrix.s.a = { distanceMeters: 1, durationSeconds: 1 }; costs.matrix.a.b = { distanceMeters: 1, durationSeconds: 1 };
  const expected = ["s", "f", "e", "d", "c", "b", "a", "t"];
  expected.slice(1).forEach((id, index) => { costs.matrix[expected[index]][id] = { distanceMeters: 2, durationSeconds: 2 }; });
  const input = request({ points: costs.points.map(point => ({ ...request().points[0], id: point.id, name: point.id, role: point.role, coordinate: point.coordinate })), fieldTasks: ids.filter(id => id !== "s" && id !== "t").map(id => task(`task-${id}`, id)), drivingBudgetSeconds: 100 });
  const plan = solveRoadOpsPersonalizedRoute(costs, input);
  assert.deepEqual(plan.stopOrder, expected); assert.equal(plan.drivingSeconds, 14); assert.equal(plan.taskSelection.selectedTaskIds.length, 6); assert.equal(plan.status, "ready");
});

test("same-station task selection distinguishes maximum coverage from high-priority completion", () => {
  const fieldTasks = [task("required", "a", 600), task("high", "a", 800, { required: false, priority: "high" }), task("low-1", "a", 400, { required: false, priority: "low" }), task("low-2", "a", 400, { required: false, priority: "low" })];
  const input = request({ planningGoal: "coverage", bufferSeconds: 100, drivingBudgetSeconds: 1100, fieldTasks });
  const coverage = solveRoadOpsPersonalizedRoute(fixture(), input), priority = solveRoadOpsPersonalizedRoute(fixture(), { ...input, planningGoal: "priority" });
  assert.deepEqual(coverage.taskSelection.selectedTaskIds, ["required", "low-1", "low-2"]);
  assert.deepEqual(priority.taskSelection.selectedTaskIds, ["required", "high"]);
  assert.deepEqual(coverage.stopOrder, ["s", "a", "t"]); assert.deepEqual(priority.stopOrder, coverage.stopOrder);
  assert.equal(priority.taskSelection.dwellSeconds, 1400); assert.equal(priority.taskSelection.drivingBudgetSeconds, 300);
  assert.ok(coverage.taskSelection.deferredTasks.every(item => item.reason === "time_budget"));
});

test("blocked optional tasks have explicit reasons and never erase a shared required station", () => {
  const input = request({ planningGoal: "coverage", fieldTasks: [task("required", "a", 100), task("blocked", "a", 100, { required: false, eligible: false, ineligibleReason: "入口关闭", ineligibleReasonCode: "access_blocked" }), task("incomplete", "b", 0, { required: false, eligible: false, ineligibleReasonCode: "input_incomplete" })] });
  const plan = solveRoadOpsPersonalizedRoute(fixture(), input);
  assert.deepEqual(plan.taskSelection.selectedTaskIds, ["required"]); assert.ok(plan.stopOrder.includes("a"));
  assert.deepEqual(plan.taskSelection.deferredTasks.map(item => item.reason), ["access_blocked", "input_incomplete"]);
});

test("unknown directed costs cannot become zero, while an optional connecting station can complete required visits", () => {
  const costs = fixture(); costs.matrix.a.t = null;
  const input = request({ planningGoal: "coverage", fieldTasks: [task("required", "a"), task("bridge", "b", 0, { required: false })] });
  const plan = solveRoadOpsPersonalizedRoute(costs, input);
  assert.deepEqual(plan.stopOrder, ["s", "a", "b", "t"]); assert.deepEqual(plan.taskSelection.selectedTaskIds, ["required", "bridge"]);
  costs.matrix.a.b = null;
  assert.throws(() => solveRoadOpsPersonalizedRoute(costs, input), /无法连接全部必查/);
});

test("unreachable optional tasks are deferred and all required tasks remain selected", () => {
  const costs = fixture(); costs.matrix.s.b = null; costs.matrix.a.b = null;
  const input = request({ planningGoal: "coverage", fieldTasks: [task("required", "a"), task("unreachable", "b", 0, { required: false })] });
  const plan = solveRoadOpsPersonalizedRoute(costs, input);
  assert.deepEqual(plan.taskSelection.selectedTaskIds, ["required"]); assert.equal(plan.taskSelection.deferredTasks[0].reason, "unreachable");
});

test("origin work and directed return work are charged once per selected task", () => {
  const input = request({ fieldTasks: [task("origin-work", "s", 200), task("a", "a", 300)] });
  assert.equal(solveRoadOpsPersonalizedRoute(fixture(), sanitizeRoadOpsDrivingRequest(input)).taskSelection.dwellSeconds, 500);
  const returned = solveRoadOpsPersonalizedRoute(fixture(), { ...input, returnToStart: true, endId: "s", planningGoal: "distance" });
  assert.deepEqual(returned.stopOrder, ["s", "a", "s"]); assert.equal(returned.taskSelection.dwellSeconds, 500);
});

test("twenty-task subset search is bounded and honors cancellation without any road fetch", () => {
  const input = request({ planningGoal: "coverage", fieldTasks: Array.from({ length: 20 }, (_value, index) => task(`task-${index}`, "a", 60, { required: false })) });
  let checks = 0;
  assert.throws(() => solveRoadOpsPersonalizedRoute(fixture(), input, { shouldAbort: () => ++checks > 1 }), /规划已取消/);
  assert.equal(checks, 2);
  assert.throws(() => solveRoadOpsPersonalizedRoute(fixture(), { ...input, fieldTasks: [...input.fieldTasks!, task("extra", "a")] }), /20 项/);
  const complete = solveRoadOpsPersonalizedRoute(fixture(), input);
  assert.equal(complete.taskSelection.selectedTaskIds.length, 20);
  assert.equal(complete.taskSelection.dwellSeconds, 1200);
});

test("fixed time or distance uses two HTTP attempts; fixed task selection uses one matrix without reordering", async () => {
  const manual = controlledRoads(), selected = controlledRoads();
  const fixed = request({ planningGoal: "distance", orderMode: "input" });
  const plan = await manual.service.plan(fixed, "controlled"); assert.equal(manual.calls.length, 2); assert.deepEqual(plan.stopOrder, ["s", "a", "b", "t"]);
  const coverage = await selected.service.plan({ ...fixed, planningGoal: "coverage" }, "controlled"); assert.equal(selected.calls.length, 3); assert.deepEqual(coverage.stopOrder, plan.stopOrder);
  assertRoadOpsPlanningMatches(parseRoadOpsDrivingPlan(plan), fixed);
});

test("the live boundary rechecks final raw seconds with selected dwell and buffer and preserves immutable echoes", async () => {
  const mock = controlledRoads(fixture(), 2);
  const input = request({ planningGoal: "distance", drivingBudgetSeconds: 30, bufferSeconds: 100, fieldTasks: [task("a", "a", 820), task("b", "b", 820)] });
  const plan = await mock.service.plan(input, "controlled");
  assert.equal(plan.status, "infeasible"); assert.equal(plan.drivingDurationSeconds, 60); assert.equal(plan.totalMinutes, 30); assert.equal(plan.taskSelection?.dwellSeconds, 1640);
  assertRoadOpsPlanningMatches(parseRoadOpsDrivingPlan(plan), input);
  assert.throws(() => assertRoadOpsPlanningMatches(plan, { ...input, drivingBudgetSeconds: 31 }), /不一致/);
  assert.throws(() => assertRoadOpsPlanningMatches(plan, { ...input, planningGoal: "time" }), /不一致/);
  assert.throws(() => assertRoadOpsPlanningMatches(plan, { ...input, fieldTasks: input.fieldTasks!.map(item => ({ ...item, priority: "high" })) }), /不一致/);
});

test("task constraints are validated before quota reservation or any upstream request", async () => {
  const mock = controlledRoads();
  await assert.rejects(mock.service.plan(request({ planningGoal: "coverage", fieldTasks: [task("blocked", "a", 100, { eligible: false })] }), "controlled"), /约束冲突/);
  await assert.rejects(mock.service.plan(request({ bufferSeconds: 500, fieldTasks: [task("too-long", "a", 1500)] }), "controlled"), /已超过完整工时/);
  assert.equal(mock.calls.length, 0); assert.equal(mock.service.usage("controlled").dailyUsed, 0);
});

test("a return plan with every middle task deferred stops before any fabricated or same-coordinate final route", async () => {
  const mock = controlledRoads();
  const input = request({ planningGoal: "coverage", returnToStart: true, endId: "s", points: request().points.filter(point => point.id !== "t").map(point => ({ ...point, required: point.role === "origin" })), fieldTasks: [task("origin", "s"), task("too-long", "a", 1800, { required: false })] });
  await assert.rejects(mock.service.plan(input, "controlled"), /本次工时内未安排站间核查/);
  assert.equal(mock.calls.length, 2);
  assert.equal((mock.calls[1].body.packs as Array<{ need_polyline: boolean }>).every(pack => !pack.need_polyline), true);
});

test("cache identity includes the independent objective, exact budget, buffer and task priority", async () => {
  const mock = controlledRoads(), input = request();
  const plans = [await mock.service.plan(input, "controlled"), await mock.service.plan({ ...input, planningGoal: "distance" }, "controlled"), await mock.service.plan({ ...input, drivingBudgetSeconds: 1799.5 }, "controlled"), await mock.service.plan({ ...input, bufferSeconds: 1 }, "controlled"), await mock.service.plan({ ...input, fieldTasks: input.fieldTasks!.map(item => ({ ...item, priority: "high" })) }, "controlled")];
  assert.equal(new Set(plans.map(plan => plan.inputFingerprint)).size, 5); assert.equal(mock.calls.length, 15);
  const reused = await mock.service.plan(input, "controlled"); assert.equal(reused.usage.cached, true); assert.equal(mock.calls.length, 15);
});
