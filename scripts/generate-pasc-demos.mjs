import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";

const SCRIPT_VERSION = "generate-pasc-demos-v1";
const CONTRACT_VERSION = "pasc-contract-v1";
const MODEL_VERSION = "pasc-tcn-haikou-v1";
const CLASSES = ["Stable", "Linear", "Piecewise", "Decelerating", "Accelerating", "Undefined"];
const SOURCE_HASHES = {
  predictions: "06e7925f2adb8c9604558295f4d80f15ac7d32216ed453683876cbfa667f37f4",
  timeSeries: "2163d28f1db058c4a3d10895e0e03a2ddffc38c235d3529a982cb7444fed519e",
};
const BBOX = [110.324, 20.07, 110.37, 20.10];
const GRID_METERS = 50;
const SHOWCASE_PER_CLASS = 500;

const root = resolve(import.meta.dirname, "..");
const formalRoot = resolve(root, "..", "fyw0822");
const positional = process.argv.slice(2).filter(argument => !argument.startsWith("--"));
const predictionsPath = positional[0] || resolve(formalRoot, "results", "08_full_area_prediction", "PASC_TCN_full_area_predictions_755780.csv");
const seriesPath = positional[1] || resolve(formalRoot, "data", "SG_Filtered_subsidence_candidates_full_755780.csv");
const spatialPath = resolve(root, "public", "data", "haikou-insar.csv");
const showcasePath = resolve(root, "public", "data", "haikou-pasc-showcase.csv");
const dryRun = process.argv.includes("--dry-run");

