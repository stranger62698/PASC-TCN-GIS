import { parseFieldAccessLog, type FieldAccessLog } from "./roadops-access-check";

// Access history lives separately from both task plans and photo evidence.
export const FIELD_ACCESS_DATABASE_NAME = "lanjifyw-field-access-logs-v1";
const DATABASE_VERSION = 1;
const STORE_NAME = "logs";
const OPERATION_TIMEOUT_MS = 15_000;

export type FieldAccessStoreErrorCode = "conflict" | "unavailable" | "corrupt" | "write_failed";

export class FieldAccessStoreError extends Error {
  readonly code: FieldAccessStoreErrorCode;
  constructor(code: FieldAccessStoreErrorCode, message: string) {
    super(message);
    this.name = "FieldAccessStoreError";
    this.code = code;
  }
}

const unavailable = () => new FieldAccessStoreError("unavailable", "本机核验历史存储不可用或被其他页面阻塞。未保存的编辑仍在页面中，请先导出备份后重试。");
const corrupt = () => new FieldAccessStoreError("corrupt", "核验历史损坏、格式不受支持或版本较新。原记录未删除，未保存的编辑仍在页面中，请保留备份，不要覆盖。");
const conflict = () => new FieldAccessStoreError("conflict", "核验历史已被其他页面修改，或本次编辑改写了已有历史。未覆盖原记录，未保存的编辑仍在页面中，请先导出备份，再重新载入最新版本。");
const writeFailed = () => new FieldAccessStoreError("write_failed", "核验历史未保存成功，可能是存储空间不足或事务中断。未保存的编辑仍在页面中，请导出备份后重试。");

function parseRecord(value: unknown): FieldAccessLog {
  try { return parseFieldAccessLog(value); } catch { throw corrupt(); }
}

function validId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 200 && !/\s/.test(id)
    && !Array.from(id).some(character => character.charCodeAt(0) < 32
      || (character.charCodeAt(0) >= 127 && character.charCodeAt(0) <= 159));
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => deepEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.hasOwn(rightRecord, key)
    && deepEqual(leftRecord[key], rightRecord[key]));
}

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(unavailable()); return; }
    let settled = false;
    let request: IDBOpenDBRequest;
    const timeout = setTimeout(() => finish(unavailable()), OPERATION_TIMEOUT_MS);
    function finish(error?: FieldAccessStoreError, database?: IDBDatabase) {
      if (settled) { database?.close(); return; }
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(database!);
    }
    try { request = factory.open(FIELD_ACCESS_DATABASE_NAME, DATABASE_VERSION); }
    catch { finish(unavailable()); return; }
    request.onblocked = () => finish(unavailable());
    request.onerror = () => finish(request.error?.name === "VersionError" ? corrupt() : unavailable());
    request.onupgradeneeded = () => {
      if (settled) {
        try { request.transaction?.abort(); } catch { /* Already aborted. */ }
        return;
      }
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

/** A successful put is provisional until its transaction completes. */
async function runTransaction<T>(
  factory: IDBFactory | undefined,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, result: (value: T) => void, fail: (error: FieldAccessStoreError) => void) => void,
): Promise<T> {
  const database = await openDatabase(factory);
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let value: T;
    let hasResult = false;
    let settled = false;
    let failure: FieldAccessStoreError | undefined;
    const defaultError = mode === "readwrite" ? writeFailed : unavailable;
    const timeout = setTimeout(() => fail(defaultError()), OPERATION_TIMEOUT_MS);
    function settle(error?: FieldAccessStoreError) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database.onclose = null;
      database.close();
      if (error) reject(error); else resolve(value);
    }
    function fail(error: FieldAccessStoreError) {
      if (settled) return;
      failure = error;
      // Abort before releasing the caller so a queued put cannot later commit.
      try { transaction?.abort(); } catch { /* Inactive or already aborted. */ }
      settle(error);
    }
    database.onclose = () => fail(defaultError());
    try {
      transaction = database.transaction(STORE_NAME, mode);
      transaction.oncomplete = () => settle(failure ?? (hasResult ? undefined : corrupt()));
      transaction.onerror = () => { failure ??= defaultError(); };
      transaction.onabort = () => settle(failure ?? defaultError());
      const store = transaction.objectStore(STORE_NAME);
      if (store.keyPath !== "planId") { fail(corrupt()); return; }
      operation(store, result => { value = result; hasResult = true; }, fail);
    } catch (error) { fail(error instanceof FieldAccessStoreError ? error : defaultError()); }
  });
}

function defaultFactory(): IDBFactory | undefined {
  try { return typeof indexedDB === "undefined" ? undefined : indexedDB; } catch { return undefined; }
}

export function createFieldAccessStore(factory: IDBFactory | undefined = defaultFactory()) {
  return {
    get(planId: string): Promise<FieldAccessLog | null> {
      if (!validId(planId)) return Promise.reject(corrupt());
      return runTransaction(factory, "readonly", (store, result, fail) => {
        const request = store.get(planId);
        request.onerror = () => fail(unavailable());
        request.onsuccess = () => {
          try {
            const log = request.result === undefined ? null : parseRecord(request.result);
            if (log && log.planId !== planId) throw corrupt();
            result(log);
          } catch { fail(corrupt()); }
        };
      });
    },
    save(log: FieldAccessLog, expectedRevision: number | null): Promise<FieldAccessLog> {
      let input: FieldAccessLog;
      try { input = parseRecord(log); } catch (error) { return Promise.reject(error); }
      if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) return Promise.reject(conflict());
      return runTransaction(factory, "readwrite", (store, result, fail) => {
        const request = store.get(input.planId);
        request.onerror = () => fail(writeFailed());
        request.onsuccess = () => {
          try {
            const current = request.result === undefined ? null : parseRecord(request.result);
            if (current && current.planId !== input.planId) throw corrupt();
            if (expectedRevision === null ? current !== null : current === null || current.revision !== expectedRevision) throw conflict();
            if (current && (input.checks.length <= current.checks.length
              || !current.checks.every((check, index) => deepEqual(check, input.checks[index])))) throw conflict();
            const revision = current ? current.revision + 1 : 1;
            if (!Number.isSafeInteger(revision)) throw conflict();
            const next = parseRecord({ ...input, revision });
            const write = store.put(next);
            write.onerror = () => fail(writeFailed());
            write.onsuccess = () => result(next);
          } catch (error) { fail(error instanceof FieldAccessStoreError ? error : writeFailed()); }
        };
      });
    },
  };
}
