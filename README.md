# ProofRunner

ProofRunner independently verifies agent-built software.

It resolves an exact public Git commit, selects a pinned verification skill,
executes install, build, and test inside an isolated resource-limited
environment, and returns PASS, FAIL, or INCONCLUSIVE together with an
Ed25519-signed receipt.

This repository is a pnpm workspace:

- `apps/web` — product web surface;
- `apps/api` — public API and orchestration;
- `apps/runner` — isolated worker control plane;
- `packages/schema` — versioned public, runner, A2MCP, receipt, and persistence
  contracts.

## Launch support

- Public GitHub repositories
- Node.js / TypeScript
- npm / pnpm
- Immutable Git commit
- Isolated execution
- Signed receipts
- Evidence bundles
- Free A2MCP service

## Production endpoint

- Product: <https://proof.ever-guild.net>
- Demo repository: <https://github.com/ever-guild/proof-runner-demo>
- A2MCP: `POST /a2mcp/inspect_repository`, `POST /a2mcp/verify_repository`
- Receipt verification: `POST /api/receipts/verify`

The production launch configuration uses free mode. Paid x402 mode is not enabled.

Production topology, secret provisioning boundaries, health probes, SQLite
backup, and frozen A2MCP registration samples are in
[`deployment/README.md`](deployment/README.md).

## Development

Requires Node.js 22 or newer and pnpm 10.32.1.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```
