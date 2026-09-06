import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeGeoJsonForTest } from "../app/lib/gis-import.js";
import type { GisLayer } from "../app/lib/gis-layer.js";
import { classifyLocalAiIntent, runLocalAiTools } from "../app/lib/ai-tools.js";
import { retrieveKnowledge } from "../app/lib/rag-retriever.js";
import { analyzeRoadRisk } from "../app/lib/road-landslide-analysis.js";
import { SpatialGridIndex, pointInPolygon, pointToLineMeters, runBatchedSpatialTask } from "../app/lib/spatial-analysis.js";
import { confirmPrimaryInsarLink, distanceMeters, insarCandidates, nearestInsarPoint, parseFieldVisitCsv, photoCoordinateConflict, primaryInsarPoint, reconcileInsarLinks, type FieldObservation } from "../app/lib/field-observation.js";
import { parseWatermarkCoordinates } from "../app/lib/photo-watermark.js";

const visit = (patch: Partial<FieldObservation> = {}): FieldObservation => ({
  id: "visit-1",
  name: "世纪大桥现场考察",
  longitude: 110.35,
  latitude: 20.09,
  capturedAt: "2026-08-15 10:30",
  note: "桥头现场",
  coordinateSource: "manual",
  accuracyMeters: null,
  photos: [],
  links: [],
  associationRadiusMeters: 500,
  createdAt: "2026-08-15T10:30:00.000Z",
  updatedAt: "2026-08-15T10:30:00.000Z",
  ...patch,
});

test("field photos link to the nearest InSAR point by explicit spatial distance", () => {
  const observation = { longitude: 110.35, latitude: 20.09 };
  const points = [
    { id: "near", lon: 110.3502, lat: 20.0901, velocity: -3, coherence: .9, missingRate: 0, series: [], dates: [], mode: "Stable" },
    { id: "far", lon: 110.4, lat: 20.1, velocity: -8, coherence: .8, missingRate: 0, series: [], dates: [], mode: "Accelerating" },
  ];
  const match = nearestInsarPoint(observation, points);
  assert.equal(match?.point.id, "near");
  assert.ok((match?.distanceMeters ?? Infinity) < 30);
  assert.ok(distanceMeters(observation, { longitude: points[1].lon, latitude: points[1].lat }) > 5000);
});

test("field visit candidates remain unconfirmed until the user chooses a primary point", () => {
  const points = [
    { id: "near", lon: 110.3502, lat: 20.0901 },
    { id: "second", lon: 110.3505, lat: 20.0903 },
    { id: "far", lon: 111, lat: 21 },
  ];
  const candidates = insarCandidates(visit(), points, 100, "demo");
  assert.deepEqual(candidates.map(item => item.point.id), ["near", "second"]);
  assert.ok(candidates.every(item => item.status === "candidate"));
  assert.equal(primaryInsarPoint(visit(), points, "demo"), null);
  const confirmed = confirmPrimaryInsarLink(visit(), "demo", points[1], 100);
  assert.equal(primaryInsarPoint(confirmed, points, "demo")?.point.id, "second");
  const switched = confirmPrimaryInsarLink(confirmed, "demo", points[0], 100);
  assert.equal(switched.links.find(link => link.insarPointId === "second")?.status, "confirmed-secondary");
  assert.equal(primaryInsarPoint(switched, points, "demo")?.point.id, "near");
});

test("field visit links become stale when the active dataset no longer contains the point", () => {
  const confirmed = confirmPrimaryInsarLink(visit(), "old-dataset", { id: "p1", lon: 110.35, lat: 20.09 }, 500);
  const reconciled = reconcileInsarLinks(confirmed, "new-dataset", new Set(["p2"]));
  assert.equal(reconciled.links[0].status, "stale");
  assert.equal(primaryInsarPoint(reconciled, [{ id: "p2", lon: 110.35, lat: 20.09 }], "new-dataset"), null);
});

test("photo coordinate conflicts and visit CSV grouping are explicit", () => {
  assert.equal(photoCoordinateConflict({ exifLongitude: 110.3501, exifLatitude: 20.0901 }, visit(), 50), false);
  assert.equal(photoCoordinateConflict({ exifLongitude: 110.36, exifLatitude: 20.1 }, visit(), 50), true);
  const rows = parseFieldVisitCsv("visit_id,visit_name,file_name,longitude,latitude,captured_at,note\nHK-01,世纪大桥,IMG_001.jpg,110.35,20.09,2026-08-15 10:30,桥头\nHK-01,世纪大桥,IMG_002.jpg,110.35,20.09,2026-08-15 10:33,环境");
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.visitId === "HK-01"));
});

