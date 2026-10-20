import { parseFieldTaskPlan, type FieldTaskPlan } from "./roadops-task-plan";

// This database deliberately has no relationship to the existing photo database.
export const FIELD_TASK_DATABASE_NAME = "lanjifyw-field-task-plans-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "plans";
const OPERATION_TIMEOUT_MS = 15_000;

export type TaskStoreErrorCode = "conflict" | "unavailable" | "corrupt" | "write_failed";

export class TaskStoreError extends Error {
  readonly code: TaskStoreErrorCode;
  constructor(code: TaskStoreErrorCode, message: string) {
    super(message);
    this.name = "TaskStoreError";
    this.code = code;
  }
}

const unavailable = () => new TaskStoreError("unavailable", "本机任务存储不可用或被其他页面阻塞。当前输入仍在页面中，请先导出备份后重试。");
const corrupt = () => new TaskStoreError("corrupt", "任务记录损坏、格式不受支持或版本较新。原记录未删除，请保留备份，不要覆盖。");
const conflict = () => new TaskStoreError("conflict", "任务已被其他页面修改或删除。未覆盖原记录，请先另存当前输入，再重新载入最新版本。");
const writeFailed = () => new TaskStoreError("write_failed", "任务未保存成功，可能是存储空间不足或事务中断。当前输入仍在页面中，请导出备份后重试。");

function parseRecord(value: unknown): FieldTaskPlan {
  try { return parseFieldTaskPlan(value); } catch { throw corrupt(); }
}

function validId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 200 && !/\s/.test(id)
    && !Array.from(id).some(character => character.charCodeAt(0) < 32);
}

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(unavailable()); return; }
    let settled = false;
    let request: IDBOpenDBRequest;
    const timeout = setTimeout(() => finish(unavailable()), OPERATION_TIMEOUT_MS);
    function finish(error?: TaskStoreError, database?: IDBDatabase) {
      if (settled) { database?.close(); return; }
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(database!);
    }
    try { request = factory.open(FIELD_TASK_DATABASE_NAME, DATABASE_VERSION); }
    catch { finish(unavailable()); return; }
    request.onblocked = () => finish(unavailable());
    request.onerror = () => finish(request.error?.name === "VersionError" ? corrupt() : unavailable());
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      try {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "planId" });
      } catch {
        finish(unavailable());
        try { request.transaction?.abort(); } catch { /* Already aborted. */ }
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      if (!database.objectStoreNames.contains(STORE_NAME)) { database.close(); finish(corrupt()); return; }
      finish(undefined, database);
    };
  });
}

/** Resolve only at transaction completion, never at a request's success event. */
async function runTransaction<T>(
  factory: IDBFactory | undefined,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void, fail: (error: TaskStoreError) => void) => void,
): Promise<T> {
  const database = await openDatabase(factory);
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let value: T;
    let hasResult = false;
    let settled = false;
    let failure: TaskStoreError | undefined;
    const defaultError = mode === "readwrite" ? writeFailed : unavailable;
    const timeout = setTimeout(() => fail(defaultError()), OPERATION_TIMEOUT_MS);
    function settle(error?: TaskStoreError) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database.onclose = null;
      database.close();
      if (error) reject(error); else resolve(value);
    }
    function fail(error: TaskStoreError) {
      if (settled) return;
      failure = error;
      // Abort synchronously before releasing the caller; queued puts must not commit.
      try { transaction?.abort(); } catch { /* Inactive or already aborted. */ }
      settle(error);
    }
    database.onclose = () => fail(defaultError());
    try {
      transaction = database.transaction(STORE_NAME, mode);
      transaction.oncomplete = () => settle(failure ?? (hasResult ? undefined : corrupt()));
      transaction.onerror = () => { failure ??= defaultError(); };
      transaction.onabort = () => settle(failure ?? defaultError());
      operation(transaction.objectStore(STORE_NAME), result => { value = result; hasResult = true; }, fail);
    } catch (error) { fail(error instanceof TaskStoreError ? error : defaultError()); }
  });
}

function defaultFactory(): IDBFactory | undefined {
  try { return typeof indexedDB === "undefined" ? undefined : indexedDB; } catch { return undefined; }
}

export function createFieldTaskStore(factory: IDBFactory | undefined = defaultFactory()) {
  return {
    list(): Promise<FieldTaskPlan[]> {
      return runTransaction(factory, "readonly", (store, result, fail) => {
        const request = store.getAll();
        request.onerror = () => fail(unavailable());
        request.onsuccess = () => {
          try {
            if (!Array.isArray(request.result)) throw corrupt();
            // A damaged row must not disappear from the UI as though it never existed.
            result(request.result.map(parseRecord).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
          } catch { fail(corrupt()); }
        };
      });
    },
    get(id: string): Promise<FieldTaskPlan | null> {
      if (!validId(id)) return Promise.reject(corrupt());
      return runTransaction(factory, "readonly", (store, result, fail) => {
        const request = store.get(id);
        request.onerror = () => fail(unavailable());
        request.onsuccess = () => {
          try {
            const plan = request.result === undefined ? null : parseRecord(request.result);
            if (plan && plan.planId !== id) throw corrupt();
            result(plan);
          } catch { fail(corrupt()); }
        };
      });
    },
    save(plan: FieldTaskPlan, expectedRevision: number | null): Promise<FieldTaskPlan> {
      let input: FieldTaskPlan;
      try { input = parseRecord(plan); } catch (error) { return Promise.reject(error); }
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) return Promise.reject(conflict());
      return runTransaction(factory, "readwrite", (store, result, fail) => {
        const request = store.get(input.planId);
        request.onerror = () => fail(writeFailed());
        request.onsuccess = () => {
          try {
            const current = request.result === undefined ? null : parseRecord(request.result);
            if (current && current.planId !== input.planId) throw corrupt();
            if (expectedRevision === null ? current !== null : current === null || current.revision !== expectedRevision) throw conflict();
            const revision = current ? current.revision + 1 : 1;
            if (!Number.isSafeInteger(revision)) throw conflict();
            const createdAt = current?.createdAt ?? input.createdAt;
            const updatedAt = new Date(Math.max(Date.now(), Date.parse(createdAt), Date.parse(current?.updatedAt ?? input.updatedAt))).toISOString();
            const next = parseRecord({ ...input, revision, createdAt, updatedAt });
            const write = store.put(next);
            write.onerror = () => fail(writeFailed());
            write.onsuccess = () => result(next);
          } catch (error) { fail(error instanceof TaskStoreError ? error : writeFailed()); }
        };
      });
    },
    remove(id: string, expectedRevision: number): Promise<void> {
      if (!validId(id)) return Promise.reject(corrupt());
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return Promise.reject(conflict());
      return runTransaction(factory, "readwrite", (store, result, fail) => {
        const request = store.get(id);
        request.onerror = () => fail(writeFailed());
        request.onsuccess = () => {
          try {
            const current = request.result === undefined ? null : parseRecord(request.result);
            if (current && current.planId !== id) throw corrupt();
            if (!current || current.revision !== expectedRevision) throw conflict();
            const deletion = store.delete(id);
            deletion.onerror = () => fail(writeFailed());
            deletion.onsuccess = () => result(undefined);
          } catch (error) { fail(error instanceof TaskStoreError ? error : writeFailed()); }
        };
      });
    },
  };
}
