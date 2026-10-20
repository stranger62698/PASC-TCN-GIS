import type { InsarPoint } from "../data/site.js";
import { aggregateValue, aoiAreaKm2, geometryBounds, rectangleGeometry, type AoiCoordinate, type AoiGeometry } from "./aoi-analysis.js";

export type AnomalyRegionParameters = {
  radiusMeters: number;
  minimumPoints: number;
  maximumCandidates?: number;
  sameDirection?: boolean;
};

export type AnomalyRegion = {
  id: string;
  pointIds: string[];
  geometry: AoiGeometry;
  bounds: [number, number, number, number];
  centroid: AoiCoordinate;
  pointCount: number;
  areaKm2: number;
  densityPerKm2: number | null;
  meanVelocity: number;
  medianVelocity: number;
  minimumVelocity: number;
  maximumVelocity: number;
  meanCurrentDisplacement: number;
  maximumAbsoluteDisplacement: number;
  dominantMode: string;
  modeCounts: Record<string, number>;
  clearSubsidenceCount: number;
  acceleratingCount: number;
  piecewiseCount: number;
  direction?: "negative" | "positive" | "mixed";
};

export type AnomalyRegionResult = {
  status: "ready" | "too_large";
  candidateCount: number;
  assignedPointCount: number;
  noisePointCount: number;
  regions: AnomalyRegion[];
  parameters: Required<AnomalyRegionParameters>;
  method: string;
};

const METERS_PER_LATITUDE_DEGREE = 110_574;
const DEFAULT_MAXIMUM_CANDIDATES = 50_000;

const clampParameters = (parameters: AnomalyRegionParameters): Required<AnomalyRegionParameters> => ({
  radiusMeters: Math.max(25, Math.min(5_000, Number.isFinite(parameters.radiusMeters) ? parameters.radiusMeters : 200)),
  minimumPoints: Math.max(2, Math.min(50, Math.round(Number.isFinite(parameters.minimumPoints) ? parameters.minimumPoints : 3))),
  maximumCandidates: Math.max(1_000, parameters.maximumCandidates ?? DEFAULT_MAXIMUM_CANDIDATES),
  sameDirection: parameters.sameDirection ?? false,
});

function cross(origin: AoiCoordinate, first: AoiCoordinate, second: AoiCoordinate) {
  return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (second[0] - origin[0]);
}

