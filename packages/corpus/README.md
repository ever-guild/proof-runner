# ProofRunner Corpus

Version: `0.1.0` (Hackathon Smoke Release)
Specification: `prvc-spec/1.0-draft`

`PRVC` is an independent, reproducible validation benchmark and conformance suite for ProofRunner. It verifies that ProofRunner correctly inspects repositories, enforces sandbox security policy, parses build and test outcomes, handles timeouts and infrastructure failures without issuing false PASS or false FAIL verdicts, and generates tamper-evident signed receipts.

## Fixture signature notice

The generated release manifest uses a deterministic RFC 8032 test-vector key. Its signature proves only that the checked-in fixture bytes can be reproduced; it does **not** establish publisher authenticity or a trusted release identity. Anyone can recreate and re-sign these fixtures. Do not treat `release-key.pub` as a publisher key.

## Key Components

- **Schemas (`schemas/`)**: Strict JSON Schema Draft 2020-12 definitions for cases, oracles, source-locks, reports, receipts, and suites.
- **Vocabulary (`vocabulary/`)**: Machine-readable enums for run statuses, verdicts, reason codes, stage types, and certification levels.
- **Profiles (`profiles/`)**: Execution environment definitions (Node.js npm, pnpm, pnpm-workspace, TypeScript).
- **Suites (`suites/`)**: Test suite manifests (`smoke.yaml`, `core.yaml`, `real-jsts.yaml`, `sandbox.yaml`, `protocol.yaml`, etc.).
- **Cases (`cases/`)**: 35 logical test cases covering 40 execution variants:
  - Core PASS/FAIL (10 cases)
  - Input/detection (6 cases)
  - Sandbox & resource limits (8 cases)
  - Receipt tampering & JCS protocol (6 cases)
  - SWE-PolyBench Verified real JS/TS bug pairs (3 pairs / 6 variants)
  - BugsJS real Node.js bug pairs (2 pairs / 4 variants)
- **Reference Harness (`src/`)**: Independent TypeScript evaluator for validating ProofRunner outputs against PRVC oracles and metamorphic relations.

## Usage

```bash
# Run PRVC validation suite
pnpm test
```
