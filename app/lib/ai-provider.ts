import {
  AI_INTERPRETATION_SYSTEM_PROMPT,
  buildAiInterpretationUserPrompt,
  parseApiInterpretation,
  type AiInterpretationProvider,
  type RegionalInterpretation,
} from "./ai-analysis.js";
import { sanitizeAnalysisSummary, type AnalysisSummary } from "./ai-summary.js";

export const AI_INTERPRET_REQUEST_MAX_BYTES = 20_000;
export const AI_INTERPRET_TIMEOUT_MS = 35_000;

type RuntimeEnvironment = Record<string, string | undefined>;
type ApiProvider = Exclude<AiInterpretationProvider, "manual">;

export type PersonalAiProviderInput = {
  provider: ApiProvider;
  apiKey: string;
};

export const AI_PERSONAL_API_KEY_MAX_CHARS = 512;

export type AiProviderConfig = {
  provider: ApiProvider;
  providerLabel: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

const providerDefaults: Record<ApiProvider, Omit<AiProviderConfig, "apiKey">> = {
  bailian: {
    provider: "bailian",
    providerLabel: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.8-flash",
  },
  deepseek: {
    provider: "deepseek",
    providerLabel: "DeepSeek 官方 API",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
};

export class AiProviderError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
    public retryable = false,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

const cleanBaseUrl = (value: string) => {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AiProviderError("AI_CONFIGURATION_INVALID", "AI 服务地址格式无效。", 503); }
  if (url.protocol !== "https:") throw new AiProviderError("AI_CONFIGURATION_INVALID", "AI 服务必须使用 HTTPS。", 503);
  return url.toString().replace(/\/$/, "");
};

export function resolveAiProviderConfig(environment: RuntimeEnvironment): AiProviderConfig {
  const configured = environment.AI_PROVIDER?.trim().toLowerCase() || "bailian";
  if (configured !== "bailian" && configured !== "deepseek") {
    throw new AiProviderError("AI_PROVIDER_UNSUPPORTED", "AI_PROVIDER 仅支持 bailian 或 deepseek。", 503);
  }
  if (configured === "bailian") {
    return {
      ...providerDefaults.bailian,
      baseUrl: cleanBaseUrl(environment.BAILIAN_BASE_URL?.trim() || providerDefaults.bailian.baseUrl),
      apiKey: environment.BAILIAN_API_KEY?.trim() || "",
      model: environment.BAILIAN_MODEL?.trim() || providerDefaults.bailian.model,
    };
  }
  return {
    ...providerDefaults.deepseek,
    baseUrl: cleanBaseUrl(environment.DEEPSEEK_BASE_URL?.trim() || providerDefaults.deepseek.baseUrl),
    apiKey: environment.DEEPSEEK_API_KEY?.trim() || "",
    model: environment.DEEPSEEK_MODEL?.trim() || providerDefaults.deepseek.model,
  };
}

export function resolvePersonalAiProviderConfig(input: unknown): AiProviderConfig | null {
  if (input == null) return null;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new AiProviderError("AI_PERSONAL_CREDENTIAL_INVALID", "个人 API 配置格式无效。", 422);
  const provider = (input as { provider?: unknown }).provider;
  const rawApiKey = (input as { apiKey?: unknown }).apiKey;
  if (provider !== "bailian" && provider !== "deepseek") throw new AiProviderError("AI_PERSONAL_PROVIDER_UNSUPPORTED", "个人 API 仅支持阿里云百炼或 DeepSeek。", 422);
  if (typeof rawApiKey !== "string") throw new AiProviderError("AI_PERSONAL_KEY_INVALID", "请输入有效的个人 API Key。", 422);
  const apiKey = rawApiKey.trim();
  const hasControlCharacter = Array.from(apiKey).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (apiKey.length < 8 || apiKey.length > AI_PERSONAL_API_KEY_MAX_CHARS || hasControlCharacter) {
    throw new AiProviderError("AI_PERSONAL_KEY_INVALID", "个人 API Key 格式无效。", 422);
  }
  return { ...providerDefaults[provider], apiKey };
}

export function buildAiProviderRequest(summaryInput: AnalysisSummary, config: AiProviderConfig) {
  const summary = sanitizeAnalysisSummary(summaryInput);
  return {
    model: config.model,
    messages: [
      { role: "system", content: AI_INTERPRETATION_SYSTEM_PROMPT },
      { role: "user", content: buildAiInterpretationUserPrompt(summary) },
    ],
    temperature: 0.2,
    max_tokens: 1_200,
    response_format: { type: "json_object" },
    stream: false,
    ...(config.provider === "bailian" ? { enable_thinking: false } : {}),
  };
}

const responseContent = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AiProviderError("AI_RESPONSE_INVALID", "AI 服务返回格式无效。", 502, true);
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices.length) throw new AiProviderError("AI_RESPONSE_EMPTY", "AI 服务没有返回解读内容。", 502, true);
  const message = choices[0] && typeof choices[0] === "object" ? (choices[0] as { message?: unknown }).message : null;
  const content = message && typeof message === "object" ? (message as { content?: unknown }).content : null;
  if (typeof content !== "string" || !content.trim()) throw new AiProviderError("AI_RESPONSE_EMPTY", "AI 服务没有返回解读内容。", 502, true);
  return content;
};

export async function runAiInterpretationProvider(
  summaryInput: AnalysisSummary,
  config: AiProviderConfig,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<RegionalInterpretation> {
  if (!config.apiKey) throw new AiProviderError("AI_NOT_CONFIGURED", `${config.providerLabel}尚未配置 API Key。`, 503);
  const request = buildAiProviderRequest(summaryInput, config);
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new AiProviderError("AI_PROVIDER_TIMEOUT", "AI 解读超时，请稍后重试。", 504, true);
    throw new AiProviderError("AI_PROVIDER_UNAVAILABLE", `${config.providerLabel}暂时无法连接，请稍后重试。`, 502, true);
  }
  if (!response.ok) {
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const message = response.status === 401 || response.status === 403
      ? `${config.providerLabel}鉴权失败，请检查服务端 API Key 和免费额度状态。`
      : response.status === 429
        ? `${config.providerLabel}当前请求较多或免费额度已受限，请稍后重试。`
        : `${config.providerLabel}调用失败（HTTP ${response.status}）。`;
    throw new AiProviderError("AI_PROVIDER_REJECTED", message, response.status >= 500 ? 502 : response.status, retryable);
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new AiProviderError("AI_RESPONSE_INVALID", "AI 服务返回了无法解析的响应。", 502, true); }
  try { return parseApiInterpretation(responseContent(body), config.provider, config.model); }
  catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError("AI_RESPONSE_INVALID", error instanceof Error ? error.message : "AI 解读结果结构无效。", 502, true);
  }
}
