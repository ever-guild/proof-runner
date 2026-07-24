# ProofRunner API orchestration

The API uses the persistent `DATABASE_PATH` SQLite file for queue state, run
metadata, normalized checks, and signed receipts. Mount that file on a durable
volume in deployment. `PROOF_RUNNER_BEARER_TOKEN` authenticates every internal
runner dispatch, cancellation, heartbeat, and result callback; it is never
returned to clients. The API only reads GitHub metadata and committed files
during inspection—it never clones or executes repository code.

Set `PROOF_RUNNER_RUNNER_URL`, `DATABASE_PATH`, and the receipt-key variables
documented in the root environment configuration before starting the process.
The runner must also receive `PROOF_RUNNER_API_URL`, which it uses for the
authenticated heartbeat and final-result callbacks.
