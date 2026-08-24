import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const { id } = await context.params;
  const row = await env.DB.prepare("SELECT source_key, name FROM datasets WHERE id = ? AND owner_id = ?").bind(id, user.userId).first<{ source_key: string; name: string }>();
  if (!row) return Response.json({ error: "数据集不存在" }, { status: 404 });
  const object = await env.DATASETS.get(row.source_key);
  if (!object) return Response.json({ error: "原始文件不存在" }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "text/csv; charset=utf-8",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
