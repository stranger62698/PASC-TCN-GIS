import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/prepare-landslide-demo.mjs <input.csv> <output.csv>");
}

const source = await fs.readFile(inputPath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const decoded = new TextDecoder("gbk").decode(source).replace(/^\uFEFF/, "");
const lines = decoded.split(/\r?\n/).filter(line => line.trim());
if (lines.length < 2) throw new Error("滑坡 CSV 至少需要标题行和一行数据。");

const headers = lines[0].split(",").map(value => value.trim());
const longitudeIndex = headers.indexOf("xpos");
const latitudeIndex = headers.indexOf("ypos");
const dateIndexes = headers.map((value, index) => /^D\d{8}$/.test(value) ? index : -1).filter(index => index >= 0);
if (longitudeIndex < 0 || latitudeIndex < 0 || dateIndexes.length < 2) {
  throw new Error("滑坡 CSV 缺少 xpos、ypos 或有效日期字段。");
}

const rows = [];
let invalidRows = 0;
const bounds = [Infinity, Infinity, -Infinity, -Infinity];
for (let index = 1; index < lines.length; index += 1) {
  const cells = lines[index].split(",");
  const longitude = Number(cells[longitudeIndex]);
  const latitude = Number(cells[latitudeIndex]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    invalidRows += 1;
    continue;
  }
  bounds[0] = Math.min(bounds[0], longitude);
  bounds[1] = Math.min(bounds[1], latitude);
  bounds[2] = Math.max(bounds[2], longitude);
  bounds[3] = Math.max(bounds[3], latitude);
  const values = dateIndexes.map(fieldIndex => {
    const value = Number(cells[fieldIndex]);
    return Number.isFinite(value) ? (Object.is(value, -0) || value === 0 ? "0.0" : value.toFixed(1)) : "";
  });
  rows.push([
    "LJ-" + String(rows.length + 1).padStart(5, "0"),
    "拉加镇滑坡",
    longitude.toFixed(6),
    latitude.toFixed(6),
    ...values,
  ].join(","));
}

const outputHeaders = ["FID", "project_name", "xpos", "ypos", ...dateIndexes.map(index => headers[index])];
await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = "\uFEFF" + outputHeaders.join(",") + "\n" + rows.join("\n") + "\n";
await fs.writeFile(outputPath, output, "utf8");

const manifest = {
  id: "demo-lajia-landslide",
  title: "拉加镇滑坡 · 时序 InSAR",
  generator: "scripts/prepare-landslide-demo.mjs",
  sourceFile: path.basename(inputPath),
  sourceSha256,
  outputSha256: createHash("sha256").update(output).digest("hex"),
  coordinateReferenceSystem: "WGS 84 / EPSG:4326",
  pointCount: rows.length,
  invalidRows,
  periodCount: dateIndexes.length,
  startDate: headers[dateIndexes[0]].slice(1),
  endDate: headers[dateIndexes.at(-1)].slice(1),
  bounds,
  displacementUnit: "mm",
  precision: "0.1 mm",
  classification: "not_provided",
};
await fs.writeFile(outputPath.replace(/\.csv$/i, ".manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify(manifest));
