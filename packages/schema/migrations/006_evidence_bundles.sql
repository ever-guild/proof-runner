CREATE TABLE IF NOT EXISTS raw_log_metadata (
  run_id TEXT PRIMARY KEY REFERENCES run_metadata(id) ON DELETE CASCADE,
  retention_expires_at TEXT NOT NULL
);

INSERT INTO raw_log_metadata (run_id, retention_expires_at)
SELECT run_id, MAX(expires_at)
FROM raw_logs
GROUP BY run_id
ON CONFLICT(run_id) DO UPDATE SET retention_expires_at =
  CASE
    WHEN excluded.retention_expires_at > raw_log_metadata.retention_expires_at
      THEN excluded.retention_expires_at
    ELSE raw_log_metadata.retention_expires_at
  END;

CREATE INDEX IF NOT EXISTS signed_receipts_payload_hash_idx
  ON signed_receipts(payload_hash);
