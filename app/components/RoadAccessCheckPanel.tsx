"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { appendFieldAccessCheck, captureFieldAccessSubject, createFieldAccessLog, evaluateFieldAccessLog, parseFieldAccessLog, FIELD_ACCESS_MAX_REFS, type AccessDimension, type FieldAccessCheck, type FieldAccessEvaluation, type FieldAccessLog, type FieldAccessSlot } from "../lib/roadops-access-check";
import { createFieldAccessStore } from "../lib/roadops-access-store";
import type { FieldTaskPlan } from "../lib/roadops-task-plan";

export type FieldAccessLoadState = { planId: string; log: FieldAccessLog | null; exists: boolean; loading: boolean; saving: boolean; error: string };
const initialState = (planId: string): FieldAccessLoadState => ({ planId, log: null, exists: false, loading: true, saving: false, error: "" });
const errorText = (error: unknown) => error instanceof Error ? error.message : "核验历史未读取或保存成功。原记录和当前表单均保留，请先备份后重试。";

/** This is a local planning guard, not an authenticated permit or supplier access assertion. */
export function fieldAccessPlanningGate(plan: FieldTaskPlan, state: FieldAccessLoadState, options: { assessedAt: string; availableEvidenceIds?: string[]; selectedTaskIds?: string[]; selectedVisitIds?: string[] }): { canPlan: boolean; reason: string; evaluation: FieldAccessEvaluation | null } {
  if (state.planId !== plan.planId || state.loading) return { canPlan: false, reason: "正在读取本机核验历史，暂不能规划。", evaluation: null };
  if (state.saving) return { canPlan: false, reason: "核验记录正在保存，暂不能规划。", evaluation: null };
  if (state.error) return { canPlan: false, reason: state.error, evaluation: null };
  try {
    const evaluation = evaluateFieldAccessLog(plan, state.log ?? createFieldAccessLog(plan.planId), { ...options, availableEvidenceIds: options.availableEvidenceIds ?? [] });
    return { canPlan: evaluation.canPlan, reason: evaluation.canPlan ? "" : "存在未解除的人工禁入记录或任务限制，请先调整行程或补充有效解除依据。", evaluation };
  } catch (error) { return { canPlan: false, reason: errorText(error), evaluation: null }; }
}

/** Reads never become empty history on failure. A fresh read is required at both route gates. */
export function useFieldAccessHistory(planId: string) {
  const [store] = useState(() => createFieldAccessStore());
  const [state, setState] = useState<FieldAccessLoadState>(() => initialState(planId));
  const stateRef = useRef(state), planRef = useRef(planId), mounted = useRef(false), epoch = useRef(0), writeLock = useRef(false);
  const writeSettled = useRef<Promise<unknown> | null>(null);
  useLayoutEffect(() => { planRef.current = planId; }, [planId]);
  const publish = useCallback((next: FieldAccessLoadState) => { stateRef.current = next; if (mounted.current) setState(next); }, []);
  const reload = useCallback(async (): Promise<FieldAccessLoadState> => {
    const token = ++epoch.current;
    const previous = stateRef.current.planId === planId ? stateRef.current : initialState(planId);
    publish({ ...previous, loading: true, error: "" });
    try {
      // A plan switch can outlive a previous plan's write. Wait, then read the new ID;
      // never leave the new plan stuck in the old plan's saving state.
      if (writeSettled.current) await writeSettled.current.catch(() => undefined);
      const log = await store.get(planId);
      const next: FieldAccessLoadState = { planId, log: log ?? createFieldAccessLog(planId), exists: log !== null, loading: false, saving: false, error: "" };
      if (token === epoch.current && planRef.current === planId) publish(next);
      return next;
    } catch (error) {
      const next: FieldAccessLoadState = { ...previous, loading: false, saving: false, error: errorText(error) };
      if (token === epoch.current && planRef.current === planId) publish(next);
      return next;
    }
  }, [planId, publish, store]);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(() => { if (mounted.current && planRef.current === planId) return reload(); }).catch(error => {
      if (mounted.current && planRef.current === planId) publish({ ...initialState(planId), loading: false, error: errorText(error) });
    });
    return () => { mounted.current = false; epoch.current += 1; };
  }, [planId, reload, publish]);
  const append = useCallback(async (check: FieldAccessCheck) => {
    const current = stateRef.current;
    if (writeLock.current || current.planId !== planId || current.loading || current.saving || current.error) throw new Error("请先重新读取本计划的核验历史；当前表单保留。");
    const next = appendFieldAccessCheck(current.log ?? createFieldAccessLog(planId), check);
    writeLock.current = true; epoch.current += 1;
    publish({ ...current, saving: true });
    try {
      const operation = store.save(next, current.exists ? current.log!.revision : null);
      writeSettled.current = operation;
      const saved = await operation;
      if (planRef.current === planId) publish({ planId, log: saved, exists: true, loading: false, saving: false, error: "" });
    } catch (error) {
      if (planRef.current === planId) publish({ ...current, saving: false, error: errorText(error) });
      throw error;
    } finally { writeLock.current = false; writeSettled.current = null; }
  }, [planId, publish, store]);
  return { state, append, reload };
}

