import assert from "node:assert/strict";
import test from "node:test";
import { listPrivateDatasets, PrivateDatasetRequestError, readPrivateDatasetResponse, uploadPrivateDatasetChunk } from "../app/lib/private-datasets-client.ts";

test("cloud storage failures preserve safe diagnostic details for retry without confusing them with login failures", async () => {
  const response = Response.json({ error: "云端存储暂时不可用，请稍后重试。", code: "PRIVATE_DATASET_STORAGE_UNAVAILABLE", retryable: true, requestId: "fixture-request" }, { status: 503 });
  await assert.rejects(() => readPrivateDatasetResponse(response, "读取失败"), error => {
    assert.ok(error instanceof PrivateDatasetRequestError);
    assert.equal(error.status, 503);
    assert.equal(error.code, "PRIVATE_DATASET_STORAGE_UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.equal(error.requestId, "fixture-request");
    assert.match(error.message, /云端存储/);
    return true;
  });
});

test("legacy string and nested errors remain readable, including the screenshot's generic 500", async () => {
  await assert.rejects(() => readPrivateDatasetResponse(Response.json({ error: "私有数据服务暂时不可用" }, { status: 500 }), "读取失败"), error => error.message === "私有数据服务暂时不可用" && error.retryable);
  await assert.rejects(() => readPrivateDatasetResponse(Response.json({ error: { message: "账户容量不足", code: "PRIVATE_DATASET_QUOTA_EXCEEDED", retryable: false } }, { status: 413 }), "读取失败"), error => error.message === "账户容量不足" && !error.retryable && error.code === "PRIVATE_DATASET_QUOTA_EXCEEDED");
});

test("expired login and missing deployment responses retain their HTTP status and actionable messages", async () => {
  await assert.rejects(() => readPrivateDatasetResponse(new Response("", { status: 401 }), "读取失败"), error => error.status === 401 && error.code === "PRIVATE_DATASET_AUTH_REQUIRED" && /重新登录/.test(error.message));
  await assert.rejects(() => readPrivateDatasetResponse(new Response("<html>Not Found</html>", { status: 404 }), "读取失败"), error => error.status === 404 && /接口不存在/.test(error.message));
});

test("a static HTML fallback or invalid JSON value cannot be accepted as an account response", async () => {
  for (const body of ["<html>App shell</html>", "null", "[]", "42", '"ok"']) {
    await assert.rejects(() => readPrivateDatasetResponse(new Response(body), "读取失败"), error => error instanceof PrivateDatasetRequestError && error.code === "PRIVATE_DATASET_RESPONSE_INVALID");
  }
});

test("network failure is safe to retry and never exposes the raw exception", async () => {
  let requests = 0;
  await assert.rejects(() => listPrivateDatasets(async () => { requests += 1; throw new TypeError("private transport detail"); }), error => {
    assert.equal(error.status, 0);
    assert.equal(error.code, "PRIVATE_DATASET_NETWORK_UNAVAILABLE");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(error.message, /private transport detail/);
    return true;
  });
  assert.equal(requests, 1, "Retries require an explicit user action");
});

test("successful upload retains binary body and signed same-origin credentials", async () => {
  const chunk = new Blob(["local fixture"]);
  let request;
  const result = await uploadPrivateDatasetChunk("fixture-id", 2, chunk, async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, index: 2 });
  });
  assert.deepEqual(result, { ok: true, index: 2 });
  assert.match(request.url, /^\/api\/private-datasets\?op=chunk&id=fixture-id&index=2$/);
  assert.equal(request.options.credentials, "include");
  assert.equal(request.options.body, chunk);
});
