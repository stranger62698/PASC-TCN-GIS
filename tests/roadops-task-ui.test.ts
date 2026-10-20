import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createNavigationDraft } from "../app/lib/roadops-navigation";
import { RoadTaskDraftPanel } from "../app/components/RoadTaskDraftPanel";

test("draft panel renders without a browser database or network access", () => {
  const html = renderToStaticMarkup(createElement(RoadTaskDraftPanel, { draft: createNavigationDraft(), disabled: false, onRestore: () => {} }));
  for (const label of ["任务草稿", "保存草稿", "恢复与备份", "导出当前草稿 JSON", "非账号云同步", "精确坐标", "不含照片文件"]) assert.ok(html.includes(label), label);
  assert.ok(!html.includes("已保存在此浏览器"));
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
});

test("upstream activity disables storage switches and imports in SSR", () => {
  const html = renderToStaticMarkup(createElement(RoadTaskDraftPanel, { draft: createNavigationDraft(), disabled: true, onRestore: () => {} }));
  assert.match(html, /<button[^>]*disabled=""[^>]*>保存草稿/);
  assert.match(html, /type="file"[^>]*disabled=""/);
});

test("storage boundary has no supplier result props, network calls or photo-store mutation", () => {
  const panel = readFileSync("app/components/RoadTaskDraftPanel.tsx", "utf8");
  const store = readFileSync("app/lib/roadops-task-store.ts", "utf8");
  assert.doesNotMatch(panel, /fetch\(|XMLHttpRequest|RoadOpsDrivingPlan|roadops\/driving|saveFieldObservations/);
  assert.doesNotMatch(store, /fetch\(|XMLHttpRequest|lanjifyw-field-observations|localStorage\.clear|\.clear\(/);
  assert.match(panel, /fieldTaskPlanToNavigationDraft/);
  assert.match(panel, /FIELD_TASK_PLAN_MAX_BYTES/);
  assert.match(panel, /未保存地图商路线/);
  assert.match(panel, /beforeunload/);
});

test("restore integration clears provider geometry and requires an explicit planner action", () => {
  const panel = readFileSync("app/components/RoadNavigationPanel.tsx", "utf8");
  assert.match(panel, /RoadTaskDraftPanel/);
  assert.match(panel, /onRestore=\{[^}]*onPlan\(null\)/);
  assert.match(panel, /onRestore=\{[^}]*onPick\(null\)/);
  assert.doesNotMatch(panel.match(/onRestore=\{[^}]*\}/)?.[0] ?? "", /generateRoute|fetch/);
});
