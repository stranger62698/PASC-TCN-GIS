import { build } from "vite";
await build({
  logLevel: "warn", configFile: false,
  build: {
    emptyOutDir: false,
    lib: { entry: "tests/roadops-personalized-tasks.test.ts", formats: ["es"], fileName: () => "roadops-personalized-tasks.test.mjs" },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/] },
  },
});
