import assert from "node:assert/strict";
import test from "node:test";
import { addNavigationWaypoint, createNavigationDraft, moveNavigationWaypoint, setNavigationCoordinate } from "../app/lib/roadops-navigation";
import { createFieldTaskPlan, FIELD_TASK_HISTORY_NOTE_PREFIX, FIELD_TASK_MAX_TASKS, FIELD_TASK_PLAN_MAX_BYTES, fieldTaskPlanToNavigationDraft, parseFieldTaskPlan, serializeFieldTaskPlan, updateFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { FIELD_TASK_SCENARIOS, makeSimulatedFieldTaskPlan, makeSimulatedNavigationDraft, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";

const later = "2026-10-08T01:00:00.000Z";

test("FP0 empty navigation is a valid user-input draft; coordinates need not be selected", () => {
  const plan = createFieldTaskPlan(createNavigationDraft(), { planId: "local-plan", name: "待完善任务", now: later });
  assert.equal(plan.schemaVersion, "field-task-plan-v1");
  assert.equal(plan.revision, 1);
  assert.equal(plan.timezone, "Asia/Shanghai");
  assert.equal(plan.date, null);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.visits.length, 2);
  assert.ok(plan.tasks.every(task => task.targetCoordinate === null));
  assert.ok(plan.stops.every(stop => stop.coordinate === null));
  const restored = fieldTaskPlanToNavigationDraft(plan);
  assert.equal(restored.origin.coordinate, null);
  assert.equal(restored.destination.coordinate, null);
});

test("FP1 round trip preserves user inputs and clones coordinate arrays", () => {
  const draft = makeSimulatedNavigationDraft();
  draft.waypoints[0].vehicleCoordinate = [110.311, 20.011];
  draft.startTime = "09:15";
  draft.workMinutes = 360;
  draft.bufferMinutes = 45;
  draft.optimize = true;
  const plan = createFieldTaskPlan(draft, { planId: "my-plan", name: "我的任务", now: later });
  const restored = fieldTaskPlanToNavigationDraft(JSON.parse(serializeFieldTaskPlan(plan, { includeNotes: true })));
  assert.deepEqual(restored.waypoints[0], { ...draft.waypoints[0] });
  assert.equal(restored.startTime, "09:15");
  assert.equal(restored.workMinutes, 360);
  assert.equal(restored.bufferMinutes, 45);
  assert.equal(restored.optimize, true);
  restored.waypoints[0].coordinate![0] = 1;
  assert.equal(plan.tasks[1].targetCoordinate![0], 110.31);
  assert.equal(draft.waypoints[0].coordinate![0], 110.31);
});

test("FP0 task, stop and occurrence identity does not change with coordinates or order", () => {
  const draft = addNavigationWaypoint(makeSimulatedNavigationDraft());
  const plan = createFieldTaskPlan(draft, { planId: "identity-plan", name: "标识稳定", now: "2026-10-08T00:00:00Z" });
  const moved = moveNavigationWaypoint(setNavigationCoordinate(draft, draft.waypoints[0].id, [110.4, 20.4]), draft.waypoints[0].id, 1);
  const updated = updateFieldTaskPlan(plan, moved, undefined, later);
  const oldVisit = plan.visits.find(visit => visit.taskIds.includes(draft.waypoints[0].id))!;
  const newVisit = updated.visits.find(visit => visit.taskIds.includes(draft.waypoints[0].id))!;
  assert.deepEqual(newVisit, oldVisit);
  assert.equal(updated.planId, plan.planId);
  assert.equal(updated.name, plan.name);
  assert.equal(updated.createdAt, plan.createdAt);
  assert.equal(updated.updatedAt, later);
  assert.equal(updated.revision, plan.revision, "the store owns optimistic revision increments");
});

test("FP0 preservation uses preexisting IDs, not a regenerated convention", () => {
  const plan = makeSimulatedFieldTaskPlan();
  plan.stops[1].stopId = "user-owned-stop";
  plan.visits[1].stopId = "user-owned-stop";
  plan.visits[1].visitId = "user-owned-occurrence";
  const updated = updateFieldTaskPlan(plan, fieldTaskPlanToNavigationDraft(plan), "重命名", later);
  assert.equal(updated.stops[1].stopId, "user-owned-stop");
  assert.equal(updated.visits[1].visitId, "user-owned-occurrence");
  assert.equal(updated.name, "重命名");
});

test("FP1 restore downgrades legacy confirmed without silently allowing blocked access", () => {
  const plan = makeSimulatedFieldTaskPlan();
  plan.tasks[0].legacyAccessReview = "confirmed";
  plan.tasks[0].accessNote = "历史入口记录";
  plan.tasks[1].legacyAccessReview = "blocked";
  plan.tasks[1].accessNote = "模拟禁入";
  const restored = fieldTaskPlanToNavigationDraft(plan);
  assert.equal(restored.origin.accessReview, "unknown");
  assert.equal(restored.origin.accessNote, `${FIELD_TASK_HISTORY_NOTE_PREFIX}历史入口记录`);
  assert.equal(restored.waypoints[0].accessReview, "blocked");
  assert.equal(restored.waypoints[0].accessNote, "模拟禁入");
  assert.equal(plan.tasks[0].legacyAccessReview, "confirmed", "reading does not mutate stored history");
  plan.tasks[0].accessNote = restored.origin.accessNote!;
  assert.equal(fieldTaskPlanToNavigationDraft(plan).origin.accessNote, restored.origin.accessNote);
  plan.tasks[0].accessNote = "字".repeat(4000);
  const longNote = fieldTaskPlanToNavigationDraft(plan);
  const resaved = updateFieldTaskPlan(plan, longNote, undefined, later);
  assert.equal(resaved.tasks[0].accessNote, `${FIELD_TASK_HISTORY_NOTE_PREFIX}${"字".repeat(4000)}`);
});

test("FP1 parser/export use a whitelist and explicitly omit private notes", () => {
  const source = { ...makeSimulatedFieldTaskPlan(), key: "SHOULD_NOT_EXPORT", route: { geometry: [1, 2] }, duration: 12, generatedAt: later };
  Object.assign(source.tasks[1], { supplierData: { secret: "TEST_SHOULD_NOT_EXPORT" } });
  const clean = parseFieldTaskPlan(source);
  assert.ok(!("key" in clean));
  assert.ok(!("route" in clean));
  assert.ok(!("supplierData" in clean.tasks[1]));
  const exported = serializeFieldTaskPlan(source, { includeNotes: false });
  assert.doesNotMatch(exported, /SHOULD_NOT_EXPORT|supplierData|generatedAt|模拟备注/);
  assert.ok(JSON.parse(exported).tasks.every((task: { accessNote: string }) => task.accessNote === ""));
  assert.match(serializeFieldTaskPlan(source, { includeNotes: true }), /模拟备注/);
});

test("FP0 accepts richer return/shared graph but the old editor rejects it without truncation", () => {
  for (const plan of [makeSimulatedReturnPlan(), makeSimulatedSharedStopPlan()]) {
    const parsed = parseFieldTaskPlan(plan);
    assert.equal(parsed.tasks.length, plan.tasks.length);
    assert.equal(parsed.visits.length, plan.visits.length);
    assert.throws(() => fieldTaskPlanToNavigationDraft(parsed), /尚不支持/);
    assert.throws(() => updateFieldTaskPlan(parsed, makeSimulatedNavigationDraft(), undefined, later), /尚不支持/);
  }
  const returnPlan = makeSimulatedReturnPlan();
  assert.equal(returnPlan.visits[0].stopId, returnPlan.visits.at(-1)!.stopId);
  assert.notEqual(returnPlan.visits[0].visitId, returnPlan.visits.at(-1)!.visitId);
  const shared = makeSimulatedSharedStopPlan();
  assert.equal(shared.visits[1].taskIds.length, 3);
  assert.equal(shared.stops.length, 3);
});

test("FP0 adapters reject unsupported semantics rather than silently dropping them", () => {
  const optional = makeSimulatedFieldTaskPlan(); optional.tasks[1].required = false;
  assert.throws(() => fieldTaskPlanToNavigationDraft(optional), /可延期/);
  const mismatch = makeSimulatedFieldTaskPlan(); mismatch.stops[1].coordinate = [111, 20];
  assert.throws(() => fieldTaskPlanToNavigationDraft(mismatch), /不一致/);
  const originDwell = makeSimulatedFieldTaskPlan(); originDwell.tasks[0].dwellMinutes = 20;
  assert.throws(() => fieldTaskPlanToNavigationDraft(originDwell), /起点核查耗时/);
  const emptyVehicle = makeSimulatedFieldTaskPlan(); emptyVehicle.stops[1].coordinate = null; emptyVehicle.stops[1].usesVehicleCoordinate = true;
  assert.throws(() => fieldTaskPlanToNavigationDraft(emptyVehicle), /独立车辆坐标为空/);
  const dated = makeSimulatedFieldTaskPlan(); dated.date = "2026-10-09";
  assert.throws(() => fieldTaskPlanToNavigationDraft(dated), /指定日期排程/);
  const reservedId = makeSimulatedFieldTaskPlan(); reservedId.tasks[1].taskId = "vehicle:reserved"; reservedId.visits[1].taskIds = ["vehicle:reserved"];
  assert.throws(() => fieldTaskPlanToNavigationDraft(reservedId), /车辆选点标识冲突/);
  for (const id of ["x".repeat(81), "中文任务标识"]) {
    const incompatible = makeSimulatedFieldTaskPlan(); incompatible.tasks[1].taskId = id; incompatible.visits[1].taskIds = [id];
    assert.throws(() => fieldTaskPlanToNavigationDraft(incompatible), /当前驾车请求格式/);
  }
});

test("FP0 unknown versions, bad dates, numbers and invalid WGS84 fail closed", () => {
  const bad: Array<(plan: FieldTaskPlan) => void> = [
    plan => { (plan as unknown as { schemaVersion: string }).schemaVersion = "field-task-plan-v9"; },
    plan => { plan.revision = 0; }, plan => { plan.revision = 1.2; }, plan => { plan.revision = Infinity; },
    plan => { plan.date = "2026-02-30"; }, plan => { plan.date = "2026-13-01"; },
    plan => { plan.createdAt = "2026-02-30T00:00:00.000Z"; }, plan => { plan.updatedAt = "2020-01-01T00:00:00.000Z"; },
    plan => { plan.startTime = "25:00"; }, plan => { plan.workMinutes = 29; }, plan => { plan.bufferMinutes = -1; },
    plan => { plan.tasks[0].targetCoordinate = [NaN, 1]; }, plan => { plan.tasks[0].targetCoordinate = [181, 1]; },
    plan => { plan.stops[0].coordinate = [1, -91]; }, plan => { plan.tasks[0].dwellMinutes = 181; },
    plan => { plan.tasks[0].accessNote = "x".repeat(4001); }, plan => { plan.planId = "bad id"; },
    plan => { (plan as unknown as { optimize: string }).optimize = "false"; },
  ];
  for (const mutate of bad) { const plan = makeSimulatedFieldTaskPlan(); mutate(plan); assert.throws(() => parseFieldTaskPlan(plan), /无效/); }
  const leapDate = makeSimulatedFieldTaskPlan(); leapDate.date = "2028-02-29";
  assert.equal(parseFieldTaskPlan(leapDate).date, "2028-02-29");
});

test("FP0 duplicate IDs, references, orphans and malformed visit roles fail closed", () => {
  const bad: Array<(plan: FieldTaskPlan) => void> = [
    plan => { plan.tasks[1].taskId = plan.tasks[0].taskId; },
    plan => { plan.stops[1].stopId = plan.stops[0].stopId; },
    plan => { plan.visits[1].visitId = plan.visits[0].visitId; },
    plan => { plan.visits[1].stopId = "missing"; },
    plan => { plan.visits[1].taskIds = ["missing"]; },
    plan => { plan.visits[1].taskIds = [plan.tasks[1].taskId, plan.tasks[1].taskId]; },
    plan => { plan.visits[1].taskIds = [plan.tasks[0].taskId]; },
    plan => { plan.visits[1].taskIds = []; },
    plan => { plan.visits[1].role = "origin"; },
    plan => { plan.tripMode = "return_to_start"; },
  ];
  for (const mutate of bad) { const plan = makeSimulatedFieldTaskPlan(); mutate(plan); assert.throws(() => parseFieldTaskPlan(plan), /无效/); }
});

test("FP0 limits apply to tasks, occurrences, bytes and malformed JSON separately", () => {
  const plan = makeSimulatedFieldTaskPlan();
  plan.tasks = Array.from({ length: FIELD_TASK_MAX_TASKS + 1 }, (_, index) => ({ ...plan.tasks[0], taskId: `task-${index}` }));
  assert.throws(() => parseFieldTaskPlan(plan), /任务数量/);
  const excessiveVisits = makeSimulatedFieldTaskPlan();
  excessiveVisits.visits = Array.from({ length: 9 }, () => excessiveVisits.visits[0]);
  assert.throws(() => parseFieldTaskPlan(excessiveVisits), /到访实例数量/);
  assert.throws(() => parseFieldTaskPlan({ ...makeSimulatedFieldTaskPlan(), unused: "x".repeat(FIELD_TASK_PLAN_MAX_BYTES) }), /1 MiB/);
  assert.throws(() => parseFieldTaskPlan({ ...makeSimulatedFieldTaskPlan(), unused: "汉".repeat(FIELD_TASK_PLAN_MAX_BYTES / 2) }), /1 MiB/);
  assert.throws(() => parseFieldTaskPlan(null), /无效/);
  assert.throws(() => parseFieldTaskPlan([]), /无效/);
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => parseFieldTaskPlan(cycle), /JSON/);
  assert.throws(() => JSON.parse(FIELD_TASK_SCENARIOS.corruptStorage.json));
});

test("FP0 every local scenario clearly states simulated provenance", () => {
  for (const fixture of Object.values(FIELD_TASK_SCENARIOS)) {
    assert.equal(fixture.mode, "simulation");
    assert.match(fixture.label, /测试\/模拟/);
    if ("plan" in fixture) assert.doesNotThrow(() => parseFieldTaskPlan(fixture.plan));
  }
  assert.notEqual(FIELD_TASK_SCENARIOS.directedCosts.costs[0].minutes, FIELD_TASK_SCENARIOS.directedCosts.costs[1].minutes);
  assert.equal(FIELD_TASK_SCENARIOS.unreachable.costs[0].minutes, null);
});
