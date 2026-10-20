import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as drivingContracts from "../app/lib/roadops-driving";
import * as taskRouting from "../app/lib/roadops-task-routing";
import * as taskEditor from "../app/lib/roadops-task-editor";
import * as taskReport from "../app/lib/roadops-task-report";
import * as taskCandidates from "../app/lib/roadops-task-candidates";
import * as accessChecks from "../app/lib/roadops-access-check";
import * as planningGoals from "../app/lib/roadops-planning-goals";
import * as localAnalysisSession from "../app/lib/local-analysis-session";
import * as authClient from "../app/lib/auth-client";
import { createNavigationDraft, setNavigationCoordinate } from "../app/lib/roadops-navigation";
import { createFieldTaskPlan, fieldTaskInspectionIssues, parseFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { RoadStrategySummary } from "../app/components/RoadStrategySummary";
import { fieldAccessPlanningGate } from "../app/components/RoadAccessCheckPanel";
import type { RoadOpsDrivingPlan, RoadOpsDrivingRequest } from "../app/lib/roadops-driving";
import { compareStrategySnapshots, createStrategySnapshot, ROAD_STRATEGY_COMPARISON_MAX_AGE_MS, strategyComparisonInputKey, strategyLabel, type RoadStrategyComparison, type RoadStrategySnapshot } from "../app/lib/roadops-strategy-comparison";

const generatedAt = "2026-10-10T03:00:00.000Z";
const now = Date.parse(generatedAt) + 60_000;
type PlanFixture = RoadOpsDrivingPlan & { planning?: { requestedStrategy: RoadOpsDrivingRequest["strategy"]; orderMode: "input" | "optimize"; orderingObjective: "input_order" | "duration" | "distance" }; drivingDurationSeconds?: number };

/** Synthetic geometry and metrics only. No provider account, key, network, or real field claim. */
function request(strategy: RoadOpsDrivingRequest["strategy"] = "1"): RoadOpsDrivingRequest {
  return {
    schemaVersion: "roadops-driving-request-v1", startId: "a", endId: "b", returnToStart: false,
    workMinutes: 480, strategy, orderMode: "optimize", detailMode: "field",
    points: [
      { id: "a", name: "测试起点", coordinate: [110.30, 20.00], role: "origin", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "测试起点" },
      { id: "b", name: "测试终点", coordinate: [110.34, 20.01], role: "destination", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "测试终点" },
      { id: "c", name: "测试途经点", coordinate: [110.32, 20.00], role: "candidate", dwellMinutes: 20, inspectionValue: 3, required: true, sourceFeatureId: "test/point-1", sourceRoadName: "测试路" },
    ],
  };
}

function plan(input = request(), changes: Partial<PlanFixture> = {}): PlanFixture {
  const orderMode = input.orderMode ?? "optimize";
  return {
    schemaVersion: "roadops-driving-plan-v1", provider: "didi_web_service", mode: "didi_live", generatedAt,
    inputFingerprint: "synthetic-only-not-a-provider-fingerprint", status: "ready", stopOrder: ["a", "c", "b"], selectedCandidateIds: ["c"], excluded: [],
    planning: { requestedStrategy: input.strategy, orderMode, orderingObjective: orderMode === "input" ? "input_order" : input.strategy === "5" ? "distance" : "duration" },
    drivingDurationSeconds: 5_890, totalDistanceMeters: 41_160, drivingMinutes: 98.2, dwellMinutes: 20, totalMinutes: 118.2, workMinutes: 480, overtimeMinutes: 0,
    map: { fixtureId: "synthetic-only", mode: "didi_live", stops: [], bounds: [110.30, 20, 110.34, 20.01], features: [
      { type: "Feature", id: "fixture-leg-1", properties: { from: "a", to: "c", source: "didi_web_service", distanceMeters: 20_000, durationSeconds: 3_000 }, geometry: { type: "LineString", coordinates: [[110.30, 20], [110.31, 20], [110.32, 20]] } },
      { type: "Feature", id: "fixture-leg-2", properties: { from: "c", to: "b", source: "didi_web_service", distanceMeters: 21_160, durationSeconds: 2_890 }, geometry: { type: "LineString", coordinates: [[110.32, 20], [110.33, 20.01], [110.34, 20.01]] } },
    ] },
    usage: { cached: false, upstreamRequests: 3, dailyUsed: 3, dailyBudget: 100, dailyRemaining: 97, perIdentityUsed: 3, perIdentityLimit: 20 },
    boundary: "离线合成测试，不是供应方实测结果。",
    ...changes,
  };
}

function snapshot(input = request(), result = plan(input)): RoadStrategySnapshot {
  const value = createStrategySnapshot(input, result);
  assert.ok(value);
  return value;
}

function comparison(changes: Partial<PlanFixture> = {}): RoadStrategyComparison {
  const input = request("5");
  return compareStrategySnapshots(snapshot(), snapshot(input, plan(input, changes)), now);
}

function render(result: RoadOpsDrivingPlan, value?: RoadStrategyComparison): string {
  return renderToStaticMarkup(createElement(RoadStrategySummary, { plan: result, comparison: value }));
}

test("the five strategy labels express the requested preference", () => {
  assert.deepEqual(["1", "2", "5", "11", "13"].map(value => strategyLabel(value as RoadOpsDrivingRequest["strategy"])), ["默认推荐", "时间优先", "距离更短", "高速优先", "不走高速"]);
});

test("input keys exclude strategy and sensitive descriptive/source text", () => {
  const original = request(), changed = request("13");
  changed.points = changed.points.map(point => ({ ...point, name: "not retained", sourceFeatureId: "not retained", sourceRoadName: "not retained" }));
  assert.equal(strategyComparisonInputKey(original), strategyComparisonInputKey(changed));
  assert.doesNotMatch(strategyComparisonInputKey(original), /测试起点|测试途经点|test\/point-1|sourceFeature|sourceRoad|name/);
});

test("every planning input except strategy invalidates direct comparison", () => {
  const original = request();
  const cases: RoadOpsDrivingRequest[] = [
    { ...original, startId: "c" }, { ...original, endId: "c" }, { ...original, returnToStart: true },
    { ...original, workMinutes: 479 }, { ...original, orderMode: "input" }, { ...original, detailMode: undefined },
    { ...original, points: [...original.points].reverse() },
    ...["id", "role", "coordinate", "dwellMinutes", "required", "inspectionValue"].map(key => {
      const value = structuredClone(original);
      const update = { id: "z", role: "origin", coordinate: [110.321, 20], dwellMinutes: 21, required: false, inspectionValue: 4 }[key];
      value.points[2] = { ...value.points[2], [key]: update };
      return value;
    }),
  ];
  for (const value of cases) assert.notEqual(strategyComparisonInputKey(original), strategyComparisonInputKey(value));
});

test("omitted ordering mode and explicit optimize have the same effective input key", () => {
  assert.equal(strategyComparisonInputKey({ ...request(), orderMode: undefined }), strategyComparisonInputKey(request()));
});

test("snapshot requires strategy, mode and objective echoes to bind to the request sent", () => {
  const input = request("5"), response = plan(input);
  assert.equal(createStrategySnapshot(input, plan(input, { planning: undefined })), null);
  assert.equal(createStrategySnapshot(input, plan(input, { planning: { ...response.planning!, requestedStrategy: "1" } })), null);
  assert.equal(createStrategySnapshot(input, plan(input, { planning: { ...response.planning!, orderMode: "input" } })), null);
  assert.equal(createStrategySnapshot(input, plan(input, { planning: { ...response.planning!, orderingObjective: "duration" } })), null);
  assert.equal(snapshot(input).orderingObjective, "distance");
  assert.equal(snapshot({ ...input, orderMode: "input" }, plan({ ...input, orderMode: "input" })).orderingObjective, "input_order");
});

test("snapshot never invents raw seconds from rounded driving minutes", () => {
  for (const drivingDurationSeconds of [undefined, NaN, Infinity, -1]) assert.equal(createStrategySnapshot(request(), plan(request(), { drivingDurationSeconds })), null);
  assert.equal(createStrategySnapshot(request(), plan(request(), { totalDistanceMeters: NaN })), null);
  assert.equal(createStrategySnapshot(request(), plan(request(), { status: "infeasible" })), null);
});

test("snapshots are detached from later plan or request mutations", () => {
  const input = request(), response = plan(input), original = snapshot(input, response);
  const key = original.inputKey, geometry = original.geometryKey;
  input.points[0].coordinate[0] = 111;
  response.stopOrder[0] = "mutated";
  response.map.features[0].geometry.coordinates[0][0] = 112;
  assert.equal(original.inputKey, key); assert.equal(original.geometryKey, geometry); assert.equal(original.stopOrder[0], "a");
  assert.ok(Object.isFrozen(original)); assert.ok(Object.isFrozen(original.stopOrder));
});

test("cache hits preserve the original generated timestamp", () => {
  const response = plan(), cached = plan(request(), { usage: { ...response.usage, cached: true, upstreamRequests: 0 } });
  assert.equal(snapshot(request(), cached).generatedAt, generatedAt);
  assert.equal(snapshot(request(), cached).generatedAtMs, Date.parse(generatedAt));
});

test("same-input different strategies compare unrounded meters and seconds", () => {
  const result = comparison({ totalDistanceMeters: 41_240, drivingDurationSeconds: 5_930, drivingMinutes: 98.8 });
  assert.equal((41_160 / 1000).toFixed(1), (41_240 / 1000).toFixed(1));
  assert.equal(Math.ceil(98.2), Math.ceil(98.8));
  assert.equal(result.status, "comparable");
  if (result.status !== "comparable") return;
  assert.equal(result.distanceDeltaMeters, 80); assert.equal(result.durationDeltaSeconds, 40); assert.equal(result.metricsIdentical, false);
  assert.equal(result.previousDistanceMeters, 41_160); assert.equal(result.currentDistanceMeters, 41_240);
});

test("identical raw metrics and oriented coordinates are reported explicitly without highway claims", () => {
  const result = comparison();
  assert.equal(result.status, "comparable");
  if (result.status !== "comparable") return;
  assert.equal(result.metricsIdentical, true); assert.equal(result.stopOrderIdentical, true); assert.equal(result.geometry, "identical");
  const html = render(plan(request("5")), result);
  assert.match(html, /未舍入的距离与耗时指标相同/); assert.match(html, /返回折线坐标一致/);
  assert.match(html, /不代表已独立核实道路偏好/); assert.doesNotMatch(html, /策略未生效|已确认无高速|路线安全/);
});

test("different sampling is a coordinate difference, not proof of a different road", () => {
  const input = request("5"), response = plan(input);
  response.map.features[0].geometry.coordinates.splice(1, 0, [110.305, 20]);
  const result = compareStrategySnapshots(snapshot(), snapshot(input, response), now);
  assert.equal(result.status, "comparable");
  if (result.status !== "comparable") return;
  assert.equal(result.geometry, "coordinates_differ");
  assert.match(render(response, result), /折线坐标有差异，不必然表示道路不同/);
});

test("even a sub-meter coordinate change is not called an identical polyline", () => {
  const input = request("5"), response = plan(input);
  response.map.features[0].geometry.coordinates[1][0] += 0.00000001;
  const result = compareStrategySnapshots(snapshot(), snapshot(input, response), now);
  assert.equal(result.status, "comparable");
  if (result.status === "comparable") assert.equal(result.geometry, "coordinates_differ");
});

test("coordinate direction and leg order are part of exact geometry comparison", () => {
  const input = request("5"), response = plan(input);
  response.map.features[0].geometry.coordinates.reverse();
  const result = compareStrategySnapshots(snapshot(), snapshot(input, response), now);
  assert.equal(result.status, "comparable");
  if (result.status === "comparable") assert.equal(result.geometry, "coordinates_differ");
});

test("missing geometry is unavailable rather than an empty same-route proof", () => {
  const input = request("5"), response = plan(input);
  response.map.features = [];
  const current = snapshot(input, response);
  const result = compareStrategySnapshots(snapshot(), current, now);
  assert.equal(result.status, "comparable");
  if (result.status === "comparable") assert.equal(result.geometry, "unavailable");
});

test("different stop order is retained even when total metrics are identical", () => {
  const result = comparison({ stopOrder: ["a", "b", "c"] });
  assert.equal(result.status, "comparable");
  if (result.status === "comparable") { assert.equal(result.metricsIdentical, true); assert.equal(result.stopOrderIdentical, false); }
});

test("changed input and same strategy cannot masquerade as a strategy experiment", () => {
  const previous = snapshot(), changed = request("5"); changed.workMinutes -= 1;
  assert.deepEqual(compareStrategySnapshots(previous, snapshot(changed), now), { status: "unavailable", reason: "input_changed" });
  assert.deepEqual(compareStrategySnapshots(previous, snapshot(), now), { status: "unavailable", reason: "same_strategy" });
});

test("comparison rejects modes and source provenance that do not match", () => {
  const previous = snapshot(), current = snapshot(request("5"));
  for (const update of [{ mode: "didi_replay" }, { provider: "didi_contract_replay" }, { mapMode: "offline_demo" }, { provenanceKey: "another-source" }] as Array<Partial<RoadStrategySnapshot>>) {
    assert.deepEqual(compareStrategySnapshots(previous, { ...current, ...update }, now), { status: "unavailable", reason: "provenance_changed" });
  }
  const mixed = plan(); mixed.map.features[0].properties.source = "saved_osm_route_demo";
  assert.equal(createStrategySnapshot(request(), mixed), null);
});

test("both snapshots must be within 30 minutes with no future timestamp", () => {
  const previous = snapshot(), current = snapshot(request("5"));
  assert.equal(compareStrategySnapshots(previous, current, Date.parse(generatedAt) + ROAD_STRATEGY_COMPARISON_MAX_AGE_MS).status, "comparable");
  assert.deepEqual(compareStrategySnapshots(previous, current, Date.parse(generatedAt) + ROAD_STRATEGY_COMPARISON_MAX_AGE_MS + 1), { status: "unavailable", reason: "expired" });
  assert.deepEqual(compareStrategySnapshots(previous, { ...current, generatedAtMs: now + 1 }, now), { status: "unavailable", reason: "future_time" });
  assert.deepEqual(compareStrategySnapshots({ ...previous, generatedAtMs: now + 1 }, current, now), { status: "unavailable", reason: "future_time" });
  assert.deepEqual(compareStrategySnapshots(previous, { ...current, generatedAtMs: Date.parse(generatedAt) - ROAD_STRATEGY_COMPARISON_MAX_AGE_MS }, now), { status: "unavailable", reason: "expired" });
});

test("malformed time and raw metrics are rejected without guessing a difference", () => {
  const previous = snapshot(), current = snapshot(request("5"));
  assert.deepEqual(compareStrategySnapshots(previous, { ...current, generatedAtMs: NaN }, now), { status: "unavailable", reason: "invalid_time" });
  assert.deepEqual(compareStrategySnapshots(previous, current, NaN), { status: "unavailable", reason: "invalid_time" });
  assert.deepEqual(compareStrategySnapshots(previous, { ...current, drivingDurationSeconds: Infinity }, now), { status: "unavailable", reason: "invalid_metrics" });
});

test("SSR shows confirmed response strategy, objective and precise metrics without a draft", () => {
  const html = render(plan(request("5")));
  assert.match(html, /距离更短/); assert.match(html, /按道路距离排序/); assert.match(html, /41\.160 公里/); assert.match(html, /41160 米（原始指标）/);
  assert.match(html, /98 分 10 秒/); assert.match(html, /5890 秒（原始指标）/); assert.match(html, /手动重算其他策略后对比/); assert.match(html, /不会自动请求五种策略/);
  assert.doesNotMatch(html, /<button|<a\b|<input/);
});

test("SSR legacy result labels unknown echoed strategy and raw seconds explicitly", () => {
  const html = render(plan(request(), { planning: undefined, drivingDurationSeconds: undefined }));
  assert.match(html, /未回显（旧方案）/); assert.match(html, /排序目标未回显/); assert.match(html, /原始秒值缺失/); assert.match(html, /不以舍入分钟判断精确差值/);
  assert.doesNotMatch(html, /默认推荐|按预计耗时排序/);
});

test("SSR preserves cached time and renders signed deltas with original before/after metrics", () => {
  const input = request("13"), response = plan(input, { totalDistanceMeters: 41_080, drivingDurationSeconds: 5_895 });
  response.usage = { ...response.usage, cached: true, upstreamRequests: 0 };
  const result = compareStrategySnapshots(snapshot(), snapshot(input, response), now);
  const html = render(response, result);
  assert.match(html, /复用缓存/); assert.match(html, /10\/10 11:00:00/); assert.match(html, /-80 米/); assert.match(html, /\+5 秒/);
  assert.match(html, /41160 → 41080 米/); assert.match(html, /5890 → 5895 秒/); assert.match(html, /不走高速/); assert.match(html, /不等于已独立核实全程无高速/);
});

test("SSR unavailable reasons are concise and do not imply extra API requests", () => {
  const html = render(plan(request("5")), { status: "unavailable", reason: "input_changed" });
  assert.match(html, /规划输入已变化/); assert.doesNotMatch(html, /距离差|驾车耗时差|<button/);
});

test("comparison code and component do not perform network, persistence, exports or logging", () => {
  for (const path of ["app/lib/roadops-strategy-comparison.ts", "app/components/RoadStrategySummary.tsx"]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /\bfetch\s*\(|localStorage|sessionStorage|indexedDB|console\.|URL\.createObjectURL|download=|writeFile|process\.env/);
  }
  const css = readFileSync("app/components/RoadStrategySummary.module.css", "utf8");
  assert.match(css, /var\(--ui-accent,/); assert.match(css, /var\(--ui-accent-soft,/); assert.doesNotMatch(css, /gradient|box-shadow/);
});

type ComparisonHook = (scope: string | null) => { comparison: RoadStrategyComparison | null; begin(): void; accept(input: RoadOpsDrivingRequest, result: RoadOpsDrivingPlan): void; clear(): void };
type HookSlot = { value?: unknown; dependencies?: readonly unknown[]; cleanup?: (() => void) | void };
const dependenciesMatch = (left: readonly unknown[] | undefined, right: readonly unknown[] | undefined) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));

function transpiledModule(path: string, bindings: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const code = ts.transpileModule(readFileSync(path, "utf8"), { fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const testModule = { exports: {} as Record<string, unknown> };
  runInNewContext(code, { module: testModule, exports: testModule.exports, require: (name: string) => {
    if (!(name in bindings)) throw new Error(`Isolated test dependency was not supplied: ${name}`);
    return bindings[name];
  }, ...globals }, { filename: path, timeout: 2_000 });
  return testModule.exports;
}

/** Runs the real hook against bounded in-memory lifecycle primitives, not a source-text assertion. */
function hookHarness(initialScope = "scope-a") {
  const slots: HookSlot[] = [];
  let index = 0, dirty = false, scope: string | null = initialScope, currentTime = now, nextTimer = 1;
  let result: ReturnType<ComparisonHook>;
  const layouts: Array<() => void> = [], effects: Array<() => void> = [];
  const timers = new Map<number, { at: number; callback: () => void }>();
  const documentEvents = new Map<string, Set<() => void>>(), windowEvents = new Map<string, Set<() => void>>();
  const slot = () => { const key = index++; return slots[key] ?? (slots[key] = {}); };
  const add = (events: Map<string, Set<() => void>>, type: string, handler: () => void) => { const handlers = events.get(type) ?? new Set(); handlers.add(handler); events.set(type, handlers); };
  const remove = (events: Map<string, Set<() => void>>, type: string, handler: () => void) => events.get(type)?.delete(handler);
  const lifecycle = (queue: Array<() => void>, callback: () => (() => void) | void, dependencies?: readonly unknown[]) => {
    const target = slot();
    if (!dependenciesMatch(target.dependencies, dependencies)) {
      target.dependencies = dependencies === undefined ? undefined : [...dependencies];
      queue.push(() => { if (typeof target.cleanup === "function") target.cleanup(); target.cleanup = callback(); });
    }
  };
  const react = {
    useRef: (value: unknown) => { const target = slot(); if (!("value" in target)) target.value = { current: value }; return target.value; },
    useState: (initial: unknown) => {
      const target = slot(); if (!("value" in target)) target.value = typeof initial === "function" ? initial() : initial;
      return [target.value, (value: unknown) => { target.value = typeof value === "function" ? value(target.value) : value; dirty = true; }];
    },
    useCallback: (callback: unknown, dependencies?: readonly unknown[]) => {
      const target = slot(); if (!dependenciesMatch(target.dependencies, dependencies)) { target.value = callback; target.dependencies = dependencies === undefined ? undefined : [...dependencies]; } return target.value;
    },
    useLayoutEffect: (callback: () => (() => void) | void, dependencies?: readonly unknown[]) => lifecycle(layouts, callback, dependencies),
    useEffect: (callback: () => (() => void) | void, dependencies?: readonly unknown[]) => lifecycle(effects, callback, dependencies),
  };
  const document = { visibilityState: "visible", addEventListener: (type: string, callback: () => void) => add(documentEvents, type, callback), removeEventListener: (type: string, callback: () => void) => remove(documentEvents, type, callback) };
  const window = { addEventListener: (type: string, callback: () => void) => add(windowEvents, type, callback), removeEventListener: (type: string, callback: () => void) => remove(windowEvents, type, callback) };
  let networkCalls = 0, persistenceCalls = 0;
  const hook = transpiledModule("app/lib/use-roadops-strategy-comparison.ts", {
    react,
    "./roadops-strategy-comparison": { compareStrategySnapshots, createStrategySnapshot, ROAD_STRATEGY_COMPARISON_MAX_AGE_MS },
  }, {
    Date: { now: () => currentTime }, document, window,
    setTimeout: (callback: () => void, delay: number) => { const id = nextTimer++; timers.set(id, { at: currentTime + delay, callback }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    fetch: () => { networkCalls += 1; throw new Error("The hook must never fetch."); },
    localStorage: { setItem: () => { persistenceCalls += 1; throw new Error("The hook must not persist supplier results."); } },
  }).useRoadOpsStrategyComparison as ComparisonHook;
  function render() {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      index = 0; dirty = false; result = hook(scope);
      while (layouts.length) layouts.shift()!();
      while (effects.length) effects.shift()!();
      if (!dirty) return result;
    }
    throw new Error("Isolated hook render did not settle.");
  }
  render();
  return {
    read: () => result,
    get timerCount() { return timers.size; },
    get eventCount() { return [...documentEvents.values(), ...windowEvents.values()].reduce((sum, handlers) => sum + handlers.size, 0); },
    get networkCalls() { return networkCalls; }, get persistenceCalls() { return persistenceCalls; },
    update: (next: string | null) => { scope = next; render(); },
    begin: () => { result.begin(); render(); },
    clear: () => { result.clear(); render(); },
    accept: (input: RoadOpsDrivingRequest, response: RoadOpsDrivingPlan) => { result.accept(input, response); render(); },
    visibility: (value: "hidden" | "visible") => { document.visibilityState = value; for (const handler of documentEvents.get("visibilitychange") ?? []) handler(); render(); },
    pagehide: () => { for (const handler of windowEvents.get("pagehide") ?? []) handler(); render(); },
    advance: (milliseconds: number) => { currentTime += milliseconds; for (const [id, pending] of timers) if (pending.at <= currentTime) { timers.delete(id); pending.callback(); } render(); },
    unmount: () => { for (const target of slots) if (typeof target.cleanup === "function") target.cleanup(); },
  };
}

test("real hook preserves exactly one baseline across manual begin, then clear removes it", () => {
  const harness = hookHarness();
  harness.accept(request(), plan()); assert.equal(harness.read().comparison, null);
  harness.begin(); assert.equal(harness.read().comparison, null);
  harness.accept(request("5"), plan(request("5"))); assert.equal(harness.read().comparison?.status, "comparable");
  harness.clear(); assert.equal(harness.read().comparison, null); assert.equal(harness.timerCount, 0);
  harness.accept(request("13"), plan(request("13"))); assert.equal(harness.read().comparison, null);
  assert.equal(harness.networkCalls, 0); assert.equal(harness.persistenceCalls, 0);
  harness.unmount();
});

test("real hook must not resurrect an old comparison when input scope changes A to B to A", () => {
  const harness = hookHarness();
  harness.accept(request(), plan()); harness.accept(request("5"), plan(request("5")));
  assert.equal(harness.read().comparison?.status, "comparable");
  harness.update("scope-b"); assert.equal(harness.read().comparison, null); assert.equal(harness.timerCount, 0);
  harness.update("scope-a"); assert.equal(harness.read().comparison, null);
  harness.accept(request("13"), plan(request("13"))); assert.equal(harness.read().comparison, null);
  harness.unmount();
});

test("real hook expires on the older compared snapshot and rejects expired or future results", () => {
  const harness = hookHarness();
  harness.accept(request(), plan());
  harness.advance(10 * 60_000);
  const secondTime = new Date(Date.parse(generatedAt) + 10 * 60_000).toISOString();
  harness.accept(request("5"), plan(request("5"), { generatedAt: secondTime }));
  assert.equal(harness.read().comparison?.status, "comparable");
  harness.advance(19 * 60_000); assert.equal(harness.read().comparison?.status, "comparable");
  harness.advance(1); assert.equal(harness.read().comparison?.status, "unavailable");
  const expired = harness.read().comparison;
  if (expired?.status === "unavailable") assert.equal(expired.reason, "expired");
  assert.equal(harness.timerCount, 0);
  harness.accept(request(), plan());
  const stale = harness.read().comparison;
  if (stale?.status === "unavailable") assert.equal(stale.reason, "expired");
  harness.accept(request(), plan(request(), { generatedAt: "2030-01-01T00:00:00Z" }));
  const future = harness.read().comparison;
  if (future?.status === "unavailable") assert.equal(future.reason, "future_time");
  harness.unmount();
});

test("real hook discards comparison on hidden and pagehide, and removes all timers/listeners on unmount", () => {
  const harness = hookHarness();
  harness.accept(request(), plan()); harness.accept(request("5"), plan(request("5")));
  assert.equal(harness.eventCount, 2); assert.equal(harness.timerCount, 1);
  harness.visibility("hidden"); assert.equal(harness.read().comparison, null); assert.equal(harness.timerCount, 0);
  harness.accept(request("13"), plan(request("13"))); assert.equal(harness.read().comparison, null); assert.equal(harness.timerCount, 0);
  harness.visibility("visible"); harness.accept(request("13"), plan(request("13"))); assert.equal(harness.read().comparison, null);
  harness.accept(request(), plan()); assert.equal(harness.read().comparison?.status, "comparable");
  harness.pagehide(); assert.equal(harness.read().comparison, null); assert.equal(harness.timerCount, 0);
  harness.accept(request(), plan()); assert.equal(harness.read().comparison, null);
  harness.unmount(); assert.equal(harness.eventCount, 0); assert.equal(harness.timerCount, 0);
  assert.equal(harness.networkCalls, 0); assert.equal(harness.persistenceCalls, 0);
});

function fieldPanelScope(value: FieldTaskPlan): string | null {
  let captured: string | null = null;
  let unexpectedIo = 0;
  const rejectIo = () => { unexpectedIo += 1; throw new Error("Comparison scope rendering must not read, write or request data."); };
  // This fixture renders one parent component without mounting effects or child views.
  // Keep domain calculations real; only supply an explicit empty local history and inert IO.
  const passthroughHooks = {
    useMemo: (callback: () => unknown) => callback(), useCallback: (callback: unknown) => callback,
    useRef: (initial: unknown) => ({ current: initial }), useEffect: () => {}, useLayoutEffect: () => {},
    useState: (initial: unknown) => [typeof initial === "function" ? initial() : initial, () => {}],
  };
  const exports = transpiledModule("app/components/RoadFieldTaskPanel.tsx", {
    react: passthroughHooks,
    "react/jsx-runtime": { jsx: (type: unknown, props: unknown) => ({ type, props }), jsxs: (type: unknown, props: unknown) => ({ type, props }) },
    "../lib/roadops-driving": drivingContracts,
    "../lib/roadops-navigation": { createNavigationDraft },
    "../lib/roadops-task-plan": { parseFieldTaskPlan, fieldTaskInspectionIssues },
    "../lib/roadops-task-editor": taskEditor,
    "../lib/roadops-task-routing": taskRouting,
    "../lib/roadops-task-candidates": taskCandidates,
    "../lib/roadops-access-check": accessChecks,
    "../lib/roadops-planning-goals": planningGoals,
    "../lib/local-analysis-session": localAnalysisSession,
    "../lib/auth-client": authClient,
    "../lib/roadops-task-report": taskReport,
    "./RoadTaskDraftPanel": { RoadTaskDraftPanel: () => null },
    "./RoadAccessCheckPanel": { RoadAccessCheckPanel: () => null, fieldAccessPlanningGate,
      useFieldAccessHistory: (planId: string) => ({ state: { planId, log: accessChecks.createFieldAccessLog(planId), exists: false, loading: false, saving: false, error: "" }, append: rejectIo, reload: rejectIo }) },
    "./RoadPlanningGoalSelect": { RoadPlanningGoalSelect: () => null },
    "./RoadPersonalizedCandidates": { RoadPersonalizedCandidates: () => null },
    "./RoadFieldExecutionPanel": { RoadFieldExecutionPanel: () => null },
    "../lib/use-roadops-strategy-comparison": { useRoadOpsStrategyComparison: (key: string | null) => { captured = key; return { comparison: null, begin() {}, accept() {}, clear() {} }; } },
    "../lib/roadops-strategy-comparison": { strategyComparisonInputKey },
    "./RoadStrategySummary": { RoadStrategySummary: () => null },
  }, { Date, fetch: rejectIo, indexedDB: { open: rejectIo }, localStorage: { getItem: rejectIo, setItem: rejectIo } });
  const panel = exports.RoadFieldTaskPanel as (props: Record<string, unknown>) => unknown;
  panel({ plan: value, stored: false, pickId: null, result: null, activeLegId: null, onChange() {}, onSaved() {}, onRestore() {}, onPick() {}, onResult() {}, onBusy() {}, onFocusLeg() {}, onFocusPoint() {} });
  assert.ok(captured, "The real panel must reach the comparison hook with its computed input scope.");
  assert.equal(unexpectedIo, 0);
  return captured;
}

test("advanced panel comparison scope ignores save-only metadata but includes actual task inputs", () => {
  let draft = createNavigationDraft();
  draft = setNavigationCoordinate(draft, draft.origin.id, [110.30, 20]);
  draft = setNavigationCoordinate(draft, draft.destination.id, [110.34, 20.01]);
  const original = createFieldTaskPlan(draft, { planId: "test-strategy-scope", name: "测试方案", now: generatedAt });
  const saved = { ...original, revision: original.revision + 1, updatedAt: "2026-10-10T03:10:00.000Z" };
  assert.equal(fieldPanelScope(original), fieldPanelScope(saved), "Automatic save metadata must not erase a paid successful comparison baseline.");
  assert.equal(fieldPanelScope(original), fieldPanelScope({ ...original, strategy: "5" }), "Strategy-only changes preserve the baseline.");
  assert.notEqual(fieldPanelScope(original), fieldPanelScope({ ...original, workMinutes: original.workMinutes - 1 }));
  assert.notEqual(fieldPanelScope(original), fieldPanelScope({ ...original, tasks: original.tasks.map((task, index) => index ? { ...task, dwellMinutes: task.dwellMinutes + 1 } : task) }));
});
