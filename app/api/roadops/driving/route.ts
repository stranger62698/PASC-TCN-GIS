import { handleRoadOpsDrivingRequest, ROADOPS_DRIVING_MAX_BODY_BYTES, type RoadOpsDrivingHttpResult } from "../../../lib/roadops-driving-server";
import { authorizeRoadOpsDrivingRequest, roadOpsDrivingServiceUnavailable } from "../../../../server/roadops-driving-access.js";
import { getProductionRoadOpsDrivingService } from "../../../../server/roadops-driving-production.js";

export const runtime = "nodejs";

const identityFor = (request: Request) => {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const connecting = request.headers.get("cf-connecting-ip")?.trim();
  return `local:${connecting || forwarded || "browser"}`;
};

export async function POST(request: Request) {
  const production = process.env.VERCEL === "1";
  let identity: string;
  if (production) {
    const access = await authorizeRoadOpsDrivingRequest({
      method: request.method,
      origin: request.headers.get("origin") ?? "",
      requestOrigin: new URL(request.url).origin,
      cookieHeader: request.headers.get("cookie") ?? "",
    });
    if (!("identity" in access)) return Response.json(access.body, { status: access.status, headers: access.headers });
    identity = access.identity;
  } else {
    identity = identityFor(request);
  }

  let result: RoadOpsDrivingHttpResult;
  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    const bodyText = Number.isFinite(declared) && declared > ROADOPS_DRIVING_MAX_BODY_BYTES ? "x".repeat(ROADOPS_DRIVING_MAX_BODY_BYTES + 1) : await request.text();
    result = await handleRoadOpsDrivingRequest({
      method: request.method,
      origin: request.headers.get("origin") ?? "",
      host: production ? new URL(request.url).host : request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host,
      contentType: production ? request.headers.get("content-type") ?? "" : request.headers.get("content-type") || undefined,
      bodyText,
      identity,
      signal: request.signal,
    }, production ? getProductionRoadOpsDrivingService() : undefined);
  } catch {
    result = roadOpsDrivingServiceUnavailable();
  }
  return Response.json(result.body, { status: result.status, headers: result.headers });
}
