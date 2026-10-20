import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const sourceDirectories = ["app", "api", "server", "static-src", "public"];
const buildInputs = [
  "build/pasc-static-assets.ts",
  "scripts/build-static.mjs", "scripts/build-pasc-local-worker.mjs",
  "scripts/static-routes.mjs", "scripts/write-release-metadata.mjs",
  "scripts/enforce-local-data-deployment.mjs", "scripts/verify-vercel-output.mjs",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "vercel.json", "vite.static.config.ts", "tsconfig.json", "postcss.config.mjs",
  "artifacts/pasc-tcn.onnx", "artifacts/pasc-tcn-phase3-reference.bin",
];

/** Hash production inputs rather than Git state; never publish paths or contents. */
export async function computeSourceFingerprint(root = resolve()) {
  const files = [...buildInputs];
  const visit = async directory => {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.name.startsWith(".env") || /\.(?:pem|key)$/i.test(entry.name) || path === "public/release.json") continue;
      if (entry.isSymbolicLink()) throw new Error(`Release input must not be a symbolic link: ${path}`);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  for (const directory of sourceDirectories) await visit(directory);
  const fingerprint = createHash("sha256");
  for (const path of files.sort()) {
    const content = await readFile(resolve(root, path));
    fingerprint.update(`${path}\0${content.length}\0`).update(content).update("\0");
  }
  return fingerprint.digest("hex");
}

export async function writeReleaseMetadata(root = resolve()) {
  const sourceSha256 = await computeSourceFingerprint(root);
  const builtAt = new Date().toISOString();
  const metadata = {
    schemaVersion: 1,
    releaseId: `${builtAt.slice(0, 10)}-${sourceSha256.slice(0, 12)}`,
    sourceSha256,
    builtAt,
    userDataLocalOnly: true,
  };
  await mkdir(resolve(root, "static-dist"), { recursive: true });
  await writeFile(resolve(root, "static-dist/release.json"), JSON.stringify(metadata, null, 2) + "\n");
  return metadata;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await writeReleaseMetadata()));
}
