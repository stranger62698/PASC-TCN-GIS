import assert from "node:assert/strict";
import test from "node:test";
import { fieldTaskMapPoints, fieldTaskRouteMap, fieldTaskTargetPoints } from "../app/lib/roadops-task-map";
import { bindFieldTaskRoute, compileFieldTaskRouting, type FieldTaskRouteReceipt } from "../app/lib/roadops-task-routing";
import type { FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { makeSimulatedFieldTaskPlan, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";
import { simulatedFieldResponse } from "./fixtures/roadops-field-routing-response";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function receiptFor(plan: FieldTaskPlan, order?: string[]) {
  return bindFieldTaskRoute(plan, { plan: simulatedFieldResponse(plan, order) }, compileFieldTaskRouting(plan));
}

test("FP2 map preserves return visit identities at identical coordinates without jitter", () => {
  const plan = makeSimulatedReturnPlan(), points = fieldTaskMapPoints(plan), map = fieldTaskRouteMap(plan, receiptFor(plan))!;
  assert.equal(points.length, 3); assert.notEqual(points[0].id, points[2].id);
  assert.deepEqual(points[0].coordinate, points[2].coordinate);
  assert.equal(points[0].stopId, points[2].stopId); assert.match(points[2].name, /返回驻点/);
  assert.deepEqual(map.stops.map(stop => stop.id), plan.visits.map(visit => visit.visitId));
  assert.deepEqual(map.features.map(feature => [feature.properties.from, feature.properties.to]),
    plan.visits.slice(1).map((visit, index) => [plan.visits[index].visitId, visit.visitId]));
  assert.notEqual(map.features[0].id, map.features[1].id);
  assert.ok(map.stops.every(stop => stop.accessStatus === "needs_review"));
});

test("FP2 shared station retains every independent target, name and task count", () => {
  const plan = makeSimulatedSharedStopPlan(), targets = fieldTaskTargetPoints(plan), map = fieldTaskRouteMap(plan, receiptFor(plan))!;
  assert.equal(targets.length, plan.tasks.length); assert.equal(new Set(targets.map(target => target.id)).size, plan.tasks.length);
  const station = map.stops[1], stationTargets = targets.filter(target => target.visitId === station.visitId);
  assert.equal(station.taskCount, 3); assert.deepEqual(station.taskIds, plan.visits[1].taskIds);
  assert.equal(stationTargets.length, 3); assert.equal(new Set(stationTargets.map(target => JSON.stringify(target.coordinate))).size, 3);
  assert.ok(stationTargets.every(target => JSON.stringify(target.vehicleCoordinate) === JSON.stringify(station.coordinate)));
  assert.match(station.name, /3 项任务/); station.taskNames.forEach(name => assert.ok(station.name.includes(name)));
  assert.equal(map.features.length, 2); assert.ok(!("features" in stationTargets[0]));
});

test("FP2 route map uses only supplier directed geometry, not a target connector", () => {
  const plan = makeSimulatedSharedStopPlan(), provider = simulatedFieldResponse(plan);
  const midpoint: [number, number] = [110.304, 20.006];
  provider.field!.legs[0].coordinates.splice(1, 0, midpoint);
  const receipt = bindFieldTaskRoute(plan, { plan: provider }, compileFieldTaskRouting(plan));
  const map = fieldTaskRouteMap(plan, receipt)!;
  assert.deepEqual(map.features[0].geometry.coordinates, receipt.legs[0].coordinates);
  assert.deepEqual(map.features[0].geometry.coordinates[1], midpoint);
  assert.equal(map.features.length, receipt.legs.length);
  assert.ok(map.features.every((feature, index) => feature.id === JSON.stringify([receipt.legs[index].fromVisitId, receipt.legs[index].toVisitId])));
  assert.deepEqual(map.bounds, [110.3, 20, 110.32, 20.02]);
});

test("FP2 optimized map uses report visit order with complete lookup names", () => {
  const plan = makeSimulatedSharedStopPlan(); plan.optimize = true;
  plan.tasks.push({ ...plan.tasks[1], taskId: "extra-task", targetCoordinate: [110.33, 20.03] });
  plan.stops.push({ stopId: "extra-stop", coordinate: [110.33, 20.03], usesVehicleCoordinate: false });
  plan.visits.splice(2, 0, { visitId: "extra-visit", stopId: "extra-stop", taskIds: ["extra-task"], role: "candidate" });
  const aliases = compileFieldTaskRouting(plan).visits.map(visit => visit.pointId);
  const map = fieldTaskRouteMap(plan, receiptFor(plan, [aliases[0], aliases[2], aliases[1], aliases[3]]))!;
  assert.equal(map.stops[1].visitId, "extra-visit"); assert.equal(map.stops[1].visitIndex, 1);
  const names = new Map(map.stops.map(stop => [stop.id, stop.name]));
  assert.ok(map.features.every(feature => names.has(feature.properties.from) && names.has(feature.properties.to)));
  assert.equal(map.stops[2].taskCount, 3);
});

test("FP2 one explicit station needs no route map while visits and targets remain", () => {
  const plan = makeSimulatedReturnPlan(); const stop = { ...plan.stops[0], usesVehicleCoordinate: true };
  plan.stops = [stop]; plan.visits.forEach(visit => { visit.stopId = stop.stopId; });
  assert.equal(fieldTaskRouteMap(plan, null), null);
  assert.equal(fieldTaskMapPoints(plan).length, 3); assert.equal(fieldTaskTargetPoints(plan).length, 3);
  assert.throws(() => fieldTaskRouteMap(plan, receiptFor(makeSimulatedReturnPlan())), /同站任务不接受/);
});

test("FP2 draft marker adapters retain known targets with unknown parking positions", () => {
  const plan = makeSimulatedFieldTaskPlan(); plan.stops[1].coordinate = null; plan.tasks[2].targetCoordinate = null;
  assert.equal(fieldTaskMapPoints(plan).length, 2);
  const targets = fieldTaskTargetPoints(plan);
  assert.equal(targets.length, 2); assert.equal(targets[1].vehicleCoordinate, null);
  assert.deepEqual(targets[1].coordinate, plan.tasks[1].targetCoordinate);
  const renamed = clone(plan); renamed.planId = "another-plan";
  assert.notEqual(targets[1].id, fieldTaskTargetPoints(renamed)[1].id);
  assert.throws(() => fieldTaskRouteMap(plan, null), /坐标未选择/);
});

test("FP2 map rejects missing, stale, mismatched or corrupt directed results", () => {
  const plan = makeSimulatedFieldTaskPlan(), receipt = receiptFor(plan);
  assert.throws(() => fieldTaskRouteMap(plan, null), /缺失/);
  const changed = clone(plan); changed.tasks[1].accessNote = "edited private note";
  assert.throws(() => fieldTaskRouteMap(changed, receipt), /当前任务不一致/);
  const mutations: Array<(value: FieldTaskRouteReceipt) => void> = [
    value => { value.visits.pop(); }, value => { value.legs.pop(); },
    value => { value.legs[0].toVisitId = value.legs[0].fromVisitId; },
    value => { value.legs[0].coordinates = [[1, 1], [1, 1]]; },
  ];
  mutations.forEach(mutate => { const broken = clone(receipt); mutate(broken); assert.throws(() => fieldTaskRouteMap(plan, broken)); });
});

test("FP2 map adapters clone coordinates and metadata without copying private receipt snapshots", () => {
  const plan = makeSimulatedSharedStopPlan(); plan.tasks[1].accessNote = "PRIVATE_MAP_TEST_NOTE";
  const receipt = receiptFor(plan), before = JSON.stringify([plan, receipt]);
  const points = fieldTaskMapPoints(plan), targets = fieldTaskTargetPoints(plan), map = fieldTaskRouteMap(plan, receipt)!;
  assert.doesNotMatch(JSON.stringify([points, targets, map]), /inputSignature|PRIVATE_MAP_TEST_NOTE|providerLegId|endpointEvidence/);
  points[0].coordinate[0] = 0; points[1].taskIds.push("modified");
  targets[0].coordinate[0] = 0; targets[0].vehicleCoordinate![0] = 0;
  map.stops[0].coordinate[0] = 0; map.stops[1].taskNames.push("modified"); map.features[0].geometry.coordinates[0][0] = 0;
  assert.equal(JSON.stringify([plan, receipt]), before);
});
