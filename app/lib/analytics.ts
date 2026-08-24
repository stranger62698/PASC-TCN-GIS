export const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "demo_start",
  "dataset_upload_start",
  "dataset_upload_success",
  "dataset_upload_fail",
  "dataset_loaded",
  "point_click",
  "region_select",
  "filter_apply",
  "pattern_view_switch",
  "ai_analysis_start",
  "ai_analysis_success",
  "ai_analysis_fail",
  "statistics_open",
  "analysis_export",
] as const;

export type AnalyticsEventName = typeof ANALYTICS_EVENT_NAMES[number];
export type AnalyticsValue = string | number | boolean | null;
export type AnalyticsPayload = Record<string, AnalyticsValue>;
export type AnalyticsEvent = {
  id: string;
  name: AnalyticsEventName;
  occurred_at: string;
  session_id: string;
  route: string;
  payload: AnalyticsPayload;
};

const SESSION_KEY = "lanjifyw-analytics-session-v1";
const START_KEY = "lanjifyw-product-entry-v1";
const FIRST_INSIGHT_KEY = "lanjifyw-first-insight-v1";
const EVENT_QUEUE_KEY = "lanjifyw-analytics-events-v1";
export const FIRST_INSIGHT_TARGET_MS = 60_000;
const SENSITIVE_KEY = /(?:email|password|token|secret|cookie|authorization|csv_content|raw_data|file_name|username)/i;
let lastPageView = "";
const recentEvents = new Map<string, number>();

const safeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const safeStorage = () => typeof window === "undefined" ? null : window.sessionStorage;

function sanitizePayload(payload: AnalyticsPayload): AnalyticsPayload {
  return Object.fromEntries(Object.entries(payload).flatMap(([key, value]) => {
    if (SENSITIVE_KEY.test(key) || !["string", "number", "boolean"].includes(typeof value) && value !== null) return [];
    if (typeof value === "string") return [[key, value.slice(0, 160)]];
    if (typeof value === "number" && !Number.isFinite(value)) return [[key, null]];
    return [[key, value]];
  }));
}

function ensureSession() {
  const storage = safeStorage();
  if (!storage) return { sessionId: "server", startedAt: Date.now() };
  let sessionId = storage.getItem(SESSION_KEY);
  if (!sessionId) { sessionId = safeId(); storage.setItem(SESSION_KEY, sessionId); }
  let startedAt = Number(storage.getItem(START_KEY));
  if (!Number.isFinite(startedAt) || startedAt <= 0) { startedAt = Date.now(); storage.setItem(START_KEY, String(startedAt)); }
  return { sessionId, startedAt };
}

function firstInsightPayload(name: AnalyticsEventName, payload: AnalyticsPayload, startedAt: number) {
  const storage = safeStorage();
  const resultCount = Number(payload.result_count ?? (name === "point_click" ? 1 : 0));
  if (!storage || storage.getItem(FIRST_INSIGHT_KEY) || !["point_click", "region_select"].includes(name) || resultCount <= 0) return payload;
  const duration = Math.max(0, Date.now() - startedAt);
  storage.setItem(FIRST_INSIGHT_KEY, String(duration));
  return { ...payload, first_insight: true, time_to_first_insight_ms: duration, within_60s_target: duration <= FIRST_INSIGHT_TARGET_MS };
}

export function trackEvent(name: AnalyticsEventName, rawPayload: AnalyticsPayload = {}): AnalyticsEvent | null {
  if (typeof window === "undefined") return null;
  const route = `${window.location.pathname}${window.location.search}`;
  if (name === "page_view" && lastPageView === route) return null;
  if (name === "page_view") lastPageView = route;
  const signature = `${name}:${route}:${JSON.stringify(rawPayload)}`;
  const now = Date.now(), previous = recentEvents.get(signature) || 0;
  if (now - previous < 400) return null;
  recentEvents.set(signature, now);
  const { sessionId, startedAt } = ensureSession();
  const payload = sanitizePayload(firstInsightPayload(name, rawPayload, startedAt));
  const event: AnalyticsEvent = { id: safeId(), name, occurred_at: new Date().toISOString(), session_id: sessionId, route, payload };
  const storage = safeStorage();
  if (storage) {
    let queue: AnalyticsEvent[] = [];
    try { queue = JSON.parse(storage.getItem(EVENT_QUEUE_KEY) || "[]") as AnalyticsEvent[]; } catch { queue = []; }
    storage.setItem(EVENT_QUEUE_KEY, JSON.stringify([...queue.slice(-99), event]));
  }
  window.dispatchEvent(new CustomEvent("lanjifyw:analytics", { detail: event }));
  if (process.env.NODE_ENV !== "production") console.table([{ event: name, route, ...payload }]);
  return event;
}

export function readSessionAnalytics(): AnalyticsEvent[] {
  const storage = safeStorage();
  if (!storage) return [];
  try { return JSON.parse(storage.getItem(EVENT_QUEUE_KEY) || "[]") as AnalyticsEvent[]; } catch { return []; }
}

export function resetSessionAnalytics() {
  const storage = safeStorage();
  if (!storage) return;
  [SESSION_KEY, START_KEY, FIRST_INSIGHT_KEY, EVENT_QUEUE_KEY].forEach((key) => storage.removeItem(key));
  lastPageView = "";
  recentEvents.clear();
}
