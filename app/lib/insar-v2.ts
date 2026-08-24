import type { InsarPoint } from "../data/site";
import {
  PASC_CONTRACT_VERSION,
  PASC_MODEL_VERSION,
  type PascCapabilityLevel,
  type PascClassName,
  type PascCompatibilityIssue,
  type PascCompatibilitySummary,
  type PascPointResult,
  type PascPreprocessingState,
  type PascSpatialApplicability,
  type PascValueSource,
} from "../types/pasc";
import {
  PASC_CLASSES,
  PASC_ZSCORE_EPSILON,
  capabilityLevelFor,
  classifyEpochCount,
  normalizePascProbabilities,
  parsePascClass,
  pascDisplayName,
  winningPascClass,
} from "./pasc";
import {
  analyzePascDateColumns,
  duplicateDateConflicts,
  isPascDateField,
  resemblesPascDateField,
  resolvePascField,
  uniqueSortedDateColumns,
  type PascDateSchemaAnalysis,
  type PascFieldResolution,
  type PascSemanticField,
} from "./pasc-schema";

export type DisplacementUnit = "mm" | "cm" | "m" | "unknown";
export type VelocityUnit = "mm/year" | "cm/year" | "m/year" | "unknown";
export type SignConvention = "toward_satellite_positive" | "away_from_satellite_positive" | "unknown";

export type CsvMapping = {
  lon: string;
  lat: string;
  velocity: string;
  id: string;
  mode: string;
  modeSource: string;
  confidence: string;
  coherence: string;
  location: string;
  timeCols: string[];
  displacementUnit?: DisplacementUnit;
  velocityUnit?: VelocityUnit;
  signConvention?: SignConvention;
  preprocessingState?: PascPreprocessingState;
};

export type CsvInspection = {
  headers: string[];
  mapping: CsvMapping;
  warnings: string[];
  unparsedTimeColumns: string[];
  dateAnalysis: PascDateSchemaAnalysis;
  fieldResolutions: Record<PascSemanticField, PascFieldResolution>;
};

export type QualityReport = {
  invalid: number;
  missingRate: number;
  lowCoherence: number;
  outlierVelocity: number;
  modeCounts: Record<string, number>;
  warnings: string[];
  timeColumns: string[];
  bbox: [number, number, number, number];
  capabilityCounts: Record<PascCapabilityLevel, number>;
  compatibility: PascCompatibilitySummary;
  totalRows?: number;
  validPoints?: number;
  duplicateCoordinates?: number;
  unparsedTimeColumns?: string[];
  coherenceProvided?: boolean;
};

export type DatasetParseResult = {
  points: InsarPoint[];
  invalid: number;
  periods: number;
  modeField: string;
  datasetTitle: string;
  errors: string[];
  quality: QualityReport;
  compatibility: PascCompatibilitySummary;
};

export type RenderAttribute = "velocity" | "displacement" | "stageVelocity" | "mode" | "coherence" | "missing";
export type RenderStyle = {
  attribute: RenderAttribute;
  min: number;
  max: number;
  interval: number;
  colors: string[];
  timeIndex: number;
  rangeStart: number;
  rangeEnd: number;
};

const extraAliases = {
  velocity: ["average_velocity", "v", "速率"],
  coherence: ["precision", "accuracy", "相关性", "精度"],
  mode: ["label", "mode", "pattern", "deformation_mode", "class", "category", "cluster", "Predicted_Label", "pasc_label", "形变模式", "类别", "分类"],
  modeSource: ["mode_source", "model_source", "model", "classifier", "classification_method", "模式来源", "分类模型", "模型名称"],
  confidence: ["confidence", "Confidence", "probability", "score", "mode_confidence", "label_confidence", "分类置信度", "模式置信度", "置信度"],
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, "_");
const find = (headers: string[], aliases: readonly string[]) => {
  const exact = headers.find(header => aliases.includes(header));
  if (exact) return exact;
  const candidates = new Set(aliases.map(normalize));
  return headers.find(header => candidates.has(normalize(header))) ?? "";
};

export function splitCsv(line: string) {
  const cells: string[] = [];
  let cell = "", quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell); cell = ""; }
    else cell += character;
  }
  cells.push(cell);
  return cells;
}

export const isDateField = isPascDateField;
export const resemblesDateField = resemblesPascDateField;

