# API orchestration

The API owns durable run state in SQLite and exposes the public contract:

- `POST /api/inspect`
- `POST /api/verify` with `Idempotency-Key`
- `GET /api/runs/:id`
- receipt retrieval and verification routes

It dispatches at most one active run to `PROOF_RUNNER_RUNNER_URL`. The runner
uses the same deployment-scoped `PROOF_RUNNER_BEARER_TOKEN` to callback to
`PROOF_RUNNER_API_URL` with heartbeat and terminal result messages. A missing
callback expires the lease, triggers cancellation, and becomes a generic
`SYSTEM_ERROR` / `INCONCLUSIVE` response rather than exposing runner details.
Terminal callback fingerprints are durable, so an identical result retry stays
accepted after an API restart; a changed result is rejected as a conflict.

Both API and runner must be on a private network in production. Set
`PROOF_RUNNER_RUNNER_URL` and `PROOF_RUNNER_API_URL` to internal HTTPS URLs;
the `127.0.0.1` form exists only for local integration tests.
