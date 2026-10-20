import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_EVENT_NAMES,
  FIRST_INSIGHT_TARGET_MS,
  readSessionAnalytics,
  resetSessionAnalytics,
  trackEvent,
} from "../app/lib/analytics.ts";

process.env.NODE_ENV = "production";

function createStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function installBrowser() {
  const sessionStorage = createStorage();
  globalThis.window = { location: { pathname: "/map", search: "?demo=haikou" }, sessionStorage, dispatchEvent: () => true };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  return sessionStorage;
}

test("Phase 9 exposes the minimum event subset and current map workspace events", () => {
  const expected = [
    "page_view", "demo_start", "dataset_upload_start", "dataset_upload_success", "dataset_upload_fail", "dataset_loaded",
    "point_click", "region_select", "filter_apply", "pattern_view_switch", "ai_analysis_start", "ai_analysis_success",
    "ai_analysis_fail", "statistics_open", "analysis_export",
    "pattern_visibility_filter", "mode_legend_filter", "data_backed_case_open", "ai_analysis_prepare", "ai_analysis_import", "field_observation_add",
  ];
  for (const name of expected) assert.ok(ANALYTICS_EVENT_NAMES.includes(name), name);
  assert.equal(FIRST_INSIGHT_TARGET_MS, 60_000);
});

test("first valid point or region result records Time to First Insight once", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  storage.setItem("lanjifyw-product-entry-v1", String(Date.now() - 2_000));
  trackEvent("page_view", { page: "/map" });
  const point = trackEvent("point_click", { result_count: 1, selection_mode: "single" });
  const region = trackEvent("region_select", { result_count: 12, selection_type: "rectangle" });
  assert.equal(point?.payload.first_insight, true);
  assert.equal(point?.payload.within_60s_target, true);
  assert.ok(Number(point?.payload.time_to_first_insight_ms) >= 1_900);
  assert.equal(region?.payload.first_insight, undefined);
});

test("tracking strips sensitive payload keys and keeps a bounded session queue", () => {
  installBrowser();
  resetSessionAnalytics();
  const event = trackEvent("dataset_upload_start", { file_size_bytes: 2048, email: "private@example.com", password: "secret", file_name: "private.csv" });
  assert.equal(event?.payload.file_size_bytes, 2048);
  assert.equal(event?.payload.email, undefined);
  assert.equal(event?.payload.password, undefined);
  assert.equal(event?.payload.file_name, undefined);
  for (let index = 0; index < 105; index += 1) trackEvent("filter_apply", { filter_type: "velocity", result_count: index });
  assert.equal(readSessionAnalytics().length, 100);
});

for (const surface of ["getter", "getItem", "setItem"]) {
  test(`optional analytics survives sessionStorage ${surface} exceptions with one stable session`, () => {
    const storage = installBrowser();
    resetSessionAnalytics();
    const failure = () => { throw new DOMException("Browser storage disabled", surface === "setItem" ? "QuotaExceededError" : "SecurityError"); };
    if (surface === "getter") Object.defineProperty(window, "sessionStorage", { configurable: true, get: failure });
    else storage[surface] = failure;
    let first, point, region, mainOperationFinished = false;
    assert.doesNotThrow(() => {
      first = trackEvent("dataset_upload_start", { source: "exception_regression" });
      mainOperationFinished = true;
      point = trackEvent("point_click", { result_count: 1 });
      region = trackEvent("region_select", { result_count: 2 });
    });
    assert.equal(mainOperationFinished, true);
    assert.ok(first?.session_id && first.session_id !== "server");
    assert.equal(first.session_id, point?.session_id);
    assert.equal(point.session_id, region?.session_id);
    assert.equal(point.payload.first_insight, true);
    assert.equal(region.payload.first_insight, undefined);
    assert.deepEqual(readSessionAnalytics().map(event => event.id), [first.id, point.id, region.id]);
  });
}

