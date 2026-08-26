import { build } from "vite";

for (const entry of ["pasc-core.test", "pasc-phase-f.test", "pasc-phase-g.test", "v2-phase1.test", "v2-phase2.test", "v2-phase3.test", "v2-phase4.test", "v2-phase5.test", "v2-phase6.test"]) {
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
