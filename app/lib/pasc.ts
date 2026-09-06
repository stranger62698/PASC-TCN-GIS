import {
  PASC_CONTRACT_VERSION,
  type PascCapabilityLevel,
  type PascClassDefinition,
  type PascClassId,
  type PascClassName,
  type PascEpochStatus,
  type PascPointResult,
  type PascProbabilitySet,
  type PascRegionClassStat,
  type PascSpatialApplicability,
  type PascTemporalApplicability,
} from "../types/pasc.js";

export const PASC_TARGET_STEPS = 248;
export const PASC_EXPERIMENTAL_MIN_STEPS = 20;
export const PASC_ZSCORE_EPSILON = 0.00001 as const;

export const PASC_CLASSES: readonly PascClassDefinition[] = [
  { id: 0, name: "Stable", nameZh: "稳定型", color: "#76D65B" },
  { id: 1, name: "Linear", nameZh: "线性型", color: "#E69F00" },
  { id: 2, name: "Piecewise", nameZh: "分段型", color: "#0072B2" },
  { id: 3, name: "Decelerating", nameZh: "减速型", color: "#F0E442" },
  { id: 4, name: "Accelerating", nameZh: "加速型", color: "#D73027" },
  { id: 5, name: "Undefined", nameZh: "未定义型", color: "#4D4D4D" },
] as const;

const byId = new Map(PASC_CLASSES.map(item => [item.id, item]));
const byName = new Map(PASC_CLASSES.flatMap(item => [
  [item.name.toLowerCase(), item] as const,
  [item.nameZh.toLowerCase(), item] as const,
]));
const legacyStepwise = new Set(["stepwise", "阶跃型", "阶跃", "step_wise"]);

export function pascClassById(id: number | null | undefined) {
  return byId.get(id as PascClassId) ?? null;
}

export function parsePascClass(value: unknown): {
  definition: PascClassDefinition | null;
  legacy: boolean;
  warning: string | null;
} {
  const clean = String(value ?? "").trim();
  if (!clean) return { definition: null, legacy: false, warning: null };
  if (/^[0-5]$/.test(clean)) {
    return { definition: pascClassById(Number(clean)), legacy: false, warning: null };
  }
  const key = clean.toLowerCase();
  if (legacyStepwise.has(key)) {
    return {
      definition: null,
      legacy: true,
      warning: "旧版 Stepwise 不能自动映射为 Piecewise，请确认原始分类语义。",
    };
  }
  return { definition: byName.get(key) ?? null, legacy: false, warning: null };
}

export function pascDisplayName(value: unknown) {
  const parsed = parsePascClass(value);
  if (parsed.legacy) return "Stepwise（旧版，待确认）";
  return parsed.definition?.nameZh ?? "未分类";
}

export function pascColor(value: unknown) {
  return parsePascClass(value).definition?.color ?? PASC_CLASSES[5].color;
}

export function emptyPascProbabilities(): PascProbabilitySet {
  return { Stable: 0, Linear: 0, Piecewise: 0, Decelerating: 0, Accelerating: 0, Undefined: 0 };
}

export function normalizePascProbabilities(values: Partial<Record<PascClassName, number>>): PascProbabilitySet | null {
  const probabilities = emptyPascProbabilities();
  let total = 0;
  for (const item of PASC_CLASSES) {
    const value = Number(values[item.name]);
    if (!Number.isFinite(value) || value < 0 || value > 1) return null;
    probabilities[item.name] = value;
    total += value;
  }
  if (!Number.isFinite(total) || total <= 0 || Math.abs(total - 1) > 0.02) return null;
  for (const item of PASC_CLASSES) probabilities[item.name] /= total;
  return probabilities;
}

export function winningPascClass(probabilities: PascProbabilitySet) {
  return PASC_CLASSES.reduce((best, item) =>
    probabilities[item.name] > probabilities[best.name] ? item : best,
  PASC_CLASSES[0]);
}

export function classifyEpochCount(validEpochs: number): {
  epochStatus: PascEpochStatus;
  temporalApplicability: PascTemporalApplicability;
} {
  if (validEpochs < PASC_EXPERIMENTAL_MIN_STEPS) {
    return { epochStatus: "unsupported_19_or_less", temporalApplicability: "unsupported" };
  }
  if (validEpochs < PASC_TARGET_STEPS) {
    return { epochStatus: "experimental_20_to_247", temporalApplicability: "experimental_adapted_to_248" };
  }
  if (validEpochs === PASC_TARGET_STEPS) {
    return { epochStatus: "native_248", temporalApplicability: "native_248" };
  }
  return { epochStatus: "adapted_over_248", temporalApplicability: "adapted_to_248" };
}

export function capabilityLevelFor(input: {
  validCoordinates: boolean;
  validEpochs: number;
  hasVelocity: boolean;
}): PascCapabilityLevel {
  if (!input.validCoordinates) return 0;
  if (input.validEpochs < 2) return 1;
  if (input.validEpochs < PASC_EXPERIMENTAL_MIN_STEPS) return 2;
  return 3;
}

export function summarizePascRegion(results: Array<PascPointResult | null | undefined>): PascRegionClassStat[] {
  const valid = results.filter((result): result is PascPointResult => Boolean(result));
  return PASC_CLASSES.map(item => {
    const matches = valid.filter(result => result.calibratedLabelId === item.id);
    return {
      ...item,
      count: matches.length,
      percentage: valid.length ? matches.length / valid.length * 100 : 0,
      averageConfidence: matches.length ? matches.reduce((sum, result) => sum + result.confidence, 0) / matches.length : null,
      lowConfidenceCount: matches.filter(result => result.lowConfidence).length,
    };
  });
}

export function pascContractStamp() {
  return { contractVersion: PASC_CONTRACT_VERSION, targetSteps: PASC_TARGET_STEPS, experimentalMinimumSteps: PASC_EXPERIMENTAL_MIN_STEPS };
}


export type PascApplicabilityPresentation = {
  state: "full" | "limited_spatial" | "unsupported";
  eyebrow: string;
  line1: string;
  line2: string;
  evidence: string;
};

export function pascApplicabilityPresentation(
  spatial: PascSpatialApplicability,
): PascApplicabilityPresentation {
  if (spatial === "limited_reference") {
    return {
      state: "limited_spatial",
      eyebrow: "时序 / 物理识别结果",
      line1: "当前点在 500 米内缺少可用研究区邻点，",
      line2: "空间门控未启用，请结合人工判读。",
      evidence: "TCN 时间分支与运动学物理特征已经完成分类。上传研究区存在足够邻点时会自动建立无标签空间上下文；当前点不使用邻点标签，也不会拟合用户数据。",
    };
  }
  if (spatial === "full_reference") {
    return {
      state: "full",
      eyebrow: "空间上下文识别结果",
      line1: "当前点已获得同一研究区或冻结参考的邻域支持。",
      line2: "请结合置信度、时序曲线和现场资料综合判读。",
      evidence: "TCN 时间分支、运动学物理特征与无标签空间邻域共同参与；邻点标签没有进入推理。",
    };
  }
  return {
    state: "unsupported",
    eyebrow: "空间适用性未评估",
    line1: "当前结果缺少可核验的空间适用性证据。",
    line2: "请先完成数据兼容性检查并结合人工判读。",
    evidence: "未评估不等于适用于任意区域。",
  };
}
