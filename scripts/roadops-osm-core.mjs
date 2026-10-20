import { createHash } from "node:crypto";

export const ROADOPS_OSM_AOI = Object.freeze({
  west: 110.37301,
  south: 19.95289,
  east: 110.52347,
  north: 20.07055,
});

export const ROADOPS_OSM_DATASET_ID = "roadops-osm-jiangdong-v1";
export const ROADOPS_OSM_ENDPOINT = "https://overpass-api.de/api/interpreter";
export const ROADOPS_OSM_LICENSE_URL = "https://www.openstreetmap.org/copyright";
export const ROADOPS_OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const ROADOPS_DRIVING_HIGHWAYS = Object.freeze([
  "motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
  "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified",
  "residential", "living_street", "service", "road",
]);
export const ROADOPS_OSM_TAGS = Object.freeze([
  "highway", "name", "ref", "oneway", "maxspeed", "surface", "bridge", "tunnel", "access",
]);

const coordinateDigits = 6;
const roundCoordinate = value => Number(Number(value).toFixed(coordinateDigits));
const samePosition = (left, right) => left?.[0] === right?.[0] && left?.[1] === right?.[1];
const validPosition = position => Array.isArray(position)
  && Number.isFinite(position[0]) && Number.isFinite(position[1])
  && position[0] >= -180 && position[0] <= 180
  && position[1] >= -90 && position[1] <= 90;

export function buildRoadOpsOverpassQuery(bounds = ROADOPS_OSM_AOI) {
  const highwayPattern = ROADOPS_DRIVING_HIGHWAYS.join("|");
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  return `[out:json][timeout:60];\nway["highway"~"^(${highwayPattern})$"](${bbox});\nout tags geom;`;
}

function clipSegment(start, end, bounds) {
  let t0 = 0;
  let t1 = 1;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const checks = [
    [-dx, start[0] - bounds.west],
    [dx, bounds.east - start[0]],
    [-dy, start[1] - bounds.south],
    [dy, bounds.north - start[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0 && q < 0) return null;
    if (p === 0) continue;
    const ratio = q / p;
    if (p < 0) t0 = Math.max(t0, ratio);
    else t1 = Math.min(t1, ratio);
    if (t0 > t1) return null;
  }
  return [
    [roundCoordinate(start[0] + t0 * dx), roundCoordinate(start[1] + t0 * dy)],
    [roundCoordinate(start[0] + t1 * dx), roundCoordinate(start[1] + t1 * dy)],
  ];
}

export function clipLineToBounds(coordinates, bounds = ROADOPS_OSM_AOI) {
  const parts = [];
  let current = [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    if (!validPosition(start) || !validPosition(end)) continue;
    const clipped = clipSegment(start, end, bounds);
    if (!clipped || samePosition(clipped[0], clipped[1])) {
      if (current.length >= 2) parts.push(current);
      current = [];
      continue;
    }
    if (!current.length || !samePosition(current.at(-1), clipped[0])) {
      if (current.length >= 2) parts.push(current);
      current = [clipped[0], clipped[1]];
    } else if (!samePosition(current.at(-1), clipped[1])) current.push(clipped[1]);
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

function geometryFromParts(parts) {
  if (parts.length === 1) return { type: "LineString", coordinates: parts[0] };
  return { type: "MultiLineString", coordinates: parts };
}

function compactProperties(element) {
  const properties = { osm_id: String(element.id), osm_type: "way" };
  for (const key of ROADOPS_OSM_TAGS) {
    const value = element.tags?.[key];
    if (typeof value === "string" && value.trim()) properties[key] = value.trim();
  }
  return properties;
}

export function overpassToRoadGeoJson(payload, bounds = ROADOPS_OSM_AOI) {
  if (!payload || !Array.isArray(payload.elements)) throw new Error("Overpass 响应缺少 elements 数组");
  const allowedHighways = new Set(ROADOPS_DRIVING_HIGHWAYS);
  const features = payload.elements.flatMap(element => {
    if (element?.type !== "way" || !allowedHighways.has(element.tags?.highway) || !Array.isArray(element.geometry)) return [];
    const sourceCoordinates = element.geometry.map(node => [Number(node.lon), Number(node.lat)]);
    const parts = clipLineToBounds(sourceCoordinates, bounds);
    if (!parts.length) return [];
    return [{
      type: "Feature",
      id: `way/${element.id}`,
      geometry: geometryFromParts(parts),
      properties: compactProperties(element),
    }];
  }).sort((left, right) => Number(left.properties.osm_id) - Number(right.properties.osm_id));

  return {
    type: "FeatureCollection",
    name: "江东新区 OSM 开源基线路网",
    bbox: [bounds.west, bounds.south, bounds.east, bounds.north],
    features,
  };
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function geometryVertexCount(geometry) {
  if (geometry.type === "LineString") return geometry.coordinates.length;
  return geometry.coordinates.reduce((total, line) => total + line.length, 0);
}

export function buildRoadOpsOsmArtifacts(payload, options = {}) {
  const endpoint = options.endpoint || ROADOPS_OSM_ENDPOINT;
  const query = options.query || buildRoadOpsOverpassQuery();
  const geojson = overpassToRoadGeoJson(payload);
  const geojsonText = stableJson(geojson);
  const extractedAt = payload.osm3s?.timestamp_osm_base || options.extractedAt || "unknown";
  const manifest = {
    schemaVersion: "roadops-osm-manifest-v1",
    datasetId: ROADOPS_OSM_DATASET_ID,
    name: geojson.name,
    source: {
      provider: "OpenStreetMap contributors",
      transport: "Overpass API",
      endpoint,
      query,
      extractedAt,
      attribution: ROADOPS_OSM_ATTRIBUTION,
      license: "ODbL 1.0",
      licenseUrl: ROADOPS_OSM_LICENSE_URL,
    },
    aoi: { crs: "EPSG:4326", bounds: geojson.bbox },
    scope: {
      travelMode: "driving",
      highwayValues: [...ROADOPS_DRIVING_HIGHWAYS],
      retainedTags: [...ROADOPS_OSM_TAGS],
      excluded: ["pedestrian-only ways", "cycling-only ways", "railways", "OSM raster tiles"],
    },
    featureCount: geojson.features.length,
    vertexCount: geojson.features.reduce((total, feature) => total + geometryVertexCount(feature.geometry), 0),
    geometryTypes: [...new Set(geojson.features.map(feature => feature.geometry.type))].sort(),
    geojsonFile: "jiangdong-osm-roads.geojson",
    geojsonSha256: sha256Text(geojsonText),
    querySha256: sha256Text(query),
    authoritative: false,
    disclaimer: "OSM 开源基线，不代表权威道路数据，不提供导航服务。",
  };
  return { geojson, geojsonText, manifest, manifestText: stableJson(manifest) };
}
