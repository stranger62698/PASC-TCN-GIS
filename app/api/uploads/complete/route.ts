import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { PASC_CONTRACT_VERSION } from "../../../types/pasc";

type CompletionBody = {
  datasetId?: string;
  parts?: Array<{ partNumber: number; etag: string }>;
  bbox?: number[];
  pointCount?: number;
  fieldCount?: number;
  metadata?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const { datasetId, parts, bbox, pointCount, fieldCount, metadata = {} } = await request.json() as CompletionBody;
  if (!datasetId || !parts?.length) return Response.json({ error: "完成参数无效" }, { status: 400 });
  const session = await env.DB.prepare(
    "SELECT object_key, r2_upload_id, filename, size_bytes FROM upload_sessions WHERE id = ? AND owner_id = ?",
  ).bind(datasetId, user.userId).first<{ object_key: string; r2_upload_id: string; filename: string; size_bytes: number }>();
  if (!session) return Response.json({ error: "上传会话不存在" }, { status: 404 });
  await env.DATASETS.resumeMultipartUpload(session.object_key, session.r2_upload_id).complete(parts);
  const schemaJson = JSON.stringify({
    ...metadata,
    size: session.size_bytes,
    chunks: parts.length,
    contractVersion: PASC_CONTRACT_VERSION,
  });
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO datasets (id, owner_id, name, source_key, status, point_count, field_count, min_lon, max_lon, min_lat, max_lat, schema_json, created_at) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(datasetId, user.userId, session.filename, session.object_key, pointCount ?? 0, fieldCount ?? 0, bbox?.[0] ?? null, bbox?.[2] ?? null, bbox?.[1] ?? null, bbox?.[3] ?? null, schemaJson, Date.now()),
    env.DB.prepare("DELETE FROM upload_sessions WHERE id = ? AND owner_id = ?").bind(datasetId, user.userId),
  ]);
  return Response.json({ contractVersion: PASC_CONTRACT_VERSION, datasetId, status: "ready" });
}
