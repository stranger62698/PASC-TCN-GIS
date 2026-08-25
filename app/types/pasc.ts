export const PASC_CONTRACT_VERSION = "pasc-contract-v1" as const;
export const PASC_MODEL_VERSION = "pasc-tcn-haikou-v1" as const;

export type PascContractVersion = typeof PASC_CONTRACT_VERSION;
export type PascModelVersion = typeof PASC_MODEL_VERSION;
export type PascClassId = 0 | 1 | 2 | 3 | 4 | 5;
export type PascClassName =
  | "Stable"
  | "Linear"
  | "Piecewise"
  | "Decelerating"
  | "Accelerating"
  | "Undefined";
export type PascClassNameZh = "稳定型" | "线性型" | "分段型" | "减速型" | "加速型" | "未定义型";

export type PascClassDefinition = {
  id: PascClassId;
  name: PascClassName;
  nameZh: PascClassNameZh;
  color: string;
};

export type PascValueSource = "provided" | "calculated" | "default" | "not_available";
export type PascCapabilityLevel = 0 | 1 | 2 | 3;
export type PascTemporalApplicability =
  | "native_248"
  | "adapted_to_248"
  | "experimental_adapted_to_248"
  | "unsupported";
export type PascSpatialApplicability = "full_reference" | "limited_reference" | "not_evaluated";
export type PascPreprocessingState = "raw" | "already_smoothed" | "unknown";
export type PascEpochStatus = "unsupported_19_or_less" | "experimental_20_to_247" | "native_248" | "adapted_over_248";
export type PascProbabilitySet = Record<PascClassName, number>;

export type PascPointQuality = {
  originalEpochCount: number;
  adaptedEpochCount: number | null;
  startDate: string | null;
  endDate: string | null;
  spanDays: number | null;
  missingRate: number;
  minimumGapDays: number | null;
  maximumGapDays: number | null;
  medianGapDays: number | null;
  seriesMean: number | null;
  seriesStd: number | null;
  noiseResidualStd: number | null;
  zscoreEpsilon: 0.00001;
};

export type PascPointResult = {
  contractVersion: PascContractVersion;
  modelVersion: PascModelVersion;
  pointId: string;
  rawLabelId: PascClassId | null;
  rawLabel: PascClassName | null;
  calibratedLabelId: PascClassId;
  calibratedLabel: PascClassName;
  probabilities: PascProbabilitySet;
  confidence: number;
  calibrationChanged: boolean | null;
  lowConfidence: boolean;
  spatialReliability: number;
  spatialGateMean: number;
  temporalApplicability: PascTemporalApplicability;
  spatialApplicability: PascSpatialApplicability;
  quality: PascPointQuality;
  velocitySource: PascValueSource;
  coherenceSource: PascValueSource;
  warnings: string[];
};

export type PascCompatibilityIssue = {
  code:
    | "PASC_SCHEMA_UNRESOLVED"
    | "PASC_DATE_PARSE_FAILED"
    | "PASC_DUPLICATE_DATE_CONFLICT"
    | "PASC_UNIT_CONFIRMATION_REQUIRED"
    | "PASC_SIGN_CONFIRMATION_REQUIRED"
    | "PASC_PREPROCESSING_STATE_REQUIRED"
    | "PASC_TOO_FEW_VALID_EPOCHS"
    | "PASC_LEGACY_STEPWISE_CONFIRMATION_REQUIRED";
  severity: "error" | "warning" | "confirmation";
  message: string;
  field?: string;
};

export type PascCompatibilitySummary = {
  contractVersion: PascContractVersion;
  capabilityLevel: PascCapabilityLevel;
  epochStatus: PascEpochStatus;
  temporalApplicability: PascTemporalApplicability;
  spatialApplicability: PascSpatialApplicability;
  totalPoints: number;
  pascCandidatePoints: number;
  unsupportedPoints: number;
  minEffectiveEpochs: number;
  maxEffectiveEpochs: number;
  native248Points: number;
  experimentalPoints: number;
  invalidDateColumns: string[];
  duplicateDates: string[];
  velocitySources: Record<PascValueSource, number>;
  coherenceSources: Record<PascValueSource, number>;
  issues: PascCompatibilityIssue[];
};

export type PascRegionClassStat = PascClassDefinition & {
  count: number;
  percentage: number;
  averageConfidence: number | null;
  lowConfidenceCount: number;
};
