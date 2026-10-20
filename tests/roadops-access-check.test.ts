import assert from "node:assert/strict";
import test from "node:test";
import { createNavigationDraft } from "../app/lib/roadops-navigation";
import { createFieldTaskPlan, parseFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import {
  appendFieldAccessCheck, captureFieldAccessSubject, createFieldAccessLog, evaluateFieldAccessLog, fieldAccessTaskExclusions,
  FIELD_ACCESS_LOG_MAX_BYTES, FIELD_ACCESS_MAX_CHECKS, parseFieldAccessLog,
  type AccessDimension, type AccessSubject, type FieldAccessCheck, type FieldAccessLog,
} from "../app/lib/roadops-access-check";
import { compileFieldTaskRouting } from "../app/lib/roadops-task-routing";
import { makeSimulatedFieldTaskPlan, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";

const checkedAt = "2026-10-09T01:00:00.000Z", recordedAt = "2026-10-09T01:05:00.000Z";
const assessedAt = "2026-10-09T02:00:00.000Z", validUntil = "2026-10-10T01:00:00.000Z";
const options = { assessedAt };
function vehicle(plan: FieldTaskPlan, index = 1): AccessSubject { return { kind: "vehicle_stop", stopId: plan.stops[index].stopId }; }
function task(plan: FieldTaskPlan, visitIndex = 1, taskIndex = 0): AccessSubject { return { kind: "inspection_task", taskId: plan.visits[visitIndex].taskIds[taskIndex], visitId: plan.visits[visitIndex].visitId }; }
function check(plan: FieldTaskPlan, subject: AccessSubject = vehicle(plan), dimension: AccessDimension = "vehicle_approach", overrides: Partial<FieldAccessCheck> = {}): FieldAccessCheck {
  return { checkId: "simulation-check-1", subject, dimension, status: "confirmed", coordinateSnapshot: captureFieldAccessSubject(plan, subject, dimension),
    reviewer: "测试/模拟核验人", checkedAt, validUntil, source: "field_observation", basis: "测试/模拟人工记录，不代表真实进入许可", evidenceRefs: [], releaseBlockedCheckIds: [], recordedAt, ...overrides };
}
function withChecks(plan: FieldTaskPlan, checks: FieldAccessCheck[]): FieldAccessLog { return checks.reduce(appendFieldAccessCheck, createFieldAccessLog(plan.planId)); }
function targetSlot(plan: FieldTaskPlan, log: FieldAccessLog, checkId: string, evidenceIds?: string[]) {
  return evaluateFieldAccessLog(plan, log, { ...options, availableEvidenceIds: evidenceIds }).slots.find(slot => slot.latest?.checkId === checkId)!;
}

function withTaskId(plan: FieldTaskPlan, taskId: string): FieldTaskPlan {
  const currentId = plan.tasks[1].taskId;
  return parseFieldTaskPlan({ ...plan, planningGoal: "coverage", tasks: plan.tasks.map(task => task.taskId === currentId ? { ...task, taskId, required: false } : task),
    visits: plan.visits.map(visit => ({ ...visit, taskIds: visit.taskIds.map(id => id === currentId ? taskId : id) })) });
}

test("FP3A imported task IDs matching object properties do not acquire inherited access blocks", () => {
  for (const taskId of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    const plan = withTaskId(makeSimulatedFieldTaskPlan(), taskId);
    const inherited = Object.create({ [taskId]: "非本方案自有核验依据" }) as Record<string, string>;
    const issued = compileFieldTaskRouting(plan, {}, { excludedTaskReasons: inherited });
    assert.ok(issued.selectedTaskIds.includes(taskId), taskId);
    assert.deepEqual(issued.inputExclusions, {});
    assert.deepEqual(issued.deferredTasks, []);
  }
});

test("FP3A explicit task and shared-stop access blocks preserve every imported ID and reason", () => {
  for (const taskId of ["__proto__", "constructor", "toString"]) {
    const plan = withTaskId(makeSimulatedSharedStopPlan(), taskId);
    for (const scope of ["inspection_task", "vehicle_stop"] as const) {
      const subject = scope === "inspection_task" ? task(plan) : vehicle(plan);
      const row = check(plan, subject, scope === "inspection_task" ? "entrance_permission" : "vehicle_approach", { status: "blocked", validUntil: null });
      const evaluation = evaluateFieldAccessLog(plan, withChecks(plan, [row]), options);
      const exclusions = fieldAccessTaskExclusions(plan, evaluation);
      assert.ok(Object.hasOwn(exclusions, taskId));
      const reason = evaluation.slots.find(slot => slot.status === "blocked")!.reason;
      assert.equal(exclusions[taskId], reason);
      // Keep other shared-stop tasks optional so their physical block can be deferred too.
      const sharedTaskIds = new Set(plan.visits[1].taskIds);
      const optional = parseFieldTaskPlan({ ...plan, tasks: plan.tasks.map(item => sharedTaskIds.has(item.taskId) ? { ...item, required: false } : item) });
      const issued = compileFieldTaskRouting(optional, {}, { excludedTaskReasons: exclusions });
      assert.ok(Object.hasOwn(issued.inputExclusions, taskId));
      assert.equal(issued.inputExclusions[taskId], reason);
      assert.deepEqual(issued.deferredTasks.find(item => item.taskId === taskId), { taskId, reason: "access_blocked", detail: reason });
      assert.ok(!issued.selectedTaskIds.includes(taskId));
      assert.match(issued.inputSignature, /inputExclusions/);
      assert.equal(Object.getPrototypeOf(issued.inputExclusions), Object.prototype);
      const required = parseFieldTaskPlan({ ...optional, tasks: optional.tasks.map(item => item.taskId === taskId ? { ...item, required: true } : item) });
      assert.throws(() => compileFieldTaskRouting(required, {}, { excludedTaskReasons: exclusions }), /明确不可进入/);
    }
  }
});

test("FP3A empty history is an unknown planning aid and preserves independent revision", () => {
  const plan = makeSimulatedFieldTaskPlan(), log = createFieldAccessLog(plan.planId);
  assert.equal(log.schemaVersion, "field-access-log-v1");
  assert.equal(log.revision, 1);
  assert.equal(evaluateFieldAccessLog(plan, log, options).status, "unknown");
  assert.equal(evaluateFieldAccessLog(plan, log, options).canPlan, true);
  assert.equal(evaluateFieldAccessLog(plan, log, options).slots.length, plan.stops.length * 2 + plan.tasks.length * 2);
  const next = appendFieldAccessCheck(log, check(plan));
  assert.equal(next.revision, log.revision, "storage transaction owns increments");
  assert.equal(log.checks.length, 0);
});

test("FP3A return visits share physical vehicle scope and retain separate task occurrences", () => {
  const plan = makeSimulatedReturnPlan(), subject = vehicle(plan, 0), row = check(plan, subject);
  const result = evaluateFieldAccessLog(plan, withChecks(plan, [row]), options);
  assert.equal(result.slots.length, plan.stops.length * 2 + plan.tasks.length * 2);
  assert.equal(result.slots.filter(slot => slot.subject.kind === "vehicle_stop" && slot.subject.stopId === plan.stops[0].stopId).length, 2);
  assert.equal(targetSlot(plan, withChecks(plan, [row]), row.checkId).status, "confirmed_with_limits");
  assert.notEqual(plan.visits[0].visitId, plan.visits.at(-1)!.visitId);
  assert.equal(result.slots.filter(slot => slot.subject.kind === "inspection_task").length, plan.tasks.length * 2);
});

test("FP3A shared parking has two vehicle slots and independent target/last-mile slots", () => {
  const plan = makeSimulatedSharedStopPlan(), row = check(plan, task(plan), "entrance_permission");
  const result = evaluateFieldAccessLog(plan, withChecks(plan, [row]), options);
  assert.equal(result.slots.length, 16);
  assert.equal(result.slots.filter(slot => slot.status === "confirmed_with_limits").length, 1);
  assert.equal(result.slots.filter(slot => slot.subject.kind === "inspection_task" && slot.subject.visitId === plan.visits[1].visitId).length, 6);
  assert.ok(result.slots.filter(slot => slot.subject.kind === "inspection_task" && slot.subject.taskId === "simulation-task-b").every(slot => slot.status === "unknown"));
});

test("FP3A all 20 tasks and eight visits are evaluated without flattening", () => {
  const seed = makeSimulatedFieldTaskPlan(), base = seed.tasks[1];
  const tasks = Array.from({ length: 20 }, (_, index) => ({ ...base, taskId: `simulation-task-${index}` }));
  const stops = Array.from({ length: 8 }, (_, index) => ({ stopId: `simulation-stop-${index}`, coordinate: [110 + index / 100, 20] as [number, number], usesVehicleCoordinate: true }));
  const visits = stops.map((stop, index) => ({ visitId: `simulation-visit-${index}`, stopId: stop.stopId,
    taskIds: tasks.filter((_, taskIndex) => taskIndex % 8 === index).map(task => task.taskId), role: index === 0 ? "origin" as const : index === 7 ? "destination" as const : "candidate" as const }));
  const plan = parseFieldTaskPlan({ ...seed, tasks, stops, visits });
  const result = evaluateFieldAccessLog(plan, createFieldAccessLog(plan.planId), options);
  assert.equal(result.slots.length, 56);
  assert.equal(new Set(result.slots.map(slot => slot.key)).size, 56);
});

test("FP3A captured snapshots bind only coordinates relevant to each dimension and clone arrays", () => {
  const plan = makeSimulatedSharedStopPlan(), subject = task(plan);
  const entrance = captureFieldAccessSubject(plan, subject, "entrance_permission");
  assert.equal(entrance.vehicleCoordinate, null);
  assert.deepEqual(entrance.targetCoordinate, plan.tasks[1].targetCoordinate);
  const lastMile = captureFieldAccessSubject(plan, subject, "last_mile");
  assert.deepEqual(lastMile.vehicleCoordinate, plan.stops[1].coordinate);
  const parking = captureFieldAccessSubject(plan, vehicle(plan), "parking_permission");
  assert.equal(parking.targetCoordinate, null);
  parking.vehicleCoordinate![0] = 1; lastMile.targetCoordinate![0] = 1;
  assert.notEqual(plan.stops[1].coordinate![0], 1);
  assert.notEqual(plan.tasks[1].targetCoordinate![0], 1);
});

test("FP3A unselected coordinates remain drafts but cannot become confirmations", () => {
  const plan = createFieldTaskPlan(createNavigationDraft(), { planId: "simulation-empty", name: "测试/模拟草稿", now: recordedAt });
  const subject = vehicle(plan, 0), snapshot = captureFieldAccessSubject(plan, subject, "vehicle_approach");
  assert.deepEqual(snapshot, { vehicleCoordinate: null, targetCoordinate: null });
  const row = check(plan, subject);
  assert.throws(() => withChecks(plan, [row]), /需要的坐标/);
  assert.doesNotThrow(() => withChecks(plan, [{ ...row, status: "unknown", reviewer: "", basis: "", checkedAt: null, validUntil: null }]));
  assert.doesNotThrow(() => withChecks(plan, [{ ...row, status: "blocked", validUntil: null }]));
});

test("FP3A confirmed status has limits and expires at the exact deadline", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan), log = withChecks(plan, [row]);
  assert.equal(targetSlot(plan, log, row.checkId).status, "confirmed_with_limits");
  assert.match(targetSlot(plan, log, row.checkId).reason, /不保证/);
  const expired = evaluateFieldAccessLog(plan, log, { assessedAt: validUntil });
  assert.equal(expired.slots.find(slot => slot.latest)?.status, "needs_review");
  assert.equal(expired.canPlan, true);
  assert.match(expired.slots.find(slot => slot.latest)!.reason, /过期/);
});

