import type { RoadIssue, RoadQualityReport, RoadSegment } from "./roadops-quality";

export const ROADOPS_WORKFLOW_SCHEMA_VERSION = "roadops-workflow-v1" as const;

export const ROAD_WORK_ORDER_STATUSES = ["pending_review", "accepted", "rejected", "field_required", "verified"] as const;
export type RoadWorkOrderStatus = (typeof ROAD_WORK_ORDER_STATUSES)[number];
export type RoadWorkOrderEventKind = "discovered" | "status_changed" | "evidence_updated";

export const ROAD_WORK_ORDER_STATUS_LABELS: Record<RoadWorkOrderStatus, string> = {
  pending_review: "待审核",
  accepted: "接受",
  rejected: "驳回",
  field_required: "需外业",
  verified: "已核查",
};

export type RoadWorkOrderAuditEvent = {
  id: string;
  kind: RoadWorkOrderEventKind;
  fromStatus: RoadWorkOrderStatus | null;
  toStatus: RoadWorkOrderStatus;
  at: string;
  reason: string;
  manualNote: string;
  linkedEvidenceIds: string[];
};

export type RoadIssueWorkOrder = {
  issueId: string;
  datasetId: string;
  ruleVersion: string;
  status: RoadWorkOrderStatus;
  reviewReason: string;
  manualNote: string;
  linkedEvidenceIds: string[];
  createdAt: string;
  updatedAt: string;
  auditTrail: RoadWorkOrderAuditEvent[];
};

export type RoadOpsWorkflowSnapshot = {
  schemaVersion: typeof ROADOPS_WORKFLOW_SCHEMA_VERSION;
  datasetId: string;
  ruleVersion: string;
  updatedAt: string;
  records: Record<string, RoadIssueWorkOrder>;
};

export type RoadIssueChangePreview = {
  field: string;
  before: string;
  proposed: string;
  disposition: "proposal_only";
};

export type RoadWorkOrderUpdate = {
  status: RoadWorkOrderStatus;
  reason: string;
  manualNote: string;
  linkedEvidenceIds: string[];
};

export type RoadOpsFieldCandidate = {
  candidateId: string;
  issueId: string;
  status: "field_required" | "verified";
  ruleCode: RoadIssue["ruleCode"];
  severity: RoadIssue["severity"];
  segmentId: string;
  featureId: string;
  longitude: number | null;
  latitude: number | null;
  reviewReason: string;
  manualNote: string;
  linkedEvidenceIds: string[];
};

const statusSet = new Set<string>(ROAD_WORK_ORDER_STATUSES);
const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
const uniqueIds = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))].sort();

export function workflowStorageKey(datasetId: string, ruleVersion: string) {
  return `lanjifyw-roadops-workflow:${ROADOPS_WORKFLOW_SCHEMA_VERSION}:${encodeURIComponent(datasetId)}:${encodeURIComponent(ruleVersion)}`;
}

export function materializeRoadIssueWorkOrder(issue: RoadIssue, datasetId: string): RoadIssueWorkOrder {
  return {
    issueId: issue.id,
    datasetId,
    ruleVersion: issue.ruleVersion,
    status: "pending_review",
    reviewReason: "",
    manualNote: "",
    linkedEvidenceIds: [],
    createdAt: issue.createdAt,
    updatedAt: issue.createdAt,
    auditTrail: [{
      id: `${issue.id}:event:0`,
      kind: "discovered",
      fromStatus: null,
      toStatus: "pending_review",
      at: issue.createdAt,
      reason: `由 ${issue.ruleCode} ${issue.ruleVersion} 自动发现，等待人工审核。`,
      manualNote: "",
      linkedEvidenceIds: [],
    }],
  };
}

