import type { InsarPoint } from "../data/site.js";

export type AoiCoordinate = [number, number];

export type AoiGeometry = {
  type: "rectangle" | "polygon";
  coordinates: AoiCoordinate[];
};

export type AoiAggregateMethod = "median" | "mean";

export type AoiSeries = {
  dates: string[];
  overall: Array<number | null>;
  groups: Array<{
    mode: string;
    pointCount: number;
    values: Array<number | null>;
  }>;
};

export type AoiSummary = {
  areaKm2: number | null;
  pointCount: number;
  meanVelocity: number;
  medianVelocity: number;
  minimumVelocity: number;
  maximumVelocity: number;
  meanCurrentDisplacement: number;
  medianCurrentDisplacement: number;
  maximumAbsoluteDisplacement: number;
  averageCoherence: number | null;
  lowCoherenceCount: number;
  missingDataCount: number;
  qualityConcernCount: number;
  modeCounts: Record<string, number>;
};

const EARTH_RADIUS_METERS = 6_371_008.8;

const finiteValues = (values: Array<number | null | undefined>) => values.filter((value): value is number => Number.isFinite(value));

export function aggregateValue(values: Array<number | null | undefined>, method: AoiAggregateMethod): number | null {
  const supplied = finiteValues(values).sort((a, b) => a - b);
  if (!supplied.length) return null;
  if (method === "mean") return supplied.reduce((sum, value) => sum + value, 0) / supplied.length;
  const middle = Math.floor(supplied.length / 2);
  return supplied.length % 2 ? supplied[middle] : (supplied[middle - 1] + supplied[middle]) / 2;
}

export function rectangleGeometry(bounds: [number, number, number, number]): AoiGeometry {
  const [west, south, east, north] = bounds;
  return { type: "rectangle", coordinates: [[west, south], [east, south], [east, north], [west, north]] };
}

export function geometryBounds(geometry: AoiGeometry): [number, number, number, number] {
  if (!geometry.coordinates.length) return [0, 0, 0, 0];
  const longitudes = geometry.coordinates.map(([longitude]) => longitude);
  const latitudes = geometry.coordinates.map(([, latitude]) => latitude);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

export function pointInPolygon(longitude: number, latitude: number, coordinates: AoiCoordinate[]): boolean {
  if (coordinates.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = coordinates.length - 1; current < coordinates.length; previous = current, current += 1) {
    const [currentX, currentY] = coordinates[current];
    const [previousX, previousY] = coordinates[previous];
    const onBoundary = Math.abs((latitude - previousY) * (currentX - previousX) - (longitude - previousX) * (currentY - previousY)) < 1e-10
      && longitude >= Math.min(previousX, currentX) && longitude <= Math.max(previousX, currentX)
      && latitude >= Math.min(previousY, currentY) && latitude <= Math.max(previousY, currentY);
    if (onBoundary) return true;
    const intersects = currentY > latitude !== previousY > latitude
      && longitude < ((previousX - currentX) * (latitude - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function aoiAreaKm2(geometry: AoiGeometry | null | undefined): number | null {
  if (!geometry || geometry.coordinates.length < 3) return null;
  const radians = Math.PI / 180;
  let total = 0;
  geometry.coordinates.forEach(([longitude, latitude], index) => {
    const [nextLongitude, nextLatitude] = geometry.coordinates[(index + 1) % geometry.coordinates.length];
    total += (nextLongitude - longitude) * radians
      * (2 + Math.sin(latitude * radians) + Math.sin(nextLatitude * radians));
  });
  return Math.abs(total) * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS / 2 / 1_000_000;
}

export function aggregateAoiSeries(
  points: InsarPoint[],
  method: AoiAggregateMethod,
  modeForPoint: (point: InsarPoint) => string = point => point.mode || "未分类",
): AoiSeries {
  const periodCount = Math.max(0, ...points.map(point => point.series.length));
  const dateSource = points.find(point => (point.dates?.length || 0) === periodCount)?.dates
    ?? points.find(point => point.dates?.length)?.dates
    ?? [];
  const dates = Array.from({ length: periodCount }, (_, index) => dateSource[index] || `第 ${index + 1} 期`);
  const aggregate = (items: InsarPoint[]) => dates.map((_, index) => aggregateValue(items.map(point => point.series[index]), method));
  const groups = [...new Set(points.map(modeForPoint))].map(mode => {
    const matching = points.filter(point => modeForPoint(point) === mode);
    return { mode, pointCount: matching.length, values: aggregate(matching) };
  });
  return { dates, overall: aggregate(points), groups };
}

export function summarizeAoi(
  points: InsarPoint[],
  timeIndex: number,
  coherenceThreshold: number,
  modeForPoint: (point: InsarPoint) => string = point => point.mode || "未分类",
  geometry?: AoiGeometry | null,
): AoiSummary | null {
  if (!points.length) return null;
  const velocities = finiteValues(points.map(point => point.velocity));
  const currentValues = finiteValues(points.map(point => point.series[Math.min(timeIndex, point.series.length - 1)] ?? point.displacement));
  const suppliedCoherence = points.filter(point => Number.isFinite(point.coherence) && point.coherence > 0);
  const lowCoherenceCount = points.filter(point => point.coherence > 0 && point.coherence < coherenceThreshold).length;
  const missingDataCount = points.filter(point => point.missingRate > .2).length;
  const modeCounts = points.reduce((counts, point) => {
    const mode = modeForPoint(point);
    counts[mode] = (counts[mode] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  return {
    areaKm2: aoiAreaKm2(geometry),
    pointCount: points.length,
    meanVelocity: aggregateValue(velocities, "mean") ?? 0,
    medianVelocity: aggregateValue(velocities, "median") ?? 0,
    minimumVelocity: velocities.length ? Math.min(...velocities) : 0,
    maximumVelocity: velocities.length ? Math.max(...velocities) : 0,
    meanCurrentDisplacement: aggregateValue(currentValues, "mean") ?? 0,
    medianCurrentDisplacement: aggregateValue(currentValues, "median") ?? 0,
    maximumAbsoluteDisplacement: currentValues.length ? Math.max(...currentValues.map(Math.abs)) : 0,
    averageCoherence: suppliedCoherence.length ? suppliedCoherence.reduce((sum, point) => sum + point.coherence, 0) / suppliedCoherence.length : null,
    lowCoherenceCount,
    missingDataCount,
    qualityConcernCount: points.filter(point => (point.coherence > 0 && point.coherence < coherenceThreshold) || point.missingRate > .2).length,
    modeCounts,
  };
}
