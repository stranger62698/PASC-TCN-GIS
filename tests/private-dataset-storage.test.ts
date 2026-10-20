import assert from "node:assert/strict";
import test from "node:test";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { BlobAccessError, BlobError, BlobServiceNotAvailable, BlobServiceRateLimited, BlobStoreNotFoundError, BlobStoreSuspendedError } from "@vercel/blob";
import { createPrivateDatasetHandler, type PrivateDatasetDependencies } from "../api/private-datasets";
import {
  listPrivateDatasetMetas, listPrivateDatasetPaths, privateDatasetFailure, validatePrivateDatasetUpload,
  PRIVATE_DATASET_CHUNK_BYTES, PRIVATE_DATASET_MAX_FILE_BYTES, type DatasetMeta,
} from "../server/private-dataset-storage";

const prefix = "users/offline-user/", datasetId = "dataset-new-0001";
const metaPath = (id: string) => `${prefix}meta/${id}.json`;
function meta(id: string, size = 10): DatasetMeta {
  return { id, name: `${id}.csv`, size, chunks: Math.ceil(size / PRIVATE_DATASET_CHUNK_BYTES), uploadedAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", analysisReady: true, status: "ready", schemaStatus: "validated", version: 1 };
}
function harness(initial: Array<DatasetMeta> = [], pageSize = 2) {
  const files = new Map<string, string | Buffer>(initial.map(item => [metaPath(item.id), JSON.stringify(item)]));
  const writes: string[] = [], reads: Array<{ pathname: string; useCache: boolean }> = [], listings: Array<{ prefix: string; cursor?: string }> = [];
  const diagnostics: Parameters<PrivateDatasetDependencies["logError"]>[0][] = [];
  const storage: PrivateDatasetDependencies["storage"] = {
    async list(options) {
      listings.push(options);
      const paths = [...files.keys()].filter(path => path.startsWith(options.prefix)).sort(), offset = Number(options.cursor ?? 0);
      return { blobs: paths.slice(offset, offset + pageSize).map(pathname => ({ pathname })), hasMore: offset + pageSize < paths.length,
        ...(offset + pageSize < paths.length ? { cursor: String(offset + pageSize) } : {}) };
    },
    async get(pathname, options) {
      reads.push({ pathname, useCache: options.useCache });
      const content = files.get(pathname);
      return content === undefined ? null : { statusCode: 200, stream: new Response(typeof content === "string" ? content : Uint8Array.from(content)).body! };
    },
    async put(pathname, body) { writes.push(pathname); files.set(pathname, body); },
    async del(paths) { paths.forEach(path => files.delete(path)); },
  };
  const handler = createPrivateDatasetHandler({ storage, resolveUser: () => ({ id: "offline-user", name: "Offline", email: "offline@example.invalid", roles: [] }), logError: value => diagnostics.push(value) });
  async function request(method = "GET", op = "list", body?: unknown, id = datasetId) {
    const response = {
      statusCode: 200, body: null as unknown, headers: new Map<string, string>(), headersSent: false, destroyed: false,
      setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); },
      status(status: number) { this.statusCode = status; return this; },
      json(value: unknown) { this.body = JSON.parse(JSON.stringify(value)) as unknown; return this; },
      destroy() { this.destroyed = true; },
    };
    await handler({ method, headers: {}, query: { op, id }, body } as unknown as VercelRequest, response as unknown as VercelResponse);
    return response;
  }
  return { files, writes, reads, listings, diagnostics, storage, request };
}

test("all metadata pages participate in the dataset list and account quota", async () => {
  const context = harness([meta("dataset-old-0001", PRIVATE_DATASET_MAX_FILE_BYTES), meta("dataset-old-0002", PRIVATE_DATASET_MAX_FILE_BYTES), meta("dataset-old-0003", PRIVATE_DATASET_MAX_FILE_BYTES)]);
  const response = await context.request();
  const body = response.body as { items: DatasetMeta[]; account: { usedBytes: number } };
  assert.equal(response.statusCode, 200); assert.equal(body.items.length, 3);
  assert.equal(body.account.usedBytes, PRIVATE_DATASET_MAX_FILE_BYTES * 3);
  assert.equal(context.listings.length, 2); assert.equal(context.listings[1].cursor, "2");
  assert.ok(context.reads.every(read => read.useCache === false));
  const rejected = await context.request("POST", "complete", { name: "new.csv", size: 1, chunks: 1 });
  assert.equal(rejected.statusCode, 413);
  assert.equal((rejected.body as { code: string }).code, "PRIVATE_DATASET_QUOTA_EXCEEDED");
  assert.equal(context.writes.length, 0);
});

