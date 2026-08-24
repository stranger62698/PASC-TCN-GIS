import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectCsv, parseMappedCsv, type CsvMapping } from "../app/lib/insar-v2";
import { analyzePascDateColumns, parsePascDateHeader } from "../app/lib/pasc-schema";
import {
  PASC_AUTO_CLASSIFY_MAX_POINTS,
  PHASE_E_MAX_POINTS,
  PascProxyError,
  buildPascOnlineRequest,
  buildPascOnlineRequestBatches,
  filterPascOnlinePoints,
  mergePascOnlineResults,
  runPascOnlineProxy,
  toPascServicePayload,
  type PascOnlineResponse,
} from "../app/lib/pasc-online";
import type { InsarPoint } from "../app/data/site";
import {
  PASC_CLASSES,
  capabilityLevelFor,
  classifyEpochCount,
  normalizePascProbabilities,
  parsePascClass,
  winningPascClass,
} from "../app/lib/pasc";

const confirmed = {
  displacementUnit: "mm",
  velocityUnit: "mm/year",
  signConvention: "toward_satellite_positive",
  preprocessingState: "already_smoothed",
} as const;

test("six PASC classes and colors are frozen", () => {
  assert.deepEqual(PASC_CLASSES.map(item => [item.id, item.name, item.nameZh, item.color]), [
    [0, "Stable", "稳定型", "#76D65B"],
    [1, "Linear", "线性型", "#E69F00"],
    [2, "Piecewise", "分段型", "#0072B2"],
    [3, "Decelerating", "减速型", "#F0E442"],
    [4, "Accelerating", "加速型", "#D73027"],
    [5, "Undefined", "未定义型", "#4D4D4D"],
  ]);
  assert.equal(parsePascClass("Stepwise").definition, null);
  assert.equal(parsePascClass("Stepwise").legacy, true);
});

test("date formats parse, sort, and identify duplicate canonical dates", () => {
  assert.equal(parsePascDateHeader("D20250103")?.canonical, "2025-01-03");
  assert.equal(parsePascDateHeader("2025/1/3")?.canonical, "2025-01-03");
  assert.equal(parsePascDateHeader("2025-13-03"), null);
  const analysis = analyzePascDateColumns(["D20250103", "2024-12-22", "2025/01/03"], ["D20250103", "2024-12-22", "2025/01/03"]);
  assert.deepEqual(analysis.sorted.map(item => item.canonical), ["2024-12-22", "2025-01-03", "2025-01-03"]);
  assert.deepEqual(analysis.duplicateDates.map(item => item.canonical), ["2025-01-03"]);
});

test("39, 40, and 248 epoch boundaries remain explicit", () => {
  assert.deepEqual(classifyEpochCount(39), { epochStatus: "unsupported_39_or_less", temporalApplicability: "unsupported" });
  assert.deepEqual(classifyEpochCount(40), { epochStatus: "experimental_40_to_247", temporalApplicability: "experimental_adapted_to_248" });
  assert.deepEqual(classifyEpochCount(248), { epochStatus: "native_248", temporalApplicability: "native_248" });
  assert.equal(capabilityLevelFor({ validCoordinates: true, validEpochs: 39, hasVelocity: false }), 2);
  assert.equal(capabilityLevelFor({ validCoordinates: true, validEpochs: 40, hasVelocity: false }), 3);
});

test("probability contract normalizes and selects the maximum class", () => {
  const probabilities = normalizePascProbabilities({ Stable: 0.1, Linear: 0.1, Piecewise: 0.1, Decelerating: 0.1, Accelerating: 0.5, Undefined: 0.1 });
  assert.ok(probabilities);
  assert.equal(winningPascClass(probabilities!).name, "Accelerating");
  assert.equal(normalizePascProbabilities({ Stable: 2 }), null);
  assert.equal(capabilityLevelFor({ validCoordinates: true, validEpochs: 0, hasVelocity: false }), 1);
  assert.equal(capabilityLevelFor({ validCoordinates: false, validEpochs: 248, hasVelocity: true }), 0);
});

test("velocity is optional and calculated against real dates", () => {
  const csv = "fid,longitude,latitude,D20200101,D20210101\nP1,110.3,20.1,0,10";
  const inspection = inspectCsv(csv);
  const mapping: CsvMapping = { ...inspection.mapping, velocity: "", timeCols: ["D20200101", "D20210101"], ...confirmed };
  const result = parseMappedCsv(csv, "optional-velocity.csv", mapping);
  assert.equal(result.points[0].velocitySource, "calculated");
  assert.ok(result.points[0].velocity > 9.9 && result.points[0].velocity < 10.1);
  assert.equal(result.points[0].coherenceSource, "not_available");
  assert.equal(result.points[0].capabilityLevel, 2);
});

