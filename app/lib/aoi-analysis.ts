import type { InsarPoint } from "../data/site.js";
import { renderedDisplacementAt } from "./insar-v2.js";

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

function selectValue(values: number[], target: number) {
  let left = 0, right = values.length - 1;
  while (left < right) {
    const pivot = values[(left + right) >>> 1];
    let low = left, high = right;
    while (low <= high) {
      while (values[low] < pivot) low += 1;
      while (values[high] > pivot) high -= 1;
      if (low <= high) {
        const value = values[low]; values[low] = values[high]; values[high] = value;
        low += 1; high -= 1;
      }
    }
    if (target <= high) right = high;
    else if (target >= low) left = low;
    else break;
  }
  return values[target];
}
export function aggregateValue(values: Array<number | null | undefined>, method: AoiAggregateMethod): number | null {
  let sum = 0, count = 0;
  const supplied: number[] = [];
  for (const value of values) if (typeof value === "number" && Number.isFinite(value)) {
    sum += value; count += 1;
    if (method === "median") supplied.push(value);
  }
  if (!count) return null;
  if (method === "mean") return sum / count;
  const middle = Math.floor(count / 2), upper = selectValue(supplied, middle);
  return count % 2 ? upper : (selectValue(supplied, middle - 1) + upper) / 2;
}
export function rectangleGeometry(bounds: [number, number, number, number]): AoiGeometry {
  const [west, south, east, north] = bounds;
  return { type: "rectangle", coordinates: [[west, south], [east, south], [east, north], [west, north]] };
}

export function geometryBounds(geometry: AoiGeometry): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [longitude, latitude] of geometry.coordinates) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    west = Math.min(west, longitude); east = Math.max(east, longitude);
    south = Math.min(south, latitude); north = Math.max(north, latitude);
  }
  return west === Infinity ? [0, 0, 0, 0] : [west, south, east, north];
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
  let periodCount = 0;
  const grouped = new Map<string, InsarPoint[]>();
  for (const point of points) {
    periodCount = Math.max(periodCount, point.series.length);
    const mode = modeForPoint(point), group = grouped.get(mode);
    if (group) group.push(point); else grouped.set(mode, [point]);
  }
  const dateSource = points.find(point => (point.dates?.length || 0) === periodCount)?.dates
    ?? points.find(point => point.dates?.length)?.dates ?? [];
  const dates = Array.from({ length: periodCount }, (_, index) => dateSource[index] || `第 ${index + 1} 期`);
  const aggregate = (items: InsarPoint[]) => dates.map((_, index) => {
    if (method === "mean") {
      let sum = 0, count = 0;
      for (const point of items) {
        const value = point.series[index];
        if (typeof value === "number" && Number.isFinite(value)) { sum += value; count += 1; }
      }
      return count ? sum / count : null;
    }
    return aggregateValue(items.map(point => point.series[index]), method);
  });
  const groups = Array.from(grouped, ([mode, items]) => ({ mode, pointCount: items.length, values: aggregate(items) }));
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
  const velocities: number[] = [], currentValues: number[] = [], modeCounts: Record<string, number> = {};
  let velocitySum = 0, currentSum = 0, minimumVelocity = Infinity, maximumVelocity = -Infinity, maximumAbsoluteDisplacement = 0;
  let coherenceSum = 0, coherenceCount = 0, lowCoherenceCount = 0, missingDataCount = 0, qualityConcernCount = 0;
  for (const point of points) {
    if (Number.isFinite(point.velocity)) {
      velocities.push(point.velocity); velocitySum += point.velocity;
      minimumVelocity = Math.min(minimumVelocity, point.velocity); maximumVelocity = Math.max(maximumVelocity, point.velocity);
    }
    const value = renderedDisplacementAt(point, timeIndex);
    if (Number.isFinite(value)) { currentValues.push(value); currentSum += value; maximumAbsoluteDisplacement = Math.max(maximumAbsoluteDisplacement, Math.abs(value)); }
    if (Number.isFinite(point.coherence) && point.coherence > 0) { coherenceSum += point.coherence; coherenceCount += 1; }
    const low = point.coherence > 0 && point.coherence < coherenceThreshold, missing = point.missingRate > .2;
    if (low) lowCoherenceCount += 1;
    if (missing) missingDataCount += 1;
    if (low || missing) qualityConcernCount += 1;
    const mode = modeForPoint(point), previous = Object.prototype.hasOwnProperty.call(modeCounts, mode) ? modeCounts[mode] : 0;
    if (previous) modeCounts[mode] = previous + 1;
    else Object.defineProperty(modeCounts, mode, { value: 1, enumerable: true, configurable: true, writable: true });
  }
  return {
    areaKm2: aoiAreaKm2(geometry), pointCount: points.length,
    meanVelocity: velocities.length ? velocitySum / velocities.length : 0,
    medianVelocity: aggregateValue(velocities, "median") ?? 0,
    minimumVelocity: velocities.length ? minimumVelocity : 0,
    maximumVelocity: velocities.length ? maximumVelocity : 0,
    meanCurrentDisplacement: currentValues.length ? currentSum / currentValues.length : 0,
    medianCurrentDisplacement: aggregateValue(currentValues, "median") ?? 0,
    maximumAbsoluteDisplacement, averageCoherence: coherenceCount ? coherenceSum / coherenceCount : null,
    lowCoherenceCount, missingDataCount, qualityConcernCount, modeCounts,
  };
}