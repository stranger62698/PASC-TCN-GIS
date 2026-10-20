import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";

const runtimeFiles = [
  "worker.js",
  ...["", ".jsep", ".jspi", ".asyncify"].flatMap(suffix => [
    `ort-wasm-simd-threaded${suffix}.mjs`,
    `ort-wasm-simd-threaded${suffix}.wasm`,
  ]),
];

/** Ship the browser runtime with static builds; never expose training fixtures. */
export function pascStaticAssets(): Plugin {
  const source = resolve("artifacts/pasc-local-worker");
  let config: ResolvedConfig;
  return {
    name: "pasc-browser-static-assets",
    configResolved(resolved) { config = resolved; },
    async buildStart() {
      if (config.command !== "build") return;
      for (const name of runtimeFiles) {
        const available = await stat(resolve(source, name)).catch(() => null);
        if (!available?.isFile() || available.size === 0) {
          this.error(`浏览器 PASC 组件缺失：${name}。请提供 artifacts 中的模型与参考文件，再运行 node scripts/build-pasc-local-worker.mjs。`);
        }
      }
    },
    configureServer(server) {
      const prefix = `${config.base.replace(/\/$/, "")}/__pasc-local/worker/`;
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0] ?? "";
        if (!pathname.startsWith(prefix)) return next();
        const name = pathname.slice(prefix.length);
        if (!runtimeFiles.includes(name)) { response.statusCode = 404; response.end(); return; }
        try {
          const body = await readFile(resolve(source, name));
          response.setHeader("Content-Type", name.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8");
          response.setHeader("Cache-Control", "no-store");
          response.end(body);
        } catch {
          response.statusCode = 404;
          response.end("Browser PASC runtime is unavailable. Run scripts/build-pasc-local-worker.mjs first.");
        }
      });
    },
    async writeBundle() {
      const destination = resolve(config.root, config.build.outDir, "__pasc-local/worker");
      await mkdir(destination, { recursive: true });
      await Promise.all(runtimeFiles.map(name => copyFile(resolve(source, name), resolve(destination, name))));
    },
  };
}
