import { build } from "vite";

await build({
  logLevel: "warn",
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/roadops-phase3.test.ts", formats: ["es"], fileName: () => "roadops-phase3.test.mjs" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/] },
  },
});
