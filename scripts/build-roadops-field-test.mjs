import { build } from "vite";

await build({
  logLevel: "warn",
  configFile: false,
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/roadops-field.test.ts", formats: ["es"], fileName: () => "roadops-field.test.mjs" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/] },
  },
});
