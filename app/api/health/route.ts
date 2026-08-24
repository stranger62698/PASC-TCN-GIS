export async function GET() {
  return Response.json({
    status: "ok",
    service: "Lanje Urban InSAR API",
    version: "v1",
    timestamp: new Date().toISOString(),
    endpoints: ["/api/points", "/api/health"],
  });
}
