import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GisFeature, GisLayer, Position } from "../app/lib/gis-layer";
import { buildRoadQualityReport } from "../app/lib/roadops-quality";
import {
  ROAD_WORK_ORDER_STATUSES,
  makeRoadOpsWorkflowSnapshot,
  materializeRoadIssueWorkOrder,
  parseRoadOpsWorkflowSnapshot,
  roadIssueChangePreview,
  roadOpsFieldCandidatesCsv,
  roadOpsReviewCsv,
  roadOpsWorkflowJson,
  roadWorkOrderStatusCounts,
  updateRoadIssueWorkOrder,
  workflowStorageKey,
  type RoadIssueWorkOrder,
} from "../app/lib/roadops-workflow";

const line = (id: string, coordinates: Position[], properties: Record<string, unknown> = {}): GisFeature => ({ type: "Feature", id, geometry: { type: "LineString", coordinates }, properties: { osm_id: id.replace(/\D/g, "") || id, osm_type: "way", highway: "residential", ...properties } });
const layer: GisLayer = {
  id: "phase3-fixture", name: "Phase 3 fixture", sourceName: "fixture.geojson", sourceType: "geojson", role: "road", visible: true, opacity: 1,
  featureCount: 2, geometryTypes: ["LineString"], bounds: { west: 110.4, south: 20, east: 110.402, north: 20.001 }, importedAt: "2026-09-21T12:29:51Z",
  provenance: { kind: "osm", builtIn: true },
  features: [
    line("way/1", [[110.4, 20], [110.400001, 20]], { highway: "service" }),
    line("way/2", [[110.401, 20], [110.402, 20]], { highway: "primary" }),
  ],
};
const report = buildRoadQualityReport(layer);
const issue = report.issues[0];

test("workflow preserves immutable discovery and requires a reason for state changes", () => {
  const discovered = materializeRoadIssueWorkOrder(issue, report.datasetId);
  assert.equal(discovered.status, "pending_review");
  assert.equal(discovered.auditTrail[0].kind, "discovered");
  assert.throws(() => updateRoadIssueWorkOrder(issue, report.datasetId, discovered, { status: "rejected", reason: "", manualNote: "", linkedEvidenceIds: [] }, "2026-09-21T13:00:00Z"));
  const rejected = updateRoadIssueWorkOrder(issue, report.datasetId, discovered, { status: "rejected", reason: "现场证据不支持该候选", manualNote: "保留原始规则记录", linkedEvidenceIds: ["photo:2", "photo:1", "photo:1"] }, "2026-09-21T13:00:00Z");
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(rejected.linkedEvidenceIds, ["photo:1", "photo:2"]);
  assert.equal(rejected.auditTrail.length, 2);
  assert.equal(issue.status, "candidate", "source RoadIssue must not be mutated");
  assert.ok(report.issues.includes(issue), "rejecting a work order must not delete the source issue");
});

test("discover-review-field-verify loop keeps a complete timestamped audit trail", () => {
  let record: RoadIssueWorkOrder | undefined;
  record = updateRoadIssueWorkOrder(issue, report.datasetId, record, { status: "accepted", reason: "规则证据成立", manualNote: "先查属性", linkedEvidenceIds: ["insar:1"] }, "2026-09-21T13:00:00Z");
  record = updateRoadIssueWorkOrder(issue, report.datasetId, record, { status: "field_required", reason: "远程资料不足", manualNote: "现场核对方向", linkedEvidenceIds: ["insar:1", "field-photo:1"] }, "2026-09-21T14:00:00Z");
  record = updateRoadIssueWorkOrder(issue, report.datasetId, record, { status: "verified", reason: "现场核查完成", manualNote: "保留原始道路，补录属性", linkedEvidenceIds: ["field-photo:1"] }, "2026-09-21T15:00:00Z");
  assert.deepEqual(record.auditTrail.map(event => event.toStatus), ["pending_review", "accepted", "field_required", "verified"]);
  assert.deepEqual(record.auditTrail.map(event => event.at), [issue.createdAt, "2026-09-21T13:00:00Z", "2026-09-21T14:00:00Z", "2026-09-21T15:00:00Z"]);
});

test("versioned local snapshot rejects corrupt or mismatched lineage", () => {
  const record = updateRoadIssueWorkOrder(issue, report.datasetId, undefined, { status: "accepted", reason: "通过", manualNote: "", linkedEvidenceIds: [] }, "2026-09-21T13:00:00Z");
  const snapshot = makeRoadOpsWorkflowSnapshot(report.datasetId, report.ruleVersion, { [issue.id]: record }, record.updatedAt);
  assert.equal(parseRoadOpsWorkflowSnapshot(JSON.stringify(snapshot), report.datasetId, report.ruleVersion).records[issue.id].status, "accepted");
  assert.deepEqual(parseRoadOpsWorkflowSnapshot("{bad", report.datasetId, report.ruleVersion).records, {});
  assert.deepEqual(parseRoadOpsWorkflowSnapshot(JSON.stringify(snapshot), "other-dataset", report.ruleVersion).records, {});
  assert.match(workflowStorageKey(report.datasetId, report.ruleVersion), /roadops-workflow-v1/);
});

test("review and field exports stay consistent with workflow status", () => {
  const record = updateRoadIssueWorkOrder(issue, report.datasetId, undefined, { status: "field_required", reason: "需要现场确认", manualNote: "检查连接点", linkedEvidenceIds: ["insar:1"] }, "2026-09-21T13:00:00Z");
  const records = { [issue.id]: record };
  const reviewCsv = roadOpsReviewCsv(report, records), fieldCsv = roadOpsFieldCandidatesCsv(report, records), json = roadOpsWorkflowJson(report, records, record.updatedAt);
  assert.match(reviewCsv, new RegExp(issue.id));
  assert.match(reviewCsv, /field_required/);
  assert.match(fieldCsv, /candidate_id/);
  assert.match(fieldCsv, /110\.4/);
  assert.match(json, /No OSM or third-party map write-back/);
  assert.equal(roadWorkOrderStatusCounts(report.issues, records).field_required, 1);
  assert.equal(Object.keys(roadWorkOrderStatusCounts(report.issues, records)).length, ROAD_WORK_ORDER_STATUSES.length);
});

test("change preview is explicitly proposal-only and never fabricates an applied edit", () => {
  const segment = report.segments.find(item => item.id === issue.roadSegmentIds[0]);
  const preview = roadIssueChangePreview(issue, segment);
  assert.ok(preview.length > 0);
  assert.ok(preview.every(item => item.disposition === "proposal_only"));
  assert.match(preview.map(item => item.proposed).join(" "), /待核实|建议|人工|确认|核对|补/);
});

test("Phase 3 UI exposes queue, evidence, audit, refresh persistence and Phase 4 export", () => {
  const panel = readFileSync("app/components/RoadQualityPanel.tsx", "utf8");
  const editor = readFileSync("app/components/RoadIssueWorkflowPanel.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  assert.match(panel, /审核工单队列/);
  assert.match(panel, /localStorage/);
  assert.match(panel, /外业候选 CSV/);
  assert.match(editor, /ROAD_WORK_ORDER_STATUS_LABELS/);
  assert.match(editor, /人工确认多源证据/);
  assert.match(editor, /版本前后差异预览/);
  assert.match(editor, /状态与审核轨迹/);
  assert.match(workspace, /type: "landslide" as const/);
  assert.match(workspace, /type: "field_photo" as const/);
  assert.doesNotMatch(panel + editor, /changeset|api\.openstreetmap\.org/);
});
