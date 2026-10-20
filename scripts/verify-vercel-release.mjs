import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { LOCAL_DATA_BLOCKED_ENDPOINTS } from "../app/lib/data-processing-policy.ts";

const target = new URL(process.argv[2] ?? "https://pasc-tcn-gis.vercel.app");
assert.ok(target.protocol === "https:" && target.hostname.startsWith("pasc-tcn-") && target.hostname.endsWith(".vercel.app"), "Use the verified project's HTTPS Vercel deployment URL");
assert.ok(!target.username && !target.password && !target.search && target.pathname === "/", "A project origin is required");
const checks = [];
const digest = buffer => createHash("sha256").update(buffer).digest("hex");
async function request(path, status, options = {}) {
  const response = await fetch(new URL(path, target), { ...options, redirect: "error", signal: AbortSignal.timeout(30_000), headers: { "Cache-Control": "no-cache", ...options.headers } });
  assert.equal(response.status, status, `${path}: unexpected status ${response.status}`);
  checks.push({ path, method: options.method ?? "GET", status: response.status });
  return response;
}
const localIndex = await readFile(resolve(".vercel/output/static/index.html"), "utf8");
const entry = localIndex.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
assert.ok(entry?.startsWith("/assets/"), "Expected the current static entry script");
const releaseResponse = await request("/release.json", 200);
const releaseBytes = await readFile(resolve(".vercel/output/static/release.json"));
assert.deepEqual(Buffer.from(await releaseResponse.arrayBuffer()), releaseBytes, "Published release metadata must match the local release exactly");
const release = JSON.parse(releaseBytes.toString("utf8"));
for (const path of ["/", "/map", "/login"]) {
  const response = await request(path, 200);
  assert.ok((await response.text()).includes(entry), `${path}: stale entry script`);
}
for (const path of [entry, "/__pasc-local/worker/worker.js"]) {
  const response = await request(path, 200);
  assert.equal(digest(Buffer.from(await response.arrayBuffer())), digest(await readFile(resolve(".vercel/output/static", `.${path}`))), `${path}: published file hash mismatch`);
}
for (const suffix of ["", ".jsep", ".jspi", ".asyncify"]) for (const extension of ["mjs", "wasm"]) {
  const path = `/__pasc-local/worker/ort-wasm-simd-threaded${suffix}.${extension}`;
  const response = await request(path, 200, { method: "HEAD" });
  assert.match(response.headers.get("content-type") ?? "", extension === "wasm" ? /^application\/wasm/ : /(?:application|text)\/javascript/, `${path}: incorrect content type`);
}
const session = await request("/api/auth?op=session", 200);
assert.equal((await session.json()).authenticated, false, "Expected a cookie-free, unauthenticated session check");
for (const endpoint of LOCAL_DATA_BLOCKED_ENDPOINTS) {
  const response = await request(`/${endpoint}`, 403);
  assert.equal((await response.json()).error?.code, "USER_DATA_LOCAL_ONLY");
}
await request("/api/roadops/driving", 405);
const policy = await request("/data-processing-policy.json", 200);
const policyBody = await policy.json();
assert.equal(policyBody.localOnly, true);
assert.equal(policyBody.accountRequired, true);

// No session or body is accepted: these checks cannot spend supplier quota.
if (process.argv.includes("--check-protected-roadops")) {
  const driving = await request("/api/roadops/driving", 401, { method: "POST", headers: { "Content-Type": "application/json", Origin: target.origin }, body: "{}" });
  assert.equal((await driving.json()).error?.code, "ROADOPS_DIDI_LOGIN_REQUIRED");
  await request("/api/roadops/driving", 403, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
}

// Legacy opt-in only for older, unprotected deployments with neither key.
// These checks expect local 503 rejection; they are not real route or AI acceptance.
if (process.argv.includes("--check-unconfigured-roadops")) {
  const point = (id, role, coordinate) => ({ id, name: `Synthetic ${id}`, role, coordinate, dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "Synthetic acceptance point" });
  const payload = { schemaVersion: "roadops-driving-request-v1", startId: "release-a", endId: "release-b", returnToStart: false, orderMode: "input", workMinutes: 120, strategy: "1", points: [point("release-a", "origin", [110, 20]), point("release-b", "destination", [111, 21])] };
  const headers = { "Content-Type": "application/json", Origin: target.origin };
  const driving = await request("/api/roadops/driving", 503, { method: "POST", headers, body: JSON.stringify(payload) });
  const body = await driving.json();
  assert.equal(body.error?.code, "ROADOPS_DIDI_NOT_CONFIGURED");
  assert.equal(body.error?.usage?.upstreamRequests, 0);
  assert.equal(body.error?.fallbackAvailable, false);
  const review = await request("/api/roadops/review", 503, { method: "POST", headers, body: JSON.stringify({ issue: { id: "release-synthetic-check" }, segments: [], evidences: [] }) });
  assert.equal((await review.json()).error?.code, "ROADOPS_TYPESAFE_NOT_CONFIGURED");
}
console.log(JSON.stringify({ verified: true, origin: target.origin, entry, release, checks }, null, 2));
