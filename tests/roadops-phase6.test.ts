import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GisLayer } from "../app/lib/gis-layer";
import { parseRoadOpsDrivingPlan, type RoadOpsDrivingPlan } from "../app/lib/roadops-driving";
import { buildRoadOpsMetrics, createRoadOpsMetricsSession, roadOpsMetricsCsv, roadOpsMetricsJson, type RoadOpsMetricsSession, type RoadOpsMetricsSnapshot } from "../app/lib/roadops-metrics";
import { buildRoadQualityReport, type RoadQualityReport } from "../app/lib/roadops-quality";
import { optimizeRoadOpsRoute, parseRoadOpsRouteFixture, type RoadOpsRouteRequest } from "../app/lib/roadops-route";
import { materializeRoadIssueWorkOrder, type RoadIssueWorkOrder, type RoadWorkOrderStatus } from "../app/lib/roadops-workflow";

const at = "2026-09-22T06:00:00.000Z";
const layer: GisLayer = {
  id: "phase6-fixture", name: "指标测试道路", sourceName: "fixture.geojson", sourceType: "geojson", role: "road", visible: true, opacity: 1,
  featureCount: 3, geometryTypes: ["LineString"], bounds: null, importedAt: at,
  provenance: { kind: "osm", builtIn: true },
  features: [0, 1, 2].map(index => ({ type: "Feature", id: `way/${index}`, geometry: { type: "LineString", coordinates: [[110.4 + index / 100, 20], [110.401 + index / 100, 20]] }, properties: { highway: "residential" } })),
};
const rawReport = buildRoadQualityReport(layer);
const report: RoadQualityReport = {
  ...rawReport,
  issues: Array.from({ length: 6 }, (_, index) => ({ ...rawReport.issues[0], id: `issue-${index}`, roadSegmentIds: index === 0 ? ["way/0", "way/1", "not-a-current-segment"] : ["way/0"] })),
};
const statuses: RoadWorkOrderStatus[] = ["accepted", "rejected", "field_required", "verified", "pending_review", "accepted"];
const records = Object.fromEntries(report.issues.map((issue, index) => [issue.id, {
  ...materializeRoadIssueWorkOrder(issue, report.datasetId),
  status: statuses[index], datasetId: index === 5 ? "stale-dataset" : report.datasetId,
  manualNote: "PRIVATE_NOTE_MUST_NOT_EXPORT", reviewReason: "PRIVATE_REASON_MUST_NOT_EXPORT", linkedEvidenceIds: ["PRIVATE_EVIDENCE_ID"],
}])) as Record<string, RoadIssueWorkOrder>;
const emptySession = createRoadOpsMetricsSession(at);
const fixture = parseRoadOpsRouteFixture(JSON.parse(readFileSync("public/data/roadops/jiangdong-route-demo.json", "utf8")));
const request: RoadOpsRouteRequest = {
  startId: "origin", endId: "terminal", candidateIds: ["checkpoint-a", "checkpoint-b", "checkpoint-c", "checkpoint-d", "checkpoint-e", "checkpoint-f"],
  requiredIds: ["checkpoint-c"], dwellMinutes: { "checkpoint-a": 35, "checkpoint-b": 25, "checkpoint-c": 40, "checkpoint-d": 30, "checkpoint-e": 20, "checkpoint-f": 25 },
  workMinutes: 120, returnToStart: false,
};
const route = optimizeRoadOpsRoute(fixture, request);
const replay = parseRoadOpsDrivingPlan(JSON.parse(readFileSync("public/data/roadops/jiangdong-didi-contract-replay.json", "utf8")));
const build = (patch: Partial<Parameters<typeof buildRoadOpsMetrics>[0]> = {}) => buildRoadOpsMetrics({ report, records, route, session: emptySession, ...patch });
const metric = (snapshot: RoadOpsMetricsSnapshot, id: string) => {
  const value = snapshot.metrics.find(item => item.id === id);
  assert.ok(value, `Missing metric ${id}`);
  return value;
};

