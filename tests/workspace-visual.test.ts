import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceHeader } from "../app/components/WorkspaceHeader";
import { RoadNavigationPanel } from "../app/components/RoadNavigationPanel";
import { RoadFieldPlanPanel } from "../app/components/RoadFieldPlanPanel";
import { LanguageProvider } from "../app/lib/language-context";
import { assessFieldPlan } from "../app/lib/roadops-field";
import { addNavigationWaypoint, buildNavigationRequest, createNavigationDraft, navigationFieldVisits, navigationPoints, setNavigationCoordinate, updateNavigationPoint, type NavigationDraft } from "../app/lib/roadops-navigation";
import type { RoadOpsDrivingPlan } from "../app/lib/roadops-driving";

const noop = () => {};
const fixtureBanner = "离线 UI 测试夹具 · 非真实滴图结果";

function fixtureDraft(blocked = false): NavigationDraft {
  let draft = addNavigationWaypoint(createNavigationDraft());
  draft = setNavigationCoordinate(draft, draft.origin.id, [110.3, 20]);
  draft = setNavigationCoordinate(draft, draft.waypoints[0].id, [110.32, 20]);
  draft = setNavigationCoordinate(draft, draft.destination.id, [110.34, 20]);
  draft = updateNavigationPoint(draft, draft.origin.id, { name: "驻地出发点" });
  draft = updateNavigationPoint(draft, draft.waypoints[0].id, { name: "校区东侧核查点", dwellMinutes: 25 });
  draft = updateNavigationPoint(draft, draft.destination.id, { name: "外业集合点", dwellMinutes: 10 });
  if (blocked) draft = updateNavigationPoint(draft, draft.waypoints[0].id, { accessReview: "blocked", accessNote: "离线示例：联系人告知入口暂未开放" });
  return draft;
}

/** Synthetic UI-only state; never submitted to the driving service or advertised as a provider response. */
function fixturePlan(draft: NavigationDraft, farOffset = true): RoadOpsDrivingPlan {
  const visits = navigationFieldVisits(draft);
  const request = buildNavigationRequest(draft);
  const orderMode = request.orderMode ?? "optimize";
  return {
    schemaVersion: "roadops-driving-plan-v1", provider: "didi_web_service", mode: "didi_live",
    generatedAt: new Date().toISOString(), inputFingerprint: "offline-ui-fixture-not-a-provider-response", status: "ready",
    planning: { requestedStrategy: request.strategy, orderMode, orderingObjective: orderMode === "input" ? "input_order" : request.strategy === "5" ? "distance" : "duration" },
    drivingDurationSeconds: 1800,
    stopOrder: visits.map(point => point.id), selectedCandidateIds: [visits[1].id], excluded: [],
    totalDistanceMeters: 5000, drivingMinutes: 30, dwellMinutes: 35, totalMinutes: 65, workMinutes: 480, overtimeMinutes: 0,
    map: { mode: "didi_live", fixtureId: "offline-ui-only", stops: [], features: [], bounds: [110.3, 20, 110.34, 20] },
    usage: { cached: true, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 100, dailyRemaining: 100, perIdentityUsed: 0, perIdentityLimit: 100 },
    field: {
      schemaVersion: "roadops-field-detail-v1", guidance: "geometry_only", routePackCount: 2,
      limitations: [fixtureBanner, "供应方仅提供路线几何与时距；测试数据不提供真实导航指引"],
      legs: [
        { id: "ui-leg-1", index: 1, fromId: visits[0].id, toId: visits[1].id, distanceMeters: 2000, durationSeconds: 600, coordinates: [[110.3, 20], [110.32, 20]], bounds: [110.3, 20, 110.32, 20], traffic: [], tollsYuan: 0, tag: null },
        { id: "ui-leg-2", index: 2, fromId: visits[1].id, toId: visits[2].id, distanceMeters: 3000, durationSeconds: 1200, coordinates: [[110.32, 20], [110.34, 20]], bounds: [110.32, 20, 110.34, 20], traffic: [], tollsYuan: null, tag: null },
      ],
      access: visits.map((point, index) => ({ pointId: point.id, coordinate: point.coordinate, roadCoordinate: point.coordinate, offsetMeters: farOffset && index === 2 ? 67 : 0, status: farOffset && index === 2 ? "far_from_route" : "near_route", thresholdMeters: 50 })),
    },
    boundary: fixtureBanner,
  };
}

