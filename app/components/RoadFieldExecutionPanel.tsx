"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { FieldTaskCandidate } from "../lib/roadops-task-candidates";
import { createFieldExecutionRecord, createFieldExecutionStore, type FieldExecutionRecord } from "../lib/roadops-task-execution";
import { fieldAccessShanghaiUtc } from "./RoadAccessCheckPanel";

export type FieldEvidenceOption = { id: string; label: string };
type Props = {
  planId: string; candidate: FieldTaskCandidate | null; disabled: boolean;
  evidenceOptions: FieldEvidenceOption[]; taskNames: Record<string, string>;
};

function ExecutionForm({ candidate, evidenceOptions, disabled, onSaved }: Omit<Props, "planId" | "taskNames"> & { candidate: FieldTaskCandidate; onSaved: (record: FieldExecutionRecord) => void }) {
  const tasks = candidate.report.visits.flatMap(visit => visit.tasks.map(task => ({ ...task, visitId: visit.visitId })));
  const [taskId, setTaskId] = useState(tasks[0]?.taskId ?? "");
  const [status, setStatus] = useState<"completed" | "incomplete">("completed");
  const [start, setStart] = useState(""), [end, setEnd] = useState(""), [actual, setActual] = useState("");
  const [reason, setReason] = useState(""), [refs, setRefs] = useState<string[]>([]), [error, setError] = useState("");
  const task = tasks.find(value => value.taskId === taskId);
  function save(event: FormEvent) {
    event.preventDefault();
    try {
      if (!task) throw new Error("请先选择本次执行的任务。");
      const actualStart = fieldAccessShanghaiUtc(start), actualEnd = fieldAccessShanghaiUtc(end);
      const actualMinutes = actualStart && actualEnd ? (Date.parse(actualEnd) - Date.parse(actualStart)) / 60000 : actual.trim() ? Number(actual) : null;
      const record = createFieldExecutionRecord(candidate, {
        recordId: `execution-${globalThis.crypto.randomUUID()}`, taskId, visitId: task.visitId, status,
        actualStart, actualEnd, actualMinutes, reason, evidenceRefs: refs, recordedAt: new Date().toISOString(),
      }, { availableEvidenceIds: evidenceOptions.map(value => value.id) });
      const saved = createFieldExecutionStore().save(record);
      onSaved(saved); setError(""); setStart(""); setEnd(""); setActual(""); setReason(""); setRefs([]);
    } catch (value) { setError(value instanceof Error ? value.message : "执行记录未保存。"); }
  }
  return <form onSubmit={save} className="road-execution-form"><fieldset disabled={disabled} className="road-navigation-form"><legend className="road-navigation-sr-only">记录现场结果</legend>
    <label>本次任务<select aria-label="执行记录任务" value={taskId} onChange={event => setTaskId(event.target.value)}>{tasks.map(value => <option key={value.taskId} value={value.taskId}>{value.name}</option>)}</select></label>
    <label>现场结果<select aria-label="执行记录状态" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="completed">已完成</option><option value="incomplete">未完成</option></select></label>
    <div className="road-field-schedule-inputs"><label>实际开始<input aria-label="实际开始" type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></label><label>实际结束<input aria-label="实际结束" type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></label></div>
    <label>实际耗时（分钟）<input aria-label="实际耗时" type="number" min="0" max="43200" step="0.1" placeholder="未填写为未知" disabled={!!start && !!end} value={actual} onChange={event => setActual(event.target.value)} /></label>
    {task && <small>时刻为北京时间。计划停留 {task.dwellMinutes} 分钟；填写起止时刻后自动计算实际耗时。</small>}
    <label>{status === "incomplete" ? "未完成原因（必填）" : "现场备注"}<textarea aria-label="执行记录原因" required={status === "incomplete"} rows={2} maxLength={4000} value={reason} onChange={event => setReason(event.target.value)} /></label>
    <details><summary>关联已有照片 · 已选 {refs.length}</summary>{evidenceOptions.length ? evidenceOptions.map(value => <label className="road-navigation-optimize" key={value.id}><input type="checkbox" checked={refs.includes(value.id)} onChange={event => setRefs(current => event.target.checked ? [...current, value.id] : current.filter(id => id !== value.id))} />{value.label}</label>) : <p>请先在外业记录中添加照片，再关联到任务。</p>}</details>
    <button type="submit">保存执行记录</button>
  </fieldset>{error && <p className="road-navigation-message is-error" role="alert">{error}</p>}</form>;
}

export function RoadFieldExecutionPanel({ planId, candidate, disabled, evidenceOptions, taskNames }: Props) {
  const [records, setRecords] = useState<FieldExecutionRecord[]>([]), [error, setError] = useState(""), [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try { setRecords(createFieldExecutionStore().list(planId)); setError(""); } catch (value) { setError(value instanceof Error ? value.message : "无法读取执行记录。"); }
      setMessage("");
    });
    return () => { cancelled = true; };
  }, [planId]);
  function saved(record: FieldExecutionRecord) { setRecords(current => [record, ...current.filter(value => value.recordId !== record.recordId)]); setMessage("执行记录已保存到本机。"); }
  return <details className="road-field-plan road-field-execution" aria-label="现场执行记录"><summary>现场执行记录 · {records.length} 条</summary>
    {candidate && candidate.report.selectedTaskIds.length > 0 ? <ExecutionForm key={candidate.candidateId} candidate={candidate} disabled={disabled} evidenceOptions={evidenceOptions} onSaved={saved} /> : <p>生成并采用方案后，可逐项记录现场结果。</p>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
    {records.length > 0 && <ol className="road-execution-history">{records.map(record => <li key={record.recordId}><strong>{taskNames[record.taskId] ?? record.taskId} · {record.status === "completed" ? "已完成" : "未完成"}</strong><p>实际 {record.actualMinutes === null ? "耗时未知" : `${Number(record.actualMinutes.toFixed(1))} 分钟`} · 照片 {record.evidenceRefs.length} 项</p>{record.reason && <p>{record.reason}</p>}<small>版本 {record.revision} · {new Date(record.recordedAt).toLocaleString("zh-CN")} · {record.candidateId}</small></li>)}</ol>}
    <p className="road-navigation-help">记录保存在本机，完成状态需人工确认。计划耗时与实际耗时可用于下次调整停留。</p>
  </details>;
}
