import { z } from "zod";
import {
  CriterionCoverageSchema,
  type CriterionCoverage,
} from "./verification-contract.js";

export const AcceptanceDecisionOutcomeSchema = z.enum([
  "ACCEPT",
  "REMEDIATE",
  "HUMAN_REVIEW",
]);

export const AcceptanceDecisionReasonCodeSchema = z.enum([
  "EXECUTION_PASSED",
  "EXECUTION_FAILED",
  "EXECUTION_INCONCLUSIVE",
  "PROHIBITED_CONDITION_OBSERVED",
  "REQUIRED_COVERAGE_EXECUTED",
  "REQUIRED_COVERAGE_INCOMPLETE",
  "UNSUPPORTED_CRITERION",
]);

export const AcceptanceDecisionSchema = z
  .object({
    policyVersion: z.literal("1"),
    advisory: z.literal(true),
    outcome: AcceptanceDecisionOutcomeSchema,
    reasonCodes: z.array(AcceptanceDecisionReasonCodeSchema).min(1),
  })
  .strict();

const AcceptanceDecisionInputSchema = z
  .object({
    verdict: z.enum(["PASS", "FAIL", "INCONCLUSIVE"]),
    coverage: z.array(CriterionCoverageSchema),
  })
  .strict();

const isProhibition = (coverage: CriterionCoverage): boolean =>
  !["build", "test-suite"].includes(coverage.kind);

/**
 * Applies policy version 1 without network, model calls, or receipt mutation.
 * Callers receive an unsigned advisory decision and retain the source verdict.
 */
export const decideAcceptance = (
  candidate: z.input<typeof AcceptanceDecisionInputSchema>,
): z.infer<typeof AcceptanceDecisionSchema> => {
  const input = AcceptanceDecisionInputSchema.parse(candidate);
  const prohibitedConditionObserved = input.coverage.some(
    (coverage) =>
      isProhibition(coverage) &&
      coverage.status === "OBSERVED" &&
      coverage.provenance?.type === "PLATFORM_CONTROL" &&
      coverage.provenance.status === "VIOLATED",
  );

  if (input.verdict === "FAIL") {
    return AcceptanceDecisionSchema.parse({
      policyVersion: "1",
      advisory: true,
      outcome: "REMEDIATE",
      reasonCodes: [
        "EXECUTION_FAILED",
        ...(prohibitedConditionObserved
          ? (["PROHIBITED_CONDITION_OBSERVED"] as const)
          : []),
      ],
    });
  }

  if (prohibitedConditionObserved) {
    return AcceptanceDecisionSchema.parse({
      policyVersion: "1",
      advisory: true,
      outcome: "REMEDIATE",
      reasonCodes: ["PROHIBITED_CONDITION_OBSERVED"],
    });
  }

  if (input.verdict === "INCONCLUSIVE") {
    return AcceptanceDecisionSchema.parse({
      policyVersion: "1",
      advisory: true,
      outcome: "HUMAN_REVIEW",
      reasonCodes: ["EXECUTION_INCONCLUSIVE"],
    });
  }

  const incomplete = input.coverage.filter(
    (coverage) => coverage.required && coverage.status !== "EXECUTED",
  );
  if (incomplete.length > 0) {
    return AcceptanceDecisionSchema.parse({
      policyVersion: "1",
      advisory: true,
      outcome: "HUMAN_REVIEW",
      reasonCodes: [
        incomplete.some(
          (coverage) => coverage.reasonCode === "UNSUPPORTED_CRITERION",
        )
          ? "UNSUPPORTED_CRITERION"
          : "REQUIRED_COVERAGE_INCOMPLETE",
      ],
    });
  }

  return AcceptanceDecisionSchema.parse({
    policyVersion: "1",
    advisory: true,
    outcome: "ACCEPT",
    reasonCodes: ["EXECUTION_PASSED", "REQUIRED_COVERAGE_EXECUTED"],
  });
};

export type AcceptanceDecision = z.infer<typeof AcceptanceDecisionSchema>;
