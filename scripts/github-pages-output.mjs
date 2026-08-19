import { access, copyFile, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const out = new URL("../static-dist/", import.meta.url);
const base = "/lanjifyw-insar";
await copyFile(new URL("data/haikou-insar.csv", out), new URL("haikou-insar.csv", out));
await rm(new URL("data/", out), { recursive: true, force: true });
const outPath = fileURLToPath(out);
const assetsPath = join(outPath, "assets");
try {
  await access(assetsPath);
  for (const name of await readdir(assetsPath)) {
    await rename(join(assetsPath, name), join(outPath, name));
  }
  await rm(assetsPath, { recursive: true, force: true });
} catch {
  // Flat output already places bundles in the site root.
}
const indexPath = join(outPath, "index.html");
const html = await readFile(indexPath, "utf8");
await writeFile(indexPath, html.replaceAll(`${base}/assets/`, `${base}/`), "utf8");
for (const name of await readdir(outPath)) {
  if (!name.endsWith(".js")) continue;
  const path = join(outPath, name);
  const content = await readFile(path, "utf8");
  await writeFile(path, content
    .replaceAll('"/insar-satellite-v2.png"', `"${base}/insar-satellite-v2.png"`)
    .replaceAll('"/data/haikou-insar.csv"', `"${base}/haikou-insar.csv"`), "utf8");
}
await writeFile(join(outPath, ".nojekyll"), "", "utf8");
