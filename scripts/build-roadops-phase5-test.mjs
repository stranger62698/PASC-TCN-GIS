import { build } from "vite";

for (const [name, entry] of [
  ["roadops-phase5.test", "tests/roadops-phase5.test.ts"],
  ["roadops-api-contract.test", "tests/roadops-api-contract.test.ts"],
  ["roadops-shared-quota.test", "tests/roadops-shared-quota.test.ts"],
  ["roadops-shared-integration.test", "tests/roadops-shared-integration.test.ts"],
  ["roadops-driving-access.test", "tests/roadops-driving-access.test.ts"],
  ["roadops-production-wrapper.test", "tests/roadops-production-wrapper.test.ts"],
]) {
  await build({
    logLevel: "warn",
    configFile: false,
    build: {
      emptyOutDir: false,
      lib: { entry, formats: ["es"], fileName: () => `${name}.mjs` },
      outDir: "build/tests",
      rollupOptions: { external: [/^node:/, "@vercel/blob", "typescript"] },
    },
  });
}
