import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildFieldTaskReport } from "../app/lib/roadops-task-report";
import { bindFieldTaskRoute, compileFieldTaskRouting, type FieldTaskRouteReceipt } from "../app/lib/roadops-task-routing";
import { serializeFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { makeSimulatedFieldTaskPlan, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";
import { simulatedFieldResponse } from "./fixtures/roadops-field-routing-response";

const options = { assessedAt: "2026-10-08T01:01:00.000Z" };
function receiptFor(plan: FieldTaskPlan, order?: string[], seconds?: number[]) {
  return bindFieldTaskRoute(plan, { plan: simulatedFieldResponse(plan, order, seconds) }, compileFieldTaskRouting(plan));
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test("FP2 report counts each occurrence including origin service and final return dwell exactly once", () => {
  const plan = makeSimulatedReturnPlan(); plan.tasks[0].dwellMinutes = 0.5; plan.tasks.at(-1)!.dwellMinutes = 15;
  const receipt = receiptFor(plan, undefined, [600, 1620]), before = JSON.stringify([plan, receipt]);
  const report = buildFieldTaskReport(plan, receipt, options);
  assert.equal(report.totals.drivingMinutes, 37);
  assert.equal(report.totals.dwellMinutes, 35.5);
  assert.equal(report.totals.totalMinutes, 102.5);
  assert.deepEqual(report.visits.map(visit => [visit.arrivalMinutes, visit.departureMinutes]), [[0, 0.5], [10.5, 30.5], [57.5, 72.5]]);
  assert.deepEqual(report.legs.map(leg => [leg.departureMinutes, leg.arrivalMinutes]), [[0.5, 10.5], [30.5, 57.5]]);
  assert.equal(report.totals.finishTime, "10:13");
  assert.notEqual(report.visits[0].visitId, report.visits[2].visitId);
  assert.equal(report.visits[0].stopId, report.visits[2].stopId);
  assert.equal(report.visits[0].roadEvidence.arrivalOffsetMeters, null);
  assert.equal(report.visits[2].roadEvidence.departureOffsetMeters, null);
  report.visits[0].coordinate[0] = 0; report.visits[0].tasks[0].targetCoordinate[0] = 0;
  assert.equal(JSON.stringify([plan, receipt]), before);
});

test("FP2 shared tasks retain distinct targets and serial service without adding imaginary station overhead", () => {
  const plan = makeSimulatedSharedStopPlan(); plan.tasks.forEach(task => { task.dwellMinutes = 180; });
  const report = buildFieldTaskReport(plan, receiptFor(plan), options), station = report.visits[1];
  assert.equal(station.dwellMinutes, 540);
  assert.deepEqual(station.tasks.map(task => [task.startMinutes, task.endMinutes]), [[190, 370], [370, 550], [550, 730]]);
  assert.deepEqual(station.tasks.map(task => task.taskId), plan.visits[1].taskIds);
  assert.equal(new Set(station.tasks.map(task => JSON.stringify(task.targetCoordinate))).size, 3);
  assert.equal(station.tasks[0].targetGapMeters, 0);
  assert.ok(station.tasks[1].targetGapMeters > 0);
  assert.ok(station.tasks.every(task => task.lastMileMinutes === null));
  assert.equal(report.totals.totalMinutes, 950);
  assert.equal(report.totals.overtimeMinutes, 470); assert.equal(report.status, "blocked");
  assert.equal(report.legs.length, 2);
});

test("FP2 optimized report swaps whole visits while retaining within-stop task order", () => {
  const plan = makeSimulatedSharedStopPlan(); plan.optimize = true;
  plan.tasks.push({ ...plan.tasks[1], taskId: "extra-task", targetCoordinate: [110.33, 20.03] });
  plan.stops.push({ stopId: "extra-stop", coordinate: [110.33, 20.03], usesVehicleCoordinate: false });
  plan.visits.splice(2, 0, { visitId: "extra-visit", stopId: "extra-stop", taskIds: ["extra-task"], role: "candidate" });
  const points = compileFieldTaskRouting(plan).visits.map(visit => visit.pointId);
  const report = buildFieldTaskReport(plan, receiptFor(plan, [points[0], points[2], points[1], points[3]]), options);
  assert.equal(report.visits[1].visitId, "extra-visit");
  assert.deepEqual(report.visits[2].tasks.map(task => task.taskId), plan.visits[1].taskIds);
  assert.equal(report.visits.flatMap(visit => visit.tasks).length, plan.tasks.length);
});

test("FP2 local-only shared station keeps repeated visits without pretending a provider route exists", () => {
  const plan = makeSimulatedReturnPlan(); const stop = { ...plan.stops[0], usesVehicleCoordinate: true };
  plan.stops = [stop]; plan.visits.forEach(visit => { visit.stopId = stop.stopId; });
  const report = buildFieldTaskReport(plan, null, options);
  assert.equal(report.mode, "no_station_driving"); assert.equal(report.providerHasRoute, false);
  assert.equal(report.generatedAt, null); assert.equal(report.routeAgeMinutes, null);
  assert.equal(report.legs.length, 0); assert.equal(report.visits.length, 3);
  assert.equal(report.totals.drivingMinutes, 0); assert.equal(report.totals.distanceMeters, 0);
  assert.equal(report.totals.totalMinutes, 50); assert.equal(report.status, "needs_review");
  assert.ok(report.visits.every(visit => visit.roadEvidence.source === "not_requested" && visit.roadEvidence.arrivalOffsetMeters === null && visit.roadEvidence.departureOffsetMeters === null));
  assert.throws(() => buildFieldTaskReport(plan, receiptFor(makeSimulatedReturnPlan()), options), /同站任务不接受/);
});

test("FP2 empty origin/final tasks and zero dwell are retained without a hidden default", () => {
  const plan = makeSimulatedReturnPlan(); plan.tasks = [plan.tasks[1]]; plan.tasks[0].dwellMinutes = 0;
  plan.visits[0].taskIds = []; plan.visits.at(-1)!.taskIds = []; plan.bufferMinutes = 0;
  const report = buildFieldTaskReport(plan, receiptFor(plan), options);
  assert.equal(report.visits.length, 3); assert.equal(report.visits[0].tasks.length, 0); assert.equal(report.visits[2].tasks.length, 0);
  assert.equal(report.totals.dwellMinutes, 0); assert.equal(report.totals.totalMinutes, 20);
  assert.equal(report.status, "needs_review");
  assert.equal(report.issues.filter(issue => issue.code === "vehicle_access_unknown").length, 3);
});

test("FP2 independent arrival/departure offsets use leg endpoints rather than shared physical access", () => {
  const plan = makeSimulatedFieldTaskPlan(), provider = simulatedFieldResponse(plan);
  // Synthetic endpoints: arrival near the target, departure on a different test coordinate.
  provider.field!.legs[1].coordinates[0] = [110.312, 20.01];
  const receipt = bindFieldTaskRoute(plan, { plan: provider }, compileFieldTaskRouting(plan));
  // Stale aggregate and cached endpoint evidence are not authoritative for occurrence reports.
  receipt.endpointEvidence[1].arrival = [1, 1]; receipt.endpointEvidence[1].departure = [1, 1];
  const report = buildFieldTaskReport(plan, receipt, options), evidence = report.visits[1].roadEvidence;
  assert.equal(evidence.arrivalOffsetMeters, 0); assert.ok(evidence.departureOffsetMeters! > 50);
  assert.ok(evidence.arrivalDepartureGapMeters! > 50);
  assert.ok(report.issues.some(issue => issue.code === "departure_road_offset"));
  assert.ok(report.issues.some(issue => issue.code === "arrival_departure_gap"));
  assert.ok(!report.issues.some(issue => issue.code === "arrival_road_offset"));
  assert.equal(report.legs.length, 2); assert.equal(report.status, "needs_review");
});

test("FP2 same-revision local edits cannot reuse a previously bound report", () => {
  const original = makeSimulatedFieldTaskPlan(), receipt = receiptFor(original);
  for (const mutate of [
    (plan: FieldTaskPlan) => { plan.tasks[1].dwellMinutes = 99; },
    (plan: FieldTaskPlan) => { plan.tasks[1].accessNote = "不同备注"; },
    (plan: FieldTaskPlan) => { plan.strategy = "2"; },
    (plan: FieldTaskPlan) => { plan.visits[1].visitId = "changed-visit"; },
    (plan: FieldTaskPlan) => { plan.stops[1].coordinate = [110.31, 20.011]; plan.stops[1].usesVehicleCoordinate = true; },
    (plan: FieldTaskPlan) => { plan.revision += 1; },
  ]) {
    const changed = clone(original); mutate(changed);
    assert.throws(() => buildFieldTaskReport(changed, receipt, options), /路线与当前任务不一致/);
  }
});

test("FP2 missing, duplicate, reordered, or corrupted receipt identity and legs fail closed", () => {
  const plan = makeSimulatedFieldTaskPlan();
  const mutations: Array<(receipt: FieldTaskRouteReceipt) => void> = [
    receipt => { receipt.visits.pop(); }, receipt => { receipt.visits[1] = receipt.visits[0]; },
    receipt => { receipt.visits[1].taskIds = []; }, receipt => { receipt.visits[1].dwellMinutes = 0; },
    receipt => { receipt.visits.reverse(); }, receipt => { receipt.legs.pop(); },
    receipt => { receipt.legs[0].fromVisitId = receipt.legs[0].toVisitId; },
    receipt => { receipt.legs[0].toStopId = "wrong-stop"; },
    receipt => { receipt.legs[0].durationSeconds = NaN; },
    receipt => { receipt.legs.forEach(leg => { leg.durationSeconds = Number.MAX_VALUE; }); },
    receipt => { receipt.legs[0].coordinates = [[1, 1], [1, 1]]; },
    receipt => { receipt.generatedAt = "not-a-time"; },
  ];
  for (const mutate of mutations) { const receipt = receiptFor(plan); mutate(receipt); assert.throws(() => buildFieldTaskReport(plan, receipt, options)); }
  assert.throws(() => buildFieldTaskReport(plan, null, options), /缺失/);
});

test("FP2 totals are recalculated from directed legs and current tasks, never trusted receipt summaries", () => {
  const plan = makeSimulatedReturnPlan(), receipt = receiptFor(plan);
  receipt.totalMinutes = 0; receipt.localDwellMinutes = 0; receipt.drivingMinutes = 0; receipt.bufferMinutes = 0;
  const report = buildFieldTaskReport(plan, receipt, options);
  assert.equal(report.totals.drivingMinutes, 20); assert.equal(report.totals.dwellMinutes, 20);
  assert.equal(report.totals.totalMinutes, 70);
});

test("FP2 snapshot age, future clocks, cross-midnight labels and exact budget are explicit", () => {
  const plan = makeSimulatedReturnPlan(); plan.startTime = "23:59"; plan.workMinutes = 70;
  const receipt = receiptFor(plan);
  const fresh = buildFieldTaskReport(plan, receipt, options);
  assert.equal(fresh.totals.finishTime, "+1天 01:09"); assert.equal(fresh.totals.overtimeMinutes, 0);
  assert.equal(fresh.generatedAt, receipt.generatedAt); assert.equal(fresh.routeAgeMinutes, 1);
  assert.ok(!fresh.issues.some(issue => issue.code === "route_stale"));
  assert.ok(buildFieldTaskReport(plan, receipt, { assessedAt: "2026-10-08T01:30:00.000Z" }).issues.some(issue => issue.code === "route_stale"));
  const future = buildFieldTaskReport(plan, receipt, { assessedAt: "2026-10-08T00:59:00.000Z" });
  assert.equal(future.routeAgeMinutes, null); assert.ok(future.issues.some(issue => issue.code === "route_time_future"));
  assert.equal(future.generatedAt, receipt.generatedAt);
  assert.throws(() => buildFieldTaskReport(plan, receipt, { assessedAt: "unknown" }), /复核时间无效/);
});

test("FP2 legacy confirmations, near endpoints and zero target gaps never certify access", () => {
  const plan = makeSimulatedFieldTaskPlan(); plan.tasks.forEach(task => { task.legacyAccessReview = "confirmed"; task.accessNote = "历史人工备注"; });
  const report = buildFieldTaskReport(plan, receiptFor(plan), options);
  assert.equal(report.status, "needs_review");
  assert.ok(report.visits.flatMap(visit => visit.tasks).every(task => task.accessStatus === "needs_review" && task.lastMileMinutes === null));
  assert.equal(report.issues.filter(issue => issue.code === "legacy_confirmation_needs_review").length, 3);
  assert.equal(report.totals.durationCoverage, "user_entered_dwell_only");
  plan.tasks[1].legacyAccessReview = "blocked";
  assert.throws(() => buildFieldTaskReport(plan, null, options), /不可进入/);
});

test("FP2 report has no supplier geometry/private snapshot and cannot leak through the draft whitelist", () => {
  const plan = makeSimulatedFieldTaskPlan(); plan.tasks[1].accessNote = "PRIVATE_TEST_NOTE_NOT_FOR_REPORT";
  const receipt = receiptFor(plan), report = buildFieldTaskReport(plan, receipt, options);
  assert.doesNotMatch(JSON.stringify(report), /inputSignature|PRIVATE_TEST_NOTE|providerLegId|polyline|coordinates|apiKey/);
  const draft = serializeFieldTaskPlan({ ...plan, receipt, report, inputSignature: receipt.inputSignature } as FieldTaskPlan, { includeNotes: false });
  assert.doesNotMatch(draft, /inputSignature|PRIVATE_TEST_NOTE|drivingMinutes|durationSeconds|routeAgeMinutes|endpointEvidence/);
  const source = readFileSync("app/lib/roadops-task-report.ts", "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|\bindexedDB\b|\blocalStorage\b|\bsetInterval\s*\(|buildFieldBrief\(/);
});
