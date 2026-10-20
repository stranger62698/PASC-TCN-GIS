import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const textExtensions = new Set([
  ".cjs", ".css", ".csv", ".html", ".js", ".json", ".jsx", ".md",
  ".mjs", ".sql", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const generatedRoots = ["static-dist"];
const maximumBytes = 25 * 1024 * 1024;
const approvedSyntheticFixtureHashes = new Set([
  "3e1f6d4bfdeb8355222b368c9ed617fb014dc8f182aa2949ab77d8704126bf3f",
  "2edd0a1ef7fa0d8263b39348a7d0ad5708992460ccea9bbf4366180bbd281a4d",
]);

const patterns = [
  {
    category: "didi-or-dmap-credential",
    expression: /\b(?:DIDI|DMAP|DITU|DI_MAP|DIDI_MAP)[A-Z0-9_-]*(?:KEY|SECRET)?\s*[:=]\s*["']?([A-Za-z0-9._~+/=-]{16,})/giu,
  },
  {
    category: "generic-credential-assignment",
    expression: /\b(?:api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*["']([A-Za-z0-9._~+/=-]{16,})["']/giu,
  },
  {
    category: "credential-in-url",
    expression: /[?&](?:key|token|access_token)=([A-Za-z0-9._~+/=-]{16,})/giu,
  },
  {
    category: "private-key-block",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/gu,
  },
];

const safeValue = value => {
  if (!value) return false;
  const normalized = value.toUpperCase();
  return [
    "YOUR_", "EXAMPLE", "PLACEHOLDER", "REPLACE", "TEST_", "DUMMY",
    "PROCESS.ENV", "IMPORT.META.ENV", "NOT_CONFIGURED",
  ].some(marker => normalized.includes(marker))
    || approvedSyntheticFixtureHashes.has(createHash("sha256").update(value).digest("hex"));
};

const candidateFiles = new Set(
  execFileSync("git", [
    "ls-files", "-co", "--exclude-standard", "-z", "--",
    ":!.pnpm-store/**", ":!node_modules/**", ":!.git/**",
  ], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }).split("\0").filter(Boolean),
);

const addGeneratedFiles = directory => {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) addGeneratedFiles(absolutePath);
    else candidateFiles.add(relative(root, absolutePath).replaceAll("\\", "/"));
  }
};

for (const directory of generatedRoots) addGeneratedFiles(join(root, directory));

const findings = [];
for (const file of [...candidateFiles].sort()) {
  const absolutePath = join(root, file);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) continue;
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  if (statSync(absolutePath).size > maximumBytes) continue;

  const buffer = readFileSync(absolutePath);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");

  for (const { category, expression } of patterns) {
    expression.lastIndex = 0;
    for (const match of content.matchAll(expression)) {
      const value = match[1] ?? match[0];
      if (safeValue(value)) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({ category, file, line });
    }
  }
}

if (findings.length > 0) {
  console.error(`RoadOps secret scan failed: ${findings.length} potential credential(s).`);
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.category}]`);
  }
  process.exitCode = 1;
} else {
  console.log(`RoadOps secret scan passed: ${candidateFiles.size} repository/generated file(s) indexed; no credential values printed.`);
}
