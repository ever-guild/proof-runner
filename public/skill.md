---
name: proofrunner
description: Independently verify a public Git repository and exact commit by executing a pinned verification skill in an isolated environment.
---

ProofRunner is an A2MCP service on OKX.AI.

## When to use ProofRunner
Use ProofRunner when you need independent verification that a software delivery (built by an AI agent or a human) successfully compiles, installs dependencies, and passes its test suite. ProofRunner executes code in a sandboxed environment and issues a cryptographic receipt.

## Limitations
- **NOT A SECURITY AUDIT**: ProofRunner does not guarantee the code is free of vulnerabilities or malware. It only proves the specified skill ran successfully.
- Public Node.js / TypeScript repositories only.
- npm and pnpm supported. No Yarn.
- No access to repository secrets or custom shell commands.

## API Endpoints

### 1. Inspect Repository
`POST /api/inspect`
Check if a repository is supported and get the verification profile.
```json
{
  "repositoryUrl": "https://github.com/owner/repository",
  "gitRef": "main"
}
```

### 2. Run Verification
`POST /api/verify`
Start a verification run. Payment required (HTTP 402) using x402 schema.
Returns run ID and status.

### 3. Check Status
`GET /api/runs/{id}`
Poll this endpoint until status is `COMPLETED`, `TIMEOUT`, or `SYSTEM ERROR`.

### 4. Fetch Receipt
`GET /api/receipts/{id}`
Returns the final verification receipt including the verdict (PASS, FAIL, INCONCLUSIVE) and report hash.
