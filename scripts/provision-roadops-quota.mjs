// Administrative one-time provisioning. Never imported by a public endpoint.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { get, put, del, BlobPreconditionFailedError } from "@vercel/blob";
import { configureExistingBlobProxy } from "./roadops-admin-network.mjs";

assert.ok(process.argv.includes("--confirm-provision"), "Explicit provisioning flag required");
assert.ok(process.env.BLOB_READ_WRITE_TOKEN, "Existing private Blob credentials required");
configureExistingBlobProxy();
const path = "roadops/quota/driving-v1.json";
const read = pathname => get(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN, access: "private", useCache: false, abortSignal: AbortSignal.timeout(8000) });
const options = { token: process.env.BLOB_READ_WRITE_TOKEN, access: "private", addRandomSuffix: false, contentType: "application/json", cacheControlMaxAge: 60 };
const probe = `roadops/quota/probes/${randomUUID()}.json`;
let probeEtag;
try {
  const first = await put(probe, '{"probe":1}', { ...options, allowOverwrite: false });
  probeEtag = first.etag;
  const second = await put(probe, '{"probe":2}', { ...options, allowOverwrite: true, ifMatch: first.etag });
  probeEtag = second.etag;
  assert.notEqual(first.etag, second.etag, "Conditional write must change the ETag");
  let staleRejected = false;
  try { await put(probe, '{"probe":3}', { ...options, allowOverwrite: true, ifMatch: first.etag }); }
  catch (error) { if (error instanceof BlobPreconditionFailedError) staleRejected = true; else throw error; }
  assert.ok(staleRejected, "Store must reject a stale ETag");
  const latest = await read(probe);
  assert.ok(latest?.statusCode === 200 && latest.blob.etag === second.etag);
  assert.deepEqual(await new Response(latest.stream).json(), { probe: 2 });
  console.log(JSON.stringify({ privateStoreConditionalWriteVerified: true }));
} finally {
  // Exact UUID-owned synthetic probe only; never delete the shared ledger.
  if (probeEtag) await del(probe, { token: process.env.BLOB_READ_WRITE_TOKEN, ifMatch: probeEtag });
}
let existing = await read(path);
let created = false;
if (!existing) {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const value = { schemaVersion: "roadops-shared-quota-v1", date, dailyUsed: 0, identities: {}, lastAttemptAt: null, generation: 0, lease: null };
  // Creation is explicit, create-only, and never overwrites existing counts.
  await put(path, JSON.stringify(value), { ...options, allowOverwrite: false });
  created = true;
  existing = await read(path);
}
assert.ok(existing?.statusCode === 200 && existing.stream && existing.blob.etag, "A fresh private ledger is required");
const ledger = await new Response(existing.stream).json();
assert.equal(ledger.schemaVersion, "roadops-shared-quota-v1");
assert.ok(Number.isSafeInteger(ledger.dailyUsed) && ledger.dailyUsed >= 0 && ledger.dailyUsed <= 100);
console.log(JSON.stringify({ ledgerProvisioned: true, created, dailyUsed: ledger.dailyUsed }));
