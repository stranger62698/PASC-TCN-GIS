import type { InsarPoint } from "../data/site.js";
import {
  PASC_CONTRACT_VERSION,
  PASC_MODEL_VERSION,
  type PascPointQuality,
  type PascPointResult,
  type PascProbabilitySet,
  type PascSpatialReferenceSource,
  type PascValueSource,
} from "../types/pasc.js";
import { csvText } from "./analysis-exports.js";
import { decodeInsarValue, roundInsarValue } from "./insar-precision.js";
import { PASC_CLASSES, classifyEpochCount } from "./pasc.js";
import type { PascLocalCompletePayload } from "./pasc-local-worker-protocol.js";
import { createLocalSeriesStore, type LocalSeriesStore } from "./local-series-store.js";

export type PascLocalMapDataset = {
  title: string;
  points: InsarPoint[];
  periods: number;
  invalidRows: number;
  totalRows: number;
  totalPredictedPoints: number;
  mapSampled: boolean;
  observedDates: string[];
  seriesStore: LocalSeriesStore;
  hydratePoints: (ids: string[]) => Promise<InsarPoint[]>;
  loadEvaluationDate: (date: string) => Promise<void>;
  loadDisplayTime: (index: number) => Promise<void>;
  loadStageVelocity: (start: number, end: number) => Promise<void>;
  invalidReasons?: PascLocalCompletePayload["invalidReasons"];
  invalidExamples?: PascLocalCompletePayload["invalidExamples"];
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
  if ((!result.seriesStorage && result.displacementSeries.length !== count * result.timeSteps) || result.dates.length !== result.timeSteps) {
    throw new Error("本地 ONNX 时序结果与日期轴不一致，地图未更新。");
  }

  if (new Set(result.pointIds).size !== count) throw new Error("本地结果存在重复点编号，地图未更新。");
  if (result.observedDates && !result.seriesStorage && (result.observedSeries?.length !== count * result.observedDates.length || result.observedMask?.length !== count * result.observedDates.length)) {
    throw new Error("本地实测时序与有效观测标记长度不一致，地图未更新。");
  }
  const seriesStore = createLocalSeriesStore(result);
  const observedDates = result.observedDates ?? [];
  type ObservedPoint = InsarPoint & {
    observedSeries?: ArrayLike<number>; observedDates?: string[]; observedMask?: ArrayLike<number>;
    observedDisplacement?: number; observedEvaluationDate?: string; localSeriesIndex?: number;
  };
  const points = Array.from({ length: count }, (_, index): InsarPoint => {
    const classDefinition = PASC_CLASSES[result.modeIndex[index]];
    const rawClassDefinition = PASC_CLASSES[result.rawModeIndex[index]];
    if (!classDefinition || !rawClassDefinition) throw new Error(`点 ${result.pointIds[index]} 的本地分类编号无效。`);
    const eligible = result.classificationEligible?.[index] !== 0;
    let series: number[] | undefined;
    const getSeries = () => series ??= result.observedDates || result.seriesStorage ? seriesStore.view(index)
      : Array.from(result.displacementSeries.subarray(index * result.timeSteps, (index + 1) * result.timeSteps), value => decodeInsarValue(value, result.displacementScale));
    const effectiveEpochs = result.effectiveEpochs?.[index] ?? Math.max(20, Math.round(result.sourceEpochs * (1 - result.missingRate[index])));
    const sourceMissingRate = result.effectiveEpochs && observedDates.length && effectiveEpochs <= observedDates.length
      ? 1 - effectiveEpochs / observedDates.length : result.missingRate[index];
    const temporal = classifyEpochCount(effectiveEpochs).temporalApplicability;
    const reliability = result.spatialReliability[index];
    const spatial = reliability > 0 ? "full_reference" : "limited_reference";
    const source = referenceSource(result.spatialReferenceSource[index]);
    const confidence = result.confidence[index];

    const velocitySource: PascValueSource = result.velocityProvided[index] ? "provided" : Number.isFinite(result.velocity[index]) ? "calculated" : "not_available";
    const coherenceSource: PascValueSource = result.coherenceProvided[index] ? "provided" : "default";
    let warningsCache: string[] | undefined;
    const getWarnings = () => warningsCache ??= [
      ...(observedDates.length ? ["时序口径：地图曲线为模型预处理时序；异常累计量使用单位归一的真实观测，缺测保持为空，不使用插值或平滑值。"]
        : ["时序口径：地图使用本地预处理后的时序，可能含插值或平滑值；异常累计量也基于该时序，不能视作未经处理的末期实测值。"]),
      ...(!eligible ? ["分类不适用：有效观测不足 20 期，点位保留为未分类，未进入模型推理。"] : []),
      ...(result.sourceTruncated ? [`分析范围：仅前 ${count.toLocaleString()} 个有效点，异常与统计均不代表全文件。`] : result.mapSampled ? [`分析范围：已分类 ${(result.totalPredictedPoints ?? count).toLocaleString()} 点，地图、异常聚类及 AOI 仅基于 ${count.toLocaleString()} 个抽样点，不能代表全量空间聚集。`] : []),
      ...(confidence < 0.6 ? ["本地 PASC-TCN 结果置信度低于 0.60，建议结合时序和空间背景复核。"] : []),
      ...(spatial === "limited_reference" ? ["该点在500米范围内缺少可用邻点；空间门控未启用，分类主要来自时间与物理分支。"] : []),
      ...(source === "uploaded_research_area" ? [result.largeFileMode ? "大文件模式的空间分支仅使用当前处理批次内无标签邻点；完整全区邻域未进入内存；全部点位保留，解释时应结合批次空间参考边界复核。" : "空间分支使用当前本地 CSV 内无标签邻点；未使用邻点类别，也未拟合模型参数。"] : []),
      ...(coherenceSource === "default" ? ["CSV 未提供相干性；本地推理使用冻结默认值 0.5，地图不将其表示为实测相干性。"] : []),
    ];
    let pascCache: PascPointResult | undefined;
    const getPasc = (): PascPointResult | undefined => {
      if (!eligible) return undefined;
      const hydrated = seriesStore.hasRow(index);
      if (pascCache && (pascCache.quality.seriesMean !== null || !hydrated)) return pascCache;
      const statistics = hydrated ? seriesQuality(getSeries()) : { mean: null, standardDeviation: null };
      const warnings = getWarnings();
      const quality: PascPointQuality = {
      originalEpochCount: effectiveEpochs,
      adaptedEpochCount: result.timeSteps,
      insertedEpochCount: result.insertedEpochs,
      remainingIrregularIntervals: 0,
      startDate: result.dates[0] ?? null,
      endDate: result.dates.at(-1) ?? null,
      spanDays: result.dates.length > 1 ? Math.round((Date.parse(result.dates.at(-1)!) - Date.parse(result.dates[0])) / 86_400_000) : null,
      missingRate: sourceMissingRate,
      minimumGapDays: null,
      maximumGapDays: null,
      medianGapDays: 12,
      seriesMean: statistics.mean,
      seriesStd: statistics.standardDeviation,
      noiseResidualStd: null,
      zscoreEpsilon: 0.00001,
    };
    const pasc: PascPointResult = {
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
      pascCache = pasc;
      return pasc;
    };
    const point: ObservedPoint = {
      id: result.pointIds[index],
      name: `监测点 ${result.pointIds[index]}`,
      lon: result.longitude[index],
      lat: result.latitude[index],
      velocity: roundInsarValue(result.velocity[index]),
      velocitySource,
      displacement: result.processedDisplacement?.[index] ?? (result.seriesStorage ? NaN : getSeries().at(-1) ?? NaN),
      coherence: result.coherenceProvided[index] ? result.coherence[index] : 0,
      coherenceSource,
      missingRate: sourceMissingRate,
      mode: eligible ? classDefinition.nameZh : "未分类",
      modeCanonical: eligible ? classDefinition.name : undefined,
      legacyMode: false,
      modeSource: eligible ? "PASC-TCN 浏览器本地 ONNX · " + result.provider.toUpperCase() : "有效观测不足20期 · 未分类",
      modeConfidence: eligible ? confidence : null,
      updated: result.dates.at(-1) ?? "—",
      get series() { return getSeries(); },
      dates: result.dates,
      capabilityLevel: eligible ? 3 : 2,
      effectiveEpochCount: effectiveEpochs,
      temporalApplicability: temporal,
      spatialApplicability: spatial,
      get pasc() { return getPasc(); },
      get warnings() { return getWarnings(); },
      localSeriesIndex: index,
      localSeriesHydrated: !result.seriesStorage,
      ...(observedDates.length ? {
        observedDates, observedSeries: seriesStore.view(index, "observed"), observedMask: seriesStore.maskView(index),
        observedDisplacement: result.observedDisplacement?.[index] ?? result.observedSeries?.[index * observedDates.length + observedDates.length - 1] ?? NaN,
        observedEvaluationDate: observedDates.at(-1),
      } : {}),
    };
    return point;
  });

  const pointById = new Map(points.map(point => [point.id, point as ObservedPoint]));
  const hydratedDetails = new Map<string, Awaited<ReturnType<LocalSeriesStore["readRow"]>>>();
  let evaluationRequest = 0;
  let stageRequest = 0;
  let displayRequest = 0;
  return {
    title: cleanDatasetTitle(fileName),
    points,
    periods: result.timeSteps,
    invalidRows: result.invalidRows,
    totalRows: result.totalRows,
    totalPredictedPoints: result.totalPredictedPoints ?? count,
    mapSampled: Boolean(result.mapSampled),
    observedDates, seriesStore, invalidReasons: result.invalidReasons, invalidExamples: result.invalidExamples,
    async hydratePoints(ids) {
      const selected = [...new Set(ids)].map(id => pointById.get(id)).filter((point): point is ObservedPoint => Boolean(point));
      for (const point of selected) {
        const detail = await seriesStore.readRow(point.localSeriesIndex!);
        if (!hydratedDetails.has(point.id) && hydratedDetails.size >= 64) {
          const evicted = hydratedDetails.keys().next().value!;
          hydratedDetails.delete(evicted);
          const old = pointById.get(evicted)!;
          Object.defineProperty(old, "series", { configurable: true, enumerable: true, get: () => seriesStore.view(old.localSeriesIndex!) });
          old.observedSeries = seriesStore.view(old.localSeriesIndex!, "observed");
          old.observedMask = seriesStore.maskView(old.localSeriesIndex!);
          old.localSeriesHydrated = !result.seriesStorage;
        }
        hydratedDetails.delete(point.id); hydratedDetails.set(point.id, detail);
        Object.defineProperty(point, "series", { configurable: true, enumerable: true, value: detail.processed });
        point.observedSeries = detail.observed; point.observedMask = detail.mask;
        point.localSeriesHydrated = true;
      }
      return selected;
    },
    async loadEvaluationDate(date) {
      const request = ++evaluationRequest;
      const index = observedDates.indexOf(date);
      if (index < 0) throw new Error("所选日期不是当前 CSV 的真实观测日期。");
      const values = await seriesStore.readColumn(index, "observed");
      if (request !== evaluationRequest) return;
      for (let row = 0; row < points.length; row += 1) {
        const point = points[row] as ObservedPoint;
        point.observedDisplacement = values[row]; point.observedEvaluationDate = date;
      }
    },
    async loadDisplayTime(index) {
      const request = ++displayRequest;
      const values = await seriesStore.readColumn(index, "processed");
      if (request !== displayRequest) return;
      for (let row = 0; row < points.length; row += 1) {
        points[row].renderDisplacement = values[row]; points[row].renderTimeIndex = index;
      }
    },
    async loadStageVelocity(start, end) {
      const request = ++stageRequest;
      let values: Float64Array;
      try { values = await seriesStore.readStageVelocity(start, end, result.dates, () => request !== stageRequest); }
      catch (error) { if (request !== stageRequest) return; throw error; }
      if (request !== stageRequest) return;
      const first = Math.max(0, Math.min(start, end)), last = Math.min(result.timeSteps - 1, Math.max(start, end));
      for (let row = 0; row < points.length; row += 1) {
        points[row].renderStageVelocity = values[row];
        points[row].renderStageStart = first; points[row].renderStageEnd = last;
      }
    },
  };
}

export function localPredictionCsv(result: PascLocalCompletePayload) {
  return csvText([
    ["point_id", "lon", "lat", "velocity_mm_per_year", "mode", "mode_name", "confidence", "spatial_reliability", "spatial_gate_mean", "spatial_reference", "coherence", "missing_rate", "epochs"],
    ...result.pointIds.map((pointId, index) => {
      const definition = PASC_CLASSES[result.modeIndex[index]];
      const eligible = result.classificationEligible?.[index] !== 0;
      return [
        pointId,
        result.longitude[index],
        result.latitude[index],
        roundInsarValue(result.velocity[index]),
        eligible ? definition?.nameZh ?? "未分类" : "未分类",
        eligible ? definition?.name ?? null : null,
        eligible ? result.confidence[index] : null,
        result.spatialReliability[index],
        result.spatialGateMean[index],
        referenceSource(result.spatialReferenceSource[index]),
        result.coherenceProvided[index] ? result.coherence[index] : null,
        result.missingRate[index],
        result.effectiveEpochs?.[index] ?? result.timeSteps,
      ];
    }),
  ]);
}