export function convexHull(coordinates: AoiCoordinate[]): AoiCoordinate[] {
  const unique = [...new Map(coordinates.map(coordinate => [`${coordinate[0]}:${coordinate[1]}`, coordinate])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (unique.length <= 2) return unique;
  const lower: AoiCoordinate[] = [];
  unique.forEach(point => {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  });
  const upper: AoiCoordinate[] = [];
  [...unique].reverse().forEach(point => {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  });
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function clusterGeometry(points: InsarPoint[], radiusMeters: number): AoiGeometry {
  const coordinates = points.map(point => [point.lon, point.lat] as AoiCoordinate);
  const hull = convexHull(coordinates);
  if (hull.length >= 3 && (aoiAreaKm2({ type: "polygon", coordinates: hull }) ?? 0) > 0) {
    return { type: "polygon", coordinates: hull };
  }
  const bounds = geometryBounds({ type: "polygon", coordinates });
  const latitude = (bounds[1] + bounds[3]) / 2;
  const padMeters = Math.max(20, radiusMeters * .2);
  const longitudePad = padMeters / (111_320 * Math.max(.1, Math.cos(latitude * Math.PI / 180)));
  const latitudePad = padMeters / METERS_PER_LATITUDE_DEGREE;
  return rectangleGeometry([bounds[0] - longitudePad, bounds[1] - latitudePad, bounds[2] + longitudePad, bounds[3] + latitudePad]);
}

export function buildAnomalyRegions(
  candidates: InsarPoint[],
  parameters: AnomalyRegionParameters,
  timeIndex: number,
  modeForPoint: (point: InsarPoint) => string = point => point.mode || "未分类",
  currentValueForPoint: (point: InsarPoint) => number = point => point.series[timeIndex],
): AnomalyRegionResult {
  const resolved = clampParameters(parameters);
  const method = `DBSCAN 密度连通：球面邻域半径 ${resolved.radiusMeters} m，核心邻域至少 ${resolved.minimumPoints} 个不同坐标点（含自身）${resolved.sameDirection ? "，正负方向分别聚集" : ""}；边界为候选点凸包。`;
  if (candidates.length > resolved.maximumCandidates) {
    return { status: "too_large", candidateCount: candidates.length, assignedPointCount: 0, noisePointCount: candidates.length, regions: [], parameters: resolved, method };
  }
  if (!candidates.length) {
    return { status: "ready", candidateCount: 0, assignedPointCount: 0, noisePointCount: 0, regions: [], parameters: resolved, method };
  }

  const ordered = candidates.filter(point => Number.isFinite(point.lon) && Number.isFinite(point.lat)
    && Math.abs(point.lon) <= 180 && Math.abs(point.lat) <= 90)
    .sort((a, b) => a.lon - b.lon || a.lat - b.lat || a.id.localeCompare(b.id));
  // Co-located observations share one density vote; retain every observation in output.
  const siteMap = new Map<string, InsarPoint[]>();
  for (const point of ordered) {
    const key = `${point.lon}:${point.lat}:${resolved.sameDirection ? Math.sign(point.velocity) : 0}`;
    const observations = siteMap.get(key);
    if (observations) observations.push(point);
    else siteMap.set(key, [point]);
  }
  const sites = [...siteMap.values()];
  // A 3D sphere grid avoids latitude distortion and handles the date line.
  const earthRadius = 6_371_008.8;
  const chordRadius = 2 * earthRadius * Math.sin(resolved.radiusMeters / (2 * earthRadius));
  const projected = sites.map(([point]) => {
    const latitude = point.lat * Math.PI / 180, longitude = point.lon * Math.PI / 180;
    const x = earthRadius * Math.cos(latitude) * Math.cos(longitude);
    const y = earthRadius * Math.cos(latitude) * Math.sin(longitude);
    const z = earthRadius * Math.sin(latitude);
    return { x, y, z, cellX: Math.floor(x / chordRadius), cellY: Math.floor(y / chordRadius), cellZ: Math.floor(z / chordRadius), direction: resolved.sameDirection ? Math.sign(point.velocity) : 0 };
  });
  const cellKey = (index: number) => {
    const point = projected[index];
    return `${point.cellX}:${point.cellY}:${point.cellZ}:${point.direction}`;
  };
  const cells = new Map<string, Set<number>>();
  projected.forEach((_, index) => {
    const key = cellKey(index), bucket = cells.get(key);
    if (bucket) bucket.add(index);
    else cells.set(key, new Set([index]));
  });
  const neighbors = (index: number, buckets = cells, limit = Infinity) => {
    const point = projected[index], found: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const bucket = buckets.get(`${point.cellX + dx}:${point.cellY + dy}:${point.cellZ + dz}:${point.direction}`);
          if (!bucket) continue;
          for (const candidateIndex of bucket) {
            const candidate = projected[candidateIndex];
            if ((point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2 + (point.z - candidate.z) ** 2 <= chordRadius ** 2) {
              found.push(candidateIndex);
              if (found.length >= limit) return found;
            }
          }
        }
      }
    }
    return found;
  };
  const core = sites.map((_, index) => neighbors(index, cells, resolved.minimumPoints).length >= resolved.minimumPoints);
  const unvisitedCore = new Map<string, Set<number>>();
  core.forEach((isCore, index) => {
    if (!isCore) return;
    const key = cellKey(index), bucket = unvisitedCore.get(key);
    if (bucket) bucket.add(index);
    else unvisitedCore.set(key, new Set([index]));
  });
  const labels: number[] = Array(sites.length).fill(-1);
  let clusterIndex = 0;
  core.forEach((isCore, index) => {
    if (!isCore || labels[index] >= 0) return;
    labels[index] = clusterIndex;
    unvisitedCore.get(cellKey(index))?.delete(index);
    const queue = [index];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      for (const neighbor of neighbors(queue[cursor], unvisitedCore)) {
        labels[neighbor] = clusterIndex;
        unvisitedCore.get(cellKey(neighbor))?.delete(neighbor);
        queue.push(neighbor);
      }
    }
    clusterIndex += 1;
  });
  // Border points never connect two core components; ties are deterministic.
  core.forEach((isCore, index) => {
    if (isCore) return;
    const adjacentClusters = neighbors(index).filter(neighbor => core[neighbor]).map(neighbor => labels[neighbor]);
    if (adjacentClusters.length) labels[index] = Math.min(...adjacentClusters);
  });
  const clustered = Array.from({ length: clusterIndex }, () => [] as InsarPoint[]);
  labels.forEach((label, index) => { if (label >= 0) clustered[label].push(...sites[index]); });
  const spatiallyOrdered = clustered
    .filter(points => new Set(points.map(point => `${point.lon}:${point.lat}`)).size >= resolved.minimumPoints)
    .map(points => ({ points, centroid: [points.reduce((sum, point) => sum + point.lon, 0) / points.length, points.reduce((sum, point) => sum + point.lat, 0) / points.length] as AoiCoordinate }))
    .sort((a, b) => b.centroid[1] - a.centroid[1] || a.centroid[0] - b.centroid[0]);
  const regions = spatiallyOrdered.map(({ points, centroid }, index): AnomalyRegion => {
    const geometry = clusterGeometry(points, resolved.radiusMeters);
    const areaKm2 = aoiAreaKm2(geometry) ?? 0;
    const velocities = points.map(point => point.velocity).filter(Number.isFinite);
    const currentValues = points.map(currentValueForPoint).filter(Number.isFinite);
    const modeCounts = points.reduce((counts, point) => {
      const mode = modeForPoint(point);
      counts[mode] = (counts[mode] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);
    const dominantMode = Object.entries(modeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "未分类";
    return {
      id: `AR-${String(index + 1).padStart(2, "0")}`,
      pointIds: points.map(point => point.id),
      geometry,
      bounds: geometryBounds(geometry),
      centroid,
      pointCount: points.length,
      areaKm2,
      densityPerKm2: areaKm2 > 1e-6 ? points.length / areaKm2 : null,
      meanVelocity: aggregateValue(velocities, "mean") ?? 0,
      medianVelocity: aggregateValue(velocities, "median") ?? 0,
      minimumVelocity: velocities.length ? Math.min(...velocities) : 0,
      maximumVelocity: velocities.length ? Math.max(...velocities) : 0,
      meanCurrentDisplacement: aggregateValue(currentValues, "mean") ?? 0,
      maximumAbsoluteDisplacement: currentValues.length ? Math.max(...currentValues.map(Math.abs)) : 0,
      dominantMode,
      modeCounts,
      clearSubsidenceCount: points.filter(point => point.velocity <= -3).length,
      acceleratingCount: points.filter(point => modeForPoint(point) === "加速型").length,
      piecewiseCount: points.filter(point => modeForPoint(point) === "分段型").length,
      direction: velocities.every(value => value < 0) ? "negative" : velocities.every(value => value > 0) ? "positive" : "mixed",
    };
  });
  const assignedPointCount = regions.reduce((sum, region) => sum + region.pointCount, 0);
  return {
    status: "ready",
    candidateCount: candidates.length,
    assignedPointCount,
    noisePointCount: candidates.length - assignedPointCount,
    regions,
    parameters: resolved,
    method,
  };
}
