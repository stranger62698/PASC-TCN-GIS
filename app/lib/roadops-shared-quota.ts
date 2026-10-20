import { createHash, randomUUID } from "node:crypto";
import type { RoadOpsDrivingUsage } from "./roadops-driving.js";

export type SharedQuotaStore = {
  read(): Promise<{ etag: string; value: unknown } | null>;
  /** false must mean a definite precondition conflict, never an uncertain write. */
  compareAndSwap(etag: string | null, value: unknown): Promise<boolean>;
};

export class SharedQuotaError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = "SharedQuotaError";
  }
}

type Lease = {
  id: string;
  identityHash: string;
  date: string;
  reservedRequests: number;
  remainingRequests: number;
  expiresAt: number;
};

type Ledger = {
  schemaVersion: "roadops-shared-quota-v1";
  date: string;
  dailyUsed: number;
  identities: Record<string, number>;
  lastAttemptAt: number | null;
  generation: number;
  lease: Lease | null;
};

type Options = {
  store: SharedQuotaStore;
  now?: () => number;
  makeId?: () => string;
  dailyBudget?: number;
  perIdentityLimit?: number;
  minimumGapMs?: number;
  leaseMs?: number;
};

const SCHEMA = "roadops-shared-quota-v1";
const MAX_CAS_ATTEMPTS = 8;
const SEND_WINDOW_MS = 20_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN = /^[A-Za-z0-9:_-]{1,120}$/;
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const unavailable = () => new SharedQuotaError("ROADOPS_QUOTA_UNAVAILABLE", 503, "共享驾车额度暂不可用，未继续发送供应商请求。");
const corrupt = () => new SharedQuotaError("ROADOPS_QUOTA_CORRUPT", 503, "共享驾车额度记录无效，未继续发送供应商请求。");
const limited = (code: string, message: string) => new SharedQuotaError(code, 429, message);

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function parseLedger(value: unknown): Ledger {
  if (!object(value) || !exactKeys(value, ["schemaVersion", "date", "dailyUsed", "identities", "lastAttemptAt", "generation", "lease"]) || value.schemaVersion !== SCHEMA || !validDate(value.date) || !integer(value.dailyUsed) || value.dailyUsed > 100 || !object(value.identities) || (value.lastAttemptAt !== null && !integer(value.lastAttemptAt)) || !integer(value.generation)) throw corrupt();
  const identities: Record<string, number> = {};
  let sum = 0;
  for (const [hash, count] of Object.entries(value.identities)) {
    if (!HASH.test(hash) || !integer(count) || count < 1 || count > 20) throw corrupt();
    identities[hash] = count;
    sum += count;
  }
  if (sum !== value.dailyUsed || Object.keys(identities).length > 100) throw corrupt();
  let lease: Lease | null = null;
  if (value.lease !== null) {
    const item = value.lease;
    if (!object(item) || !exactKeys(item, ["id", "identityHash", "date", "reservedRequests", "remainingRequests", "expiresAt"]) || typeof item.id !== "string" || !TOKEN.test(item.id) || typeof item.identityHash !== "string" || !HASH.test(item.identityHash) || !validDate(item.date) || item.date > value.date || !integer(item.reservedRequests) || item.reservedRequests < 1 || item.reservedRequests > 3 || !integer(item.remainingRequests) || item.remainingRequests > item.reservedRequests || !integer(item.expiresAt) || item.expiresAt < 1 || value.generation < 1 || !item.id.startsWith(`${value.generation}:`)) throw corrupt();
    if (item.date === value.date && (identities[item.identityHash] ?? 0) < item.reservedRequests) throw corrupt();
    lease = { id: item.id, identityHash: item.identityHash, date: item.date, reservedRequests: item.reservedRequests, remainingRequests: item.remainingRequests, expiresAt: item.expiresAt };
  }
  return { schemaVersion: SCHEMA, date: value.date, dailyUsed: value.dailyUsed, identities, lastAttemptAt: value.lastAttemptAt, generation: value.generation, lease };
}

