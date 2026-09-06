import proj4 from "proj4";
import { createGisId, getGeometryBounds, mergeGisBounds, type GisFeature, type GisGeometry, type GisLayer, type GisLayerRole } from "./gis-layer";

type RawFeature = { type?: string; id?: string | number; geometry?: unknown; properties?: unknown };
type RawCollection = { type?: string; name?: string; features?: RawFeature[]; crs?: unknown };
const ALLOWED_GEOMETRIES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"]);

function inferRole(name: string, features: GisFeature[]): GisLayerRole {
  const normalized = name.toLowerCase();
  if (/road|street|道路|公路|路网/.test(normalized) && features.some((item) => item.geometry.type.includes("Line"))) return "road";
  if (/landslide|slide|滑坡|崩塌/.test(normalized) && features.some((item) => item.geometry.type.includes("Polygon"))) return "landslide";
  return "generic";
}

function detectCrs(value: RawCollection) {
  const text = JSON.stringify(value.crs ?? "").toUpperCase();
  const match = text.match(/EPSG[^0-9]*(\d{4,6})/);
  if (match) return `EPSG:${match[1]}`;
  if (value.crs == null) return "EPSG:4326";
  throw new Error("GeoJSON 声明了无法识别的 CRS；请提供 EPSG 编号或先转换为 WGS84");
}

function transformGeometry(raw: unknown, sourceCrs: string): GisGeometry {
  if (!raw || typeof raw !== "object") throw new Error("要素缺少 geometry");
  const candidate = raw as { type?: string; coordinates?: unknown };
  if (!candidate.type || !ALLOWED_GEOMETRIES.has(candidate.type) || !Array.isArray(candidate.coordinates)) throw new Error(`不支持的几何类型：${candidate.type ?? "unknown"}`);
  const transformCoordinates = (value: unknown): unknown => {
    if (!Array.isArray(value)) throw new Error("几何坐标格式无效");
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      const next = sourceCrs === "EPSG:4326" ? [value[0], value[1]] : proj4(sourceCrs, "EPSG:4326", [value[0], value[1]]);
      if (!Number.isFinite(next[0]) || !Number.isFinite(next[1]) || next[0] < -180 || next[0] > 180 || next[1] < -90 || next[1] > 90) throw new Error("坐标无法转换为 WGS84，请检查数据 CRS");
      return [next[0], next[1]];
    }
    return value.map(transformCoordinates);
  };
  const geometry = { type: candidate.type, coordinates: transformCoordinates(candidate.coordinates) } as GisGeometry;
  return geometry;
}

function normalizeCollection(raw: unknown, sourceName: string, sourceType: GisLayer["sourceType"]): GisLayer {
  const collection: RawCollection = Array.isArray(raw) ? { type: "FeatureCollection", features: raw } : raw as RawCollection;
  if (!collection || typeof collection !== "object" || !Array.isArray(collection.features)) throw new Error("文件不是有效的 GeoJSON FeatureCollection");
  const sourceCrs = sourceType === "shapefile" ? "EPSG:4326" : detectCrs(collection);
  const layerId = createGisId("layer");
  const features = collection.features.flatMap<GisFeature>((rawFeature, index) => {
    if (!rawFeature?.geometry) return [];
    return [{ type: "Feature", id: `${layerId}-feature-${String(rawFeature.id ?? index)}`, geometry: transformGeometry(rawFeature.geometry, sourceCrs), properties: rawFeature.properties && typeof rawFeature.properties === "object" ? rawFeature.properties as Record<string, unknown> : {} }];
  });
  if (!features.length) throw new Error("文件中没有可显示的有效要素");
  const baseName = (collection.name || sourceName.replace(/\.(geo)?json$|\.zip$/i, "")).trim() || "GIS 图层";
  return { id: layerId, name: baseName, sourceName, sourceType, role: inferRole(baseName, features), visible: true, opacity: 0.82, featureCount: features.length, geometryTypes: [...new Set(features.map((item) => item.geometry.type))], bounds: mergeGisBounds(features.map((item) => getGeometryBounds(item.geometry))), features, importedAt: new Date().toISOString() };
}

export async function importGisFile(file: File): Promise<GisLayer[]> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".geojson") || lower.endsWith(".json")) return [normalizeCollection(JSON.parse(await file.text()) as unknown, file.name, "geojson")];
  if (lower.endsWith(".zip")) {
    const shp = (await import("shpjs")).default;
    const parsed = await shp(await file.arrayBuffer());
    const collections = Array.isArray(parsed) ? parsed : [parsed];
    return collections.map((collection, index) => normalizeCollection(collection, collections.length > 1 ? `${file.name} #${index + 1}` : file.name, "shapefile"));
  }
  throw new Error("仅支持 GeoJSON/JSON 或包含 .shp/.dbf/.prj 的 ZIP");
}

export function normalizeGeoJsonForTest(raw: unknown, sourceName = "test.geojson") { return normalizeCollection(raw, sourceName, "geojson"); }
