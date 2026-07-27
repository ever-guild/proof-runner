CREATE TABLE reproducibility_jobs (
  id TEXT PRIMARY KEY,
  contract_version TEXT NOT NULL CHECK (contract_version = '1.0'),
  idempotency_scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  request_json TEXT NOT NULL,
  baseline_run_id TEXT NOT NULL UNIQUE
    REFERENCES run_metadata(id) ON DELETE RESTRICT,
  candidate_run_id TEXT NOT NULL UNIQUE
    REFERENCES run_metadata(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  UNIQUE (idempotency_scope, idempotency_key)
);

CREATE INDEX reproducibility_jobs_children_idx
  ON reproducibility_jobs(baseline_run_id, candidate_run_id);
