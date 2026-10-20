import assert from "node:assert/strict";
import test from "node:test";
import { parseFieldAccessLog, type FieldAccessCheck, type FieldAccessLog } from "../app/lib/roadops-access-check";
import { createFieldAccessStore, FIELD_ACCESS_DATABASE_NAME, FieldAccessStoreError, type FieldAccessStoreErrorCode } from "../app/lib/roadops-access-store";

/** Local model of serialized transactions, commit isolation and rollback; no browser database is opened. */
class FakeRequest {
  result: unknown;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}
class FakeOpenRequest extends FakeRequest {
  declare result: FakeDatabase;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  transaction: FakeTransaction | null = null;
}
class FakeFactory {
  rows = new Map<string, unknown>();
  names: string[] = [];
  connections: FakeDatabase[] = [];
  hasStore = false;
  keyPath = "planId";
  openMode: "normal" | "blocked" | "error" | "throw" | "future" | "missing_store" | "hang" = "normal";
  failWrite = false;
  failRead = false;
  abortAfterWriteSuccess = false;
  holdCommits = false;
  pendingCommit: FakeTransaction | null = null;
  onCommitPending: (() => void) | null = null;
  transactions: FakeTransaction[] = [];
  active: FakeTransaction | null = null;
  committed = 0;
  openRequest: FakeOpenRequest | null = null;
  asFactory(): IDBFactory { return this as unknown as IDBFactory; }
  open(name: string, version: number): FakeOpenRequest {
    this.names.push(name); assert.equal(version, 1);
    if (this.openMode === "throw") throw new DOMException("Storage disabled", "SecurityError");
    const request = new FakeOpenRequest();
    const database = new FakeDatabase(this);
    this.connections.push(database); request.result = database; this.openRequest = request;
    setTimeout(() => {
      if (this.openMode === "hang") return;
      if (this.openMode === "blocked") { request.onblocked?.(); setTimeout(() => request.onsuccess?.(), 0); return; }
      if (this.openMode === "error" || this.openMode === "future") {
        request.error = new DOMException("Local open failure", this.openMode === "future" ? "VersionError" : "UnknownError"); request.onerror?.(); return;
      }
      if (!this.hasStore && this.openMode !== "missing_store") request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  }
  enqueue(transaction: FakeTransaction) { this.transactions.push(transaction); this.startNext(); }
  startNext() {
    if (this.active) return;
    this.active = this.transactions.shift() ?? null;
    if (this.active) { const transaction = this.active; setTimeout(() => transaction.start(), 0); }
  }
  release(transaction: FakeTransaction) {
    if (this.active === transaction) this.active = null;
    this.transactions = this.transactions.filter(item => item !== transaction);
    if (this.pendingCommit === transaction) this.pendingCommit = null;
    this.startNext();
  }
}
class FakeDatabase {
  closed = false;
  onversionchange: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly factory: FakeFactory) {}
  get objectStoreNames() { return { contains: (name: string) => name === "logs" && this.factory.hasStore }; }
  createObjectStore(name: string, options: { keyPath: string }) {
    assert.equal(name, "logs"); assert.equal(options.keyPath, "planId"); this.factory.hasStore = true;
  }
  transaction(name: string, mode: IDBTransactionMode) {
    assert.equal(name, "logs");
    if (this.closed) throw new DOMException("Connection closed", "InvalidStateError");
    const transaction = new FakeTransaction(this.factory, mode); this.factory.enqueue(transaction); return transaction;
  }
  close() { this.closed = true; }
}
class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  working = new Map<string, unknown>();
  pending: Array<() => void> = [];
  finished = false;
  wrote = false;
  constructor(readonly factory: FakeFactory, readonly mode: IDBTransactionMode) {}
  start() {
    if (this.finished) return;
    this.working = new Map([...this.factory.rows].map(([key, value]) => [key, structuredClone(value)])); this.next();
  }
  request(operation: () => unknown, write = false) {
    if (this.finished) throw new DOMException("Inactive", "TransactionInactiveError");
    const request = new FakeRequest();
    this.pending.push(() => {
      if (write ? this.factory.failWrite : this.factory.failRead) {
        request.error = new DOMException("Local request failed", write ? "QuotaExceededError" : "UnknownError");
        request.onerror?.(); this.onerror?.(); this.abort(); return;
      }
      request.result = structuredClone(operation()); if (write) this.wrote = true; request.onsuccess?.();
    });
    return request;
  }
  next() {
    setTimeout(() => {
      if (this.finished) return;
      const action = this.pending.shift();
      if (action) { action(); this.next(); return; }
      if (this.factory.holdCommits) { this.factory.pendingCommit = this; this.factory.onCommitPending?.(); return; }
      this.complete();
    }, 0);
  }
  complete() {
    if (this.finished) return;
    if (this.wrote && this.factory.abortAfterWriteSuccess) { this.abort(); return; }
    this.finished = true;
    if (this.mode === "readwrite") this.factory.rows = this.working;
    this.factory.committed++; this.oncomplete?.(); this.factory.release(this);
  }
  abort() { if (this.finished) return; this.finished = true; this.onabort?.(); this.factory.release(this); }
  objectStore(name: string) {
    assert.equal(name, "logs");
    return {
      keyPath: this.factory.keyPath,
      get: (key: string) => this.request(() => this.working.get(key)),
      put: (value: FieldAccessLog) => this.request(() => { this.working.set(value.planId, structuredClone(value)); return value.planId; }, true),
    };
  }
}
function check(id = "check-1"): FieldAccessCheck {
  return {
    checkId: id, subject: { kind: "vehicle_stop", stopId: "stop-1" }, dimension: "vehicle_approach", status: "unknown",
    coordinateSnapshot: { vehicleCoordinate: null, targetCoordinate: null }, reviewer: "", checkedAt: null, validUntil: null,
    source: "user_statement", basis: "", evidenceRefs: [], releaseBlockedCheckIds: [], recordedAt: "2026-10-09T01:00:00.000Z",
  };
}
function fixture(planId = "plan-1", count = 1): FieldAccessLog {
  return parseFieldAccessLog({ schemaVersion: "field-access-log-v1", planId, revision: 1, checks: Array.from({ length: count }, (_, index) => check(`check-${index + 1}`)) });
}
function appended(log: FieldAccessLog, id = `check-${log.checks.length + 1}`): FieldAccessLog { return { ...log, checks: [...log.checks, check(id)] }; }
function errorCode(code: FieldAccessStoreErrorCode) {
  return (error: unknown) => error instanceof FieldAccessStoreError && error.code === code
    && error.message.includes("未保存的编辑") && !error.message.includes("plan-1");
}