test("FP3A vehicle and target movement invalidate the relevant confirmation scope", () => {
  const plan = makeSimulatedSharedStopPlan();
  const vehicleRow = check(plan), entrance = check(plan, task(plan), "entrance_permission", { checkId: "entrance" });
  const lastMile = check(plan, task(plan), "last_mile", { checkId: "last-mile" }), log = withChecks(plan, [vehicleRow, entrance, lastMile]);
  const movedVehicle = structuredClone(plan); movedVehicle.stops[1].coordinate = [111, 20];
  assert.equal(targetSlot(movedVehicle, log, vehicleRow.checkId).status, "needs_review");
  assert.equal(targetSlot(movedVehicle, log, entrance.checkId).status, "confirmed_with_limits");
  assert.equal(targetSlot(movedVehicle, log, lastMile.checkId).status, "needs_review");
  const movedTarget = structuredClone(plan); movedTarget.tasks[1].targetCoordinate = [112, 21];
  assert.equal(targetSlot(movedTarget, log, vehicleRow.checkId).status, "confirmed_with_limits");
  assert.equal(targetSlot(movedTarget, log, entrance.checkId).status, "needs_review");
  assert.equal(targetSlot(movedTarget, log, lastMile.checkId).status, "needs_review");
});

test("FP3A active block persists through unknown records, coordinate edits and expiry", () => {
  const plan = makeSimulatedFieldTaskPlan(), blocked = check(plan, vehicle(plan), "vehicle_approach", { status: "blocked", validUntil: null });
  const unknown = check(plan, blocked.subject, blocked.dimension, { checkId: "unknown", status: "unknown", reviewer: "", basis: "", checkedAt: null, validUntil: null });
  const confirmed = check(plan, blocked.subject, blocked.dimension, { checkId: "ordinary-confirmation" });
  const log = withChecks(plan, [blocked, unknown, confirmed]), moved = structuredClone(plan); moved.stops[1].coordinate = [111, 20];
  for (const assessed of [assessedAt, "2027-01-01T00:00:00.000Z"]) {
    const result = evaluateFieldAccessLog(moved, log, { assessedAt: assessed });
    assert.equal(result.canPlan, false);
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.slots.find(slot => slot.latest?.checkId === confirmed.checkId)!.activeBlockedCheckIds, [blocked.checkId]);
  }
});

