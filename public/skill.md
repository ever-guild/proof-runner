---
name: proofrunner
description: Inspect a public GitHub repository and verify an exact commit with a pinned Node.js/TypeScript skill.
---

# ProofRunner integration contract

This file documents the frozen MVP contract for human and AI agent callers. The checked-in web flow currently uses explicitly labelled demo reference data; live endpoints become operational upon public service deployment.

## When to use ProofRunner

Use ProofRunner to execute configured install, build, and test checks against an immutable public Git commit in an isolated worker. A PASS verdict means only that the checks named in the receipt passed. It is not a security audit or a guarantee that the code is free of defects or malware.

## MVP limits

- Canonical public `https://github.com/owner/repository` URLs only.
- Node.js and TypeScript projects using `npm` or `pnpm` with a lockfile.
- Pinned install, build, and test commands from the `node-typescript` verification skill.
- No repository secrets, private repositories, or user-provided shell commands.
- A timeout, registry outage, or runner failure is `INCONCLUSIVE`, never `FAIL`.

## Public API contract

All JSON API requests use application/json content type.

1. **Inspect Repository**: `POST /api/inspect`
   - Request body: `{ "repositoryUrl": "https://github.com/owner/repository", "ref": { "type": "branch" | "tag" | "commit", "value": "string" } }`
   - Resolves a branch, tag, or commit SHA to a full immutable SHA without running repository code.

2. **Start Verification**: `POST /api/verify`
   - Headers: `Idempotency-Key: <unique-key>`
   - Request body: `{ "repositoryUrl": "https://github.com/owner/repository", "resolvedCommitSha": "<40-char-sha>" }`
   - Returns run object containing `{ "id": "<run-id>", "status": "QUEUED" | "RUNNING" }`.

3. **Poll Run Status**: `GET /api/runs/{id}`
   - Status values: `QUEUED`, `RUNNING`, `COMPLETED`, `TIMEOUT`, `SYSTEM_ERROR`.
   - Terminal statuses: `COMPLETED`, `TIMEOUT`, `SYSTEM_ERROR`. Poll until terminal.

4. **Get Signed Receipt**: `GET /api/receipts/{id}`
   - Returns structured, signed JSON receipt when the run reaches a terminal state.

## Verdict semantics

- `PASS`: All verification checks defined in the pinned skill executed and succeeded.
- `FAIL`: Code was executed in isolation and one or more checks failed.
- `INCONCLUSIVE`: Execution timed out, package registry failed, or infrastructure error occurred. Timeouts and system failures are strictly `INCONCLUSIVE`, never `FAIL`.

## A2MCP and payment modes

- Agent routes: `POST /a2mcp/inspect_repository` and `POST /a2mcp/verify_repository`.
- Inspection is free.
- Verification operates in free HTTP 200 mode unless paid x402 mode is explicitly enabled.
- `Available through OKX.AI` and paid x402 availability are unavailable until live deployment is active.
