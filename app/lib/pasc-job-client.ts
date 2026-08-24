import type { InsarPoint } from "../data/site";
import { PASC_CLASSES } from "./pasc";
import { PASC_CONTRACT_VERSION, PASC_MODEL_VERSION, type PascClassId, type PascClassName, type PascPointResult, type PascSpatialApplicability, type PascTemporalApplicability, type PascValueSource } from "../types/pasc";

export type PascJobStatus = "queued" | "running" | "retry_wait" | "cancelling" | "cancelled" | "completed" | "failed";
export type PascPublicJob = {
  jobId: string; datasetId: string; datasetName: string; contractVersion: string; modelVersion: string; webgisVersion: string; serviceVersion: string | null;
  status: PascJobStatus; stage: string; progress: number;
  points: { total: number; processed: number; predicted: number; unsupported: number };
  chunks: { current: number; total: number; size: number }; attempts: { current: number; maximum: number };
  retryAt: string | null; cancelRequested: boolean; summary: Record<string, unknown>; error: { code: string; message: string } | null;
  createdAt: string; updatedAt: string; startedAt: string | null; completedAt: string | null;
};
export type PascJobEvent = { type: string; status: string; progress: number; message: string; data: Record<string, unknown>; createdAt: string };
export type PascJobArtifact = { id: string; kind: string; chunkIndex: number; contentType: string; sizeBytes: number; sha256: string; recordCount: number; downloadUrl: string; createdAt: string };
type PascMapPreview = { contractVersion: string; modelVersion: string; jobId: string; strategy: string; returnedPoints: number; totalPredictedPoints: number; points: unknown[] };

