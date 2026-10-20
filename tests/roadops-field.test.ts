import assert from "node:assert/strict";
import test from "node:test";
import { assessFieldPlan, buildFieldBrief, fieldDistanceToLineMeters, type FieldVisitInput, type FieldScheduleInput } from "../app/lib/roadops-field";
import type { RoadOpsDrivingPlan } from "../app/lib/roadops-driving";
import type { RoadRiskEvidenceInput } from "../app/lib/roadops-quality";

const schedule: FieldScheduleInput = { startTime: "08:30", workMinutes: 480, bufferMinutes: 20 };
function visits(): FieldVisitInput[] {
  return [
    { id: "origin", name: "出发点", coordinate: [110.3, 20], vehicleCoordinate: null, dwellMinutes: 5, accessReview: "unknown", accessNote: "" },
    { id: "inspection", name: "核查点", coordinate: [110.32, 20], vehicleCoordinate: null, dwellMinutes: 15, accessReview: "unknown", accessNote: "" },
    { id: "end", name: "终点", coordinate: [110.34, 20], vehicleCoordinate: null, dwellMinutes: 10, accessReview: "unknown", accessNote: "" },
  ];
}
function confirmed(): FieldVisitInput[] {
  return visits().map(visit => ({ ...visit, accessReview: "confirmed", accessNote: "已向现场联系人核实入口和停靠位置，出发前仍复核" }));
}
function plan(): RoadOpsDrivingPlan {
  const points = visits();
  return {
    schemaVersion: "roadops-driving-plan-v1", provider: "didi_web_service", mode: "didi_live", generatedAt: "2026-09-27T00:00:00.000Z", inputFingerprint: "field-test", status: "ready",
    stopOrder: points.map(point => point.id), selectedCandidateIds: ["inspection"], excluded: [], totalDistanceMeters: 5000,
    drivingMinutes: 30, dwellMinutes: 25, totalMinutes: 55, workMinutes: 480, overtimeMinutes: 0,
    map: { mode: "didi_live", fixtureId: "manual", stops: [], features: [], bounds: [110.3, 20, 110.34, 20] },
    usage: { cached: false, upstreamRequests: 3, dailyUsed: 3, dailyBudget: 50, dailyRemaining: 47, perIdentityUsed: 3, perIdentityLimit: 20 },
    field: {
      schemaVersion: "roadops-field-detail-v1", guidance: "geometry_only", routePackCount: 2, limitations: ["供应方仅提供路线几何与时距"],
      legs: [
        { id: "leg-1", index: 1, fromId: "origin", toId: "inspection", distanceMeters: 2000, durationSeconds: 600, coordinates: [[110.3, 20], [110.32, 20]], bounds: [110.3, 20, 110.32, 20], traffic: [], tollsYuan: 0, tag: null },
        { id: "leg-2", index: 2, fromId: "inspection", toId: "end", distanceMeters: 3000, durationSeconds: 1200, coordinates: [[110.32, 20], [110.34, 20]], bounds: [110.32, 20, 110.34, 20], traffic: [], tollsYuan: null, tag: null },
      ],
      access: points.map(point => ({ pointId: point.id, coordinate: point.coordinate, roadCoordinate: point.coordinate, offsetMeters: 0, status: "near_route", thresholdMeters: 50 })),
    },
    boundary: "仅测试，不是真实通行证明",
  };
}

test("a provider route is not a claim that unknown sites are accessible", () => {
  const report = assessFieldPlan(plan(), visits(), schedule);
  assert.equal(report.providerHasRoute, true);
  assert.equal(report.status, "needs_review");
  assert.equal(report.issues.filter(issue => issue.code === "access_unknown").length, 3);
  assert.equal(report.evidence.providedCount, 0);
  assert.equal(report.evidence.matchedCount, 0);
  assert.ok(report.coverage.some(line => line.includes("现场照片 0 条")));
  assert.ok(report.coverage.some(line => line.includes("未接入现场封路")));
});

test("every recorded confirmation yields only ready_with_checks, not a safety guarantee", () => {
  const report = assessFieldPlan(plan(), confirmed(), schedule);
  assert.equal(report.status, "ready_with_checks");
  assert.ok(report.coverage.some(line => line.includes("不构成安全保证")));
});

