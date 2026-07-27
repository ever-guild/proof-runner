import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideAcceptance,
  type CriterionCoverage,
} from "../src/index.js";

const executedCoverage: CriterionCoverage[] = [
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
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("acceptance decision policy", () => {
  it.each([
    ["PASS", "EXECUTED", "ACCEPT"],
    ["PASS", "OBSERVED", "HUMAN_REVIEW"],
    ["PASS", "DECLARED", "HUMAN_REVIEW"],
    ["PASS", "UNVERIFIED", "HUMAN_REVIEW"],
    ["FAIL", "EXECUTED", "REMEDIATE"],
    ["FAIL", "OBSERVED", "REMEDIATE"],
    ["FAIL", "DECLARED", "REMEDIATE"],
    ["FAIL", "UNVERIFIED", "REMEDIATE"],
    ["INCONCLUSIVE", "EXECUTED", "HUMAN_REVIEW"],
    ["INCONCLUSIVE", "OBSERVED", "HUMAN_REVIEW"],
    ["INCONCLUSIVE", "DECLARED", "HUMAN_REVIEW"],
    ["INCONCLUSIVE", "UNVERIFIED", "HUMAN_REVIEW"],
  ] as const)(
    "maps %s with %s coverage to %s",
    (verdict, status, expected) => {
      const coverage: CriterionCoverage = {
        ...executedCoverage[0]!,
        status,
        provenance:
          status === "EXECUTED"
            ? executedCoverage[0]!.provenance
            : status === "OBSERVED"
              ? {
                  type: "INSPECTION",
                  observation: "BUILD_SCRIPT_PRESENT",
                }
              : status === "DECLARED"
                ? {
                    type: "CONTRACT_DECLARATION",
                    contractVersion: "1",
                  }
                : null,
        reasonCode:
          status === "DECLARED"
            ? "CLAIM_NOT_MACHINE_VERIFIED"
            : status === "UNVERIFIED"
              ? "CHECK_NOT_REPORTED"
              : null,
      };
      expect(decideAcceptance({ verdict, coverage: [coverage] }).outcome).toBe(
        expected,
      );
    },
  );

  it("accepts only a PASS with complete machine-executed required coverage", () => {
    expect(
      decideAcceptance({ verdict: "PASS", coverage: executedCoverage }),
    ).toEqual({
      policyVersion: "1",
      advisory: true,
      outcome: "ACCEPT",
      reasonCodes: ["EXECUTION_PASSED", "REQUIRED_COVERAGE_EXECUTED"],
    });

    for (const status of ["OBSERVED", "DECLARED", "UNVERIFIED"] as const) {
      const incomplete = {
        ...executedCoverage[0]!,
        status,
        provenance:
          status === "OBSERVED"
            ? {
                type: "INSPECTION" as const,
                observation: "BUILD_SCRIPT_PRESENT" as const,
              }
            : status === "DECLARED"
              ? {
                  type: "CONTRACT_DECLARATION" as const,
                  contractVersion: "1" as const,
                }
              : null,
        reasonCode:
          status === "DECLARED"
            ? ("CLAIM_NOT_MACHINE_VERIFIED" as const)
            : status === "UNVERIFIED"
              ? ("CHECK_NOT_REPORTED" as const)
              : null,
      };
      expect(
        decideAcceptance({ verdict: "PASS", coverage: [incomplete] }).outcome,
      ).toBe("HUMAN_REVIEW");
    }
  });

  it("remediates failures or a machine-observed prohibited condition", () => {
    expect(
      decideAcceptance({ verdict: "FAIL", coverage: executedCoverage }),
    ).toMatchObject({
      outcome: "REMEDIATE",
      reasonCodes: ["EXECUTION_FAILED"],
    });

    const observedProhibition: CriterionCoverage = {
      criterionId: "network",
      kind: "outbound-network-during-test",
      required: true,
      status: "OBSERVED",
      provenance: {
        type: "PLATFORM_CONTROL",
        control: "TEST_NETWORK_DISABLED",
        status: "VIOLATED",
      },
      reasonCode: null,
    };
    expect(
      decideAcceptance({
        verdict: "PASS",
        coverage: [...executedCoverage, observedProhibition],
      }),
    ).toMatchObject({
      outcome: "REMEDIATE",
      reasonCodes: ["PROHIBITED_CONDITION_OBSERVED"],
    });
  });

  it("routes inconclusive results to human review without network or model calls", () => {
    vi.stubGlobal("fetch", () => {
      throw new Error("decision policy must not use the network");
    });
    expect(
      decideAcceptance({
        verdict: "INCONCLUSIVE",
        coverage: executedCoverage,
      }),
    ).toEqual({
      policyVersion: "1",
      advisory: true,
      outcome: "HUMAN_REVIEW",
      reasonCodes: ["EXECUTION_INCONCLUSIVE"],
    });
  });
});
