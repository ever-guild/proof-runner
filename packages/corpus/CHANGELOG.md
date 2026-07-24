# CHANGELOG - ProofRunner Corpus

## [0.1.0] - 2026-07-24

### Added
- PRVC 0.1.0 — Hackathon Smoke dataset specification and release suite.
- 35 logical validation cases (40 execution variants):
  - 10 Core execution PASS/FAIL fixtures (`prvc.synthetic.node.core-*`)
  - 6 Detection & input validation fixtures (`prvc.synthetic.node.detect-*`)
  - 8 Sandbox isolation & resource limit fixtures (`prvc.synthetic.node.sandbox-*`, `prvc.synthetic.node.resource-*`)
  - 6 Receipt validation test vectors & canonicalization tests (`prvc.synthetic.node.receipt-*`)
  - 3 SWE-PolyBench Verified real JS/TS bug pairs (`prvc.real.pbv.*`, 6 variants)
  - 2 BugsJS real Node.js bug pairs (`prvc.real.bugsjs.*`, 4 variants)
- JSON Schemas Draft 2020-12 (`case`, `oracle`, `source-lock`, `report`, `receipt`, `certification`, `suite`, `receipt-vector`).
- Normative vocabulary definitions (`run-status`, `verdict`, `reason-codes`, `stage-types`, `certification-levels`).
- Execution profiles (`node-npm`, `node-pnpm`, `node-pnpm-workspace`, `node-typescript`).
- Reference Harness implementation for independent oracle evaluation, JCS canonicalization (RFC 8785), and tamper verification.
- Release manifests and SHA256 integrity checksums.