function option(value: number | undefined, fallback: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!integer(value) || value < minimum) throw new SharedQuotaError("ROADOPS_QUOTA_BAD_CONFIG", 503, "共享驾车额度配置无效。");
  return Math.min(value, maximum);
}

function identityHash(identity: string) {
  if (typeof identity !== "string" || !identity.trim() || identity.length > 4_096) throw new SharedQuotaError("ROADOPS_QUOTA_BAD_IDENTITY", 400, "驾车额度身份无效。");
  return createHash("sha256").update(identity).digest("hex");
}

export function createSharedRoadOpsQuota(options: Options) {
  const { store, now = Date.now, makeId = randomUUID } = options;
  const dailyBudget = option(options.dailyBudget, 100, 1, 100);
  const perIdentityLimit = option(options.perIdentityLimit, 20, 1, 20);
  const minimumGapMs = option(options.minimumGapMs, 1_000, 1_000);
  const leaseMs = option(options.leaseMs, 180_000, SEND_WINDOW_MS + 1);
  let hasSeenLedger = false;

  const clock = () => {
    let timestamp: number;
    try { timestamp = now(); } catch { throw unavailable(); }
    if (!integer(timestamp) || timestamp > 8_640_000_000_000_000 - SHANGHAI_OFFSET_MS) throw unavailable();
    const date = new Date(timestamp + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
    if (!validDate(date)) throw unavailable();
    return { timestamp, date };
  };

  const transact = async <T>(operation: (ledger: Ledger, timestamp: number, date: string) => { changed: boolean; result: T }, requireExisting = false): Promise<T> => {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      let stored: Awaited<ReturnType<SharedQuotaStore["read"]>>;
      try { stored = await store.read(); } catch { throw unavailable(); }
      const { timestamp, date } = clock();
      let ledger: Ledger;
      let changed = false;
      if (stored === null) {
        if (requireExisting || hasSeenLedger) throw unavailable();
        ledger = { schemaVersion: SCHEMA, date, dailyUsed: 0, identities: {}, lastAttemptAt: null, generation: 0, lease: null };
        changed = true;
      } else {
        hasSeenLedger = true;
        if (!object(stored) || typeof stored.etag !== "string" || !stored.etag) throw corrupt();
        ledger = parseLedger(stored.value);
        if (ledger.date > date || (ledger.lastAttemptAt !== null && ledger.lastAttemptAt > timestamp)) throw unavailable();
        if (ledger.date < date) {
          ledger.date = date;
          ledger.dailyUsed = 0;
          ledger.identities = {};
          changed = true;
        }
        if (ledger.lease !== null && ledger.lease.expiresAt <= timestamp) {
          // An expired owner may already have sent its requests. Never refund it.
          ledger.lease = null;
          changed = true;
        }
      }
      const result = operation(ledger, timestamp, date);
      if (!changed && !result.changed) return result.result;
      let swapped: boolean;
      try { swapped = await store.compareAndSwap(stored?.etag ?? null, ledger); } catch {
        // Creation may have committed even when its response was lost. A later
        // missing read in this instance must never replace that ledger with zero.
        hasSeenLedger = true;
        throw unavailable();
      }
      if (swapped !== true && swapped !== false) throw unavailable();
      if (swapped) {
        hasSeenLedger = true;
        return result.result;
      }
    }
    throw limited("ROADOPS_QUOTA_CONFLICT", "共享驾车额度繁忙，请稍后重试。");
  };

  const usage = async (identity: string): Promise<RoadOpsDrivingUsage> => {
    const hash = identityHash(identity);
    return transact(ledger => ({ changed: false, result: { cached: false, upstreamRequests: 0, dailyUsed: ledger.dailyUsed, dailyBudget, dailyRemaining: Math.max(0, dailyBudget - ledger.dailyUsed), perIdentityUsed: ledger.identities[hash] ?? 0, perIdentityLimit } }));
  };

  const reserve = async (identity: string, requests: number) => {
    const hash = identityHash(identity);
    if (!integer(requests) || requests < 1 || requests > 3) throw new SharedQuotaError("ROADOPS_QUOTA_BAD_REQUEST", 400, "单次路线仅可预留一至三次供应商请求。");
    const granted = await transact((ledger, timestamp, date) => {
      if (ledger.lease) throw limited("ROADOPS_QUOTA_BUSY", "另一路线正在调用供应商，请稍后重试。");
      if (ledger.dailyUsed + requests > dailyBudget) throw limited("ROADOPS_QUOTA_DAILY_EXHAUSTED", "今日共享驾车额度不足。");
      if ((ledger.identities[hash] ?? 0) + requests > perIdentityLimit) throw limited("ROADOPS_QUOTA_IDENTITY_EXHAUSTED", "今日个人驾车额度不足。");
      if (ledger.generation >= Number.MAX_SAFE_INTEGER || timestamp > Number.MAX_SAFE_INTEGER - leaseMs) throw unavailable();
      let token: string;
      try { token = makeId(); } catch { throw unavailable(); }
      if (typeof token !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(token)) throw unavailable();
      // The persisted generation prevents a stale handle from owning a later lease,
      // including when an injected ID source accidentally repeats a value.
      ledger.generation += 1;
      const lease: Lease = { id: `${ledger.generation}:${createHash("sha256").update(token).digest("hex")}`, identityHash: hash, date, reservedRequests: requests, remainingRequests: requests, expiresAt: timestamp + leaseMs };
      ledger.dailyUsed += requests;
      ledger.identities[hash] = (ledger.identities[hash] ?? 0) + requests;
      ledger.lease = lease;
      return { changed: true, result: { id: lease.id, date, expiresAt: lease.expiresAt } };
    });
    let closed = false;

    const beforeAttempt = async () => {
      if (closed) throw limited("ROADOPS_QUOTA_LEASE_INVALID", "驾车请求额度预留已关闭。");
      const authorizedAt = await transact((ledger, timestamp, date) => {
        const lease = ledger.lease;
        if (date !== granted.date || !lease || lease.id !== granted.id || lease.identityHash !== hash || lease.date !== date || lease.expiresAt - timestamp < SEND_WINDOW_MS) throw limited("ROADOPS_QUOTA_LEASE_INVALID", "驾车请求额度预留已失效。");
        if (lease.remainingRequests < 1) throw limited("ROADOPS_QUOTA_ATTEMPTS_EXHAUSTED", "当前路线的供应商请求次数已用尽。");
        if (ledger.lastAttemptAt !== null && timestamp - ledger.lastAttemptAt < minimumGapMs) throw limited("ROADOPS_QUOTA_RATE_LIMITED", "供应商请求间隔不足，请稍后重试。");
        lease.remainingRequests -= 1;
        ledger.lastAttemptAt = timestamp;
        return { changed: true, result: timestamp };
      }, true);
      const { timestamp, date } = clock();
      if (timestamp < authorizedAt) throw unavailable();
      // A successful but slow write still consumes one attempt. Do not send if
      // its day or safe transport window elapsed while persisting permission.
      if (closed || date !== granted.date || granted.expiresAt - timestamp < SEND_WINDOW_MS) throw limited("ROADOPS_QUOTA_LEASE_INVALID", "驾车请求额度预留已失效。");
    };

    const close = async () => {
      if (closed) return;
      await transact((ledger, timestamp) => {
        const lease = ledger.lease;
        if (!lease || lease.id !== granted.id || lease.identityHash !== hash) return { changed: false, result: undefined };
        if (lease.date === ledger.date) {
          ledger.dailyUsed -= lease.remainingRequests;
          const remaining = ledger.identities[hash] - lease.remainingRequests;
          if (remaining > 0) ledger.identities[hash] = remaining;
          else delete ledger.identities[hash];
        }
        ledger.lease = null;
        ledger.lastAttemptAt = Math.max(ledger.lastAttemptAt ?? 0, timestamp);
        return { changed: true, result: undefined };
      }, true);
      closed = true;
    };

    return { beforeAttempt, close };
  };

  return { reserve, usage };
}
