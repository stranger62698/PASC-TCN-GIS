import type { VercelRequest, VercelResponse } from "@vercel/node";
import { handleRoadOpsDrivingRequest, ROADOPS_DRIVING_MAX_BODY_BYTES, type RoadOpsDrivingHttpResult } from "../../app/lib/roadops-driving-server.js";
import { authorizeRoadOpsDrivingRequest, roadOpsDrivingMalformedJson, roadOpsDrivingServiceUnavailable } from "../../server/roadops-driving-access.js";
import { getProductionRoadOpsDrivingService } from "../../server/roadops-driving-production.js";

const malformedJson = (error: unknown) => {
  if (error instanceof SyntaxError) return true;
  if (!error || typeof error !== "object") return false;
  const value = error as { name?: unknown; code?: unknown; statusCode?: unknown; message?: unknown };
  // Vercel's lazy application/json parser throws ApiError(400, "Invalid JSON").
  // Restrict the 400 mapping to that parser contract, not every body failure.
  return value.name === "SyntaxError" || (value.statusCode === 400 && (
    value.name === "MalformedJson" || value.code === "MalformedJson" || value.message === "Invalid JSON"
  ));
};

const bodyText = (request: VercelRequest): string | RoadOpsDrivingHttpResult => {
  let value: unknown;
  try { value = request.body; }
  catch (error) {
    if (malformedJson(error)) return roadOpsDrivingMalformedJson();
    throw error;
  }
  if (typeof value === "string") return value;
  try { return JSON.stringify(value ?? {}) ?? ""; }
  catch { return ""; }
};

export default async function handler(request: VercelRequest, response: VercelResponse) {
  const access = await authorizeRoadOpsDrivingRequest({
    method: request.method ?? "GET",
    origin: String(request.headers.origin ?? ""),
    requestOrigin: `https://${String(request.headers.host ?? "")}`,
    cookieHeader: String(request.headers.cookie ?? ""),
  });
  if (!("identity" in access)) {
    Object.entries(access.headers).forEach(([name, value]) => response.setHeader(name, value));
    return response.status(access.status).json(access.body);
  }

  let result: RoadOpsDrivingHttpResult;
  try {
    const declared = Number(request.headers["content-length"] ?? 0);
    const text = Number.isFinite(declared) && declared > ROADOPS_DRIVING_MAX_BODY_BYTES ? "x".repeat(ROADOPS_DRIVING_MAX_BODY_BYTES + 1) : bodyText(request);
    if (typeof text !== "string") {
      result = text;
    } else {
      result = await handleRoadOpsDrivingRequest({
        method: request.method ?? "GET",
        origin: String(request.headers.origin ?? ""),
        host: new URL(`https://${String(request.headers.host ?? "")}`).host,
        contentType: String(request.headers["content-type"] ?? ""),
        bodyText: text,
        identity: access.identity,
      }, getProductionRoadOpsDrivingService());
    }
  } catch {
    result = roadOpsDrivingServiceUnavailable();
  }
  Object.entries(result.headers).forEach(([name, value]) => response.setHeader(name, value));
  return response.status(result.status).json(result.body);
}