const dimensionLabels: Record<AccessDimension, string> = { vehicle_approach: "车辆接近", parking_permission: "停车许可", entrance_permission: "入口许可", last_mile: "停靠点至核查目标" };
const statusLabels = { unknown: "未核验", needs_review: "待复核", confirmed_with_limits: "人工确认 · 有期限", blocked: "人工限制未解除" };
const sourceLabels = { user_statement: "人工声明", field_observation: "现场观察", authority_notice: "管理方通知", other: "其他依据" };
const coordinateText = (coordinate: [number, number] | null) => coordinate ? coordinate.map(value => value.toFixed(6)).join(", ") : "未指定";
function subjectLabel(plan: FieldTaskPlan, slot: Pick<FieldAccessSlot, "subject">) {
  if (slot.subject.kind === "vehicle_stop") {
    const stopId = slot.subject.stopId;
    const names = plan.visits.filter(visit => visit.stopId === stopId).map(visit => visit.role === "origin" ? "出发地" : visit.role === "destination" ? plan.tripMode === "return_to_start" ? "返程" : "终点" : `停靠 ${plan.visits.indexOf(visit)}`);
    return names.join(" / ") || "历史停车点";
  }
  const taskId = slot.subject.taskId;
  return plan.tasks.find(task => task.taskId === taskId)?.name ?? "历史核查任务";
}
export function fieldAccessShanghaiInput(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
export function fieldAccessShanghaiUtc(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("请输入完整的中国标准时间。");
  const date = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(date.getTime()) || fieldAccessShanghaiInput(date.toISOString()) !== value) throw new Error("日期或时刻无效。");
  return date.toISOString();
}
const displayTime = (value: string | null) => value ? `${fieldAccessShanghaiInput(value).replace("T", " ")} UTC+8` : "未填写";

