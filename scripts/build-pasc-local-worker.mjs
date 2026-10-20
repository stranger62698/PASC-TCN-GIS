import { copyFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const readArtifact = async name => {
  try { return await readFile(resolve("artifacts", name)); }
  catch (error) { throw new Error(`本地 PASC 构建缺少 artifacts/${name}。请在构建环境提供已有模型包；模型不由云端推理服务替代。`, { cause: error }); }
};
const model = await readArtifact("pasc-tcn.onnx");
const reference = await readArtifact("pasc-tcn-phase3-reference.bin");

await build({
  configFile: false,
  logLevel: "warn",
  base: "/__pasc-local/worker/",
  resolve: {
    conditions: ["onnxruntime-web-use-extern-wasm", "import", "module", "browser", "default"],
  },
  define: {
    __PASC_MODEL_BASE64__: JSON.stringify(model.toString("base64")),
    __PASC_REFERENCE_BASE64__: JSON.stringify(reference.toString("base64")),
  },
  build: {
    emptyOutDir: false,
    outDir: "artifacts/pasc-local-worker",
    target: "es2022",
    copyPublicDir: false,
    minify: "esbuild",
    assetsInlineLimit: 0,
    lib: {
      entry: "app/workers/pasc-local.worker.ts",
      formats: ["es"],
      fileName: () => "worker.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "[name]-[hash][extname]",
        chunkFileNames: "[name]-[hash].js",
      },
    },
  },
});

const ortDist = resolve("node_modules/onnxruntime-web/dist");
const output = resolve("artifacts/pasc-local-worker");
await mkdir(output, { recursive: true });
for (const name of [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jspi.wasm",
  "ort-wasm-simd-threaded.jspi.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
]) {
  await copyFile(resolve(ortDist, name), resolve(output, name));
}