export function inspectCsv(text: string): CsvInspection {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("CSV 至少需要标题行和一行数据");
  const headers = splitCsv(lines[0]);
  const dateAnalysis = analyzePascDateColumns(headers);
  const timeCols = uniqueSortedDateColumns(dateAnalysis).map(item => item.original);
  const semantics: PascSemanticField[] = ["point_id", "longitude", "latitude", "velocity", "coherence", "project_name"];
  const fieldResolutions = Object.fromEntries(
    semantics.map(semantic => [semantic, resolvePascField(headers, semantic)]),
  ) as Record<PascSemanticField, PascFieldResolution>;
  const mapping: CsvMapping = {
    lon: fieldResolutions.longitude.field,
    lat: fieldResolutions.latitude.field,
    velocity: fieldResolutions.velocity.field || find(headers, extraAliases.velocity),
    id: fieldResolutions.point_id.field,
    mode: find(headers, extraAliases.mode),
    modeSource: find(headers, extraAliases.modeSource),
    confidence: find(headers, extraAliases.confidence),
    coherence: fieldResolutions.coherence.field || find(headers, extraAliases.coherence),
    location: fieldResolutions.project_name.field,
    timeCols,
    displacementUnit: "unknown",
    velocityUnit: "unknown",
    signConvention: "unknown",
    preprocessingState: "unknown",
  };
  const warnings: string[] = [];
  if (!mapping.lon) warnings.push("未自动识别经度列");
  if (!mapping.lat) warnings.push("未自动识别纬度列");
  if (!mapping.velocity) warnings.push("未识别速率列；有至少 2 个真实日期值的点将按最小二乘斜率计算");
  if (timeCols.length < 2) warnings.push("少于两个可解析日期列；最多进入 Level 1");
  if (dateAnalysis.failed.length) warnings.push(`有 ${dateAnalysis.failed.length} 个疑似日期字段无法解析`);
  if (dateAnalysis.duplicateDates.length) warnings.push(`发现 ${dateAnalysis.duplicateDates.length} 个同日重复日期组`);
  if (!mapping.mode) warnings.push("未识别形变模式列，可在向导中指定");
  Object.values(fieldResolutions).forEach(resolution => {
    if (resolution.method === "heuristic") warnings.push(`${resolution.semantic} 启发式映射到 ${resolution.field}，需要确认`);
    if (resolution.candidates.length > 1) warnings.push(`${resolution.semantic} 存在多个候选字段，需要确认`);
  });
  return { headers, mapping, warnings, unparsedTimeColumns: dateAnalysis.failed, dateAnalysis, fieldResolutions };
}

export function slopePerYear(series: number[], dates: string[]) {
  if (series.length < 2 || dates.length < 2) return 0;
  const times = dates.map(date => Date.parse(`${date}T00:00:00Z`) / (365.25 * 86400000));
  if (times.some(value => !Number.isFinite(value))) return 0;
  const meanTime = times.reduce((sum, value) => sum + value, 0) / times.length;
  const meanValue = series.reduce((sum, value) => sum + value, 0) / series.length;
  let numerator = 0, denominator = 0;
  series.forEach((value, index) => {
    numerator += (times[index] - meanTime) * (value - meanValue);
    denominator += (times[index] - meanTime) ** 2;
  });
  return denominator ? numerator / denominator : 0;
}

function detectCategorical(headers: string[], rows: string[][], blocked: Set<number>) {
  for (let index = 0; index < headers.length; index += 1) {
    if (blocked.has(index)) continue;
    const values = rows.slice(0, 1500).map(row => row[index]?.trim()).filter(Boolean);
    const unique = [...new Set(values)];
    if (values.length > 1 && unique.length >= 2 && unique.length <= 6 && unique.every(value => /^[0-5]$/.test(value))) return headers[index];
  }
  return "";
}

const numeric = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const truthy = (value: string | undefined) => /^(?:1|true|yes)$/i.test(String(value ?? "").trim());

function headerIndex(headers: string[], aliases: string[]) {
  const indexes = new Map(headers.map((header, index) => [normalize(header), index]));
  for (const alias of aliases) {
    const result = indexes.get(normalize(alias));
    if (result !== undefined) return result;
  }
  return -1;
}

