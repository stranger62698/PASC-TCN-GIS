import type { InsarPoint } from "../data/site";
import type { PascPreprocessingState, PascValueSource } from "../types/pasc.js";
import { PASC_CLASSES, PASC_EXPERIMENTAL_MIN_STEPS, PASC_ZSCORE_EPSILON } from "./pasc.js";
import {
  PASC_CONTRACT_VERSION,
  PASC_MODEL_VERSION,
  type PascClassId,
  type PascClassName,
  type PascPointResult,
  type PascSpatialApplicability,
  type PascTemporalApplicability,
} from "../types/pasc.js";

export const PHASE_E_MAX_POINTS = 500;
export const PASC_AUTO_CLASSIFY_MAX_POINTS = 10_000;
export const PHASE_E_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const PHASE_E_DEFAULT_TIMEOUT_MS = 30_000;

export type PascOnlinePointInput = {
  pointId: string;
  longitude: number;
  latitude: number;
  dates: string[];
  displacementMm: number[];
  velocityMmPerYear?: number;
  coherence?: number;
};

export type PascOnlineRequest = {
  contractVersion: typeof PASC_CONTRACT_VERSION;
  datasetName: string;
  preprocessingState: Exclude<PascPreprocessingState, "unknown">;
  points: PascOnlinePointInput[];
};

export type PascServiceWarning = { code: string; message: string };

type PascServiceClassResult = {
  classId: PascClassId;
  className: PascClassName;
  classNameZh: string;
  probabilities: number[];
};

export type PascOnlineInferencePoint = {
  pointId: string;
  status: "predicted";
  rawResult: PascServiceClassResult;
  calibratedResult: PascServiceClassResult;
  finalLabel: {
    classId: PascClassId;
    className: PascClassName;
    classNameZh: string;
    color: string;
  };
  probabilities: number[];
  confidence: number;
  calibrationChanged: boolean;
  lowConfidence: boolean;
  spatialReliability: number;
  spatialGateMean: number;
  applicability: {
    temporal: "native_248" | "experimental_adapted_to_248";
    spatial: "full_reference" | "limited_reference";
  };
  quality: {
    effectiveEpochs: number;
    missingEpochs: number;
    originalStart: string;
    originalEnd: string;
    originalSpanDays: number;
    missingRate: number;
    maximumGapDays: number;
    medianGapDays?: number;
    cadenceStatus?: "sentinel_12_day_like" | "non_12_day_cadence";
    adapterApplied: boolean;
    noiseResidualStd: number | null;
    seriesMean: number;
    seriesStd: number;
    zscoreEpsilon: number;
    warnings?: PascServiceWarning[];
  };
  sources: { velocity: PascValueSource; coherence: PascValueSource };
  warnings: PascServiceWarning[];
};

export type PascOnlineResponse = {
  contractVersion: typeof PASC_CONTRACT_VERSION;
  modelVersion: typeof PASC_MODEL_VERSION;
  serviceVersion: string;
  operation: "inference_only";
  inferenceOnly: true;
  summary: {
    points: number;
    predicted: number;
    lowConfidence: number;
    limitedReference: number;
  };
  modelPackage: {
    buildHash: string;
    manifestSha256: string;
    assetSha256: Record<string, string>;
  };
  points: PascOnlineInferencePoint[];
  audit: {
    assetHashesVerified: boolean;
    referenceRows: number;
    device: string;
    modelExecuted: boolean;
    userDataFit: boolean;
    trainingPathAvailable: boolean;
  };
};

export type PascOnlineRunState = {
  status: "idle" | "running" | "success" | "error";
  error: string;
  completedAt: string | null;
  summary: PascOnlineResponse["summary"] | null;
  serviceVersion: string | null;
  buildHash: string | null;
  processedPoints: number;
  totalPoints: number;
  completedBatches: number;
  totalBatches: number;
};

export type PascOnlineFilter = "lowConfidence" | "limitedReference";

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function requireCondition(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PascProxyError(code, message, 422);
}

