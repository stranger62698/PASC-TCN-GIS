import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fieldAccessPlanningGate, fieldAccessShanghaiInput, fieldAccessShanghaiUtc, RoadAccessCheckPanel, type FieldAccessLoadState } from "../app/components/RoadAccessCheckPanel";
import { RoadFieldTaskPanel } from "../app/components/RoadFieldTaskPanel";
import { appendFieldAccessCheck, captureFieldAccessSubject, createFieldAccessLog, evaluateFieldAccessLog, FIELD_ACCESS_MAX_REFS, type FieldAccessCheck, type FieldAccessLog } from "../app/lib/roadops-access-check";
import { serializeFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { makeSimulatedFieldTaskPlan } from "./fixtures/roadops-field-scenarios";

const assessedAt = "2026-10-09T01:00:00.000Z";
const options = { assessedAt };
const noop = () => {};
const asyncNoop = async () => {};
function loaded(plan: FieldTaskPlan, log: FieldAccessLog | null = createFieldAccessLog(plan.planId)): FieldAccessLoadState {
  return { planId: plan.planId, log, exists: log !== null, loading: false, saving: false, error: "" };
}
function checkFor(plan: FieldTaskPlan, overrides: Partial<FieldAccessCheck> = {}): FieldAccessCheck {
  const subject = { kind: "vehicle_stop" as const, stopId: plan.stops[1].stopId };
  return { checkId: "simulated-access-check", subject, dimension: "vehicle_approach", status: "blocked",
    coordinateSnapshot: captureFieldAccessSubject(plan, subject, "vehicle_approach"), reviewer: "模拟核验人", checkedAt: assessedAt,
    validUntil: null, source: "user_statement", basis: "模拟人工限制：不代表现实道路事实", evidenceRefs: [], releaseBlockedCheckIds: [], recordedAt: assessedAt, ...overrides };
}
function completeLog(plan: FieldTaskPlan): FieldAccessLog {
  const log = createFieldAccessLog(plan.planId);
  const slots = evaluateFieldAccessLog(plan, log, options).slots;
  return { ...log, checks: slots.map((slot, index) => checkFor(plan, { checkId: `simulated-confirmation-${index}`, subject: slot.subject,
    dimension: slot.dimension, status: "confirmed", coordinateSnapshot: captureFieldAccessSubject(plan, slot.subject, slot.dimension),
    validUntil: "2026-10-10T01:00:00.000Z", basis: "模拟限期核验依据：仅用于本地验收" })) };
}
function withoutBrowserWork(renderMarkup: () => string): string {
  let networkCalls = 0, databaseCalls = 0;
  const originalFetch = globalThis.fetch;
  const originalDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("Access SSR must never request a route"); };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() { databaseCalls += 1; throw new Error("Access SSR must not open a browser database"); } } });
  try {
    const html = renderMarkup();
    assert.equal(networkCalls, 0); assert.equal(databaseCalls, 0);
    return html;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDatabase) Object.defineProperty(globalThis, "indexedDB", originalDatabase);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
}
function render(plan: FieldTaskPlan, state = loaded(plan), stored = true): string {
  return withoutBrowserWork(() => renderToStaticMarkup(createElement(RoadAccessCheckPanel, { plan, state, stored, assessedAt, onAppend: asyncNoop, onReload: asyncNoop, onDirty: noop })));
}