function pointQuality(series: number[], dates: string[], missingRate: number) {
  const times = dates.map(date => Date.parse(`${date}T00:00:00Z`)).filter(Number.isFinite);
  const gaps = times.slice(1).map((time, index) => (time - times[index]) / 86400000).sort((a, b) => a - b);
  const mean = series.length ? series.reduce((sum, value) => sum + value, 0) / series.length : null;
  const std = mean === null ? null : Math.sqrt(series.reduce((sum, value) => sum + (value - mean) ** 2, 0) / series.length);
  return {
    originalEpochCount: series.length,
    adaptedEpochCount: series.length === 248 ? 248 : null,
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
    spanDays: times.length >= 2 ? (times.at(-1)! - times[0]) / 86400000 : null,
    missingRate,
    minimumGapDays: gaps[0] ?? null,
    maximumGapDays: gaps.at(-1) ?? null,
    medianGapDays: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null,
    seriesMean: mean,
    seriesStd: std,
    noiseResidualStd: null,
    zscoreEpsilon: PASC_ZSCORE_EPSILON,
  };
}

function parsePascResult(
  cells: string[],
  headers: string[],
  pointId: string,
  series: number[],
  dates: string[],
  missingRate: number,
  velocitySource: PascValueSource,
  coherenceSource: PascValueSource,
): PascPointResult | undefined {
  const probabilityIndexes = Object.fromEntries(PASC_CLASSES.map(item => [
    item.name,
    headerIndex(headers, [`Probability_${item.name}`, `pasc_probability_${item.name}`]),
  ])) as Record<PascClassName, number>;
  if (Object.values(probabilityIndexes).some(index => index < 0)) return undefined;
  const values = Object.fromEntries(PASC_CLASSES.map(item => [
    item.name,
    numeric(cells[probabilityIndexes[item.name]]),
  ])) as Record<PascClassName, number | null>;
  if (Object.values(values).some(value => value === null)) return undefined;
  const probabilities = normalizePascProbabilities(values as Record<PascClassName, number>);
  if (!probabilities) return undefined;
  const winner = winningPascClass(probabilities);
  const declaredIdIndex = headerIndex(headers, ["pasc_label_id", "Predicted_Label_ID", "calibrated_label_id"]);
  const declaredLabelIndex = headerIndex(headers, ["pasc_label", "Predicted_Label", "calibrated_label"]);
  const declaredValue = declaredIdIndex >= 0 ? cells[declaredIdIndex] : declaredLabelIndex >= 0 ? cells[declaredLabelIndex] : "";
  const declared = parsePascClass(declaredValue).definition;
  const rawIdIndex = headerIndex(headers, ["raw_label_id", "Raw_Label_ID"]);
  const rawLabelIndex = headerIndex(headers, ["raw_label", "Raw_Label"]);
  const rawValue = rawIdIndex >= 0 ? cells[rawIdIndex] : rawLabelIndex >= 0 ? cells[rawLabelIndex] : "";
  const raw = parsePascClass(rawValue).definition;
  const confidenceIndex = headerIndex(headers, ["Confidence", "pasc_confidence"]);
  const lowIndex = headerIndex(headers, ["Low_Confidence", "pasc_low_confidence"]);
  const reliabilityIndex = headerIndex(headers, ["Spatial_Reliability", "spatial_reliability"]);
  const gateIndex = headerIndex(headers, ["Spatial_Gate_Mean", "spatial_gate_mean"]);
  const spatialIndex = headerIndex(headers, ["Spatial_Applicability", "spatial_applicability"]);
  const suppliedConfidence = confidenceIndex >= 0 ? numeric(cells[confidenceIndex]) : null;
  const confidence = suppliedConfidence === null ? probabilities[winner.name] : clamp01(suppliedConfidence);
  const spatialValue = spatialIndex >= 0 ? cells[spatialIndex] : "";
  const spatialApplicability: PascSpatialApplicability =
    spatialValue === "full_reference" || spatialValue === "limited_reference" ? spatialValue : "not_evaluated";
  return {
    contractVersion: PASC_CONTRACT_VERSION,
    modelVersion: PASC_MODEL_VERSION,
    pointId,
    rawLabelId: raw?.id ?? null,
    rawLabel: raw?.name ?? null,
    calibratedLabelId: winner.id,
    calibratedLabel: winner.name,
    probabilities,
    confidence,
    calibrationChanged: raw ? raw.id !== winner.id : null,
    lowConfidence: lowIndex >= 0 ? truthy(cells[lowIndex]) : confidence < 0.6,
    spatialReliability: reliabilityIndex >= 0 ? clamp01(numeric(cells[reliabilityIndex]) ?? 0) : 0,
    spatialGateMean: gateIndex >= 0 ? clamp01(numeric(cells[gateIndex]) ?? 0) : 0,
    temporalApplicability: classifyEpochCount(series.length).temporalApplicability,
    spatialApplicability,
    quality: pointQuality(series, dates, missingRate),
    velocitySource,
    coherenceSource,
    warnings: declared && declared.id !== winner.id
      ? ["CSV 标签与最大校准概率不一致；结果已按最大概率索引校正。"]
      : [],
  };
}

