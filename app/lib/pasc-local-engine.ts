import * as ort from "onnxruntime-web/webgpu";

import {
  PASC_LOCAL_FIXTURE_URL,
  PASC_LOCAL_MODEL_URL,
  calibratePascProbabilities,
  maximumIndex,
  stableSoftmaxRow,
  validatePascLocalFixture,
  type PascLocalFixture,
  type PascLocalParityResult,
} from "./pasc-local-onnx";

export type PascLocalProvider = "webgpu" | "wasm";
export type PascLocalEngine = {
  session: ort.InferenceSession;
  provider: PascLocalProvider;
  fixture: PascLocalFixture;
  sessionCreateCount: number;
};

let enginePromise: Promise<PascLocalEngine> | null = null;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function loadLocalAssets() {
  const [modelResponse, fixtureResponse] = await Promise.all([
    fetch(PASC_LOCAL_MODEL_URL, { cache: "no-store" }),
    fetch(PASC_LOCAL_FIXTURE_URL, { cache: "no-store" }),
  ]);
  if (!modelResponse.ok || !fixtureResponse.ok) {
    throw new Error("Phase 2 本地模型或验证 fixture 不可用。");
  }
  const [modelBuffer, fixtureValue] = await Promise.all([
    modelResponse.arrayBuffer(),
    fixtureResponse.json(),
  ]);
  return {
    modelBytes: new Uint8Array(modelBuffer),
    fixture: validatePascLocalFixture(fixtureValue),
  };
}

function fillRows(
  fixture: PascLocalFixture,
  offset: number,
  count: number,
  size: number,
  select: (sample: PascLocalFixture["baseSamples"][number]) => number[],
) {
  const values = new Float32Array(count * size);
  for (let row = 0; row < count; row += 1) {
    const sample = fixture.baseSamples[(offset + row) % fixture.baseSamples.length];
    values.set(select(sample), row * size);
  }
  return values;
}

function buildFeeds(fixture: PascLocalFixture, offset: number, count: number) {
  const { timeSteps, physicsFeatures, neighbors } = fixture.inputShape;
  const series = fillRows(fixture, offset, count, timeSteps, sample => sample.inputs.series);
  const physics = fillRows(fixture, offset, count, physicsFeatures, sample => sample.inputs.physics);
  const neighborSeries = fillRows(
    fixture,
    offset,
    count,
    neighbors * timeSteps,
    sample => sample.inputs.neighborSeries,
  );
  const neighborPhysics = fillRows(
    fixture,
    offset,
    count,
    neighbors * physicsFeatures,
    sample => sample.inputs.neighborPhysics,
  );
  const neighborWeights = fillRows(
    fixture,
    offset,
    count,
    neighbors,
    sample => sample.inputs.neighborWeights,
  );
  const reliability = new Float32Array(count);
  for (let row = 0; row < count; row += 1) {
    reliability[row] = fixture.baseSamples[
      (offset + row) % fixture.baseSamples.length
    ].inputs.reliability;
  }
  return {
    series: new ort.Tensor("float32", series, [count, 1, timeSteps]),
    physics: new ort.Tensor("float32", physics, [count, physicsFeatures]),
    neighbor_series: new ort.Tensor(
      "float32",
      neighborSeries,
      [count, neighbors, 1, timeSteps],
    ),
    neighbor_physics: new ort.Tensor(
      "float32",
      neighborPhysics,
      [count, neighbors, physicsFeatures],
    ),
    neighbor_weights: new ort.Tensor("float32", neighborWeights, [count, neighbors]),
    reliability: new ort.Tensor("float32", reliability, [count]),
  };
}

async function runBatch(
  session: ort.InferenceSession,
  fixture: PascLocalFixture,
  offset: number,
  count: number,
) {
  const outputs = await session.run(buildFeeds(fixture, offset, count));
  if (!outputs.logits || !outputs.spatial_gate_mean) {
    throw new Error("ONNX 输出契约不完整。");
  }
  return {
    logits: outputs.logits.data as Float32Array,
    gateMeans: outputs.spatial_gate_mean.data as Float32Array,
  };
}

async function createAndWarmSession(
  provider: PascLocalProvider,
  modelBytes: Uint8Array,
  fixture: PascLocalFixture,
) {
  const session = await ort.InferenceSession.create(modelBytes.slice(), {
    executionProviders: [provider],
    graphOptimizationLevel: "all",
  });
  try {
    await runBatch(session, fixture, 0, 1);
    return session;
  } catch (error) {
    await session.release();
    throw error;
  }
}