test("FP3A explicit current confirmation releases only the named block and preserves history", () => {
  const plan = makeSimulatedFieldTaskPlan(), blocked = check(plan, vehicle(plan), "vehicle_approach", { status: "blocked", validUntil: null });
  const second = { ...blocked, checkId: "block-2" };
  const release = check(plan, blocked.subject, blocked.dimension, { checkId: "release", releaseBlockedCheckIds: [blocked.checkId] });
  const log = withChecks(plan, [blocked, second, release]);
  assert.deepEqual(targetSlot(plan, log, release.checkId).activeBlockedCheckIds, [second.checkId]);
  const fullRelease = { ...release, checkId: "release-both", releaseBlockedCheckIds: [blocked.checkId, second.checkId] };
  const cleared = appendFieldAccessCheck(log, fullRelease);
  assert.equal(targetSlot(plan, cleared, fullRelease.checkId).status, "confirmed_with_limits");
  assert.equal(evaluateFieldAccessLog(plan, cleared, options).canPlan, true);
  assert.equal(cleared.checks.length, 4);
  assert.deepEqual(log.checks.map(row => row.checkId), [blocked.checkId, second.checkId, release.checkId]);
});

test("FP3A expired, moved, future or missing-evidence release keeps original manual block", () => {
  const plan = makeSimulatedFieldTaskPlan(), blocked = check(plan, vehicle(plan), "vehicle_approach", { status: "blocked", validUntil: null });
  const release = check(plan, blocked.subject, blocked.dimension, { checkId: "release", releaseBlockedCheckIds: [blocked.checkId] });
  const cases: Array<{ plan: FieldTaskPlan; release: FieldAccessCheck }> = [
    { plan, release: { ...release, validUntil: assessedAt } },
    { plan, release: { ...release, recordedAt: "2026-10-09T03:00:00.000Z" } },
    { plan, release: { ...release, evidenceRefs: ["simulation-evidence"] } },
    { plan: { ...plan, stops: plan.stops.map((stop, index) => index === 1 ? { ...stop, coordinate: [111, 20] } : stop) }, release },
  ];
  for (const scenario of cases) {
    const result = evaluateFieldAccessLog(scenario.plan, withChecks(plan, [blocked, scenario.release]), options);
    assert.equal(result.canPlan, false);
    const slot = result.slots.find(slot => slot.latest?.checkId === release.checkId)!;
    assert.deepEqual(slot.activeBlockedCheckIds, [blocked.checkId]);
    assert.match(slot.reason, /解除依据已失效或待复核，原人工禁入记录未解除/);
  }
});

