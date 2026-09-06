import vinext from "vinext";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localPascAssets = (): Plugin => ({
  name: "pasc-local-private-assets",
  apply: "serve",
  configureServer(server) {
    const files = new Map([
      ["/__pasc-local/pasc-tcn.onnx", { path: resolve("artifacts/pasc-tcn.onnx"), type: "application/octet-stream" }],
      ["/__pasc-local/fixture.json", { path: resolve("artifacts/pasc-tcn-phase2-fixture.json"), type: "application/json; charset=utf-8" }],
      ["/__pasc-local/reference.bin", { path: resolve("artifacts/pasc-tcn-phase3-reference.bin"), type: "application/octet-stream" }],
    ]);
    const workerRoot = resolve("artifacts/pasc-local-worker");
    server.middlewares.use(async (request, response, next) => {
      const pathname = request.url?.split("?", 1)[0] ?? "";
      let file = files.get(pathname);
      if (!file && pathname.startsWith("/__pasc-local/worker/")) {
        const name = pathname.slice("/__pasc-local/worker/".length);
        if (name && !name.includes("/") && !name.includes("\\") && !name.includes("..")) {
          file = {
            path: resolve(workerRoot, name),
            type: name.endsWith(".wasm")
              ? "application/wasm"
              : name.endsWith(".mjs") || name.endsWith(".js")
                ? "text/javascript; charset=utf-8"
                : "application/octet-stream",
          };
        }
      }
      if (!file) return next();
      try {
        const body = await readFile(file.path);
        response.statusCode = 200;
        response.setHeader("Content-Type", file.type);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("X-Robots-Tag", "noindex, nofollow");
        response.end(body);
      } catch {
        response.statusCode = 404;
        response.end("Local PASC artifact is unavailable.");
      }
    });
  },
});

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      watch: isCodexSeatbeltSandbox
        ? { useFsEvents: false, usePolling: true, ignored: ["**/artifacts/**"] }
        : { ignored: ["**/artifacts/**"] },
    },
    plugins: [
      localPascAssets(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfig,
      }),
    ],
  };
});