test("duplicate dates with conflicting row values fail closed", () => {
  const csv = "fid,longitude,latitude,D20200101,2020-01-01,D20210101\nP1,110.3,20.1,0,1,10";
  const inspection = inspectCsv(csv);
  const mapping: CsvMapping = { ...inspection.mapping, timeCols: ["D20200101", "2020-01-01", "D20210101"], ...confirmed };
  assert.throws(() => parseMappedCsv(csv, "duplicate.csv", mapping), /PASC_DUPLICATE_DATE_CONFLICT/);
});

test("legacy CSV keeps ordinary WebGIS behavior and flags Stepwise", () => {
  const csv = "FID,xpos,ypos,Vel,D20170322,D20170403,D20170415,Pattern\n1,110.3,20.1,-3,0,-1,-2,Stepwise\n2,110.4,20.2,-1,0,-0.2,-0.4,Stable";
  const inspection = inspectCsv(csv);
  const mapping: CsvMapping = { ...inspection.mapping, timeCols: ["D20170322", "D20170403", "D20170415"], ...confirmed };
  const result = parseMappedCsv(csv, "legacy.csv", mapping);
  assert.equal(result.points.length, 2);
  assert.equal(result.periods, 3);
  assert.equal(result.points[0].legacyMode, true);
  assert.match(result.points[0].mode, /Stepwise/);
  assert.equal(result.compatibility.temporalApplicability, "unsupported");
});

test("a generated 248-column row is native Level 3", () => {
  const dates = Array.from({ length: 248 }, (_, index) => {
    const date = new Date(Date.UTC(2017, 0, 1 + index * 12));
    return `D${date.toISOString().slice(0, 10).replaceAll("-", "")}`;
  });
  const csv = `fid,longitude,latitude,${dates.join(",")}\nN1,110.3,20.1,${dates.map((_, index) => index).join(",")}`;
  const inspection = inspectCsv(csv);
  const mapping: CsvMapping = { ...inspection.mapping, velocity: "", timeCols: dates, ...confirmed };
  const result = parseMappedCsv(csv, "native.csv", mapping);
  assert.equal(result.periods, 248);
  assert.equal(result.points[0].capabilityLevel, 3);
  assert.equal(result.compatibility.epochStatus, "native_248");
  assert.equal(result.compatibility.native248Points, 1);
});
test("away-from-satellite positive input is converted to model-native sign", () => {
  const csv = "fid,longitude,latitude,velocity,D20200101,D20210101\nP1,110.3,20.1,2,0,10";
  const inspection = inspectCsv(csv);
  const mapping: CsvMapping = {
    ...inspection.mapping,
    velocity: "velocity",
    timeCols: ["D20200101", "D20210101"],
    ...confirmed,
    signConvention: "away_from_satellite_positive",
  };
  const result = parseMappedCsv(csv, "away-positive.csv", mapping);
  assert.deepEqual(result.points[0].series, [0, -10]);
  assert.equal(result.points[0].velocity, -2);
});

const phaseEDates = Array.from({ length: 40 }, (_, index) => {
  const date = new Date(Date.UTC(2020, 0, 1 + index * 12));
  return date.toISOString().slice(0, 10);
});

function phaseEPoint(id: string, epochs = 40): InsarPoint {
  return {
    id,
    name: `监测点 ${id}`,
    lon: 110.3,
    lat: 20.1,
    velocity: -3,
    velocitySource: "provided",
    displacement: -(epochs - 1),
    coherence: 0.8,
    coherenceSource: "provided",
    missingRate: 0,
    mode: "未分类",
    updated: phaseEDates[Math.min(epochs, phaseEDates.length) - 1] ?? "—",
    series: Array.from({ length: epochs }, (_, index) => -index),
    dates: phaseEDates.slice(0, epochs),
    capabilityLevel: epochs >= 40 ? 3 : 2,
    effectiveEpochCount: epochs,
    temporalApplicability: epochs >= 40 ? "experimental_adapted_to_248" : "unsupported",
    spatialApplicability: "not_evaluated",
  };
}

