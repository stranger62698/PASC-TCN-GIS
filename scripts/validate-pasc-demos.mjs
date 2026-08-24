import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

const root = resolve(import.meta.dirname, "..");
const names = ["Stable", "Linear", "Piecewise", "Decelerating", "Accelerating", "Undefined"];
const sourceHashes = [
  "06e7925f2adb8c9604558295f4d80f15ac7d32216ed453683876cbfa667f37f4",
  "2163d28f1db058c4a3d10895e0e03a2ddffc38c235d3529a982cb7444fed519e",
];

async function sha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", chunk => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}

async function validate(csvRelative, manifestRelative, kind) {
  const csvPath = resolve(root, csvRelative);
  const manifest = JSON.parse(await readFile(resolve(root, manifestRelative), "utf8"));
  const input = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  let headers;
  let rows = 0;
  const ids = new Set();
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  for await (const line of input) {
    if (!headers) {
      headers = line.replace(/^\uFEFF/, "").replace(/\r$/, "").split(",");
      assert.equal(headers.filter(header => /^D\d{8}$/.test(header)).length, 248);
      continue;
    }
    const cells = line.replace(/\r$/, "").split(",");
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    rows += 1;
    assert.ok(!ids.has(row.fid), `duplicate fid ${row.fid}`);
    ids.add(row.fid);
    assert.equal(row.contract_version, "pasc-contract-v1");
    assert.equal(row.model_version, "pasc-tcn-haikou-v1");
    assert.equal(row.demo_kind, kind);
    assert.equal(row.Spatial_Applicability, "full_reference");
    const classId = Number(row.Predicted_Label_ID);
    assert.equal(row.Predicted_Label, names[classId]);
    counts[names[classId]] += 1;
    const probabilities = names.map(name => Number(row[`Probability_${name}`]));
    assert.ok(probabilities.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
    assert.ok(Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) <= 0.02);
    const winner = probabilities.reduce((best, value, index) => value > probabilities[best] ? index : best, 0);
    assert.equal(classId, winner);
    if (kind === "spatial") {
      const [minLon, minLat, maxLon, maxLat] = manifest.selection.bbox;
      assert.ok(Number(row.xpos) >= minLon && Number(row.xpos) <= maxLon);
      assert.ok(Number(row.ypos) >= minLat && Number(row.ypos) <= maxLat);
    }
  }
  assert.ok(rows >= 3000 && rows <= 5000);
  assert.equal(ids.size, rows);
  assert.equal(manifest.validation.pointCount, rows);
  assert.equal(manifest.validation.epochCount, 248);
  assert.deepEqual(manifest.validation.classCounts, counts);
  assert.equal(manifest.output.sha256, await sha256(csvPath));
  assert.deepEqual(manifest.sourceFiles.map(item => item.sha256), sourceHashes);
  if (kind === "showcase") {
    assert.deepEqual(Object.values(counts), [500, 500, 500, 500, 500, 500]);
    assert.match(manifest.disclaimer, /不代表科学类别比例/);
  }
  return { kind, rows, counts, sha256: manifest.output.sha256 };
}

const results = [
  await validate("public/data/haikou-insar.csv", "public/data/haikou-pasc-spatial.manifest.json", "spatial"),
  await validate("public/data/haikou-pasc-showcase.csv", "public/data/haikou-pasc-showcase.manifest.json", "showcase"),
];
console.log(JSON.stringify(results, null, 2));
