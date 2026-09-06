export const PASC_LOCAL_MODEL_URL = "/__pasc-local/pasc-tcn.onnx";
export const PASC_LOCAL_FIXTURE_URL = "/__pasc-local/fixture.json";

export type PascLocalBaseSample = {
  pointId: string;
  referenceSource: string;
  inputs: {
    series: number[];
    physics: number[];
    neighborSeries: number[];
    neighborPhysics: number[];
    neighborWeights: number[];
    reliability: number;
  };
  expected: {
    logits: number[];
    physicsLogits: number[];
    rawProbabilities: number[];
    rawClassId: number;
    calibratedProbabilities: number[];
    classId: number;
    confidence: number;
    spatialGateMean: number;
  };
};

export type PascLocalFixture = {
  schemaVersion: "pasc-browser-parity-v1";
  contractVersion: string;
  modelVersion: string;
  bundleBuildHash: string;
  checkpointSha256: string;
  modelSha256: string;
  classOrder: string[];
  calibration: { dynamicClassIds: number[]; multiplier: number };
  inputShape: { timeSteps: number; physicsFeatures: number; neighbors: number };
  prototypeCounts: number[];
  batchSize: number;
  tolerances: { logitMaxAbsDiff: number; probabilityMaxAbsDiff: number };
  baseSamples: PascLocalBaseSample[];
};

export type PascLocalParityResult = {
  count: number;
  elapsedMs: number;
  classMatches: number;
  classAgreementRate: number;
  logitMaxAbsDiff: number;
  logitMeanAbsDiff: number;
  probabilityMaxAbsDiff: number;
  probabilityMeanAbsDiff: number;
  confidenceMaxAbsDiff: number;
  mismatches: string[];
  passed: boolean;
};

export function stableSoftmaxRow(logits: ArrayLike<number>): Float32Array {
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < logits.length; index += 1) {
    maximum = Math.max(maximum, Number(logits[index]));
  }
  const output = new Float32Array(logits.length);
  let total = 0;
  for (let index = 0; index < logits.length; index += 1) {
    const value = Math.exp(Number(logits[index]) - maximum);
    output[index] = value;
    total += output[index];
  }
  for (let index = 0; index < output.length; index += 1) {
    output[index] /= total;
  }
  return output;
}

export function calibratePascProbabilities(
  probabilities: ArrayLike<number>,
  dynamicClassIds: number[],
  multiplier: number,
): Float32Array {
  const output = Float32Array.from(probabilities);
  for (const classId of dynamicClassIds) output[classId] *= multiplier;
  let total = 0;
  for (const value of output) total += value;
  for (let index = 0; index < output.length; index += 1) output[index] /= total;
  return output;
}

export function maximumIndex(values: ArrayLike<number>): number {
  let bestIndex = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Number(values[index]) > Number(values[bestIndex])) bestIndex = index;
  }
  return bestIndex;
}

export function validatePascLocalFixture(value: unknown): PascLocalFixture {
  if (!value || typeof value !== "object") throw new Error("本地验证 fixture 无效。");
  const fixture = value as Partial<PascLocalFixture>;
  if (
    fixture.schemaVersion !== "pasc-browser-parity-v1"
    || fixture.contractVersion !== "pasc-contract-v1"
    || fixture.modelVersion !== "pasc-tcn-haikou-v1"
    || !Array.isArray(fixture.baseSamples)
    || fixture.baseSamples.length !== 3
    || !Array.isArray(fixture.prototypeCounts)
    || fixture.prototypeCounts.join(",") !== "1,10,100,1000"
    || fixture.inputShape?.timeSteps !== 248
    || fixture.inputShape.physicsFeatures !== 13
    || fixture.inputShape.neighbors !== 8
    || fixture.classOrder?.join(",") !== "Stable,Linear,Piecewise,Decelerating,Accelerating,Undefined"
    || !fixture.calibration
    || fixture.calibration.dynamicClassIds?.join(",") !== "2,3,4"
    || fixture.calibration.multiplier !== 1.35
    || !fixture.tolerances
    || typeof fixture.batchSize !== "number"
    || fixture.batchSize < 1
  ) {
    throw new Error("本地验证 fixture 与冻结 PASC 契约不一致。");
  }
  return fixture as PascLocalFixture;
}
