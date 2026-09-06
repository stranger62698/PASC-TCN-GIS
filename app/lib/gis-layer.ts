export type Position = [number, number];

export type GisGeometry =
  | { type: "Point"; coordinates: Position }
  | { type: "MultiPoint"; coordinates: Position[] }
  | { type: "LineString"; coordinates: Position[] }
  | { type: "MultiLineString"; coordinates: Position[][] }
  | { type: "Polygon"; coordinates: Position[][] }
  | { type: "MultiPolygon"; coordinates: Position[][][] };

export type GisFeature = {
  type: "Feature";
  id: string;
  geometry: GisGeometry;
  properties: Record<string, unknown>;
};

export type GisLayerRole = "generic" | "road" | "landslide";

export type GisBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type GisLayer = {
  id: string;
  name: string;
  sourceName: string;
  sourceType: "geojson" | "shapefile";
  role: GisLayerRole;
  visible: boolean;
  opacity: number;
  featureCount: number;
  geometryTypes: string[];
  bounds: GisBounds | null;
  features: GisFeature[];
  importedAt: string;
};

export function createGisId(prefix = "gis") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function visitGeometryPositions(geometry: GisGeometry, visit: (position: Position) => void) {
  const walk = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      visit([value[0], value[1]]);
      return;
    }
    value.forEach(walk);
  };
  walk(geometry.coordinates);
}

export function getGeometryBounds(geometry: GisGeometry): GisBounds | null {
  let bounds: GisBounds | null = null;
  visitGeometryPositions(geometry, ([lon, lat]) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    if (!bounds) bounds = { west: lon, south: lat, east: lon, north: lat };
    else {
      bounds.west = Math.min(bounds.west, lon);
      bounds.south = Math.min(bounds.south, lat);
      bounds.east = Math.max(bounds.east, lon);
      bounds.north = Math.max(bounds.north, lat);
    }
  });
  return bounds;
}

export function mergeGisBounds(items: Array<GisBounds | null>): GisBounds | null {
  return items.reduce<GisBounds | null>((merged, item) => {
    if (!item) return merged;
    if (!merged) return { ...item };
    return {
      west: Math.min(merged.west, item.west),
      south: Math.min(merged.south, item.south),
      east: Math.max(merged.east, item.east),
      north: Math.max(merged.north, item.north),
    };
  }, null);
}
