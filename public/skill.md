---
name: proofrunner
description: Inspect a public GitHub repository and verify an exact commit with a pinned Node.js/TypeScript skill.
---

# ProofRunner integration contract

This file documents the frozen MVP contract for human and AI agent callers. The
checked-in web flow uses explicitly labelled synthetic demo data. The public
service is not currently publicly available, so the routes below describe the
contract to use only after a deployment is live.

## Launch capabilities

ProofRunner exposes three launch capabilities:
1. `inspect_repository` (free): Inspect a public GitHub repository and resolve git references to an immutable commit SHA.
2. `verify_repository` (configured free / paid x402): Run isolated verification checks against an immutable commit SHA.
3. `verify_receipt` (free): Fetch signing public keys and verify signed JSON receipt integrity and authenticity.

## When to use ProofRunner

When the public service is live, use ProofRunner to execute configured install,
build, and test checks against an immutable public Git commit in an isolated
worker. A PASS verdict means only that the checks named in the receipt passed.
It is not a security audit or a guarantee that the code is free of defects or
malware.

## MVP limits

- Canonical public `https://github.com/owner/repository` URLs only.
- Node.js and TypeScript projects using `npm` or `pnpm` with a lockfile.
- Pinned install, build, and test commands from the `node-typescript` verification skill.
- No repository secrets, private repositories, or user-provided shell commands.
- A timeout, registry outage, or runner failure is `INCONCLUSIVE`, never `FAIL`.

## Public API contract

All JSON request and response bodies include `"contractVersion": "1.0"`.

1. **Inspect Repository**: `POST /api/inspect` (Capability: `inspect_repository`)
   - Request body includes `contractVersion`, `repositoryUrl`, and `ref`.
   - Resolves a branch, tag, or commit SHA to a full immutable SHA without running repository code.

2. **Start Verification**: `POST /api/verify` (Capability: `verify_repository`)
   - Headers: `Idempotency-Key: <unique-key>`
   - Request body includes `contractVersion`, `repositoryUrl`, `resolvedCommitSha`,
     `resolvedRef`, `skill` (`node-typescript` version `1` with its pinned hash),
     and `public`.
   - A new request returns a run in `QUEUED` or `RUNNING`; reusing the same
     idempotency key returns the existing run.

3. **Poll Run Status**: `GET /api/runs/{id}`
   - Status values: `QUEUED`, `RUNNING`, `COMPLETED`, `TIMEOUT`, `SYSTEM_ERROR`.
   - Terminal statuses: `COMPLETED`, `TIMEOUT`, `SYSTEM_ERROR`. Poll until terminal.

4. **Get Signed Receipt**: `GET /api/receipts/{id}`
   - Returns a structured, signed JSON receipt when a receipt has been issued.
   - Output: `SignedReceipt` object (`contractVersion`, `payload`, `canonicalization: "JCS-RFC8785"`, `hashAlgorithm: "SHA-256"`, `payloadHash`, `signatureAlgorithm: "Ed25519"`, `keyId`, `signature`).
   - Failure mode: `RECEIPT_NOT_FOUND` (404) if receipt was not found or not yet issued.

5. **Get Receipt Public Key**: `GET /api/receipt-keys/{keyId}` (Capability: `verify_receipt`)
   - Path parameter: `keyId` (string).
   - Output: `ReceiptPublicKey` object (`contractVersion`, `keyId`, `signatureAlgorithm: "Ed25519"`, `publicKey` as PEM string).
   - Failure mode: `RECEIPT_NOT_FOUND` (404) if key ID is unknown.

6. **Verify Receipt**: `POST /api/receipts/verify` (Capability: `verify_receipt`)
   - Request body: `SignedReceipt` object (up to 1 MiB).
   - Output: `ReceiptVerificationResponse` (`contractVersion`, `valid` boolean, `reason` string or null).
   - Validation reasons when `valid` is false: `PAYLOAD_HASH_MISMATCH`, `UNKNOWN_KEY`, `INVALID_SIGNATURE`, `INVALID_RECEIPT`.
   - Failure modes: `INVALID_REQUEST` (400) if JSON is invalid; `REQUEST_BODY_TOO_LARGE` (413) if body exceeds 1 MiB.

## Receipt verification flow

To verify a signed receipt:
1. **Retrieve receipt**: `GET /api/receipts/{id}` to get the `SignedReceipt` payload.
2. **Read key identity**: Extract `receipt.keyId`.
3. **Fetch public key**: `GET /api/receipt-keys/{keyId}` to retrieve the active or retained Ed25519 public key.
4. **Verify signature**:
   - Option A (Server-side): Post full `SignedReceipt` to `POST /api/receipts/verify` and check `valid: true`.
   - Option B (Client-side):
     a. Canonicalize `receipt.payload` using JCS (RFC 8785).
     b. Compute SHA-256 digest of canonicalized payload and compare to `receipt.payloadHash`.
     c. Verify `receipt.signature` using Ed25519 over canonicalized payload bytes against fetched `publicKey`.

## Verdict semantics

- `PASS`: All verification checks defined in the pinned skill executed and succeeded.
- `FAIL`: Code was executed in isolation and one or more checks failed.
- `INCONCLUSIVE`: Execution timed out, package registry failed, or infrastructure error occurred. Timeouts and system failures are strictly `INCONCLUSIVE`, never `FAIL`.

## A2MCP and payment modes

- Agent routes are `POST /a2mcp/inspect_repository` and
  `POST /a2mcp/verify_repository`. The A2MCP verification request carries an
  `idempotencyKey` in its JSON body.
- The frozen contract defines free HTTP 200 mode and a possible paid HTTP 402
  response only when paid mode is explicitly configured and validated. That
  future response carries a base64-encoded x402 v2 challenge in the
  `PAYMENT-REQUIRED` header; the idempotent replay uses the same application
  request and idempotency key.
- Public OKX.AI/ASP listing and paid x402 mode are not live. Do not claim or
  invoke either as publicly available until their separate deployment and
  approval gates are complete.
