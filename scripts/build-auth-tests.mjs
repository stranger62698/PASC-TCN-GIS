import { build } from "vite";

for (const name of ["auth-server", "auth-api"]) {
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      emptyOutDir: false,
      outDir: "build/tests",
      lib: { entry: `tests/${name}.test.ts`, formats: ["es"], fileName: () => `${name}.test.mjs` },
      rollupOptions: { external: [/^node:/, "@vercel/blob"] },
    },
  });
}