test("FP3A block release cannot target another scope, a future record, or an earlier check time", () => {
  const plan = makeSimulatedFieldTaskPlan(), blocked = check(plan, vehicle(plan), "vehicle_approach", { status: "blocked", validUntil: null });
  const release = check(plan, blocked.subject, blocked.dimension, { checkId: "release", releaseBlockedCheckIds: [blocked.checkId] });
  assert.throws(() => withChecks(plan, [release, blocked]), /已有阻断/);
  assert.throws(() => withChecks(plan, [blocked, { ...release, dimension: "parking_permission" }]), /同一对象与维度/);
  assert.throws(() => withChecks(plan, [blocked, { ...release, subject: vehicle(plan, 0) }]), /同一对象与维度/);
  assert.throws(() => withChecks(plan, [blocked, { ...release, checkedAt: "2026-10-09T00:00:00.000Z" }]), /不能早于/);
  assert.throws(() => withChecks(plan, [blocked, { ...release, status: "needs_review" }]), /只有确认/);
  assert.throws(() => withChecks(plan, [{ ...release, releaseBlockedCheckIds: ["missing"] }]), /已有阻断/);
});

test("FP3A latest history follows append order rather than client check timestamps", () => {
  const plan = makeSimulatedFieldTaskPlan(), first = check(plan);
  const last = check(plan, first.subject, first.dimension, { checkId: "appended-last", checkedAt: "2026-10-08T23:00:00.000Z", status: "needs_review" });
  const log = withChecks(plan, [first, last]), result = evaluateFieldAccessLog(plan, log, options);
  assert.equal(result.slots.find(slot => slot.latest)?.latest?.checkId, last.checkId);
  assert.equal(result.slots.find(slot => slot.latest)?.status, "needs_review");
  assert.deepEqual(log.checks.map(row => row.checkId), [first.checkId, last.checkId]);
});

