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
  "pattern_visibility_filter",
  "mode_legend_filter",
  "data_backed_case_open",
  "ai_analysis_start",
  "ai_analysis_success",
  "ai_analysis_fail",
  "ai_analysis_prepare",
  "ai_analysis_import",
  "field_observation_add",
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
type AnalyticsSession = { sessionId: string; startedAt: number; firstInsight: number | null; queue: AnalyticsEvent[] };
let currentSession: AnalyticsSession | null = null;
let ignoreStoredSession = false;

const safeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const safeStorage = (): Storage | null => {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
};

function sanitizePayload(payload: AnalyticsPayload): AnalyticsPayload {
  return Object.fromEntries(Object.entries(payload).flatMap<[string, AnalyticsValue]>(([key, value]) => {
    if (SENSITIVE_KEY.test(key) || !["string", "number", "boolean"].includes(typeof value) && value !== null) return [];
    if (typeof value === "string") return [[key, value.slice(0, 160)]];
    if (typeof value === "number" && !Number.isFinite(value)) return [[key, null]];
    return [[key, value]];
  }));
}

function readQueue(raw: string | null): AnalyticsEvent[] {
  try {
    const value: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap<AnalyticsEvent>(item => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || typeof item.session_id !== "string"
        || typeof item.route !== "string" || typeof item.occurred_at !== "string" || !ANALYTICS_EVENT_NAMES.includes(item.name)
        || !item.payload || typeof item.payload !== "object" || Array.isArray(item.payload)) return [];
      return [{ id: item.id, name: item.name, occurred_at: item.occurred_at, session_id: item.session_id,
        route: item.route, payload: sanitizePayload(item.payload) }];
    }).slice(-100);
  } catch { return []; }
}

function ensureSession(): AnalyticsSession {
  if (currentSession) return currentSession;
  let session: AnalyticsSession = { sessionId: safeId(), startedAt: Date.now(), firstInsight: null, queue: [] };
  const storage = safeStorage();
  if (storage && !ignoreStoredSession) {
    try {
      // Read one complete snapshot before adopting any persisted session state.
      const storedId = storage.getItem(SESSION_KEY), storedStart = storage.getItem(START_KEY);
      const storedInsight = storage.getItem(FIRST_INSIGHT_KEY), storedQueue = storage.getItem(EVENT_QUEUE_KEY);
      const startedAt = Number(storedStart), insight = storedInsight === null ? null : Number(storedInsight);
      session = { sessionId: storedId || session.sessionId, startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : session.startedAt,
        firstInsight: storedId && insight !== null && Number.isFinite(insight) && insight >= 0 ? insight : null, queue: readQueue(storedQueue) };
    } catch { /* Storage is optional; keep the complete in-memory session. */ }
  }
  // Later storage recovery must not replace this page's identity or first-insight marker.
  currentSession = session;
  return session;
}

function persistSession(session: AnalyticsSession) {
  const storage = safeStorage();
  if (!storage) return;
  const entries: Array<[string, string | null]> = [[SESSION_KEY, session.sessionId], [START_KEY, String(session.startedAt)],
    [FIRST_INSIGHT_KEY, session.firstInsight === null ? null : String(session.firstInsight)], [EVENT_QUEUE_KEY, JSON.stringify(session.queue)]];
  for (const [key, value] of entries) {
    try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch { /* Quota and security errors must not interrupt product actions. */ }
  }
}

function firstInsightPayload(name: AnalyticsEventName, payload: AnalyticsPayload, session: AnalyticsSession) {
  const resultCount = Number(payload.result_count ?? (name === "point_click" ? 1 : 0));
  if (session.firstInsight !== null || !["point_click", "region_select"].includes(name) || resultCount <= 0) return payload;
  const duration = Math.max(0, Date.now() - session.startedAt);
  session.firstInsight = duration;
  return { ...payload, first_insight: true, time_to_first_insight_ms: duration, within_60s_target: duration <= FIRST_INSIGHT_TARGET_MS };
}

export function trackEvent(name: AnalyticsEventName, rawPayload: AnalyticsPayload = {}): AnalyticsEvent | null {
  if (typeof window === "undefined") return null;
  try {
    const route = `${window.location.pathname}${window.location.search}`;
    if (name === "page_view" && lastPageView === route) return null;
    if (name === "page_view") lastPageView = route;
    const cleanPayload = sanitizePayload(rawPayload);
    const signature = `${name}:${route}:${JSON.stringify(cleanPayload)}`;
    const now = Date.now(), previous = recentEvents.get(signature) || 0;
    if (now - previous < 400) return null;
    recentEvents.set(signature, now);
    const session = ensureSession(), payload = firstInsightPayload(name, cleanPayload, session);
    const event: AnalyticsEvent = { id: safeId(), name, occurred_at: new Date().toISOString(), session_id: session.sessionId, route, payload };
    session.queue = [...session.queue.slice(-99), event];
    persistSession(session);
    try { window.dispatchEvent(new CustomEvent("lanjifyw:analytics", { detail: event })); } catch { /* Analytics observers are optional too. */ }
    try { if (process.env.NODE_ENV !== "production") console.table([{ event: name, route, ...payload }]); } catch { /* No browser console is required. */ }
    return event;
  } catch { return null; }
}

export function readSessionAnalytics(): AnalyticsEvent[] {
  if (typeof window === "undefined") return [];
  return ensureSession().queue.map(event => ({ ...event, payload: { ...event.payload } }));
}

export function resetSessionAnalytics() {
  currentSession = null;
  lastPageView = "";
  recentEvents.clear();
  const storage = safeStorage();
  ignoreStoredSession = !storage;
  for (const key of [SESSION_KEY, START_KEY, FIRST_INSIGHT_KEY, EVENT_QUEUE_KEY]) {
    try { storage?.removeItem(key); } catch { ignoreStoredSession = true; }
  }
}
