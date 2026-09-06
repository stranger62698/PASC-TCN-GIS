import { createHash } from "node:crypto";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePath = process.argv[2] ? resolve(process.argv[2]) : "";
if (!sourcePath) {
  throw new Error("用法：node scripts/prepare-xinbu-city-demo.mjs <xinbu_island.csv>");
}

function splitCsv(line) {
  const cells = [];
  let cell = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell); cell = ""; }
    else cell += character;
  }
  cells.push(cell);
  return cells;
}

const buffer = await readFile(sourcePath);
const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
const lines = text.split(/\r?\n/).filter(line => line.trim());
if (lines.length < 2) throw new Error("原始 CSV 没有有效数据行");

const headers = splitCsv(lines[0]);
const required = ["fid", "xpos", "ypos", "Vel", "coherence", "Predicted_Label", "Confidence", "Spatial_Reliability", "Spatial_Gate_Mean"];
const missing = required.filter(field => !headers.includes(field));
if (missing.length) throw new Error("原始 CSV 缺少字段：" + missing.join("、"));

const index = Object.fromEntries(headers.map((header, position) => [header, position]));
const dateFields = headers.filter(header => /^D\d{8}$/.test(header));
const classCounts = {};
const ids = new Set();
const bounds = [Infinity, Infinity, -Infinity, -Infinity];
let invalidRows = 0, missingTimeValues = 0, velocitySum = 0, velocityMin = Infinity, velocityMax = -Infinity;

for (const line of lines.slice(1)) {
  const row = splitCsv(line);
  const lon = Number(row[index.xpos]), lat = Number(row[index.ypos]), velocity = Number(row[index.Vel]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(velocity)) { invalidRows += 1; continue; }
  ids.add(row[index.fid]);
  bounds[0] = Math.min(bounds[0], lon); bounds[1] = Math.min(bounds[1], lat);
  bounds[2] = Math.max(bounds[2], lon); bounds[3] = Math.max(bounds[3], lat);
  velocityMin = Math.min(velocityMin, velocity); velocityMax = Math.max(velocityMax, velocity); velocitySum += velocity;
  const label = row[index.Predicted_Label] || "未分类";
  classCounts[label] = (classCounts[label] ?? 0) + 1;
  dateFields.forEach(field => { if (!Number.isFinite(Number(row[index[field]]))) missingTimeValues += 1; });
}

const pointCount = lines.length - 1 - invalidRows;
const outputPath = resolve(root, "public", "data", "xinbu-island-insar.csv");
const manifestPath = resolve(root, "public", "data", "xinbu-island-insar.manifest.json");
await copyFile(sourcePath, outputPath);
const manifest = {
  schemaVersion: 1,
  kind: "urban_building_dense_points",
  sourceName: basename(sourcePath),
  sourceSha256: createHash("sha256").update(buffer).digest("hex"),
  output: "public/data/xinbu-island-insar.csv",
  outputBytes: buffer.length,
  pointCount,
  invalidRows,
  uniquePointIds: ids.size,
  periodCount: dateFields.length,
  startDate: dateFields[0]?.slice(1) ?? null,
  endDate: dateFields.at(-1)?.slice(1) ?? null,
  missingTimeValues,
  bounds,
  velocity: { unit: "mm/year", min: velocityMin, max: velocityMax, mean: velocitySum / Math.max(1, pointCount) },
  classCounts,
  fields: headers,
  classification: "PASC-TCN six-class probabilities supplied by source",
  spatialEvidence: "coherence, confidence, spatial reliability and spatial gate mean supplied by source",
  evidenceBoundary: "原始文件为建筑密集区点级时序结果，未包含建筑物轮廓面；当前案例可做密集点时序、速率与模式比较，不能冒充逐建筑聚合结果。"
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ outputPath, manifestPath, pointCount, invalidRows, bounds, classCounts }, null, 2));
