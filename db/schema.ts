// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const datasets = sqliteTable("datasets", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  sourceKey: text("source_key").notNull(),
  optimizedKey: text("optimized_key"),
  status: text("status").notNull().default("uploaded"),
  pointCount: integer("point_count").notNull().default(0),
  fieldCount: integer("field_count").notNull().default(0),
  minLon: real("min_lon"), maxLon: real("max_lon"), minLat: real("min_lat"), maxLat: real("max_lat"),
  schemaJson: text("schema_json"),
  createdAt: integer("created_at").notNull(),
});

export const uploadSessions = sqliteTable("upload_sessions", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  objectKey: text("object_key").notNull(),
  r2UploadId: text("r2_upload_id").notNull(),
  filename: text("filename").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  createdAt: integer("created_at").notNull(),
});
export const pascJobs = sqliteTable("pasc_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  datasetId: text("dataset_id").notNull().references(() => datasets.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  contractVersion: text("contract_version").notNull(),
  modelVersion: text("model_version").notNull(),
  webgisVersion: text("webgis_version").notNull(),
  serviceVersion: text("service_version"),
  status: text("status").notNull().default("queued"),
  stage: text("stage").notNull().default("queued"),
  progress: real("progress").notNull().default(0),
  totalPoints: integer("total_points").notNull().default(0),
  processedPoints: integer("processed_points").notNull().default(0),
  predictedPoints: integer("predicted_points").notNull().default(0),
  unsupportedPoints: integer("unsupported_points").notNull().default(0),
  chunkSize: integer("chunk_size").notNull().default(256),
  currentChunk: integer("current_chunk").notNull().default(0),
  totalChunks: integer("total_chunks").notNull().default(0),
  attemptCount: integer("attempt_count").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  nextAttemptAt: integer("next_attempt_at"),
  leaseToken: text("lease_token"),
  leaseExpiresAt: integer("lease_expires_at"),
  workerId: text("worker_id"),
  cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
  requestJson: text("request_json").notNull(),
  summaryJson: text("summary_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
}, table => [
  uniqueIndex("idx_pasc_jobs_owner_idempotency").on(table.ownerId, table.idempotencyKey),
  index("idx_pasc_jobs_owner_created").on(table.ownerId, table.createdAt),
  index("idx_pasc_jobs_status_lease").on(table.status, table.nextAttemptAt, table.leaseExpiresAt),
  index("idx_pasc_jobs_dataset_created").on(table.datasetId, table.createdAt),
]);

export const pascJobEvents = sqliteTable("pasc_job_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: text("job_id").notNull().references(() => pascJobs.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  eventType: text("event_type").notNull(),
  status: text("status").notNull(),
  progress: real("progress").notNull().default(0),
  message: text("message").notNull(),
  dataJson: text("data_json"),
  createdAt: integer("created_at").notNull(),
}, table => [
  index("idx_pasc_job_events_job_created").on(table.jobId, table.createdAt),
  index("idx_pasc_job_events_owner_created").on(table.ownerId, table.createdAt),
]);

export const pascArtifacts = sqliteTable("pasc_artifacts", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => pascJobs.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  chunkIndex: integer("chunk_index").notNull().default(-1),
  attempt: integer("attempt").notNull().default(1),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  createdAt: integer("created_at").notNull(),
}, table => [
  uniqueIndex("idx_pasc_artifacts_job_kind_chunk_attempt").on(table.jobId, table.kind, table.chunkIndex, table.attempt),
  index("idx_pasc_artifacts_owner_job").on(table.ownerId, table.jobId),
]);

export const modelVersions = sqliteTable("model_versions", {
  modelVersion: text("model_version").primaryKey(),
  contractVersion: text("contract_version").notNull(),
  serviceVersion: text("service_version").notNull(),
  buildHash: text("build_hash").notNull(),
  manifestSha256: text("manifest_sha256").notNull(),
  assetSha256Json: text("asset_sha256_json").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
});
