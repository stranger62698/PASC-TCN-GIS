import { build } from "vite";

await build({
  logLevel: "warn", configFile: false,
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/roadops-strategy-comparison.test.ts", formats: ["es"], fileName: () => "roadops-strategy-comparison.test.mjs" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/, "typescript"] },
  },
});