test("watermark OCR text restores the geotag camera coordinate pair", () => {
  const parsed = parseWatermarkCoordinates("2:110. 363739\n:20. 027695\n2026-07-30 16:57:58");
  assert.equal(parsed?.longitude, 110.363739);
  assert.equal(parsed?.latitude, 20.027695);
  assert.equal(parseWatermarkCoordinates("2026-07-30 16:57:58").longitude, null);
  assert.equal(parseWatermarkCoordinates("190.123456\n95.123456").latitude, null);
  const multiPass = parseWatermarkCoordinates("110. 363739.\n2110. 563759\n20 027695");
  assert.equal(multiPass.longitude, 110.363739);
  assert.equal(multiPass.latitude, 20.027695);
});

test("field observation UI is wired into both the workspace and Leaflet map", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  assert.match(workspace, /FieldObservationPanel/);
  assert.match(workspace, /FIELD_ASSOCIATION_LIMIT_METERS = 500/);
  assert.match(workspace, /fieldObservations=\{fieldObservations\}/);
  assert.match(workspace, /confirmed-primary/);
  assert.match(map, /field-camera-pin/);
  assert.match(map, /onFieldPhotoOpen/);
  assert.match(map, /onFieldObservationSelect/);
});

test("spatial grid index narrows bounds and radius queries", () => {
  const points = [{ id: "a", lon: 110, lat: 20 }, { id: "b", lon: 110.001, lat: 20 }, { id: "c", lon: 111, lat: 21 }];
  const index = new SpatialGridIndex<(typeof points)[number]>(0.01).load(points);
  assert.deepEqual(index.queryBounds({ west: 109.99, south: 19.99, east: 110.01, north: 20.01 }).map(item => item.id).sort(), ["a", "b"]);
  assert.deepEqual(index.queryRadius({ lon: 110, lat: 20 }, 50).map(item => item.id), ["a"]);
});

test("core geometry operations are deterministic", () => {
  assert.equal(pointInPolygon([0.5, 0.5], [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]), true);
  assert.equal(pointInPolygon([2, 2], [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]), false);
  assert.ok(pointToLineMeters([0.5, 0.001], [[0, 0], [1, 0]]) > 100);
});

test("batched analysis yields progress and preserves every item", async () => {
  const seen: number[] = [];
  let progress = 0;
  await runBatchedSpatialTask(Array.from({ length: 1600 }, (_, index) => index), item => seen.push(item), { batchSize: 300, onProgress: done => { progress = done; } });
  assert.equal(seen.length, 1600);
  assert.equal(progress, 1600);
});

