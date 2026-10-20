import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoadFieldTaskPanel, type FieldTaskResult } from "../app/components/RoadFieldTaskPanel";
import { RoadNavigationPanel } from "../app/components/RoadNavigationPanel";
import { createNavigationDraft } from "../app/lib/roadops-navigation";
import { setFieldTaskTripMode } from "../app/lib/roadops-task-editor";
import { createFieldTaskPlan, fieldTaskPlanToNavigationDraft, parseFieldTaskPlan, prepareFieldTaskPlanRestore, serializeFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { bindFieldTaskRoute, compileFieldTaskRouting } from "../app/lib/roadops-task-routing";
import { makeSimulatedFieldTaskPlan, makeSimulatedReturnPlan, makeSimulatedSharedStopPlan } from "./fixtures/roadops-field-scenarios";
import { simulatedFieldResponse } from "./fixtures/roadops-field-routing-response";

const noop = () => {};
function resultFor(plan: FieldTaskPlan, seconds?: number[]): FieldTaskResult {
  const providerPlan = simulatedFieldResponse(plan, undefined, seconds);
  // This SSR exercise assesses the newly generated synthetic result, not an aged global fixture.
  providerPlan.generatedAt = new Date().toISOString();
  return { providerPlan, receipt: bindFieldTaskRoute(plan, { plan: providerPlan }, compileFieldTaskRouting(plan)) };
}
function render(plan: FieldTaskPlan, result: FieldTaskResult | null = null, options: { stored?: boolean; activeLegId?: string | null } = {}) {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("SSR must not fetch any route"); };
  try {
    const html = renderToStaticMarkup(createElement(RoadFieldTaskPanel, { plan, result, stored: options.stored ?? false,
      onChange: noop, onSaved: noop, onRestore: noop, pickId: null, onPick: noop, onResult: noop, onBusy: noop,
      activeLegId: options.activeLegId ?? null, onFocusLeg: noop, onFocusPoint: noop }));
    assert.equal(networkCalls, 0); return html;
  } finally { globalThis.fetch = originalFetch; }
}

test("FP2 task panel SSR appends a return occurrence while retaining original destination work", () => {
  const original = makeSimulatedFieldTaskPlan(), oldDestination = original.visits.at(-1)!;
  const plan = setFieldTaskTripMode(original, "return_to_start", { visitId: "panel-return-visit" });
  const html = render(plan);
  assert.equal(plan.visits.length, original.visits.length + 1);
  assert.deepEqual(plan.tasks, original.tasks); assert.deepEqual(plan.visits.at(-2)!.taskIds, oldDestination.taskIds);
  assert.equal(plan.visits.at(-2)!.visitId, oldDestination.visitId); assert.equal(plan.visits.at(-1)!.taskIds.length, 0);
  assert.match(html, /aria-pressed="true"[^>]*>返回出发地/);
  assert.ok(html.includes("停靠 2")); assert.ok(html.includes("返回出发地"));
  assert.ok(html.includes(original.tasks.at(-1)!.name));
  assert.ok(html.includes("保留原终点任务为中途停靠，再追加返回到访"));
  assert.equal((html.match(/road-navigation-point-heading/g) ?? []).length, 4);
  assert.ok(html.includes("0 项任务"));
});