export function buildPascOnlineRequest(
  points: InsarPoint[],
  datasetName: string,
  preprocessingState: PascPreprocessingState | undefined,
): PascOnlineRequest {
  if (points.length > PHASE_E_MAX_POINTS) {
    throw new Error(`Phase E 小数据在线识别最多 ${PHASE_E_MAX_POINTS} 点；当前 ${points.length.toLocaleString()} 点需要 Phase F 任务化。`);
  }
  if (preprocessingState !== "raw" && preprocessingState !== "already_smoothed") {
    throw new Error("必须确认 raw / already_smoothed 预处理状态后才能在线识别。");
  }
  const candidates = points.filter(point => (point.effectiveEpochCount ?? point.series.length) >= PASC_EXPERIMENTAL_MIN_STEPS);
  if (!candidates.length) throw new Error("当前数据没有达到 20 个逐点有效期的 PASC 候选点；普通 WebGIS 仍可使用。");
  return {
    contractVersion: PASC_CONTRACT_VERSION,
    datasetName,
    preprocessingState,
    points: candidates.map(point => ({
      pointId: point.id,
      longitude: point.lon,
      latitude: point.lat,
      dates: [...(point.dates ?? [])],
      displacementMm: point.series.map(value => value === 0 ? 0 : value),
      ...(point.velocitySource !== "not_available" && Number.isFinite(point.velocity)
        ? { velocityMmPerYear: point.velocity === 0 ? 0 : point.velocity }
        : {}),
      ...(point.coherenceSource === "provided" && Number.isFinite(point.coherence)
        ? { coherence: point.coherence }
        : {}),
    })),
  };
}

export function buildPascOnlineRequestBatches(
  points: InsarPoint[],
  datasetName: string,
  preprocessingState: PascPreprocessingState | undefined,
): PascOnlineRequest[] {
  const candidates = points.filter(point => (point.effectiveEpochCount ?? point.series.length) >= PASC_EXPERIMENTAL_MIN_STEPS);
  if (candidates.length > PASC_AUTO_CLASSIFY_MAX_POINTS) {
    throw new Error(`自动识别最多处理 ${PASC_AUTO_CLASSIFY_MAX_POINTS.toLocaleString()} 个候选点；当前 ${candidates.length.toLocaleString()} 点需要 Phase F 任务化。`);
  }
  if (!candidates.length) return [buildPascOnlineRequest(points, datasetName, preprocessingState)];
  const requests: PascOnlineRequest[] = [];
  for (let index = 0; index < candidates.length; index += PHASE_E_MAX_POINTS) {
    requests.push(buildPascOnlineRequest(candidates.slice(index, index + PHASE_E_MAX_POINTS), datasetName, preprocessingState));
  }
  return requests;
}

function dateField(value: string) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) throw new PascProxyError("PASC_DATE_PARSE_FAILED", `日期 ${value} 不是 YYYY-MM-DD。`, 422);
  return `D${matched[1]}${matched[2]}${matched[3]}`;
}