test("FP3A access panel SSR defaults every dimension to unknown without network or browser storage", () => {
  const plan = makeSimulatedFieldTaskPlan(), state = loaded(plan), gate = fieldAccessPlanningGate(plan, state, options);
  assert.equal(gate.canPlan, true); assert.equal(gate.evaluation!.status, "unknown");
  assert.equal(gate.evaluation!.slots.length, plan.stops.length * 2 + plan.tasks.length * 2);
  assert.ok(gate.evaluation!.slots.every(slot => slot.status === "unknown"));
  const html = render(plan, state);
  for (const label of ["车辆接近", "停车许可", "入口许可", "停靠点至核查目标", "未核验", "核验人", "核验时间", "核验有效至"]) assert.ok(html.includes(label), label);
  assert.match(html, /<option[^>]*value="unknown"[^>]*selected/);
  assert.doesNotMatch(html, /<option[^>]*value="confirmed"[^>]*selected/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>导出核验历史 JSON/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
});

test("FP3A unsaved task identities cannot create access history in SSR", () => {
  const plan = makeSimulatedFieldTaskPlan(), html = render(plan, loaded(plan), false);
  assert.ok(html.includes("请先保存任务草稿，再新增核验"));
  assert.ok(html.includes("另存副本或导入任务会生成新计划，不继承原核验"));
  assert.doesNotMatch(html, /<form[^>]*class="road-access-form"/);
  assert.ok(!html.includes("追加核验记录"));
});

test("FP3A legacy confirmations and extra provider fields never become current manual confirmations", () => {
  const plan = makeSimulatedFieldTaskPlan();
  plan.tasks.forEach(task => { task.legacyAccessReview = "confirmed"; task.accessNote = "模拟历史确认，仍须复核"; });
  const foreignPlan = { ...plan, providerPlan: { field: { access: [{ status: "confirmed", basis: "PROVIDER_MUST_NOT_CONFIRM_ACCESS" }] } } };
  const gate = fieldAccessPlanningGate(foreignPlan, loaded(foreignPlan), options), html = render(foreignPlan);
  assert.equal(gate.evaluation!.status, "unknown"); assert.ok(gate.evaluation!.slots.every(slot => slot.latest === null));
  assert.ok(html.includes("道路算路成功不会自动确认可达"));
  assert.ok(!html.includes("PROVIDER_MUST_NOT_CONFIRM_ACCESS"));
  assert.doesNotMatch(html, /<option[^>]*value="confirmed"[^>]*selected/);
});

test("FP3A complete manual records retain limits and read-only history without preconfirming new entries", () => {
  const plan = makeSimulatedFieldTaskPlan(), state = loaded(plan, completeLog(plan));
  const gate = fieldAccessPlanningGate(plan, state, options), html = render(plan, state);
  assert.equal(gate.canPlan, true); assert.equal(gate.evaluation!.status, "confirmed_with_limits");
  assert.ok(html.includes("人工确认 · 有期限")); assert.ok(html.includes("仍需出发前复核"));
  assert.ok(html.includes("不承诺安全、实时通行或停车合法性"));
  assert.ok(html.includes("只读核验历史")); assert.ok(html.includes("模拟限期核验依据：仅用于本地验收"));
  assert.doesNotMatch(html, />\s*(?:保证安全|安全可达|可放心通行|已确认安全)\s*</);
  assert.match(html, /<option[^>]*value="unknown"[^>]*selected/);
});

test("FP3A active manual blocks stop planning even after a later unknown record", () => {
  const plan = makeSimulatedFieldTaskPlan();
  let log = appendFieldAccessCheck(createFieldAccessLog(plan.planId), checkFor(plan));
  log = appendFieldAccessCheck(log, checkFor(plan, { checkId: "simulated-later-unknown", status: "unknown", reviewer: "", checkedAt: null, basis: "" }));
  const state = loaded(plan, log), gate = fieldAccessPlanningGate(plan, state, options), html = render(plan, state);
  assert.equal(gate.canPlan, false); assert.equal(gate.evaluation!.status, "blocked");
  assert.ok(html.includes("人工限制未解除")); assert.ok(html.includes("存在未解除的人工禁入记录"));
  assert.ok(html.includes("后续未知记录、坐标变化或过期均不能解除"));
  const legacy = makeSimulatedFieldTaskPlan(); legacy.tasks[1].legacyAccessReview = "blocked";
  assert.equal(fieldAccessPlanningGate(legacy, loaded(legacy), options).canPlan, false);
});

test("FP3A pending reads, writes, storage failures and foreign state cannot bypass the planning gate", () => {
  const plan = makeSimulatedFieldTaskPlan(), ready = loaded(plan);
  const states: FieldAccessLoadState[] = [
    { ...ready, loading: true }, { ...ready, saving: true }, { ...ready, error: "模拟存储读取失败，原记录保留" },
    { ...ready, planId: "another-simulation-plan" },
  ];
  for (const state of states) {
    const gate = fieldAccessPlanningGate(plan, state, options);
    assert.equal(gate.canPlan, false); assert.equal(gate.evaluation, null); assert.ok(gate.reason);
    const html = render(plan, state); assert.ok(html.includes('role="alert"'));
    assert.ok(!html.includes("人工确认 · 有期限"));
    if (state.planId === plan.planId) assert.match(html, /<form[^>]*class="road-access-form"[^>]*><fieldset disabled=""/);
  }
});

test("FP3A both load-state and document plan identities isolate historical records", () => {
  const plan = makeSimulatedFieldTaskPlan(), foreign = { ...plan, planId: "another-simulation-plan" };
  const foreignLog = appendFieldAccessCheck(createFieldAccessLog(foreign.planId), checkFor(foreign, { basis: "FOREIGN_PLAN_PRIVATE_BASIS" }));
  for (const state of [loaded(foreign, foreignLog), { ...loaded(plan), log: foreignLog }]) {
    const gate = fieldAccessPlanningGate(plan, state, options), html = render(plan, state);
    assert.equal(gate.canPlan, false); assert.equal(gate.evaluation, null);
    assert.ok(!html.includes("FOREIGN_PLAN_PRIVATE_BASIS"), "foreign document content must not appear in this plan's history");
  }
});

test("FP3A changed coordinates, expiry and missing local evidence require review without gaining assurance", () => {
  const plan = makeSimulatedFieldTaskPlan(), complete = completeLog(plan);
  const changed = structuredClone(plan); changed.stops[1].coordinate![0] += 0.001; changed.stops[1].usesVehicleCoordinate = true;
  const moved = fieldAccessPlanningGate(changed, loaded(changed, complete), options);
  assert.equal(moved.evaluation!.status, "needs_review");
  const expired = fieldAccessPlanningGate(plan, loaded(plan, complete), { assessedAt: "2026-10-10T01:00:00.000Z" });
  assert.equal(expired.evaluation!.status, "needs_review");
  const referenced = structuredClone(complete); referenced.checks[0].evidenceRefs = ["simulated-missing-local-evidence"];
  const missing = fieldAccessPlanningGate(plan, loaded(plan, referenced), options);
  assert.equal(missing.evaluation!.status, "needs_review");
  assert.equal(fieldAccessPlanningGate(plan, loaded(plan, referenced), { ...options, availableEvidenceIds: ["simulated-missing-local-evidence"] }).evaluation!.status, "confirmed_with_limits");
  const html = render(plan, loaded(plan, referenced));
  assert.ok(html.includes("待复核")); assert.ok(!html.includes("当前人工记录在期限及坐标范围内有效"));
});

test("FP3A access layer stays isolated from provider routes, photo mutation and task JSON backups", () => {
  const panel = readFileSync("app/components/RoadAccessCheckPanel.tsx", "utf8");
  const core = readFileSync("app/lib/roadops-access-check.ts", "utf8"), store = readFileSync("app/lib/roadops-access-store.ts", "utf8");
  for (const source of [panel, core, store]) assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|\/api\/roadops|RoadOpsDrivingPlan|providerPlan|roadops-driving|saveFieldObservations|localStorage\.clear|deleteDatabase\s*\(/);
  assert.doesNotMatch(store, /roadops-task-store|roadops-observations|lanjifyw-field-observations|\.clear\s*\(|\.delete\s*\(/);
  assert.match(store, /lanjifyw-field-access-logs-v1/); assert.match(store, /keyPath:\s*"planId"/);
  assert.doesNotMatch(panel, /type="file"|\.import\s*\(/);
  const plan = makeSimulatedFieldTaskPlan(), log = completeLog(plan);
  const exported = serializeFieldTaskPlan({ ...plan, accessLog: log } as FieldTaskPlan, { includeNotes: true });
  assert.doesNotMatch(exported, /accessLog|simulated-confirmation|模拟限期核验依据|coordinateSnapshot|evidenceRefs|releaseBlockedCheckIds/);
});

test("FP3A task planner checks access before requests and keeps provider results outside access props", () => {
  const source = readFileSync("app/components/RoadFieldTaskPanel.tsx", "utf8");
  const integration = source.match(/<RoadAccessCheckPanel[\s\S]*?\/>/)?.[0];
  assert.ok(integration); assert.doesNotMatch(integration, /providerPlan|receipt|result=|roadEvidence|field=/);
  const action = source.slice(source.indexOf("async function generateRoute()"), source.indexOf("return <section", source.indexOf("async function generateRoute()")));
  assert.ok(action.indexOf("fieldAccessPlanningGate") >= 0);
  assert.ok(action.indexOf("fieldAccessPlanningGate") < action.indexOf("compileFieldTaskRouting"), "gate must precede supplier request compilation");
  assert.ok(action.indexOf("fieldAccessPlanningGate") < action.indexOf("fetch("), "gate must precede network access");
  assert.ok(action.indexOf("requestRef.current = pending") < action.indexOf("await "), "request lock must be set before the fresh local read yields");
  assert.equal((action.match(/await access\.reload\(\)/g) ?? []).length, 2, "read current local history before requesting and before accepting the response");
  const binding = action.indexOf("const receipt = bindFieldTaskRoute"), responseGate = action.indexOf("const responseGate = fieldAccessPlanningGate");
  const rejection = action.indexOf("if (!responseGate.canPlan) throw new Error");
  assert.ok(binding > action.indexOf("const responseAccess = await access.reload()") && responseGate > binding,
    "strictly validate the returned task selection before assessing its actual access scope");
  assert.match(action.slice(responseGate, rejection), /selectedTaskIds:\s*receipt\.selectedTaskIds,\s*selectedVisitIds:\s*receipt\.visits\.map/);
  assert.ok(rejection > responseGate, "a blocked response must exit through the failure path");
  for (const publication of ["strategyComparison.accept(", "retainCandidate("]) {
    assert.ok(action.indexOf(publication, binding) > rejection, "a newly blocked response must not be published or retained");
  }
  assert.match(source, /road-navigation-submit[^\n]*disabled=\{[^}]*canPlan/);
});

test("FP3A full task panel SSR waits for local access history before enabling the route request", () => {
  const plan = makeSimulatedFieldTaskPlan();
  const html = withoutBrowserWork(() => renderToStaticMarkup(createElement(RoadFieldTaskPanel, { plan, stored: true,
    onChange: noop, onSaved: noop, onRestore: noop, pickId: null, onPick: noop, result: null, onResult: noop,
    onBusy: noop, activeLegId: null, onFocusLeg: noop, onFocusPoint: noop })));
  assert.ok(html.includes("通行与入口核验")); assert.ok(html.includes("正在读取本机核验历史"));
  assert.match(html, /<button[^>]*class="road-navigation-submit"[^>]*disabled=""[^>]*>规划外业行程/);
});

test("FP3A visible review times round-trip China standard time and reject invalid calendar input", () => {
  assert.equal(fieldAccessShanghaiInput("2026-10-08T23:30:00.000Z"), "2026-10-09T07:30");
  assert.equal(fieldAccessShanghaiUtc("2026-10-09T07:30"), "2026-10-08T23:30:00.000Z");
  assert.equal(fieldAccessShanghaiUtc(""), null);
  assert.throws(() => fieldAccessShanghaiUtc("2026-02-30T07:30"), /日期或时刻无效/);
  assert.throws(() => fieldAccessShanghaiUtc("2026-10-09T25:00"), /日期或时刻无效/);
});

test("FP3A source and SSR guards disable access and route actions during draft storage IO", () => {
  const draft = readFileSync("app/components/RoadTaskDraftPanel.tsx", "utf8"), task = readFileSync("app/components/RoadFieldTaskPanel.tsx", "utf8");
  assert.match(draft, /const setStorageBusy = useCallback\(\(busy: boolean\) => \{ setIoBusy\(busy\); storageBusyCallback\.current\?\.\(busy\); \}/);
  const importHandler = draft.slice(draft.indexOf("async function importDraft("), draft.indexOf("async function importFile("));
  assert.match(importHandler, /await importFile\(file\)/, "file selection must delegate to the guarded import operation");
  assert.doesNotMatch(importHandler, /file\.text\(|store\./, "the event wrapper must not perform IO before the guarded operation");
  const boundaries = [
    ["const persist = useCallback(async", "useEffect(() =>"],
    ["async function importFile(", "async function confirmAction("],
    ["async function confirmAction(", "return <details"],
  ];
  for (const [start, end] of boundaries) {
    const startIndex = draft.indexOf(start), action = draft.slice(startIndex, draft.indexOf(end, startIndex));
    assert.ok(action.indexOf("setStorageBusy(true)") >= 0, start);
    assert.ok(action.indexOf("setStorageBusy(true)") < action.indexOf("await "), `${start} must notify the owner before storage IO yields`);
    assert.match(action, /finally[\s\S]*setStorageBusy\(false\)/);
  }
  assert.match(draft, /storageBusyCallback\.current\?\.\(false\)/);
  assert.match(task, /<RoadTaskDraftPanel[^\n]*onStorageBusy=\{setDraftIoBusy\}/);
  assert.match(task, /<RoadAccessCheckPanel[^\n]*disabled=\{[^}]*draftIoBusy/);
  assert.match(task, /if \([^\n]*draftIoBusy[^\n]*\) return;/);
  assert.match(task, /road-navigation-submit[^\n]*disabled=\{[^}]*draftIoBusy/);
  const plan = makeSimulatedFieldTaskPlan();
  const html = withoutBrowserWork(() => renderToStaticMarkup(createElement(RoadAccessCheckPanel, { plan, state: loaded(plan), stored: true,
    disabled: true, assessedAt, onAppend: asyncNoop, onReload: asyncNoop, onDirty: noop })));
  assert.match(html, /<form[^>]*class="road-access-form"[^>]*><fieldset disabled=""/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>重新读取核验历史/);
});

test("FP3A source guards wait for an old plan write before reading the new identity and catch effect failures", () => {
  const source = readFileSync("app/components/RoadAccessCheckPanel.tsx", "utf8");
  const reloadStart = source.indexOf("const reload = useCallback(async"), effectStart = source.indexOf("useEffect(() =>", reloadStart);
  const reload = source.slice(reloadStart, effectStart), appendStart = source.indexOf("const append = useCallback", effectStart);
  const effect = source.slice(effectStart, appendStart), append = source.slice(appendStart, source.indexOf("return { state, append, reload }", appendStart));
  assert.match(reload, /if \(writeSettled\.current\) await writeSettled\.current\.catch\(\(\) => undefined\)/);
  assert.ok(reload.indexOf("await writeSettled.current") < reload.indexOf("await store.get(planId)"));
  assert.doesNotMatch(reload, /if \(writeLock\.current\) throw/);
  assert.match(reload, /token === epoch\.current && planRef\.current === planId/);
  assert.match(reload, /loading: false, saving: false/);
  assert.match(effect, /return reload\(\); \}\)\.catch\(error =>/);
  assert.match(effect, /mounted\.current && planRef\.current === planId[\s\S]*initialState\(planId\)[\s\S]*loading: false/);
  assert.ok(append.indexOf("writeSettled.current = operation") < append.indexOf("await operation"));
  assert.match(append, /if \(planRef\.current === planId\) publish/);
  assert.match(append, /finally \{ writeLock\.current = false; writeSettled\.current = null; \}/);
});

test("FP3A source and SSR keep release snapshots capped at 20 while 21 blocks require explicit batches", () => {
  assert.equal(FIELD_ACCESS_MAX_REFS, 20);
  const source = readFileSync("app/components/RoadAccessCheckPanel.tsx", "utf8");
  assert.match(source, /\[releaseIds, setReleaseIds\] = useState<string\[\]>\(\[\]\)/);
  assert.match(source, /setReleaseIds\(event\.target\.checked \? slot\.activeBlockedCheckIds\.slice\(0, FIELD_ACCESS_MAX_REFS\) : \[\]\)/);
  const submit = source.slice(source.indexOf("async function save(event:"), source.indexOf("const required =", source.indexOf("async function save(event:")));
  assert.match(submit, /releaseBlockedCheckIds: status === "confirmed" \? releaseIds : \[\]/);
  assert.doesNotMatch(submit, /releaseBlockedCheckIds:[^\n]*?slot\.activeBlockedCheckIds/);
  assert.ok(source.includes("新增限制不自动列入"));
  const plan = makeSimulatedFieldTaskPlan(), subject = { kind: "vehicle_stop" as const, stopId: plan.stops[0].stopId };
  const snapshot = captureFieldAccessSubject(plan, subject, "vehicle_approach");
  const base = checkFor(plan, { subject, coordinateSnapshot: snapshot });
  let log = createFieldAccessLog(plan.planId);
  for (let index = 0; index < 21; index += 1) log = appendFieldAccessCheck(log, { ...base, checkId: `simulated-batch-block-${index}` });
  const before = fieldAccessPlanningGate(plan, loaded(plan, log), options);
  assert.equal(before.canPlan, false); assert.equal(before.evaluation!.slots[0].activeBlockedCheckIds.length, 21);
  const html = render(plan, loaded(plan, log));
  assert.ok(html.includes("已有人工限制 21 条"));
  assert.ok(html.includes("每次最多引用 20 条，剩余限制须继续补充依据"));
  const capturedIds = before.evaluation!.slots[0].activeBlockedCheckIds.slice(0, FIELD_ACCESS_MAX_REFS);
  const firstRelease: FieldAccessCheck = { ...base, checkId: "simulated-first-batch-release", status: "confirmed", validUntil: "2026-10-10T01:00:00.000Z", releaseBlockedCheckIds: capturedIds };
  assert.throws(() => appendFieldAccessCheck(log, { ...firstRelease, releaseBlockedCheckIds: before.evaluation!.slots[0].activeBlockedCheckIds }), /最多支持 20/);
  const partialLog = appendFieldAccessCheck(log, firstRelease), partial = fieldAccessPlanningGate(plan, loaded(plan, partialLog), options);
  assert.equal(partial.canPlan, false); assert.deepEqual(partial.evaluation!.slots[0].activeBlockedCheckIds, ["simulated-batch-block-20"]);
  assert.ok(render(plan, loaded(plan, partialLog)).includes("人工限制未解除"));
  const finished = appendFieldAccessCheck(partialLog, { ...firstRelease, checkId: "simulated-second-batch-release", releaseBlockedCheckIds: partial.evaluation!.slots[0].activeBlockedCheckIds });
  assert.equal(fieldAccessPlanningGate(plan, loaded(plan, finished), options).canPlan, true);
  const refreshed = appendFieldAccessCheck(log, { ...base, checkId: "simulated-new-block-after-selection" });
  const snapshotRelease = appendFieldAccessCheck(refreshed, firstRelease), refreshedGate = fieldAccessPlanningGate(plan, loaded(plan, snapshotRelease), options);
  assert.equal(refreshedGate.canPlan, false);
  assert.deepEqual(refreshedGate.evaluation!.slots[0].activeBlockedCheckIds, ["simulated-batch-block-20", "simulated-new-block-after-selection"]);
});
