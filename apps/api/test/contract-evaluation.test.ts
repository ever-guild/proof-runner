import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  type VerificationContract,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import { evaluateVerificationContract } from "../src/contract-evaluation.js";

const contract: VerificationContract = {
  version: "1",
  subject: {
    repositoryUrl: "https://github.com/ever-guild/example",
    resolvedCommitSha: "a".repeat(40),
    skillHash: "b".repeat(64),
    runtimeImageDigest: `sha256:${"c".repeat(64)}`,
  },
  criteria: [
    { id: "build", kind: "build", required: true },
    { id: "tests", kind: "test-suite", required: true },
  ],
  prohibitions: [
    {
      id: "commands",
      kind: "arbitrary-command",
      enforcement: "PLATFORM",
    },
    {
      id: "build-network",
      kind: "outbound-network-during-build",
      enforcement: "PLATFORM",
    },
  ],
};

const completedAt = "2026-07-26T12:00:00.000Z";
const report: VerificationReport = {
  contractVersion: CONTRACT_VERSION,
  runId: "018f47ac-5d7b-7c20-a1aa-0242ac120001",
  repositoryUrl: contract.subject.repositoryUrl,
  resolvedCommitSha: contract.subject.resolvedCommitSha,
  resolvedRef: { type: "branch", value: "main" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: contract.subject.skillHash,
  },
  runtimeImageDigest: contract.subject.runtimeImageDigest,
  verdict: "PASS",
  checks: [
    {
      id: "build",
      stage: "BUILD",
      title: "Run build",
      outcome: "PASSED",
      startedAt: completedAt,
      completedAt,
      durationMs: 0,
      exitCode: 0,
      summary: "Build passed.",
    },
    {
      id: "test",
      stage: "TEST",
      title: "Run tests",
      outcome: "PASSED",
      startedAt: completedAt,
      completedAt,
      durationMs: 0,
      exitCode: 0,
      summary: "Tests passed.",
    },
  ],
  platformControls: [
    {
      control: "COMMAND_ALLOWLIST",
      status: "ENFORCED",
      checkId: null,
    },
    {
      control: "BUILD_NETWORK_DISABLED",
      status: "ENFORCED",
      checkId: "build",
    },
  ],
  durationMs: 0,
  completedAt,
  reasonCode: null,
};

describe("verification contract evaluation", () => {
  it("maps terminal checks and platform controls to machine-produced coverage", () => {
    expect(evaluateVerificationContract(contract, report)).toEqual([
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
        status: "EXECUTED",
        provenance: {
          type: "NORMALIZED_CHECK",
          checkId: "test",
          outcome: "PASSED",
        },
        reasonCode: null,
      },
      {
        criterionId: "commands",
        kind: "arbitrary-command",
        required: true,
        status: "EXECUTED",
        provenance: {
          type: "PLATFORM_CONTROL",
          control: "COMMAND_ALLOWLIST",
          status: "ENFORCED",
        },
        reasonCode: null,
      },
      {
        criterionId: "build-network",
        kind: "outbound-network-during-build",
        required: true,
        status: "EXECUTED",
        provenance: {
          type: "PLATFORM_CONTROL",
          control: "BUILD_NETWORK_DISABLED",
          status: "ENFORCED",
        },
        reasonCode: null,
      },
    ]);
  });

  it("keeps skipped or absent required checks unverified", () => {
    expect(
      evaluateVerificationContract(contract, {
        ...report,
        checks: [
          {
            ...report.checks[0]!,
            outcome: "SKIPPED",
            exitCode: null,
          },
        ],
      }).slice(0, 2),
    ).toEqual([
      {
        criterionId: "build",
        kind: "build",
        required: true,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "CHECK_NOT_EXECUTED",
      },
      {
        criterionId: "tests",
        kind: "test-suite",
        required: true,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "CHECK_NOT_REPORTED",
      },
    ]);
  });

  it("does not fabricate platform-control coverage from a terminal report", () => {
    const withoutControls = {
      ...report,
      platformControls: undefined,
    };
    expect(
      evaluateVerificationContract(contract, withoutControls).slice(2),
    ).toEqual([
      {
        criterionId: "commands",
        kind: "arbitrary-command",
        required: true,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "PLATFORM_CONTROL_NOT_PROVEN",
      },
      {
        criterionId: "build-network",
        kind: "outbound-network-during-build",
        required: true,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "PLATFORM_CONTROL_NOT_PROVEN",
      },
    ]);
  });

  it("reports a signed platform-control violation as observed", () => {
    const violated = {
      ...report,
      verdict: "FAIL" as const,
      checks: [
        { ...report.checks[0]!, outcome: "FAILED" as const, exitCode: 1 },
        report.checks[1]!,
      ],
      platformControls: [
        report.platformControls![0]!,
        {
          control: "BUILD_NETWORK_DISABLED" as const,
          status: "VIOLATED" as const,
          checkId: "build",
        },
      ],
    };
    expect(
      evaluateVerificationContract(contract, violated)[3],
    ).toMatchObject({
      status: "OBSERVED",
      provenance: {
        type: "PLATFORM_CONTROL",
        control: "BUILD_NETWORK_DISABLED",
        status: "VIOLATED",
      },
    });
  });
});
