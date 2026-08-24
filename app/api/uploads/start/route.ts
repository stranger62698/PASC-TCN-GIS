import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const { filename, size, contentType = "text/csv" } = await request.json() as { filename?: string; size?: number; contentType?: string };
  if (!filename || !size || size <= 0) return Response.json({ error: "文件信息无效" }, { status: 400 });
  const datasetId = crypto.randomUUID();
  const safeName = filename.replace(/[^\w.\-\u4e00-\u9fa5]/g, "_");
  const objectKey = `datasets/${user.userId}/${datasetId}/source-${safeName}`;
  const upload = await env.DATASETS.createMultipartUpload(objectKey, { httpMetadata: { contentType }, customMetadata: { ownerId: user.userId, datasetId, originalName: filename } });
  await env.DB.prepare("INSERT INTO upload_sessions (id, owner_id, object_key, r2_upload_id, filename, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(datasetId, user.userId, objectKey, upload.uploadId, filename, size, Date.now()).run();
  return Response.json({ datasetId, uploadId: upload.uploadId, objectKey, recommendedPartSize: 32 * 1024 * 1024 });
}
