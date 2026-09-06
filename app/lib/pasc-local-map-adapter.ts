import type { InsarPoint } from "../data/site.js";
import {
  PASC_CONTRACT_VERSION,
  PASC_MODEL_VERSION,
  type PascPointQuality,
  type PascProbabilitySet,
  type PascSpatialReferenceSource,
  type PascValueSource,
} from "../types/pasc.js";
import { csvText } from "./analysis-exports.js";
import { decodeInsarValue, roundInsarValue } from "./insar-precision.js";
import { PASC_CLASSES, classifyEpochCount } from "./pasc.js";
import type { PascLocalCompletePayload } from "./pasc-local-worker-protocol.js";

export type PascLocalMapDataset = {
  title: string;
  points: InsarPoint[];
  periods: number;
  invalidRows: number;
  totalRows: number;
  totalPredictedPoints: number;
  mapSampled: boolean;
};

function cleanDatasetTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "") + " · 浏览器本地 PASC-TCN";
}

function seriesQuality(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length, 1);
  return { mean, standardDeviation: Math.sqrt(variance) };
}

function probabilitySet(result: PascLocalCompletePayload, pointIndex: number) {
  return Object.fromEntries(PASC_CLASSES.map((item, classIndex) => [
    item.name,
    result.probabilities[pointIndex * PASC_CLASSES.length + classIndex],
  ])) as PascProbabilitySet;
}

function referenceSource(code: number): PascSpatialReferenceSource {
  return code === 1 ? "frozen_training_reference" : code === 2 ? "uploaded_research_area" : "none";
}