export function updateRoadIssueWorkOrder(
  issue: RoadIssue,
  datasetId: string,
  current: RoadIssueWorkOrder | undefined,
  update: RoadWorkOrderUpdate,
  now: string,
) {
  if (!statusSet.has(update.status)) throw new Error("工单状态无效。");
  const base = current ?? materializeRoadIssueWorkOrder(issue, datasetId);
  if (base.issueId !== issue.id || base.datasetId !== datasetId || base.ruleVersion !== issue.ruleVersion) throw new Error("工单与当前规则候选的数据血缘不一致。");
  const reason = update.reason.trim(), manualNote = update.manualNote.trim(), linkedEvidenceIds = uniqueIds(update.linkedEvidenceIds);
  const statusChanged = update.status !== base.status;
  const evidenceChanged = linkedEvidenceIds.join("|") !== base.linkedEvidenceIds.join("|") || manualNote !== base.manualNote;
  if (statusChanged && !reason) throw new Error("状态变化必须填写审核理由。");
  if (!statusChanged && !evidenceChanged) return base;
  const event: RoadWorkOrderAuditEvent = {
    id: `${issue.id}:event:${base.auditTrail.length}`,
    kind: statusChanged ? "status_changed" : "evidence_updated",
    fromStatus: base.status,
    toStatus: update.status,
    at: now,
    reason: reason || "更新证据关联或人工备注。",
    manualNote,
    linkedEvidenceIds,
  };
  return {
    ...base,
    status: update.status,
    reviewReason: reason || base.reviewReason,
    manualNote,
    linkedEvidenceIds,
    updatedAt: now,
    auditTrail: [...base.auditTrail, event],
  };
}

export function makeRoadOpsWorkflowSnapshot(datasetId: string, ruleVersion: string, records: Record<string, RoadIssueWorkOrder>, updatedAt: string): RoadOpsWorkflowSnapshot {
  return { schemaVersion: ROADOPS_WORKFLOW_SCHEMA_VERSION, datasetId, ruleVersion, updatedAt, records };
}

export function parseRoadOpsWorkflowSnapshot(raw: string | null, datasetId: string, ruleVersion: string): RoadOpsWorkflowSnapshot {
  const empty = makeRoadOpsWorkflowSnapshot(datasetId, ruleVersion, {}, "");
  if (!raw) return empty;
  try {
    const value = JSON.parse(raw) as Partial<RoadOpsWorkflowSnapshot>;
    if (value.schemaVersion !== ROADOPS_WORKFLOW_SCHEMA_VERSION || value.datasetId !== datasetId || value.ruleVersion !== ruleVersion || !value.records || typeof value.records !== "object") return empty;
    const records: Record<string, RoadIssueWorkOrder> = {};
    Object.entries(value.records).forEach(([issueId, candidate]) => {
      if (!candidate || candidate.issueId !== issueId || candidate.datasetId !== datasetId || candidate.ruleVersion !== ruleVersion || !statusSet.has(candidate.status) || !Array.isArray(candidate.auditTrail)) return;
      records[issueId] = { ...candidate, linkedEvidenceIds: uniqueIds(candidate.linkedEvidenceIds ?? []), auditTrail: candidate.auditTrail.slice(-100) };
    });
    return makeRoadOpsWorkflowSnapshot(datasetId, ruleVersion, records, typeof value.updatedAt === "string" ? value.updatedAt : "");
  } catch {
    return empty;
  }
}

export function roadWorkOrderStatusCounts(issues: RoadIssue[], records: Record<string, RoadIssueWorkOrder>) {
  return Object.fromEntries(ROAD_WORK_ORDER_STATUSES.map(status => [status, issues.filter(issue => (records[issue.id]?.status ?? "pending_review") === status).length])) as Record<RoadWorkOrderStatus, number>;
}