test("FP2 task panel displays all shared task names and each 180-minute stay without a station cap", () => {
  const plan = makeSimulatedSharedStopPlan();
  plan.tasks.forEach(task => { task.dwellMinutes = plan.visits[1].taskIds.includes(task.taskId) ? 180 : 0; });
  const html = render(plan, resultFor(plan));
  for (const taskId of plan.visits[1].taskIds) {
    const task = plan.tasks.find(item => item.taskId === taskId)!;
    assert.ok(html.includes(task.name), task.name); assert.ok(html.includes(`${task.name}停留分钟`));
  }
  assert.ok(html.includes("540 分钟")); assert.ok(html.includes("590 分钟")); assert.ok(html.includes("超出工时 110 分钟"));
  const visitSummary = html.match(/class="road-task-report-visits"[^>]*><summary>([^<]*)<\/summary>/)?.[1];
  assert.ok(visitSummary, "The report must retain its visit and executed-task summary.");
  assert.equal(Number(visitSummary.match(/(\d+)\s*次到访/)?.[1]), plan.visits.length);
  assert.equal(Number(visitSummary.match(/(\d+)\s*项任务/)?.[1]), plan.tasks.length);
  assert.equal((html.match(/class="road-task-report-visit"/g) ?? []).length, plan.visits.length);
  assert.equal((html.match(/>查看核查目标<\/button>/g) ?? []).length, plan.tasks.length);
  assert.ok(html.includes("共用其他停靠")); assert.ok(html.includes("拆为独立停靠"));
  assert.equal((html.match(/value="180"/g) ?? []).length, 3);
});

test("FP2 task panel refuses stale receipt reports after revision, coordinate or local dwell changes", () => {
  const original = makeSimulatedReturnPlan(), result = resultFor(original, [600, 1620]);
  const mutations: Array<(plan: FieldTaskPlan) => void> = [
    plan => { plan.revision += 1; },
    plan => { plan.tasks[1].dwellMinutes += 1; },
    plan => { plan.stops[1].coordinate![0] += 0.001; plan.stops[1].usesVehicleCoordinate = true; },
  ];
  for (const mutate of mutations) {
    const plan = structuredClone(original); mutate(plan); const html = render(plan, result);
    assert.ok(!html.includes('aria-label="逐站外业行程报告"'));
    assert.ok(!html.includes("滴图驾车分段 ·")); assert.ok(html.includes("设置行程与核查任务"));
    assert.ok(html.includes("规划外业行程"));
  }
});

test("FP2 bound task report shows complete directed legs, departure/final dwell and focused occurrence", () => {
  const plan = makeSimulatedReturnPlan(); plan.tasks[0].dwellMinutes = 0.5; plan.tasks[1].dwellMinutes = 20; plan.tasks.at(-1)!.dwellMinutes = 15;
  const result = resultFor(plan, [600, 1620]), html = render(plan, result, { activeLegId: result.receipt.legs[1].id });
  assert.ok(html.includes('aria-label="逐站外业行程报告"')); assert.ok(html.includes("滴图驾车分段 · 2 段"));
  assert.ok(html.includes("37 分钟")); assert.ok(html.includes("35.5 分钟")); assert.ok(html.includes("102.5 分钟"));
  assert.ok(html.includes("出发地 → 停靠 1")); assert.ok(html.includes("停靠 1 → 返回出发地"));
  assert.ok(html.includes("10 分钟")); assert.ok(html.includes("27 分钟")); assert.ok(html.includes("0.5 分钟")); assert.ok(html.includes("15 分钟"));
  assert.match(html, /class="is-active"[^>]*><span>停靠 1 → 返回出发地/);
  assert.ok(html.includes("道路端点证据")); assert.ok(html.includes("到达 / 离开端点间距")); assert.ok(html.includes("待现场核验"));
  assert.ok(!html.includes("30 分钟复核提示阈值，请出发前"), "fresh synthetic result must not be accidentally assessed as stale");
});

