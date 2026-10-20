import { build } from "vite";

await build({
  logLevel: "warn",
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/roadops-phase4.test.ts", formats: ["es"], fileName: () => "roadops-phase4.test.mjs" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/] },
  },
});
