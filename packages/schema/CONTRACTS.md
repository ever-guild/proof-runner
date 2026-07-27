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
| POST | `/api/reproducibility` | `ReproducibilityRequestSchema` + `Idempotency-Key` | 202 new / 200 replay, `ReproducibilityCreationResponseSchema` |
| GET | `/api/reproducibility/:id` | — | 200 `ReproducibilityResponseSchema` |
| POST | `/api/comparisons` | `ComparisonRequestSchema` | 200 `ComparisonResponseSchema` |
| GET | `/api/comparisons/:baseline/:candidate` | run IDs or receipt hashes | 200 `ComparisonResponseSchema` |
| GET | `/api/runs/:id` | — | 200 `RunResponseSchema` |
| GET | `/api/receipts/:id` | — | 200 `SignedReceiptSchema` |
| GET | `/api/receipts/:id/bundle` | — | 200 deterministic `application/zip` |
| GET | `/api/receipt-keys/:keyId` | — | 200 `ReceiptPublicKeySchema` |
| POST | `/api/receipts/verify` | `SignedReceiptSchema` | 200 `ReceiptVerificationResponseSchema` |
| POST | `/api/evidence-bundles/verify` | bounded `application/zip` | 200 `EvidenceBundleVerificationResponseSchema` |

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

### Bounded verification contracts

`VerifyRequestSchema` remains backward compatible and accepts an optional
`verificationContract`. Contract version `1` pins the repository URL, resolved
commit SHA, selected skill hash, and immutable runtime image digest. Its only
criterion kinds are `build` and `test-suite`; platform prohibitions are chosen
from the fixed command-allowlist and build/test network controls. Contract
objects are strict and cannot contain commands, scripts, URLs other than the
pinned repository, environment values, or unknown criterion kinds. Version
`1` permits at most one criterion of each kind. Build and test-suite criteria
map only to the unique normalized `build` and `test` check IDs respectively,
so an unrelated check in the same stage cannot satisfy them.

Contract-bearing run responses expose an unsigned `verification` envelope with
the original contract and criterion coverage. Coverage is one of `EXECUTED`,
`OBSERVED`, `DECLARED`, or `UNVERIFIED` and carries typed provenance plus a
stable reason code where required. A terminal normalized BUILD or TEST check
is `EXECUTED`; a skipped or absent required check remains `UNVERIFIED`.
Platform controls use explicit signed runner evidence: `ENFORCED` becomes
`EXECUTED`, `VIOLATED` becomes `OBSERVED`, and a missing control remains
`UNVERIFIED` with `PLATFORM_CONTROL_NOT_PROVEN`. Non-terminal runs report
`RUN_NOT_TERMINAL`.

The envelope is deliberately outside `VerificationReportSchema` and
`SignedReceiptSchema`: it cannot change PASS, FAIL, or INCONCLUSIVE, and
declarations or unverified claims never become signed execution evidence.
When a contract is present, the API rejects terminal reports whose runtime
image digest differs from the pinned contract subject.

For terminal contract-bearing runs, the same unsigned envelope includes an
advisory policy-version-`1` decision:

- `ACCEPT` requires execution verdict PASS and `EXECUTED` machine provenance
  for every required criterion.
- `REMEDIATE` is returned for FAIL or a machine-observed prohibited condition.
- `HUMAN_REVIEW` is returned for INCONCLUSIVE, unsupported criteria, or any
  required `OBSERVED`, `DECLARED`, or `UNVERIFIED` coverage.

The decision has stable reason codes and is rendered as unsigned/advisory in
the web result view. Decision generation is a pure local policy function: it
does not perform a network or model call and cannot modify the signed report or
receipt.

### Reproducibility requests

`POST /api/reproducibility` atomically reserves two adjacent child runs for the
same validated verification request. The existing one-active/five-waiting FIFO
queue remains authoritative: a reservation that cannot admit both children
fails without creating either. The first child must become terminal before the
second is dispatched.

The result compares runtime image digest, verdict, reason code, normalized
check IDs/outcomes, and declared artifact hashes. Run IDs, timestamps,
durations, and source array ordering are excluded. A mismatch returns verdict
`INCONCLUSIVE` with reason `NONDETERMINISTIC_RESULT`; both child run IDs and
signed receipt links remain available. Standard `/api/verify` admission and
replay behavior is unchanged.

### Verified commit comparisons

Comparison selectors are either a verified run UUID or a signed receipt
payload hash. Both receipts must name the same repository, compatible
persisted verification-contract projection, receipt contract version, skill
name/version/hash, and runtime image digest. Incompatible evidence is rejected
before outcomes are compared with stable repository, contract, skill, or
runtime reason codes.

The response preserves both signed receipts and their original verdicts. Check
IDs are deterministically classified as `RESOLVED`, `NEW`, `UNCHANGED`,
`ADDED`, or `REMOVED`, with explicit verdict/check-set/check-outcome/artifact
drift labels. The stable GET path backs the shareable `/compare/...` UI.
Comparison is read-only and never contains a patch or generated fix.

### Signed evidence bundles

`GET /api/receipts/:id/bundle` returns a deterministic uncompressed ZIP with
fixed entry order and timestamps. It contains `receipt.json`, `report.json`,
an optional `verification-contract.json`, optional redacted
`logs/raw.ndjson`, `bundle-manifest.json`, `bundle-manifest.sig`, and
`checksums.txt`.
Raw logs are included only while retained; an expired log set is omitted with
`RAW_LOG_EXPIRED`. Common authorization headers, credentials in any
`scheme://user:password@host` URI, tokens, and quoted or unquoted credential
assignments are redacted. If a credential value is structured, unterminated,
contains private-key material, or otherwise cannot be safely reduced, all raw
logs are omitted with `RAW_LOG_REDACTION_UNSAFE`.

The canonical JCS manifest lists the SHA-256 digest, media type, role, and byte
length of every payload file. `bundle-manifest.json`, `bundle-manifest.sig`,
and `checksums.txt` are explicit signed-payload self-reference exclusions.
`checksums.txt` covers every payload entry plus the final manifest and
signature, while excluding itself. `bundle-manifest.sig` signs the canonical
manifest with the receipt key. Verification checks bounded ZIP structure, safe
unique paths, exact manifest coverage, checksums, manifest and receipt Ed25519
signatures, report equality, and optional contract bindings.
Every local and central ZIP header field must match the canonical writer,
including creator/required versions and internal/external attributes. Archive,
entry, and request limits fail closed; receipt contract version `1.0` is
unchanged. `/verify-evidence` provides the bounded upload UI and reports the
stable signature, digest, manifest, or archive failure reason without
contacting the source repository.

Because `bundle-manifest.sig` uses the receipt key, deployments that rotate
keys keep historical private receipt keys in the secret
`PROOF_RUNNER_RECEIPT_SIGNING_KEYS` ring while the corresponding public keys
remain available for verification. A historical bundle is never re-signed
under a different key ID.

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
`004_verification_contract.sql` persists the optional strict verification
contract so coverage remains available after restart. Startup applies the
column and its migration record atomically and repairs legacy interrupted
bookkeeping after inspecting the postcondition.
`005_reproducibility_jobs.sql` records idempotent two-run reservations.
Startup atomically records the table migration and repairs a missing migration
record or child lookup index only after validating the complete table shape.
`006_evidence_bundles.sql` idempotently indexes receipt payload hashes and
backfills raw-log expiry metadata before recording the migration, so startup
repairs an interrupted backfill or missing index.