test("Phase E request keeps ordinary WebGIS points below 40 out of inference", () => {
  const request = buildPascOnlineRequest(
    [phaseEPoint("eligible"), phaseEPoint("ordinary", 39)],
    "small.csv",
    "raw",
  );
  assert.deepEqual(request.points.map(point => point.pointId), ["eligible"]);
  assert.equal(request.preprocessingState, "raw");
  assert.throws(
    () => buildPascOnlineRequest(Array.from({ length: PHASE_E_MAX_POINTS + 1 }, (_, index) => phaseEPoint(String(index))), "large.csv", "raw"),
    /Phase F/,
  );
});

test("automatic CSV classification splits 3,000 eligible points into bounded requests", () => {
  const source = Array.from({ length: 3_000 }, (_, index) => phaseEPoint(`batch-${index}`));
  const requests = buildPascOnlineRequestBatches([...source, phaseEPoint("ordinary", 39)], "three-thousand.csv", "raw");
  assert.deepEqual(requests.map(request => request.points.length), [500, 500, 500, 500, 500, 500]);
  assert.deepEqual(requests.flatMap(request => request.points.map(point => point.pointId)), source.map(point => point.id));
  assert.throws(
    () => buildPascOnlineRequestBatches(Array.from({ length: PASC_AUTO_CLASSIFY_MAX_POINTS + 1 }, (_, index) => phaseEPoint(`too-large-${index}`)), "too-large.csv", "raw"),
    /Phase F/,
  );
});

test("production inference proxy is session-protected and keeps service configuration server-side", () => {
  const source = readFileSync("api/pasc/infer.ts", "utf8");
  assert.match(source, /getRequestUser\(request\.headers\.cookie\)/);
  assert.match(source, /process\.env\.PASC_SERVICE_BASE_URL/);
  assert.match(source, /process\.env\.PASC_SERVICE_API_KEY/);
  assert.doesNotMatch(source, /NEXT_PUBLIC|request\.body\.serviceBaseUrl|request\.body\.serviceApiKey/);
});

test("Phase E canonical points become the existing Python preprocess contract", () => {
  const request = buildPascOnlineRequest([phaseEPoint("P-1")], "small.csv", "already_smoothed");
  const payload = toPascServicePayload(request) as {
    mapping: { pointId: string; dateColumns: string[] };
    settings: { displacementUnit: string; velocityUnit: string; signConvention: string };
    records: Array<Record<string, string | number>>;
  };
  assert.equal(payload.mapping.pointId, "point_id");
  assert.equal(payload.mapping.dateColumns.length, 40);
  assert.deepEqual(payload.settings, {
    displacementUnit: "mm",
    velocityUnit: "mm/year",
    signConvention: "model_native",
    preprocessingState: "already_smoothed",
  });
  assert.equal(payload.records[0].point_id, "P-1");
  assert.equal(payload.records[0].D20200101, 0);
});