function countSources(points: InsarPoint[], field: "velocitySource" | "coherenceSource") {
  const counts: Record<PascValueSource, number> = { provided: 0, calculated: 0, default: 0, not_available: 0 };
  points.forEach(point => { counts[point[field] ?? "not_available"] += 1; });
  return counts;
}

function buildCompatibility(
  points: InsarPoint[],
  mapping: CsvMapping,
  dates: PascDateSchemaAnalysis,
  legacyCount: number,
): PascCompatibilitySummary {
  const epochs = points.map(point => point.effectiveEpochCount ?? point.series.length);
  const minimum = epochs.length ? Math.min(...epochs) : 0;
  const maximum = epochs.length ? Math.max(...epochs) : 0;
  const classified = classifyEpochCount(minimum);
  const issues: PascCompatibilityIssue[] = [];
  dates.failed.forEach(field => issues.push({ code: "PASC_DATE_PARSE_FAILED", severity: "error", message: `日期字段 ${field} 无法解析`, field }));
  if ((mapping.displacementUnit ?? "unknown") === "unknown" || (mapping.velocity && (mapping.velocityUnit ?? "unknown") === "unknown")) {
    issues.push({ code: "PASC_UNIT_CONFIRMATION_REQUIRED", severity: "confirmation", message: "必须确认形变与速率单位，禁止按数值大小猜测。" });
  }
  if ((mapping.signConvention ?? "unknown") === "unknown") {
    issues.push({ code: "PASC_SIGN_CONFIRMATION_REQUIRED", severity: "confirmation", message: "必须确认形变正负号约定。" });
  }
  if ((mapping.preprocessingState ?? "unknown") === "unknown") {
    issues.push({ code: "PASC_PREPROCESSING_STATE_REQUIRED", severity: "confirmation", message: "必须确认 raw / already_smoothed 状态。" });
  }
  if (minimum < 40) issues.push({ code: "PASC_TOO_FEW_VALID_EPOCHS", severity: "warning", message: "少于 40 个逐点有效日期值时 PASC 不可用，普通 WebGIS 能力仍保留。" });
  if (legacyCount) issues.push({ code: "PASC_LEGACY_STEPWISE_CONFIRMATION_REQUIRED", severity: "confirmation", message: `发现 ${legacyCount} 个旧版 Stepwise；未自动映射为 Piecewise。` });
  const capabilityCounts: Record<PascCapabilityLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  points.forEach(point => { capabilityCounts[point.capabilityLevel ?? capabilityLevelFor({ validCoordinates: true, validEpochs: point.series.length, hasVelocity: true })] += 1; });
  const spatialStates = new Set(points.map(point => point.pasc?.spatialApplicability ?? "not_evaluated"));
  const spatialApplicability: PascSpatialApplicability = spatialStates.size === 1
    ? [...spatialStates][0] as PascSpatialApplicability
    : spatialStates.has("limited_reference") ? "limited_reference" : "not_evaluated";
  return {
    contractVersion: PASC_CONTRACT_VERSION,
    capabilityLevel: ([3, 2, 1, 0] as const).find(level => capabilityCounts[level] > 0) ?? 0,
    epochStatus: classified.epochStatus,
    temporalApplicability: classified.temporalApplicability,
    spatialApplicability,
    totalPoints: points.length,
    pascCandidatePoints: capabilityCounts[3],
    unsupportedPoints: points.length - capabilityCounts[3],
    minEffectiveEpochs: minimum,
    maxEffectiveEpochs: maximum,
    native248Points: epochs.filter(value => value === 248).length,
    experimentalPoints: epochs.filter(value => value >= 40 && value < 248).length,
    invalidDateColumns: dates.failed,
    duplicateDates: dates.duplicateDates.map(group => group.canonical),
    velocitySources: countSources(points, "velocitySource"),
    coherenceSources: countSources(points, "coherenceSource"),
    issues,
  };
}

