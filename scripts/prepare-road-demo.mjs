import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  throw new Error("Usage: node scripts/prepare-road-demo.mjs <input.csv> <output.csv>");
}

const source = await fs.readFile(inputPath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const decoded = new TextDecoder("utf-8").decode(source).replace(/^\uFEFF/, "");
const lines = decoded.split(/\r?\n/).filter(line => line.trim());
if (lines.length < 2) throw new Error("道路 CSV 至少需要标题行和一行数据。");

const headers = lines[0].split(",").map(value => value.trim());
const required = ["xpos", "ypos", "velocity"];
const missing = required.filter(field => !headers.includes(field));
const dateColumns = headers.map((value, index) => {
  const match = value.match(/^(?:D_)?(\d{8})$/);
  return match ? { index, label: match[1] } : null;
}).filter(Boolean);
if (missing.length || dateColumns.length < 2) {
  throw new Error(`道路 CSV 缺少字段：${[...missing, ...(dateColumns.length < 2 ? ["日期序列"] : [])].join("、")}`);
}

const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
const gridMeters = 25;
const elevationField = headers.includes("DEM") ? "DEM" : headers.includes("zpos") ? "zpos" : null;
const rmseField = headers.includes("RMSEmm") ? "RMSEmm" : null;
const candidates = new Map();
const bounds = [Infinity, Infinity, -Infinity, -Infinity];
let invalidRows = 0;
let validRows = 0;

for (let rowIndex = 1; rowIndex < lines.length; rowIndex += 1) {
  const cells = lines[rowIndex].split(",");
  const longitude = Number(cells[indexes.xpos]);
  const latitude = Number(cells[indexes.ypos]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    invalidRows += 1;
    continue;
  }
  validRows += 1;
  bounds[0] = Math.min(bounds[0], longitude);
  bounds[1] = Math.min(bounds[1], latitude);
  bounds[2] = Math.max(bounds[2], longitude);
  bounds[3] = Math.max(bounds[3], latitude);
  const projectedX = longitude * 111_320 * Math.cos(latitude * Math.PI / 180);
  const projectedY = latitude * 110_574;
  const cellX = Math.floor(projectedX / gridMeters);
  const cellY = Math.floor(projectedY / gridMeters);
  const centerX = (cellX + .5) * gridMeters;
  const centerY = (cellY + .5) * gridMeters;
  const distanceToCenter = Math.hypot(projectedX - centerX, projectedY - centerY);
  const key = `${cellX}:${cellY}`;
  const current = candidates.get(key);
  if (!current || distanceToCenter < current.distanceToCenter || (distanceToCenter === current.distanceToCenter && rowIndex < current.rowIndex)) {
    candidates.set(key, { cells, longitude, latitude, distanceToCenter, rowIndex });
  }
}

const selected = [...candidates.values()].sort((first, second) => first.latitude - second.latitude || first.longitude - second.longitude || first.rowIndex - second.rowIndex);
const value = (cells, field, digits) => {
  if (!field) return "";
  const parsed = Number(cells[indexes[field]]);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : "";
};
const outputHeaders = ["FID", "project_name", "velocity", "RMSEmm", "coherence", "DEM", ...dateColumns.map(column => column.label), "xpos", "ypos"];
const rows = selected.map((item, index) => [
  `JD-${String(index + 1).padStart(5, "0")}`,
  "海口江东新区主要道路",
  value(item.cells, "velocity", 1),
  value(item.cells, rmseField, 1),
  value(item.cells, "coherence", 3),
  value(item.cells, elevationField, 1),
  ...dateColumns.map(column => {
    const parsed = Number(item.cells[column.index]);
    return Number.isFinite(parsed) ? (Object.is(parsed, -0) || parsed === 0 ? "0.0" : parsed.toFixed(1)) : "";
  }),
  item.longitude.toFixed(6),
  item.latitude.toFixed(6),
].join(","));

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const output = "\uFEFF" + outputHeaders.join(",") + "\n" + rows.join("\n") + "\n";
await fs.writeFile(outputPath, output, "utf8");

const velocities = selected.map(item => Number(item.cells[indexes.velocity])).filter(Number.isFinite).sort((a, b) => a - b);
const coherences = selected.map(item => Number(item.cells[indexes.coherence])).filter(Number.isFinite).sort((a, b) => a - b);
const manifest = {
  id: "demo-haikou-jiangdong-road",
  title: "海口江东新区主要道路 · 时序 InSAR",
  generator: "scripts/prepare-road-demo.mjs",
  sourceFile: path.basename(inputPath),
  sourceSha256,
  outputSha256: createHash("sha256").update(output).digest("hex"),
  coordinateReferenceSystem: "WGS 84 / EPSG:4326",
  sourcePointCount: validRows,
  pointCount: rows.length,
  invalidRows,
  periodCount: dateColumns.length,
  startDate: dateColumns[0].label,
  endDate: dateColumns.at(-1).label,
  bounds,
  selection: {
    gridMeters,
    rule: "one_deterministic_point_nearest_each_25m_grid_cell",
    purpose: "保留主要道路空间形态，并让公开网页点数与其他案例保持可比",
  },
  sourceFields: {
    datePrefix: headers.some(header => /^D_\d{8}$/.test(header)) ? "D_" : "",
    elevation: elevationField,
    rmse: rmseField,
  },
  displacementUnit: "mm",
  precision: "0.1 mm",
  classification: "not_provided",
  statistics: {
    velocityMinimum: velocities[0],
    velocityMedian: velocities[Math.floor(velocities.length / 2)],
    velocityMaximum: velocities.at(-1),
    coherenceMinimum: coherences[0],
    coherenceMedian: coherences[Math.floor(coherences.length / 2)],
    coherenceMaximum: coherences.at(-1),
  },
};
await fs.writeFile(outputPath.replace(/\.csv$/i, ".manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify(manifest, null, 2));
