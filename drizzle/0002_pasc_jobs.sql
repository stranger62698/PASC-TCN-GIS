CREATE TABLE IF NOT EXISTS model_versions (
  model_version TEXT PRIMARY KEY NOT NULL,
  contract_version TEXT NOT NULL,
  service_version TEXT NOT NULL,
  build_hash TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  asset_sha256_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pasc_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  webgis_version TEXT NOT NULL,
  service_version TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  processed_points INTEGER NOT NULL DEFAULT 0,
  predicted_points INTEGER NOT NULL DEFAULT 0,
  unsupported_points INTEGER NOT NULL DEFAULT 0,
  chunk_size INTEGER NOT NULL DEFAULT 256,
  current_chunk INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at INTEGER,
  lease_token TEXT,
  lease_expires_at INTEGER,
  worker_id TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  request_json TEXT NOT NULL,
  summary_json TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pasc_jobs_owner_idempotency ON pasc_jobs(owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_pasc_jobs_owner_created ON pasc_jobs(owner_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pasc_jobs_status_lease ON pasc_jobs(status, next_attempt_at, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_pasc_jobs_dataset_created ON pasc_jobs(dataset_id, created_at);

CREATE TABLE IF NOT EXISTS pasc_job_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  job_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  data_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES pasc_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pasc_job_events_job_created ON pasc_job_events(job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pasc_job_events_owner_created ON pasc_job_events(owner_id, created_at);

CREATE TABLE IF NOT EXISTS pasc_artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT -1,
  attempt INTEGER NOT NULL DEFAULT 1,
  object_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES pasc_jobs(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pasc_artifacts_job_kind_chunk_attempt ON pasc_artifacts(job_id, kind, chunk_index, attempt);
CREATE INDEX IF NOT EXISTS idx_pasc_artifacts_owner_job ON pasc_artifacts(owner_id, job_id);
