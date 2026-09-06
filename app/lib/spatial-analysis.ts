import type { GisBounds, GisGeometry, Position } from "./gis-layer";

const EARTH_RADIUS_M = 6_371_008.8;

export type SpatialPoint = { lon: number; lat: number };

export class SpatialGridIndex<T extends SpatialPoint> {
  private readonly cells = new Map<string, T[]>();
  constructor(readonly cellSizeDegrees = 0.01) {}

  private cell(value: number) { return Math.floor(value / this.cellSizeDegrees); }
  private key(x: number, y: number) { return `${x}:${y}`; }

  load(items: T[]) {
    this.cells.clear();
    items.forEach((item) => {
      const key = this.key(this.cell(item.lon), this.cell(item.lat));
      const bucket = this.cells.get(key);
      if (bucket) bucket.push(item);
      else this.cells.set(key, [item]);
    });
    return this;
  }

  queryBounds(bounds: GisBounds) {
    const result: T[] = [];
    for (let x = this.cell(bounds.west); x <= this.cell(bounds.east); x += 1) {
      for (let y = this.cell(bounds.south); y <= this.cell(bounds.north); y += 1) {
        const bucket = this.cells.get(this.key(x, y));
        if (!bucket) continue;
        bucket.forEach((item) => {
          if (item.lon >= bounds.west && item.lon <= bounds.east && item.lat >= bounds.south && item.lat <= bounds.north) result.push(item);
        });
      }
    }
    return result;
  }

  queryRadius(center: SpatialPoint, radiusMeters: number) {
    const latDegrees = radiusMeters / 111_320;
    const lonDegrees = radiusMeters / Math.max(1, 111_320 * Math.cos(center.lat * Math.PI / 180));
    return this.queryBounds({ west: center.lon - lonDegrees, east: center.lon + lonDegrees, south: center.lat - latDegrees, north: center.lat + latDegrees })
      .filter((item) => haversineMeters(center, item) <= radiusMeters);
  }
}

export function haversineMeters(a: SpatialPoint, b: SpatialPoint) {
  const toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function projectMeters(position: Position, referenceLat: number): [number, number] {
  return [position[0] * 111_320 * Math.cos(referenceLat * Math.PI / 180), position[1] * 111_320];
}

export function pointToSegmentMeters(point: Position, start: Position, end: Position) {
  const [px, py] = projectMeters(point, point[1]);
  const [ax, ay] = projectMeters(start, point[1]);
  const [bx, by] = projectMeters(end, point[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function pointToLineMeters(point: Position, line: Position[]) {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversineMeters({ lon: point[0], lat: point[1] }, { lon: line[0][0], lat: line[0][1] });
  let min = Number.POSITIVE_INFINITY;
  for (let index = 1; index < line.length; index += 1) min = Math.min(min, pointToSegmentMeters(point, line[index - 1], line[index]));
  return min;
}

export function pointInRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Position, polygon: Position[][]) {
  if (!polygon[0] || !pointInRing(point, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(point: Position, geometry: GisGeometry) {
  if (geometry.type === "Polygon") return pointInPolygon(point, geometry.coordinates);
  if (geometry.type === "MultiPolygon") return geometry.coordinates.some((polygon) => pointInPolygon(point, polygon));
  if (geometry.type === "Point") return haversineMeters({ lon: point[0], lat: point[1] }, { lon: geometry.coordinates[0], lat: geometry.coordinates[1] }) < 0.1;
  return false;
}

export function geometryLines(geometry: GisGeometry): Position[][] {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

export function pointToGeometryMeters(point: Position, geometry: GisGeometry) {
  if ((geometry.type === "Polygon" || geometry.type === "MultiPolygon") && pointInGeometry(point, geometry)) return 0;
  if (geometry.type === "Point") return haversineMeters({ lon: point[0], lat: point[1] }, { lon: geometry.coordinates[0], lat: geometry.coordinates[1] });
  if (geometry.type === "MultiPoint") return Math.min(...geometry.coordinates.map((item) => haversineMeters({ lon: point[0], lat: point[1] }, { lon: item[0], lat: item[1] })));
  const lines = geometryLines(geometry);
  return lines.length ? Math.min(...lines.map((line) => pointToLineMeters(point, line))) : Number.POSITIVE_INFINITY;
}

export function circlePolygon(center: SpatialPoint, radiusMeters: number, steps = 48): Position[] {
  const points: Position[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push([
      center.lon + (Math.cos(angle) * radiusMeters) / Math.max(1, 111_320 * Math.cos(center.lat * Math.PI / 180)),
      center.lat + (Math.sin(angle) * radiusMeters) / 111_320,
    ]);
  }
  return points;
}

export async function runBatchedSpatialTask<T>(items: T[], process: (item: T, index: number) => void, options: { batchSize?: number; signal?: AbortSignal; onProgress?: (completed: number, total: number) => void } = {}) {
  const batchSize = Math.max(25, options.batchSize ?? 750);
  for (let start = 0; start < items.length; start += batchSize) {
    if (options.signal?.aborted) throw new DOMException("Spatial analysis cancelled", "AbortError");
    const end = Math.min(items.length, start + batchSize);
    for (let index = start; index < end; index += 1) process(items[index], index);
    options.onProgress?.(end, items.length);
    if (end < items.length) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}
