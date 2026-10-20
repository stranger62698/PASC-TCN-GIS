import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Local synthetic acceptance fixture: authentication and cloud saves are simulated.
// This does not start Vercel functions or read cloud credentials.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
  root, configFile: false, publicDir: "public", plugins: [react()],
  define: { __PASC_LOCAL_BASE_PATH__: JSON.stringify("/") },
  resolve: { alias: Object.fromEntries(["image", "link", "navigation", "dynamic"].map(name => [
    `next/${name}`, fileURLToPath(new URL(`../static-src/shims/next-${name}.${name === "navigation" ? "ts" : "tsx"}`, import.meta.url)),
  ])) },
  server: { host: "127.0.0.1", port: 4197, strictPort: true,
    watch: { ignored: ["**/build/**", "**/static-dist/**", "**/.vercel/**", "**/artifacts/**", "**/.work/**"] },
  },
});
await server.listen();
console.log("Synthetic import acceptance: http://127.0.0.1:4197/tests/fixtures/data-import-browser.html");
