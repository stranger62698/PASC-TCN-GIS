import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "请先登录账户" }, { status: 401 });
  const url = new URL(request.url); const datasetId = url.searchParams.get("datasetId"); const partNumber = Number(url.searchParams.get("partNumber"));
  if (!datasetId || !Number.isInteger(partNumber) || partNumber < 1) return Response.json({ error: "分片参数无效" }, { status: 400 });
  const session = await env.DB.prepare("SELECT object_key, r2_upload_id FROM upload_sessions WHERE id = ? AND owner_id = ?").bind(datasetId, user.userId).first<{ object_key: string; r2_upload_id: string }>();
  if (!session) return Response.json({ error: "上传会话不存在" }, { status: 404 });
  const multipart = env.DATASETS.resumeMultipartUpload(session.object_key, session.r2_upload_id);
  const uploaded = await multipart.uploadPart(partNumber, request.body!);
  return Response.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
}
