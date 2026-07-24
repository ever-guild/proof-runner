ALTER TABLE run_metadata ADD COLUMN report_json TEXT;
ALTER TABLE run_metadata ADD COLUMN system_error_code TEXT;
ALTER TABLE run_metadata ADD COLUMN system_error_message TEXT;
ALTER TABLE run_metadata ADD COLUMN system_error_retryable INTEGER CHECK (
  system_error_retryable IN (0, 1)
);
