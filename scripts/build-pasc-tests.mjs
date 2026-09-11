import { build } from "vite";

for (const entry of ["chart-export.test", "pasc-core.test", "pasc-phase-f.test", "pasc-phase-g.test", "pasc-local-phase2.test", "pasc-local-phase3.test", "pasc-local-phase4.test", "pasc-local-phase5.test", "pasc-local-phase6.test", "v2-phase1.test", "v2-phase2.test", "v2-phase3.test", "v2-phase4.test", "v2-phase5.test", "v2-phase6.test", "portfolio-p0.test", "gis-ai-v1.test"]) {
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
      rollupOptions: { external: [/^node:/] },
    },
  });
}
