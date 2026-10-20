import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";

await build({
  logLevel: "warn",
  configFile: false,
  resolve: {
    alias: {
      "next/link": fileURLToPath(new URL("../static-src/shims/next-link.tsx", import.meta.url)),
      "next/navigation": fileURLToPath(new URL("../static-src/shims/next-navigation.ts", import.meta.url)),
    },
  },
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/workspace-visual.test.ts", formats: ["es"], fileName: () => "workspace-visual.test.mjs", cssFileName: "workspace-visual" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/] },
  },
});

const preview = spawnSync(process.execPath, ["build/tests/workspace-visual.test.mjs", "--preview-only"], { stdio: "inherit" });
if (preview.status !== 0) process.exit(preview.status ?? 1);
console.log("Run SSR assertions: node --test build/tests/workspace-visual.test.mjs");
