export async function GET() {
  return Response.json({
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