type FormProps = { plan: FieldTaskPlan; slot: FieldAccessSlot; disabled: boolean; onAppend: (check: FieldAccessCheck) => Promise<void>; onDirty: (dirty: boolean) => void; onPending: (check: FieldAccessCheck | null) => void };
function AccessForm({ plan, slot, disabled, onAppend, onDirty, onPending }: FormProps) {
  const [snapshot] = useState(() => captureFieldAccessSubject(plan, slot.subject, slot.dimension));
  const [status, setStatus] = useState<FieldAccessCheck["status"]>("unknown"), [reviewer, setReviewer] = useState("");
  const [checkedAt, setCheckedAt] = useState(() => fieldAccessShanghaiInput(new Date().toISOString())), [validUntil, setValidUntil] = useState("");
  const [source, setSource] = useState<FieldAccessCheck["source"]>("user_statement"), [basis, setBasis] = useState(""), [releaseIds, setReleaseIds] = useState<string[]>([]);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false);
  const lock = useRef(false), dirty = useRef(false);
  const currentSnapshot = captureFieldAccessSubject(plan, slot.subject, slot.dimension);
  const moved = JSON.stringify(snapshot) !== JSON.stringify(currentSnapshot);
  function changed() { dirty.current = true; onDirty(true); onPending(null); setError(""); }
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => { window.removeEventListener("beforeunload", warn); onDirty(false); }; }, [onDirty]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current || disabled) return;
    if (moved) { setError("停车点或目标已改变，当前依据仍绑定原坐标。请先备份，再重置表单重新核验。"); return; }
    try {
      dirty.current = true; onDirty(true);
      const check: FieldAccessCheck = { checkId: `check-${globalThis.crypto.randomUUID()}`, subject: slot.subject, dimension: slot.dimension, status, coordinateSnapshot: snapshot, reviewer: reviewer.trim(), checkedAt: fieldAccessShanghaiUtc(checkedAt), validUntil: fieldAccessShanghaiUtc(validUntil), source, basis: basis.trim(), evidenceRefs: [], releaseBlockedCheckIds: status === "confirmed" ? releaseIds : [], recordedAt: new Date().toISOString() };
      onPending(check); lock.current = true; setSaving(true); setError("");
      await onAppend(check);
      dirty.current = false; onDirty(false); onPending(null); setBasis(""); setReviewer(""); setStatus("unknown"); setValidUntil(""); setReleaseIds([]); setCheckedAt(fieldAccessShanghaiInput(new Date().toISOString()));
    } catch (failure) { setError(errorText(failure)); }
    finally { lock.current = false; setSaving(false); }
  }
  const required = status === "confirmed" || status === "blocked";
  return <form className="road-access-form" onSubmit={event => void save(event)}><fieldset disabled={disabled || saving}><legend>{subjectLabel(plan, slot)} · {dimensionLabels[slot.dimension]}</legend>
    <p className="road-navigation-help">车辆 {coordinateText(snapshot.vehicleCoordinate)} · 目标 {coordinateText(snapshot.targetCoordinate)}（WGS84）。核验仅对所记录的位置和期限有效。</p>
    <div className="road-access-fields"><label>核验状态<select aria-label="人工核验状态" value={status} onChange={event => { changed(); setStatus(event.target.value as FieldAccessCheck["status"]); }}><option value="unknown">未核验</option><option value="needs_review">待复核</option><option value="confirmed">人工确认 · 限期有效</option><option value="blocked">明确限制 / 禁入</option></select></label><label>核验人<input aria-label="核验人" maxLength={200} value={reviewer} required={required} onChange={event => { changed(); setReviewer(event.target.value); }} /></label>
      <label>核验时间（UTC+8）<input aria-label="核验时间" type="datetime-local" value={checkedAt} required={required} onChange={event => { changed(); setCheckedAt(event.target.value); }} /></label><label>有效至（确认必填）<input aria-label="核验有效至" type="datetime-local" value={validUntil} required={status === "confirmed"} onChange={event => { changed(); setValidUntil(event.target.value); }} /></label></div>
    <label>依据来源<select aria-label="核验依据来源" value={source} onChange={event => { changed(); setSource(event.target.value as FieldAccessCheck["source"]); }}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label>核验依据与限制<textarea aria-label="人工核验依据" rows={3} maxLength={4000} value={basis} required={required} placeholder={slot.dimension === "last_mile" ? "说明停车后进入方式、通行限制及人工估计时间；不会生成步行路线或自动计入排程。" : "记录现场情况或管理方许可范围，不将道路路线作为许可依据。"} onChange={event => { changed(); setBasis(event.target.value); }} /></label>
    {slot.activeBlockedCheckIds.length > 0 && <><p className="road-navigation-help">已有人工限制 {slot.activeBlockedCheckIds.length} 条；普通更新不会解除。解除依据过期或位置变化后，原限制仍保留。每次最多引用 {FIELD_ACCESS_MAX_REFS} 条，剩余限制须继续补充依据。</p>{status === "confirmed" && <label className="road-access-consent"><input type="checkbox" checked={releaseIds.length > 0} onChange={event => { changed(); setReleaseIds(event.target.checked ? slot.activeBlockedCheckIds.slice(0, FIELD_ACCESS_MAX_REFS) : []); }} />本次依据明确解除所选 {releaseIds.length || Math.min(slot.activeBlockedCheckIds.length, FIELD_ACCESS_MAX_REFS)} 条人工限制；新增限制不自动列入</label>}</>}
    {moved && <p role="alert">坐标已改变，请重置表单后重新核验。</p>}
    <button type="submit" disabled={moved}>{saving ? "正在保存…" : "追加核验记录"}</button>
  </fieldset>{error && <p className="road-navigation-message is-error" role="alert">{error}</p>}</form>;
}

