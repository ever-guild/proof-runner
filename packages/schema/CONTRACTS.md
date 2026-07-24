# ProofRunner contract version 1.0

All JSON messages carry the literal `contractVersion: "1.0"`. Consumers must
reject any other version. The Zod schemas exported by `@ever-guild/proof-runner-schema`
are authoritative; this document fixes their HTTP bindings and operational
semantics.

## Public API

| Method | Path | Request | Success |
| --- | --- | --- | --- |
| POST | `/api/inspect` | `InspectRequestSchema` | 200 `InspectResultSchema` |
| POST | `/api/verify` | `VerifyRequestSchema` | 202 new / 200 replay, `VerifyCreationResponseSchema` |
| GET | `/api/runs/:id` | — | 200 `RunResponseSchema` |
| GET | `/api/receipts/:id` | — | 200 `SignedReceiptSchema` |

`POST /api/verify` requires a non-empty `Idempotency-Key` header. The API binds
the key to the authenticated caller and canonical request fingerprint. Replays
of the same key and payload return the original run with `replayed: true`;
reuse with a different payload returns `409 IDEMPOTENCY_KEY_CONFLICT`.

The MVP executes one run and admits five waiting runs in monotonically ordered
FIFO `queuePosition`. A new request beyond that bound returns HTTP 429 with
`error.code = "RUN_QUEUE_FULL"` and `retryable = true`. Idempotent replays do
not consume another queue slot.

For a supported inspection, `inspection.selectedSkillHash` is the SHA-256 hash
of the server-selected skill manifest. Clients must pass that exact value as
`skill.hash` when creating a verification request; this pins the run to the
skill the service inspected and prevents a browser from selecting another
skill version.

Run `status` represents transport/execution lifecycle only. `verdict`
represents verification meaning. TIMEOUT and SYSTEM_ERROR are always
INCONCLUSIVE, never FAIL. Repository, sandbox, install, build, test, and receipt
are stages/checks, not top-level statuses. Each run response is discriminated by
status: queued/running states cannot carry a report, verdict, receipt, or system
error; completed and timeout states carry a matching report and receipt;
SYSTEM_ERROR carries required error details without a report.

## Internal API-to-runner API

Every `/internal/v1/*` request uses TLS and
`Authorization: Bearer <deployment-scoped-token>`. The API and runner receive
the token from deployment configuration. It is never included in a dispatch
body, subprocess environment, cloned repository, sandbox mount, normalized
check, raw log, error, or receipt. Missing or invalid authentication fails
closed with 401 `UNAUTHORIZED`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/internal/v1/runs` | Dispatch one leased run |
| POST | `/internal/v1/runs/:id/heartbeat` | Renew lease and report active stage |
| GET | `/internal/v1/runs/:id/status` | Read runner-observed status |
| PUT | `/internal/v1/runs/:id/result` | Deliver the final report once |
| POST | `/internal/v1/runs/:id/cancel` | Request cancellation |

The runner may act on a run only while the supplied `leaseId` matches and
`leaseExpiresAt` is in the future. Heartbeats renew the lease. After expiry the
runner stops and cleans up; stale heartbeats or results return 409
`LEASE_EXPIRED`. Result delivery is idempotent only for an identical report;
a different second result returns 409 `RESULT_CONFLICT`. Result delivery is
discriminated by terminal `status`: COMPLETED and TIMEOUT include a normalized
report, while SYSTEM_ERROR includes stable error details. A timeout report must
have verdict INCONCLUSIVE.

## Internal runner-to-API callbacks

The runner sends the following requests to the API host, using the same
deployment-scoped bearer token and contract version. Their path overlaps the
runner endpoints above, but the receiving host is the API, not the runner.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/internal/v1/runs/:id/heartbeat` | Renew the API-owned lease and publish the active stage |
| PUT | `/internal/v1/runs/:id/result` | Deliver the final normalized report or stable system error |

The API accepts a callback only for its current active lease. A rejected,
unreachable, or expired callback cannot leave a run stuck: the API cancels the
runner when its lease expires and persists `SYSTEM_ERROR` with an
INCONCLUSIVE verdict. The API persists a canonical terminal-result fingerprint
in the same transaction as the terminal state, so an identical result retry is
accepted after an API restart while a changed result remains a conflict.

Stable transport errors are exported as
`InternalTransportErrorCodeSchema`. HTTP mapping is: authentication 401/403,
validation and version mismatch 400, missing run 404, lease/state/conflict
errors 409, runner unavailable 503, and unexpected internal failure 500.

## A2MCP HTTPS JSON

`POST /a2mcp/inspect_repository` accepts
`InspectRepositoryA2McpRequestSchema` and returns HTTP 200 with
`InspectRepositoryA2McpResponseSchema`.

`POST /a2mcp/verify_repository` accepts
`VerifyRepositoryA2McpRequestSchema`, which includes `idempotencyKey`. In free
mode it returns HTTP 200 with `VerifyRepositoryA2McpResponseSchema`. In paid
mode the first call returns HTTP 402 and a base64-encoded
`X402PaymentRequiredV2Schema` value in the `PAYMENT-REQUIRED` response header.
The paid replay uses the same application request and idempotency key. Payment
settlement is outside PR-001.

## Persistence boundary

Migration `001_initial.sql` stores run metadata, normalized checks, and signed
receipts in durable tables. `002_run_orchestration.sql` adds terminal report
and normalized system-error fields; `003_result_delivery_fingerprint.sql`
makes result delivery idempotent across API restarts. Raw logs are held in
their own expiry-indexed table and may be deleted after the configured TTL
without deleting normalized checks or receipts.
