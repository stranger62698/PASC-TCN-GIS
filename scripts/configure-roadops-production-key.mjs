// Explicit administrative action; never ship or import this in browser code.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

assert.ok(process.argv.includes("--confirm-server-only-key"), "Explicit server-only configuration flag required");
const project = JSON.parse(readFileSync(".vercel/project.json", "utf8"));
assert.equal(project.projectId, "prj_nt99glFmW5J6IIkaWcXvyCymRQk2");
assert.equal(project.projectName, "pasc-tcn-gis");
assert.equal(project.orgId, "team_MLsPrFNjf2NRbGn4P1JhsGJh");
const local = parseEnv(readFileSync(".env.local", "utf8"));
const key = local.DIDI_MAP_WEB_SERVICE_KEY?.trim();
assert.ok(key && /^[A-Za-z0-9_-]{16,160}$/.test(key), "A valid server key must exist in the ignored local environment");
const result = spawnSync(process.execPath, ["node_modules/vercel/dist/index.js", "env", "add", "DIDI_MAP_WEB_SERVICE_KEY", "production", "--project", project.projectId, "--sensitive", "--yes", "--no-color"], {
  input: `${key}\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, VERCEL_PROJECT_ID: project.projectId, VERCEL_ORG_ID: project.orgId, NO_UPDATE_NOTIFIER: "1", VERCEL_TELEMETRY_DISABLED: "1" },
  timeout: 60000,
});
// Never print CLI output, stdin, credential values, or raw environment errors.
assert.equal(result.status, 0, "Production key configuration failed; inspect variable names/status separately, without exposing values");
console.log(JSON.stringify({ productionDidiVariableConfigured: true, serverOnly: true, sensitive: true }));
