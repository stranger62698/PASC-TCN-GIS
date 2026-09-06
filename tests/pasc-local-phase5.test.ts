import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { InsarPoint } from "../app/data/site.js";
import { buildDeepSeekWebPrompt, parseApiInterpretation, parseDeepSeekWebInterpretation } from "../app/lib/ai-analysis.js";
import { buildAiProviderRequest, resolveAiProviderConfig, resolvePersonalAiProviderConfig, runAiInterpretationProvider } from "../app/lib/ai-provider.js";
import { ANALYSIS_SUMMARY_MAX_BYTES, analysisSummaryBytes, buildAnalysisSummary, sanitizeAnalysisSummary } from "../app/lib/ai-summary.js";

const point = (id: string, mode: string, velocity: number, confidence: number): InsarPoint => ({ id, name: `secret-${id}`, lon: 110.1, lat: 20.1, velocity, displacement: velocity, coherence: 0.88, missingRate: 0.02, mode, modeConfidence: confidence, updated: "2025-01-01", dates: ["2024-01-01", "2025-01-01"], series: [0, velocity] });
const points = [point("PRIVATE-A", "稳定型", -0.4, 0.82), point("PRIVATE-B", "加速型", -5.2, 0.48)];
const summary = buildAnalysisSummary({ points, datasetLabel: "本地研究区", timeRange: { startDate: "2024-01-01", endDate: "2025-01-01" }, filterDescription: "当前异常区域", coherenceThreshold: 0.75, selectedRegion: { bounds: [110, 20, 110.2, 20.2], pointIds: points.map(item => item.id), label: "区域 A", source: "rectangle" }, selectedRegionAreaKm2: 4.2, mapView: { center: [20.1, 110.1], zoom: 12, bounds: [110, 20, 110.2, 20.2] } });

test("Phase 5 AnalysisSummary contains bounded aggregates but no point IDs or full series", () => {
  const serialized = JSON.stringify(summary);
  assert.ok(analysisSummaryBytes(summary) <= ANALYSIS_SUMMARY_MAX_BYTES);
  assert.equal(summary.confidenceStats.low, 1);
  assert.doesNotMatch(serialized, /PRIVATE-A|PRIVATE-B|secret-|pointIds|timeSeries|series/);
});

test("Phase 5 sanitizer rebuilds an allowlisted summary and drops hidden raw payloads", () => {
  const sanitized = sanitizeAnalysisSummary({ ...summary, fullCsv: "PRIVATE-A", rawSeries: [[0, -5.2]] });
  assert.doesNotMatch(JSON.stringify(sanitized), /fullCsv|rawSeries|PRIVATE-A/);
  assert.deepEqual(sanitized, summary);
});

test("Phase 5 manual DeepSeek prompt contains only the bounded summary and strict output contract", () => {
  const prompt = buildDeepSeekWebPrompt(summary);
  assert.match(prompt, /AnalysisSummary/);
  assert.match(prompt, /不得把 PASC-TCN 模式等同于灾害结论/);
  assert.match(prompt, /recommendations/);
  assert.doesNotMatch(prompt, /PRIVATE-A|PRIVATE-B|pointIds|rawSeries/);
});

test("Phase 5 imports fenced or plain DeepSeek JSON and requires uncertainty", () => {
  const json = JSON.stringify({ overview: "区域概况。", mainPatterns: ["稳定型为主。"], anomalies: ["关注加速型聚合。"], regionFeatures: ["平均速率为负。"], uncertainty: "存在低置信度且不构成灾害判断。", recommendations: ["结合现场资料复核。"] });
  const parsed = parseDeepSeekWebInterpretation("```json\n" + json + "\n```");
  assert.equal(parsed.engine, "deepseek-web-manual");
  assert.match(parsed.uncertainty, /低置信度/);
  assert.throws(() => parseDeepSeekWebInterpretation(JSON.stringify({ overview: "x" })), /mainPatterns/);
});

test("API interpretation normalizes common Bailian field aliases without weakening required content", () => {
  const parsed = parseApiInterpretation(JSON.stringify({ analysis: {
    summary: "区域总体以缓慢变化为主。",
    main_patterns: "稳定型占主导。",
    anomaly_findings: ["存在少量变化较快的候选点。"],
    region_features: ["平均速率为负。"],
    limitations: "仅基于聚合摘要，不构成灾害判断。",
    next_steps: ["结合现场资料复核。"],
  } }), "bailian", "qwen3.8-flash");
  assert.deepEqual(parsed.mainPatterns, ["稳定型占主导。"]);
  assert.match(parsed.uncertainty, /不构成灾害判断/);
  assert.throws(() => parseApiInterpretation(JSON.stringify({ overview: "只有概况。" }), "bailian", "qwen3.8-flash"), /mainPatterns/);
});

