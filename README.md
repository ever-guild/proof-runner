# ProofRunner

ProofRunner verifies a pinned public GitHub commit and returns a deterministic
PASS, FAIL, or INCONCLUSIVE report and signed receipt.

This repository is a pnpm workspace:

- `apps/web` — product web surface;
- `apps/api` — public API and orchestration;
- `apps/runner` — isolated worker control plane;
- `packages/schema` — versioned public, runner, A2MCP, receipt, and persistence
  contracts.

PR-001 intentionally contains only the buildable application skeleton and
frozen contracts. Product behavior starts in later tasks. See
[`packages/schema/CONTRACTS.md`](packages/schema/CONTRACTS.md).

## Development

Requires Node.js 22 or newer and pnpm 10.32.1.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