export function adaptLocalPredictionToMapData(
  result: PascLocalCompletePayload,
  fileName: string,
): PascLocalMapDataset {
  const count = result.pointIds.length;
  const vectorLengths = [
    result.rawModeIndex.length,
    result.modeIndex.length,
    result.confidence.length,
    result.longitude.length,
    result.latitude.length,
    result.velocity.length,
    result.velocityProvided.length,
    result.coherence.length,
    result.coherenceProvided.length,
    result.missingRate.length,
    result.spatialReliability.length,
    result.spatialGateMean.length,
    result.spatialReferenceSource.length,
  ];
  if (vectorLengths.some(length => length !== count)) throw new Error("本地 ONNX 结果长度不一致，地图未更新。");
  if (result.probabilities.length !== count * PASC_CLASSES.length) throw new Error("本地 ONNX 六类概率长度不一致，地图未更新。");
  if (result.displacementSeries.length !== count * result.timeSteps || result.dates.length !== result.timeSteps) {
    throw new Error("本地 ONNX 时序结果与日期轴不一致，地图未更新。");
  }

  const points = Array.from({ length: count }, (_, index): InsarPoint => {
    const classDefinition = PASC_CLASSES[result.modeIndex[index]];
    const rawClassDefinition = PASC_CLASSES[result.rawModeIndex[index]];
    if (!classDefinition || !rawClassDefinition) throw new Error(`点 ${result.pointIds[index]} 的本地分类编号无效。`);
    const series = Array.from(result.displacementSeries.subarray(index * result.timeSteps, (index + 1) * result.timeSteps), value => decodeInsarValue(value, result.displacementScale));
    const effectiveEpochs = Math.max(20, Math.round(result.sourceEpochs * (1 - result.missingRate[index])));
    const temporal = classifyEpochCount(effectiveEpochs).temporalApplicability;
    const reliability = result.spatialReliability[index];
    const spatial = reliability > 0 ? "full_reference" : "limited_reference";
    const source = referenceSource(result.spatialReferenceSource[index]);
    const confidence = result.confidence[index];
    const statistics = seriesQuality(series);
    const velocitySource: PascValueSource = result.velocityProvided[index] ? "provided" : "calculated";
    const coherenceSource: PascValueSource = result.coherenceProvided[index] ? "provided" : "default";
    const warnings = [
      ...(confidence < 0.6 ? ["本地 PASC-TCN 结果置信度低于 0.60，建议结合时序和空间背景复核。"] : []),
      ...(spatial === "limited_reference" ? ["该点在500米范围内缺少可用邻点；空间门控未启用，分类主要来自时间与物理分支。"] : []),
      ...(source === "uploaded_research_area" ? [result.largeFileMode ? "大文件模式的空间分支仅使用当前处理批次内无标签邻点；完整全区邻域未进入内存，解释时应结合抽样边界复核。" : "空间分支使用当前本地 CSV 内无标签邻点；未使用邻点类别，也未拟合模型参数。"] : []),
      ...(coherenceSource === "default" ? ["CSV 未提供相干性；本地推理使用冻结默认值 0.5，地图不将其表示为实测相干性。"] : []),
    ];
    const quality: PascPointQuality = {
      originalEpochCount: effectiveEpochs,
      adaptedEpochCount: result.timeSteps,
      insertedEpochCount: result.insertedEpochs,
      remainingIrregularIntervals: 0,
      startDate: result.dates[0] ?? null,
      endDate: result.dates.at(-1) ?? null,
      spanDays: result.dates.length > 1 ? Math.round((Date.parse(result.dates.at(-1)!) - Date.parse(result.dates[0])) / 86_400_000) : null,
      missingRate: result.missingRate[index],
      minimumGapDays: null,
      maximumGapDays: null,
      medianGapDays: 12,
      seriesMean: statistics.mean,
      seriesStd: statistics.standardDeviation,
      noiseResidualStd: null,
      zscoreEpsilon: 0.00001,
    };
    const pasc = {
      contractVersion: PASC_CONTRACT_VERSION,
      modelVersion: PASC_MODEL_VERSION,
      pointId: result.pointIds[index],
      rawLabelId: rawClassDefinition.id,
      rawLabel: rawClassDefinition.name,
      calibratedLabelId: classDefinition.id,
      calibratedLabel: classDefinition.name,
      probabilities: probabilitySet(result, index),
      confidence,
      calibrationChanged: rawClassDefinition.id !== classDefinition.id,
      lowConfidence: confidence < 0.6,
      spatialReliability: reliability,
      spatialGateMean: result.spatialGateMean[index],
      spatialReferenceSource: source,
      temporalApplicability: temporal,
      spatialApplicability: spatial,
      quality,
      velocitySource,
      coherenceSource,
      warnings,
    };
    return {
      id: result.pointIds[index],
      name: `监测点 ${result.pointIds[index]}`,
      lon: result.longitude[index],
      lat: result.latitude[index],
      velocity: roundInsarValue(result.velocity[index]),
      velocitySource,
      displacement: series.at(-1) ?? 0,
      coherence: result.coherenceProvided[index] ? result.coherence[index] : 0,
      coherenceSource,
      missingRate: result.missingRate[index],
      mode: classDefinition.nameZh,
      modeCanonical: classDefinition.name,
      legacyMode: false,
      modeSource: `PASC-TCN 浏览器本地 ONNX · ${result.provider.toUpperCase()}`,
      modeConfidence: confidence,
      updated: result.dates.at(-1) ?? "—",
      series,
      dates: result.dates,
      capabilityLevel: 3,
      effectiveEpochCount: effectiveEpochs,
      temporalApplicability: temporal,
      spatialApplicability: spatial,
      pasc,
      warnings,
    };
  });

  return {
    title: cleanDatasetTitle(fileName),
    points,
    periods: result.timeSteps,
    invalidRows: result.invalidRows,
    totalRows: result.totalRows,
    totalPredictedPoints: result.totalPredictedPoints ?? count,
    mapSampled: Boolean(result.mapSampled),
  };
}

export function localPredictionCsv(result: PascLocalCompletePayload) {
  return csvText([
    ["point_id", "lon", "lat", "velocity_mm_per_year", "mode", "mode_name", "confidence", "spatial_reliability", "spatial_gate_mean", "spatial_reference", "coherence", "missing_rate", "epochs"],
    ...result.pointIds.map((pointId, index) => {
      const definition = PASC_CLASSES[result.modeIndex[index]];
      return [
        pointId,
        result.longitude[index],
        result.latitude[index],
        roundInsarValue(result.velocity[index]),
        definition?.nameZh ?? "未分类",
        definition?.name ?? "Undefined",
        result.confidence[index],
        result.spatialReliability[index],
        result.spatialGateMean[index],
        referenceSource(result.spatialReferenceSource[index]),
        result.coherenceProvided[index] ? result.coherence[index] : null,
        result.missingRate[index],
        result.timeSteps,
      ];
    }),
  ]);
}
