CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_key TEXT NOT NULL,
  optimized_key TEXT,
  status TEXT NOT NULL DEFAULT 'uploaded',
  point_count INTEGER NOT NULL DEFAULT 0,
  field_count INTEGER NOT NULL DEFAULT 0,
  min_lon REAL,
  max_lon REAL,
  min_lat REAL,
  max_lat REAL,
  schema_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS datasets_owner_idx ON datasets(owner_id, created_at);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