type Props = { plan: FieldTaskPlan; state: FieldAccessLoadState; stored: boolean; disabled?: boolean; assessedAt: string; onAppend: (check: FieldAccessCheck) => Promise<void>; onReload: () => Promise<unknown>; onDirty: (dirty: boolean) => void };
export function RoadAccessCheckPanel({ plan, state, stored, disabled = false, assessedAt, onAppend, onReload, onDirty }: Props) {
  const gate = useMemo(() => fieldAccessPlanningGate(plan, state, { assessedAt }), [plan, state, assessedAt]);
  const [selectedKey, setSelectedKey] = useState(""), [formVersion, setFormVersion] = useState(0), [formDirty, setFormDirty] = useState(false);
  const [consent, setConsent] = useState(false), [pending, setPending] = useState<{ planId: string; check: FieldAccessCheck } | null>(null), [backupError, setBackupError] = useState("");
  const historyMatches = state.planId === plan.planId && (!state.log || state.log.planId === plan.planId);
  // Keep the same form mounted during reads, saves and failures; never discard unsaved basis.
  const retainedEvaluation = useMemo(() => {
    if (gate.evaluation) return gate.evaluation;
    if (state.planId !== plan.planId || !state.log) return null;
    try { return evaluateFieldAccessLog(plan, state.log, { assessedAt, availableEvidenceIds: [] }); } catch { return null; }
  }, [gate.evaluation, plan, state.planId, state.log, assessedAt]);
  const slots = retainedEvaluation?.slots ?? [];
  const selected = slots.find(slot => slot.key === selectedKey) ?? slots[0];
  const dirtyCallback = useCallback((value: boolean) => { setFormDirty(value); onDirty(value); }, [onDirty]);
  const pendingCallback = useCallback((check: FieldAccessCheck | null) => setPending(check ? { planId: plan.planId, check } : null), [plan.planId]);
  function discard(): boolean { return !formDirty || window.confirm("当前核验表单未保存。确认放弃表单内容？已保存历史不会删除。"); }
  function reset() { if (discard()) { dirtyCallback(false); setPending(null); setFormVersion(value => value + 1); } }
  function exportHistory() {
    if (!consent || !historyMatches) return;
    try {
      let log = parseFieldAccessLog(state.log ?? createFieldAccessLog(plan.planId));
      if (formDirty) {
        if (!pending || pending.planId !== plan.planId) throw new Error("表单尚未形成有效记录，请先点击追加核验记录完成校验；未成功保存的有效记录可包含在备份中。");
        log = appendFieldAccessCheck(log, pending.check);
      }
      const blob = new Blob([JSON.stringify(parseFieldAccessLog(log), null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = "field-access-history.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setBackupError("");
    } catch (error) { setBackupError(errorText(error)); }
  }
  const summary = !gate.canPlan && gate.evaluation
    ? formDirty ? "有通行限制，核验内容也尚未保存" : "有未解除的通行限制，暂不能规划"
    : formDirty ? "有未保存的核验内容，请展开继续"
    : state.saving ? "正在保存核验记录"
    : !historyMatches || state.loading ? "正在读取核验记录"
    : state.error || !gate.evaluation ? "核验记录需处理，请展开查看"
    : !stored ? "保存行程后，可核验停车与进入条件"
    : gate.evaluation.status === "confirmed_with_limits" ? "已有期限内人工确认，出发前仍需复核"
    : gate.evaluation.status === "needs_review" ? "部分记录待复核，请展开查看"
    : "停车与进入条件尚未核验";
  return <details className="road-access-panel" aria-label="通行与入口核验"><summary>通行与入口核验 <span>{summary}</span></summary>
    <p className="road-navigation-help">分别核对车辆接近、停车和进入条件。</p>
    {!gate.canPlan && <p className="road-navigation-message is-error" role="alert">{gate.reason}</p>}
    {slots.length > 0 && <><label className="road-access-selector">核验对象<select aria-label="核验对象与项目" disabled={disabled || state.saving} value={selected?.key ?? ""} onChange={event => { if (!discard()) return; dirtyCallback(false); setPending(null); setSelectedKey(event.target.value); setFormVersion(value => value + 1); }}>{slots.map(slot => <option key={slot.key} value={slot.key}>{subjectLabel(plan, slot)} · {dimensionLabels[slot.dimension]} · {statusLabels[slot.status]}</option>)}</select></label><details className="road-access-overview"><summary>核验项目总览 · {slots.length} 项</summary><ul className="road-access-slots">{slots.map(slot => <li key={slot.key}><button type="button" disabled={disabled || state.saving} aria-pressed={selected?.key === slot.key} onClick={() => { if (slot.key === selected?.key || !discard()) return; dirtyCallback(false); setPending(null); setSelectedKey(slot.key); setFormVersion(value => value + 1); }}><span>{subjectLabel(plan, slot)} · {dimensionLabels[slot.dimension]}</span><small>{statusLabels[slot.status]}</small></button><p>{slot.reason}</p></li>)}</ul></details></>}
    {!stored && <p className="road-navigation-help">请先保存任务草稿，再新增核验。</p>}
    {stored && selected && <><AccessForm key={`${plan.planId}:${selected.key}:${formVersion}`} plan={plan} slot={selected} disabled={disabled || state.loading || state.saving || Boolean(state.error)} onAppend={onAppend} onDirty={dirtyCallback} onPending={pendingCallback} /><button type="button" disabled={disabled || state.saving} onClick={reset}>重置核验表单</button></>}
    <div className="road-task-draft-actions"><button type="button" disabled={disabled || state.loading || state.saving} onClick={() => void onReload().catch(error => setBackupError(errorText(error)))}>重新读取核验历史</button></div>
    <details className="road-access-history"><summary>只读核验历史与备份 · {historyMatches ? state.log?.checks.length ?? 0 : 0} 条</summary>
      {historyMatches && state.log?.checks.slice(-20).reverse().map(check => <article key={check.checkId}><strong>{subjectLabel(plan, check)} · {dimensionLabels[check.dimension]} · {check.status === "confirmed" ? "人工确认" : check.status === "blocked" ? "人工限制" : check.status === "needs_review" ? "待复核" : "未核验"}</strong><p>{sourceLabels[check.source]} · {check.reviewer || "未填写核验人"} · {displayTime(check.checkedAt)}</p><p>有效至 {displayTime(check.validUntil)} · 车辆 {coordinateText(check.coordinateSnapshot.vehicleCoordinate)} · 目标 {coordinateText(check.coordinateSnapshot.targetCoordinate)}</p><p className="road-access-basis">{check.basis || "未填写依据"}</p>{check.releaseBlockedCheckIds.length > 0 && <small>本条显式引用解除 {check.releaseBlockedCheckIds.length} 条人工限制，是否生效以当前复核为准。</small>}</article>)}
      {historyMatches && (state.log?.checks.length ?? 0) > 20 && <p className="road-navigation-help">显示最近 20 条；完整历史保留在本机，可通过 JSON 备份查看。</p>}
      {Boolean(gate.evaluation?.orphanedCheckIds.length) && <p className="road-navigation-help">部分历史对象已移除，原记录保留但不套用到新任务。</p>}
      <label className="road-access-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />确认备份含精确坐标、核验人及个人备注</label><button type="button" disabled={!consent || state.loading || state.saving || !historyMatches} onClick={exportHistory}>导出核验历史 JSON</button>
      <details className="road-navigation-help"><summary>核验与保存说明</summary>
        <p>车辆接近、停车许可、入口许可和最后一段进入分别记录。仅为人工依据，不代表地图商核检、实时封路数据或出发许可；道路算路成功不会自动确认可达。</p>
        {gate.evaluation?.status === "confirmed_with_limits" && <p>当前人工记录在期限及坐标范围内有效，仍需出发前复核；不承诺安全、实时通行或停车合法性。</p>}
        <p>另存副本或导入任务会生成新计划，不继承原核验；核验记录需单独备份。</p>
        <p>仅保存在此浏览器，不随账号同步；不含照片、地图商路线或路况。历史仅追加，不能直接改写或删除；当前仅支持导出核验备份。</p>
      </details>
    </details>
    {backupError && <p className="road-navigation-message is-error" role="alert">{backupError}</p>}
  </details>;
}