function split(line) {
  return line.replace(/\r$/, "").split(",");
}
function hash32(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function csv(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
async function lines(path) {
  return createInterface({ input: createReadStream(path), crlfDelay: Infinity });
}
function gridKey(lon, lat) {
  const x = lon * 111320 * Math.cos(lat * Math.PI / 180);
  const y = lat * 110540;
  return `${Math.floor(x / GRID_METERS)}:${Math.floor(y / GRID_METERS)}`;
}
function keepSmallest(bucket, item, limit) {
  bucket.push(item);
  bucket.sort((a, b) => a.rank - b.rank || a.fid.localeCompare(b.fid));
  if (bucket.length > limit) bucket.pop();
}
async function sha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  stream.on("data", chunk => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}
async function writeLine(stream, values) {
  if (!stream.write(values.map(csv).join(",") + "\n")) await once(stream, "drain");
}

const predictionLines = await lines(predictionsPath);
let predictionHeaders;
const spatialCells = new Map();
const showcaseBuckets = Array.from({ length: 6 }, () => []);
for await (const line of predictionLines) {
  if (!predictionHeaders) {
    predictionHeaders = split(line.replace(/^\uFEFF/, ""));
    continue;
  }
  const cells = split(line);
  const row = Object.fromEntries(predictionHeaders.map((header, index) => [header, cells[index] ?? ""]));
  const fid = row.fid;
  const lon = Number(row.xpos);
  const lat = Number(row.ypos);
  const classId = Number(row.Predicted_Label_ID);
  if (!fid || !Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isInteger(classId) || classId < 0 || classId > 5) continue;
  const record = { fid, lon, lat, classId, row, rank: hash32(fid + ":showcase") };
  if (lon >= BBOX[0] && lon <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3]) {
    const key = gridKey(lon, lat);
    const previous = spatialCells.get(key);
    if (!previous || hash32(fid + ":spatial") < hash32(previous.fid + ":spatial")) spatialCells.set(key, record);
  }
  keepSmallest(showcaseBuckets[classId], record, SHOWCASE_PER_CLASS);
}
let spatial = [...spatialCells.values()].sort((a, b) => a.fid.localeCompare(b.fid, undefined, { numeric: true }));
if (spatial.length > 5000) spatial = [...spatial].sort((a, b) => hash32(a.fid + ":trim") - hash32(b.fid + ":trim")).slice(0, 5000).sort((a, b) => a.fid.localeCompare(b.fid, undefined, { numeric: true }));
const showcase = showcaseBuckets.flat().sort((a, b) => a.fid.localeCompare(b.fid, undefined, { numeric: true }));
if (spatial.length < 3000 || spatial.length > 5000) throw new Error(`Spatial Demo 点数 ${spatial.length} 不在 3000—5000 范围；请调整 BBOX。`);
if (showcase.length !== SHOWCASE_PER_CLASS * 6) throw new Error(`Showcase Demo 仅选择到 ${showcase.length} 点。`);
console.log(JSON.stringify({ dryRun, spatial: spatial.length, showcase: showcase.length, bbox: BBOX, gridMeters: GRID_METERS }));
if (dryRun) process.exit(0);

await mkdir(dirname(spatialPath), { recursive: true });
const spatialById = new Map(spatial.map(item => [item.fid, item]));
const showcaseById = new Map(showcase.map(item => [item.fid, item]));
const selectedIds = new Set([...spatialById.keys(), ...showcaseById.keys()]);
const spatialStream = createWriteStream(spatialPath, { encoding: "utf8" });
const showcaseStream = createWriteStream(showcasePath, { encoding: "utf8" });
let seriesHeaders;
let dateHeaders;
let outputHeaders;
const found = new Set();
for await (const line of await lines(seriesPath)) {
  if (!seriesHeaders) {
    seriesHeaders = split(line.replace(/^\uFEFF/, ""));
    dateHeaders = seriesHeaders.filter(header => /^D\d{8}$/.test(header));
    if (dateHeaders.length !== 248) throw new Error(`正式时序列应为 248，实际 ${dateHeaders.length}`);
    outputHeaders = [
      "fid", "xpos", "ypos", "Vel", "coherence", "Predicted_Label_ID", "Predicted_Label", "Confidence",
      "Low_Confidence", "Spatial_Reliability", "Spatial_Gate_Mean",
      "Probability_Stable", "Probability_Linear", "Probability_Piecewise", "Probability_Decelerating",
      "Probability_Accelerating", "Probability_Undefined", "contract_version", "model_version", "demo_kind",
      "displacement_unit", "velocity_unit", "sign_convention", "preprocessing_state", "Spatial_Applicability",
      ...dateHeaders,
    ];
    await writeLine(spatialStream, outputHeaders);
    await writeLine(showcaseStream, outputHeaders);
    continue;
  }
  const cells = split(line);
  const fid = cells[0];
  if (!selectedIds.has(fid)) continue;
  const series = Object.fromEntries(seriesHeaders.map((header, index) => [header, cells[index] ?? ""]));
  for (const [kind, selected, stream] of [["spatial", spatialById, spatialStream], ["showcase", showcaseById, showcaseStream]]) {
    const prediction = selected.get(fid);
    if (!prediction) continue;
    const row = prediction.row;
    const values = [
      fid, row.xpos, row.ypos, row.Vel, row.coherence, row.Predicted_Label_ID, CLASSES[prediction.classId], row.Confidence,
      row.Low_Confidence, row.Spatial_Reliability, row.Spatial_Gate_Mean,
      row.Probability_Stable, row.Probability_Linear, row.Probability_Piecewise, row.Probability_Decelerating,
      row.Probability_Accelerating, row.Probability_Undefined, CONTRACT_VERSION, MODEL_VERSION, kind,
      "mm", "mm/year", "toward_satellite_positive", "already_smoothed", "full_reference",
      ...dateHeaders.map(header => series[header]),
    ];
    await writeLine(stream, values);
    found.add(`${kind}:${fid}`);
  }
}
spatialStream.end();
showcaseStream.end();
await Promise.all([once(spatialStream, "finish"), once(showcaseStream, "finish")]);
if (found.size !== spatial.length + showcase.length) throw new Error(`时序连接不完整：预期 ${spatial.length + showcase.length}，实际 ${found.size}`);

function classCounts(rows) {
  return Object.fromEntries(CLASSES.map((name, id) => [name, rows.filter(row => row.classId === id).length]));
}
async function manifest(kind, path, rows, purpose, disclaimer) {
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scriptVersion: SCRIPT_VERSION,
    contractVersion: CONTRACT_VERSION,
    modelVersion: MODEL_VERSION,
    kind,
    purpose,
    disclaimer,
    sourceFiles: [
      { role: "formal_predictions", path: "results/08_full_area_prediction/PASC_TCN_full_area_predictions_755780.csv", sha256: SOURCE_HASHES.predictions },
      { role: "formal_248_epoch_series", path: "data/SG_Filtered_subsidence_candidates_full_755780.csv", sha256: SOURCE_HASHES.timeSeries },
    ],
    output: { path: path.slice(root.length + 1).replaceAll("\\", "/"), sha256: await sha256(path) },
    selection: kind === "spatial" ? { bbox: BBOX, gridMeters: GRID_METERS, rule: "continuous_bbox_then_one_deterministic_point_per_approximately_50m_grid_cell" } : { perClass: SHOWCASE_PER_CLASS, rule: "deterministic_full_area_class_stratified_sample" },
    validation: { pointCount: rows.length, epochCount: 248, uniquePointIds: new Set(rows.map(row => row.fid)).size, classCounts: classCounts(rows) },
  };
  await writeFile(path.replace(/\.csv$/, ".manifest.json").replace("haikou-insar", "haikou-pasc-spatial"), JSON.stringify(payload, null, 2) + "\n", "utf8");
}
await manifest("spatial", spatialPath, spatial, "连续区域地图与自然类别分布演示", "保持正式结果在连续区域内经约50m网格抽稀后的自然类别不平衡。");
await manifest("showcase", showcasePath, showcase, "六类界面展示与交互回归", "为覆盖六类而分层抽样，不代表科学类别比例，不得用于总体类别占比推断。");
console.log(JSON.stringify({ spatial: spatial.length, showcase: showcase.length, spatialSha256: await sha256(spatialPath), showcaseSha256: await sha256(showcasePath) }));