export async function initializePascLocalEngine(): Promise<PascLocalEngine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    ort.env.logLevel = "warning";
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const { modelBytes, fixture } = await loadLocalAssets();
    const forceWasm = new URLSearchParams(window.location.search).get("pascEp") === "wasm";
    const hasWebGpu = !forceWasm
      && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);
    if (forceWasm) console.debug("[PASC local] forced WASM fallback validation");
    if (hasWebGpu) {
      try {
        const session = await createAndWarmSession(
          "webgpu",
          modelBytes,
          fixture,
        );
        console.debug("[PASC local] execution provider: webgpu");
        return { session, provider: "webgpu", fixture, sessionCreateCount: 1 };
      } catch (error) {
        console.debug(
          "[PASC local] WebGPU unavailable for this model; falling back to WASM.",
          errorMessage(error),
        );
      }
    }
    const session = await createAndWarmSession("wasm", modelBytes, fixture);
    console.debug("[PASC local] execution provider: wasm");
    return { session, provider: "wasm", fixture, sessionCreateCount: 1 };
  })();
  try {
    return await enginePromise;
  } catch (error) {
    enginePromise = null;
    throw error;
  }
}

export async function validatePascLocalCount(
  engine: PascLocalEngine,
  count: number,
): Promise<PascLocalParityResult> {
  const { fixture, session } = engine;
  if (!fixture.prototypeCounts.includes(count)) {
    throw new Error(`Phase 2 不支持 ${count} 条验证。`);
  }
  let logitMaximum = 0;
  let logitTotal = 0;
  let logitValues = 0;
  let probabilityMaximum = 0;
  let probabilityTotal = 0;
  let probabilityValues = 0;
  let confidenceMaximum = 0;
  let classMatches = 0;
  const mismatches: string[] = [];
  const startedAt = performance.now();

  for (let offset = 0; offset < count; offset += fixture.batchSize) {
    const batchCount = Math.min(fixture.batchSize, count - offset);
    const outputs = await runBatch(session, fixture, offset, batchCount);
    for (let row = 0; row < batchCount; row += 1) {
      const sample = fixture.baseSamples[(offset + row) % fixture.baseSamples.length];
      const logits = outputs.logits.subarray(row * 6, row * 6 + 6);
      const raw = stableSoftmaxRow(logits);
      const calibrated = calibratePascProbabilities(
        raw,
        fixture.calibration.dynamicClassIds,
        fixture.calibration.multiplier,
      );
      const classId = maximumIndex(calibrated);
      const confidence = Number(calibrated[classId]);
      if (classId === sample.expected.classId) classMatches += 1;
      else if (mismatches.length < 20) mismatches.push(`${offset + row}:${sample.pointId}`);
      confidenceMaximum = Math.max(
        confidenceMaximum,
        Math.abs(confidence - sample.expected.confidence),
      );
      for (let classIndex = 0; classIndex < 6; classIndex += 1) {
        const logitDifference = Math.abs(
          Number(logits[classIndex]) - sample.expected.logits[classIndex],
        );
        logitMaximum = Math.max(logitMaximum, logitDifference);
        logitTotal += logitDifference;
        logitValues += 1;
        const probabilityDifference = Math.abs(
          Number(calibrated[classIndex])
          - sample.expected.calibratedProbabilities[classIndex],
        );
        probabilityMaximum = Math.max(probabilityMaximum, probabilityDifference);
        probabilityTotal += probabilityDifference;
        probabilityValues += 1;
      }
    }
  }

  return {
    count,
    elapsedMs: performance.now() - startedAt,
    classMatches,
    classAgreementRate: classMatches / count,
    logitMaxAbsDiff: logitMaximum,
    logitMeanAbsDiff: logitTotal / logitValues,
    probabilityMaxAbsDiff: probabilityMaximum,
    probabilityMeanAbsDiff: probabilityTotal / probabilityValues,
    confidenceMaxAbsDiff: confidenceMaximum,
    mismatches,
    passed: classMatches === count
      && logitMaximum <= fixture.tolerances.logitMaxAbsDiff
      && probabilityMaximum <= fixture.tolerances.probabilityMaxAbsDiff,
  };
}
