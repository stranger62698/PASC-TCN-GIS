import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, test } from "node:test";
import { buildRoadOpsLocalServer, loadRoadOpsLocalEnvironment, parseRoadOpsLocalArguments, startRoadOpsLocalServer } from "../scripts/serve-roadops-local.mjs";

let scratch, createServer;
const servers = new Set();
before(async () => {
  scratch = await mkdtemp(resolve(tmpdir(), "roadops-local-server-test-"));
  const modulePath = await buildRoadOpsLocalServer(resolve(scratch, "compiled"));
  ({ createRoadOpsLocalServer: createServer } = await import(pathToFileURL(modulePath).href));
  await mkdir(resolve(scratch, "public/assets"), { recursive: true });
  await writeFile(resolve(scratch, "public/index.html"), "<!doctype html><title>local test</title>");
  await writeFile(resolve(scratch, "public/assets/app.js"), "export const fixture = true;");
  await writeFile(resolve(scratch, "public/.env.local"), "private fixture must not be served");
  await writeFile(resolve(scratch, "public/config.key"), "private fixture must not be served");
});
after(async () => {
  await Promise.all([...servers].map(server => new Promise(done => { server.close(done); server.closeAllConnections(); })));
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

const usage = () => ({ cached: false, upstreamRequests: 0, dailyUsed: 0, dailyBudget: 50, dailyRemaining: 50, perIdentityUsed: 0, perIdentityLimit: 20 });
const start = async (options = {}) => {
  const server = await createServer({ staticRoot: resolve(scratch, "public"), env: {}, ...options });
  await new Promise(done => server.listen(0, "127.0.0.1", done)); servers.add(server);
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
};
const raw = (port, { path = "/", method = "GET", headers = {}, chunks = [] } = {}) => new Promise((resolveResponse, reject) => {
  const req = request({ hostname: "127.0.0.1", port, method, path, headers }, response => {
    const buffers = [];
    response.on("data", part => buffers.push(part));
    response.on("end", () => resolveResponse({ status: response.statusCode, headers: response.headers, text: Buffer.concat(buffers).toString("utf8") }));
  });
  req.on("error", reject); chunks.forEach(chunk => req.write(chunk)); req.end();
});

test("serves local static assets and extensionless SPA paths but not unknown assets or APIs", async () => {
  const { port } = await start();
  const page = await raw(port, { path: "/map?demo=road" });
  assert.equal(page.status, 200); assert.match(page.text, /local test/);
  const script = await raw(port, { path: "/assets/app.js" });
  assert.equal(script.status, 200); assert.match(script.headers["content-type"], /javascript/);
  const head = await raw(port, { method: "HEAD", path: "/assets/app.js" });
  assert.equal(head.status, 200); assert.equal(head.text, ""); assert.ok(Number(head.headers["content-length"]) > 0);
  for (const path of ["/missing.js", "/api/missing", "/api"]) assert.equal((await raw(port, { path })).status, 404);
});

test("rejects traversal, private files, encoded backslashes and DNS rebinding", async () => {
  const { port } = await start();
  for (const path of ["/../package.json", "/%2e%2e/package.json", "/.env.local", "/config.key", "/%5c..%5c.env.local", "/assets/../index.html", "/scripts/test", "/%00", "/C:/Windows"]) {
    assert.equal((await raw(port, { path })).status, 403, path);
  }
  assert.equal((await raw(port, { path: "/%not-valid" })).status, 400);
  assert.equal((await raw(port, { headers: { host: `attacker.example:${port}` } })).status, 403);
  assert.equal((await raw(port, { headers: { origin: "http://attacker.example" } })).status, 403);
});

test("refuses a public-directory junction that resolves outside its static root", async t => {
  const external = resolve(scratch, "outside"); await mkdir(external); await writeFile(resolve(external, "secret.json"), '{"private":true}');
  try { await symlink(external, resolve(scratch, "public/outside-link"), "junction"); }
  catch (cause) { if (["EPERM", "EACCES"].includes(cause.code)) { t.skip("No symlink permission"); return; } throw cause; }
  const { port } = await start();
  const response = await raw(port, { path: "/outside-link/secret.json" });
  assert.equal(response.status, 403); assert.doesNotMatch(response.text, /private.*true/);
});

test("health exposes configuration booleans and process budget, never key or environment", async () => {
  const { port } = await start({ env: { DIDI_MAP_WEB_SERVICE_KEY: "TEST_LOCAL_SERVER_DUMMY_KEY", OTHER_SECRET: "TEST_NEVER_RETURN_THIS" }, service: { usage, plan: async () => { throw new Error("must not request"); } } });
  const response = await raw(port, { path: "/api/roadops/health" });
  assert.equal(response.status, 200); const body = JSON.parse(response.text);
  assert.equal(body.configured, true); assert.equal(body.localOnly, true);
  assert.equal(body.budget.dailyBudget, 50); assert.equal(body.budget.scope, "server_process_http_attempts");
  assert.doesNotMatch(response.text, /TEST_LOCAL_SERVER_DUMMY_KEY|TEST_NEVER_RETURN_THIS|DIDI_MAP_WEB_SERVICE_KEY/);
  assert.equal((await raw(port, { path: "/api/roadops/health", method: "POST" })).status, 405);
});

test("routes JSON to the shared handler, rejects origins and methods without upstream calls", async () => {
  let calls = 0;
  const { port, url } = await start({ service: { usage, plan: async (body, who, signal) => { calls += 1; assert.deepEqual(body, { fixture: true }); assert.equal(who, "local:browser"); assert.ok(signal instanceof AbortSignal); return { fixture: "mock plan" }; } } });
  const result = await raw(port, { path: "/api/roadops/driving", method: "POST", headers: { origin: url, "content-type": "application/json", "x-forwarded-for": "attacker-supplied" }, chunks: ['{"fixture":true}'] });
  assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.text), { plan: { fixture: "mock plan" } });
  assert.equal(calls, 1);
  assert.equal((await raw(port, { path: "/api/roadops/driving" })).status, 405);
  assert.equal((await raw(port, { path: "/api/roadops/driving", method: "POST", chunks: ["{}"] })).status, 415);
  assert.equal((await raw(port, { path: "/api/roadops/driving", method: "POST", headers: { "content-type": "application/json-malformed" }, chunks: ["{}"] })).status, 415);
  assert.equal((await raw(port, { path: "/api/roadops/driving", method: "POST", headers: { origin: "http://evil.example", "content-type": "application/json" }, chunks: ["{}"] })).status, 403);
  assert.equal(calls, 1);
});

