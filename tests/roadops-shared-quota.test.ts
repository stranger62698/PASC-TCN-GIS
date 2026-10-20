import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createSharedRoadOpsQuota, SharedQuotaError, type SharedQuotaStore } from "../app/lib/roadops-shared-quota.js";

class MemoryStore implements SharedQuotaStore {
  value: unknown | null = null;
  revision = 0;
  reads = 0;
  writes: Array<{ etag: string | null; value: unknown }> = [];
  conflicts = 0;
  failRead = false;
  failWrite: "before" | "after" | null = null;
  afterWrite: (() => void) | null = null;

  async read(): Promise<{ etag: string; value: unknown } | null> {
    this.reads += 1;
    if (this.failRead) throw new Error("private storage credential");
    return this.value === null ? null : { etag: String(this.revision), value: structuredClone(this.value) };
  }

  async compareAndSwap(etag: string | null, value: unknown) {
    this.writes.push({ etag, value: structuredClone(value) });
    if (this.failWrite === "before") throw new Error("private storage credential");
    if (this.conflicts > 0) { this.conflicts -= 1; return false; }
    if (etag !== (this.value === null ? null : String(this.revision))) return false;
    this.value = structuredClone(value);
    this.revision += 1;
    this.afterWrite?.();
    if (this.failWrite === "after") throw new Error("write response lost");
    return true;
  }
}

const start = Date.UTC(2026, 9, 9, 4);
const isError = (code: string, status = 429) => (error: unknown) => error instanceof SharedQuotaError && error.code === code && error.status === status;
const setup = (options: Partial<Parameters<typeof createSharedRoadOpsQuota>[0]> = {}) => {
  const store = new MemoryStore();
  let timestamp = start;
  const now = () => timestamp;
  const quota = createSharedRoadOpsQuota({ store, now, ...options });
  return { store, quota, now, advance: (milliseconds: number) => { timestamp += milliseconds; }, setTime: (milliseconds: number) => { timestamp = milliseconds; } };
};
const ledger = (store: MemoryStore) => store.value as { date: string; dailyUsed: number; lastAttemptAt: number | null; lease: { id: string; remainingRequests: number } | null; identities: Record<string, number> };

