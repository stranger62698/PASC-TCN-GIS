import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { PASC_CONTRACT_VERSION } from "../../types/pasc";

const MAX_USER_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_SIZE = 1024 * 1024 * 1024;

type DatasetRow = {
  id: string;
  name: string;
  status: string;
  point_count: number;
  field_count: number;
  min_lon: number | null;
  min_lat: number | null;
  max_lon: number | null;
  max_lat: number | null;
  schema_json: string | null;
  created_at: number;
};

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const result = await env.DB.prepare(
    "SELECT id, name, status, point_count, field_count, min_lon, min_lat, max_lon, max_lat, schema_json, created_at FROM datasets WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100",
  ).bind(user.userId).all<DatasetRow>();
  const items = (result.results ?? []).map(row => {
    let schema: Record<string, unknown> = {};
    try { schema = row.schema_json ? JSON.parse(row.schema_json) : {}; } catch { schema = {}; }
    return {
      id: row.id,
      name: row.name,
      size: Number(schema.size ?? 0),
      chunks: Number(schema.chunks ?? 1),
      uploadedAt: new Date(row.created_at).toISOString(),
      analysisReady: Boolean(schema.analysisReady),
      status: row.status === "archived" ? "archived" : "ready",
      pointCount: row.point_count,
      fieldCount: row.field_count,
      bbox: [row.min_lon, row.min_lat, row.max_lon, row.max_lat],
      ...schema,
    };
  });
  const usedBytes = items.reduce((sum, item) => sum + item.size, 0);
  return Response.json({
    contractVersion: PASC_CONTRACT_VERSION,
    items,
    datasets: items,
    account: {
      userId: user.userId,
      email: user.email,
      roles: user.roles ?? [],
      usedBytes,
      maxUserBytes: MAX_USER_BYTES,
      maxFileSize: MAX_FILE_SIZE,
      isAdmin: (user.roles ?? []).includes("admin"),
    },
  });
}
