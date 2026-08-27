import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  PASC_JOB_MAP_LIMITS,
  artifactObjectKey,
  clampJobProgress,
  mapArtifactKindForZoom,
  nextFailureState,
  pascJobView,
  type PascJobRow,
} from "../app/lib/pasc-jobs";
import { parsePascMapPreview, pascMapLevelForZoom } from "../app/lib/pasc-job-client";
import { buildPascDurableRequestBatches } from "../app/lib/pasc-large";

function jobRow(): PascJobRow {
  return {
    id: "job-1",
    owner_id: "owner/private",
    dataset_id: "dataset-1",
    dataset_name: "large.csv",
    idempotency_key: "idempotency-123456",
    contract_version: "pasc-contract-v1",
    model_version: "pasc-tcn-haikou-v1",
    webgis_version: "0.1.0-phase-f",
    service_version: null,
    status: "running",
    stage: "inference",
    progress: 45,
    total_points: 10000,
    processed_points: 4500,
    predicted_points: 4400,
    unsupported_points: 100,
    chunk_size: 256,
    current_chunk: 18,
    total_chunks: 40,
    attempt_count: 1,
    max_attempts: 3,
    next_attempt_at: null,
    lease_token: "private-lease-token",
    lease_expires_at: Date.now() + 1000,
    worker_id: "consumer-1",
    cancel_requested: 0,
    request_json: JSON.stringify({ datasetName: "large.csv", mapping: { secretField: "x" } }),
    summary_json: null,
    error_code: null,
    error_message: null,
    created_at: Date.UTC(2026, 7, 24),
    updated_at: Date.UTC(2026, 7, 24, 1),
    started_at: Date.UTC(2026, 7, 24, 0, 1),
    completed_at: null,
  };
}

test("Phase F progress is monotonic and terminal completion reaches 100", () => {
  assert.equal(clampJobProgress(45, 12), 45);
  assert.equal(clampJobProgress(45, 150), 99.5);
  assert.equal(clampJobProgress(45, Number.NaN), 45);
  assert.equal(clampJobProgress(45, 45, true), 100);
});

test("Phase F retry policy is bounded, exponential, and cancellation wins", () => {
  assert.deepEqual(nextFailureState(1, 3, true, false), { status: "retry_wait", delayMs: 30000 });
  assert.deepEqual(nextFailureState(2, 3, true, false), { status: "retry_wait", delayMs: 60000 });
  assert.deepEqual(nextFailureState(3, 3, true, false), { status: "failed", delayMs: 0 });
  assert.deepEqual(nextFailureState(1, 3, false, false), { status: "failed", delayMs: 0 });
  assert.deepEqual(nextFailureState(1, 3, true, true), { status: "cancelled", delayMs: 0 });
});

test("Phase F R2 artifact keys are owner, job, attempt, kind, and chunk scoped", () => {
  const first = artifactObjectKey("owner/private", "job-1", 1, "predictions", 7);
  const retry = artifactObjectKey("owner/private", "job-1", 2, "predictions", 7);
  assert.equal(first, "jobs/owner_private/job-1/attempt-1/predictions-chunk-000007.ndjson.gz");
  assert.notEqual(first, retry);
  assert.equal(artifactObjectKey("owner/private", "job-1", 1, "summary"), "jobs/owner_private/job-1/attempt-1/summary.json");
});

test("Phase F result map selects deterministic multilevel samples and never all points", () => {
  assert.equal(mapArtifactKindForZoom(8), "map_level_0");
  assert.equal(mapArtifactKindForZoom(11), "map_level_1");
  assert.equal(mapArtifactKindForZoom(14), "map_level_2");
  assert.deepEqual(PASC_JOB_MAP_LIMITS, { overview: 500, regional: 2000, detail: 5000 });
  assert.ok(PASC_JOB_MAP_LIMITS.detail < 755780);
});

test("Phase F public job view omits lease, worker, idempotency, and mapping secrets", () => {
  const view = pascJobView(jobRow()) as Record<string, unknown>;
  const serialized = JSON.stringify(view);
  assert.equal(view.jobId, "job-1");
  assert.equal((view.points as { processed: number }).processed, 4500);
  assert.equal(serialized.includes("private-lease-token"), false);
  assert.equal(serialized.includes("consumer-1"), false);
  assert.equal(serialized.includes("idempotency-123456"), false);
  assert.equal(serialized.includes("secretField"), false);
});

