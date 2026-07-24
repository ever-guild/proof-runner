PRAGMA foreign_keys = ON;

CREATE TABLE run_metadata (
  id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (contract_version = '1.0'),
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  repository_url TEXT NOT NULL,
  resolved_commit_sha TEXT NOT NULL,
  resolved_ref_json TEXT NOT NULL,
  skill_name TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  skill_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('QUEUED', 'RUNNING', 'COMPLETED', 'TIMEOUT', 'SYSTEM_ERROR')
  ),
  verdict TEXT CHECK (verdict IN ('PASS', 'FAIL', 'INCONCLUSIVE')),
  queue_sequence INTEGER NOT NULL,
  active_stage TEXT,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  UNIQUE (idempotency_scope, idempotency_key),
  UNIQUE (queue_sequence)
);

CREATE TABLE normalized_checks (
  run_id TEXT NOT NULL REFERENCES run_metadata(id) ON DELETE CASCADE,
  check_index INTEGER NOT NULL,
  check_id TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (
    stage IN ('REPOSITORY', 'SANDBOX', 'INSTALL', 'BUILD', 'TEST', 'RECEIPT')
  ),
  title TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'PENDING',
      'RUNNING',
      'PASSED',
      'FAILED',
      'SKIPPED',
      'INCONCLUSIVE'
    )
  ),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  summary TEXT NOT NULL,
  PRIMARY KEY (run_id, check_index),
  UNIQUE (run_id, check_id)
);

CREATE TABLE signed_receipts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES run_metadata(id) ON DELETE RESTRICT,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  key_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE raw_logs (
  run_id TEXT NOT NULL REFERENCES run_metadata(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  stream TEXT NOT NULL CHECK (stream IN ('stdout', 'stderr', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL CHECK (expires_at > created_at),
  PRIMARY KEY (run_id, sequence)
);

CREATE INDEX run_metadata_fifo_idx
  ON run_metadata(status, queue_sequence);
CREATE INDEX raw_logs_expiry_idx
  ON raw_logs(expires_at);