test("FP3A future recording/check clocks require review and cannot assert current confirmation", () => {
  const plan = makeSimulatedFieldTaskPlan(), future = check(plan, vehicle(plan), "vehicle_approach", { recordedAt: "2026-10-09T04:00:00.000Z", checkedAt: "2026-10-09T03:00:00.000Z" });
  const slot = targetSlot(plan, withChecks(plan, [future]), future.checkId);
  assert.equal(slot.status, "needs_review");
  assert.match(slot.reason, /时钟/);
  assert.throws(() => withChecks(plan, [{ ...future, recordedAt }]), /核验时间不能晚于/);
});

test("FP3A evidence refs require explicit available local IDs and never fetch them", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan, vehicle(plan), "vehicle_approach", { evidenceRefs: ["simulation-evidence-a", "local:photo-2"] });
  const log = withChecks(plan, [row]);
  assert.equal(targetSlot(plan, log, row.checkId).status, "needs_review");
  assert.equal(targetSlot(plan, log, row.checkId, []).status, "needs_review");
  assert.equal(targetSlot(plan, log, row.checkId, ["simulation-evidence-a"]).status, "needs_review");
  assert.equal(targetSlot(plan, log, row.checkId, row.evidenceRefs).status, "confirmed_with_limits");
  assert.deepEqual(evaluateFieldAccessLog(plan, log, options), evaluateFieldAccessLog(plan, log, options));
});

test("FP3A legacy manual blocked task remains a global gate despite complete structured checks", () => {
  const plan = makeSimulatedFieldTaskPlan(); plan.tasks[1].legacyAccessReview = "blocked";
  const entrance = check(plan, task(plan), "entrance_permission"), lastMile = check(plan, task(plan), "last_mile", { checkId: "last-mile" });
  const result = evaluateFieldAccessLog(plan, withChecks(plan, [entrance, lastMile]), options);
  assert.equal(result.canPlan, false);
  assert.equal(result.status, "blocked");
  assert.ok(result.slots.filter(slot => slot.subject.kind === "inspection_task" && slot.subject.taskId === plan.tasks[1].taskId).every(slot => slot.status === "blocked"));
});

