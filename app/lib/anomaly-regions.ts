import type { InsarPoint } from "../data/site.js";
import { aggregateValue, aoiAreaKm2, geometryBounds, rectangleGeometry, type AoiCoordinate, type AoiGeometry } from "./aoi-analysis.js";

export type AnomalyRegionParameters = {
  radiusMeters: number;
  minimumPoints: number;
  maximumCandidates?: number;
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
): AnomalyRegionResult {
  const resolved = clampParameters(parameters);
  const method = `网格索引密度连通：邻域半径 ${resolved.radiusMeters} m，核心点至少 ${resolved.minimumPoints} 个；边界为候选点凸包。`;
  if (candidates.length > resolved.maximumCandidates) {
    return { status: "too_large", candidateCount: candidates.length, assignedPointCount: 0, noisePointCount: candidates.length, regions: [], parameters: resolved, method };
  }
  if (!candidates.length) {
    return { status: "ready", candidateCount: 0, assignedPointCount: 0, noisePointCount: 0, regions: [], parameters: resolved, method };
  }

  const ordered = [...candidates].sort((a, b) => a.lon - b.lon || a.lat - b.lat || a.id.localeCompare(b.id));
  const referenceLatitude = ordered.reduce((sum, point) => sum + point.lat, 0) / ordered.length;
  const metersPerLongitudeDegree = 111_320 * Math.max(.1, Math.cos(referenceLatitude * Math.PI / 180));
  const projected = ordered.map(point => ({ x: point.lon * metersPerLongitudeDegree, y: point.lat * METERS_PER_LATITUDE_DEGREE }));
  const cells = new Map<string, number[]>();
  projected.forEach((point, index) => {
    const key = `${Math.floor(point.x / resolved.radiusMeters)}:${Math.floor(point.y / resolved.radiusMeters)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(index);
    else cells.set(key, [index]);
  });
  const neighbors = (index: number) => {
    const point = projected[index], cellX = Math.floor(point.x / resolved.radiusMeters), cellY = Math.floor(point.y / resolved.radiusMeters);
    const found: number[] = [];
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        (cells.get(`${cellX + offsetX}:${cellY + offsetY}`) || []).forEach(candidateIndex => {
          const candidate = projected[candidateIndex];
          if (Math.hypot(point.x - candidate.x, point.y - candidate.y) <= resolved.radiusMeters) found.push(candidateIndex);
        });
      }
    }
    return found.sort((a, b) => a - b);
  };

  const labels = Array(ordered.length).fill(-1);
  const noise = -2;
  let clusterIndex = 0;
  ordered.forEach((_, pointIndex) => {
    if (labels[pointIndex] !== -1) return;
    const firstNeighbors = neighbors(pointIndex);
    if (firstNeighbors.length < resolved.minimumPoints) {
      labels[pointIndex] = noise;
      return;
    }
    labels[pointIndex] = clusterIndex;
    const queue = [...firstNeighbors];
    const queued = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const neighborIndex = queue[cursor];
      if (labels[neighborIndex] === noise) labels[neighborIndex] = clusterIndex;
      if (labels[neighborIndex] !== -1) continue;
      labels[neighborIndex] = clusterIndex;
      const nextNeighbors = neighbors(neighborIndex);
      if (nextNeighbors.length < resolved.minimumPoints) continue;
      nextNeighbors.forEach(nextIndex => {
        if (!queued.has(nextIndex)) {
          queued.add(nextIndex);
          queue.push(nextIndex);
        }
      });
    }
    clusterIndex += 1;
  });

  const clustered = Array.from({ length: clusterIndex }, () => [] as InsarPoint[]);
  labels.forEach((label, index) => { if (label >= 0) clustered[label].push(ordered[index]); });
  const spatiallyOrdered = clustered
    .map(points => ({ points, centroid: [points.reduce((sum, point) => sum + point.lon, 0) / points.length, points.reduce((sum, point) => sum + point.lat, 0) / points.length] as AoiCoordinate }))
    .sort((a, b) => b.centroid[1] - a.centroid[1] || a.centroid[0] - b.centroid[0]);
  const regions = spatiallyOrdered.map(({ points, centroid }, index): AnomalyRegion => {
    const geometry = clusterGeometry(points, resolved.radiusMeters);
    const areaKm2 = aoiAreaKm2(geometry) ?? 0;
    const velocities = points.map(point => point.velocity).filter(Number.isFinite);
    const currentValues = points.map(point => point.series[Math.min(timeIndex, point.series.length - 1)] ?? point.displacement).filter(Number.isFinite);
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
