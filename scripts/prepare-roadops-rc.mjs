import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fileRecord = async path => ({ path, bytes: (await stat(path)).size, sha256: hash(await readFile(path)) });
const list = async directory => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    assert.ok(!entry.isSymbolicLink(), `RC output cannot contain links: ${path}`);
    if (entry.isDirectory()) files.push(...await list(path));
    else files.push(path);
  }
  return files.sort();
};
const staticPaths = await list("static-dist");
assert.ok(staticPaths.includes("static-dist/index.html"), "Run build:static before RC inventory");
assert.ok(!staticPaths.some(path => /(?:^|\/)(?:\.env[^/]*|\.private-model-bundles|\.git)(?:\/|$)/i.test(path)), "Private artifacts must not enter static output");
const demoPaths = (await list("public/data/roadops")).filter(path => /\.(json|geojson)$/.test(path));
for (const path of demoPaths) {
  const relative = path.slice("public/".length);
  assert.equal(hash(await readFile(`static-dist/${relative}`)), hash(await readFile(path)), `Stale RoadOps asset: ${relative}`);
}
const replay = JSON.parse(await readFile("public/data/roadops/jiangdong-didi-contract-replay.manifest.json", "utf8"));
assert.equal(replay.containsDidiResponse, false);
assert.equal(replay.upstreamRequests, 0);
const gitFiles = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
const sources = [...new Set(gitFiles)].filter(path => /^(app\/|api\/|static-src\/|scripts\/|tests\/|build\/pasc-static-assets\.ts$)/.test(path) || /^(package\.json|pnpm-lock\.yaml|eslint\.config\.mjs|vite.*\.ts|vercel\.json)$/.test(path)).sort();
const documentation = [...new Set(gitFiles)].filter(path => /^docs\/(?:roadops-evidence\/|interview-portfolio\/|roadops-compliance-register|ROADOPS_)/.test(path) && /\.(md|txt)$/.test(path)).sort();
const manifest = {
  schemaVersion: "roadops-local-rc-v1",
  phase: 6,
  status: "blocked",
  generatedAt: new Date().toISOString(),
  git: { head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), branch: execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()), representsCommittedRelease: false },
  scope: "Local working-tree candidate; files are hashed, no commit or deployment created",
  deploymentApproved: false,
  liveDidiVerified: false,
  browserDownloadVerified: false,
  deploymentArtifactCurrent: false,
  blockers: ["PASS-0B key rotation evidence", "PASS-5A and PASS-5C live route and console accounting", "PASS-6B browser download completion needs manual verification", "Stale .vercel/output is not a release artifact", "RC-03/04 account terms and shared quota accounting", "RC-05/06 data rights and public map/deployment review", "PASS-6E user release approval"],
  sources: await Promise.all(sources.map(fileRecord)),
  documentation: await Promise.all(documentation.map(fileRecord)),
  demoAssets: await Promise.all(demoPaths.map(fileRecord)),
  staticOutput: await Promise.all(staticPaths.map(fileRecord)),
};
const target = resolve("docs/roadops-evidence/phase-6/manifest.json");
await mkdir(resolve("docs/roadops-evidence/phase-6"), { recursive: true });
await writeFile(target, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Local RC inventory: ${manifest.sources.length} source files, ${manifest.demoAssets.length} demo assets, ${manifest.staticOutput.length} static files. Public release remains blocked.`);