test("creates only the isolated access DB, strips extra fields and restores historical checks", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const input = { ...fixture("plan-1", 3), revision: 99, providerRouteSnapshot: { opaque: "not-stored" } };
  const saved = await store.save(input, null);
  assert.equal(saved.revision, 1); assert.equal(saved.checks.length, 3);
  assert.equal("providerRouteSnapshot" in (fake.rows.get(saved.planId) as object), false);
  assert.deepEqual(await createFieldAccessStore(fake.asFactory()).get(saved.planId), saved);
  assert.ok(fake.names.every(name => name === FIELD_ACCESS_DATABASE_NAME));
  assert.equal(FIELD_ACCESS_DATABASE_NAME, "lanjifyw-field-access-logs-v1");
  assert.ok(fake.connections.every(connection => connection.closed));
});

test("empty histories may be created and missing plan histories stay absent", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  assert.equal(await store.get("plan-1"), null);
  const saved = await store.save(fixture("plan-1", 0), null);
  assert.deepEqual(saved.checks, []); assert.equal(await store.get("plan-2"), null);
  await assert.rejects(store.save({ ...appended(saved), planId: "plan-2" }, saved.revision), errorCode("conflict"));
  assert.equal(await store.get("plan-2"), null); assert.deepEqual(await store.get("plan-1"), saved);
});

test("save waits for commit after a successful put request", async () => {
  const fake = new FakeFactory(); fake.holdCommits = true;
  const pending = new Promise<void>(resolve => { fake.onCommitPending = resolve; });
  let resolved = false;
  const saving = createFieldAccessStore(fake.asFactory()).save(fixture(), null).then(value => { resolved = true; return value; });
  await pending;
  assert.equal(resolved, false); assert.equal(fake.rows.size, 0);
  fake.pendingCommit!.complete();
  assert.equal((await saving).revision, 1); assert.equal(fake.rows.size, 1);
});

test("put success followed by abort is rejected and never becomes a saved history", async () => {
  const fake = new FakeFactory(); fake.abortAfterWriteSuccess = true;
  await assert.rejects(createFieldAccessStore(fake.asFactory()).save(fixture(), null), errorCode("write_failed"));
  assert.equal(fake.rows.size, 0); assert.ok(fake.connections.every(connection => connection.closed));
});