test("GeoJSON import normalizes explicit Web Mercator to WGS84", () => {
  const layer = normalizeGeoJsonForTest({ type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3857" } }, features: [{ type: "Feature", properties: { name: "test" }, geometry: { type: "Point", coordinates: [12957588.7, 4851421.2] } }] });
  const point = layer.features[0].geometry;
  assert.equal(point.type, "Point");
  assert.ok(point.coordinates[0] > 116 && point.coordinates[0] < 117);
  assert.ok(point.coordinates[1] > 39 && point.coordinates[1] < 40);
});

test("local RAG retrieves method-grounded knowledge", () => {
  assert.equal(retrieveKnowledge("PASC-TCN 加速模式", 2).length, 2);
  assert.match(retrieveKnowledge("Undefined 缺测", 1)[0].content, /Undefined|缺测/);
});

test("evaluation intent set passes without model calls", () => {
  const cases = JSON.parse(readFileSync("eval/ai-v1-cases.json", "utf8")) as Array<{ query: string; expectedIntent: string }>;
  assert.equal(cases.length, 32);
  cases.forEach(item => assert.equal(classifyLocalAiIntent(item.query), item.expectedIntent, item.query));
});

test("scope tool emits traceable and clickable Evidence", async () => {
  const points = [{ id: "a", lon: 110, lat: 20, velocity: -18, mode: "Accelerating", coherence: .8, missingRate: .1 }, { id: "b", lon: 110.01, lat: 20, velocity: -2, mode: "Stable", coherence: .9, missingRate: 0 }];
  const result = await runLocalAiTools("总结当前范围的重点", { points, scopeLabel: "测试 AOI", activePoint: points[0], layers: [] });
  assert.match(result.answer, /2 个点/);
  assert.ok(result.evidence.some(item => item.kind === "scope"));
  assert.ok(result.evidence.some(item => item.kind === "tool" && item.action?.type === "focus-points"));
});

test("scope comparison reuses local statistics without model calls", async () => {
  const allPoints = [{ id: "a", lon: 110, lat: 20, velocity: -18, mode: "Accelerating" }, { id: "b", lon: 111, lat: 21, velocity: -2, mode: "Stable" }];
  const result = await runLocalAiTools("对比当前 AOI 和全数据集", { points: [allPoints[0]], allPoints, scopeLabel: "测试 AOI", layers: [] });
  assert.match(result.answer, /全数据集/);
  assert.deepEqual(result.toolNames, ["compare_scope_statistics"]);
  assert.ok(result.evidence.some(item => item.id === "tool-compare" && item.action?.type === "focus-points"));
});

test("user-facing summaries understand Chinese PASC modes and transparent anomaly rules", async () => {
  const points = [
    { id: "s1", lon: 110, lat: 20, velocity: -1, mode: "稳定型", coherence: .9 },
    { id: "s2", lon: 110.001, lat: 20, velocity: -1.2, mode: "稳定型", coherence: .9 },
    { id: "s3", lon: 110.002, lat: 20, velocity: -.8, mode: "稳定型", coherence: .9 },
    { id: "a1", lon: 110.003, lat: 20, velocity: -4, mode: "加速型", coherence: .85 },
  ];
  const result = await runLocalAiTools("总结当前范围的重点", { points, scopeLabel: "测试区域", layers: [] });
  assert.match(result.answer, /稳定型为主/);
  assert.match(result.answer, /加速型 1 个/);
  assert.match(result.answer, /候选点/);
  assert.doesNotMatch(result.answer, /4 个异常/);
});

test("generic GIS layer analysis reports scope overlap and exposes a map action", async () => {
  const building: GisLayer = { id: "buildings", name: "建筑轮廓", sourceName: "building.geojson", sourceType: "geojson", role: "generic", visible: true, opacity: 1, featureCount: 2, geometryTypes: ["Polygon"], bounds: { west: 109.99, south: 19.99, east: 110.02, north: 20.02 }, importedAt: "", features: [] };
  const result = await runLocalAiTools("分析当前范围与已导入 GIS 图层的空间关系", { points: [], scopeLabel: "测试区域", scopeBounds: { west: 110, south: 20, east: 110.01, north: 20.01 }, layers: [building] });
  assert.match(result.answer, /1 个图层的范围与当前分析范围相交/);
  assert.ok(result.evidence.some(item => item.action?.type === "focus-layer"));
});

test("road buffer and landslide intersection produce transparent ranking", async () => {
  const road: GisLayer = { id: "roads", name: "测试道路", sourceName: "road.geojson", sourceType: "geojson", role: "road", visible: true, opacity: 1, featureCount: 1, geometryTypes: ["LineString"], bounds: { west: 109.99, south: 19.99, east: 110.02, north: 20.01 }, importedAt: "", features: [{ type: "Feature", id: "road-1", properties: { name: "一号路" }, geometry: { type: "LineString", coordinates: [[110, 20], [110.02, 20]] } }] };
  const slide: GisLayer = { id: "slides", name: "测试滑坡", sourceName: "slide.geojson", sourceType: "geojson", role: "landslide", visible: true, opacity: 1, featureCount: 1, geometryTypes: ["Polygon"], bounds: { west: 110.009, south: 19.999, east: 110.011, north: 20.001 }, importedAt: "", features: [{ type: "Feature", id: "slide-1", properties: {}, geometry: { type: "Polygon", coordinates: [[[110.009, 19.999], [110.011, 19.999], [110.011, 20.001], [110.009, 20.001], [110.009, 19.999]]] } }] };
  const points = [{ id: "p1", lon: 110.01, lat: 20.0002, velocity: -20, mode: "Accelerating" }, { id: "p2", lon: 111, lat: 21, velocity: -30, mode: "Accelerating" }];
  const result = await analyzeRoadRisk({ points, layers: [road, slide], bufferMeters: 100 });
  assert.equal(result[0].pointCount, 1);
  assert.equal(result[0].landslideCount, 1);
  assert.ok(result[0].score > 0);
  assert.match(result[0].reasons.join(" "), /缓冲区|滑坡面/);
});

test("boundary evaluation refuses unsupported certainty", async () => {
  const result = await runLocalAiTools("预测滑坡什么时候发生", { points: [], scopeLabel: "当前地图视野", layers: [] });
  assert.equal(result.boundaryLimited, true);
  assert.match(result.answer, /不能给出确定的发生时间/);
  assert.ok(result.evidence.some(item => item.kind === "warning"));
});

test("MapWorkspace wires local GIS and user-facing assisted analysis", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  const assistant = readFileSync("app/components/AiEvidencePanel.tsx", "utf8");
  assert.match(workspace, /GisLayerPanel/);
  assert.match(workspace, /AiEvidencePanel/);
  assert.match(workspace, /SpatialGridIndex/);
  assert.match(assistant, /数据分析助手/);
  assert.doesNotMatch(assistant, /AI Tools \+ RAG \+ Evidence/);
  assert.match(map, /onGisFeatureSelect/);
  assert.match(map, /L\.geoJSON/);
});