test("Phase F client validates and converts a bounded map preview", () => {
  const preview = parsePascMapPreview({
    contractVersion: "pasc-contract-v1",
    modelVersion: "pasc-tcn-haikou-v1",
    jobId: "job-1",
    strategy: "deterministic_multilevel_decimation",
    returnedPoints: 1,
    totalPredictedPoints: 755780,
    points: [{
      pointId: "P-1", longitude: 110.3, latitude: 20.1,
      finalLabel: { classId: 0, className: "Stable", classNameZh: "稳定型", color: "#76D65B" },
      probabilities: [0.7, 0.1, 0.05, 0.05, 0.05, 0.05], confidence: 0.7, lowConfidence: false,
      spatialReliability: 0.8, spatialGateMean: 0.2, calibrationChanged: false,
      applicability: { temporal: "experimental_adapted_to_248", spatial: "full_reference" },
      sources: { velocity: "calculated", coherence: "default" }, warnings: [],
      quality: { effectiveEpochs: 40, adapterApplied: true, originalStart: "2020-01-01", originalEnd: "2021-01-01", originalSpanDays: 366, missingRate: 0, maximumGapDays: 12, seriesMean: -2, seriesStd: 1, noiseResidualStd: null },
    }],
  });
  assert.equal(preview.points.length, 1);
  assert.equal(preview.points[0].mode, "稳定型");
  assert.equal(preview.points[0].pasc?.probabilities.Stable, 0.7);
  assert.equal(preview.totalPredictedPoints, 755780);
  assert.equal(pascMapLevelForZoom(9), "map_level_0");
  assert.equal(pascMapLevelForZoom(11), "map_level_1");
  assert.equal(pascMapLevelForZoom(13), "map_level_2");
  assert.throws(() => parsePascMapPreview({ contractVersion: "bad", points: [] }));
});
test("Large InSAR classification splits 21,610 candidates into safe bounded batches", () => {
  const dates = Array.from({ length: 46 }, (_, index) => `2020-01-${String(index % 28 + 1).padStart(2, "0")}`);
  const points = Array.from({ length: 21610 }, (_, index) => ({
    id: `P-${index + 1}`, name: `Point ${index + 1}`, lon: 110 + index / 1_000_000, lat: 20,
    velocity: 0, velocitySource: "calculated" as const, displacement: 0, coherence: 0,
    coherenceSource: "not_available" as const, missingRate: 0, mode: "未分类", modeSource: "",
    modeConfidence: null, updated: dates.at(-1) || "", series: dates.map(() => 0), dates,
    effectiveEpochCount: 46, temporalApplicability: "experimental_adapted_to_248" as const,
    spatialApplicability: "not_evaluated" as const, warnings: [],
  }));
  const batches = buildPascDurableRequestBatches(points, "21610.csv", "raw");
  assert.equal(batches.length, 217);
  assert.equal(batches[0].points.length, 100);
  assert.equal(batches.at(-1)?.points.length, 10);
  assert.equal(batches.reduce((sum, batch) => sum + batch.points.length, 0), 21610);
  assert.ok(batches.every(batch => batch.points.length <= 100));
});
test("Phase F static integration keeps owner isolation, consumer auth, and bounded previews", () => {
  const schema = readFileSync("db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0002_pasc_jobs.sql", "utf8");
  const routes = readFileSync("app/lib/pasc-job-routes.ts", "utf8");
  const panel = readFileSync("app/components/PascJobPanel.tsx", "utf8");
  const workspace = readFileSync("app/components/MapWorkspace.tsx", "utf8");
  const consumer = readFileSync("pasc-tcn-service/src/pasc_tcn_service/job_consumer.py", "utf8");
  const largeApi = readFileSync("api/pasc-jobs.ts", "utf8");
  const largeWorker = readFileSync("api/pasc-large-worker.ts", "utf8");
  const largeCore = readFileSync("server/pasc-large-jobs.ts", "utf8");
  const largeBatching = readFileSync("app/lib/pasc-large.ts", "utf8");
  const datasetPage = readFileSync("app/components/DatasetPage.tsx", "utf8");
  const staticEntry = readFileSync("static-src/main.tsx", "utf8");
  const vercel = readFileSync("vercel.json", "utf8");
  for (const table of ["pasc_jobs", "pasc_job_events", "pasc_artifacts", "model_versions"]) {
    assert.match(schema, new RegExp(`\\b${table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}\\b`));
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.match(routes, /getChatGPTUser\(\)/);
  assert.match(routes, /PASC_CONSUMER_API_KEY/);
  assert.match(routes, /owner_id = \?/);
  assert.doesNotMatch(panel, /leaseToken|consumerApiKey|idempotencyKey/);
  assert.match(panel, /取消任务/);
  assert.match(panel, /加载完整分类地图/);
  assert.match(workspace, /parsePascMapPreview/);
  assert.match(workspace, /map\?zoom=/);
  assert.match(consumer, /MAX_MAP_POINTS = 5000/);
  assert.match(consumer, /path\.startswith\("\/v1\/internal\/jobs\/"\)/);
  assert.doesNotMatch(consumer, /optimizer|\.backward\(|\.fit\(|requests\.get\(.*url/);
  assert.match(largeApi, /getRequestUser/);
  assert.match(largeApi, /publicPascLargeJob/);
  assert.match(largeWorker, /handleNodeCallback/);
  assert.match(largeWorker, /PASC_LARGE_MAX_ATTEMPTS/);
  assert.match(largeCore, /users\/\$\{identifier\(ownerId/);
  assert.match(largeCore, /results\/\$\{index\}\.json/);
  assert.match(largeCore, /PASC_QUEUE_UNAVAILABLE/);
  assert.match(largeBatching, /from "\.\/pasc-online\.js"/);
  assert.match(largeBatching, /from "\.\/pasc\.js"/);
  assert.match(datasetPage, /createAutomaticClassification\(datasetId\)/);
  assert.match(datasetPage, /查看实时分类进度/);
  assert.match(staticEntry, /\.\.\/app\/pasc\.css/);
  assert.doesNotMatch(panel, /PASC_SERVICE_API_KEY|ownerId|batchSummaries/);
  assert.match(vercel, /queue\/v2beta/);
  assert.match(vercel, /pasc-large-jobs/);
});