test("disconnecting the browser aborts the shared service signal", async () => {
  let started, aborted;
  const startedPromise = new Promise(done => { started = done; });
  const abortedPromise = new Promise(done => { aborted = done; });
  const { port } = await start({ service: { usage, plan: async (_body, _who, signal) => {
    const result = new Promise(done => signal.addEventListener("abort", () => { aborted(); done({ cancelled: true }); }, { once: true }));
    started(); return result;
  } } });
  const req = request({ hostname: "127.0.0.1", port, method: "POST", path: "/api/roadops/driving", headers: { "content-type": "application/json" } });
  req.on("error", () => {}); req.end("{}");
  await startedPromise; req.destroy();
  let timer;
  try {
    await Promise.race([abortedPromise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Cancellation was not forwarded")), 2_000); })]);
  } finally { clearTimeout(timer); }
});

test("bounds declared and streamed bodies and gives structured malformed JSON errors", async () => {
  const { port } = await start({ service: { usage, plan: async () => { throw new Error("must not run"); } } });
  for (const headers of [{ "content-type": "application/json", "content-length": "48001" }, { "content-type": "application/json" }]) {
    const response = await raw(port, { path: "/api/roadops/driving", method: "POST", headers, chunks: ["x".repeat(24_000), "x".repeat(24_001)] });
    assert.equal(response.status, 413); assert.equal(JSON.parse(response.text).error.code, "ROADOPS_DIDI_BODY_LIMIT");
  }
  const bad = await raw(port, { path: "/api/roadops/driving", method: "POST", headers: { "content-type": "application/json" }, chunks: ["{invalid"] });
  assert.equal(bad.status, 422);
});

test("default service with no key fails locally without contacting the provider", async () => {
  const { port } = await start();
  const input = {
    schemaVersion: "roadops-driving-request-v1", startId: "a", endId: "b", returnToStart: false, workMinutes: 120, strategy: "1",
    points: [
      { id: "a", name: "A", coordinate: [110, 20], role: "origin", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "A" },
      { id: "b", name: "B", coordinate: [111, 21], role: "destination", dwellMinutes: 0, inspectionValue: 0, required: false, sourceFeatureId: null, sourceRoadName: "B" },
    ],
  };
  const response = await raw(port, { path: "/api/roadops/driving", method: "POST", headers: { "content-type": "application/json" }, chunks: [JSON.stringify(input)] });
  assert.equal(response.status, 503); assert.equal(JSON.parse(response.text).error.code, "ROADOPS_DIDI_NOT_CONFIGURED");
});

test("launcher rejects host overrides and invalid arguments before loading environment", async () => {
  for (const args of [["--host", "0.0.0.0"], ["--unknown"], ["--port"], ["--port", "0"], ["--port", "1.5"], ["--port", "65536"]]) {
    await assert.rejects(startRoadOpsLocalServer(args));
  }
});

test("environment loader selects only server routing settings and preserves process overrides", async () => {
  const path = resolve(scratch, "fixture.env");
  await writeFile(path, 'DIDI_MAP_WEB_SERVICE_KEY="TEST_ENV_DUMMY_FIXTURE"\nDIDI_ROUTE_DAILY_BUDGET=9\nNEXT_PUBLIC_KEY=not-allowed\nUNRELATED=ignored\n');
  const env = await loadRoadOpsLocalEnvironment(path, { DIDI_ROUTE_DAILY_BUDGET: "5" });
  assert.equal(env.DIDI_MAP_WEB_SERVICE_KEY, "TEST_ENV_DUMMY_FIXTURE"); assert.equal(env.DIDI_ROUTE_DAILY_BUDGET, "5");
  assert.equal(env.NEXT_PUBLIC_KEY, undefined); assert.equal(env.UNRELATED, undefined);
});

test("local carry-over arguments are explicit, bounded and tied to the Shanghai day", () => {
  const beforeMidnight = Date.parse("2026-09-27T15:59:59Z"), afterMidnight = Date.parse("2026-09-27T16:00:00Z");
  assert.deepEqual(parseRoadOpsLocalArguments([], beforeMidnight), { port: 4192 });
  const args = ["--port", "4192", "--used-today", "8", "--usage-date", "2026-09-27"];
  assert.deepEqual(parseRoadOpsLocalArguments(args, beforeMidnight), { port: 4192, usageCarryover: { date: "2026-09-27", used: 8 } });
  assert.throws(() => parseRoadOpsLocalArguments(args, afterMidnight), /Asia\/Shanghai/);
  assert.deepEqual(parseRoadOpsLocalArguments(["--usage-date", "2026-09-28", "--used-today", "0"], afterMidnight), { port: 4192, usageCarryover: { date: "2026-09-28", used: 0 } });
  for (const used of ["-1", "NaN", "Infinity", "1.5", "1e3", "", "9007199254740992"]) {
    assert.throws(() => parseRoadOpsLocalArguments(["--used-today", used, "--usage-date", "2026-09-27"], beforeMidnight));
  }
  for (const invalid of [["--used-today", "8"], ["--usage-date", "2026-09-27"], ["--port", "4192", "--port", "4193"], ["--used-today", "8", "--usage-date", "2026-09-28"]]) {
    assert.throws(() => parseRoadOpsLocalArguments(invalid, beforeMidnight));
  }
});

test("local server carries today's usage into its health without an upstream request", async () => {
  const date = new Date(Date.now() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const { port } = await start({ env: { DIDI_ROUTE_DAILY_BUDGET: "100", DIDI_ROUTE_PER_USER_DAILY_LIMIT: "100" }, usageCarryover: { date, used: 8 } });
  const response = await raw(port, { path: "/api/roadops/health" });
  const budget = JSON.parse(response.text).budget;
  assert.deepEqual(budget, { scope: "server_process_http_attempts", dailyBudget: 100, dailyUsed: 8, dailyRemaining: 92 });
});
