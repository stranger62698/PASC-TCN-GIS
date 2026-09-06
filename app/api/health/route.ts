type ReadinessState = "ready" | "configured" | "unconfigured";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET() {
  const runtimeEnv = typeof process !== "undefined" ? process.env : {};
  let bindings: Record<string, unknown> = {};
  try {
    const cloudflare = await import("cloudflare:workers");
    bindings = cloudflare.env as unknown as Record<string, unknown>;
  } catch {
    // Local/static runtimes do not expose Cloudflare bindings.
  }

  const aiProvider = runtimeEnv.AI_PROVIDER?.trim().toLowerCase() || "bailian";
  const aiKey = aiProvider === "deepseek" ? runtimeEnv.DEEPSEEK_API_KEY : runtimeEnv.BAILIAN_API_KEY;
  const checks: Record<string, ReadinessState> = {
    web: "ready",
    pascService: runtimeEnv.PASC_SERVICE_BASE_URL && runtimeEnv.PASC_SERVICE_API_KEY ? "configured" : "unconfigured",
    aiProvider: aiKey ? "configured" : "unconfigured",
    database: bindings.DB ? "configured" : "unconfigured",
    objectStorage: bindings.DATASETS ? "configured" : "unconfigured",
  };
  const optionalServicesReady = Object.entries(checks).filter(([name]) => name !== "web").every(([, state]) => state === "configured");

  return Response.json({
    status: optionalServicesReady ? "ready" : "degraded",
    service: "Lanjifyw InSAR API",
    version: "v2",
    timestamp: new Date().toISOString(),
    checks,
    capabilities: {
      localStaticAnalysis: true,
      onlinePasc: checks.pascService === "configured",
      externalAi: checks.aiProvider === "configured",
      privateDatasets: checks.database === "configured" && checks.objectStorage === "configured",
    },
    note: optionalServicesReady
      ? "全部可选服务已配置；具体连通性由对应请求端点继续验证。"
      : "本地静态分析可用；未配置的可选服务按降级模式关闭。",
    endpoints: ["/api/health", "/api/pasc/infer", "/api/ai/interpret", "/api/datasets"],
  }, { headers: noStoreHeaders });
}
