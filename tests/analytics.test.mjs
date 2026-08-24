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

test("Phase 9 exposes the complete minimum event set", () => {
  assert.deepEqual(ANALYTICS_EVENT_NAMES, [
    "page_view", "demo_start", "dataset_upload_start", "dataset_upload_success", "dataset_upload_fail", "dataset_loaded",
    "point_click", "region_select", "filter_apply", "pattern_view_switch", "ai_analysis_start", "ai_analysis_success",
    "ai_analysis_fail", "statistics_open", "analysis_export",
  ]);
  assert.equal(FIRST_INSIGHT_TARGET_MS, 60_000);
});

test("first valid point or region result records Time to First Insight once", () => {
  const storage = installBrowser();
  resetSessionAnalytics();
  trackEvent("page_view", { page: "/map" });
  storage.setItem("lanjifyw-product-entry-v1", String(Date.now() - 2_000));
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
