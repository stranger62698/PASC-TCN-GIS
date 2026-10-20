import assert from "node:assert/strict";
import test from "node:test";
import { parseFieldTaskPlan } from "../app/lib/roadops-task-plan";
import { bindFieldTaskRoute, compileFieldTaskRouting } from "../app/lib/roadops-task-routing";
import { buildFieldTaskReport } from "../app/lib/roadops-task-report";
import { candidateBaseKey, createFieldTaskCandidate, validateFieldTaskCandidate } from "../app/lib/roadops-task-candidates";
import { createFieldExecutionRecord, createFieldExecutionStore, parseFieldExecutionRecord } from "../app/lib/roadops-task-execution";
import { evaluateFieldAccessLog } from "../app/lib/roadops-access-check";
import { makeSimulatedFieldTaskPlan, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";
import { syncFieldTaskPlanMetadata } from "../app/lib/roadops-task-session";
import { simulatedFieldResponse } from "./fixtures/roadops-field-routing-response";

const now = "2026-10-08T01:00:00.000Z";
function localPlan() {
  const plan = makeSimulatedSharedStopPlan(), stop = { ...plan.stops[0], usesVehicleCoordinate: true };
  plan.stops = [stop]; plan.visits = plan.visits.map(visit => ({ ...visit, stopId: stop.stopId }));
  plan.planningGoal = "coverage"; plan.workMinutes = 65; plan.bufferMinutes = 5;
  plan.tasks = plan.tasks.map((task, index) => ({ ...task, required: index === 0 || index === 2,
    dwellMinutes: index === 1 ? 60 : index === 3 ? 30 : index === 4 ? 20 : 0,
    priority: index === 1 ? "high" : "low" }));
  return parseFieldTaskPlan(plan);
}

test("personalized v1 metadata is optional and validated without changing legacy required flags", () => {
  const legacy = makeSimulatedFieldTaskPlan();
  assert.equal(parseFieldTaskPlan(legacy).planningGoal, undefined);
  assert.ok(parseFieldTaskPlan(legacy).tasks.every(task => task.required && task.priority === undefined));
  assert.throws(() => parseFieldTaskPlan({ ...legacy, planningGoal: "fastest" }), /核查目标/);
  assert.throws(() => parseFieldTaskPlan({ ...legacy, tasks: legacy.tasks.map(task => ({ ...task, priority: "danger" })) }), /任务优先级/);
  legacy.tasks[1].required = false;
  assert.throws(() => compileFieldTaskRouting(legacy), /可延期任务/);
});

test("time and distance preserve exact seconds, full work hours and do not send a negative driving budget", () => {
  const plan = makeSimulatedFieldTaskPlan(); plan.planningGoal = "time";
  plan.workMinutes = 30; plan.bufferMinutes = 1; plan.tasks[1].dwellMinutes = 28.5;
  const issued = compileFieldTaskRouting(plan);
  assert.equal(issued.request!.workMinutes, 30); assert.equal(issued.request!.drivingBudgetSeconds, 30);
  assert.equal(issued.request!.fieldTasks!.find(task => task.taskId === "field-task-2")!.dwellSeconds, 1710);
  assert.ok(issued.request!.points.every(point => point.dwellMinutes === 0));
  plan.tasks[1].dwellMinutes = 30;
  assert.throws(() => compileFieldTaskRouting(plan), /超过可用工时/);
});

test("local zero-driving coverage and priority select different tasks while preserving the full pool", () => {
  const plan = localPlan(), before = JSON.stringify(plan);
  const coverage = compileFieldTaskRouting(plan);
  const priority = compileFieldTaskRouting({ ...plan, planningGoal: "priority" });
  assert.equal(coverage.mode, "no_station_driving"); assert.equal(coverage.request, null);
  assert.ok(!coverage.selectedTaskIds.includes(plan.tasks[1].taskId));
  assert.ok(coverage.selectedTaskIds.includes(plan.tasks[3].taskId) && coverage.selectedTaskIds.includes(plan.tasks[4].taskId));
  assert.ok(priority.selectedTaskIds.includes(plan.tasks[1].taskId));
  assert.ok(!priority.selectedTaskIds.includes(plan.tasks[3].taskId));
  assert.equal(JSON.stringify(plan), before);
  const report = buildFieldTaskReport(plan, null, { assessedAt: now });
  assert.equal(report.totals.totalMinutes, 55);
  assert.deepEqual(report.visits.flatMap(visit => visit.tasks.map(task => task.taskId)).sort(), [...coverage.selectedTaskIds].sort());
  assert.equal(report.deferredTasks.length, 1);
});

test("optional access blocks defer without stopping others; required blocks cannot be hidden", () => {
  const plan = localPlan(); plan.tasks[1].legacyAccessReview = "blocked";
  const issued = compileFieldTaskRouting(plan);
  assert.equal(issued.deferredTasks.find(task => task.taskId === plan.tasks[1].taskId)!.reason, "access_blocked");
  const log = { schemaVersion: "field-access-log-v1" as const, planId: plan.planId, revision: 1, checks: [] };
  assert.equal(evaluateFieldAccessLog(plan, log, { assessedAt: now }).canPlan, false);
  assert.equal(evaluateFieldAccessLog(plan, log, { assessedAt: now, selectedTaskIds: issued.selectedTaskIds }).canPlan, true);
  assert.throws(() => evaluateFieldAccessLog(plan, log, { assessedAt: now, selectedTaskIds: [] }), /必查任务/);
  plan.tasks[1].required = true;
  assert.throws(() => compileFieldTaskRouting(plan), /明确不可进入/);
});

test("local shared-stop candidate retains structured optional exclusions without fabricating a route", () => {
  const plan = localPlan(), inputExclusions = { [plan.tasks[3].taskId]: "人工进入核验未通过。" };
  const candidate = createFieldTaskCandidate(plan, { candidateId: "local-block", generatedAt: now, assessedAt: now, receipt: null, inputExclusions });
  assert.equal(candidate.providerPlan, null);
  assert.equal(candidate.report.deferredTasks.find(task => task.taskId === plan.tasks[3].taskId)!.reason, "access_blocked");
  assert.ok(!candidate.report.selectedTaskIds.includes(plan.tasks[3].taskId));
  assert.deepEqual(validateFieldTaskCandidate(plan, candidate).inputExclusions, inputExclusions);
});

test("return plan with every remote optional task blocked is local work and retains explicit deferral", () => {
  const plan = makeSimulatedReturnPlan(); plan.planningGoal = "coverage";
  plan.tasks[1].required = false; plan.tasks[1].legacyAccessReview = "blocked";
  const before = JSON.stringify(plan), issued = compileFieldTaskRouting(plan);
  assert.equal(issued.mode, "no_station_driving"); assert.equal(issued.request, null);
  assert.deepEqual(issued.visits.map(visit => visit.visitId), [plan.visits[0].visitId, plan.visits.at(-1)!.visitId]);
  const report = buildFieldTaskReport(plan, null, { assessedAt: now });
  assert.equal(report.legs.length, 0); assert.equal(report.deferredTasks[0].reason, "access_blocked");
  assert.equal(JSON.stringify(plan), before);
});

test("shared station receipts bind task aliases and actual selected dwell without rewriting identities", () => {
  const plan = makeSimulatedSharedStopPlan(); plan.planningGoal = "coverage";
  plan.tasks[3].required = false; plan.tasks[4].required = false;
  const issued = compileFieldTaskRouting(plan), response = simulatedFieldResponse(plan);
  const selected = issued.taskAliases.slice(0, 3).map(task => task.alias), dwell = plan.tasks.slice(0, 3).reduce((sum, task) => sum + task.dwellMinutes * 60, 0);
  response.taskSelection = { selectedTaskIds: selected, deferredTasks: issued.taskAliases.slice(3).map(task => ({ taskId: task.alias, reason: "time_budget", detail: "本次工时延期" })),
    dwellSeconds: dwell, bufferSeconds: plan.bufferMinutes * 60, workBudgetSeconds: plan.workMinutes * 60,
    drivingBudgetSeconds: plan.workMinutes * 60 - dwell - plan.bufferMinutes * 60 };
  const receipt = bindFieldTaskRoute(plan, { plan: response }, issued);
  assert.equal(receipt.visits[1].taskIds.length, 1);
  const report = buildFieldTaskReport(plan, receipt, { assessedAt: now });
  assert.equal(report.visits[1].tasks.length, 1); assert.equal(report.deferredTasks.length, 2);
  const changed = structuredClone(plan); changed.revision++;
  assert.throws(() => buildFieldTaskReport(changed, receipt, { assessedAt: now }), /当前任务不一致/);
  response.taskSelection.selectedTaskIds.pop();
  assert.throws(() => bindFieldTaskRoute(plan, { plan: response }, issued), /任务执行与延期回执|执行任务、延期原因或完整工时预算/);
});

test("candidates compare preference-only autosaves yet freeze their own full receipt snapshot", () => {
  const plan = localPlan();
  const candidate = createFieldTaskCandidate(plan, { candidateId: "candidate-a", generatedAt: now, assessedAt: now, receipt: null });
  const metadata = { ...plan, revision: plan.revision + 1, updatedAt: "2026-10-08T01:01:00.000Z", planningGoal: "priority" as const, strategy: "5" as const };
  assert.equal(candidateBaseKey(plan), candidateBaseKey(metadata));
  assert.equal(validateFieldTaskCandidate(metadata, candidate).plan.revision, plan.revision);
  assert.ok(Object.isFrozen(candidate.plan) && Object.isFrozen(candidate.plan.tasks));
  const edited = structuredClone(metadata); edited.tasks[1].dwellMinutes--;
  assert.throws(() => validateFieldTaskCandidate(edited, candidate), /旧候选已失效/);
  assert.throws(() => validateFieldTaskCandidate(plan, candidate, { assessedAt: "2026-10-08T01:30:00.000Z" }), /过期/);
});

test("metadata saves preserve exclusions and selected tasks but cannot acquire other input or a corrupted selection", () => {
  const plan = makeSimulatedSharedStopPlan(); plan.planningGoal = "coverage";
  plan.tasks[3].required = false; plan.tasks[4].required = false;
  const exclusions = { [plan.tasks[3].taskId]: "人工进入受阻" }, issued = compileFieldTaskRouting(plan, {}, { excludedTaskReasons: exclusions });
  const response = simulatedFieldResponse(plan);
  response.planning!.fieldTasks = structuredClone(issued.request!.fieldTasks);
  const selected = issued.taskAliases.filter(task => task.taskId !== plan.tasks[3].taskId).map(task => task.alias);
  const dwellSeconds = plan.tasks.filter(task => task.taskId !== plan.tasks[3].taskId).reduce((sum, task) => sum + task.dwellMinutes * 60, 0);
  response.taskSelection = { selectedTaskIds: selected, deferredTasks: [{ taskId: issued.taskAliases[3].alias, reason: "access_blocked", detail: "人工进入受阻" }],
    dwellSeconds, bufferSeconds: plan.bufferMinutes * 60, workBudgetSeconds: plan.workMinutes * 60,
    drivingBudgetSeconds: plan.workMinutes * 60 - dwellSeconds - plan.bufferMinutes * 60 };
  const receipt = bindFieldTaskRoute(plan, { plan: response }, issued), saved = { ...plan, revision: plan.revision + 1, updatedAt: now };
  const synced = syncFieldTaskPlanMetadata(plan, saved, receipt);
  assert.ok(synced.receipt); assert.deepEqual(synced.receipt.inputExclusions, exclusions);
  assert.equal(synced.receipt.inputSignature, compileFieldTaskRouting(saved, {}, { excludedTaskReasons: exclusions }).inputSignature);
  assert.deepEqual(buildFieldTaskReport(saved, synced.receipt, { assessedAt: now }).selectedTaskIds, receipt.selectedTaskIds);
  const changed = structuredClone(saved); changed.tasks[1].priority = "high";
  assert.equal(syncFieldTaskPlanMetadata(plan, changed, receipt).plan.revision, plan.revision);
  const corrupted = structuredClone(receipt); corrupted.visits[1].taskIds.push(plan.tasks[3].taskId);
  assert.equal(syncFieldTaskPlanMetadata(plan, saved, corrupted).receipt, null);
});

test("execution records require adopted task/visit, reason and real local evidence refs", () => {
  const plan = localPlan(), candidate = createFieldTaskCandidate(plan, { candidateId: "candidate-a", generatedAt: now, assessedAt: now, receipt: null });
  const visit = candidate.report.visits[1], task = visit.tasks[0];
  const input = { recordId: "record-a", taskId: task.taskId, visitId: visit.visitId, status: "incomplete" as const,
    actualStart: null, actualEnd: null, actualMinutes: 12, reason: "入口临时关闭", evidenceRefs: ["photo:existing"], recordedAt: now };
  assert.throws(() => createFieldExecutionRecord(candidate, input), /照片证据/);
  const record = createFieldExecutionRecord(candidate, input, { availableEvidenceIds: ["photo:existing"] });
  assert.equal(record.revision, plan.revision);
  assert.throws(() => createFieldExecutionRecord(candidate, { ...input, reason: "" }), /原因/);
  assert.throws(() => createFieldExecutionRecord(candidate, { ...input, taskId: candidate.report.deferredTasks[0].taskId }), /本次采用方案/);
  const values = new Map<string, string>();
  const store = createFieldExecutionStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  assert.deepEqual(store.save(record), record); assert.deepEqual(store.list(plan.planId), [record]);
  assert.doesNotMatch([...values.values()][0], /providerPlan|coordinates|drivingMinutes|receipt/);
  assert.throws(() => store.save({ ...record, taskId: "different" }), /身份不能改写/);
  assert.throws(() => parseFieldExecutionRecord({ ...record, actualStart: now, actualEnd: "2026-10-08T01:05:00.000Z" }), /实际耗时不一致/);
  const blocked = createFieldExecutionStore({ getItem: () => null, setItem: () => { throw new Error("quota"); } });
  assert.throws(() => blocked.save(record), /写入失败/);
});

test("execution history sorts actual UTC instants when ISO precision differs", () => {
  const values = new Map<string, string>();
  const store = createFieldExecutionStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
  const base = { recordId: "whole-second", planId: "simulation-plan", revision: 1, candidateId: "simulation-candidate", taskId: "simulation-task", visitId: "simulation-visit",
    status: "completed" as const, actualStart: null, actualEnd: null, actualMinutes: null, reason: "", evidenceRefs: [], recordedAt: "2026-10-08T01:00:00Z" };
  store.save(base);
  store.save({ ...base, recordId: "fractional-second", recordedAt: "2026-10-08T01:00:00.500Z" });
  store.save({ ...base, recordId: "previous-second", recordedAt: "2026-10-08T00:59:59.999Z" });
  assert.deepEqual(store.list(base.planId).map(record => record.recordId), ["fractional-second", "whole-second", "previous-second"]);
});