test("pagination rejects missing or repeating continuation cursors", async () => {
  for (const cursor of [undefined, "same"]) {
    const context = harness();
    context.storage.list = async () => ({ blobs: [], hasMore: true, cursor });
    await assert.rejects(listPrivateDatasetPaths(prefix, context.storage), { code: "PRIVATE_DATASET_STORAGE_RESPONSE_INVALID" });
  }
});

test("malformed and absent manifests cannot silently reduce account usage", async () => {
  for (const content of ["not JSON", "{}", "[]", JSON.stringify({ ...meta("dataset-old-0001"), size: -7 }), JSON.stringify({ ...meta("dataset-old-0001"), chunks: 2 })]) {
    const context = harness(); context.files.set(metaPath("dataset-old-0001"), content);
    const listed = await context.request();
    assert.equal(listed.statusCode, 409);
    assert.equal((listed.body as { code: string }).code, "PRIVATE_DATASET_MANIFEST_INVALID");
    const completed = await context.request("POST", "complete", { name: "new.csv", size: 10, chunks: 1 });
    assert.equal(completed.statusCode, 409); assert.equal(context.writes.length, 0);
  }
  const context = harness([meta("dataset-old-0001")]);
  context.storage.get = async () => null;
  await assert.rejects(listPrivateDatasetMetas(prefix, context.storage), { code: "PRIVATE_DATASET_MANIFEST_UNAVAILABLE" });
});

test("completion validates positive finite integer bytes and exact expected chunk count before storage access", async () => {
  for (const [size, chunks] of [[-7, 1], [0, 1], [1.5, 1], [NaN, 1], [Infinity, 1], [10, 1.5], [10, 2], [10, 0], [10, NaN], [PRIVATE_DATASET_MAX_FILE_BYTES + 1, 513]]) {
    const context = harness();
    const response = await context.request("POST", "complete", { size, chunks });
    assert.equal(response.statusCode, size > PRIVATE_DATASET_MAX_FILE_BYTES && Number.isFinite(size) ? 413 : 400);
    assert.equal((response.body as { code: string }).code, "PRIVATE_DATASET_INVALID_UPLOAD");
    assert.equal(context.reads.length + context.listings.length + context.writes.length, 0);
  }
  assert.throws(() => validatePrivateDatasetUpload("10", 1));
  assert.deepEqual(validatePrivateDatasetUpload(PRIVATE_DATASET_CHUNK_BYTES + 1, 2), { size: PRIVATE_DATASET_CHUNK_BYTES + 1, chunks: 2 });
  assert.deepEqual(validatePrivateDatasetUpload(PRIVATE_DATASET_MAX_FILE_BYTES, 512), { size: PRIVATE_DATASET_MAX_FILE_BYTES, chunks: 512 });
});

test("same import completion is idempotent and different metadata cannot overwrite the existing import", async () => {
  const context = harness(), input = { name: "own.csv", size: 10, chunks: 1, parentId: "dataset-parent-0001", mapping: { lon: "lon" }, qualityReport: { valid: 1 } };
  const first = await context.request("POST", "complete", input);
  assert.equal(first.statusCode, 200); assert.equal(context.writes.length, 1);
  const second = await context.request("POST", "complete", input);
  assert.equal(second.statusCode, 200); assert.deepEqual(second.body, first.body);
  assert.equal(context.writes.length, 1); assert.equal(context.listings.length, 1, "retry must not count quota or create a new version");
  for (const patch of [{ name: "different.csv" }, { size: 11 }, { parentId: "dataset-parent-0002" }]) {
    const response = await context.request("POST", "complete", { ...input, ...patch });
    assert.equal(response.statusCode, 409); assert.equal((response.body as { code: string }).code, "PRIVATE_DATASET_IMPORT_CONFLICT");
    assert.equal(context.writes.length, 1);
  }
});

test("completion recovers an already committed manifest after a failed write response", async () => {
  const context = harness(), put = context.storage.put;
  context.storage.put = async (...parameters) => { await put(...parameters); throw new BlobServiceNotAvailable(); };
  const response = await context.request("POST", "complete", { name: "own.csv", size: 10, chunks: 1 });
  assert.equal(response.statusCode, 200); assert.equal(context.writes.length, 1);
});

