# ProofRunner Corpus

Version: `0.1.0` (Hackathon Smoke Release)
Specification: `prvc-spec/1.0-draft`

`PRVC` is an independent, reproducible validation benchmark and conformance suite for ProofRunner. It defines the cases, oracle vocabulary, and reference checks used to validate repository inspection, sandbox policy, build/test outcomes, timeouts, infrastructure failures, and tamper-evident signed receipts.

## Evidence boundary

The checked-in `manifests/certification-report.json` is an `IMPORTED` candidate baseline with zero executed cases. It is not a live-run certification, and the repository does not track a generated run report as evidence. Live certification requires an available container runner, executed fixture commands, and an externally retained report for that exact run.

Imported `real.*` candidates are intentionally not materialized by the reference harness until each candidate supplies source provenance and a reproducible materialization recipe. This prevents placeholder pass/fail commands from being mistaken for evidence about an upstream project.

## Fixture signature notice

The generated release manifest uses a deterministic RFC 8032 test-vector key. Its signature proves only that the checked-in fixture bytes can be reproduced; it does **not** establish publisher authenticity or a trusted release identity. Anyone can recreate and re-sign these fixtures. Do not treat `release-key.pub` as a publisher key.

## Key Components

- **Schemas (`schemas/`)**: Strict JSON Schema Draft 2020-12 definitions for cases, oracles, source-locks, reports, receipts, and suites.
- **Vocabulary (`vocabulary/`)**: Machine-readable enums for run statuses, verdicts, reason codes, stage types, and certification levels.
- **Profiles (`profiles/`)**: Execution environment definitions (Node.js npm, pnpm, pnpm-workspace, TypeScript).
- **Suites (`suites/`)**: Test suite manifests (`smoke.yaml`, `core.yaml`, `real-jsts.yaml`, `sandbox.yaml`, `protocol.yaml`, etc.).
- **Cases (`cases/`)**: 56 logical test cases covering 65 execution variants:
  - Core PASS/FAIL and edge cases (10 cases)
  - Input detection and validation (6 cases)
  - Sandbox isolation and policy enforcement (14 cases)
  - Receipt tampering and JCS protocol (12 cases)
  - Resource limits and process lifecycle (4 cases)
  - SWE-PolyBench Verified real JS/TS bug pairs (5 cases / 10 variants)
  - BugsJS real Node.js bug pairs (5 cases / 10 variants)
- **Reference Harness (`src/`)**: Independent TypeScript evaluator for validating ProofRunner outputs against PRVC oracles and metamorphic relations.

## Usage

```bash
# Run PRVC validation suite
pnpm test
```
