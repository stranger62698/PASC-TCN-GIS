const features = [
  ["102846", 110.3284, 20.04539, -0.73, -5.91, "Stable"],
  ["102863", 110.3285, 20.04542, -1.24, -10.04, "Stable"],
  ["102881", 110.3287, 20.04545, -1.22, -9.92, "Piecewise"],
  ["103241", 110.3280, 20.04519, 1.10, 8.95, "Piecewise"],
  ["103260", 110.3282, 20.04522, 0.36, 2.89, "Stable"],
];

export async function GET() {
  return Response.json({
    type: "FeatureCollection",
    name: "haikou_insar_points",
    bbox: [110.3279, 20.0374, 110.3388, 20.04547],
    schema: { id: "FID", longitude: "xpos", latitude: "ypos", timeSeries: "DYYYYMMDD", deformationMode: "Pattern", coordinateSystem: "WGS84 / EPSG:4326" },
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features: features.map(([id, lon, lat, velocity, displacement, pattern]) => ({
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [lon, lat] },
      properties: { FID: id, velocity, displacement, Pattern: pattern, unit: "mm/yr", observation_count: 210, first_date: "2017-03-22", last_date: "2025-05-03" },
    })),
  }, { headers: { "Cache-Control": "public, max-age=60" } });
}