test("aged route traffic needs manual refresh without inventing a current safety status", () => {
  const stale = assessFieldPlan(plan(), confirmed(), schedule, [], { assessedAt: "2026-09-27T05:00:00.000Z" });
  assert.equal(stale.status, "needs_review");
  assert.ok(stale.issues.some(issue => issue.code === "route_stale" && issue.message.includes("300 分钟")));
  const current = assessFieldPlan(plan(), confirmed(), schedule, [], { assessedAt: "2026-09-27T00:15:00.000Z" });
  assert.equal(current.status, "ready_with_checks");
  assert.ok(!current.issues.some(issue => issue.code === "route_stale"));
  assert.equal(assessFieldPlan(plan(), confirmed(), schedule, [], { assessedAt: "invalid" }).status, "needs_review");
});

test("checking confirmed without a written basis falls back to unknown", () => {
  const points = confirmed();
  points[1].accessNote = "   ";
  const report = assessFieldPlan(plan(), points, schedule);
  assert.equal(report.stops[1].accessReview, "unknown");
  assert.equal(report.status, "needs_review");
  assert.ok(report.issues.some(issue => issue.code === "access_unknown" && issue.message.includes("未填写依据")));
});

test("manual blocked status blocks the task even when the provider returns a route", () => {
  const points = confirmed();
  points[1].accessReview = "blocked";
  points[1].accessNote = "联系人告知入口未开放";
  const report = assessFieldPlan(plan(), points, schedule);
  assert.equal(report.providerHasRoute, true);
  assert.equal(report.status, "blocked");
  assert.ok(report.issues.some(issue => issue.code === "manual_blocked" && issue.pointId === "inspection"));
});

test("1200m parking-to-target gap is separate from vehicle route reachability", () => {
  const points = visits();
  points[1].vehicleCoordinate = points[1].coordinate;
  points[1].coordinate = [110.332, 20];
  const report = assessFieldPlan(plan(), points, schedule);
  assert.equal(report.status, "needs_review");
  assert.ok(report.stops[1].targetGapMeters > 1200);
  assert.equal(report.stops[1].roadOffsetMeters, 0);
  assert.equal(report.stops[1].providerHasRoute, true);
  assert.equal(report.totals.drivingMinutes, 30);
  assert.ok(report.issues.some(issue => issue.code === "target_gap"));
  assert.ok(report.limitations.some(line => line.includes("未计算步行路线或步行耗时")));
});

test("a recorded entry check never invents walking time for a target gap", () => {
  const points = confirmed();
  points[1].vehicleCoordinate = points[1].coordinate;
  points[1].coordinate = [110.332, 20];
  const report = assessFieldPlan(plan(), points, schedule);
  assert.equal(report.status, "ready_with_checks");
  assert.equal(report.totals.totalMinutes, 75);
  assert.ok(report.issues.some(issue => issue.code === "target_transfer"));
});

test("road snap offset over 50m always requires review, even with manual entry confirmation", () => {
  const value = plan();
  value.field!.access[1].offsetMeters = 120;
  value.field!.access[1].status = "far_from_route";
  const report = assessFieldPlan(value, confirmed(), schedule);
  assert.equal(report.status, "needs_review");
  assert.ok(report.issues.some(issue => issue.code === "road_offset"));
});

test("ETA accumulates real leg durations and station dwell, with end-of-day buffer", () => {
  const report = assessFieldPlan(plan(), confirmed(), schedule);
  assert.deepEqual(report.legs.map(leg => [leg.departureTime, leg.arrivalTime]), [["08:30", "08:40"], ["08:55", "09:15"]]);
  assert.deepEqual(report.stops.map(stop => [stop.arrivalTime, stop.departureTime]), [["08:30", "08:30"], ["08:40", "08:55"], ["09:15", "09:25"]]);
  assert.equal(report.stops[0].dwellMinutes, 0);
  assert.equal(report.totals.dwellMinutes, 25);
  assert.equal(report.totals.totalMinutes, 75);
  assert.equal(report.totals.finishTime, "09:45");
  assert.equal(report.totals.distanceMeters, 5000);
});

test("an over-budget field schedule is blocked and reports the excess", () => {
  const report = assessFieldPlan(plan(), confirmed(), { ...schedule, workMinutes: 60 });
  assert.equal(report.status, "blocked");
  assert.equal(report.totals.overtimeMinutes, 15);
  assert.ok(report.issues.some(issue => issue.code === "work_overtime"));
});

test("local schedule reevaluation does not preserve an obsolete server budget block", () => {
  const value = plan();
  value.status = "infeasible";
  value.workMinutes = 30;
  value.overtimeMinutes = 25;
  const report = assessFieldPlan(value, confirmed(), schedule);
  assert.equal(report.status, "ready_with_checks");
  assert.equal(report.totals.overtimeMinutes, 0);
  assert.ok(report.issues.some(issue => issue.code === "previous_budget" && issue.severity === "notice"));
  assert.equal(assessFieldPlan(value, confirmed(), { ...schedule, workMinutes: 30 }).status, "blocked");
});