export function toPascServicePayload(value: unknown) {
  requireCondition(value && typeof value === "object", "PASC_BAD_REQUEST", "在线识别请求无效。");
  const request = value as Partial<PascOnlineRequest>;
  requireCondition(request.contractVersion === PASC_CONTRACT_VERSION, "PASC_CONTRACT_VERSION_UNSUPPORTED", "请求契约版本不受支持。");
  requireCondition(typeof request.datasetName === "string" && request.datasetName.trim(), "PASC_BAD_REQUEST", "数据集名称无效。");
  requireCondition(request.preprocessingState === "raw" || request.preprocessingState === "already_smoothed", "PASC_PREPROCESSING_STATE_REQUIRED", "必须确认数据预处理状态。");
  requireCondition(Array.isArray(request.points) && request.points.length > 0, "PASC_TOO_FEW_VALID_EPOCHS", "没有可推理的 PASC 候选点。");
  requireCondition(request.points.length <= PHASE_E_MAX_POINTS, "PASC_PHASE_E_POINT_LIMIT_EXCEEDED", `Phase E 同步识别最多 ${PHASE_E_MAX_POINTS} 点。`);

  const ids = new Set<string>();
  const allFields = new Set<string>();
  const rows = request.points.map((point, index) => {
    requireCondition(point && typeof point === "object", "PASC_BAD_REQUEST", `第 ${index + 1} 个点无效。`);
    requireCondition(typeof point.pointId === "string" && point.pointId.trim(), "PASC_BAD_REQUEST", `第 ${index + 1} 个点缺少 pointId。`);
    requireCondition(!ids.has(point.pointId), "PASC_BAD_REQUEST", `pointId ${point.pointId} 重复。`);
    ids.add(point.pointId);
    requireCondition(isFiniteNumber(point.longitude) && point.longitude >= -180 && point.longitude <= 180, "PASC_SCHEMA_UNRESOLVED", `${point.pointId} 经度无效。`);
    requireCondition(isFiniteNumber(point.latitude) && point.latitude >= -90 && point.latitude <= 90, "PASC_SCHEMA_UNRESOLVED", `${point.pointId} 纬度无效。`);
    requireCondition(Array.isArray(point.dates) && Array.isArray(point.displacementMm) && point.dates.length === point.displacementMm.length, "PASC_BAD_REQUEST", `${point.pointId} 日期和值长度不一致。`);
    requireCondition(point.dates.length >= PASC_EXPERIMENTAL_MIN_STEPS, "PASC_TOO_FEW_VALID_EPOCHS", `${point.pointId} 有效期少于 20。`);
    const row: Record<string, string | number> = {
      point_id: point.pointId,
      longitude: point.longitude,
      latitude: point.latitude,
    };
    point.dates.forEach((date, dateIndex) => {
      const field = dateField(date);
      const displacement = point.displacementMm[dateIndex];
      requireCondition(isFiniteNumber(displacement), "PASC_BAD_REQUEST", `${point.pointId} 包含非有限形变值。`);
      requireCondition(!(field in row), "PASC_DUPLICATE_DATE_CONFLICT", `${point.pointId} 包含重复日期 ${date}。`);
      row[field] = displacement;
      allFields.add(field);
    });
    if (point.velocityMmPerYear !== undefined) {
      requireCondition(isFiniteNumber(point.velocityMmPerYear), "PASC_BAD_REQUEST", `${point.pointId} 速率无效。`);
      row.velocity = point.velocityMmPerYear;
    }
    if (point.coherence !== undefined) {
      requireCondition(isFiniteNumber(point.coherence) && point.coherence >= 0 && point.coherence <= 1, "PASC_BAD_REQUEST", `${point.pointId} 相干性无效。`);
      row.coherence = point.coherence;
    }
    return row;
  });
  const dateColumns = [...allFields].sort();
  return {
    contractVersion: PASC_CONTRACT_VERSION,
    datasetName: request.datasetName.trim().slice(0, 200),
    mapping: {
      pointId: "point_id",
      longitude: "longitude",
      latitude: "latitude",
      velocity: "velocity",
      coherence: "coherence",
      dateColumns,
    },
    settings: {
      displacementUnit: "mm",
      velocityUnit: "mm/year",
      signConvention: "model_native",
      preprocessingState: request.preprocessingState,
    },
    records: rows,
  };
}

function probabilityRecord(values: number[]) {
  requireCondition(values.length === PASC_CLASSES.length && values.every(value => isFiniteNumber(value) && value >= 0 && value <= 1), "PASC_PHASE_E_RESPONSE_INVALID", "推理概率无效。");
  const sum = values.reduce((total, value) => total + value, 0);
  requireCondition(Math.abs(sum - 1) <= 1e-4, "PASC_PHASE_E_RESPONSE_INVALID", "推理概率和不为 1。");
  return Object.fromEntries(PASC_CLASSES.map((item, index) => [item.name, values[index]])) as Record<PascClassName, number>;
}

function sourceValue(value: unknown): PascValueSource {
  return value === "provided" || value === "calculated" || value === "default" || value === "not_available" ? value : "not_available";
}

