import { fileURLToPath } from "node:url";
import { build } from "vite";

for (const entry of ["local-data-policy-ui.test", "pasc-local-split.test", "account-session.test", "account-access-ui.test"]) {
  await build({
    configFile: false, logLevel: "warn",
    resolve: { alias: Object.fromEntries(["image", "link", "navigation", "dynamic"].map(name => [
      `next/${name}`, fileURLToPath(new URL(`../static-src/shims/next-${name}.${name === "navigation" ? "ts" : "tsx"}`, import.meta.url)),
    ])) },
    build: {
      emptyOutDir: false, outDir: "build/tests",
      lib: { entry: `tests/${entry}.ts`, formats: ["es"], fileName: () => `${entry}.mjs` },
      rollupOptions: { external: [/^node:/, /^react(?:-dom)?(?:$|\/)/] },
    },
  });
}