function navigationElement(draft: NavigationDraft, plan: RoadOpsDrivingPlan | null = null, pickId: string | null = null): ReactElement {
  return h(RoadNavigationPanel, { draft, plan, pickId, onChange: noop, onPick: noop, onPlan: noop, onBusy: noop, evidence: [], activeLegId: null, onFocusLeg: noop, onFocusPoint: noop });
}

function renderHeader(active: "route" | null = "route"): string {
  return renderToStaticMarkup(h(LanguageProvider, { children: h(WorkspaceHeader, { active, onChange: noop, onHelp: noop }) }));
}

function renderField(draft: NavigationDraft, plan = fixturePlan(draft)): string {
  return renderToStaticMarkup(h(RoadFieldPlanPanel, { draft, plan, onFocusLeg: noop, onFocusPoint: noop }));
}

function textContent(html: string): string {
  return html.replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&#x27;", "'").replaceAll("&quot;", '"');
}

function primaryButtons(html: string): string[] {
  const nav = html.match(/<nav class="workspace-primary-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert.ok(nav, "Header must render its named workspace navigation");
  return nav.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

async function writeVisualPreview(): Promise<void> {
  const [globals, workspace, bundledModules] = await Promise.all([
    readFile("app/globals.css", "utf8"), readFile("app/workspace-ui.css", "utf8"), readFile("build/tests/workspace-visual.css", "utf8"),
  ]);
  // Preserve the import order in globals.css, without leaving any external stylesheet dependencies.
  const css = `${globals.replace(/@import\s+["']\.\/workspace-ui\.css["'];?/, workspace).replace(/@import\s+[^;]+;/g, "")}\n${bundledModules}`;
  const unknown = fixtureDraft(), blocked = fixtureDraft(true);
  const panel = (title: string, content: ReactElement, variant: string) => `<section class="ui-preview-sample ${variant}"><h2>${title}</h2><aside class="gis-left phase-two-left workspace-task-drawer"><div class="panel-head"><strong>驾车出行规划</strong></div>${renderToStaticMarkup(content)}</aside></section>`;
  const header = renderHeader().replace(/<link rel="preload"[^>]*>/g, "");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; script-src 'none'"><title>${fixtureBanner}</title><style>${css}</style><style>
    html,body.ui-preview-body{height:auto!important;min-height:100%;overflow:auto!important;background:#eef0f2}
    .ui-preview-body .navigation-workspace{height:auto!important;min-height:100vh;overflow:visible!important}
    .ui-preview-notice{margin:0;padding:14px 24px;background:#23282e;color:#fff;font:600 14px/1.5 "Segoe UI","Microsoft YaHei",sans-serif}
    .ui-preview-notice small{display:block;color:#d5d9dd;font-size:12px;font-weight:400}
    .ui-preview-grid{display:grid;grid-template-columns:380px 680px;gap:32px;align-items:start;padding:28px;max-width:1148px;margin:auto}
    .ui-preview-sample>h2{font-size:14px;line-height:1.5;margin:0 0 12px;color:#4a525c}
    .ui-preview-body .navigation-workspace .ui-preview-sample .workspace-task-drawer{position:relative!important;inset:auto!important;width:100%!important;height:auto!important;max-height:none!important;min-height:0!important;overflow:visible!important;border:1px solid #d8dce1;box-shadow:none;background:#fff;display:block}
    .ui-preview-body .navigation-workspace .workspace-header{position:relative;min-width:1120px}
    .ui-preview-sample.is-editor{grid-column:1}
  </style></head><body class="map-route-shell ui-preview-body"><main class="map-page phase-two-workspace navigation-workspace driving-workspace"><p class="ui-preview-notice">${fixtureBanner}<small>仅展示实际组件的离线样式。无交互脚本、无网络连接，不代表真实路径、通行条件或账号用量；折叠项可手动展开。</small></p>${header}<div class="ui-preview-grid">${panel("380 px · 三站入口未知 + 67 米端点偏移", navigationElement(unknown, fixturePlan(unknown)), "is-narrow")}${panel("680 px · 人工阻断 + 未核实事项并列保留", navigationElement(blocked, fixturePlan(blocked)), "is-wide")}${panel("380 px · 空白路线编辑器", navigationElement(createNavigationDraft()), "is-editor")}</div></main></body></html>`;
  await mkdir("build/ui-preview", { recursive: true });
  await Promise.all([
    writeFile("build/ui-preview/road-field.html", html, "utf8"),
    writeFile("build/ui-preview/index.html", html, "utf8"),
  ]);
  console.log("Offline UI preview: build/ui-preview/road-field.html (no network or interactive scripts)");
}

if (process.argv.includes("--preview-only")) {
  await writeVisualPreview();
} else {
  test("six workspace commands render distinct outlined SVGs with their visible accessible labels", () => {
    const buttons = primaryButtons(renderHeader());
    assert.equal(buttons.length, 6);
    assert.deepEqual(buttons.map(textContent), ["数据", "图层", "驾车", "分析", "核查", "导出"]);
    const icons = buttons.map(button => button.match(/<svg\b[^>]*>[\s\S]*?<\/svg>/)?.[0]);
    assert.equal(new Set(icons).size, 6, "Each command has a different semantic drawing");
    for (const button of buttons) {
      assert.equal((button.match(/<svg\b/g) ?? []).length, 1);
      assert.match(button, /class="workspace-nav-icon"/);
      assert.match(button, /width="20" height="20" viewBox="0 0 24 24"/);
      assert.match(button, /aria-hidden="true" focusable="false"/);
      assert.match(button, /class="workspace-nav-label"/);
      assert.doesNotMatch(button, /[▤▱↝⌁◎↗]/);
    }
  });

  test("active header expansion state is retained independently of visual icons", () => {
    const buttons = primaryButtons(renderHeader());
    assert.deepEqual(buttons.map(button => /aria-expanded="true"/.test(button)), [false, false, true, false, false, false]);
    assert.ok(primaryButtons(renderHeader(null)).every(button => button.includes('aria-expanded="false"')));
    assert.match(renderHeader(), /aria-label="返回首页"/);
    assert.match(renderHeader(), /aria-label="切换网站语言"/);
    assert.doesNotMatch(renderHeader(), /lanjifyw-brand-satellite\.png|brand-system|LANJIFYW|形变研判 · 外业协同/);
  });

  test("an embedded local workspace returns to the parent import draft through a button", () => {
    const html = renderToStaticMarkup(h(LanguageProvider, { children: h(WorkspaceHeader, { active: null, onChange: noop, onHelp: noop, onReturnToImport: noop }) }));
    assert.match(html, /<button type="button" class="workspace-home-link" aria-label="返回导入"/);
    assert.doesNotMatch(html, /<a class="workspace-home-link"/);
    assert.match(html, /<span>返回导入<\/span>/);
  });

  test("empty driving editor retains explicit map selection, editable settings, and manual planning action", () => {
    const html = renderToStaticMarkup(navigationElement(createNavigationDraft()));
    assert.match(html, /在地图上选择起点/);
    assert.match(html, /在地图上选择终点/);
    assert.equal((html.match(/class="road-navigation-pick" aria-pressed="false"/g) ?? []).length, 2);
    assert.match(html, /<details class="road-navigation-edit" open="">/);
    assert.match(html, /<legend class="road-navigation-sr-only">行程点位与驾车设置<\/legend>/);
    assert.match(html, /aria-label="出发时刻" type="time" value="08:30"/);
    assert.match(html, /aria-label="可用工时分钟"/);
    assert.match(html, /aria-label="机动缓冲分钟"/);
    assert.match(html, /规划驾车路线<\/button>/);
    assert.doesNotMatch(html, /class="road-field-plan"/);
  });

  test("map picking state remains visible and is not confused with route generation", () => {
    const draft = createNavigationDraft();
    const html = renderToStaticMarkup(navigationElement(draft, null, draft.origin.id));
    assert.equal((html.match(/class="road-navigation-pick" aria-pressed="true"/g) ?? []).length, 1);
    assert.match(html, /请点击地图，选择此点/);
    assert.match(html, /road-navigation-point-origin is-picking/);
    assert.doesNotMatch(html, /正在规划/);
  });

  test("each unknown entrance and the route endpoint offset remain explicitly rendered review issues", () => {
    const draft = fixtureDraft(), plan = fixturePlan(draft), html = renderField(draft, plan);
    const report = assessFieldPlan(plan, navigationFieldVisits(draft), { startTime: "08:30", workMinutes: 480, bufferMinutes: 30 });
    assert.equal(report.status, "needs_review");
    assert.equal(report.issues.filter(issue => issue.code === "access_unknown").length, 3);
    assert.equal(report.issues.filter(issue => issue.code === "road_offset").length, 1);
    assert.equal((html.match(/class="road-field-access is-unknown"/g) ?? []).length, 3);
    assert.equal((html.match(/class="is-review"/g) ?? []).length, 4);
    for (const issue of report.issues) assert.ok(textContent(html).includes(issue.message), issue.message);
    assert.match(html, /出发前待办 \/ 阻断项（4）/);
    assert.match(html, /<span class="road-field-issue-level">待核验<\/span>/);
    assert.match(html, /路线已算出 · 现场待核验/);
    assert.match(html, /地图商路线 ≠ 停车许可 ≠ 核查点可进入/);
    assert.doesNotMatch(html, /核验已记录 · 出发前复核/);
  });

  test("manually blocked entrance keeps a distinct blocker label, reason, and unknown issues", () => {
    const draft = fixtureDraft(true), plan = fixturePlan(draft), html = renderField(draft, plan);
    const report = assessFieldPlan(plan, navigationFieldVisits(draft), { startTime: "08:30", workMinutes: 480, bufferMinutes: 30 });
    assert.equal(report.status, "blocked");
    assert.equal((html.match(/class="is-blocker"/g) ?? []).length, 1);
    assert.equal((html.match(/class="is-review"/g) ?? []).length, 3);
    assert.match(html, /存在执行阻断项/);
    assert.match(html, /class="road-field-access is-blocked">标记不可进入/);
    assert.match(html, /<span class="road-field-issue-level">阻断<\/span>/);
    assert.match(html, /联系人告知入口暂未开放/);
    for (const issue of report.issues) assert.ok(textContent(html).includes(issue.message), issue.message);
  });

  test("field result preserves numeric schedule, focus controls, explicit boundaries, and export affordance", () => {
    const draft = fixtureDraft(), html = renderField(draft);
    assert.match(html, /aria-label="本次驾车策略与方案对比"/);
    assert.match(html, /默认推荐/);
    assert.match(html, /按输入顺序/);
    assert.match(html, /<dd>5\.000 公里<small>5000 米（原始指标）<\/small><\/dd>/);
    assert.match(html, /<dd>30 分 0 秒<small>1800 秒（原始指标）<\/small><\/dd>/);
    assert.doesNotMatch(html, /未回显（旧方案）|原始秒值缺失/);
    assert.match(html, /含核查与机动 95 分钟/);
    assert.match(html, /预计结束 10:05/);
    assert.equal((html.match(/class="road-field-leg-index"/g) ?? []).length, 2);
    assert.equal((html.match(/查看到达点/g) ?? []).length, 3);
    assert.match(html, /不是逐路口转向指令/);
    assert.match(html, /不推断封路、可达或自动绕行/);
    assert.match(html, /下载外业任务单（TXT）/);
    assert.match(html, /不是账号余额\/计费账单/);
  });

  test("result view retains all settings in collapsed edit section and reflects a stored blocked choice", () => {
    const draft = fixtureDraft(true), html = renderToStaticMarkup(navigationElement(draft, fixturePlan(draft)));
    assert.match(html, /<details class="road-navigation-edit"><summary>编辑点位、核查停留与进入核验/);
    assert.match(html, /<option value="blocked" selected="">不可进入 \/ 需调整<\/option>/);
    assert.equal((html.match(/核验依据 \/ 限制备注/g) ?? []).length, 3);
    assert.equal(navigationPoints(draft).length, 3);
  });

  test("rendering header, blank editor, and offline result issues no HTTP request", context => {
    const fetchMock = context.mock.method(globalThis, "fetch", async () => { throw new Error("Offline SSR must not fetch"); });
    renderHeader();
    renderToStaticMarkup(navigationElement(createNavigationDraft()));
    const draft = fixtureDraft();
    renderToStaticMarkup(navigationElement(draft, fixturePlan(draft)));
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}
