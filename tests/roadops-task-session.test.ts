import assert from "node:assert/strict";
import test from "node:test";
import { syncFieldTaskPlanMetadata } from "../app/lib/roadops-task-session";
import { bindFieldTaskRoute, compileFieldTaskRouting } from "../app/lib/roadops-task-routing";
import type { FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { makeSimulatedFieldTaskPlan } from "./fixtures/roadops-field-scenarios";
import { simulatedFieldResponse } from "./fixtures/roadops-field-routing-response";

function session() {
  const plan = makeSimulatedFieldTaskPlan();
  const receipt = bindFieldTaskRoute(plan, { plan: simulatedFieldResponse(plan) }, compileFieldTaskRouting(plan));
  return { plan, receipt };
}
function saveMetadata(plan: FieldTaskPlan): FieldTaskPlan {
  return { ...plan, revision: plan.revision + 1, updatedAt: "2026-10-09T01:00:00.000Z", name: "模拟已保存名称" };
}

test("FP2 save metadata rebinds a current receipt without altering geometry or route time", () => {
  const { plan, receipt } = session(), saved = saveMetadata(plan), before = JSON.stringify(receipt);
  const synchronized = syncFieldTaskPlanMetadata(plan, saved, receipt);
  assert.deepEqual(synchronized.plan, saved);
  assert.equal(synchronized.receipt!.planId, saved.planId);
  assert.equal(synchronized.receipt!.revision, saved.revision);
  assert.equal(synchronized.receipt!.inputSignature, JSON.stringify(saved));
  assert.equal(synchronized.receipt!.legs, receipt.legs);
  assert.equal(synchronized.receipt!.visits, receipt.visits);
  assert.equal(synchronized.receipt!.generatedAt, receipt.generatedAt);
  assert.equal(synchronized.receipt!.drivingMinutes, receipt.drivingMinutes);
  assert.equal(synchronized.receipt!.totalMinutes, receipt.totalMinutes);
  assert.equal(JSON.stringify(receipt), before);
});

test("FP2 explicit copy to a new plan identity retains a route only when every task identity matches", () => {
  const { plan, receipt } = session();
  const copied = { ...saveMetadata(plan), planId: "explicit-copy", revision: 1, createdAt: "2026-10-09T01:00:00.000Z" };
  const synchronized = syncFieldTaskPlanMetadata(plan, copied, receipt);
  assert.deepEqual(synchronized.plan, copied);
  assert.equal(synchronized.receipt!.planId, "explicit-copy");
  assert.equal(synchronized.receipt!.revision, 1);
  assert.deepEqual(synchronized.receipt!.legs, receipt.legs);
  const changedIdentity = JSON.parse(JSON.stringify(copied)) as FieldTaskPlan;
  const oldId = changedIdentity.tasks[1].taskId;
  changedIdentity.tasks[1].taskId = "rewritten-task";
  changedIdentity.visits[1].taskIds = changedIdentity.visits[1].taskIds.map(id => id === oldId ? "rewritten-task" : id);
  assert.deepEqual(syncFieldTaskPlanMetadata(plan, changedIdentity, receipt).plan, plan);
});

test("FP2 late saves cannot overwrite current user content or acquire its receipt", () => {
  const { plan, receipt } = session();
  const mutations: Array<(value: FieldTaskPlan) => void> = [
    value => { value.tasks[1].dwellMinutes += 0.5; },
    value => { value.tasks[1].accessNote = "不同的本地核验备注"; },
    value => { value.tasks[1].legacyAccessReview = "blocked"; },
    value => { value.tasks[1].targetCoordinate = [110.4, 20.1]; },
    value => { value.stops[1].coordinate = [110.4, 20.1]; },
    value => { value.strategy = "2"; },
    value => { value.optimize = !value.optimize; },
    value => { value.startTime = "09:30"; },
    value => { value.workMinutes = 360; },
    value => { value.bufferMinutes += 10; },
    value => { value.visits[1].visitId = "different-visit"; },
  ];
  for (const mutate of mutations) {
    const saved = JSON.parse(JSON.stringify(saveMetadata(plan))) as FieldTaskPlan; mutate(saved);
    const synchronized = syncFieldTaskPlanMetadata(plan, saved, receipt);
    assert.deepEqual(synchronized.plan, plan);
    assert.equal(synchronized.receipt, receipt);
  }
});

test("FP2 same-plan older revisions are rejected while unchanged newer metadata is accepted", () => {
  const { plan, receipt } = session(), current = { ...plan, revision: 3 }, matching = { ...receipt, revision: 3, inputSignature: JSON.stringify(current) };
  const older = { ...saveMetadata(current), revision: 2 };
  const synchronized = syncFieldTaskPlanMetadata(current, older, matching);
  assert.deepEqual(synchronized.plan, current);
  assert.equal(synchronized.receipt, matching);
  assert.equal(syncFieldTaskPlanMetadata(current, saveMetadata(current), matching).receipt!.revision, 4);
});

test("FP2 stale or mismatched receipts become null, including when an unrelated save is rejected", () => {
  const { plan, receipt } = session(), saved = saveMetadata(plan);
  const staleReceipts = [
    { ...receipt, revision: receipt.revision + 1 },
    { ...receipt, planId: "other-plan" },
    { ...receipt, inputSignature: receipt.inputSignature + " " },
  ];
  for (const stale of staleReceipts) {
    assert.equal(syncFieldTaskPlanMetadata(plan, saved, stale).receipt, null);
    const different = JSON.parse(JSON.stringify(saved)) as FieldTaskPlan; different.tasks[1].dwellMinutes += 1;
    assert.equal(syncFieldTaskPlanMetadata(plan, different, stale).receipt, null);
  }
  assert.equal(syncFieldTaskPlanMetadata(plan, saved, null).receipt, null);
});

test("FP2 metadata synchronization rejects malformed documents without mutating the current session", () => {
  const { plan, receipt } = session(), originalPlan = JSON.stringify(plan), originalReceipt = JSON.stringify(receipt);
  const malformed = JSON.parse(JSON.stringify(saveMetadata(plan))) as FieldTaskPlan;
  malformed.visits[1].taskIds = ["missing-task"];
  assert.throws(() => syncFieldTaskPlanMetadata(plan, malformed, receipt), /不存在的任务/);
  assert.equal(JSON.stringify(plan), originalPlan);
  assert.equal(JSON.stringify(receipt), originalReceipt);
});