export function mergePascOnlineResults(points: InsarPoint[], value: unknown): { points: InsarPoint[]; response: PascOnlineResponse } {
  requireCondition(value && typeof value === "object", "PASC_PHASE_E_RESPONSE_INVALID", "推理响应无效。");
  const response = value as PascOnlineResponse;
  requireCondition(response.contractVersion === PASC_CONTRACT_VERSION && response.modelVersion === PASC_MODEL_VERSION && response.operation === "inference_only" && Array.isArray(response.points), "PASC_PHASE_E_RESPONSE_INVALID", "推理响应版本或操作无效。");
  requireCondition(response.audit?.assetHashesVerified && response.audit?.modelExecuted && !response.audit?.userDataFit && !response.audit?.trainingPathAvailable, "PASC_PHASE_E_RESPONSE_INVALID", "推理审计信息无效。");
  const candidateIds = new Set(points.filter(point => (point.effectiveEpochCount ?? point.series.length) >= PASC_EXPERIMENTAL_MIN_STEPS).map(point => point.id));
  requireCondition(response.points.length === candidateIds.size, "PASC_PHASE_E_RESPONSE_INVALID", "推理响应点数与候选点数不一致。");
  const results = new Map<string, PascOnlineInferencePoint>();
  response.points.forEach(result => {
    requireCondition(candidateIds.has(result.pointId) && !results.has(result.pointId), "PASC_PHASE_E_RESPONSE_INVALID", `推理响应包含未知或重复点 ${result.pointId}。`);
    const probabilities = probabilityRecord(result.probabilities);
    const winner = PASC_CLASSES.reduce((best, item) => probabilities[item.name] > probabilities[best.name] ? item : best, PASC_CLASSES[0]);
    requireCondition(winner.id === result.finalLabel.classId && winner.name === result.finalLabel.className, "PASC_PHASE_E_RESPONSE_INVALID", `${result.pointId} 最终标签与校准概率不一致。`);
    results.set(result.pointId, result);
  });
  const merged = points.map(point => {
    const result = results.get(point.id);
    if (!result) return point;
    const probabilities = probabilityRecord(result.probabilities);
    const raw = result.rawResult;
    const quality = result.quality;
    const warnings = (result.warnings ?? []).map(item => item.message).filter(Boolean);
    const pasc: PascPointResult = {
      contractVersion: PASC_CONTRACT_VERSION,
      modelVersion: PASC_MODEL_VERSION,
      pointId: point.id,
      rawLabelId: raw.classId,
      rawLabel: raw.className,
      calibratedLabelId: result.finalLabel.classId,
      calibratedLabel: result.finalLabel.className,
      probabilities,
      confidence: result.confidence,
      calibrationChanged: result.calibrationChanged,
      lowConfidence: result.lowConfidence,
      spatialReliability: result.spatialReliability,
      spatialGateMean: result.spatialGateMean,
      temporalApplicability: result.applicability.temporal as PascTemporalApplicability,
      spatialApplicability: result.applicability.spatial as PascSpatialApplicability,
      quality: {
        originalEpochCount: quality.effectiveEpochs,
        adaptedEpochCount: quality.adapterApplied ? 248 : null,
        startDate: quality.originalStart,
        endDate: quality.originalEnd,
        spanDays: quality.originalSpanDays,
        missingRate: quality.missingRate,
        minimumGapDays: null,
        maximumGapDays: quality.maximumGapDays,
        medianGapDays: Number.isFinite(Number(quality.medianGapDays)) ? Number(quality.medianGapDays) : null,
        seriesMean: quality.seriesMean,
        seriesStd: quality.seriesStd,
        noiseResidualStd: quality.noiseResidualStd,
        zscoreEpsilon: PASC_ZSCORE_EPSILON,
      },
      velocitySource: sourceValue(result.sources?.velocity),
      coherenceSource: sourceValue(result.sources?.coherence),
      warnings,
    };
    return {
      ...point,
      mode: result.finalLabel.classNameZh,
      modeCanonical: result.finalLabel.className,
      modeSource: `PASC-TCN 在线识别 · service ${response.serviceVersion}`,
      modeConfidence: result.confidence,
      temporalApplicability: pasc.temporalApplicability,
      spatialApplicability: pasc.spatialApplicability,
      pasc,
      warnings: [...(point.warnings ?? []).filter(item => item.includes("Stepwise")), ...warnings],
    };
  });
  return { points: merged, response };
}

