import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, lstat, readdir, readFile, readlink, realpath, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { LOCAL_DATA_BLOCKED_ENDPOINTS, ONLINE_SERVICE_ENDPOINTS } from "../app/lib/data-processing-policy.ts";
import { computeSourceFingerprint } from "./write-release-metadata.mjs";

const output = resolve(".vercel/output");
const configPath = resolve(output, "config.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const build = JSON.parse(await readFile(resolve(output, "builds.json"), "utf8"));
assert.equal(config.version, 3, "Expected Vercel Build Output API version 3");
assert.equal(build.target, "production", "Build with vercel build --prod before publishing");
const release = JSON.parse(await readFile(resolve(output, "static/release.json"), "utf8"));
assert.equal(release.schemaVersion, 1, "Expected release provenance metadata");
assert.equal(release.userDataLocalOnly, true, "Release must keep user data local");
assert.equal(release.sourceSha256, await computeSourceFingerprint(), "Rebuild after production source changes");

const hash = async path => createHash("sha256").update(await readFile(path)).digest("hex");
assert.equal(await hash(resolve(output, "static/index.html")), await hash(resolve("static-dist/index.html")), "Vercel output must contain the current static build");
let staticFileCount = 0;
async function verifyStaticFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Static build must not contain an unresolved link: ${path}`);
    if (entry.isDirectory()) await verifyStaticFiles(path);
    else if (entry.isFile()) {
      const asset = relative(resolve("static-dist"), path);
      assert.equal(await hash(resolve(output, "static", asset)), await hash(path), `Stale or missing static asset: ${asset}`);
      staticFileCount += 1;
    }
  }
}
await verifyStaticFiles(resolve("static-dist"));
const runtimeFiles = [
  "worker.js",
  ...["", ".jsep", ".jspi", ".asyncify"].flatMap(suffix => [
    `ort-wasm-simd-threaded${suffix}.mjs`,
    `ort-wasm-simd-threaded${suffix}.wasm`,
  ]),
];
for (const file of runtimeFiles) {
  const published = resolve(output, "static/__pasc-local/worker", file);
  assert.equal(await hash(published), await hash(resolve("artifacts/pasc-local-worker", file)), `Stale or missing browser runtime: ${file}`);
}

const endpoints = [...ONLINE_SERVICE_ENDPOINTS];
for (const endpoint of LOCAL_DATA_BLOCKED_ENDPOINTS) {
  await assert.rejects(access(resolve(output, "functions", `${endpoint}.func`)), { code: "ENOENT" }, `Cloud data function must not be published: ${endpoint}`);
  assert.ok(config.routes.some(route => route.status === 403 && route.dest === "/data-processing-policy.json" && new RegExp(route.src).test(`/${endpoint}`)), `Cloud data requests must stop before functions: ${endpoint}`);
}
const inside = (parent, child) => {
  const path = relative(parent, child);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
};
const repairs = [];
// A Windows standalone build can retain pnpm links to the development checkout.
// Their traced targets are already packaged; reconnect each link inside its own
// function so the archive can be extracted on Vercel's Linux runtime.
async function inspectLinks(directory, folder) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const original = await readlink(path);
      const target = resolve(dirname(path), original);
      let packaged = target;
      if (!inside(folder, target)) {
        assert.ok(inside(resolve("node_modules"), target), `Unexpected external dependency link: ${path}`);
        packaged = resolve(folder, relative(resolve(), target));
      }
      assert.ok(inside(folder, packaged), `Dependency must stay inside its function: ${path}`);
      assert.ok((await lstat(packaged)).isDirectory(), `Missing traced dependency directory: ${packaged}`);
      assert.ok(inside(await realpath(folder), await realpath(packaged)), `Dependency resolves outside its function: ${path}`);
      const portable = relative(dirname(path), packaged).split(sep).join("/");
      // Windows can emit a file symlink pointing to a directory. Its text looks
      // correct, but stat and Node package resolution fail until it is recreated.
      const linkInfo = await stat(path).catch(() => null);
      const resolvedLink = linkInfo?.isDirectory() ? await realpath(path).catch(() => null) : null;
      if (original.replaceAll("\\", "/") !== portable || !resolvedLink || !inside(await realpath(folder), resolvedLink)) {
        repairs.push({ path, original, portable, folder });
      }
    } else if (entry.isDirectory()) {
      await inspectLinks(path, folder);
    }
  }
}
for (const endpoint of endpoints) {
  const folder = resolve(output, "functions", `${endpoint}.func`);
  const functionConfig = JSON.parse(await readFile(resolve(folder, ".vc-config.json"), "utf8"));
  assert.match(functionConfig.runtime, /^nodejs/);
  await access(resolve(folder, functionConfig.handler));
  await inspectLinks(folder, folder);
}
// Validate the whole graph before replacing any link. Unlink only the verified
// output symlink; never delete the directory it points to.
for (const { path, original, portable, folder } of repairs) {
  assert.ok(inside(folder, path), `Repair must stay inside its function: ${path}`);
  assert.ok((await lstat(path)).isSymbolicLink());
  await unlink(path);
  try {
    await symlink(portable, path, "dir");
  } catch (error) {
    await symlink(original, path, "dir");
    throw error;
  }
  assert.ok((await stat(path)).isDirectory(), `Dependency link must resolve to a directory: ${path}`);
  assert.ok(inside(await realpath(folder), await realpath(path)), `Repaired dependency escapes its function: ${path}`);
}
for (const endpoint of endpoints) {
  const folder = resolve(output, "functions", `${endpoint}.func`);
  const functionConfig = JSON.parse(await readFile(resolve(folder, ".vc-config.json"), "utf8"));
  const handler = await import(pathToFileURL(resolve(folder, functionConfig.handler)).href);
  assert.equal(typeof handler.default, "function", `Function cannot be loaded: ${endpoint}`);
  const require = createRequire(pathToFileURL(resolve(folder, functionConfig.handler)));
  const blobEntry = require.resolve("@vercel/blob");
  assert.ok(inside(await realpath(folder), await realpath(blobEntry)), `Blob dependency escapes its function: ${endpoint}`);
  const blob = await import(pathToFileURL(blobEntry).href);
  assert.equal(typeof blob.put, "function", `Blob dependency cannot be loaded: ${endpoint}`);
}

// Windows builders can emit backslashes in static override keys. Vercel paths
// use URL separators; leave routing regexes and every other setting untouched.
if (config.overrides) {
  const overrides = Object.fromEntries(Object.entries(config.overrides).map(([key, value]) => [
    key.replaceAll("\\", "/"),
    { ...value, ...(typeof value.path === "string" ? { path: value.path.replaceAll("\\", "/") } : {}) },
  ]));
  assert.equal(Object.keys(overrides).length, Object.keys(config.overrides).length, "Normalized override paths must stay unique");
  if (JSON.stringify(overrides) !== JSON.stringify(config.overrides)) {
    config.overrides = overrides;
    await writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  }
}
console.log(`Production output verified: ${staticFileCount} current static files, ${runtimeFiles.length} browser runtime files, ${endpoints.length} API functions; repaired ${repairs.length} dependency links.`);
