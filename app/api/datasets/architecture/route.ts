export async function GET() {
  return Response.json({
    acceptedCsvSchemas: {
      haikou: { pointId: ["FID"], longitude: ["xpos", "lon", "经度"], latitude: ["ypos", "lat", "纬度"], timeSeries: "DYYYYMMDD (例如 D20170322)", pattern: ["Pattern", "mode", "形变模式"] },
      coordinateRules: ["采用 WGS84 经纬度（EPSG:4326）", "自动过滤空坐标、(0,0) 与超出经纬度范围的记录", "以全部有效点的 min/max 经纬度生成 bbox 并定位底图"],
    },
    recommendedPipeline: [
      "浏览器以 16-64 MB 分片直传 R2，避免 2 GB 文件经过应用内存",
      "后台流式解析 CSV，计算 bbox/字段/行数并转为 GeoParquet",
      "空间摘要生成 PMTiles/MVT，前端仅请求当前视野瓦片",
      "点选后按 point_id 查询单点属性和 200 期时间序列",
    ],
    storage: {
      raw: "R2: datasets/{owner_id}/{dataset_id}/source.csv",
      optimized: "R2: GeoParquet + PMTiles + optional COG",
      metadata: "D1: ownership, bbox, schema, processing status",
      query: "DuckDB/Worker service or indexed analytical API",
    },
    frontendLimits: { directPreviewSample: 50000, renderStrategy: "WebGL/MVT", never: "load all rows and 200+ columns into browser" },
  });
}
