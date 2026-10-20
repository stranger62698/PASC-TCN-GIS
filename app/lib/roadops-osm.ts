import { getGeometryBounds, mergeGisBounds, type GisFeature, type GisGeometry, type GisLayer } from "./gis-layer";

export const ROADOPS_OSM_GEOJSON_URL = "/data/roadops/jiangdong-osm-roads.geojson";
export const ROADOPS_OSM_MANIFEST_URL = "/data/roadops/jiangdong-osm-roads.manifest.json";

export type RoadOpsOsmManifest = {
  schemaVersion: "roadops-osm-manifest-v1";
  datasetId: string;
  name: string;
  source: {
    provider: string;
    transport: string;
    endpoint: string;
    extractedAt: string;
    attribution: string;
    license: string;
    licenseUrl: string;
  };
  aoi: { crs: "EPSG:4326"; bounds: [number, number, number, number] };
  featureCount: number;
  vertexCount: number;
  geojsonSha256: string;
  authoritative: false;
  disclaimer: string;
};

type RoadOpsFeatureCollection = {
  type: "FeatureCollection";
  name?: string;
  features: Array<{
    type: "Feature";
    id?: string | number;
    geometry: GisGeometry;
    properties?: Record<string, unknown>;
  }>;
};

const validBounds = (bounds: number[]): bounds is [number, number, number, number] => bounds.length === 4
  && bounds.every(Number.isFinite)
  && bounds[0] >= -180 && bounds[2] <= 180
  && bounds[1] >= -90 && bounds[3] <= 90
  && bounds[0] < bounds[2] && bounds[1] < bounds[3];

export function buildRoadOpsOsmLayer(raw: unknown, manifest: RoadOpsOsmManifest): GisLayer {
  const collection = raw as RoadOpsFeatureCollection;
  if (!collection || collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) throw new Error("RoadOps OSM GeoJSON 无效");
  if (manifest.schemaVersion !== "roadops-osm-manifest-v1" || manifest.aoi.crs !== "EPSG:4326" || !validBounds(manifest.aoi.bounds)) throw new Error("RoadOps OSM manifest 无效");
  if (manifest.authoritative !== false || !manifest.source.attribution || !manifest.source.licenseUrl) throw new Error("RoadOps OSM 来源或许可信息不完整");
  const allowedGeometry = new Set(["LineString", "MultiLineString"]);
  const features = collection.features.map<GisFeature>((feature, index) => {
    if (!feature?.geometry || !allowedGeometry.has(feature.geometry.type)) throw new Error(`RoadOps OSM 第 ${index + 1} 个要素不是道路线`);
    const osmId = String(feature.properties?.osm_id ?? "").trim();
    const highway = String(feature.properties?.highway ?? "").trim();
    if (!osmId || !highway) throw new Error(`RoadOps OSM 第 ${index + 1} 个要素缺少 OSM ID 或 highway`);
    return {
      type: "Feature",
      id: String(feature.id || `way/${osmId}`),
      geometry: feature.geometry,
      properties: { ...(feature.properties ?? {}) },
    };
  });
  if (features.length !== manifest.featureCount) throw new Error("RoadOps OSM 要素数与 manifest 不一致");
  const bounds = mergeGisBounds(features.map(feature => getGeometryBounds(feature.geometry)));
  if (!bounds || bounds.west < manifest.aoi.bounds[0] - 1e-6 || bounds.south < manifest.aoi.bounds[1] - 1e-6 || bounds.east > manifest.aoi.bounds[2] + 1e-6 || bounds.north > manifest.aoi.bounds[3] + 1e-6) throw new Error("RoadOps OSM 坐标超出冻结 AOI");
  return {
    id: manifest.datasetId,
    name: manifest.name,
    sourceName: "jiangdong-osm-roads.geojson",
    sourceType: "geojson",
    role: "road",
    visible: true,
    opacity: 0.78,
    featureCount: features.length,
    geometryTypes: [...new Set(features.map(feature => feature.geometry.type))],
    bounds,
    features,
    importedAt: manifest.source.extractedAt,
    provenance: {
      kind: "osm",
      builtIn: true,
      datasetId: manifest.datasetId,
      sourceUrl: manifest.source.endpoint,
      extractedAt: manifest.source.extractedAt,
      attribution: manifest.source.attribution,
      license: manifest.source.license,
      licenseUrl: manifest.source.licenseUrl,
      sha256: manifest.geojsonSha256,
      disclaimer: manifest.disclaimer,
    },
  };
}

export async function loadRoadOpsOsmLayer(fetcher: typeof fetch = fetch): Promise<GisLayer> {
  const [geojsonResponse, manifestResponse] = await Promise.all([
    fetcher(ROADOPS_OSM_GEOJSON_URL),
    fetcher(ROADOPS_OSM_MANIFEST_URL),
  ]);
  if (!geojsonResponse.ok || !manifestResponse.ok) throw new Error("RoadOps OSM 本地资产加载失败");
  const [geojson, manifest] = await Promise.all([
    geojsonResponse.json(),
    manifestResponse.json() as Promise<RoadOpsOsmManifest>,
  ]);
  return buildRoadOpsOsmLayer(geojson, manifest);
}