test("FP3A another plan ID, copied check IDs and wrong occurrence references fail closed", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan), log = withChecks(plan, [row]);
  assert.throws(() => evaluateFieldAccessLog({ ...plan, planId: "copy-of-plan" }, log, options), /方案 ID 不匹配/);
  assert.throws(() => appendFieldAccessCheck(log, { ...row }), /不能覆盖或复制/);
  assert.throws(() => captureFieldAccessSubject(plan, { kind: "inspection_task", taskId: plan.tasks[1].taskId, visitId: plan.visits[0].visitId }, "last_mile"), /到访引用/);
  assert.throws(() => captureFieldAccessSubject(plan, { kind: "vehicle_stop", stopId: "missing" }, "parking_permission"), /不属于/);
  assert.throws(() => captureFieldAccessSubject(plan, task(plan), "parking_permission"), /维度/);
});

test("FP3A changed object IDs orphan retained history without confirming a replacement", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan, task(plan), "entrance_permission", { status: "blocked", validUntil: null });
  const log = withChecks(plan, [row]), replacement = structuredClone(plan), oldId = plan.tasks[1].taskId;
  replacement.tasks[1].taskId = "replacement-task";
  replacement.visits[1].taskIds = replacement.visits[1].taskIds.map(id => id === oldId ? "replacement-task" : id);
  const result = evaluateFieldAccessLog(replacement, log, options);
  assert.deepEqual(result.orphanedCheckIds, [row.checkId]);
  assert.equal(result.canPlan, true);
  assert.ok(result.slots.filter(slot => slot.subject.kind === "inspection_task" && slot.subject.taskId === "replacement-task").every(slot => slot.status === "unknown"));
  assert.equal(log.checks.length, 1);
});

test("FP3A parser rebuilds a deep whitelist and immutable copies", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan);
  const raw = { ...withChecks(plan, [row]), providerData: { route: [1, 2], generatedAt: recordedAt }, checks: [{ ...row, supplierDuration: 3, subject: { ...row.subject, supplierId: "secret" }, coordinateSnapshot: { ...row.coordinateSnapshot, geometry: "secret" } }] };
  const clean = parseFieldAccessLog(raw);
  assert.ok(!("providerData" in clean));
  assert.ok(!("supplierDuration" in clean.checks[0]));
  assert.ok(!("supplierId" in clean.checks[0].subject));
  assert.ok(!("geometry" in clean.checks[0].coordinateSnapshot));
  clean.checks[0].coordinateSnapshot.vehicleCoordinate![0] = 1;
  assert.notEqual(row.coordinateSnapshot.vehicleCoordinate![0], 1);
  assert.notEqual(raw.checks[0].coordinateSnapshot.vehicleCoordinate![0], 1);
});

test("FP3A complete confirmed and blocked records reject missing reviewer/basis/time", () => {
  const plan = makeSimulatedFieldTaskPlan();
  for (const status of ["confirmed", "blocked"] as const) {
    for (const override of [{ reviewer: "" }, { basis: " " }, { checkedAt: null }]) assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { status, ...override })]), /核验人|核验时间|有效期限/);
  }
  assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { validUntil: null })]), /有效期限/);
  assert.throws(() => withChecks(plan, [check(plan, task(plan), "last_mile", { coordinateSnapshot: { vehicleCoordinate: null, targetCoordinate: [110, 20] } })]), /需要的坐标/);
  assert.throws(() => withChecks(plan, [check(plan, task(plan), "entrance_permission", { coordinateSnapshot: { vehicleCoordinate: [110, 20], targetCoordinate: null } })]), /需要的坐标/);
});

test("FP3A textarea basis preserves TAB, LF and CR while other fields reject controls", () => {
  const plan = makeSimulatedFieldTaskPlan(), basis = "测试/模拟核验记录\n入口许可：人工观察\r\n最后一公里方式：\t步行，未生成路线";
  for (const status of ["confirmed", "blocked"] as const) {
    const log = withChecks(plan, [check(plan, task(plan), "last_mile", { status, basis })]);
    assert.equal(log.checks[0].basis, basis);
  }
  for (const control of ["\t", "\n", "\r"]) {
    assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { reviewer: `核验${control}人` })]), /控制字符/);
    assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { checkId: `check${control}id` })]), /控制字符/);
    assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { evidenceRefs: [`evidence${control}id`] })]), /控制字符/);
  }
  assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { basis: "\t\n\r" })]), /核验人、依据和核验时间/);
  assert.throws(() => withChecks(plan, [check(plan, vehicle(plan), "vehicle_approach", { basis: "依据\u0000" })]), /控制字符/);
});

