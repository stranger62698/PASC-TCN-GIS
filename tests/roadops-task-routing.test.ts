import assert from "node:assert/strict";
import test from "node:test";
import { compileFieldTaskRouting, bindFieldTaskRoute as bindIssuedFieldTaskRoute } from "../app/lib/roadops-task-routing";
import { sanitizeRoadOpsDrivingRequest } from "../app/lib/roadops-driving-server";
import type { RoadOpsDrivingPlan } from "../app/lib/roadops-driving";
import { parseFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { makeSimulatedFieldTaskPlan, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";
import { simulatedFieldResponse as simulatedResponse } from "./fixtures/roadops-field-routing-response";

const bindFieldTaskRoute = (task: FieldTaskPlan, response: unknown) => bindIssuedFieldTaskRoute(task, response, compileFieldTaskRouting(task));

test("FP2 ordinary and return compilers preserve visit IDs while v1 receives unique physical points", () => {
  for (const task of [makeSimulatedFieldTaskPlan(), makeSimulatedReturnPlan()]) {
    const before = JSON.stringify(task), compiled = compileFieldTaskRouting(task);
    assert.equal(compiled.mode, "driving");
    assert.deepEqual(compiled.visits.map(visit => visit.visitId), task.visits.map(visit => visit.visitId));
    assert.deepEqual(sanitizeRoadOpsDrivingRequest(compiled.request), compiled.request);
    assert.equal(JSON.stringify(task), before);
  }
  const compiled = compileFieldTaskRouting(makeSimulatedReturnPlan());
  assert.equal(compiled.request!.points.length, 2);
  assert.equal(compiled.request!.returnToStart, true);
  assert.equal(compiled.request!.startId, compiled.request!.endId);
  assert.notEqual(compiled.visits[0].visitId, compiled.visits.at(-1)!.visitId);
  assert.equal(compiled.visits[0].stopId, compiled.visits.at(-1)!.stopId);
});

test("FP2 three shared tasks generate one vehicle point without truncating dwell or leaking target data", () => {
  const task = makeSimulatedSharedStopPlan();
  task.tasks.forEach(item => { item.accessNote = "私有备注不得发送"; item.dwellMinutes = 180; });
  const compiled = compileFieldTaskRouting(task);
  assert.equal(compiled.request!.points.length, 3);
  assert.equal(compiled.visits[1].taskIds.length, 3);
  assert.equal(compiled.visits[1].dwellMinutes, 540);
  assert.equal(compiled.localDwellMinutes, 900);
  assert.ok(compiled.request!.points.every(point => point.dwellMinutes === 0));
  assert.doesNotMatch(JSON.stringify(compiled.request), /私有备注|110\.3101|110\.3102|accessNote|targetCoordinate|模拟核查/);
  const receipt = bindFieldTaskRoute(task, { plan: simulatedResponse(task) });
  assert.equal(receipt.legs.length, 2);
  assert.equal(receipt.totalMinutes, 950);
  assert.equal(receipt.overtimeMinutes, 470);
  assert.equal(receipt.accessStatus, "needs_review");
});

test("FP2 return preserves asymmetric AB/BA legs and counts departure and final arrival tasks once", () => {
  const task = makeSimulatedReturnPlan(); task.tasks[0].dwellMinutes = 0.5; task.tasks.at(-1)!.dwellMinutes = 15;
  const provider = simulatedResponse(task, undefined, [600, 1620]);
  const before = JSON.stringify(provider), receipt = bindFieldTaskRoute(task, { plan: provider });
  assert.equal(receipt.drivingMinutes, 37);
  assert.equal(receipt.localDwellMinutes, 35.5);
  assert.equal(receipt.totalMinutes, 102.5);
  assert.deepEqual(receipt.legs.map(leg => [leg.fromVisitId, leg.toVisitId]), [[task.visits[0].visitId, task.visits[1].visitId], [task.visits[1].visitId, task.visits[2].visitId]]);
  assert.notEqual(receipt.legs[0].id, receipt.legs[1].id);
  assert.equal(receipt.endpointEvidence[0].arrival, null);
  assert.equal(receipt.endpointEvidence[2].departure, null);
  assert.deepEqual(receipt.endpointEvidence[1].arrival, provider.field!.legs[0].coordinates.at(-1));
  assert.deepEqual(receipt.endpointEvidence[1].departure, provider.field!.legs[1].coordinates[0]);
  receipt.legs[0].coordinates[0][0] = 0;
  assert.equal(JSON.stringify(provider), before);
});

test("FP2 one explicit physical station is local work, never a fake supplier success or self-route", () => {
  const task = makeSimulatedReturnPlan();
  const stop = { ...task.stops[0], usesVehicleCoordinate: true };
  task.stops = [stop]; task.visits = task.visits.map(visit => ({ ...visit, stopId: stop.stopId }));
  const compiled = compileFieldTaskRouting(task);
  assert.equal(compiled.mode, "no_station_driving"); assert.equal(compiled.request, null);
  assert.equal(compiled.visits.length, 3);
  assert.equal(compiled.visits.flatMap(visit => visit.taskIds).length, task.tasks.length);
  assert.throws(() => bindFieldTaskRoute(task, { plan: {} }), /无需站间驾车/);
});

test("FP2 unconfirmed coordinate coincidence is rejected, including six-decimal rounding collisions", () => {
  for (const offset of [0, 0.00000001]) {
    const task = makeSimulatedFieldTaskPlan();
    task.stops[1].coordinate = [110.3 + offset, 20]; task.stops[1].usesVehicleCoordinate = true;
    const before = JSON.stringify(task);
    assert.throws(() => compileFieldTaskRouting(task), /不同停车点.*重合/);
    assert.equal(JSON.stringify(task), before);
  }
});

test("FP2 interior repeated visits cannot be silently deduplicated by the v1 service adapter", () => {
  const task = makeSimulatedFieldTaskPlan();
  task.visits.splice(2, 0, { visitId: "visit-origin-again", stopId: task.stops[0].stopId, taskIds: [], role: "candidate" });
  assert.doesNotThrow(() => parseFieldTaskPlan(task));
  assert.throws(() => compileFieldTaskRouting(task), /重复停靠需访问实例版服务/);
});

test("FP2 incomplete, blocked, optional, dated or unconfirmed shared-stop semantics fail explicitly", () => {
  const mutations: Array<[(plan: FieldTaskPlan) => void, RegExp]> = [
    [plan => { plan.tasks[0].targetCoordinate = null; }, /坐标未选择/],
    [plan => { plan.stops[0].coordinate = null; }, /坐标未选择/],
    [plan => { plan.tasks[1].legacyAccessReview = "blocked"; }, /不可进入/],
    [plan => { plan.tasks[1].required = false; }, /可延期/],
    [plan => { plan.date = "2026-10-09"; }, /未来 ETA/],
    [plan => { plan.stops[0].coordinate = [111, 20]; }, /显式设置车辆/],
  ];
  for (const [mutate, expected] of mutations) {
    const task = makeSimulatedFieldTaskPlan(); mutate(task);
    assert.throws(() => compileFieldTaskRouting(task), expected);
  }
});

test("FP2 transport aliases do not rewrite long or non-ASCII user-owned stop/task identities", () => {
  const task = makeSimulatedFieldTaskPlan();
  task.stops[1].stopId = "中文停车位置".repeat(20); task.visits[1].stopId = task.stops[1].stopId;
  task.tasks[1].taskId = "中文核查任务"; task.visits[1].taskIds = [task.tasks[1].taskId];
  const compiled = compileFieldTaskRouting(task);
  assert.doesNotThrow(() => sanitizeRoadOpsDrivingRequest(compiled.request));
  assert.equal(compiled.visits[1].stopId, task.stops[1].stopId);
  assert.equal(compiled.visits[1].taskIds[0], "中文核查任务");
  assert.doesNotMatch(JSON.stringify(compiled.request), /中文停车|中文核查/);
});

test("FP2 incomplete/reversed legs, extra visits, bad map bindings and replay never bind", () => {
  const task = makeSimulatedReturnPlan();
  const mutations: Array<(plan: RoadOpsDrivingPlan) => void> = [
    plan => { plan.field!.legs.pop(); },
    plan => { plan.field!.legs[1].fromId = plan.stopOrder[0]; },
    plan => { plan.selectedCandidateIds = []; },
    plan => { plan.map.stops[0].coordinate = [1, 1]; },
    plan => { plan.stopOrder[1] = "extra-stop"; },
    plan => { plan.field = undefined; },
    plan => { plan.mode = "didi_replay"; },
  ];
  for (const mutate of mutations) { const provider = simulatedResponse(task); mutate(provider); assert.throws(() => bindFieldTaskRoute(task, { plan: provider })); }
});

test("FP2 current task binding rejects missing or mismatched strategy, objective and order echoes", () => {
  const task = { ...makeSimulatedFieldTaskPlan(), strategy: "2" as const, optimize: true };
  const provider = simulatedResponse(task);
  assert.equal(bindFieldTaskRoute(task, { plan: provider }).revision, task.revision);
  for (const planning of [
    undefined,
    { ...provider.planning!, requestedStrategy: "1" as const },
    { ...provider.planning!, orderingObjective: "distance" as const },
    { requestedStrategy: "2" as const, orderMode: "input" as const, orderingObjective: "input_order" as const },
  ]) {
    assert.throws(() => bindFieldTaskRoute(task, { plan: { ...provider, planning } }), /策略|排序目标/);
  }
});

test("FP2 explicit optimization can permute whole visits without reordering their tasks", () => {
  const task = makeSimulatedSharedStopPlan();
  task.tasks.push({ ...task.tasks[1], taskId: "additional-task", targetCoordinate: [110.33, 20.03] });
  task.stops.push({ stopId: "additional-stop", coordinate: [110.33, 20.03], usesVehicleCoordinate: false });
  task.visits.splice(2, 0, { visitId: "additional-visit", stopId: "additional-stop", taskIds: ["additional-task"], role: "candidate" });
  const visits = compileFieldTaskRouting(task).visits;
  const reordered = [visits[0], visits[2], visits[1], visits[3]].map(visit => visit.pointId);
  const provider = simulatedResponse(task, reordered);
  assert.throws(() => bindFieldTaskRoute(task, { plan: provider }), /固定的到访顺序/);
  const optimized = { ...task, optimize: true };
  const receipt = bindFieldTaskRoute(optimized, { plan: simulatedResponse(optimized, reordered) });
  assert.deepEqual(receipt.visits[2].taskIds, task.visits[1].taskIds);
  assert.equal(receipt.visits.flatMap(visit => visit.taskIds).length, task.tasks.length);
});

test("FP2 original task and visit limits apply before any physical-stop reduction", () => {
  const task = makeSimulatedFieldTaskPlan();
  task.visits = Array.from({ length: 9 }, (_, index) => ({ ...task.visits[0], visitId: `many-${index}`, taskIds: [], role: index === 0 ? "origin" : index === 8 ? "destination" : "candidate" }));
  assert.throws(() => compileFieldTaskRouting(task), /到访实例数量/);
  const manyTasks = makeSimulatedSharedStopPlan();
  manyTasks.tasks = Array.from({ length: 21 }, (_, index) => ({ ...manyTasks.tasks[0], taskId: `many-${index}` }));
  assert.throws(() => compileFieldTaskRouting(manyTasks), /核查任务数量/);
});

test("FP2 late responses cannot acquire a changed revision, strategy, identity or local task input", () => {
  const task = makeSimulatedFieldTaskPlan(), issued = compileFieldTaskRouting(task), response = { plan: simulatedResponse(task) };
  const mutations: Array<(plan: FieldTaskPlan) => void> = [
    plan => { plan.revision += 1; }, plan => { plan.strategy = "2"; }, plan => { plan.planId = "another-plan"; },
    plan => { plan.visits[1].visitId = "another-visit"; }, plan => { plan.tasks[1].accessNote = "新核验说明"; },
    plan => { plan.tasks[1].dwellMinutes = 99; },
  ];
  for (const mutate of mutations) {
    const changed: FieldTaskPlan = JSON.parse(JSON.stringify(task)); mutate(changed);
    assert.throws(() => bindIssuedFieldTaskRoute(changed, response, issued), /旧结果未绑定/);
  }
  assert.equal(bindIssuedFieldTaskRoute(task, response, issued).revision, task.revision);
  issued.request!.strategy = "2";
  assert.throws(() => bindIssuedFieldTaskRoute(task, response, issued), /旧结果未绑定/);
});