test("metrics UI stays local, exposes definitions and receives the active planner state", () => {
  const panel = readFileSync("app/components/RoadMetricsPanel.tsx", "utf8");
  const parent = readFileSync("app/components/RoadQualityPanel.tsx", "utf8");
  const planner = readFileSync("app/components/RoadRoutePlannerPanel.tsx", "utf8");
  for (const label of ["路网质量", "审核与外业", "路线收益", "调用用量", "定义", "分子 / 分母", "时间范围", "来源", "指标 JSON", "指标 CSV"]) assert.ok(panel.includes(label));
  assert.doesNotMatch(panel, /fetch\(|https?:\/\//);
  assert.match(parent, /onMetricsChange=\{setPlannerMetrics\}/);
  assert.match(planner, /route: routeMode === "offline" \? plan : drivingPlan, session/);
  assert.match(planner, /<fieldset className="route-inputs" disabled=\{drivingStatus === "loading"\}/);
  assert.match(planner, /本地读取 · 0 调用/);
});

test("quality denominators deduplicate valid affected segments and do not equate issue count with defects", () => {
  const snapshot = build({ report: { ...report, issues: [...report.issues, report.issues[0]] } });
  assert.equal(metric(snapshot, "quality_segments").value, 3);
  assert.equal(metric(snapshot, "quality_issues").value, 6);
  assert.equal(metric(snapshot, "quality_affected_segments").value, 2);
  assert.deepEqual([metric(snapshot, "quality_affected_rate").numerator, metric(snapshot, "quality_affected_rate").denominator, metric(snapshot, "quality_affected_rate").value], [2, 3, 66.67]);
  assert.match(metric(snapshot, "quality_affected_rate").definition, /不是实测缺陷率/);
});

test("review rate, explicit acceptance rate and field backlog have distinct denominators and lineage", () => {
  const snapshot = build();
  assert.deepEqual(snapshot.workflow, { pending_review: 2, accepted: 1, rejected: 1, field_required: 1, verified: 1 });
  assert.deepEqual([metric(snapshot, "workflow_reviewed_rate").numerator, metric(snapshot, "workflow_reviewed_rate").denominator, metric(snapshot, "workflow_reviewed_rate").value], [4, 6, 66.67]);
  assert.deepEqual([metric(snapshot, "workflow_acceptance_rate").numerator, metric(snapshot, "workflow_acceptance_rate").denominator, metric(snapshot, "workflow_acceptance_rate").value], [1, 2, 50]);
  assert.equal(metric(snapshot, "workflow_field_required").value, 1);
  assert.equal(metric(snapshot, "workflow_verified").value, 1);
});

test("offline optimization savings compare only the same selected points, not removed work", () => {
  assert.ok(route.selectedCandidateIds.length < request.candidateIds.length);
  const selectedInputOrder = request.candidateIds.filter(id => route.selectedCandidateIds.includes(id));
  const baselineOrder = [request.startId, ...selectedInputOrder, request.endId];
  const expectedBaselineMinutes = Math.round(baselineOrder.slice(1).reduce((total, id, index) => total + fixture.matrix[baselineOrder[index]][id]!.durationSeconds, 0) / 60 * 10) / 10;
  const snapshot = build();
  assert.equal(metric(snapshot, "route_time_saved_rate").denominator, expectedBaselineMinutes);
  assert.equal(metric(snapshot, "route_time_saved_minutes").value, Math.round((expectedBaselineMinutes - route.drivingMinutes) * 100) / 100);
  assert.equal(metric(snapshot, "route_selected_candidates").value, route.selectedCandidateIds.length);
  const longerRoute = { ...route, totalDistanceMeters: route.baselineDistanceMeters + 20, distanceSavedMeters: 0 };
  assert.equal(metric(build({ route: longerRoute }), "route_distance_saved_meters").value, -20, "time optimization must not hide increased distance");
});

test("snapshot timestamp includes newer valid workflow observations", () => {
  const updatedAt = "2026-09-23T06:00:00.000Z";
  const changed = { ...records, "issue-0": { ...records["issue-0"], updatedAt } };
  assert.equal(build({ records: changed }).generatedAt, updatedAt);
  assert.match(metric(build({ records: changed }), "workflow_reviewed_rate").timeRange, /2026-09-23/);
});

test("live and contract replay routes have no savings without a matching baseline", () => {
  const live: RoadOpsDrivingPlan = { ...replay, mode: "didi_live", provider: "didi_web_service" };
  for (const plan of [replay, live]) {
    const snapshot = build({ route: plan });
    assert.equal(metric(snapshot, "route_time_saved_minutes").value, null);
    assert.equal(metric(snapshot, "route_time_saved_rate").value, null);
    assert.equal(metric(snapshot, "route_time_saved_rate").denominator, null);
    assert.equal(metric(snapshot, "route_distance_saved_meters").value, null);
    assert.equal(metric(snapshot, "route_total_minutes").value, plan.totalMinutes);
  }
});

test("zero denominators and absent real observations remain unknown instead of fabricated zero rates", () => {
  const emptyReport = { ...report, segments: [], issues: [] };
  const snapshot = build({ report: emptyReport, records: {}, route: null });
  for (const id of ["quality_affected_rate", "workflow_reviewed_rate", "workflow_acceptance_rate", "route_time_saved_rate", "api_cache_hit_rate", "api_upstream_requests", "api_budget_remaining"]) assert.equal(metric(snapshot, id).value, null, id);
  assert.equal(metric(snapshot, "api_live_attempts").value, 0);
  assert.equal(metric(snapshot, "api_budget_remaining").denominator, null);
  const zeroBaseline = build({ route: { ...route, baselineDrivingMinutes: 0, drivingMinutes: 0 } });
  assert.equal(metric(zeroBaseline, "route_time_saved_rate").value, null);
  assert.ok(snapshot.metrics.every(item => item.value === null || Number.isFinite(item.value)));
});

test("replay usage cannot become real quota evidence or a real cache hit", () => {
  const replaySession = { ...emptySession, replayLoads: 3 };
  const snapshot = build({ route: replay, session: replaySession });
  assert.equal(metric(snapshot, "api_replay_loads").value, 3);
  assert.equal(metric(snapshot, "api_live_attempts").value, 0);
  assert.equal(metric(snapshot, "api_budget_remaining").value, null, "replay fixture budget 0/50 is not real usage");
  assert.equal(metric(snapshot, "api_upstream_requests").value, null);
  assert.equal(metric(snapshot, "api_cache_hit_rate").value, null);
  const realSession: RoadOpsMetricsSession = { ...replaySession, liveAttempts: 3, liveSuccesses: 2, cacheHits: 1, failedAttempts: 1, usageObservations: 2, observedUpstreamRequests: 3, latestUsage: { observedAt: at, dailyUsed: 3, dailyBudget: 50, dailyRemaining: 47 } };
  const withRealUsage = build({ route: replay, session: realSession });
  assert.equal(metric(withRealUsage, "api_cache_hit_rate").value, 50);
  assert.equal(metric(withRealUsage, "api_cache_hit_rate").denominator, 2);
  assert.equal(metric(withRealUsage, "api_upstream_requests").value, 3);
  assert.equal(metric(withRealUsage, "api_budget_remaining").value, 47);
  const corruptUsage = build({ session: { ...realSession, latestUsage: { ...realSession.latestUsage!, dailyRemaining: 49 } } });
  assert.equal(metric(corruptUsage, "api_budget_remaining").value, null);
});

test("snapshot and aggregate exports are deterministic, traceable and exclude detailed records and secrets", () => {
  const before = JSON.stringify({ report, records, route, emptySession });
  const snapshot = build();
  assert.deepEqual(build(), snapshot);
  assert.equal(JSON.stringify({ report, records, route, emptySession }), before, "metrics are pure and leave source data unchanged");
  assert.ok(snapshot.metrics.every(item => item.definition && item.timeRange && item.source));
  assert.equal(snapshot.lineage.datasetId, report.datasetId);
  assert.equal(snapshot.lineage.ruleVersion, report.ruleVersion);
  assert.equal(snapshot.lineage.routeFixtureId, route.fixtureId);
  const extended = { ...snapshot, key: "PRIVATE_KEY_SENTINEL", records, route };
  const json = roadOpsMetricsJson(extended), csv = roadOpsMetricsCsv(extended);
  assert.doesNotMatch(json + csv, /PRIVATE_|longitude|latitude|coordinate|manualNote|reviewReason|auditTrail|linkedEvidenceIds/);
  assert.equal(JSON.parse(json).records, undefined);
  assert.equal(JSON.parse(json).route, undefined);
  assert.equal(csv.split("\r\n").length, snapshot.metrics.length + 2);
  assert.match(csv, /dataset_id/);
  assert.match(csv, /numerator/);
  assert.match(csv, /denominator/);
  assert.equal(roadOpsMetricsJson(snapshot), json);
});

test("CSV preserves unknown cells and neutralizes spreadsheet formula metadata", () => {
  const snapshot = build();
  const csv = roadOpsMetricsCsv({ ...snapshot, lineage: { ...snapshot.lineage, datasetId: "=HYPERLINK(\"https://invalid.test\")" } });
  assert.match(csv, /"'=HYPERLINK/);
  const budgetRow = csv.split("\r\n").find(row => row.includes('"api_budget_remaining"'));
  assert.ok(budgetRow?.includes('"本地日预算剩余","","次"'));
});