test("FP3A strict UTC calendar, range, ID, controls and status parsing reject malformed inputs", () => {
  const plan = makeSimulatedFieldTaskPlan(), valid = withChecks(plan, [check(plan)]);
  const mutate: Array<(log: FieldAccessLog) => void> = [
    log => { log.revision = 0; }, log => { log.revision = 1.1; }, log => { log.planId = "bad id"; },
    log => { log.checks[0].checkId = "x".repeat(201); }, log => { log.checks[0].checkId = "bad\u0000id"; },
    log => { log.checks[0].checkId = "bad\uD800id"; },
    log => { log.checks[0].reviewer = "bad\u007fname"; }, log => { log.checks[0].basis = "bad\u0085basis"; },
    log => { log.checks[0].checkedAt = "2026-02-30T00:00:00.000Z"; }, log => { log.checks[0].recordedAt = "2026-13-01T00:00:00.000Z"; },
    log => { log.checks[0].checkedAt = "2026-10-09T09:00:00+08:00"; }, log => { log.checks[0].validUntil = checkedAt; },
    log => { log.checks[0].coordinateSnapshot.vehicleCoordinate = [181, 20]; }, log => { log.checks[0].coordinateSnapshot.vehicleCoordinate = [110, -91]; },
    log => { log.checks[0].coordinateSnapshot.vehicleCoordinate = [NaN, 20]; },
    log => { log.checks[0].dimension = "entrance_permission"; },
    log => { (log.checks[0] as unknown as { source: string }).source = "AI"; },
    log => { (log.checks[0] as unknown as { status: string }).status = "safe"; },
  ];
  for (const change of mutate) { const raw = structuredClone(valid); change(raw); assert.throws(() => parseFieldAccessLog(raw), /无效/); }
  assert.throws(() => parseFieldAccessLog({ ...valid, schemaVersion: "field-access-log-v9" }), /schemaVersion/);
  assert.throws(() => parseFieldAccessLog(null), /无效/);
  assert.throws(() => parseFieldAccessLog([]), /无效/);
  assert.doesNotThrow(() => parseFieldAccessLog({ ...valid, checks: [{ ...valid.checks[0], checkedAt: "2028-02-29T00:00:00Z", recordedAt: "2028-02-29T01:00:00Z", validUntil: "2028-03-01T00:00:00Z" }] }));
});

test("FP3A refs accept local ID strings only, at most twenty unique refs", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan);
  for (const ref of ["https://example.com/evidence", "file:///private/image.png", "data:image/png;base64,abc", "javascript:alert(1)", "//example.com", "www.example.com", "has whitespace", "bad\u0000id", "x".repeat(201)]) {
    assert.throws(() => withChecks(plan, [{ ...row, evidenceRefs: [ref] }]), /无效/);
  }
  assert.throws(() => withChecks(plan, [{ ...row, evidenceRefs: ["same", "same"] }]), /重复/);
  assert.throws(() => withChecks(plan, [{ ...row, evidenceRefs: Array.from({ length: 21 }, (_, index) => `evidence-${index}`) }]), /最多支持 20/);
  assert.doesNotThrow(() => withChecks(plan, [{ ...row, evidenceRefs: ["local:photo-1", "authority-notice#1"] }]));
});

test("FP3A record count and UTF-8 JSON size limits include unknown fields", () => {
  const plan = makeSimulatedFieldTaskPlan(), row = check(plan);
  const checks = Array.from({ length: FIELD_ACCESS_MAX_CHECKS }, (_, index) => ({ ...row, checkId: `simulation-check-${index}` }));
  assert.equal(parseFieldAccessLog({ ...createFieldAccessLog(plan.planId), checks }).checks.length, FIELD_ACCESS_MAX_CHECKS);
  assert.throws(() => parseFieldAccessLog({ ...createFieldAccessLog(plan.planId), checks: [...checks, { ...row, checkId: "too-many" }] }), /最多支持 500/);
  assert.throws(() => parseFieldAccessLog({ ...createFieldAccessLog(plan.planId), unknown: "汉".repeat(FIELD_ACCESS_LOG_MAX_BYTES / 2) }), /1 MiB/);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => parseFieldAccessLog(cycle), /JSON/);
});
