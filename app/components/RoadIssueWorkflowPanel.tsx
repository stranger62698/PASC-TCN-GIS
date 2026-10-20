"use client";
import { useMemo, useState } from "react";
import type { RoadIssue, RoadRiskEvidenceInput, RoadSegment } from "../lib/roadops-quality";
import {
  ROAD_WORK_ORDER_STATUSES,
  ROAD_WORK_ORDER_STATUS_LABELS,
  materializeRoadIssueWorkOrder,
  roadIssueChangePreview,
  type RoadIssueWorkOrder,
  type RoadWorkOrderStatus,
  type RoadWorkOrderUpdate,
} from "../lib/roadops-workflow";

type Props = {
  issue: RoadIssue;
  datasetId: string;
  segment: RoadSegment | undefined;
  evidenceInputs: RoadRiskEvidenceInput[];
  defaultEvidenceIds: string[];
  record: RoadIssueWorkOrder | undefined;
  onSave: (update: RoadWorkOrderUpdate) => void;
};

const evidenceLabels: Record<RoadRiskEvidenceInput["type"], string> = {
  insar: "InSAR",
  landslide: "滑坡",
  field_photo: "现场照片",
  gps_trace: "轨迹",
  manual: "人工",
};

export function RoadIssueWorkflowPanel({ issue, datasetId, segment, evidenceInputs, defaultEvidenceIds, record, onSave }: Props) {
  const current = record ?? materializeRoadIssueWorkOrder(issue, datasetId);
  const [status, setStatus] = useState<RoadWorkOrderStatus>(current.status);
  const [reason, setReason] = useState(current.reviewReason);
  const [manualNote, setManualNote] = useState(current.manualNote);
  const [linkedEvidenceIds, setLinkedEvidenceIds] = useState(() => new Set(record?.linkedEvidenceIds ?? defaultEvidenceIds));
  const [error, setError] = useState("");
  const preview = roadIssueChangePreview(issue, segment);
  const orderedEvidence = useMemo(() => [...evidenceInputs].sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)), [evidenceInputs]);

  const submit = (nextStatus: RoadWorkOrderStatus) => {
    try {
      onSave({ status: nextStatus, reason, manualNote, linkedEvidenceIds: [...linkedEvidenceIds] });
      setStatus(nextStatus);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "工单保存失败。");
    }
  };

  return <section className="road-workflow-editor" aria-label="道路问题审核工单">
    <header><div><small>ROADOPS · PHASE 3</small><b>审核工单与证据闭环</b></div><span className={`workflow-status status-${current.status}`}>{ROAD_WORK_ORDER_STATUS_LABELS[current.status]}</span></header>
    <div className="road-workflow-lineage"><span>问题 <b>{issue.id}</b></span><span>对象 <b>{segment?.id ?? issue.featureIds[0] ?? "—"}</b></span><span>规则 <b>{issue.ruleCode} / {issue.ruleVersion}</b></span></div>
    <label className="road-workflow-reason"><span>审核理由 <i>状态变化必填</i></span><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="记录接受、驳回或转外业的依据" rows={2} /></label>
    <label className="road-workflow-note"><span>人工备注</span><textarea value={manualNote} onChange={event => setManualNote(event.target.value)} placeholder="记录现场关注点、待核实字段或补充说明" rows={2} /></label>
    <fieldset className="road-evidence-picker"><legend>人工确认多源证据</legend>{orderedEvidence.length ? <div>{orderedEvidence.map(evidence => <label key={`${evidence.type}:${evidence.id}`}><input type="checkbox" checked={linkedEvidenceIds.has(evidence.id)} onChange={event => setLinkedEvidenceIds(currentIds => { const next = new Set(currentIds); if (event.target.checked) next.add(evidence.id); else next.delete(evidence.id); return next; })} /><span><b>{evidenceLabels[evidence.type]}</b>{evidence.summary}</span></label>)}</div> : <p>当前没有可关联的 InSAR、滑坡或现场照片证据，可先填写人工备注。</p>}</fieldset>
    <div className="road-workflow-actions">{ROAD_WORK_ORDER_STATUSES.map(value => <button type="button" className={value === status ? "is-current" : ""} onClick={() => submit(value)} key={value}>{ROAD_WORK_ORDER_STATUS_LABELS[value]}</button>)}<button type="button" className="save-evidence" onClick={() => submit(status)}>保存证据 / 备注</button></div>
    {error && <p className="road-workflow-error" role="alert">{error}</p>}
    <details className="road-change-preview" open><summary>版本前后差异预览 <small>仅建议，不回写地图</small></summary><div>{preview.map(change => <article key={change.field}><b>{change.field}</b><span><i>当前</i>{change.before}</span><span><i>建议</i>{change.proposed}</span></article>)}</div></details>
    <details className="road-audit-trail"><summary>状态与审核轨迹 · {current.auditTrail.length} 条</summary><ol>{[...current.auditTrail].reverse().map(event => <li key={event.id}><time>{event.at.replace("T", " ").replace(".000Z", "Z")}</time><b>{event.kind === "discovered" ? "发现" : event.kind === "status_changed" ? `${ROAD_WORK_ORDER_STATUS_LABELS[event.fromStatus ?? "pending_review"]} → ${ROAD_WORK_ORDER_STATUS_LABELS[event.toStatus]}` : "证据更新"}</b><span>{event.reason}</span></li>)}</ol></details>
    <p className="road-workflow-boundary">原始规则候选保持不变；驳回不会删除问题，所有操作仅保存在当前浏览器，不自动修改 OSM 或第三方地图。</p>
  </section>;
}
