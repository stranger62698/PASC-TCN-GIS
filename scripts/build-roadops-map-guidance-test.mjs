import { build } from "vite";

await build({
  logLevel: "warn",
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/roadops-map-guidance.test.ts", formats: ["es"], fileName: () => "roadops-map-guidance.test.mjs" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/] },
  },
});