test("append increments the current revision and rejects stale or invalid tokens", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const first = await store.save(fixture(), null);
  const second = await store.save({ ...appended(first), revision: 900 }, first.revision);
  assert.equal(second.revision, 2); assert.deepEqual(second.checks.slice(0, 1), first.checks);
  await assert.rejects(store.save(appended(first, "check-stale"), first.revision), errorCode("conflict"));
  await assert.rejects(store.save(appended(second), null), errorCode("conflict"));
  for (const revision of [0, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) await assert.rejects(store.save(appended(second), revision), errorCode("conflict"));
  assert.deepEqual(await store.get(first.planId), second);
});

test("existing checks cannot be removed, reordered, rewritten or saved without a new check", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const saved = await store.save(fixture("plan-1", 2), null);
  const changedCoordinate = structuredClone(appended(saved)); changedCoordinate.checks[0].coordinateSnapshot.vehicleCoordinate = [120, 30];
  const changedRefs = structuredClone(appended(saved)); changedRefs.checks[0].evidenceRefs = ["photo-1"];
  const changedIdentity = structuredClone(appended(saved)); changedIdentity.checks[0].checkId = "rewritten-check";
  const attempts = [saved, { ...saved, checks: saved.checks.slice(1) }, { ...saved, checks: [saved.checks[1], saved.checks[0], check("check-3")] }, changedCoordinate, changedRefs, changedIdentity];
  for (const input of attempts) await assert.rejects(store.save(input, saved.revision), errorCode("conflict"));
  assert.deepEqual(await store.get(saved.planId), saved);
});

test("deeply equal history prefixes accept rebuilt nested objects with different key order", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const first = await store.save(fixture(), null); const previous = first.checks[0];
  const rebuilt = { ...previous, subject: { stopId: "stop-1", kind: "vehicle_stop" as const }, coordinateSnapshot: { targetCoordinate: null, vehicleCoordinate: null } };
  const second = await store.save({ ...first, checks: [rebuilt, check("check-2")] }, first.revision);
  assert.equal(second.revision, 2);
});

test("concurrent page appends use atomic compare-and-swap and retain the winning prefix", async () => {
  const fake = new FakeFactory(); const left = createFieldAccessStore(fake.asFactory()); const right = createFieldAccessStore(fake.asFactory());
  const saved = await left.save(fixture(), null);
  const outcomes = await Promise.allSettled([left.save(appended(saved, "check-left"), 1), right.save(appended(saved, "check-right"), 1)]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult;
  assert.ok(errorCode("conflict")(rejected.reason));
  const history = (await left.get(saved.planId))!;
  assert.equal(history.revision, 2); assert.equal(history.checks.length, 2); assert.deepEqual(history.checks[0], saved.checks[0]);
});

test("concurrent creates cannot replace one another", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const outcomes = await Promise.allSettled([store.save(fixture(), null), store.save(fixture("plan-1", 2), null)]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult;
  assert.ok(errorCode("conflict")(rejected.reason)); assert.equal(fake.rows.size, 1);
});

test("quota failures and aborted appends preserve the last committed history", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory()); const saved = await store.save(fixture(), null);
  fake.failWrite = true;
  await assert.rejects(store.save(appended(saved), 1), errorCode("write_failed")); assert.deepEqual(await store.get(saved.planId), saved);
  fake.failWrite = false; fake.abortAfterWriteSuccess = true;
  await assert.rejects(store.save(appended(saved), 1), errorCode("write_failed")); assert.deepEqual(await store.get(saved.planId), saved);
});

test("corrupt, future-version and mismatched-plan rows are errors and remain untouched", async () => {
  for (const bad of [{ broken: true }, { ...fixture(), schemaVersion: "field-access-log-v99" }, fixture("other-plan")]) {
    const fake = new FakeFactory(); fake.rows.set("plan-1", bad); const store = createFieldAccessStore(fake.asFactory());
    await assert.rejects(store.get("plan-1"), errorCode("corrupt"));
    await assert.rejects(store.save(fixture(), 1), errorCode("corrupt"));
    await assert.rejects(store.save(fixture(), null), errorCode("corrupt"));
    assert.deepEqual(fake.rows.get("plan-1"), bad);
  }
});

test("oversized histories, excessive check counts and malformed IDs never write", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const excessive = { ...fixture(), checks: Array.from({ length: 501 }, (_, index) => check(`check-${index}`)) };
  await assert.rejects(store.save(excessive, null), errorCode("corrupt"));
  await assert.rejects(store.save({ ...fixture(), extra: "x".repeat(1024 * 1024) } as FieldAccessLog, null), errorCode("corrupt"));
  await assert.rejects(store.save({ ...fixture(), revision: 0 }, null), errorCode("corrupt"));
  for (const id of ["", " ", "plan\u0000", "plan\u007f", "x".repeat(201)]) await assert.rejects(store.get(id), errorCode("corrupt"));
  assert.equal(fake.rows.size, 0); assert.equal(fake.names.length, 0);
});