test("FP2 advanced entry and full draft restore retain return/shared identities instead of flattening", () => {
  const draft = createNavigationDraft();
  const navigationProps = { draft, onChange: noop, pickId: null, onPick: noop, plan: null, onPlan: noop, onBusy: noop,
    evidence: [], activeLegId: null, onFocusLeg: noop, onFocusPoint: noop };
  const legacyHtml = renderToStaticMarkup(createElement(RoadNavigationPanel, { ...navigationProps, onOpenFieldTasks: noop }));
  const entry = legacyHtml.match(/<button\b[^>]*class="road-task-advanced-entry"[^>]*>([\s\S]*?)<\/button>/)?.[1].replace(/<[^>]*>/g, " ");
  assert.ok(entry, "The full field-task entry must remain available when its callback is supplied.");
  assert.match(entry, /完整任务/); assert.match(entry, /返程/); assert.match(entry, /共站/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(RoadNavigationPanel, navigationProps)), /class="road-task-advanced-entry"/);
  // Execute the actual entry handler with inert callbacks; this is not a mounted browser interaction.
  const navigation = readFileSync("app/components/RoadNavigationPanel.tsx", "utf8");
  const entrySource = navigation.match(/<button\b[^>]*className="road-task-advanced-entry"[\s\S]*?<\/button>/)?.[0];
  const handler = entrySource?.match(/onClick=\{(\(\) => \{[\s\S]*\})\}>/)?.[1];
  assert.ok(handler);
  const calls: unknown[] = [];
  let opened: FieldTaskPlan | null = null;
  const open = runInNewContext(`(${handler})`, { draft, createFieldTaskPlan,
    clearComparison: () => calls.push("clear"), onPlan: (value: unknown) => calls.push(["plan", value]),
    onPick: (value: unknown) => calls.push(["pick", value]), onOpenFieldTasks: (value: FieldTaskPlan) => { opened = value; calls.push("open"); }, Date }, { timeout: 1_000 }) as () => void;
  open();
  assert.deepEqual(calls, ["clear", ["plan", null], ["pick", null], "open"]);
  const full = parseFieldTaskPlan(opened);
  assert.equal(full.visits.length, draft.waypoints.length + 2);
  assert.deepEqual(full.tasks.map(task => task.taskId), [draft.origin, ...draft.waypoints, draft.destination].map(point => point.id));
  for (const plan of [makeSimulatedReturnPlan(), makeSimulatedSharedStopPlan()]) {
    assert.throws(() => fieldTaskPlanToNavigationDraft(plan));
    const restored = prepareFieldTaskPlanRestore(parseFieldTaskPlan(JSON.parse(serializeFieldTaskPlan(plan, { includeNotes: true }))));
    assert.deepEqual(restored.visits, plan.visits); assert.deepEqual(restored.stops, plan.stops); assert.deepEqual(restored.tasks, plan.tasks);
    const html = render(restored, null, { stored: true });
    assert.ok(html.includes(restored.name)); assert.ok(html.includes(`已保存 · v${restored.revision}`));
  }
  const panel = readFileSync("app/components/RoadFieldTaskPanel.tsx", "utf8"), drafts = readFileSync("app/components/RoadTaskDraftPanel.tsx", "utf8");
  assert.match(panel, /taskPlan=\{plan\}/); assert.match(panel, /onRestoreTaskPlan=\{onRestore\}/);
  assert.doesNotMatch(panel, /fieldTaskPlanToNavigationDraft/);
  assert.match(drafts, /if \(taskPlan \|\| !restored\)[\s\S]*?onRestoreTaskPlan\(fullRestore\)/);
});

test("FP2 supplier result remains outside the panel's task draft persistence and JSON whitelist", () => {
  const plan = makeSimulatedReturnPlan(), result = resultFor(plan);
  const html = render(plan, result), rawWithForeignFields = { ...plan, receipt: result.receipt, providerPlan: result.providerPlan, field: result.providerPlan.field };
  const exported = serializeFieldTaskPlan(rawWithForeignFields, { includeNotes: false });
  assert.doesNotMatch(exported, /providerPlan|receipt|inputSignature|simulated-leg|geo_list|durationSeconds|didi_web_service/);
  assert.deepEqual(JSON.parse(exported).visits, plan.visits);
  assert.ok(html.includes("道路时距、几何和本报告仅在当前页面内存中使用，不进入草稿、JSON 备份或账号云端"));
  const panel = readFileSync("app/components/RoadFieldTaskPanel.tsx", "utf8"), draftMarkup = panel.match(/<RoadTaskDraftPanel[\s\S]*?\/>/)?.[0];
  assert.ok(draftMarkup); assert.doesNotMatch(draftMarkup, /result|receipt|providerPlan/);
});
