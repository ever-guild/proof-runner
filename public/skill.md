---
name: proofrunner
description: Inspect a public GitHub repository and verify an exact commit with a pinned Node.js/TypeScript skill.
---

# ProofRunner integration contract

This file documents the frozen MVP contract for human and AI agent callers. The
checked-in web flow uses explicitly labelled demo reference data. The public
service is not currently publicly available, so the routes below describe the
contract to use only after a deployment is live.

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

1. **Inspect Repository**: `POST /api/inspect`
   - Request body includes `contractVersion`, `repositoryUrl`, and `ref`.
   - Resolves a branch, tag, or commit SHA to a full immutable SHA without running repository code.

2. **Start Verification**: `POST /api/verify`
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
     A terminal run without an issued receipt returns `RECEIPT_NOT_FOUND`.

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
