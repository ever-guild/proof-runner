# PRVC Specification — prvc-spec/1.0-draft

## Summary

The ProofRunner Corpus defines a normative schema, data format, suite layout, and verification protocol to independently validate ProofRunner implementations.

## Normative Model

1. **Terminal Run Statuses**: `QUEUED`, `RUNNING`, `COMPLETED`, `TIMEOUT`, `SYSTEM_ERROR`.
2. **Verification Verdicts**: `PASS`, `FAIL`, `INCONCLUSIVE`.
3. **Execution Stages**: `REPOSITORY`, `SANDBOX`, `INSTALL`, `BUILD`, `TEST`, `RECEIPT`.
4. **Canonical JSON Serialization**: RFC 8785 (JSON Canonicalization Scheme JCS).
5. **Hasher & Signer**: SHA-256 and Ed25519 signatures.

### Fixture attestation boundary

The corpus generator uses a deterministic RFC 8032 test-vector Ed25519 key solely to make fixture-integrity output reproducible. The resulting signature is not a publisher attestation, is not a trusted identity signal, and can be recreated or re-signed by anyone. Consumers must obtain publisher authenticity from an independent trusted release channel.

## Validation Oracle Matrix

| Scenario | Run Status | Verdict | Reason Code |
|---|---|---|---|
| All tests pass | `COMPLETED` | `PASS` | `NONE` |
| Test failure | `COMPLETED` | `FAIL` | `TEST_FAILURE` |
| Build failure | `COMPLETED` | `FAIL` | `BUILD_FAILED` |
| Typecheck failure | `COMPLETED` | `FAIL` | `TYPECHECK_FAILED` |
| Lockfile invalid | `COMPLETED` | `FAIL` | `LOCKFILE_INVALID` |
| Ref not found | `SYSTEM_ERROR` / `REJECTED` | `INCONCLUSIVE` | `REF_NOT_FOUND` |
| Timeout exceeded | `TIMEOUT` | `INCONCLUSIVE` | `TIMEOUT` |
| OOM / Resource exhausted | `TIMEOUT` / `RESOURCE_EXHAUSTED` | `INCONCLUSIVE` | `MEMORY_LIMIT` |
| Security canary blocked | `POLICY_BLOCKED` / `COMPLETED` | `INCONCLUSIVE` | `SANDBOX_POLICY_BLOCK` |

## Case Naming Convention

`prvc.<source>.<language>.<category>.<slug>.v<revision>`
Examples:
- `prvc.synthetic.node.core-pass-001`
- `prvc.real.pbv.typescript.eslint-033`
- `prvc.real.bugsjs.javascript.express-035`