test("clock labels preserve next-day rollover rather than displaying a misleading same day", () => {
  const report = assessFieldPlan(plan(), confirmed(), { ...schedule, startTime: "23:30" });
  assert.equal(report.stops[2].arrivalTime, "+1天 00:15");
  assert.equal(report.totals.finishTime, "+1天 00:45");
});

test("invalid starting times and duration inputs are blocked, not silently accepted", () => {
  for (const startTime of ["8:30", "24:00", "12:60", "", "wrong"]) {
    const report = assessFieldPlan(plan(), confirmed(), { ...schedule, startTime });
    assert.equal(report.status, "blocked");
    assert.equal(report.totals.finishTime, "待重新规划");
    assert.ok(report.issues.some(issue => issue.code === "invalid_start_time"));
  }
  for (const invalidSchedule of [{ ...schedule, workMinutes: 0 }, { ...schedule, workMinutes: NaN }, { ...schedule, bufferMinutes: -1 }]) {
    assert.equal(assessFieldPlan(plan(), confirmed(), invalidSchedule).status, "blocked");
  }
});

test("legacy overview routes and contract replays require real field replanning", () => {
  const legacy = plan();
  delete legacy.field;
  const report = assessFieldPlan(legacy, confirmed(), schedule);
  assert.equal(report.status, "needs_replan");
  assert.equal(report.providerHasRoute, false);
  assert.deepEqual(report.legs, []);
  assert.equal(report.totals.finishTime, "待重新规划");
  assert.ok(report.stops.every(stop => stop.roadOffsetMeters === null && !stop.providerHasRoute));
  const replay = plan();
  replay.mode = "didi_replay";
  replay.provider = "didi_contract_replay";
  assert.equal(assessFieldPlan(replay, confirmed(), schedule).status, "needs_replan");
});

test("incomplete, degenerate, or misordered field geometry cannot stand in for actual legs", () => {
  const incomplete = plan();
  incomplete.field!.legs.pop();
  assert.equal(assessFieldPlan(incomplete, confirmed(), schedule).status, "needs_replan");
  const degenerate = plan();
  degenerate.field!.legs[0].coordinates = [[110.3, 20], [110.3, 20]];
  assert.equal(assessFieldPlan(degenerate, confirmed(), schedule).status, "needs_replan");
  const wrongOrder = plan();
  wrongOrder.field!.legs[0].toId = "end";
  assert.equal(assessFieldPlan(wrongOrder, confirmed(), schedule).status, "needs_replan");
});

test("changing a vehicle coordinate invalidates the old route, while dwell changes do not", () => {
  const points = confirmed();
  points[1].vehicleCoordinate = [110.325, 20];
  const report = assessFieldPlan(plan(), points, schedule);
  assert.equal(report.status, "needs_replan");
  assert.ok(report.issues.some(issue => issue.code === "stale_stop_coordinate"));
  const sameLocation = confirmed();
  sameLocation[1].dwellMinutes = 30;
  assert.equal(assessFieldPlan(plan(), sameLocation, schedule).status, "ready_with_checks");
});

test("segment projection catches mid-segment evidence far from both vertices", () => {
  assert.ok(fieldDistanceToLineMeters([110.31, 20.0004], [[110.3, 20], [110.32, 20]]) < 50);
  assert.ok(fieldDistanceToLineMeters([110.31, 20.002], [[110.3, 20], [110.32, 20]]) > 200);
  const evidence: RoadRiskEvidenceInput[] = [{ id: "insar-real", type: "insar", longitude: 110.31, latitude: 20.0004, capturedAt: "2026-09-26T00:00:00.000Z", summary: "邻近监测异常，未确认道路受影响" }];
  const report = assessFieldPlan(plan(), confirmed(), schedule, evidence);
  assert.equal(report.status, "needs_review");
  assert.equal(report.evidence.matchedCount, 1);
  assert.deepEqual(report.evidence.items[0].legIds, ["leg-1"]);
  assert.deepEqual(report.evidence.items[0].pointIds, []);
  assert.equal(report.evidence.items[0].freshness, "recent");
  assert.ok(report.issues.some(issue => issue.code === "nearby_evidence" && issue.message.includes("不自动绕行")));
  assert.equal(report.legs.length, 2);
});

