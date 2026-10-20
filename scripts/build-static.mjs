import { spawnSync } from "node:child_process";

for (const args of [
  ["scripts/build-pasc-local-worker.mjs"],
  ["node_modules/vite/bin/vite.js", "build", "--config", "vite.static.config.ts"],
  ["scripts/static-routes.mjs"],
  ["scripts/write-release-metadata.mjs"],
]) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