test("repeated completion compares the entire confirmed configuration and ignores only object key order", async () => {
  const context = harness();
  const input = {
    name: "own.csv", size: 10, chunks: 1, analysisReady: true, importDecision: "recommended",
    recommendedFilter: { coherenceMin: 0.75 },
    mapping: { lon: "x", lat: "y", timeCols: ["d1", "d2"], settings: { unit: "mm", state: "raw" } },
    qualityReport: { valid: 2, stats: { missing: 0, total: 2 }, warnings: ["first", "second"] },
  };
  // The client can miss the first successful response and revisit its confirmation form.
  const first = await context.request("POST", "complete", input);
  assert.equal(first.statusCode, 200);
  const same = await context.request("POST", "complete", {
    ...input, recommendedFilter: { coherenceMin: "0.75" },
    mapping: { settings: { state: "raw", unit: "mm" }, timeCols: ["d1", "d2"], lat: "y", lon: "x" },
    qualityReport: { warnings: ["first", "second"], stats: { total: 2, missing: 0 }, valid: 2 },
  });
  assert.equal(same.statusCode, 200); assert.deepEqual(same.body, first.body);
  assert.equal(context.writes.length, 1);
  for (const patch of [
    { analysisReady: false }, { importDecision: "keep-all" }, { recommendedFilter: null }, { recommendedFilter: { coherenceMin: 0.8 } },
    { mapping: { ...input.mapping, lon: "other" } }, { mapping: undefined },
    { mapping: { ...input.mapping, timeCols: ["d2", "d1"] } },
    { qualityReport: { ...input.qualityReport, valid: 1 } }, { qualityReport: undefined },
    { qualityReport: { ...input.qualityReport, warnings: ["second", "first"] } },
  ]) {
    const response = await context.request("POST", "complete", { ...input, ...patch });
    assert.equal(response.statusCode, 409);
    assert.deepEqual((response.body as { code: string; error: string }).code, "PRIVATE_DATASET_IMPORT_CONFLICT");
    assert.match((response.body as { error: string }).error, /该导入已保存.*当前确认配置与已保存记录不一致.*查看已有数据或重新选择创建新版本/);
    assert.equal(context.writes.length, 1, "a different confirmation must not overwrite the saved record");
  }
  assert.deepEqual(JSON.parse(String(context.files.get(metaPath(datasetId)))), (first.body as { item: DatasetMeta }).item);
});

test("provider failures have safe codes, retry policy and traceable operations without leaking SDK details", async () => {
  const cases = [
    [new BlobError("No blob credentials found. SECRET_SENTINEL"), 503, "PRIVATE_DATASET_STORAGE_CONFIGURATION", false],
    [new BlobStoreNotFoundError(), 503, "PRIVATE_DATASET_STORAGE_CONFIGURATION", false],
    [new BlobAccessError(), 503, "PRIVATE_DATASET_STORAGE_ACCESS_DENIED", false],
    [new BlobStoreSuspendedError(), 503, "PRIVATE_DATASET_STORAGE_SUSPENDED", false],
    [new BlobError("Failed to fetch blob: 403 SECRET_SENTINEL"), 503, "PRIVATE_DATASET_STORAGE_ACCESS_DENIED", false],
    [new BlobServiceRateLimited(3), 429, "PRIVATE_DATASET_RATE_LIMITED", true],
    [new BlobError("Failed to fetch blob: 429 SECRET_SENTINEL"), 429, "PRIVATE_DATASET_RATE_LIMITED", true],
    [new BlobServiceNotAvailable(), 503, "PRIVATE_DATASET_STORAGE_UNAVAILABLE", true],
    [new BlobError("Failed to fetch blob: 503 SECRET_SENTINEL"), 503, "PRIVATE_DATASET_STORAGE_UNAVAILABLE", true],
    [new Error("SECRET_SENTINEL"), 500, "PRIVATE_DATASET_REQUEST_FAILED", false],
  ] as const;
  for (const [error, status, code, retryable] of cases) {
    const context = harness(); context.storage.list = async () => { throw error; };
    const response = await context.request();
    const body = response.body as { error: string; code: string; retryable: boolean; operation: string; requestId: string };
    assert.equal(response.statusCode, status); assert.equal(body.code, code); assert.equal(body.retryable, retryable);
    assert.equal(typeof body.error, "string"); assert.equal(body.operation, "list"); assert.match(body.requestId, /^[\da-f-]{36}$/);
    assert.equal(response.headers.get("x-request-id"), body.requestId);
    assert.deepEqual(context.diagnostics, [{ requestId: body.requestId, operation: "list", code, status, retryable }]);
    assert.ok(!JSON.stringify({ body, diagnostics: context.diagnostics }).includes("SECRET_SENTINEL"));
    if (error instanceof BlobServiceRateLimited) assert.equal(response.headers.get("retry-after"), "3");
  }
  assert.equal(privateDatasetFailure(new Error("AUTH_SECRET 未配置")).code, "PRIVATE_DATASET_AUTH_CONFIGURATION");
});
