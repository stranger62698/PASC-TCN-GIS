import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "public", "data", "roadops", "jiangdong-osm-roads.geojson");
const OUTPUT = path.join(ROOT, "public", "data", "roadops", "jiangdong-route-demo.json");
const MANIFEST = path.join(ROOT, "public", "data", "roadops", "jiangdong-route-demo.manifest.json");
const GENERATED_AT = "2026-09-22T00:00:00Z";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const keyOf = ([longitude, latitude]) => `${longitude.toFixed(7)},${latitude.toFixed(7)}`;
const radians = (degrees) => degrees * Math.PI / 180;
const haversine = (a, b) => {
  const lat1 = radians(a[1]), lat2 = radians(b[1]);
  const deltaLat = lat2 - lat1, deltaLongitude = radians(b[0] - a[0]);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
};
const speedKph = (highway) => ({ motorway: 80, trunk: 70, primary: 55, secondary: 45, tertiary: 38, unclassified: 32, residential: 25, living_street: 15, service: 18, road: 25 })[highway] ?? 24;
const geometryParts = (feature) => feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.type === "MultiLineString" ? feature.geometry.coordinates : [];

class MinHeap {
  values = [];
  push(item) {
    this.values.push(item);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent].cost <= item.cost) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = item;
  }
  pop() {
    if (!this.values.length) return null;
    const first = this.values[0], last = this.values.pop();
    if (!this.values.length || !last) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1, right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].cost < this.values[left].cost ? right : left;
      if (this.values[child].cost >= last.cost) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

const sourceText = await readFile(SOURCE, "utf8");
const source = JSON.parse(sourceText);
const nodes = new Map();
const adjacency = new Map();
const addNode = (coordinate) => {
  const key = keyOf(coordinate);
  if (!nodes.has(key)) nodes.set(key, coordinate);
  if (!adjacency.has(key)) adjacency.set(key, []);
  return key;
};
const addEdge = (from, to, feature) => {
  const distanceMeters = haversine(from, to);
  const highway = String(feature.properties?.highway ?? "road");
  const baseSeconds = distanceMeters / (speedKph(highway) * 1000 / 3600);
  const fromKey = addNode(from), toKey = addNode(to);
  adjacency.get(fromKey).push({ to: toKey, distanceMeters, durationSeconds: baseSeconds, featureId: String(feature.id), name: String(feature.properties?.name ?? feature.properties?.ref ?? highway) });
};

for (const feature of source.features) {
  for (const coordinates of geometryParts(feature)) {
    for (let index = 1; index < coordinates.length; index += 1) {
      const previous = coordinates[index - 1], current = coordinates[index];
      const oneway = String(feature.properties?.oneway ?? "").toLowerCase();
      if (oneway !== "-1") addEdge(previous, current, feature);
      if (!["yes", "1", "true"].includes(oneway)) addEdge(current, previous, feature);
    }
  }
}

const dijkstra = (start) => {
  const distance = new Map([[start, 0]]), roadDistance = new Map([[start, 0]]), previous = new Map(), heap = new MinHeap();
  heap.push({ key: start, cost: 0 });
  while (heap.values.length) {
    const current = heap.pop();
    if (!current || current.cost !== distance.get(current.key)) continue;
    for (const edge of adjacency.get(current.key) ?? []) {
      const nextCost = current.cost + edge.durationSeconds;
      if (nextCost >= (distance.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      distance.set(edge.to, nextCost);
      roadDistance.set(edge.to, (roadDistance.get(current.key) ?? 0) + edge.distanceMeters);
      previous.set(edge.to, { key: current.key, edge });
      heap.push({ key: edge.to, cost: nextCost });
    }
  }
  return { distance, roadDistance, previous };
};

const seed = [...nodes.keys()].sort((a, b) => (adjacency.get(b)?.length ?? 0) - (adjacency.get(a)?.length ?? 0))[0];
const reachable = dijkstra(seed).distance;
const eligible = [...reachable.keys()];
const nearestEligible = (target, used) => eligible
  .filter((key) => !used.has(key))
  .map((key) => ({ key, distance: haversine(nodes.get(key), target) }))
  .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key))[0]?.key;

