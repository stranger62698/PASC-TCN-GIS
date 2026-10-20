import { build } from "vite";

for (const entry of ["field-observation-draft.test", "workspace-local-import.test", "analysis-context-storage.test", "local-analysis-cleanup.test", "local-render-statistics.test", "local-anomaly-scope.test", "local-aoi-storage.test", "local-data-export.test", "local-analysis-compute.test", "local-data-store.test", "local-workflow-navigation.test", "local-workflow-ui.test", "full-point-layer.test", "chart-export.test", "priority-deformation.test", "pasc-core.test", "pasc-phase-f.test", "pasc-phase-g.test", "pasc-local-phase2.test", "pasc-local-phase3.test", "pasc-local-phase4.test", "pasc-local-phase5.test", "pasc-local-phase6.test", "v2-phase1.test", "v2-phase2.test", "v2-phase3.test", "v2-phase4.test", "v2-phase5.test", "v2-phase6.test", "portfolio-p0.test", "gis-ai-v1.test", "workspace-panel-width.test"]) {
  await build({
    logLevel: "warn",
    configFile: false,
    build: {
      emptyOutDir: false,
      lib: {
        entry: "tests/" + entry + ".ts",
        formats: ["es"],
        fileName: () => entry + ".mjs",
      },
      outDir: "build/tests",
      rollupOptions: { external: [/^node:/, /^react(?:-dom)?(?:$|\/)/] },
    },
  });
}
