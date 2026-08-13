import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const result = await env.DB.prepare("SELECT id, name, status, point_count, field_count, min_lon, min_lat, max_lon, max_lat, created_at FROM datasets WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100").bind(user.userId).all();
  return Response.json({ datasets: result.results });
}