export function parseMappedCsv(text: string, fileName: string, mapping: CsvMapping, strictVelocity = true): DatasetParseResult {
  void strictVelocity;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) throw new Error("CSV 至少需要标题行和一行数据");
  const headers = splitCsv(lines[0]);
  const rows = lines.slice(1).map(splitCsv);
  const index = (field: string) => field ? headers.indexOf(field) : -1;
  const resolved: CsvMapping = {
    ...mapping,
    displacementUnit: mapping.displacementUnit ?? "unknown",
    velocityUnit: mapping.velocityUnit ?? "unknown",
    signConvention: mapping.signConvention ?? "unknown",
    preprocessingState: mapping.preprocessingState ?? "unknown",
  };
  const dateAnalysis = analyzePascDateColumns(headers, resolved.timeCols);
  if (dateAnalysis.failed.length) throw new Error(`PASC_DATE_PARSE_FAILED：${dateAnalysis.failed.join("、")}`);
  rows.forEach((row, rowIndex) => {
    const conflicts = duplicateDateConflicts(row, headers, dateAnalysis);
    if (conflicts.length) throw new Error(`PASC_DUPLICATE_DATE_CONFLICT：第 ${rowIndex + 2} 行 ${conflicts.map(group => group.canonical).join("、")}`);
  });
  const dateFields = uniqueSortedDateColumns(dateAnalysis);
  let modeField = resolved.mode;
  const blocked = new Set([
    resolved.lon, resolved.lat, resolved.velocity, resolved.id, resolved.modeSource,
    resolved.confidence, resolved.coherence, resolved.location, ...resolved.timeCols,
  ].map(index).filter(value => value >= 0));
  if (!modeField) modeField = detectCategorical(headers, rows, blocked);
  const lonIndex = index(resolved.lon);
  const latIndex = index(resolved.lat);
  const velocityIndex = index(resolved.velocity);
  const idIndex = index(resolved.id);
  const modeIndex = index(modeField);
  const sourceIndex = index(resolved.modeSource);
  const confidenceIndex = index(resolved.confidence);
  const coherenceIndex = index(resolved.coherence);
  const locationIndex = index(resolved.location);
  if (lonIndex < 0 || latIndex < 0) throw new Error("PASC_SCHEMA_UNRESOLVED：请指定经度和纬度列");

  const displacementFactor = resolved.displacementUnit === "m" ? 1000 : resolved.displacementUnit === "cm" ? 10 : 1;
  const velocityFactor = resolved.velocityUnit === "m/year" ? 1000 : resolved.velocityUnit === "cm/year" ? 10 : 1;
  const signFactor = resolved.signConvention === "away_from_satellite_positive" ? -1 : 1;
  let invalid = 0, totalMissing = 0, legacyCount = 0;
  const errors: string[] = [];
  const points: InsarPoint[] = [];

  rows.forEach((cells, rowIndex) => {
    const lon = Number(cells[lonIndex]), lat = Number(cells[latIndex]);
    const nullIsland = lon === 0 && lat === 0;
    const validCoordinates = Number.isFinite(lon) && Number.isFinite(lat)
      && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90 && !nullIsland;
    if (!validCoordinates) {
      invalid += 1;
      if (errors.length < 20) errors.push(`第 ${rowIndex + 2} 行：${nullIsland ? "坐标为 (0,0) 占位值" : "经纬度无效"}`);
      return;
    }
    const series: number[] = [], dates: string[] = [];
    let missing = 0;
    dateFields.forEach(date => {
      const value = numeric(cells[date.index]);
      if (value === null) missing += 1;
      else { const converted = value * displacementFactor * signFactor; series.push(converted === 0 ? 0 : converted); dates.push(date.canonical); }
    });
    totalMissing += missing;
    const rawVelocity = velocityIndex >= 0 ? numeric(cells[velocityIndex]) : null;
    const velocitySource: PascValueSource = rawVelocity !== null ? "provided" : series.length >= 2 ? "calculated" : "not_available";
    const convertedVelocity = rawVelocity !== null ? rawVelocity * velocityFactor * signFactor : series.length >= 2 ? slopePerYear(series, dates) : 0;
    const velocity = convertedVelocity === 0 ? 0 : convertedVelocity;
    const capabilityLevel = capabilityLevelFor({
      validCoordinates: true,
      validEpochs: series.length,
      hasVelocity: velocitySource !== "not_available",
    });
    if (capabilityLevel === 0) {
      invalid += 1;
      if (errors.length < 20) errors.push(`第 ${rowIndex + 2} 行：无有效形变或速率，属于 Level 0`);
      return;
    }
    const id = idIndex >= 0 && cells[idIndex]?.trim() ? cells[idIndex].trim() : String(points.length + 1);
    const rawConfidence = confidenceIndex >= 0 ? numeric(cells[confidenceIndex]) : null;
    const modeConfidence = rawConfidence === null ? null : clamp01(rawConfidence > 1 ? rawConfidence / 100 : rawConfidence);
    const rawMode = modeIndex >= 0 && cells[modeIndex]?.trim() ? cells[modeIndex].trim() : "";
    const parsedMode = parsePascClass(rawMode);
    if (parsedMode.legacy) legacyCount += 1;
    const mode = rawMode ? pascDisplayName(rawMode) : "未分类";
    const modeSource = sourceIndex >= 0 && cells[sourceIndex]?.trim()
      ? cells[sourceIndex].trim()
      : modeIndex >= 0 ? `${resolved.mode ? "CSV 字段" : "自动识别字段"}：${modeField}` : "";
    const coherenceValue = coherenceIndex >= 0 ? numeric(cells[coherenceIndex]) : null;
    const coherenceSource: PascValueSource = coherenceValue === null ? "not_available" : "provided";
    const coherence = coherenceValue === null ? 0 : clamp01(coherenceValue);
    const missingRate = dateFields.length ? missing / dateFields.length : 0;
    const pasc = parsePascResult(cells, headers, id, series, dates, missingRate, velocitySource, coherenceSource);
    const pointWarnings = [
      ...(parsedMode.warning ? [parsedMode.warning] : []),
      ...(velocitySource === "not_available" ? ["未提供速率且时序不足，速率专题不可用。"] : []),
      ...(coherenceSource === "not_available" ? ["未提供 coherence；Phase A 不静默填模型默认值。"] : []),
      ...(series.length < 40 ? ["有效期少于 40，PASC 不可用。"] : series.length < 248 ? ["40-247 期当前仅为 experimental minimum。"] : []),
    ];
    points.push({
      id,
      name: `监测点 ${id}`,
      lon,
      lat,
      velocity,
      velocitySource,
      displacement: series.at(-1) ?? 0,
      coherence,
      coherenceSource,
      missingRate,
      mode,
      modeCanonical: parsedMode.definition?.name,
      legacyMode: parsedMode.legacy,
      modeSource,
      modeConfidence,
      updated: dates.at(-1) ?? "—",
      series,
      dates,
      capabilityLevel,
      effectiveEpochCount: series.length,
      temporalApplicability: pasc?.temporalApplicability ?? classifyEpochCount(series.length).temporalApplicability,
      spatialApplicability: pasc?.spatialApplicability ?? "not_evaluated",
      pasc,
      warnings: [...pointWarnings, ...(pasc?.warnings ?? [])],
    });
  });

  if (!points.length) throw new Error("没有解析出有效监测点，请检查映射和数据格式");
  const location = locationIndex >= 0 ? rows.find(row => row[locationIndex]?.trim())?.[locationIndex]?.trim() : "";
  const cleanName = fileName.replace(/\.[^.]+$/, "");
  const modeCounts: Record<string, number> = {};
  points.forEach(point => { modeCounts[point.mode] = (modeCounts[point.mode] ?? 0) + 1; });
  const velocities = points
    .filter(point => point.velocitySource !== "not_available")
    .map(point => point.velocity)
    .sort((a, b) => a - b);
  const q1 = velocities[Math.floor(velocities.length * 0.25)] ?? 0;
  const q3 = velocities[Math.floor(velocities.length * 0.75)] ?? 0;
  const spread = q3 - q1, low = q1 - 1.5 * spread, high = q3 + 1.5 * spread;
  const bbox: [number, number, number, number] = [
    Math.min(...points.map(point => point.lon)),
    Math.min(...points.map(point => point.lat)),
    Math.max(...points.map(point => point.lon)),
    Math.max(...points.map(point => point.lat)),
  ];
  const compatibility = buildCompatibility(points, resolved, dateAnalysis, legacyCount);
  const capabilityCounts: Record<PascCapabilityLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  points.forEach(point => { capabilityCounts[point.capabilityLevel ?? 0] += 1; });
  const warnings = [
    ...(!resolved.mode ? ["形变模式字段未显式指定，系统采用自动分类字段或未分类。"] : []),
    ...(idIndex < 0 ? ["未指定点号字段，系统按有效点顺序自动编号。"] : []),
    ...(coherenceIndex < 0 ? ["未指定相干性；Phase A 标为 not_available，不填模型默认值。"] : []),
    ...(velocityIndex < 0 ? ["未指定速率；按逐点真实日期使用最小二乘斜率计算可计算点。"] : []),
    ...(dateAnalysis.duplicateDates.length ? ["同日重复列仅在逐行值一致时保留第一列。"] : []),
    ...(legacyCount ? [`发现 ${legacyCount} 个旧版 Stepwise，已标记 legacy 并等待确认。`] : []),
    ...(invalid ? ["存在被过滤的 Level 0 或无效坐标行，请查看错误报告。"] : []),
  ];
  const quality: QualityReport = {
    invalid,
    missingRate: totalMissing / Math.max(1, rows.length * Math.max(1, dateFields.length)),
    lowCoherence: points.filter(point => point.coherenceSource === "provided" && point.coherence < 0.75).length,
    outlierVelocity: points.filter(point => point.velocitySource !== "not_available" && (point.velocity < low || point.velocity > high)).length,
    modeCounts,
    warnings,
    timeColumns: dateFields.map(item => item.original),
    bbox,
    capabilityCounts,
    compatibility,
  };
  return {
    points,
    invalid,
    periods: dateFields.length,
    modeField: modeField || "未分类",
    datasetTitle: location ? `${location} · 时序 InSAR` : `${cleanName} · 时序 InSAR`,
    errors,
    quality,
    compatibility,
  };
}