export function roadIssueChangePreview(issue: RoadIssue, segment: RoadSegment | undefined): RoadIssueChangePreview[] {
  const current = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "空值" : String(value);
  const row = (field: string, before: string, proposed: string): RoadIssueChangePreview => ({ field, before, proposed, disposition: "proposal_only" });
  if (!segment) return [row("对象", "未形成标准路段", issue.suggestion)];
  switch (issue.ruleCode) {
    case "R002": return [row("geometry", `${segment.lengthMeters.toFixed(2)} m LineString`, "待核实：合并相邻路段或删除误切分")];
    case "R004": return [row("topology", `${segment.startNodeId} → ${segment.endNodeId}`, "待核实：补齐真实连接，或确认该处确为道路终点")];
    case "R005": return [row("intersection_node", "相交处没有共享节点", "待核实桥隧关系；平面路口补共享节点")];
    case "R007": return [row("highway", current(segment.roadClass), "待依据现场、影像或合规来源补充准确分类")];
    case "R008": {
      const changes: RoadIssueChangePreview[] = [];
      if (!segment.name) changes.push(row("name", "空值", "待核实后补录道路名称"));
      if (segment.maxSpeedKph === null) changes.push(row("maxspeed", "空值", "待核实后补录限速；不使用推测值"));
      if (!segment.surface) changes.push(row("surface", "空值", "待核实后补录路面类型"));
      if (segment.direction === "unknown") changes.push(row("oneway", current(segment.rawTags.oneway), "待核实道路方向"));
      return changes.length ? changes : [row("attributes", "字段完整性仍触发规则", issue.suggestion)];
    }
    case "R009": return [row("oneway", current(segment.rawTags.oneway), "待核实数字化方向与相邻同名道路方向")];
    case "R010": return [row("workflow", "规则候选", "人工确认多源证据后决定是否转外业")];
    default: return [row("geometry", `${segment.geometry.coordinates.length} 个节点`, issue.suggestion)];
  }
}

export function roadOpsReviewCsv(report: RoadQualityReport, records: Record<string, RoadIssueWorkOrder>) {
  const headers = ["issue_id", "rule_code", "severity", "workflow_status", "segment_ids", "feature_ids", "review_reason", "manual_note", "linked_evidence_ids", "updated_at", "audit_event_count"];
  const rows = report.issues.map(issue => {
    const record = records[issue.id] ?? materializeRoadIssueWorkOrder(issue, report.datasetId);
    return [issue.id, issue.ruleCode, issue.severity, record.status, issue.roadSegmentIds.join("|"), issue.featureIds.join("|"), record.reviewReason, record.manualNote, record.linkedEvidenceIds.join("|"), record.updatedAt, record.auditTrail.length];
  });
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function roadOpsFieldCandidatesCsv(report: RoadQualityReport, records: Record<string, RoadIssueWorkOrder>) {
  const headers = ["candidate_id", "issue_id", "status", "rule_code", "severity", "segment_id", "feature_id", "longitude", "latitude", "review_reason", "manual_note", "linked_evidence_ids"];
  const rows = roadOpsFieldCandidates(report, records).map(candidate => [candidate.candidateId, candidate.issueId, candidate.status, candidate.ruleCode, candidate.severity, candidate.segmentId, candidate.featureId, candidate.longitude, candidate.latitude, candidate.reviewReason, candidate.manualNote, candidate.linkedEvidenceIds.join("|")]);
  return [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function roadOpsFieldCandidates(report: RoadQualityReport, records: Record<string, RoadIssueWorkOrder>): RoadOpsFieldCandidate[] {
  const segmentById = new Map(report.segments.map(segment => [segment.id, segment]));
  return report.issues.flatMap(issue => {
    const record = records[issue.id];
    if (!record || (record.status !== "field_required" && record.status !== "verified")) return [];
    const segment = segmentById.get(issue.roadSegmentIds[0]);
    const coordinates = segment?.geometry.coordinates ?? [];
    const point = coordinates[Math.floor((coordinates.length - 1) / 2)] ?? [null, null];
    return [{
      candidateId: `field-${issue.id}`,
      issueId: issue.id,
      status: record.status,
      ruleCode: issue.ruleCode,
      severity: issue.severity,
      segmentId: segment?.id ?? "",
      featureId: issue.featureIds[0] ?? "",
      longitude: typeof point[0] === "number" ? point[0] : null,
      latitude: typeof point[1] === "number" ? point[1] : null,
      reviewReason: record.reviewReason,
      manualNote: record.manualNote,
      linkedEvidenceIds: [...record.linkedEvidenceIds],
    } satisfies RoadOpsFieldCandidate];
  });
}

export function roadOpsWorkflowJson(report: RoadQualityReport, records: Record<string, RoadIssueWorkOrder>, updatedAt: string) {
  return JSON.stringify({
    ...makeRoadOpsWorkflowSnapshot(report.datasetId, report.ruleVersion, records, updatedAt),
    source: { qualitySchemaVersion: report.schemaVersion, issueCount: report.issues.length },
    boundary: "Review state only. No OSM or third-party map write-back is performed.",
  }, null, 2) + "\n";
}
