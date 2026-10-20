import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  ROADOPS_OSM_AOI,
  ROADOPS_OSM_TAGS,
  buildRoadOpsOsmArtifacts,
  buildRoadOpsOverpassQuery,
  overpassToRoadGeoJson,
  stableJson,
} from "../scripts/roadops-osm-core.mjs";

const fixture = {
  osm3s: { timestamp_osm_base: "2026-09-20T00:00:00Z" },
  elements: [
    { type: "way", id: 22, tags: { highway: "residential", name: "测试路", lanes: "4", surface: "asphalt" }, geometry: [{ lon: 110.37, lat: 20 }, { lon: 110.4, lat: 20 }, { lon: 110.53, lat: 20 }] },
    { type: "way", id: 11, tags: { highway: "footway", name: "步行道" }, geometry: [{ lon: 110.4, lat: 20 }, { lon: 110.41, lat: 20.01 }] },
    { type: "way", id: 10, tags: { highway: "primary", ref: "G001", oneway: "yes" }, geometry: [{ lon: 110.39, lat: 19.96 }, { lon: 110.41, lat: 19.98 }] },
  ],
};

const visitPositions = (geometry, visit) => {
  const walk = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") visit(value);
    else value.forEach(walk);
  };
  walk(geometry.coordinates);
};

test("RoadOps Overpass query is bounded to driving ways and never references raster tiles", () => {
  const query = buildRoadOpsOverpassQuery();
  assert.match(query, /way\["highway"/);
  assert.match(query, /19\.95289,110\.37301,20\.07055,110\.52347/);
  assert.doesNotMatch(query, /tile\.openstreetmap\.org|node\[|relation\[/);
});

test("same Overpass input produces deterministic compact WGS84 GeoJSON", () => {
  const first = overpassToRoadGeoJson(fixture);
  const second = overpassToRoadGeoJson(structuredClone(fixture));
  assert.equal(stableJson(first), stableJson(second));
  assert.deepEqual(first.features.map(feature => feature.id), ["way/10", "way/22"]);
  assert.equal(first.features[1].properties.lanes, undefined);
  assert.deepEqual(Object.keys(first.features[1].properties), ["osm_id", "osm_type", "highway", "name", "surface"]);
  for (const feature of first.features) visitPositions(feature.geometry, ([lon, lat]) => {
    assert.ok(lon >= ROADOPS_OSM_AOI.west && lon <= ROADOPS_OSM_AOI.east);
    assert.ok(lat >= ROADOPS_OSM_AOI.south && lat <= ROADOPS_OSM_AOI.north);
  });
});

test("checked-in RoadOps OSM artifact matches its source snapshot and manifest", () => {
  const sourcePath = "data/roadops/source/jiangdong-osm-roads.overpass.json";
  const geojsonPath = "public/data/roadops/jiangdong-osm-roads.geojson";
  const manifestPath = "public/data/roadops/jiangdong-osm-roads.manifest.json";
  assert.ok(existsSync(sourcePath));
  assert.ok(existsSync(geojsonPath));
  assert.ok(existsSync(manifestPath));
  const payload = JSON.parse(readFileSync(sourcePath, "utf8"));
  const expected = buildRoadOpsOsmArtifacts(payload);
  const geojsonText = readFileSync(geojsonPath, "utf8");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(geojsonText, expected.geojsonText);
  assert.equal(manifest.geojsonSha256, createHash("sha256").update(geojsonText).digest("hex"));
  assert.equal(manifest.featureCount, expected.geojson.features.length);
  assert.deepEqual(manifest.scope.retainedTags, ROADOPS_OSM_TAGS);
  assert.equal(manifest.source.license, "ODbL 1.0");
  assert.equal(manifest.authoritative, false);
});

test("map integration exposes the OSM baseline, attribution, controls and non-authoritative boundary", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const panel = readFileSync("app/components/GisLayerPanel.tsx", "utf8");
  const map = readFileSync("app/components/WebGisMap.tsx", "utf8");
  assert.match(workspace, /loadRoadOpsOsmLayer/);
  assert.match(panel, /OSM 开源基线，不代表权威道路数据/);
  assert.match(panel, /https:\/\/www\.openstreetmap\.org\/copyright/);
  assert.match(panel, /透明度/);
  assert.match(map, /osm_type/);
  assert.match(map, /osm_id/);
});