const targets = [
  { id: "origin", name: "江东外业驻点", role: "origin", coordinate: [110.397, 20.025], dwell: 0, value: 0 },
  { id: "terminal", name: "江东收队点", role: "destination", coordinate: [110.505, 20.025], dwell: 0, value: 0 },
  { id: "checkpoint-a", name: "北片主干路核查点", role: "candidate", coordinate: [110.410, 20.055], dwell: 35, value: 9 },
  { id: "checkpoint-b", name: "北中片属性核查点", role: "candidate", coordinate: [110.452, 20.055], dwell: 25, value: 6 },
  { id: "checkpoint-c", name: "中部拓扑核查点", role: "candidate", coordinate: [110.455, 20.020], dwell: 40, value: 10 },
  { id: "checkpoint-d", name: "东南片风险核查点", role: "candidate", coordinate: [110.490, 19.980], dwell: 30, value: 8 },
  { id: "checkpoint-e", name: "南片道路属性核查点", role: "candidate", coordinate: [110.430, 19.975], dwell: 20, value: 5 },
];
const used = new Set();
const points = targets.map((target) => {
  const nodeKey = nearestEligible(target.coordinate, used);
  if (!nodeKey) throw new Error(`No reachable OSM node for ${target.id}`);
  used.add(nodeKey);
  const coordinate = nodes.get(nodeKey), nearbyEdge = adjacency.get(nodeKey)?.[0];
  return { id: target.id, name: target.name, role: target.role, coordinate, defaultDwellMinutes: target.dwell, inspectionValue: target.value, reachable: true, sourceFeatureId: nearbyEdge?.featureId ?? null, sourceRoadName: nearbyEdge?.name ?? "未命名道路" };
});
points.push({ id: "checkpoint-f", name: "东南边界孤立路段", role: "candidate", coordinate: [110.52347, 19.96232], defaultDwellMinutes: 25, inspectionValue: 7, reachable: false, sourceFeatureId: "way/258044999", sourceRoadName: "service", unreachableReason: "AOI 裁剪边界处未接入固定演示路网" });

const pointKeys = Object.fromEntries(points.filter((point) => point.reachable).map((point) => [point.id, keyOf(point.coordinate)]));
const routes = Object.fromEntries(Object.entries(pointKeys).map(([id, key]) => [id, dijkstra(key)]));
const matrix = {}, features = [];
for (const from of points) {
  matrix[from.id] = {};
  for (const to of points) {
    if (from.id === to.id) {
      matrix[from.id][to.id] = { distanceMeters: 0, durationSeconds: 0 };
      continue;
    }
    if (!from.reachable || !to.reachable) {
      matrix[from.id][to.id] = null;
      continue;
    }
    const result = routes[from.id], targetKey = pointKeys[to.id], baseSeconds = result.distance.get(targetKey), distanceMeters = result.roadDistance.get(targetKey);
    if (!Number.isFinite(baseSeconds) || !Number.isFinite(distanceMeters)) {
      matrix[from.id][to.id] = null;
      continue;
    }
    const directionalFactor = 1 + ((from.id.localeCompare(to.id) < 0 ? 1 : -1) * 0.035);
    const durationSeconds = Math.max(1, Math.round(baseSeconds * directionalFactor));
    const roundedDistance = Math.round(distanceMeters);
    matrix[from.id][to.id] = { distanceMeters: roundedDistance, durationSeconds };
    const reversed = [];
    let cursor = targetKey;
    while (cursor !== pointKeys[from.id]) {
      reversed.push(nodes.get(cursor));
      const step = result.previous.get(cursor);
      if (!step) break;
      cursor = step.key;
    }
    reversed.push(nodes.get(pointKeys[from.id]));
    const coordinates = reversed.reverse();
    features.push({ type: "Feature", id: `${from.id}--${to.id}`, properties: { from: from.id, to: to.id, distanceMeters: roundedDistance, durationSeconds, source: "saved_osm_route_demo" }, geometry: { type: "LineString", coordinates } });
  }
}

const fixture = {
  schemaVersion: "roadops-offline-route-fixture-v1",
  fixtureId: "roadops-jiangdong-offline-route-v1",
  generatedAt: GENERATED_AT,
  mode: "offline_demo",
  source: { datasetId: "roadops-osm-jiangdong-v1", file: "jiangdong-osm-roads.geojson", sha256: sha256(sourceText), attribution: "© OpenStreetMap contributors", license: "ODbL 1.0" },
  limits: { maximumCandidates: 6, maximumMatrixPoints: 8 },
  assumptions: { speedModel: "fixed road-class speed", directionalCost: "deterministic ±3.5% asymmetric factor", liveTraffic: false, navigationUse: false },
  points,
  matrix,
  legGeometries: { type: "FeatureCollection", name: "江东离线外业路线分段", features },
  defaultPlan: { startId: "origin", endId: "terminal", candidateIds: ["checkpoint-a", "checkpoint-b", "checkpoint-c", "checkpoint-d", "checkpoint-e", "checkpoint-f"], requiredIds: ["checkpoint-c"], workMinutes: 240, returnToStart: false },
};
const outputText = `${JSON.stringify(fixture, null, 2)}\n`;
const manifest = {
  schemaVersion: "roadops-route-demo-manifest-v1",
  fixtureId: fixture.fixtureId,
  generatedAt: GENERATED_AT,
  sourceFile: "jiangdong-osm-roads.geojson",
  sourceSha256: fixture.source.sha256,
  outputFile: "jiangdong-route-demo.json",
  outputSha256: sha256(outputText),
  pointCount: points.length,
  candidateCount: points.filter((point) => point.role === "candidate").length,
  matrixDirectedPairCount: points.length * (points.length - 1),
  savedRouteFeatureCount: features.length,
  unreachablePointIds: points.filter((point) => !point.reachable).map((point) => point.id),
  externalRouteRequests: 0,
  disclaimer: "固定离线演示成本与保存的 OSM 道路形状，仅用于作品集交互和算法验证，不提供导航。",
};
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, outputText, "utf8");
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(JSON.stringify(manifest, null, 2));
