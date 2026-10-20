import { build } from "vite";

for (const entry of ["private-dataset-storage.test", "workspace-local-import.test"]) {
  await build({
    logLevel: "warn", configFile: false,
    build: {
      emptyOutDir: false, outDir: "build/tests",
      lib: { entry: `tests/${entry}.ts`, formats: ["es"], fileName: () => `${entry}.mjs` },
      rollupOptions: { external: [/^node:/, /^@vercel\//] },
    },
  });
}