test("storage recovery keeps the active fallback session and never replays a stale first insight", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  storage.setItem("lanjifyw-analytics-session-v1", "old-persisted-session");
  storage.setItem("lanjifyw-product-entry-v1", "1");
  storage.setItem("lanjifyw-first-insight-v1", "15");
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
  const first = trackEvent("dataset_loaded", { source: "fallback" });
  const point = trackEvent("point_click", { result_count: 1 });
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: storage });
  const region = trackEvent("region_select", { result_count: 2 });
  assert.notEqual(first.session_id, "old-persisted-session");
  assert.equal(first.session_id, point.session_id);
  assert.equal(first.session_id, region.session_id);
  assert.equal(point.payload.first_insight, true);
  assert.equal(region.payload.first_insight, undefined);
  assert.equal(storage.getItem("lanjifyw-analytics-session-v1"), first.session_id);
  assert.deepEqual(readSessionAnalytics().map(event => event.id), [first.id, point.id, region.id]);
});

test("a partial storage read cannot combine a persisted identity with fallback first-insight state", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  storage.setItem("lanjifyw-analytics-session-v1", "partially-readable-session");
  storage.setItem("lanjifyw-first-insight-v1", "25");
  const originalGet = storage.getItem;
  storage.getItem = key => {
    if (key === "lanjifyw-product-entry-v1") throw new DOMException("blocked", "SecurityError");
    return originalGet(key);
  };
  const point = trackEvent("point_click", { result_count: 1 });
  assert.notEqual(point.session_id, "partially-readable-session");
  assert.equal(point.payload.first_insight, true);
});

test("reset clears memory, duplicate guards and first insight even when every removeItem fails", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  const first = trackEvent("page_view");
  trackEvent("point_click", { result_count: 1 });
  const removed = [];
  storage.removeItem = key => { removed.push(key); throw new DOMException("blocked", "SecurityError"); };
  assert.doesNotThrow(() => resetSessionAnalytics());
  assert.equal(removed.length, 4);
  assert.deepEqual(readSessionAnalytics(), []);
  const next = trackEvent("page_view");
  const point = trackEvent("point_click", { result_count: 1 });
  assert.ok(next);
  assert.notEqual(next.session_id, first.session_id);
  assert.equal(point.session_id, next.session_id);
  assert.equal(point.payload.first_insight, true);
  assert.deepEqual(readSessionAnalytics().map(event => event.id), [next.id, point.id]);
});

test("reset during a blocked storage getter ignores stale keys when storage recovers", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  const first = trackEvent("point_click", { result_count: 1 });
  Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } });
  assert.doesNotThrow(() => resetSessionAnalytics());
  Object.defineProperty(window, "sessionStorage", { configurable: true, value: storage });
  const next = trackEvent("point_click", { result_count: 1 });
  assert.notEqual(next.session_id, first.session_id);
  assert.equal(next.payload.first_insight, true);
  assert.deepEqual(readSessionAnalytics().map(event => event.id), [next.id]);
});

test("a readable persisted session retains its queue and zero-duration first insight", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  const persisted = { id: "persisted-event", name: "point_click", session_id: "persisted-session", occurred_at: new Date().toISOString(), route: "/map",
    payload: { result_count: 1, first_insight: true, time_to_first_insight_ms: 0 } };
  storage.setItem("lanjifyw-analytics-session-v1", persisted.session_id);
  storage.setItem("lanjifyw-product-entry-v1", String(Date.now() - 1_000));
  storage.setItem("lanjifyw-first-insight-v1", "0");
  storage.setItem("lanjifyw-analytics-events-v1", JSON.stringify([persisted]));
  const event = trackEvent("region_select", { result_count: 2 });
  assert.equal(event.session_id, persisted.session_id);
  assert.equal(event.payload.first_insight, undefined);
  assert.deepEqual(readSessionAnalytics().map(item => item.id), [persisted.id, event.id]);
});

test("corrupt and non-array queue JSON never interrupts tracking or escapes the queue reader", () => {
  for (const raw of ["{", "{}", "null", "42", "true", '"text"', "[null, 2, {}, []]"]) {
    const storage = installBrowser();
    resetSessionAnalytics();
    storage.setItem("lanjifyw-analytics-events-v1", raw);
    assert.deepEqual(readSessionAnalytics(), [], raw);
    let event;
    assert.doesNotThrow(() => { event = trackEvent("dataset_upload_start", { source: "corrupt_queue" }); }, raw);
    assert.deepEqual(readSessionAnalytics().map(item => item.id), [event.id], raw);
    assert.ok(Array.isArray(JSON.parse(storage.getItem("lanjifyw-analytics-events-v1"))), raw);
  }
});