test("AI provider defaults to Bailian and switches to DeepSeek through server configuration", () => {
  const bailian = resolveAiProviderConfig({ BAILIAN_API_KEY: "bailian-secret" });
  assert.equal(bailian.provider, "bailian");
  assert.equal(bailian.model, "qwen3.8-flash");
  assert.equal(bailian.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  const deepseek = resolveAiProviderConfig({ AI_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "deepseek-secret" });
  assert.equal(deepseek.provider, "deepseek");
  assert.equal(deepseek.baseUrl, "https://api.deepseek.com");
});

test("personal API mode accepts only fixed providers and never accepts a user URL", () => {
  const bailian = resolvePersonalAiProviderConfig({ provider: "bailian", apiKey: "personal-bailian-secret" });
  assert.equal(bailian?.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(bailian?.model, "qwen3.8-flash");
  assert.equal(resolvePersonalAiProviderConfig(null), null);
  assert.throws(() => resolvePersonalAiProviderConfig({ provider: "custom", apiKey: "personal-secret", baseUrl: "https://evil.example" }), /仅支持/);
  assert.throws(() => resolvePersonalAiProviderConfig({ provider: "deepseek", apiKey: "short" }), /格式无效/);
});

test("Bailian request contains only the bounded summary and returns validated JSON", async () => {
  const config = resolveAiProviderConfig({ BAILIAN_API_KEY: "bailian-secret", BAILIAN_MODEL: "qwen3.8-flash" });
  const request = buildAiProviderRequest(summary, config);
  assert.equal(request.enable_thinking, false);
  assert.doesNotMatch(JSON.stringify(request), /PRIVATE-A|PRIVATE-B|secret-|pointIds|series/);
  const mockFetch: typeof fetch = async (_input, init) => {
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer bailian-secret");
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ overview: "区域整体缓慢沉降。", mainPatterns: ["稳定型占主导。"], anomalies: ["存在少量加速型点。"], regionFeatures: ["平均速率为负。"], uncertainty: "低置信度点需要复核，结果不构成灾害判断。", recommendations: ["结合现场监测复核。"] }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await runAiInterpretationProvider(summary, config, { fetch: mockFetch });
  assert.equal(result.engine, "bailian-api");
  assert.equal(result.provider, "bailian");
  assert.match(result.engineLabel, /qwen3\.8-flash/);
});

test("Phase 5 UI uses the same-origin API and retains the manual free-web fallback", () => {
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const client = readFileSync("app/lib/ai-analysis.ts", "utf8");
  const route = readFileSync("app/api/ai/interpret/route.ts", "utf8");
  const vercelRoute = readFileSync("api/ai/interpret.ts", "utf8");
  assert.match(workspace, /开始 AI 解读/);
  assert.match(workspace, /\/api\/ai\/interpret/);
  assert.match(workspace, /https:\/\/chat\.deepseek\.com\//);
  assert.match(workspace, /导入网页解读/);
  assert.match(route, /AI_ALLOW_ANONYMOUS/);
  assert.match(route, /AI_ALLOW_PERSONAL_ANONYMOUS/);
  assert.match(route, /sanitizeAnalysisSummary/);
  assert.match(route, /personalProvider/);
  assert.match(vercelRoute, /VercelRequest/);
  assert.match(vercelRoute, /resolveAiProviderConfig/);
  assert.match(vercelRoute, /resolvePersonalAiProviderConfig/);
  assert.match(vercelRoute, /AI_ALLOW_ANONYMOUS/);
  assert.match(vercelRoute, /AI_ALLOW_PERSONAL_ANONYMOUS/);
  assert.match(vercelRoute, /AI_INTERPRET_REQUEST_MAX_BYTES/);
  assert.match(workspace, /使用我的 API Key/);
  assert.match(workspace, /只在本次页面会话中保存/);
  assert.doesNotMatch(workspace, /(?:localStorage|sessionStorage)\.setItem\([^)]*personalAiKey|@vercel\/blob/);
  assert.doesNotMatch(workspace, /api\.deepseek\.com|dashscope\.aliyuncs\.com|BAILIAN_API_KEY|DEEPSEEK_API_KEY/);
  assert.doesNotMatch(client, /fetch\(|BAILIAN_API_KEY|DEEPSEEK_API_KEY|@vercel\/blob|\/v1\/jobs/);
});