test("unavailable opens, future versions, missing stores and incompatible keys fail closed", async () => {
  for (const mode of ["error", "throw", "future", "missing_store"] as const) {
    const fake = new FakeFactory(); fake.openMode = mode;
    await assert.rejects(createFieldAccessStore(fake.asFactory()).get("plan-1"), errorCode(mode === "future" || mode === "missing_store" ? "corrupt" : "unavailable"));
    assert.equal(fake.rows.size, 0);
  }
  const fake = new FakeFactory(); fake.hasStore = true; fake.keyPath = "wrongKey";
  await assert.rejects(createFieldAccessStore(fake.asFactory()).save(fixture(), null), errorCode("corrupt")); assert.equal(fake.rows.size, 0);
});

test("missing or security-disabled default IndexedDB rejects with edits retained", async context => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  context.after(() => { if (original) Object.defineProperty(globalThis, "indexedDB", original); else Reflect.deleteProperty(globalThis, "indexedDB"); });
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  await assert.rejects(createFieldAccessStore().get("plan-1"), errorCode("unavailable"));
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, get: () => { throw new DOMException("Disabled", "SecurityError"); } });
  await assert.rejects(createFieldAccessStore().save(fixture(), null), errorCode("unavailable"));
});

test("blocked open rejects immediately and closes an eventual late connection", async () => {
  const fake = new FakeFactory(); fake.openMode = "blocked"; fake.hasStore = true;
  await assert.rejects(createFieldAccessStore(fake.asFactory()).get("plan-1"), errorCode("unavailable"));
  await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(fake.connections.every(connection => connection.closed));
});

test("unexpected connection close rolls back the pending append", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const saved = await store.save(fixture(), null); fake.holdCommits = true;
  const pending = new Promise<void>(resolve => { fake.onCommitPending = resolve; });
  const saving = store.save(appended(saved), 1); const rejected = assert.rejects(saving, errorCode("write_failed"));
  await pending;
  fake.connections[fake.connections.length - 1].onclose?.(); await rejected;
  assert.deepEqual(fake.rows.get(saved.planId), saved);
});

test("request failures remain errors rather than missing histories", async () => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory());
  const saved = await store.save(fixture(), null); fake.failRead = true;
  await assert.rejects(store.get(saved.planId), errorCode("unavailable"));
  await assert.rejects(store.save(appended(saved), 1), errorCode("write_failed"));
  assert.deepEqual(fake.rows.get(saved.planId), saved);
});

test("transaction timeout aborts a provisional append and retains the committed history", async context => {
  const fake = new FakeFactory(); const store = createFieldAccessStore(fake.asFactory()); const saved = await store.save(fixture(), null);
  fake.holdCommits = true; context.mock.timers.enable({ apis: ["setTimeout"] });
  const saving = store.save(appended(saved), 1); const rejected = assert.rejects(saving, errorCode("write_failed"));
  for (let step = 0; step < 8; step++) { context.mock.timers.tick(0); await Promise.resolve(); }
  assert.ok(fake.pendingCommit); const transaction = fake.pendingCommit;
  context.mock.timers.tick(15_000); await rejected; transaction.complete();
  assert.deepEqual(fake.rows.get(saved.planId), saved); assert.ok(fake.connections.every(connection => connection.closed));
});

test("open timeout rejects and any late successful connection is closed", async context => {
  const fake = new FakeFactory(); fake.openMode = "hang"; fake.hasStore = true; context.mock.timers.enable({ apis: ["setTimeout"] });
  const rejected = assert.rejects(createFieldAccessStore(fake.asFactory()).get("plan-1"), errorCode("unavailable"));
  context.mock.timers.tick(15_000); await rejected; fake.openRequest!.onsuccess?.();
  assert.ok(fake.connections.every(connection => connection.closed)); assert.equal(fake.committed, 0);
});

test("version changes release connections while the current transaction may finish", async () => {
  const fake = new FakeFactory(); fake.holdCommits = true;
  const pending = new Promise<void>(resolve => { fake.onCommitPending = resolve; });
  const saving = createFieldAccessStore(fake.asFactory()).save(fixture(), null); await pending;
  fake.connections[0].onversionchange?.(); assert.equal(fake.connections[0].closed, true);
  fake.pendingCommit!.complete(); assert.equal((await saving).revision, 1);
});