test("spatial evidence reports honest provided/matched/excluded counts and configurable age flags", () => {
  const create = (id: string, capturedAt?: string): RoadRiskEvidenceInput => ({ id, type: "field_photo", longitude: 110.31, latitude: 20, capturedAt, summary: id });
  const inputs: RoadRiskEvidenceInput[] = [
    create("old", "2026-08-28T00:00:00.000Z"), create("unknown"), create("future", "2027-01-01T00:00:00.000Z"),
    { ...create("far"), longitude: 112 }, { ...create("invalid"), latitude: NaN }, { ...create("unsupported"), type: "gps_trace" },
  ];
  const report = assessFieldPlan(plan(), confirmed(), schedule, inputs);
  assert.equal(report.evidence.providedCount, 6);
  assert.equal(report.evidence.matchedCount, 3);
  assert.equal(report.evidence.unmatchedCount, 1);
  assert.equal(report.evidence.invalidCount, 1);
  assert.equal(report.evidence.unsupportedCount, 1);
  assert.deepEqual(report.evidence.items.map(item => item.freshness), ["stale", "unknown", "future"]);
  const custom = assessFieldPlan(plan(), confirmed(), schedule, [inputs[0]], { evidenceStaleDays: 60 });
  assert.equal(custom.evidence.items[0].freshness, "recent");
  assert.equal(custom.evidence.staleDays, 60);
});

test("evidence can match an inspection target separately from its vehicle stopping point", () => {
  const points = confirmed();
  points[1].vehicleCoordinate = points[1].coordinate;
  points[1].coordinate = [110.32, 20.01];
  const input: RoadRiskEvidenceInput = { id: "target-photo", type: "field_photo", longitude: 110.32, latitude: 20.01, summary: "核查目标照片", capturedAt: "2026-09-26" };
  const report = assessFieldPlan(plan(), points, schedule, [input]);
  assert.deepEqual(report.evidence.items[0].pointIds, ["inspection"]);
  assert.deepEqual(report.evidence.items[0].legIds, []);
});

test("evidence evaluation is capped at the first 200 records and does not silently claim full coverage", () => {
  const inputs: RoadRiskEvidenceInput[] = Array.from({ length: 201 }, (_, index) => ({ id: `item-${index}`, type: "insar", longitude: 112, latitude: 20, summary: "远处数据", capturedAt: "2026-09-26" }));
  inputs[200].longitude = 110.31;
  const report = assessFieldPlan(plan(), confirmed(), schedule, inputs);
  assert.equal(report.evidence.providedCount, 201);
  assert.equal(report.evidence.evaluatedCount, 200);
  assert.equal(report.evidence.truncatedCount, 1);
  assert.equal(report.evidence.unmatchedCount, 200);
  assert.equal(report.evidence.matchedCount, 0);
  assert.equal(report.status, "needs_review");
  assert.ok(report.issues.some(issue => issue.code === "evidence_truncated"));
  assert.ok(report.coverage.some(line => line.includes("1 条未评估")));
});

test("unplanned or invalid visits are not silently removed to make the task look feasible", () => {
  const extra = confirmed();
  extra.push({ ...extra[1], id: "extra" });
  assert.equal(assessFieldPlan(plan(), extra, schedule).status, "blocked");
  const invalid = confirmed();
  invalid[1].dwellMinutes = NaN;
  assert.equal(assessFieldPlan(plan(), invalid, schedule).status, "blocked");
  const missing = confirmed().filter(point => point.id !== "inspection");
  assert.equal(assessFieldPlan(plan(), missing, schedule).status, "blocked");
});

test("brief contains useful per-leg/stop instructions and limitations, without raw supplier geometry", () => {
  const value = plan(), points = visits();
  const report = assessFieldPlan(value, points, schedule);
  const brief = buildFieldBrief(report, value, points);
  assert.match(brief, /待核验，不可视为已可达/);
  assert.match(brief, /出发点 → 核查点 \| 08:30–08:40/);
  assert.match(brief, /110\.300000, 20\.000000 → 110\.320000, 20\.000000/);
  assert.match(brief, /WGS84/);
  assert.match(brief, /未算步行耗时/);
  assert.match(brief, /现场照片 0 条/);
  assert.match(brief, /不提供逐转向/);
  assert.match(brief, /2026-09-27T00:00:00.000Z/);
  assert.ok(!brief.includes('"coordinates"'));
  assert.ok(!brief.includes("inputFingerprint"));
});

test("brief sanitizes user newlines so notes cannot inject false checklist sections", () => {
  const points = confirmed();
  points[1].accessNote = "已核实\n状态：安全通行\t额外标题";
  const value = plan(), brief = buildFieldBrief(assessFieldPlan(value, points, schedule), value, points);
  assert.ok(!brief.includes("\n状态：安全通行"));
  assert.ok(brief.includes("已核实 状态：安全通行 额外标题"));
});
