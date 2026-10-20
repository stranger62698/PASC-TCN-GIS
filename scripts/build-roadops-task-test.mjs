import { build } from "vite";

await build({
  logLevel: "warn", configFile: false,
  build: {
    emptyOutDir: false,
    lib: {
      entry: {
        "roadops-task-plan.test": "tests/roadops-task-plan.test.ts",
        "roadops-task-store.test": "tests/roadops-task-store.test.ts",
        "roadops-task-ui.test": "tests/roadops-task-ui.test.ts",
        "roadops-task-routing.test": "tests/roadops-task-routing.test.ts",
        "roadops-task-report.test": "tests/roadops-task-report.test.ts",
        "roadops-task-editor.test": "tests/roadops-task-editor.test.ts",
        "roadops-task-map.test": "tests/roadops-task-map.test.ts",
        "roadops-task-integration.test": "tests/roadops-task-integration.test.ts",
        "roadops-task-panel.test": "tests/roadops-task-panel.test.ts",
        "roadops-task-markers.test": "tests/roadops-task-markers.test.ts",
        "roadops-task-session.test": "tests/roadops-task-session.test.ts",
        "roadops-access-check.test": "tests/roadops-access-check.test.ts",
        "roadops-access-store.test": "tests/roadops-access-store.test.ts",
        "roadops-access-ui.test": "tests/roadops-access-ui.test.ts",
      },
      formats: ["es"], fileName: (_format, name) => `${name}.mjs`,
    },
    outDir: "build/tests",
    rollupOptions: { external: [/^node:/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/] },
  },
});
