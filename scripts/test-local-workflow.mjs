import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const entries = [
  "local-data-policy-ui.test", "pasc-local-split.test", "account-session.test", "account-access-ui.test",
  "field-observation-draft.test", "workspace-local-import.test",
  "analysis-context-storage.test", "local-analysis-cleanup.test", "local-render-statistics.test",
  "local-anomaly-scope.test", "local-aoi-storage.test", "local-analysis-compute.test",
  "local-data-store.test", "local-data-export.test", "full-point-layer.test",
  "local-workflow-navigation.test", "local-workflow-ui.test", "priority-deformation.test",
  "pasc-local-phase2.test", "pasc-local-phase3.test", "pasc-local-phase4.test",
  "pasc-local-phase5.test", "pasc-local-phase6.test", "v2-phase3.test",
  "v2-phase4.test", "v2-phase6.test",
];
const built = spawnSync(process.execPath, ["scripts/build-pasc-tests.mjs"], { stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
const policyBuilt = spawnSync(process.execPath, ["scripts/build-local-data-policy-tests.mjs"], { stdio: "inherit" });
if (policyBuilt.status !== 0) process.exit(policyBuilt.status ?? 1);
const started = Date.now();
const tested = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...entries.map(entry => "build/tests/" + entry + ".mjs")], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const output = (tested.stdout ?? "") + (tested.stderr ?? "");
mkdirSync("artifacts", { recursive: true });
writeFileSync("artifacts/local-workflow-unit-tests.tap", output);
const count = name => Number(output.match(new RegExp("^# " + name + " (\\d+)$", "m"))?.[1] ?? 0);
const summary = { status: tested.status === 0 ? "passed" : "failed", tests: count("tests"), pass: count("pass"), fail: count("fail"), cancelled: count("cancelled"), elapsedMs: Date.now() - started, entries };
writeFileSync("artifacts/local-workflow-unit-tests.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (tested.status !== 0) console.error(output);
process.exit(tested.status ?? 1);
