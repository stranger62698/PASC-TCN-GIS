import { sanitizeAnalysisSummary, type AnalysisSummary } from "./ai-summary.js";

export type AiInterpretationProvider = "manual" | "bailian" | "deepseek";
export type AiInterpretationEngine = "deepseek-web-manual" | "bailian-api" | "deepseek-api";

export type RegionalInterpretation = {
  engine: AiInterpretationEngine;
  engineLabel: string;
  provider: AiInterpretationProvider;
  model: string;
  overview: string;
  mainPatterns: string[];
  anomalies: string[];
  regionFeatures: string[];
  uncertainty: string;
  recommendations: string[];
  createdAt: string;
  cached: boolean;
};

type InterpretationContent = Pick<RegionalInterpretation, "overview" | "mainPatterns" | "anomalies" | "regionFeatures" | "uncertainty" | "recommendations">;
type InterpretationMetadata = Pick<RegionalInterpretation, "engine" | "engineLabel" | "provider" | "model" | "cached"> & { createdAt?: string };

export const AI_INTERPRETATION_SYSTEM_PROMPT = [
  "你是时序 InSAR 区域分析解释助手。只能解释用户提供的 AnalysisSummary，不能假设已查看完整 CSV、点位明细或完整时序。",
  "不得虚构地质成因、工程原因或现场事实；不得把 PASC-TCN 模式等同于灾害结论；必须明确低置信度、数据质量和空间参考限制。",
  "只返回合法 JSON 对象，不要使用 Markdown 代码围栏或补充说明。字段必须完全为 overview、mainPatterns、anomalies、regionFeatures、uncertainty、recommendations。",
  '必须严格采用以下结构，所有数组至少包含一个字符串，不得改成中文键、snake_case 或嵌套对象：{"overview":"...","mainPatterns":["..."],"anomalies":["..."],"regionFeatures":["..."],"uncertainty":"...","recommendations":["..."]}',
  "所有结论必须能由摘要中的数字或类别支持，复核建议应保持审慎且可执行。",
].join("\n");

const boundedText = (value: unknown, label: string, maximum = 2_000) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`AI 返回结果缺少“${label}”。`);
  return value.trim().slice(0, maximum);
};

const boundedList = (value: unknown, label: string) => {
  const items = typeof value === "string" && value.trim() ? [value] : value;
  if (!Array.isArray(items) || !items.length) throw new Error(`AI 返回结果缺少“${label}”列表。`);
  return items.slice(0, 8).map((item, index) => boundedText(item, `${label}[${index}]`, 800));
};

const firstField = (record: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  return undefined;
};

const normalizedInterpretationDraft = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI 返回内容必须是一个 JSON 对象。");
  const root = value as Record<string, unknown>;
  const wrapped = firstField(root, ["interpretation", "analysis", "result", "data"]);
  const record = wrapped && typeof wrapped === "object" && !Array.isArray(wrapped) ? wrapped as Record<string, unknown> : root;
  return {
    overview: firstField(record, ["overview", "summary", "overall", "总体概况", "概述"]),
    mainPatterns: firstField(record, ["mainPatterns", "main_patterns", "patterns", "deformationPatterns", "deformation_patterns", "主要形变模式", "主要模式"]),
    anomalies: firstField(record, ["anomalies", "anomaly", "anomalyFindings", "anomaly_findings", "notableAnomalies", "异常", "值得关注的异常"]),
    regionFeatures: firstField(record, ["regionFeatures", "region_features", "features", "spatialFeatures", "spatial_features", "区域特征", "当前区域特征"]),
    uncertainty: firstField(record, ["uncertainty", "limitations", "caveats", "uncertaintyAndLimitations", "uncertainty_and_limitations", "不确定性", "不确定性与使用建议"]),
    recommendations: firstField(record, ["recommendations", "suggestions", "nextSteps", "next_steps", "建议", "复核建议"]),
  };
};

const interpretationContent = (value: unknown): InterpretationContent => {
  const draft = normalizedInterpretationDraft(value);
  return {
    overview: boundedText(draft.overview, "overview"),
    mainPatterns: boundedList(draft.mainPatterns, "mainPatterns"),
    anomalies: boundedList(draft.anomalies, "anomalies"),
    regionFeatures: boundedList(draft.regionFeatures, "regionFeatures"),
    uncertainty: boundedText(draft.uncertainty, "uncertainty"),
    recommendations: boundedList(draft.recommendations, "recommendations"),
  };
};

const parseJsonObject = (input: string) => {
  const trimmed = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!trimmed) throw new Error("AI 没有返回可用内容。");
  try { return JSON.parse(trimmed) as unknown; }
  catch { throw new Error("无法解析 AI 返回内容；模型必须只输出 JSON。"); }
};

export function buildAiInterpretationUserPrompt(summaryInput: AnalysisSummary) {
  const summary = sanitizeAnalysisSummary(summaryInput);
  return ["请解释下面的 AnalysisSummary，并严格按照约定字段返回 JSON：", JSON.stringify(summary)].join("\n\n");
}

export function buildDeepSeekWebPrompt(summaryInput: AnalysisSummary) {
  return [AI_INTERPRETATION_SYSTEM_PROMPT, buildAiInterpretationUserPrompt(summaryInput)].join("\n\n");
}

export function createRegionalInterpretation(value: unknown, metadata: InterpretationMetadata): RegionalInterpretation {
  const createdAt = metadata.createdAt && Number.isFinite(Date.parse(metadata.createdAt)) ? metadata.createdAt : new Date().toISOString();
  return {
    ...interpretationContent(value),
    engine: metadata.engine,
    engineLabel: boundedText(metadata.engineLabel, "engineLabel", 120),
    provider: metadata.provider,
    model: boundedText(metadata.model, "model", 120),
    createdAt,
    cached: metadata.cached,
  };
}

export function parseApiInterpretation(input: string, provider: Exclude<AiInterpretationProvider, "manual">, model: string, cached = false) {
  return createRegionalInterpretation(parseJsonObject(input), {
    engine: provider === "bailian" ? "bailian-api" : "deepseek-api",
    engineLabel: provider === "bailian" ? `阿里云百炼 · ${model}` : `DeepSeek 官方 API · ${model}`,
    provider,
    model,
    cached,
  });
}

export function parseDeepSeekWebInterpretation(input: string): RegionalInterpretation {
  return createRegionalInterpretation(parseJsonObject(input), {
    engine: "deepseek-web-manual",
    engineLabel: "DeepSeek 免费网页版 · 手动粘贴",
    provider: "manual",
    model: "deepseek-web",
    cached: false,
  });
}

export function sanitizeRegionalInterpretation(value: unknown): RegionalInterpretation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI 解读响应无效。");
  const result = value as Partial<RegionalInterpretation>;
  if (result.engine !== "bailian-api" && result.engine !== "deepseek-api" && result.engine !== "deepseek-web-manual") throw new Error("AI 解读引擎无效。");
  if (result.provider !== "bailian" && result.provider !== "deepseek" && result.provider !== "manual") throw new Error("AI 服务商无效。");
  return createRegionalInterpretation(result, {
    engine: result.engine,
    engineLabel: boundedText(result.engineLabel, "engineLabel", 120),
    provider: result.provider,
    model: boundedText(result.model, "model", 120),
    cached: result.cached === true,
    createdAt: boundedText(result.createdAt, "createdAt", 80),
  });
}
