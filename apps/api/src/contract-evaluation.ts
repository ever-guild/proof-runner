import {
  CriterionCoverageSchema,
  type CriterionCoverage,
  type VerificationContract,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";

const platformControls = {
  "arbitrary-command": "COMMAND_ALLOWLIST",
  "outbound-network-during-build": "BUILD_NETWORK_DISABLED",
  "outbound-network-during-test": "TEST_NETWORK_DISABLED",
} as const;

/**
 * Converts a contract and an immutable terminal report into coverage without
 * changing the execution verdict or the signed report.
 */
export const evaluateVerificationContract = (
  contract: VerificationContract,
  report: VerificationReport | null,
): CriterionCoverage[] => {
  const criteria: CriterionCoverage[] = contract.criteria.map((criterion) => {
    if (!report) {
      return {
        criterionId: criterion.id,
        kind: criterion.kind,
        required: criterion.required,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "RUN_NOT_TERMINAL",
      };
    }

    const stage = criterion.kind === "build" ? "BUILD" : "TEST";
    const checkId = criterion.kind === "build" ? "build" : "test";
    const check = report.checks.find(
      (candidate) =>
        candidate.id === checkId && candidate.stage === stage,
    );
    if (!check) {
      return {
        criterionId: criterion.id,
        kind: criterion.kind,
        required: criterion.required,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "CHECK_NOT_REPORTED",
      };
    }
    if (["PENDING", "RUNNING", "SKIPPED"].includes(check.outcome)) {
      return {
        criterionId: criterion.id,
        kind: criterion.kind,
        required: criterion.required,
        status: "UNVERIFIED",
        provenance: null,
        reasonCode: "CHECK_NOT_EXECUTED",
      };
    }
    return {
      criterionId: criterion.id,
      kind: criterion.kind,
      required: criterion.required,
      status: "EXECUTED",
      provenance: {
        type: "NORMALIZED_CHECK",
        checkId: check.id,
        outcome: check.outcome,
      },
      reasonCode: null,
    };
  });

  const prohibitions: CriterionCoverage[] = contract.prohibitions.map(
    (prohibition) => {
      if (!report) {
        return {
          criterionId: prohibition.id,
          kind: prohibition.kind,
          required: true,
          status: "UNVERIFIED",
          provenance: null,
          reasonCode: "RUN_NOT_TERMINAL",
        };
      }
      const evidence = report.platformControls?.find(
        (candidate) =>
          candidate.control === platformControls[prohibition.kind],
      );
      if (!evidence) {
        return {
          criterionId: prohibition.id,
          kind: prohibition.kind,
          required: true,
          status: "UNVERIFIED",
          provenance: null,
          reasonCode: "PLATFORM_CONTROL_NOT_PROVEN",
        };
      }
      return {
        criterionId: prohibition.id,
        kind: prohibition.kind,
        required: true,
        status: evidence.status === "ENFORCED" ? "EXECUTED" : "OBSERVED",
        provenance: {
          type: "PLATFORM_CONTROL",
          control: evidence.control,
          status: evidence.status,
        },
        reasonCode: null,
      };
    },
  );

  return CriterionCoverageSchema.array().parse([...criteria, ...prohibitions]);
};
