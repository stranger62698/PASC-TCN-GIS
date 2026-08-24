import { build } from "vite";

for (const entry of ["pasc-core.test", "pasc-phase-f.test", "pasc-phase-g.test"]) {
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
