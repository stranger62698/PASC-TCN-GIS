import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ROADOPS_OSM_ENDPOINT,
  buildRoadOpsOsmArtifacts,
  buildRoadOpsOverpassQuery,
  stableJson,
} from "./roadops-osm-core.mjs";

const root = resolve(process.cwd());
const sourcePath = resolve(root, "data/roadops/source/jiangdong-osm-roads.overpass.json");
const outputDirectory = resolve(root, "public/data/roadops");
const geojsonPath = resolve(outputDirectory, "jiangdong-osm-roads.geojson");
const manifestPath = resolve(outputDirectory, "jiangdong-osm-roads.manifest.json");
const refresh = process.argv.includes("--refresh");

async function fetchOverpass() {
  const query = buildRoadOpsOverpassQuery();
  const response = await fetch(ROADOPS_OSM_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Lanjifyw-RoadOps-Portfolio/1.0 (single AOI extract; non-commercial)",
    },
    body: new URLSearchParams({ data: query }),
  });
  if (!response.ok) throw new Error(`Overpass 请求失败：HTTP ${response.status}`);
  const payload = await response.json();
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, stableJson(payload), "utf8");
  return payload;
}

if (!refresh && !existsSync(sourcePath)) {
  throw new Error("缺少固定 Overpass 源快照；首次生成请显式运行 pnpm roadops:refresh-osm-demo");
}

const payload = refresh ? await fetchOverpass() : JSON.parse(await readFile(sourcePath, "utf8"));
const artifacts = buildRoadOpsOsmArtifacts(payload);
if (!artifacts.manifest.featureCount) throw new Error("AOI 内没有得到可用驾车道路线要素");
await mkdir(outputDirectory, { recursive: true });
await writeFile(geojsonPath, artifacts.geojsonText, "utf8");
await writeFile(manifestPath, artifacts.manifestText, "utf8");
console.log(`RoadOps OSM demo prepared: ${artifacts.manifest.featureCount} ways, ${artifacts.manifest.vertexCount} vertices.`);
console.log(`GeoJSON SHA-256: ${artifacts.manifest.geojsonSha256}`);
