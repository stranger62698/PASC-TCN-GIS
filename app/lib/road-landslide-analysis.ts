import { getGeometryBounds, type GisFeature, type GisLayer } from "./gis-layer";
import { SpatialGridIndex, geometryLines, pointInGeometry, pointToGeometryMeters, runBatchedSpatialTask } from "./spatial-analysis";

export type InsarSpatialMetric = { id: string; lon: number; lat: number; velocity: number; mode?: string | null };
export type RoadRiskResult = { featureId: string; layerId: string; name: string; nearbyPointIds: string[]; pointCount: number; anomalyCount: number; averageVelocity: number | null; minVelocity: number | null; landslideCount: number; score: number; reasons: string[] };

function expandBounds(bounds: NonNullable<ReturnType<typeof getGeometryBounds>>, meters: number) {
  const centerLat = (bounds.south + bounds.north) / 2;
  const lat = meters / 111_320;
  const lon = meters / Math.max(1, 111_320 * Math.cos(centerLat * Math.PI / 180));
  return { west: bounds.west - lon, east: bounds.east + lon, south: bounds.south - lat, north: bounds.north + lat };
}

function segmentIntersects(a: number[], b: number[], c: number[], d: number[]) {
  const orient = (p: number[], q: number[], r: number[]) => Math.sign((q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]));
  return orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);
}

function lineIntersectsPolygon(line: number[][], polygon: number[][][]) {
  if (line.some((point) => pointInGeometry([point[0], point[1]], { type: "Polygon", coordinates: polygon as [number, number][][] }))) return true;
  const outer = polygon[0] ?? [];
  for (let i = 1; i < line.length; i += 1) for (let j = 1; j < outer.length; j += 1) if (segmentIntersects(line[i - 1], line[i], outer[j - 1], outer[j])) return true;
  return false;
}

function featureIntersectsLandslide(road: GisFeature, slide: GisFeature) {
  const roadLines = geometryLines(road.geometry);
  const polygons = slide.geometry.type === "Polygon" ? [slide.geometry.coordinates] : slide.geometry.type === "MultiPolygon" ? slide.geometry.coordinates : [];
  return roadLines.some((line) => polygons.some((polygon) => lineIntersectsPolygon(line, polygon)));
}

function roadName(feature: GisFeature, index: number) {
  const props = feature.properties;
  return String(props.name ?? props.NAME ?? props.road_name ?? props["道路名称"] ?? `道路要素 ${index + 1}`);
}

export async function analyzeRoadRisk(options: { points: InsarSpatialMetric[]; layers: GisLayer[]; bufferMeters?: number; anomalyVelocity?: number; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void }) {
  const bufferMeters = options.bufferMeters ?? 200;
  const anomalyVelocity = Math.abs(options.anomalyVelocity ?? 15);
  const pointIndex = new SpatialGridIndex<InsarSpatialMetric>(0.005).load(options.points);
  const roadItems = options.layers.filter((layer) => layer.visible && layer.role === "road").flatMap((layer) => layer.features.map((feature) => ({ layer, feature }))).filter(({ feature }) => feature.geometry.type.includes("Line"));
  const slides = options.layers.filter((layer) => layer.visible && layer.role === "landslide").flatMap((layer) => layer.features).filter((feature) => feature.geometry.type.includes("Polygon"));
  const results: RoadRiskResult[] = [];
  await runBatchedSpatialTask(roadItems, ({ layer, feature }, index) => {
    const bounds = getGeometryBounds(feature.geometry);
    if (!bounds) return;
    const nearby = pointIndex.queryBounds(expandBounds(bounds, bufferMeters)).filter((point) => pointToGeometryMeters([point.lon, point.lat], feature.geometry) <= bufferMeters);
    const velocities = nearby.map((point) => point.velocity).filter(Number.isFinite);
    const anomalyCount = nearby.filter((point) => Math.abs(point.velocity) >= anomalyVelocity || (point.mode && point.mode !== "Stable" && point.mode !== "undefined")).length;
    const averageVelocity = velocities.length ? velocities.reduce((sum, value) => sum + value, 0) / velocities.length : null;
    const minVelocity = velocities.length ? Math.min(...velocities) : null;
    const landslideCount = slides.filter((slide) => featureIntersectsLandslide(feature, slide)).length;
    const score = Math.min(100, Math.round((nearby.length ? anomalyCount / nearby.length * 55 : 0) + Math.min(25, Math.abs(minVelocity ?? 0)) + Math.min(20, landslideCount * 10)));
    results.push({ featureId: feature.id, layerId: layer.id, name: roadName(feature, index), nearbyPointIds: nearby.map((point) => point.id), pointCount: nearby.length, anomalyCount, averageVelocity, minVelocity, landslideCount, score, reasons: [nearby.length ? `${nearby.length} 个缓冲区 InSAR 点` : "缓冲区内暂无 InSAR 点", anomalyCount ? `${anomalyCount} 个形变异常点` : "未达到异常阈值", landslideCount ? `与 ${landslideCount} 个滑坡面相交` : "未与滑坡面相交"] });
  }, { batchSize: 30, signal: options.signal, onProgress: options.onProgress });
  return results.sort((a, b) => b.score - a.score || b.anomalyCount - a.anomalyCount);
}
