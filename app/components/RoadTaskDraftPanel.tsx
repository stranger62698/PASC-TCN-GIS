"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createNavigationDraft, type NavigationDraft } from "../lib/roadops-navigation";
import {
  createFieldTaskPlan, fieldTaskPlanToNavigationDraft, parseFieldTaskPlan,
  serializeFieldTaskPlan, updateFieldTaskPlan, prepareFieldTaskPlanRestore, FIELD_TASK_PLAN_MAX_BYTES, type FieldTaskPlan,
} from "../lib/roadops-task-plan";
import { createFieldTaskStore } from "../lib/roadops-task-store";
import { requireAccountSession, useAccountSession } from "../lib/account-session";
import { buildLoginContinuationHref } from "../lib/local-analysis-session";

const CHANNEL = "lanjifyw-field-task-drafts";
const defaultName = "未命名外业任务";
const signature = (draft: NavigationDraft, name: string) => JSON.stringify({ draft, name });
const taskSignature = (plan: FieldTaskPlan, name: string) => JSON.stringify({ ...plan, planId: undefined, revision: undefined, createdAt: undefined, updatedAt: undefined, name });
const newId = () => `field-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : "草稿操作未完成；当前输入仍保留，请导出备份。";
function notifyOtherWindows(writerId: string, planId: string, revision: number | null) {
  if (typeof BroadcastChannel === "undefined") return;
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ writerId, planId, revision });
  } catch { /* Optional notification only; the IndexedDB revision transaction remains authoritative. */ }
  finally { channel?.close(); }
}
type Confirmation = { kind: "restore" | "delete"; plan: FieldTaskPlan } | { kind: "new" } | { kind: "import"; plan: FieldTaskPlan };

/** Only user-authored task data crosses this component's storage boundary. */
export function RoadTaskDraftPanel({ draft, disabled, onRestore, taskPlan, initialSavedPlan, onRestoreTaskPlan, onTaskPlanSaved, onStorageBusy }: {
  draft: NavigationDraft; disabled: boolean; onRestore: (draft: NavigationDraft) => void;
  taskPlan?: FieldTaskPlan; initialSavedPlan?: FieldTaskPlan; onRestoreTaskPlan?: (plan: FieldTaskPlan, saved?: boolean) => void; onTaskPlanSaved?: (plan: FieldTaskPlan) => void; onStorageBusy?: (busy: boolean) => void;
}) {
  const account = useAccountSession();
  const store = useMemo(() => createFieldTaskStore(), []);
  const [writerId] = useState(newId);
  const [plans, setPlans] = useState<FieldTaskPlan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [current, setCurrent] = useState<FieldTaskPlan | null>(initialSavedPlan ?? null);
  const [name, setName] = useState(taskPlan?.name ?? defaultName);
  const [savedSignature, setSavedSignature] = useState(initialSavedPlan && taskPlan ? taskSignature(taskPlan, taskPlan.name) : "");
  const [ioBusy, setIoBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [includeNotes, setIncludeNotes] = useState(false);
  const [selectedId, setSelectedId] = useState(initialSavedPlan?.planId ?? "");
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const writeLock = useRef(false);
  const mounted = useRef(false);
  const storageBusyCallback = useRef(onStorageBusy);
  useLayoutEffect(() => { storageBusyCallback.current = onStorageBusy; }, [onStorageBusy]);
  const setStorageBusy = useCallback((busy: boolean) => { setIoBusy(busy); storageBusyCallback.current?.(busy); }, []);
  const currentSignature = taskPlan ? taskSignature(taskPlan, name) : signature(draft, name);
  const latestEditor = useRef({ signature: currentSignature, disabled });
  useLayoutEffect(() => { latestEditor.current = { signature: currentSignature, disabled }; }, [currentSignature, disabled]);
  const changed = current ? currentSignature !== savedSignature : taskPlan ? true : currentSignature !== signature(createNavigationDraft(), defaultName);
  const selected = plans.find(plan => plan.planId === selectedId) ?? null;
  const controlsDisabled = disabled || ioBusy;

  const readList = useCallback(async () => {
    const records = await store.list();
    if (mounted.current) { setPlans(records); setLoaded(true); }
  }, [store]);
  useEffect(() => {
    mounted.current = true;
    void readList().catch(cause => { if (mounted.current) { setLoaded(true); setError(messageOf(cause)); } });
    return () => { mounted.current = false; storageBusyCallback.current?.(false); };
  }, [readList]);
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    let channel: BroadcastChannel;
    try { channel = new BroadcastChannel(CHANNEL); } catch { return; }
    channel.onmessage = event => {
      if (!event.data || event.data.writerId === writerId) return;
      void readList().catch(cause => { if (mounted.current) setError(messageOf(cause)); });
      if (current && current.planId === event.data.planId && current.revision !== event.data.revision) {
        setError("此草稿已在其他窗口修改或删除，自动保存已暂停。请先导出当前输入，再恢复最新版本或另存为新草稿。");
      }
    };
    return () => channel.close();
  }, [current, readList, writerId]);
  useEffect(() => {
    if (!changed && !ioBusy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed, ioBusy]);

  function announce(planId: string, revision: number | null) {
    notifyOtherWindows(writerId, planId, revision);
  }
  const taskInput = useCallback((now: string, copy = false) => {
    if (!taskPlan) return current && !copy ? updateFieldTaskPlan(current, draft, name, now) : createFieldTaskPlan(draft, { planId: newId(), name, now });
    return parseFieldTaskPlan({ ...taskPlan, name, planId: current && !copy ? current.planId : newId(),
      revision: current && !copy ? current.revision : 1, createdAt: current && !copy ? current.createdAt : now, updatedAt: now });
  }, [taskPlan, current, draft, name]);
  const persist = useCallback(async (copy: boolean) => {
    if (disabled || writeLock.current) return;
    writeLock.current = true;
    setStorageBusy(true); setError(""); setNotice("");
    const inputSignature = taskPlan ? taskSignature(taskPlan, name) : signature(draft, name);
    try {
      const now = new Date().toISOString();
      const input = taskInput(now, copy);
      const saved = await store.save(input, current && !copy ? current.revision : null);
      if (!mounted.current) return;
      setCurrent(saved); setSavedSignature(inputSignature); setSelectedId(saved.planId);
      if (taskPlan && latestEditor.current.signature === inputSignature) onTaskPlanSaved?.(saved);
      setNotice(`已保存在此浏览器 · 版本 ${saved.revision}。`);
      notifyOtherWindows(writerId, saved.planId, saved.revision);
      await readList();
    } catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { writeLock.current = false; if (mounted.current) setStorageBusy(false); }
  }, [current, disabled, draft, name, taskPlan, taskInput, onTaskPlanSaved, readList, store, writerId, setStorageBusy]);
  useEffect(() => {
    if (!current || !changed || !loaded || controlsDisabled || error || confirmation) return;
    const timer = window.setTimeout(() => { void persist(false); }, 800);
    return () => window.clearTimeout(timer);
  }, [current, changed, loaded, controlsDisabled, error, confirmation, persist]);

  function exportDraft() {
    try {
      const now = new Date().toISOString();
      const input = taskInput(now);
      const text = serializeFieldTaskPlan(input, { includeNotes });
      const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `外业草稿-${now.slice(0, 10)}.json`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setNotice("备份已开始下载。");
    } catch (cause) { setError(messageOf(cause)); }
  }
  async function importDraft(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    await importFile(file);
  }
  async function importFile(file?: File) {
    if (!file || controlsDisabled || writeLock.current) return;
    setPendingImport(file);
    writeLock.current = true; setStorageBusy(true); setError("");
    try {
      const user = await requireAccountSession();
      if (!mounted.current) return;
      if (!user) { setError("请在新标签页登录，再回来重试导入；已选择的任务 JSON 保留，尚未读取。"); return; }
      setPendingImport(null);
      if (file.size > FIELD_TASK_PLAN_MAX_BYTES) throw new Error("任务文件超过 1 MiB，未读取或覆盖任何草稿。");
      const input = parseFieldTaskPlan(JSON.parse((await file.text()).replace(/^\uFEFF/, "")));
      if (!onRestoreTaskPlan) fieldTaskPlanToNavigationDraft(input);
      if (mounted.current) setConfirmation({ kind: "import", plan: input });
    } catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { writeLock.current = false; if (mounted.current) setStorageBusy(false); }
  }
  async function confirmAction() {
    if (!confirmation || controlsDisabled || writeLock.current) return;
    const confirmedSignature = currentSignature;
    writeLock.current = true; setStorageBusy(true); setError("");
    try {
      if (confirmation.kind === "import") {
        const user = await requireAccountSession();
        if (!mounted.current) return;
        if (!user) { setError("请重新登录后确认导入；当前任务与待导入副本已保留。"); return; }
      }
      if (confirmation.kind === "new") {
        if (taskPlan && onRestoreTaskPlan) onRestoreTaskPlan(createFieldTaskPlan(createNavigationDraft(), { planId: newId(), name: defaultName, now: new Date().toISOString() }), false);
        else onRestore(createNavigationDraft());
        setCurrent(null); setName(defaultName); setSavedSignature("");
        setNotice("已新建行程；保存过的草稿仍保留。");
      } else if (confirmation.kind === "delete") {
        await store.remove(confirmation.plan.planId, confirmation.plan.revision);
        announce(confirmation.plan.planId, null);
        if (!mounted.current) return;
        if (current?.planId === confirmation.plan.planId) { setCurrent(null); setSavedSignature(""); }
        setSelectedId(""); setNotice("已删除所选草稿；当前行程与照片保留。");
        await readList();
      } else {
        let target = confirmation.plan;
        if (confirmation.kind === "restore") {
          const fresh = await store.get(target.planId);
          if (!fresh) throw new Error("所选草稿已不存在，当前输入未改变。");
          if (fresh.revision !== target.revision) throw new Error("所选草稿已更新，请刷新列表后重新确认恢复。");
          target = fresh;
        }
        let restored: NavigationDraft | null = null;
        const restoredTask = prepareFieldTaskPlanRestore(target);
        if (!taskPlan) {
          try { restored = fieldTaskPlanToNavigationDraft(target); }
          catch (cause) { if (!onRestoreTaskPlan) throw cause; }
        }
        if (confirmation.kind === "import") {
          const now = new Date().toISOString();
          const imported = parseFieldTaskPlan({ ...restoredTask, planId: newId(), revision: 1, createdAt: now, updatedAt: now });
          target = await store.save(imported, null);
          announce(target.planId, target.revision);
        }
        if (!mounted.current) return;
        if (latestEditor.current.signature !== confirmedSignature || latestEditor.current.disabled) {
          await readList();
          throw new Error(confirmation.kind === "import"
            ? "导入副本已保存，但等待期间编辑区发生变化或正在算路，未替换当前输入。请从草稿列表恢复副本。"
            : "等待期间编辑区发生变化或正在算路，未替换当前输入。请重新确认恢复。");
        }
        const fullRestore = prepareFieldTaskPlanRestore(target);
        if (taskPlan || !restored) {
          if (!onRestoreTaskPlan) throw new Error("当前编辑器无法恢复此任务模型，数据已保留。");
          onRestoreTaskPlan(fullRestore);
          setSavedSignature(taskSignature(fullRestore, target.name));
        } else { onRestore(restored); setSavedSignature(signature(restored, target.name)); }
        setCurrent(target); setName(target.name); setSelectedId(target.planId);
        setNotice("已恢复任务；请复核通行条件后重新规划。");
        await readList();
      }
      if (mounted.current) setConfirmation(null);
    } catch (cause) { if (mounted.current) setError(messageOf(cause)); }
    finally { writeLock.current = false; if (mounted.current) setStorageBusy(false); }
  }

  return <details className="road-task-drafts" open>
    <summary><span>任务草稿</span><span className="road-task-drafts-state">{ioBusy ? "处理中" : error ? "需处理" : current ? changed ? "待保存" : `已保存 · v${current.revision}` : "尚未保存"}</span></summary>
    <div className="road-task-drafts-body">
      <label htmlFor="road-task-name">任务名称<input id="road-task-name" maxLength={120} value={name} disabled={controlsDisabled || Boolean(confirmation)} onChange={event => setName(event.target.value)} /></label>
      <div className="road-task-draft-actions">
        <button type="button" className="is-primary" disabled={controlsDisabled || Boolean(confirmation)} onClick={() => void persist(false)}>{current ? "保存修改" : "保存草稿"}</button>
        <button type="button" disabled={controlsDisabled || Boolean(confirmation)} onClick={() => void persist(true)}>另存为新草稿</button>
        <button type="button" disabled={controlsDisabled} onClick={() => setConfirmation({ kind: "new" })}>新建行程</button>
      </div>
      <p className="road-task-draft-hint">首次保存后自动保存修改。</p>
      {error && <p role="alert" className="road-task-draft-error">{error}</p>}
      {notice && <p role="status" className="road-task-draft-notice">{notice}</p>}
      <details className="road-task-draft-library">
        <summary>恢复与备份{loaded ? ` · ${plans.length} 份草稿` : " · 读取中"}</summary>
        <label htmlFor="road-task-saved">已保存的任务<select id="road-task-saved" value={selectedId} disabled={controlsDisabled} onChange={event => setSelectedId(event.target.value)}>
          <option value="">选择本地草稿</option>{plans.map(plan => <option key={plan.planId} value={plan.planId}>{plan.name} · v{plan.revision} · {new Date(plan.updatedAt).toLocaleString("zh-CN")}</option>)}
        </select></label>
        <div className="road-task-draft-actions">
          <button type="button" disabled={controlsDisabled || !selected} onClick={() => { if (selected) setConfirmation({ kind: "restore", plan: selected }); }}>恢复所选</button>
          <button type="button" disabled={controlsDisabled} onClick={() => { void readList().then(() => setNotice("列表已刷新。")).catch(cause => setError(messageOf(cause))); }}>刷新列表</button>
          <button type="button" disabled={controlsDisabled || !selected} onClick={() => { if (selected) setConfirmation({ kind: "delete", plan: selected }); }}>删除所选</button>
        </div>
        <label className="road-task-notes-option"><input type="checkbox" checked={includeNotes} onChange={event => setIncludeNotes(event.target.checked)} />备份包含核验备注</label>
        <div className="road-task-draft-actions"><button type="button" disabled={disabled} onClick={exportDraft}>导出当前草稿 JSON</button><label className="road-task-import">导入任务 JSON<input type="file" accept=".json,application/json" disabled={controlsDisabled || account.status !== "authenticated"} onChange={event => { void importDraft(event); }} /></label></div>
        {(account.status !== "authenticated" || pendingImport) && <div className="road-task-draft-hint" role="status">
          <p>{account.status === "error" ? account.error : "导入个人任务 JSON 需先登录；当前草稿保留，文件仅在本机处理。"}</p>
          <a href="/login?returnTo=%2Fmap&resume=1" target="_blank" rel="noopener noreferrer" onClick={event => { event.currentTarget.href = buildLoginContinuationHref(window.location.pathname + window.location.search + window.location.hash, window.location.origin); }}>在新标签页登录 / 注册</a>{" "}
          <button type="button" onClick={() => void account.refresh()}>重新验证登录</button>
          {pendingImport && <button type="button" disabled={controlsDisabled || account.status !== "authenticated"} onClick={() => void importFile(pendingImport)}>登录后重试导入</button>}
        </div>}
        <details className="road-task-draft-hint"><summary>保存范围与备份说明</summary>
          <p>草稿仅保存在当前浏览器，非账号云同步；未保存地图商路线。</p>
          <p>备份含精确坐标和任务名称，不含照片文件；勾选核验备注后，也会包含备注中的个人信息。</p>
          <p>换浏览器、网址或清理存储后可能无法恢复，请保留备份。共用浏览器不等于账户隔离。</p>
        </details>
      </details>
      {confirmation && <fieldset className="road-task-confirmation" disabled={controlsDisabled}><legend>确认{confirmation.kind === "delete" ? "删除草稿" : confirmation.kind === "import" ? "导入副本" : confirmation.kind === "new" ? "新建行程" : "恢复草稿"}</legend>
        {"plan" in confirmation && <p>{confirmation.plan.name} · {confirmation.plan.tasks.length} 个任务 · {confirmation.plan.visits.length} 次到访 · v{confirmation.plan.revision}</p>}
        {(confirmation.kind === "import" || confirmation.kind === "restore") && <p>当前“{name}”有 {taskPlan?.visits.length ?? draft.waypoints.length + 2} 次到访；恢复后为 {confirmation.plan.visits.length} 次到访、{confirmation.plan.tasks.length} 个任务。出发 {taskPlan?.startTime ?? draft.startTime ?? "08:30"} → {confirmation.plan.startTime}，工时 {taskPlan?.workMinutes ?? draft.workMinutes ?? 480} → {confirmation.plan.workMinutes} 分钟。坐标、顺序和备注以所选草稿为准。</p>}
        <p>{confirmation.kind === "delete" ? "仅删除所选草稿，不删除现场照片。未导出备份的版本删除后无法恢复。" : `这将替换当前编辑区${changed ? "，其中有尚未保存的输入" : ""}。${confirmation.kind === "import" ? "导入会另存为新草稿，不覆盖原草稿。" : "已有保存草稿仍保留。"}当前路线将清除，之后需手动重新规划。`}</p>
        <div className="road-task-draft-actions"><button type="button" onClick={() => void confirmAction()}>确认{confirmation.kind === "delete" ? "删除" : confirmation.kind === "import" ? "导入副本" : confirmation.kind === "new" ? "新建" : "恢复"}</button><button type="button" onClick={() => setConfirmation(null)}>取消</button></div>
      </fieldset>}
    </div>
  </details>;
}
