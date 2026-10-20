import assert from "node:assert/strict";
import test from "node:test";
import { addFieldTaskToVisit, addFieldTaskVisit, removeFieldTask, setFieldTaskTargetCoordinate, setFieldTaskTripMode, setFieldVehicleStopCoordinate, shareFieldTaskVisit, splitFieldTask } from "../app/lib/roadops-task-editor";
import { compileFieldTaskRouting } from "../app/lib/roadops-task-routing";
import { parseFieldTaskPlan, type InspectionTask } from "../app/lib/roadops-task-plan";
import { makeSimulatedFieldTaskPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";

const task = (id: string): InspectionTask => ({ taskId: id, name: `模拟任务 ${id}`, targetCoordinate: [110.34, 20.04], dwellMinutes: 25.5, required: true, legacyAccessReview: "unknown", accessNote: "仅本地测试" });

test("FP2 enabling return still visits the original destination and closing return restores it losslessly", () => {
  const original = makeSimulatedFieldTaskPlan(), before = JSON.stringify(original);
  original.stops.at(-1)!.coordinate = [110.329, 20.029]; original.stops.at(-1)!.usesVehicleCoordinate = true;
  const originalWithVehicle = JSON.stringify(original), switched = setFieldTaskTripMode(original, "return_to_start", { visitId: "independent-return" });
  assert.equal(switched.visits[0].stopId, switched.visits.at(-1)!.stopId);
  assert.notEqual(switched.visits[0].visitId, switched.visits.at(-1)!.visitId);
  assert.deepEqual(switched.visits.at(-1)!.taskIds, []);
  assert.deepEqual(switched.tasks, original.tasks);
  assert.equal(switched.visits.at(-2)!.stopId, original.visits.at(-1)!.stopId);
  assert.equal(switched.visits.at(-2)!.role, "candidate");
  assert.equal(JSON.stringify(original), originalWithVehicle);
  assert.notEqual(before, originalWithVehicle);
  assert.equal(compileFieldTaskRouting(switched).request!.returnToStart, true);
  const restored = setFieldTaskTripMode(switched, "one_way");
  assert.deepEqual(restored, original);
  assert.equal(restored.revision, original.revision);
});

test("FP2 closing return never drops work assigned to the return occurrence", () => {
  const returned = setFieldTaskTripMode(makeSimulatedFieldTaskPlan(), "return_to_start");
  const withReturnWork = addFieldTaskToVisit(returned, task("return-task"), returned.visits.at(-1)!.visitId);
  const before = JSON.stringify(withReturnWork);
  assert.throws(() => setFieldTaskTripMode(withReturnWork, "one_way"), /仍有任务/);
  assert.equal(JSON.stringify(withReturnWork), before);
  const original = makeSimulatedFieldTaskPlan();
  assert.throws(() => setFieldTaskTripMode(original, "return_to_start", { visitId: original.visits[0].visitId }), /返回到访标识已存在/);
});

test("FP2 explicit shared visit retains all tasks, target positions, durations and local order", () => {
  const original = makeSimulatedSharedStopPlan(), before = JSON.stringify(original);
  const merged = shareFieldTaskVisit(original, original.visits[1].visitId, original.visits.at(-1)!.visitId, { confirmed: true });
  assert.deepEqual(merged.tasks, original.tasks);
  assert.deepEqual(merged.visits.at(-1)!.taskIds, [...original.visits.at(-1)!.taskIds, ...original.visits[1].taskIds]);
  assert.equal(merged.visits.length, 2);
  assert.equal(merged.stops.length, 2);
  assert.equal(compileFieldTaskRouting(merged).localDwellMinutes, compileFieldTaskRouting(original).localDwellMinutes);
  assert.equal(JSON.stringify(original), before);
  assert.throws(() => shareFieldTaskVisit(original, original.visits[1].visitId, original.visits[0].visitId, { confirmed: false } as never), /确认/);
  assert.throws(() => shareFieldTaskVisit(original, original.visits[0].visitId, original.visits[1].visitId, { confirmed: true }), /只能合并中途/);
});

test("FP2 split gives a shared task an independent visit without changing the other targets or losing work", () => {
  const shared = makeSimulatedSharedStopPlan(), splitting = shared.visits[1].taskIds[1], before = JSON.stringify(shared);
  const separated = splitFieldTask(shared, splitting, { visitId: "split-visit", stopId: "split-stop" });
  assert.deepEqual(separated.tasks, shared.tasks);
  assert.deepEqual(separated.visits[1].taskIds, shared.visits[1].taskIds.filter(id => id !== splitting));
  assert.deepEqual(separated.visits[2].taskIds, [splitting]);
  assert.deepEqual(separated.stops.at(-1)!.coordinate, shared.tasks.find(item => item.taskId === splitting)!.targetCoordinate);
  assert.equal(compileFieldTaskRouting(separated).localDwellMinutes, compileFieldTaskRouting(shared).localDwellMinutes);
  assert.equal(JSON.stringify(shared), before);
  assert.throws(() => splitFieldTask(shared, shared.tasks[0].taskId, { visitId: "bad-split", stopId: "bad-stop" }), /只有一项/);
  assert.throws(() => splitFieldTask(shared, splitting, { visitId: shared.visits[0].visitId, stopId: "new-stop" }), /标识已存在/);
});

test("FP2 new visits respect insertion order and coordinate choice without reusing identities", () => {
  const original = makeSimulatedFieldTaskPlan();
  const added = addFieldTaskVisit(original, { task: task("new-task"), visitId: "new-visit", stopId: "new-stop", afterVisitId: original.visits[0].visitId, coordinate: null });
  assert.equal(added.visits[1].visitId, "new-visit");
  assert.equal(added.stops.at(-1)!.coordinate, null);
  assert.equal(added.stops.at(-1)!.usesVehicleCoordinate, true);
  assert.deepEqual(added.tasks.at(-1)!.targetCoordinate, [110.34, 20.04]);
  assert.throws(() => addFieldTaskVisit(original, { task: task("new-task"), visitId: "new-visit", stopId: "new-stop", afterVisitId: original.visits.at(-1)!.visitId }), /结束到访之前/);
  assert.throws(() => addFieldTaskVisit(original, { task: original.tasks[0], visitId: "new-visit", stopId: "new-stop" }), /任务标识已存在/);
});

test("FP2 coordinate edits distinguish target movement from explicitly fixed shared parking", () => {
  const original = makeSimulatedFieldTaskPlan(), taskId = original.tasks[1].taskId;
  const moved = setFieldTaskTargetCoordinate(original, taskId, [110.35, 20.05]);
  assert.deepEqual(moved.stops[1].coordinate, [110.35, 20.05]);
  const parked = setFieldVehicleStopCoordinate(original, original.stops[1].stopId, [110.36, 20.06]);
  const remapped = setFieldTaskTargetCoordinate(parked, taskId, [110.35, 20.05]);
  assert.deepEqual(remapped.stops[1].coordinate, [110.36, 20.06]);
  assert.deepEqual(remapped.tasks[1].targetCoordinate, [110.35, 20.05]);
  const shared = makeSimulatedSharedStopPlan(), sharedMoved = setFieldTaskTargetCoordinate(shared, shared.tasks[1].taskId, [110.37, 20.07]);
  assert.deepEqual(sharedMoved.stops[1].coordinate, shared.stops[1].coordinate);
  assert.deepEqual(sharedMoved.tasks[3], shared.tasks[3]);
  assert.throws(() => setFieldVehicleStopCoordinate(original, original.stops[0].stopId, [181, 20]), /经度/);
});

test("FP2 explicit task removal cleans only orphaned candidate visits, retaining departure/arrival instances", () => {
  const original = makeSimulatedFieldTaskPlan();
  const removed = removeFieldTask(original, original.tasks[1].taskId, { confirmed: true });
  assert.equal(removed.visits.length, 2); assert.equal(removed.stops.length, 2);
  assert.doesNotThrow(() => parseFieldTaskPlan(removed));
  const noOriginWork = removeFieldTask(removed, original.tasks[0].taskId, { confirmed: true });
  assert.equal(noOriginWork.visits[0].visitId, original.visits[0].visitId);
  assert.deepEqual(noOriginWork.visits[0].taskIds, []);
  assert.throws(() => removeFieldTask(original, original.tasks[0].taskId, { confirmed: false } as never), /确认/);
});

test("FP2 editing enforces six intermediates and twenty tasks before returning a new plan", () => {
  let full = makeSimulatedFieldTaskPlan();
  for (let index = 0; index < 5; index++) full = addFieldTaskVisit(full, { task: task(`task-${index}`), visitId: `visit-${index}`, stopId: `stop-${index}` });
  const before = JSON.stringify(full);
  assert.equal(full.visits.length, 8);
  assert.throws(() => setFieldTaskTripMode(full, "return_to_start"), /追加返回到访会超过/);
  assert.throws(() => addFieldTaskVisit(full, { task: task("overflow"), visitId: "overflow-visit", stopId: "overflow-stop" }), /新增到访会超过/);
  assert.equal(JSON.stringify(full), before);
  let many = makeSimulatedFieldTaskPlan();
  for (let index = 0; index < 17; index++) many = addFieldTaskToVisit(many, task(`task-${index}`), many.visits[1].visitId);
  assert.equal(many.tasks.length, 20);
  assert.throws(() => addFieldTaskToVisit(many, task("overflow"), many.visits[1].visitId), /核查任务数量/);
  assert.throws(() => splitFieldTask(addFieldTaskToVisit(full, task("split-overflow"), full.visits[1].visitId), "split-overflow", { visitId: "extra-visit", stopId: "extra-stop" }), /新增到访会超过/);
});

test("FP2 removing one task does not silently remove another empty vehicle visit", () => {
  const original = makeSimulatedFieldTaskPlan();
  original.stops.push({ stopId: "empty-stop", coordinate: [110.4, 20.1], usesVehicleCoordinate: true });
  original.visits.splice(2, 0, { visitId: "empty-visit", stopId: "empty-stop", taskIds: [], role: "candidate" });
  const removed = removeFieldTask(original, original.tasks[1].taskId, { confirmed: true });
  assert.ok(removed.visits.some(visit => visit.visitId === "empty-visit"));
  assert.ok(removed.stops.some(stop => stop.stopId === "empty-stop"));
});

test("FP2 origin target still sets an unfixed departure vehicle stop when only an empty final return shares it", () => {
  const original = makeSimulatedFieldTaskPlan();
  original.tasks[0].targetCoordinate = null;
  original.stops[0].coordinate = null;
  const returned = setFieldTaskTripMode(original, "return_to_start"), before = JSON.stringify(returned);
  const picked = setFieldTaskTargetCoordinate(returned, original.tasks[0].taskId, [110.45, 20.15]);
  assert.deepEqual(picked.stops[0].coordinate, [110.45, 20.15]);
  assert.equal(picked.stops[0].usesVehicleCoordinate, false);
  assert.equal(picked.visits.at(-1)!.stopId, picked.visits[0].stopId);
  assert.equal(compileFieldTaskRouting(picked).request!.returnToStart, true);
  assert.equal(JSON.stringify(returned), before);
  const withReturnTask = addFieldTaskToVisit(picked, task("return-work"), picked.visits.at(-1)!.visitId);
  const movedAgain = setFieldTaskTargetCoordinate(withReturnTask, original.tasks[0].taskId, [110.46, 20.16]);
  assert.deepEqual(movedAgain.stops[0].coordinate, [110.45, 20.15]);
  assert.equal(movedAgain.stops[0].usesVehicleCoordinate, true);
});
