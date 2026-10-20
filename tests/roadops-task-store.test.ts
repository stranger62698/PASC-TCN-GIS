import assert from "node:assert/strict";
import test from "node:test";
import { createNavigationDraft } from "../app/lib/roadops-navigation";
import { createFieldTaskPlan, type FieldTaskPlan } from "../app/lib/roadops-task-plan";
import { createFieldTaskStore, FIELD_TASK_DATABASE_NAME, TaskStoreError, type TaskStoreErrorCode } from "../app/lib/roadops-task-store";

/**
 * Minimal local IDB model, not a browser-conformance substitute. It models the
 * semantics this store relies on: asynchronous requests, serialized transactions,
 * isolation until commit, rollback, and request success before transaction completion.
 * No user database, network, or installed dependency is used.
 */
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
  openMode: "normal" | "blocked" | "error" | "throw" | "future" | "missing_store" = "normal";
  failWrite = false;
  abortAfterWriteSuccess = false;
  holdCommits = false;
  pendingCommit: FakeTransaction | null = null;
  onCommitPending: (() => void) | null = null;
  transactions: FakeTransaction[] = [];
  active: FakeTransaction | null = null;
  committed = 0;

  asFactory(): IDBFactory { return this as unknown as IDBFactory; }
  open(name: string, version: number): FakeOpenRequest {
    this.names.push(name);
    assert.equal(version, 1);
    if (this.openMode === "throw") throw new DOMException("Storage disabled", "SecurityError");
    const request = new FakeOpenRequest();
    const database = new FakeDatabase(this);
    this.connections.push(database);
    request.result = database;
    setTimeout(() => {
      if (this.openMode === "blocked") {
        request.onblocked?.();
        // A browser can eventually open after the caller already rejected.
        setTimeout(() => request.onsuccess?.(), 0);
        return;
      }
      if (this.openMode === "error" || this.openMode === "future") {
        request.error = new DOMException("Local open failure", this.openMode === "future" ? "VersionError" : "UnknownError");
        request.onerror?.();
        return;
      }
      if (!this.hasStore && this.openMode !== "missing_store") request.onupgradeneeded?.();
      request.onsuccess?.();
    }, 0);
    return request;
  }
  enqueue(transaction: FakeTransaction) {
    this.transactions.push(transaction);
    this.startNext();
  }
  startNext() {
    if (this.active) return;
    this.active = this.transactions.shift() ?? null;
    if (this.active) {
      const transaction = this.active;
      setTimeout(() => transaction.start(), 0);
    }
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
  get objectStoreNames() { return { contains: (name: string) => name === "plans" && this.factory.hasStore }; }
  createObjectStore(name: string, options: { keyPath: string }) {
    assert.equal(name, "plans"); assert.equal(options.keyPath, "planId");
    this.factory.hasStore = true;
  }
  transaction(name: string, mode: IDBTransactionMode) {
    assert.equal(name, "plans");
    if (this.closed) throw new DOMException("Connection closed", "InvalidStateError");
    const transaction = new FakeTransaction(this.factory, mode);
    this.factory.enqueue(transaction);
    return transaction;
  }
  close() { this.closed = true; }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  working = new Map<string, unknown>();
  pending: Array<() => void> = [];
  started = false;
  finished = false;
  wrote = false;
  constructor(readonly factory: FakeFactory, readonly mode: IDBTransactionMode) {}
  start() {
    if (this.finished) return;
    this.started = true;
    this.working = new Map([...this.factory.rows].map(([key, value]) => [key, structuredClone(value)]));
    this.next();
  }
  request(operation: () => unknown, write = false) {
    if (this.finished) throw new DOMException("Inactive", "TransactionInactiveError");
    const request = new FakeRequest();
    this.pending.push(() => {
      if (write && this.factory.failWrite) {
        request.error = new DOMException("Quota exceeded", "QuotaExceededError");
        request.onerror?.();
        this.onerror?.();
        this.abort();
        return;
      }
      request.result = structuredClone(operation());
      if (write) this.wrote = true;
      request.onsuccess?.();
    });
    return request;
  }
  next() {
    setTimeout(() => {
      if (this.finished) return;
      const action = this.pending.shift();
      if (action) { action(); this.next(); return; }
      if (this.factory.holdCommits) {
        this.factory.pendingCommit = this;
        this.factory.onCommitPending?.();
        return;
      }
      this.complete();
    }, 0);
  }
  complete() {
    if (this.finished) return;
    if (this.wrote && this.factory.abortAfterWriteSuccess) { this.abort(); return; }
    this.finished = true;
    if (this.mode === "readwrite") this.factory.rows = this.working;
    this.factory.committed++;
    this.oncomplete?.();
    this.factory.release(this);
  }
  abort() {
    if (this.finished) return;
    this.finished = true;
    this.onabort?.();
    this.factory.release(this);
  }
  objectStore(name: string) {
    assert.equal(name, "plans");
    return {
      get: (key: string) => this.request(() => this.working.get(key)),
      getAll: () => this.request(() => [...this.working.values()]),
      put: (value: FieldTaskPlan) => this.request(() => { this.working.set(value.planId, structuredClone(value)); return value.planId; }, true),
      delete: (key: string) => this.request(() => { this.working.delete(key); return undefined; }, true),
    };
  }
}

