import {
  CONTRACT_VERSION,
  SignedReceiptSchema,
  type SignedReceipt,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import {
  DEMO_BROKEN_SHA,
  DEMO_FIXED_SHA,
  DEMO_REPOSITORY_URL,
} from "@ever-guild/proof-runner-metadata";

export const DEMO_COMPARISON_KEY_ID = "demo-comparison-fixture-v1";
export const DEMO_COMPARISON_PUBLIC_KEY_PEM =
  "-----BEGIN PUBLIC KEY-----\n" +
  "MCowBQYDK2VwAyEAMO+xJXojVFBH0h4njDzSngqfQ6suSsEsz8K4L1tnVfs=\n" +
  "-----END PUBLIC KEY-----\n";

const fixtureReport = (
  runId: string,
  resolvedCommitSha: string,
  verdict: "PASS" | "FAIL",
): VerificationReport => ({
  contractVersion: CONTRACT_VERSION,
  runId,
  repositoryUrl: DEMO_REPOSITORY_URL,
  resolvedCommitSha,
  resolvedRef: { type: "commit", value: resolvedCommitSha },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  runtimeImageDigest: `sha256:${"c".repeat(64)}`,
  verdict,
  checks: [
    {
      id: "build",
      stage: "BUILD",
      title: "Build",
      outcome: "PASSED",
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:00:01.000Z",
      durationMs: 1_000,
      exitCode: 0,
      summary: "build passed.",
    },
    {
      id: "test",
      stage: "TEST",
      title: "Unit tests",
      outcome: verdict === "PASS" ? "PASSED" : "FAILED",
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:00:01.000Z",
      durationMs: 1_000,
      exitCode: verdict === "PASS" ? 0 : 1,
      summary: verdict === "PASS" ? "test passed." : "test failed.",
    },
  ],
  artifacts: [{ id: "dist", sha256: "d".repeat(64) }],
  durationMs: 2_000,
  completedAt: "2026-07-26T12:00:02.000Z",
  reasonCode: verdict === "PASS" ? null : "TEST_FAILED",
});

const fixtureReceipt = (
  report: VerificationReport,
  payloadHash: string,
  signature: string,
): SignedReceipt =>
  SignedReceiptSchema.parse({
    contractVersion: CONTRACT_VERSION,
    payload: {
      contractVersion: CONTRACT_VERSION,
      id: report.runId,
      report,
      createdAt: report.completedAt,
    },
    canonicalization: "JCS-RFC8785",
    hashAlgorithm: "SHA-256",
    payloadHash,
    signatureAlgorithm: "Ed25519",
    keyId: DEMO_COMPARISON_KEY_ID,
    signature,
  });

export const DEMO_BROKEN_SIGNED_RECEIPT = Object.freeze(
  fixtureReceipt(
    fixtureReport(
      "018f47ac-5d7b-7c20-a1aa-0242ac120401",
      DEMO_BROKEN_SHA,
      "FAIL",
    ),
    "41ba9e22ff385fbc461d3d6e6d58f545a8b7e8e157aa1c44dd7a39f7465db2a7",
    "4aepk9Jm08/hGEAFykMGPvFuIE155WjIVzDO4kPxp1P2fkKZISVX4UM9kNzSRQMIxN82uGjf4MkTq4Tvig5yAQ==",
  ),
);

export const DEMO_FIXED_SIGNED_RECEIPT = Object.freeze(
  fixtureReceipt(
    fixtureReport(
      "018f47ac-5d7b-7c20-a1aa-0242ac120402",
      DEMO_FIXED_SHA,
      "PASS",
    ),
    "18ce18421503240ba956c86476fd6f7dddcfa33ae7763cbfccd050d96de424ba",
    "bhTvQCppVxBMVLZDjRrIE8LiR5+3oO/2o8gPkTZXsCGxklFVnWUNVH+viut/9hU3rwWrg520UnpzmEq45uDTCQ==",
  ),
);
