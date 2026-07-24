---
name: proofrunner
description: Inspect a public GitHub repository and verify an exact commit with a pinned Node.js/TypeScript skill.
---

# ProofRunner integration contract

This file documents the frozen MVP contract. The checked-in web flow currently
uses explicitly labelled demo data; treat endpoints as available only after the
deployment publishes them successfully.

## When to use ProofRunner

Use ProofRunner to execute configured install, build, and test checks against an
immutable public Git commit. A PASS means only that the checks named in the
receipt passed. It is not a security audit or a guarantee that the code is free
of defects or malware.

## MVP limits

- Canonical public `https://github.com/owner/repository` URLs only.
- Node.js and TypeScript projects using npm or pnpm with a lockfile.
- No repository secrets, private repositories, or user-provided shell commands.
- A timeout, registry outage, or runner failure is INCONCLUSIVE, never FAIL.

## Public API contract

All JSON requests include the frozen contract version.

- `POST /api/inspect` resolves a branch, tag, or commit to a full immutable SHA
  without executing repository code.
- `POST /api/verify` starts a verification. It requires an `Idempotency-Key`.
- `GET /api/runs/{id}` returns `QUEUED`, `RUNNING`, `COMPLETED`, `TIMEOUT`, or
  `SYSTEM_ERROR`. Poll until a terminal status.
- `GET /api/receipts/{id}` returns a signed receipt when receipt issuance is
  implemented and the run has a report.

Verdicts are `PASS`, `FAIL`, or `INCONCLUSIVE`; run status and verdict are
separate fields.

## A2MCP and payment modes

The frozen agent routes are `POST /a2mcp/inspect_repository` and
`POST /a2mcp/verify_repository`. Inspection is free. Verification launches in
free HTTP 200 mode unless paid mode is explicitly configured and validated.
Paid mode may return HTTP 402 with a `PAYMENT-REQUIRED` header before a paid
replay. Do not assume x402 or OKX.AI availability until the public service is
listed as live.
