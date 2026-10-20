import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import test from "node:test";
import { enforceLocalDataDeployment } from "../scripts/enforce-local-data-deployment.mjs";
import { LOCAL_DATA_BLOCKED_ENDPOINTS, ONLINE_SERVICE_ENDPOINTS } from "../app/lib/data-processing-policy.ts";

async function fixture(run) {
  const scratch = await mkdtemp(resolve(tmpdir(), "local-data-deployment-"));
  try {
    const output = resolve(scratch, "output");
    await mkdir(resolve(output, "static"), { recursive: true });
    await writeFile(resolve(output, "config.json"), JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "^/api(/.*)?$", status: 404 }] }));
    for (const endpoint of [...ONLINE_SERVICE_ENDPOINTS, ...LOCAL_DATA_BLOCKED_ENDPOINTS]) {
      const directory = resolve(output, "functions", `${endpoint}.func`);
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "index.mjs"), `// ${endpoint}`);
    }
    await run(output, scratch);
  } finally {
    const rel = relative(resolve(tmpdir()), scratch);
    assert.ok(rel && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && rel.startsWith("local-data-deployment-"));
    await rm(scratch, { recursive: true, force: true });
  }
}

test("published output removes cloud data compute and queue functions while preserving auth and driving", async () => fixture(async output => {
  const report = await enforceLocalDataDeployment(output);
  assert.deepEqual(report.removed, [...LOCAL_DATA_BLOCKED_ENDPOINTS]);
  for (const endpoint of ONLINE_SERVICE_ENDPOINTS) assert.equal(await readFile(resolve(output, "functions", `${endpoint}.func/index.mjs`), "utf8"), `// ${endpoint}`);
  for (const endpoint of LOCAL_DATA_BLOCKED_ENDPOINTS) await assert.rejects(readFile(resolve(output, "functions", `${endpoint}.func/index.mjs`)), { code: "ENOENT" });
  assert.equal(JSON.parse(await readFile(resolve(output, "static/data-processing-policy.json"), "utf8")).localOnly, true);
  const config = JSON.parse(await readFile(resolve(output, "config.json"), "utf8"));
  assert.equal(config.routes[0].status, 403);
  for (const endpoint of LOCAL_DATA_BLOCKED_ENDPOINTS) assert.ok(new RegExp(config.routes[0].src).test(`/${endpoint}`));
  for (const endpoint of ONLINE_SERVICE_ENDPOINTS) assert.equal(new RegExp(config.routes[0].src).test(`/${endpoint}`), false);
  assert.deepEqual((await enforceLocalDataDeployment(output)).removed, [], "repeat verification must not touch retained functions");
}));

test("an unknown server function prevents a local-only release", async () => fixture(async output => {
  await mkdir(resolve(output, "functions/api/new-cloud-worker.func"), { recursive: true });
  await assert.rejects(enforceLocalDataDeployment(output), /Only authentication and driving/);
}));

test("output pruning refuses a blocked-function junction outside the generated root", async t => fixture(async (output, scratch) => {
  const target = resolve(output, "functions", `${LOCAL_DATA_BLOCKED_ENDPOINTS[0]}.func`);
  const outside = resolve(scratch, "must-preserve");
  await mkdir(outside); await writeFile(resolve(outside, "source.csv"), "must remain untouched");
  await rm(target, { recursive: true });
  try { await symlink(outside, target, "junction"); }
  catch (error) { if (["EPERM", "EACCES"].includes(error.code)) { t.skip("No junction permission"); return; } throw error; }
  await assert.rejects(enforceLocalDataDeployment(output), /real directory/);
  assert.equal(await readFile(resolve(outside, "source.csv"), "utf8"), "must remain untouched");
}));