function fixture(id = "plan-1"): FieldTaskPlan {
  return createFieldTaskPlan(createNavigationDraft(), { planId: id, name: "外业核查草稿", now: "2026-01-01T08:00:00.000Z" });
}
function errorCode(code: TaskStoreErrorCode) {
  return (error: unknown) => error instanceof TaskStoreError && error.code === code && !error.message.includes("plan-1");
}

test("creates isolated DB, persists a whitelist, and restores through a new store instance", async () => {
  const fake = new FakeFactory();
  const store = createFieldTaskStore(fake.asFactory());
  const input = { ...fixture(), revision: 8, providerRouteSnapshot: { secret: "not-stored", geometry: [[1, 2]] } };
  const saved = await store.save(input, null);
  assert.equal(saved.revision, 1);
  assert.equal(fake.committed, 1);
  assert.equal(JSON.stringify(fake.rows).includes("not-stored"), false);
  assert.equal("providerRouteSnapshot" in (fake.rows.get(input.planId) as object), false);
  const restored = await createFieldTaskStore(fake.asFactory()).get(input.planId);
  assert.deepEqual(restored, saved);
  assert.deepEqual(await store.list(), [saved]);
  assert.ok(fake.names.every(name => name === FIELD_TASK_DATABASE_NAME));
  assert.ok(fake.connections.every(connection => connection.closed));
});

test("save waits for the atomic transaction commit after put request succeeds", async () => {
  const fake = new FakeFactory(); fake.holdCommits = true;
  const pending = new Promise<void>(resolve => { fake.onCommitPending = resolve; });
  let resolved = false;
  const saving = createFieldTaskStore(fake.asFactory()).save(fixture(), null).then(value => { resolved = true; return value; });
  await pending;
  assert.equal(resolved, false);
  assert.equal(fake.rows.size, 0);
  fake.pendingCommit!.complete();
  assert.equal((await saving).revision, 1);
  assert.equal(fake.rows.size, 1);
});

test("request success followed by transaction abort is never reported as saved", async () => {
  const fake = new FakeFactory(); fake.abortAfterWriteSuccess = true;
  await assert.rejects(createFieldTaskStore(fake.asFactory()).save(fixture(), null), errorCode("write_failed"));
  assert.equal(fake.rows.size, 0);
  assert.ok(fake.connections.every(connection => connection.closed));
});

test("updates increment revisions without accepting stale overwrites", async () => {
  const fake = new FakeFactory(); const store = createFieldTaskStore(fake.asFactory());
  const first = await store.save(fixture(), null);
  const second = await store.save({ ...first, name: "已修改" }, first.revision);
  assert.equal(second.revision, 2);
  assert.equal(second.createdAt, first.createdAt);
  await assert.rejects(store.save({ ...first, name: "旧页面内容" }, 1), errorCode("conflict"));
  await assert.rejects(store.save(first, null), errorCode("conflict"));
  assert.equal((await store.get(first.planId))!.name, "已修改");
});