test("Phase E proxy uses only configured upstream and hides the service key", async () => {
  const request = { ...buildPascOnlineRequest([phaseEPoint("P-1")], "small.csv", "raw"), serviceBaseUrl: "https://attacker.invalid" };
  const calls: Array<{ url: string; authorization: string | null; body: string }> = [];
  const output = { contractVersion: "pasc-contract-v1", operation: "inference_only", points: [] };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const firstCall = calls.length === 0;
    calls.push({ url, authorization: headers.get("authorization"), body: String(init?.body ?? "") });
    return new Response(firstCall
      ? '{"operation":"preprocess_only","epsilon":1e-07,"integrity":{"signed":true}}'
      : JSON.stringify(output), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const secret = "service-api-key-0123456789abcdef";
  const result = await runPascOnlineProxy(request, {
    serviceBaseUrl: "https://pasc.internal/base/",
    serviceApiKey: secret,
    fetchImpl,
  });
  assert.deepEqual(calls.map(call => call.url), [
    "https://pasc.internal/base/v1/preprocess",
    "https://pasc.internal/base/v1/infer",
  ]);
  assert.equal(calls[0].authorization, null);
  assert.equal(calls[1].authorization, `Bearer ${secret}`);
  assert.match(calls[1].body, /"epsilon":1e-07/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("Phase E proxy preserves upstream machine errors and fails closed on configuration", async () => {
  const request = buildPascOnlineRequest([phaseEPoint("P-1")], "small.csv", "raw");
  const failingFetch: typeof fetch = async () => new Response(JSON.stringify({
    error: { code: "PASC_PREPROCESSING_STATE_REQUIRED", message: "必须确认数据状态。", details: {} },
  }), { status: 422, headers: { "content-type": "application/json" } });
  await assert.rejects(
    () => runPascOnlineProxy(request, {
      serviceBaseUrl: "https://pasc.internal/",
      serviceApiKey: "service-api-key-0123456789abcdef",
      fetchImpl: failingFetch,
    }),
    (error: unknown) => error instanceof PascProxyError && error.code === "PASC_PREPROCESSING_STATE_REQUIRED" && error.status === 422,
  );
  await assert.rejects(
    () => runPascOnlineProxy(request, { serviceBaseUrl: "", serviceApiKey: "" }),
    (error: unknown) => error instanceof PascProxyError && error.code === "PASC_PHASE_E_SERVICE_NOT_CONFIGURED" && error.status === 503,
  );
});

function phaseEResponse(): PascOnlineResponse {
  const probabilities = [0.7, 0.1, 0.05, 0.05, 0.05, 0.05];
  return {
    contractVersion: "pasc-contract-v1",
    modelVersion: "pasc-tcn-haikou-v1",
    serviceVersion: "0.3.0",
    operation: "inference_only",
    inferenceOnly: true,
    summary: { points: 1, predicted: 1, lowConfidence: 1, limitedReference: 1 },
    modelPackage: { buildHash: "build-hash", manifestSha256: "manifest-hash", assetSha256: {} },
    points: [{
      pointId: "P-1",
      status: "predicted",
      rawResult: { classId: 0, className: "Stable", classNameZh: "稳定型", probabilities },
      calibratedResult: { classId: 0, className: "Stable", classNameZh: "稳定型", probabilities },
      finalLabel: { classId: 0, className: "Stable", classNameZh: "稳定型", color: "#76D65B" },
      probabilities,
      confidence: 0.7,
      calibrationChanged: false,
      lowConfidence: true,
      spatialReliability: 0,
      spatialGateMean: 0,
      applicability: { temporal: "experimental_adapted_to_248", spatial: "limited_reference" },
      quality: {
        effectiveEpochs: 40,
        missingEpochs: 0,
        originalStart: phaseEDates[0],
        originalEnd: phaseEDates[39],
        originalSpanDays: 468,
        missingRate: 0,
        maximumGapDays: 12,
        adapterApplied: true,
        noiseResidualStd: 0.1,
        seriesMean: -19.5,
        seriesStd: 11.54,
        zscoreEpsilon: 0.00001,
      },
      sources: { velocity: "provided", coherence: "provided" },
      warnings: [{ code: "PASC_SPATIAL_REFERENCE_LIMITED", message: "空间适用性有限。" }],
    }],
    audit: {
      assetHashesVerified: true,
      referenceRows: 1036,
      device: "cpu",
      modelExecuted: true,
      userDataFit: false,
      trainingPathAvailable: false,
    },
  };
}

test("Phase E merge trusts calibrated service output and enables PASC filters", () => {
  const ordinary = phaseEPoint("ordinary", 39);
  const { points, response } = mergePascOnlineResults([phaseEPoint("P-1"), ordinary], phaseEResponse());
  assert.equal(response.summary.predicted, 1);
  assert.equal(points[0].modeCanonical, "Stable");
  assert.equal(points[0].mode, "稳定型");
  assert.equal(points[0].pasc?.probabilities.Stable, 0.7);
  assert.equal(points[0].spatialApplicability, "limited_reference");
  assert.equal(points[1], ordinary);
  assert.deepEqual(filterPascOnlinePoints(points, "lowConfidence").map(point => point.id), ["P-1"]);
  assert.deepEqual(filterPascOnlinePoints(points, "limitedReference").map(point => point.id), ["P-1"]);
});
test("Phase E synchronous small-data flow runs preprocess, infer, merge, and filter end to end", async () => {
  const sourcePoints = [phaseEPoint("P-1"), phaseEPoint("ordinary", 39)];
  const request = buildPascOnlineRequest(sourcePoints, "small.csv", "already_smoothed");
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input));
    const body = calls.length === 1
      ? { operation: "preprocess_only", integrity: { signed: true, signature: "service-owned" } }
      : phaseEResponse();
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  const inferred = await runPascOnlineProxy(request, {
    serviceBaseUrl: "https://pasc.internal/",
    serviceApiKey: "service-api-key-0123456789abcdef",
    fetchImpl,
  });
  const merged = mergePascOnlineResults(sourcePoints, inferred).points;
  assert.deepEqual(calls, ["https://pasc.internal/v1/preprocess", "https://pasc.internal/v1/infer"]);
  assert.equal(merged[0].pasc?.calibratedLabel, "Stable");
  assert.equal(merged[1], sourcePoints[1]);
  assert.deepEqual(filterPascOnlinePoints(merged, "limitedReference").map(point => point.id), ["P-1"]);
});