export function stageVelocity(point: InsarPoint, start: number, end: number) {
  const first = Math.max(0, Math.min(start, end));
  const last = Math.min(point.series.length - 1, Math.max(start, end));
  return slopePerYear(point.series.slice(first, last + 1), point.dates?.slice(first, last + 1) ?? []);
}

export function renderValue(point: InsarPoint, style: RenderStyle) {
  switch (style.attribute) {
    case "displacement": return point.series[Math.min(style.timeIndex, point.series.length - 1)] ?? point.displacement;
    case "stageVelocity": return stageVelocity(point, style.rangeStart, style.rangeEnd);
    case "coherence": return point.coherence;
    case "missing": return point.missingRate * 100;
    default: return point.velocity;
  }
}

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  return value.length === 3
    ? value.split("").map(character => parseInt(character + character, 16))
    : [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16));
}

export function colorFor(value: number, style: RenderStyle) {
  const colors = style.colors.length >= 2 ? style.colors : ["#e94b4b", "#1677ff"];
  const ratio = Math.max(0, Math.min(1, (value - style.min) / (style.max - style.min || 1)));
  const scaled = ratio * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const amount = scaled - index;
  const start = hexToRgb(colors[index]), end = hexToRgb(colors[index + 1]);
  return `rgb(${start.map((part, channel) => Math.round(part + (end[channel] - part) * amount)).join(",")})`;
}

export function parseQgisRamp(text: string) {
  const colors: string[] = [];
  for (const match of text.matchAll(/#([0-9a-fA-F]{6})\b/g)) colors.push(`#${match[1]}`);
  for (const match of text.matchAll(/(?:color|value)[^\d]{0,20}(\d{1,3}),(\d{1,3}),(\d{1,3})(?:,\d{1,3})?/gi)) {
    const rgb = [Number(match[1]), Number(match[2]), Number(match[3])];
    if (rgb.every(value => value >= 0 && value <= 255)) {
      colors.push(`#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`);
    }
  }
  return [...new Set(colors)].slice(0, 12);
}