const classByName = new Map(PASC_CLASSES.map(item => [item.name, item]));
function finite(value: unknown, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function valueSource(value: unknown): PascValueSource { return value === "provided" || value === "calculated" || value === "default" || value === "not_available" ? value : "not_available"; }
function probabilityRecord(value: unknown) {
  if (!Array.isArray(value) || value.length !== PASC_CLASSES.length) throw new Error("PASC 地图概率格式无效。");
  const numbers = value.map(item => finite(item, -1));
  if (numbers.some(item => item < 0 || item > 1) || Math.abs(numbers.reduce((sum, item) => sum + item, 0) - 1) > 1e-4) throw new Error("PASC 地图概率未通过校验。");
  return Object.fromEntries(PASC_CLASSES.map((item, index) => [item.name, numbers[index]])) as PascPointResult["probabilities"];
}
export function pascMapLevelForZoom(zoom: number) { return zoom >= 13 ? "map_level_2" : zoom >= 10 ? "map_level_1" : "map_level_0"; }

export function parsePascMapPreview(value: unknown): { jobId: string; totalPredictedPoints: number; points: InsarPoint[] } {
  if (!value || typeof value !== "object") throw new Error("PASC 地图响应无效。");
  const payload = value as PascMapPreview;
  if (payload.contractVersion !== PASC_CONTRACT_VERSION || payload.modelVersion !== PASC_MODEL_VERSION || payload.strategy !== "deterministic_multilevel_decimation" || !Array.isArray(payload.points)) throw new Error("PASC 地图响应版本或抽样策略无效。");
  if (!Number.isInteger(payload.returnedPoints) || payload.returnedPoints !== payload.points.length || payload.points.length > 5000 || finite(payload.totalPredictedPoints, -1) < payload.points.length) throw new Error("PASC 地图响应点数无效。");
  const seen = new Set<string>();
  const points = payload.points.map((unknownPoint, index): InsarPoint => {
    if (!unknownPoint || typeof unknownPoint !== "object") throw new Error(`PASC 地图第 ${index + 1} 个点无效。`);
    const item = unknownPoint as Record<string, unknown>;
    const pointId = typeof item.pointId === "string" ? item.pointId.trim() : "";
    const longitude = finite(item.longitude, Number.NaN), latitude = finite(item.latitude, Number.NaN);
    if (!pointId || seen.has(pointId) || !Number.isFinite(longitude) || !Number.isFinite(latitude) || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new Error(`PASC 地图第 ${index + 1} 个点标识或坐标无效。`);
    seen.add(pointId);
    const finalLabel = item.finalLabel && typeof item.finalLabel === "object" ? item.finalLabel as Record<string, unknown> : {};
    const className = finalLabel.className as PascClassName, classDefinition = classByName.get(className);
    if (!classDefinition || finalLabel.classId !== classDefinition.id || finalLabel.classNameZh !== classDefinition.nameZh || finalLabel.color !== classDefinition.color) throw new Error(`PASC 地图点 ${pointId} 的固定类别无效。`);
    const probabilities = probabilityRecord(item.probabilities);
    const winner = PASC_CLASSES.reduce((best, candidate) => probabilities[candidate.name] > probabilities[best.name] ? candidate : best, PASC_CLASSES[0]);
    if (winner.name !== className) throw new Error(`PASC 地图点 ${pointId} 的标签与概率不一致。`);
    const quality = item.quality && typeof item.quality === "object" ? item.quality as Record<string, unknown> : {};
    const applicability = item.applicability && typeof item.applicability === "object" ? item.applicability as Record<string, unknown> : {};
    const sources = item.sources && typeof item.sources === "object" ? item.sources as Record<string, unknown> : {};
    const warnings = Array.isArray(item.warnings) ? item.warnings.map(warning => typeof warning === "string" ? warning : String((warning as { message?: unknown })?.message ?? "")).filter(Boolean) : [];
    const pasc: PascPointResult = {
      contractVersion: PASC_CONTRACT_VERSION, modelVersion: PASC_MODEL_VERSION, pointId, rawLabelId: null, rawLabel: null,
      calibratedLabelId: classDefinition.id as PascClassId, calibratedLabel: className, probabilities,
      confidence: finite(item.confidence), calibrationChanged: typeof item.calibrationChanged === "boolean" ? item.calibrationChanged : null,
      lowConfidence: item.lowConfidence === true, spatialReliability: finite(item.spatialReliability), spatialGateMean: finite(item.spatialGateMean),
      temporalApplicability: String(applicability.temporal ?? "unsupported") as PascTemporalApplicability,
      spatialApplicability: String(applicability.spatial ?? "not_evaluated") as PascSpatialApplicability,
      quality: {
        originalEpochCount: Math.max(0, Math.floor(finite(quality.effectiveEpochs))), adaptedEpochCount: quality.adapterApplied === true ? 248 : null,
        startDate: typeof quality.originalStart === "string" ? quality.originalStart : null, endDate: typeof quality.originalEnd === "string" ? quality.originalEnd : null,
        spanDays: Number.isFinite(Number(quality.originalSpanDays)) ? Number(quality.originalSpanDays) : null, missingRate: finite(quality.missingRate), minimumGapDays: null,
        maximumGapDays: Number.isFinite(Number(quality.maximumGapDays)) ? Number(quality.maximumGapDays) : null, medianGapDays: null,
        seriesMean: Number.isFinite(Number(quality.seriesMean)) ? Number(quality.seriesMean) : null, seriesStd: Number.isFinite(Number(quality.seriesStd)) ? Number(quality.seriesStd) : null,
        noiseResidualStd: Number.isFinite(Number(quality.noiseResidualStd)) ? Number(quality.noiseResidualStd) : null, zscoreEpsilon: 0.00001,
      },
      velocitySource: valueSource(sources.velocity), coherenceSource: valueSource(sources.coherence), warnings,
    };
    return {
      id: pointId, name: `PASC 任务样本 ${pointId}`, lon: longitude, lat: latitude, velocity: 0, velocitySource: pasc.velocitySource,
      displacement: 0, coherence: 0, coherenceSource: pasc.coherenceSource, missingRate: pasc.quality.missingRate,
      mode: classDefinition.nameZh, modeCanonical: className, modeSource: "PASC-TCN Phase F 多级确定性抽样", modeConfidence: pasc.confidence,
      updated: pasc.quality.endDate ?? "任务结果", series: [0], dates: [pasc.quality.endDate ?? "任务结果"], effectiveEpochCount: pasc.quality.originalEpochCount,
      temporalApplicability: pasc.temporalApplicability, spatialApplicability: pasc.spatialApplicability, pasc,
      warnings: ["当前地图仅加载多级抽样预览，不含完整大数据集或完整时序。", ...warnings],
    };
  });
  return { jobId: payload.jobId, totalPredictedPoints: Math.floor(finite(payload.totalPredictedPoints)), points };
}
