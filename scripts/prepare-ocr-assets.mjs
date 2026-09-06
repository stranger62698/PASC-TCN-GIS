import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tesseractDirectory = dirname(require.resolve("tesseract.js/package.json"));
const coreDirectory = dirname(require.resolve("tesseract.js-core/package.json", { paths: [tesseractDirectory] }));
const languageDirectory = join(dirname(require.resolve("@tesseract.js-data/eng/package.json")), "4.0.0_best_int");
const outputDirectory = join(projectRoot, "public", "ocr");
const compressedLanguagePath = join(languageDirectory, "eng.traineddata.gz");

await mkdir(outputDirectory, { recursive: true });
const assets = [
  [join(tesseractDirectory, "dist", "worker.min.js"), "worker.min.js"],
  [join(coreDirectory, "tesseract-core.wasm.js"), "tesseract-core.wasm.js"],
];

await Promise.all(assets.map(([source, name]) => copyFile(source, join(outputDirectory, name))));
await writeFile(join(outputDirectory, "eng.traineddata"), gunzipSync(await readFile(compressedLanguagePath)));
console.log(`Prepared ${assets.length + 1} local OCR assets in public/ocr.`);