test("two concurrent page writers cannot silently overwrite the same revision", async () => {
  const fake = new FakeFactory(); const left = createFieldTaskStore(fake.asFactory()); const right = createFieldTaskStore(fake.asFactory());
  const saved = await left.save(fixture(), null);
  const outcomes = await Promise.allSettled([
    left.save({ ...saved, name: "左窗口" }, 1), right.save({ ...saved, name: "右窗口" }, 1),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult;
  assert.ok(errorCode("conflict")(rejected.reason));
  assert.equal((await left.get(saved.planId))!.revision, 2);
});

test("two concurrent creates retain only the first transaction and report conflict", async () => {
  const fake = new FakeFactory(); const store = createFieldTaskStore(fake.asFactory());
  const results = await Promise.allSettled([store.save(fixture(), null), store.save(fixture(), null)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(fake.rows.size, 1);
});

test("quota errors and aborted updates preserve the last committed record", async () => {
  const fake = new FakeFactory(); const store = createFieldTaskStore(fake.asFactory());
  const saved = await store.save(fixture(), null);
  fake.failWrite = true;
  await assert.rejects(store.save({ ...saved, name: "不能落盘" }, 1), errorCode("write_failed"));
  assert.deepEqual(await store.get(saved.planId), saved);
  fake.failWrite = false; fake.abortAfterWriteSuccess = true;
  await assert.rejects(store.save({ ...saved, name: "不能提交" }, 1), errorCode("write_failed"));
  assert.deepEqual(await store.get(saved.planId), saved);
});

test("remove checks the expected version and only reports success after commit", async () => {
  const fake = new FakeFactory(); const store = createFieldTaskStore(fake.asFactory());
  const saved = await store.save(fixture(), null);
  await assert.rejects(store.remove(saved.planId, 2), errorCode("conflict"));
  assert.ok(await store.get(saved.planId));
  fake.failWrite = true;
  await assert.rejects(store.remove(saved.planId, 1), errorCode("write_failed"));
  assert.ok(await store.get(saved.planId));
  fake.failWrite = false;
  await store.remove(saved.planId, 1);
  assert.equal(await store.get(saved.planId), null);
  await assert.rejects(store.remove(saved.planId, 1), errorCode("conflict"));
});

test("corrupt or newer records fail closed without silently skipping or deleting them", async () => {
  for (const bad of [{ broken: true }, { ...fixture(), schemaVersion: "field-task-plan-v99" }]) {
    const fake = new FakeFactory(); fake.rows.set("plan-1", bad); fake.rows.set("valid", fixture("valid"));
    const store = createFieldTaskStore(fake.asFactory());
    await assert.rejects(store.list(), errorCode("corrupt"));
    await assert.rejects(store.get("plan-1"), errorCode("corrupt"));
    await assert.rejects(store.save(fixture(), 1), errorCode("corrupt"));
    await assert.rejects(store.remove("plan-1", 1), errorCode("corrupt"));
    assert.deepEqual(fake.rows.get("plan-1"), bad);
    assert.equal(fake.rows.size, 2);
  }
});

test("invalid drafts, invalid revision tokens and missing update targets never write", async () => {
  const fake = new FakeFactory(); const store = createFieldTaskStore(fake.asFactory());
  await assert.rejects(store.save({ ...fixture(), revision: 0 }, null), errorCode("corrupt"));
  await assert.rejects(store.save(fixture(), 0), errorCode("conflict"));
  await assert.rejects(store.save(fixture(), 1), errorCode("conflict"));
  await assert.rejects(store.get(" "), errorCode("corrupt"));
  await assert.rejects(store.remove("plan-1", Number.NaN), errorCode("conflict"));
  assert.equal(fake.rows.size, 0);
});

test("unavailable/private-mode opens, missing stores and future DB versions are explicit failures", async () => {
  for (const mode of ["error", "throw", "future", "missing_store"] as const) {
    const fake = new FakeFactory(); fake.openMode = mode;
    await assert.rejects(createFieldTaskStore(fake.asFactory()).list(), errorCode(mode === "future" || mode === "missing_store" ? "corrupt" : "unavailable"));
    assert.equal(fake.rows.size, 0);
  }
  assert.equal(typeof globalThis.indexedDB, "undefined");
  await assert.rejects(createFieldTaskStore().list(), errorCode("unavailable"));
});

test("blocked open rejects immediately and closes an eventual late connection", async () => {
  const fake = new FakeFactory(); fake.openMode = "blocked"; fake.hasStore = true;
  await assert.rejects(createFieldTaskStore(fake.asFactory()).list(), errorCode("unavailable"));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(fake.connections.every(connection => connection.closed));
});

test("versionchange releases connections while the active transaction may finish", async () => {
  const fake = new FakeFactory(); fake.holdCommits = true;
  const pending = new Promise<void>(resolve => { fake.onCommitPending = resolve; });
  const saving = createFieldTaskStore(fake.asFactory()).save(fixture(), null);
  await pending;
  fake.connections[0].onversionchange?.();
  assert.equal(fake.connections[0].closed, true);
  fake.pendingCommit!.complete();
  assert.equal((await saving).revision, 1);
});

test("unexpected database close rejects and rolls back a pending write", async () => {
  const fake = new FakeFactory(); fake.holdCommits = true;
  const pending = new Promise<void>(resolve => { fake.onCommitPending = resolve; });
  const saving = createFieldTaskStore(fake.asFactory()).save(fixture(), null);
  const rejected = assert.rejects(saving, errorCode("write_failed"));
  await pending;
  fake.connections[0].onclose?.();
  await rejected;
  assert.equal(fake.rows.size, 0);
});