test("multiple instances atomically precharge one global lease and create only with null CAS", async () => {
  const context = setup();
  const second = createSharedRoadOpsQuota({ store: context.store, now: context.now });
  const results = await Promise.allSettled([context.quota.reserve("alice", 3), second.reserve("bob", 2)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(isError("ROADOPS_QUOTA_BUSY")(rejected.reason));
  assert.equal(context.store.writes.filter(write => write.etag === null).length, 2);
  assert.equal((await second.usage("alice")).dailyUsed, 3);
  assert.equal((await second.usage("bob")).perIdentityUsed, 0);
  await (results[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof second.reserve>>>).value.close();
  assert.equal((await second.usage("alice")).dailyUsed, 0);
});

test("close refunds only unused reservation and is idempotent", async () => {
  const { quota, store } = setup();
  const reservation = await quota.reserve("alice", 3);
  assert.equal((await quota.usage("alice")).dailyUsed, 3);
  await reservation.beforeAttempt();
  await reservation.close();
  await reservation.close();
  assert.deepEqual(await quota.usage("alice"), { cached: false, upstreamRequests: 0, dailyUsed: 1, dailyBudget: 100, dailyRemaining: 99, perIdentityUsed: 1, perIdentityLimit: 20 });
  assert.equal(ledger(store).lease, null);
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_LEASE_INVALID"));
});

test("every attempt needs a distinct CAS and at least 1000ms global spacing", async () => {
  const { quota, store, advance } = setup();
  const reservation = await quota.reserve("alice", 3);
  await reservation.beforeAttempt();
  advance(999);
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_RATE_LIMITED"));
  assert.equal(ledger(store).lease?.remainingRequests, 2);
  advance(1);
  await reservation.beforeAttempt();
  advance(1_000);
  await reservation.beforeAttempt();
  advance(1_000);
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_ATTEMPTS_EXHAUSTED"));
  await reservation.close();
  assert.equal((await quota.usage("alice")).dailyUsed, 3);
});

test("release persists a cooldown for the next instance after the preceding fetch", async () => {
  const context = setup();
  const first = await context.quota.reserve("alice", 1);
  await first.beforeAttempt();
  context.advance(5_000);
  await first.close();
  assert.equal(ledger(context.store).lastAttemptAt, context.now());
  const second = createSharedRoadOpsQuota({ store: context.store, now: context.now });
  const next = await second.reserve("bob", 1);
  context.advance(999);
  await assert.rejects(next.beforeAttempt(), isError("ROADOPS_QUOTA_RATE_LIMITED"));
  context.advance(1);
  await next.beforeAttempt();
  await next.close();
});

test("lower configured budgets protect both the daily pool and identity buckets", async () => {
  const { quota, advance } = setup({ dailyBudget: 3, perIdentityLimit: 2 });
  const reservation = await quota.reserve("alice", 2);
  await reservation.beforeAttempt();
  advance(1_000);
  await reservation.beforeAttempt();
  await reservation.close();
  await assert.rejects(quota.reserve("alice", 1), isError("ROADOPS_QUOTA_IDENTITY_EXHAUSTED"));
  advance(1_000);
  const other = await quota.reserve("bob", 1);
  await other.beforeAttempt();
  await other.close();
  await assert.rejects(quota.reserve("charlie", 1), isError("ROADOPS_QUOTA_DAILY_EXHAUSTED"));
  assert.equal((await quota.usage("bob")).dailyRemaining, 0);
});

test("configured upper bounds cannot raise the default 100 total or 20 per identity", async () => {
  const { quota, advance } = setup({ dailyBudget: 1_000, perIdentityLimit: 1_000 });
  for (let user = 0; user < 5; user += 1) {
    for (let count = 0; count < 20; count += 1) {
      const reservation = await quota.reserve(`user-${user}`, 1);
      await reservation.beforeAttempt();
      await reservation.close();
      advance(1_000);
    }
    if (user < 4) await assert.rejects(quota.reserve(`user-${user}`, 1), isError("ROADOPS_QUOTA_IDENTITY_EXHAUSTED"));
  }
  await assert.rejects(quota.reserve("new-user", 1), isError("ROADOPS_QUOTA_DAILY_EXHAUSTED"));
  assert.deepEqual(await quota.usage("user-0"), { cached: false, upstreamRequests: 0, dailyUsed: 100, dailyBudget: 100, dailyRemaining: 0, perIdentityUsed: 20, perIdentityLimit: 20 });
});

test("definite CAS conflicts retry from the latest state but stop after eight writes", async () => {
  const { quota, store } = setup();
  store.conflicts = 2;
  const reservation = await quota.reserve("alice", 2);
  assert.equal(store.writes.length, 3);
  assert.equal((await quota.usage("alice")).dailyUsed, 2);
  await reservation.close();
  store.conflicts = 9;
  const prior = store.writes.length;
  await assert.rejects(quota.reserve("bob", 1), isError("ROADOPS_QUOTA_CONFLICT"));
  assert.equal(store.writes.length - prior, 8);
  assert.equal(ledger(store).dailyUsed, 0);
});

test("read and write failures fail closed without leaking underlying error details", async () => {
  const { quota, store } = setup();
  store.failRead = true;
  await assert.rejects(quota.reserve("alice", 3), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  await assert.rejects(quota.usage("alice"), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.equal(store.writes.length, 0);
  store.failRead = false;
  store.failWrite = "before";
  await assert.rejects(quota.reserve("alice", 3), error => {
    assert.ok(isError("ROADOPS_QUOTA_UNAVAILABLE", 503)(error));
    assert.doesNotMatch(String(error), /credential/);
    return true;
  });
  assert.equal(store.writes.length, 1);
  assert.equal(store.value, null);
});

test("uncertain committed reservation is not retried or refunded", async () => {
  const { quota, store, advance } = setup();
  store.failWrite = "after";
  await assert.rejects(quota.reserve("alice", 3), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.equal(store.writes.length, 1);
  store.failWrite = null;
  assert.equal((await quota.usage("alice")).dailyUsed, 3);
  await assert.rejects(quota.reserve("bob", 1), isError("ROADOPS_QUOTA_BUSY"));
  advance(180_000);
  assert.equal((await quota.usage("alice")).dailyUsed, 3);
});

test("uncertain committed attempt consumes its unit even though sending was refused", async () => {
  const { quota, store } = setup();
  const reservation = await quota.reserve("alice", 3);
  store.failWrite = "after";
  const prior = store.writes.length;
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.equal(store.writes.length - prior, 1);
  store.failWrite = null;
  await reservation.close();
  assert.equal((await quota.usage("alice")).dailyUsed, 1);
});

test("expired lease never refunds unknown attempts and a stale handle cannot release its successor", async () => {
  const { quota, store, advance } = setup({ makeId: () => "repeated-id" });
  const old = await quota.reserve("alice", 3);
  const oldId = ledger(store).lease?.id;
  advance(180_000);
  const next = await quota.reserve("alice", 2);
  assert.notEqual(ledger(store).lease?.id, oldId);
  await assert.rejects(old.beforeAttempt(), isError("ROADOPS_QUOTA_LEASE_INVALID"));
  await old.close();
  assert.equal((await quota.usage("alice")).dailyUsed, 5);
  assert.equal(ledger(store).lease?.remainingRequests, 2);
  await next.close();
  assert.equal((await quota.usage("alice")).dailyUsed, 3);
});

test("Shanghai midnight resets counters while preserving an active global lease and pacing", async () => {
  const context = setup();
  context.setTime(Date.UTC(2026, 9, 9, 15, 59, 59));
  const old = await context.quota.reserve("alice", 3);
  await old.beforeAttempt();
  const oldId = ledger(context.store).lease?.id;
  context.advance(1_000);
  const other = createSharedRoadOpsQuota({ store: context.store, now: context.now });
  assert.equal((await other.usage("alice")).dailyUsed, 0);
  assert.equal(ledger(context.store).date, "2026-10-10");
  assert.equal(ledger(context.store).lease?.id, oldId);
  await assert.rejects(other.reserve("bob", 2), isError("ROADOPS_QUOTA_BUSY"));
  await assert.rejects(old.beforeAttempt(), isError("ROADOPS_QUOTA_LEASE_INVALID"));
  await old.close();
  assert.equal((await other.usage("alice")).dailyUsed, 0);
  const next = await other.reserve("bob", 2);
  await assert.rejects(next.beforeAttempt(), isError("ROADOPS_QUOTA_RATE_LIMITED"));
  context.advance(1_000);
  await next.beforeAttempt();
  await next.close();
  assert.equal((await other.usage("bob")).dailyUsed, 1);
});

test("corrupt ledger fields and extra private information are rejected without overwriting", async () => {
  const { quota, store } = setup();
  await quota.usage("alice");
  const valid = structuredClone(store.value) as Record<string, unknown>;
  const corruptions = [
    null,
    {},
    { ...valid, schemaVersion: "old-version" },
    { ...valid, date: "2026-02-30" },
    { ...valid, dailyUsed: 1 },
    { ...valid, identities: { alice: 1 }, dailyUsed: 1 },
    { ...valid, lastAttemptAt: "yesterday" },
    { ...valid, generation: -1 },
    { ...valid, coordinates: [110.47, 20.03] },
    { ...valid, lease: {} },
  ];
  for (const malformed of corruptions) {
    // null represents a disappeared record and is separately rejected after creation.
    store.value = malformed;
    const prior = store.writes.length;
    const code = malformed === null ? "ROADOPS_QUOTA_UNAVAILABLE" : "ROADOPS_QUOTA_CORRUPT";
    await assert.rejects(quota.reserve("alice", 1), isError(code, 503));
    await assert.rejects(quota.usage("alice"), isError(code, 503));
    assert.equal(store.writes.length, prior);
    assert.deepEqual(store.value, malformed);
  }
});

test("missing storage after reservation cannot be reinitialized by its handle", async () => {
  const { quota, store } = setup();
  const reservation = await quota.reserve("alice", 3);
  store.value = null;
  const prior = store.writes.length;
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  await assert.rejects(reservation.close(), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  await assert.rejects(quota.usage("alice"), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.equal(store.writes.length, prior);
});

test("ledger stores only a hash of identity and never raw identity, coordinates, or key", async () => {
  const { quota, store } = setup({ makeId: () => "private-provider-key" });
  const identity = "alice@example.test/110.47,20.03/private-provider-key";
  const reservation = await quota.reserve(identity, 2);
  const hash = createHash("sha256").update(identity).digest("hex");
  assert.equal(ledger(store).identities[hash], 2);
  const serialized = JSON.stringify(store.value);
  assert.doesNotMatch(serialized, /alice@example|110\.47|20\.03|private-provider-key/);
  await reservation.beforeAttempt();
  await reservation.close();
  assert.equal((await quota.usage(identity)).perIdentityUsed, 1);
});

test("beforeAttempt requires 20 seconds remaining before and after its permission write", async () => {
  const context = setup({ leaseMs: 30_000 });
  const first = await context.quota.reserve("alice", 3);
  context.advance(10_001);
  await assert.rejects(first.beforeAttempt(), isError("ROADOPS_QUOTA_LEASE_INVALID"));
  assert.equal(ledger(context.store).lease?.remainingRequests, 3);
  await first.close();
  context.advance(1_000);
  const second = await context.quota.reserve("bob", 3);
  context.store.afterWrite = () => { context.advance(10_001); };
  await assert.rejects(second.beforeAttempt(), isError("ROADOPS_QUOTA_LEASE_INVALID"));
  context.store.afterWrite = null;
  assert.equal(ledger(context.store).lease?.remainingRequests, 2);
  await second.close();
  assert.equal((await context.quota.usage("bob")).dailyUsed, 1);
});

test("permission committed across midnight cannot send or shift its old reservation into the new day", async () => {
  const context = setup();
  context.setTime(Date.UTC(2026, 9, 9, 15, 59, 59));
  const reservation = await context.quota.reserve("alice", 3);
  context.store.afterWrite = () => { context.advance(1_000); };
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_LEASE_INVALID"));
  context.store.afterWrite = null;
  assert.equal(ledger(context.store).dailyUsed, 3);
  assert.equal(ledger(context.store).lease?.remainingRequests, 2);
  await reservation.close();
  assert.equal((await context.quota.usage("alice")).dailyUsed, 0);
});

test("failed close conservatively retains unused charge until a successful explicit close", async () => {
  const { quota, store } = setup();
  const reservation = await quota.reserve("alice", 3);
  await reservation.beforeAttempt();
  store.failWrite = "before";
  await assert.rejects(reservation.close(), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  store.failWrite = null;
  assert.equal((await quota.usage("alice")).dailyUsed, 3);
  await reservation.close();
  assert.equal((await quota.usage("alice")).dailyUsed, 1);
});

test("backward clock, weak pacing settings and invalid reservation inputs fail closed", async () => {
  const context = setup();
  const reservation = await context.quota.reserve("alice", 2);
  await reservation.beforeAttempt();
  context.advance(-1);
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.throws(() => createSharedRoadOpsQuota({ store: context.store, minimumGapMs: 999 }), isError("ROADOPS_QUOTA_BAD_CONFIG", 503));
  assert.throws(() => createSharedRoadOpsQuota({ store: context.store, leaseMs: 20_000 }), isError("ROADOPS_QUOTA_BAD_CONFIG", 503));
  for (const requests of [0, 4, -1, 1.5, Number.NaN]) await assert.rejects(context.quota.reserve("alice", requests), isError("ROADOPS_QUOTA_BAD_REQUEST", 400));
  await assert.rejects(context.quota.reserve("", 1), isError("ROADOPS_QUOTA_BAD_IDENTITY", 400));
});

test("clock rolling back during a committed permission write refuses transport", async () => {
  const context = setup();
  const reservation = await context.quota.reserve("alice", 2);
  context.store.afterWrite = () => { context.advance(-1); };
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.equal(ledger(context.store).lease?.remainingRequests, 1);
});

test("rejected CAS cannot mutate a store that returns its live object reference", async () => {
  const context = setup();
  const reservation = await context.quota.reserve("alice", 2);
  context.store.read = async () => ({ etag: String(context.store.revision), value: context.store.value });
  context.store.conflicts = 8;
  await assert.rejects(reservation.beforeAttempt(), isError("ROADOPS_QUOTA_CONFLICT"));
  assert.equal(ledger(context.store).lease?.remainingRequests, 2);
  assert.equal(ledger(context.store).lastAttemptAt, null);
});

test("an uncertain creation cannot be followed by automatic zero-ledger recreation", async () => {
  const { quota, store } = setup();
  store.failWrite = "after";
  await assert.rejects(quota.reserve("alice", 3), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  store.failWrite = null;
  store.value = null;
  const prior = store.writes.length;
  await assert.rejects(quota.usage("alice"), isError("ROADOPS_QUOTA_UNAVAILABLE", 503));
  assert.equal(store.writes.length, prior);
});
