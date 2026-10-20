// Explicit, single-plan production acceptance. No automatic retries.
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { del, get } from "@vercel/blob";
import { configureExistingBlobProxy } from "./roadops-admin-network.mjs";

assert.ok(process.argv.includes("--confirm-one-live-plan"), "Explicit limited live acceptance flag required");
assert.ok(process.env.BLOB_READ_WRITE_TOKEN, "Existing private store needed to clean up the exact QA fixture");
configureExistingBlobProxy();
const origin = "https://pasc-tcn-gis.vercel.app";
const results = [];
let cookie = "", createdId = null, userRemoved = false, liveAttempts = 0, registrationAttempted = false;
const email = `roadops-qa-${randomUUID()}@example.invalid`;
const password = randomBytes(12).toString("base64url");
const userPath = `auth/users/${createHash("sha256").update(email).digest("hex")}.json`;
async function request(path, status, body, options = {}) {
  const response = await fetch(origin + path, {
    ...options,
    method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(60000),
    headers: { "Content-Type": "application/json", Origin: origin, "Cache-Control": "no-cache", ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  const data = await response.json();
  results.push({ path, status: response.status, expected: status });
  assert.equal(response.status, status, `${path}: expected ${status}, received ${response.status}; code=${data.error?.code ?? "none"}`);
  return { response, data };
}
// Bundle only the public plan validator; never include environment or keys.
await build({ configFile: false, logLevel: "error", build: { emptyOutDir: true, outDir: ".work/roadops-production-validation", lib: { entry: "app/lib/roadops-driving.ts", formats: ["es"], fileName: () => "validator.mjs" } } });
const { parseRoadOpsDrivingPlan } = await import(pathToFileURL(resolve(".work/roadops-production-validation/validator.mjs")).href);
try {
  const anonymous = await request("/api/roadops/driving", 401, {});
  assert.equal(anonymous.data.error?.code, "ROADOPS_DIDI_LOGIN_REQUIRED");
  const missingOrigin = await fetch(origin + "/api/roadops/driving", { method: "POST", redirect: "error", signal: AbortSignal.timeout(30000), headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(missingOrigin.status, 403);
  results.push({ path: "/api/roadops/driving", status: 403, case: "missing-origin" });

  registrationAttempted = true;
  console.log(JSON.stringify({ qaFixturePath: userPath, credentialValuesLogged: false }));
  const registered = await request("/api/auth?op=register", 201, { email, password, username: "RoadOps QA" });
  createdId = registered.data.user?.id;
  assert.ok(typeof createdId === "string" && createdId.length > 0);
  cookie = registered.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie.startsWith("lanjifyw_session="));
  const login = await request("/api/auth?op=login", 200, { email, password });
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const session = await request("/api/auth?op=session", 200);
  assert.equal(session.data.authenticated, true);
  assert.equal(session.data.user?.id, createdId);
  const invalidSchema = await request("/api/roadops/driving", 422, {});
  assert.equal(invalidSchema.data.error?.code, "ROADOPS_DIDI_BAD_REQUEST");
  const invalid = await request("/api/roadops/driving", 422, "{");
  assert.equal(invalid.data.error?.code, "ROADOPS_DIDI_BAD_REQUEST");
  const invalidMedia = await request("/api/roadops/driving", 415, {}, { headers: { "Content-Type": "text/plain" } });
  assert.equal(invalidMedia.data.error?.code, "ROADOPS_DIDI_CONTENT_TYPE");

  const point = (id, role, coordinate) => ({ id, name: "Public road acceptance point", role, coordinate, dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "Public Haikou road" });
  const payload = { schemaVersion: "roadops-driving-request-v1", startId: "qa-a", endId: "qa-b", returnToStart: false, orderMode: "input", detailMode: "field", workMinutes: 120, strategy: "1", points: [point("qa-a", "origin", [110.328, 20.022]), point("qa-b", "destination", [110.348, 20.037])] };
  assert.equal(liveAttempts, 0, "Only one live plan is allowed");
  liveAttempts += 1;
  const route = await request("/api/roadops/driving", 200, payload);
  const plan = parseRoadOpsDrivingPlan(route.data.plan);
  assert.equal(plan.provider, "didi_web_service");
  assert.equal(plan.mode, "didi_live");
  assert.equal(plan.usage.budgetScope, "shared");
  assert.equal(plan.usage.upstreamRequests, 2);
  assert.equal(plan.usage.dailyBudget, 100);
  assert.equal(plan.usage.perIdentityLimit, 20);
  assert.equal(plan.usage.perIdentityUsed, 2);
  assert.ok(plan.totalDistanceMeters > 0 && plan.drivingMinutes > 0);
  assert.equal(plan.field?.legs.length, 1);
  assert.ok(plan.field.legs[0].coordinates.length >= 2);
  assert.equal(plan.field.routePackCount, 1);
  console.log(JSON.stringify({ verified: true, checks: results, livePlans: 1, supplierHttpAttempts: plan.usage.upstreamRequests, supplierRoutePacks: plan.field.routePackCount, distanceMeters: plan.totalDistanceMeters, drivingMinutes: plan.drivingMinutes, polylineCoordinates: plan.field.legs[0].coordinates.length, sharedDailyUsed: plan.usage.dailyUsed, perQaUserUsed: plan.usage.perIdentityUsed, fallback: false }));
} finally {
  if (cookie) {
    try { await request("/api/auth?op=logout", 200, {}); } catch { /* bounded cleanup, no automatic retry */ }
    cookie = "";
  }
  if (registrationAttempted) {
    const stored = await get(userPath, { token: process.env.BLOB_READ_WRITE_TOKEN, access: "private", useCache: false, abortSignal: AbortSignal.timeout(8000) });
    if (stored) {
      assert.ok(stored.statusCode === 200 && stored.stream);
      const user = await new Response(stored.stream).json();
      if (createdId) assert.equal(user.id, createdId, "Never clean up a different account");
      assert.equal(user.email, email);
      assert.equal(user.name, "RoadOps QA");
      await del(userPath, { token: process.env.BLOB_READ_WRITE_TOKEN, ifMatch: stored.blob.etag });
      userRemoved = true;
    }
  }
  console.log(JSON.stringify({ qaFixtureRemoved: userRemoved, livePlanAttempts: liveAttempts, supplierAutomaticRetries: 0 }));
}
