const features = [
  ["BJ-CBD-0231", "国贸中心区", 116.4582, 39.9096, -8.6, -34.2, 0.91],
  ["BJ-CY-0108", "朝阳公园东", 116.4933, 39.9388, -3.2, -12.8, 0.88],
  ["BJ-FT-0784", "丰台科技园", 116.2987, 39.8241, 2.4, 9.7, 0.86],
  ["BJ-HD-0316", "中关村南", 116.3168, 39.9674, -12.4, -49.6, 0.94],
  ["BJ-DX-0422", "大兴新城北", 116.3419, 39.7526, -5.1, -20.4, 0.82],
  ["BJ-TZ-0645", "运河商务区", 116.7012, 39.9018, 5.8, 23.1, 0.89],
];

export async function GET() {
  return Response.json({
    type: "FeatureCollection",
    name: "urban_insar_points",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: features.map(([id, name, lon, lat, velocity, displacement, coherence]) => ({
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { id, name, velocity, displacement, coherence, unit: "mm/yr" },
    })),
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