export function filterPascOnlinePoints(points: InsarPoint[], filter: PascOnlineFilter) {
  return points.filter(point => filter === "lowConfidence"
    ? point.pasc?.lowConfidence === true
    : point.pasc?.spatialApplicability === "limited_reference");
}

export class PascProxyError extends Error {
  constructor(public code: string, message: string, public status: number, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

function upstreamError(status: number, value: unknown) {
  const error = value && typeof value === "object" && "error" in value
    ? (value as { error?: { code?: unknown; message?: unknown; details?: unknown } }).error
    : undefined;
  return new PascProxyError(
    typeof error?.code === "string" ? error.code : "PASC_PHASE_E_UPSTREAM_FAILED",
    typeof error?.message === "string" ? error.message : "PASC-TCN 服务暂时不可用。",
    status >= 400 && status <= 599 ? status : 502,
    error?.details && typeof error.details === "object" ? error.details as Record<string, unknown> : {},
  );
}

async function responseJson(response: Response) {
  try { return await response.json() as unknown; }
  catch { throw new PascProxyError("PASC_PHASE_E_UPSTREAM_INVALID", "PASC-TCN 服务返回了无效 JSON。", 502); }
}

export async function runPascOnlineProxy(
  input: unknown,
  options: { serviceBaseUrl: string; serviceApiKey: string; fetchImpl?: typeof fetch; timeoutMs?: number },
) {
  const payload = toPascServicePayload(input);
  let base: URL;
  try { base = new URL(options.serviceBaseUrl); }
  catch { throw new PascProxyError("PASC_PHASE_E_SERVICE_NOT_CONFIGURED", "在线识别服务地址未配置。", 503); }
  if ((base.protocol !== "http:" && base.protocol !== "https:") || base.username || base.password) {
    throw new PascProxyError("PASC_PHASE_E_SERVICE_NOT_CONFIGURED", "在线识别服务地址配置无效。", 503);
  }
  if (options.serviceApiKey.length < 32) {
    throw new PascProxyError("PASC_PHASE_E_SERVICE_NOT_CONFIGURED", "在线识别服务密钥未配置。", 503);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? PHASE_E_DEFAULT_TIMEOUT_MS);
  const endpoint = (path: string) => new URL(path, base.href.endsWith("/") ? base.href : `${base.href}/`).toString();
  try {
    const preprocessedResponse = await fetchImpl(endpoint("v1/preprocess"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const preprocessedText = await preprocessedResponse.text();
    let preprocessed: unknown;
    try { preprocessed = JSON.parse(preprocessedText) as unknown; }
    catch { throw new PascProxyError("PASC_PHASE_E_UPSTREAM_INVALID", "PASC-TCN 服务返回了无效 JSON。", 502); }
    if (!preprocessedResponse.ok) throw upstreamError(preprocessedResponse.status, preprocessed);
    const inferenceResponse = await fetchImpl(endpoint("v1/infer"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.serviceApiKey}`,
      },
      // Keep the service-produced JSON bytes lexically stable. Parsing and
      // re-stringifying in JavaScript can change Python float exponents and
      // invalidate the service-owned HMAC artifact.
      body: `{"contractVersion":${JSON.stringify(PASC_CONTRACT_VERSION)},"preprocessed":${preprocessedText}}`,
      signal: controller.signal,
    });
    const inferred = await responseJson(inferenceResponse);
    if (!inferenceResponse.ok) throw upstreamError(inferenceResponse.status, inferred);
    return inferred;
  } catch (error) {
    if (error instanceof PascProxyError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new PascProxyError("PASC_PHASE_E_TIMEOUT", "在线识别超时；当前地图数据与已有结果已保留。", 504);
    throw new PascProxyError("PASC_PHASE_E_UPSTREAM_FAILED", "PASC-TCN 服务暂时不可用；当前地图数据与已有结果已保留。", 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function onlineErrorMessage(value: unknown) {
  if (value && typeof value === "object" && "error" in value) {
    const error = (value as { error?: { message?: unknown } }).error;
    if (typeof error?.message === "string") return error.message;
  }
  return "在线识别失败；当前地图数据与已有结果已保留。";
}
