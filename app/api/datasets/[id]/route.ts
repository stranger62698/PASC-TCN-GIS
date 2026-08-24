import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { PASC_CONTRACT_VERSION } from "../../../types/pasc";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const { id } = await context.params;
  const current = await env.DB.prepare("SELECT name, schema_json FROM datasets WHERE id = ? AND owner_id = ?").bind(id, user.userId).first<{ name: string; schema_json: string | null }>();
  if (!current) return Response.json({ error: "数据集不存在" }, { status: 404 });
  const patch = await request.json() as Record<string, unknown>;
  let schema: Record<string, unknown> = {};
  try { schema = current.schema_json ? JSON.parse(current.schema_json) : {}; } catch { schema = {}; }
  const { name, status, ...schemaPatch } = patch;
  const nextName = typeof name === "string" && name.trim() ? name.trim().slice(0, 180) : current.name;
  const nextStatus = status === "archived" ? "archived" : "ready";
  await env.DB.prepare("UPDATE datasets SET name = ?, status = ?, schema_json = ? WHERE id = ? AND owner_id = ?")
    .bind(nextName, nextStatus, JSON.stringify({ ...schema, ...schemaPatch, contractVersion: PASC_CONTRACT_VERSION }), id, user.userId).run();
  return Response.json({ contractVersion: PASC_CONTRACT_VERSION, id, name: nextName, status: nextStatus });
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const { id } = await context.params;
  const row = await env.DB.prepare("SELECT source_key, optimized_key FROM datasets WHERE id = ? AND owner_id = ?").bind(id, user.userId).first<{ source_key: string; optimized_key: string | null }>();
  if (!row) return Response.json({ error: "数据集不存在" }, { status: 404 });
  await Promise.all([env.DATASETS.delete(row.source_key), row.optimized_key ? env.DATASETS.delete(row.optimized_key) : Promise.resolve()]);
  await env.DB.prepare("DELETE FROM datasets WHERE id = ? AND owner_id = ?").bind(id, user.userId).run();
  return Response.json({ contractVersion: PASC_CONTRACT_VERSION, deleted: id });
}
