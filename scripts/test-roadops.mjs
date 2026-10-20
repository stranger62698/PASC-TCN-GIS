import { spawnSync } from "node:child_process";

for (const phase of [2, 3, 4, 5, 6]) {
  const result = spawnSync(process.execPath, [`scripts/build-roadops-phase${phase}-test.mjs`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const navigation = spawnSync(process.execPath, ["scripts/build-roadops-navigation-test.mjs"], { stdio: "inherit" });
if (navigation.status !== 0) process.exit(navigation.status ?? 1);
const strategyComparison = spawnSync(process.execPath, ["scripts/build-roadops-strategy-comparison-test.mjs"], { stdio: "inherit" });
if (strategyComparison.status !== 0) process.exit(strategyComparison.status ?? 1);
const field = spawnSync(process.execPath, ["scripts/build-roadops-field-test.mjs"], { stdio: "inherit" });
if (field.status !== 0) process.exit(field.status ?? 1);
const guidance = spawnSync(process.execPath, ["scripts/build-roadops-map-guidance-test.mjs"], { stdio: "inherit" });
if (guidance.status !== 0) process.exit(guidance.status ?? 1);
const tasks = spawnSync(process.execPath, ["scripts/build-roadops-task-test.mjs"], { stdio: "inherit" });
if (tasks.status !== 0) process.exit(tasks.status ?? 1);
const production = spawnSync(process.execPath, ["--test", "build/tests/roadops-shared-quota.test.mjs", "build/tests/roadops-shared-integration.test.mjs", "build/tests/roadops-driving-access.test.mjs", "build/tests/roadops-production-wrapper.test.mjs", "build/tests/roadops-strategy-comparison.test.mjs"], { stdio: "inherit" });
if (production.status !== 0) process.exit(production.status ?? 1);
const result = spawnSync(process.execPath, ["--test", "tests/roadops-phase1.test.mjs", ...[2, 3, 4, 5, 6].map(phase => `build/tests/roadops-phase${phase}.test.mjs`), "build/tests/roadops-api-contract.test.mjs", "build/tests/roadops-navigation.test.mjs", "build/tests/roadops-field.test.mjs", "build/tests/roadops-map-guidance.test.mjs", "tests/roadops-local-server.test.mjs", "build/tests/roadops-task-plan.test.mjs", "build/tests/roadops-task-store.test.mjs", "build/tests/roadops-task-ui.test.mjs", "build/tests/roadops-task-routing.test.mjs", "build/tests/roadops-task-report.test.mjs", "build/tests/roadops-task-editor.test.mjs", "build/tests/roadops-task-map.test.mjs", "build/tests/roadops-task-integration.test.mjs", "build/tests/roadops-task-panel.test.mjs", "build/tests/roadops-task-markers.test.mjs", "build/tests/roadops-task-session.test.mjs", "build/tests/roadops-access-check.test.mjs", "build/tests/roadops-access-store.test.mjs", "build/tests/roadops-access-ui.test.mjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
