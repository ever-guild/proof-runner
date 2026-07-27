import { z } from "zod";
import {
  FullCommitShaSchema,
  RepositoryUrlSchema,
  RuntimeImageDigestSchema,
  Sha256Schema,
} from "./common.js";

export const VerificationContractVersionSchema = z.literal("1");

export const VerificationCriterionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9._-]*$/);

export const VerificationCriterionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: VerificationCriterionIdSchema,
      kind: z.literal("build"),
      required: z.boolean(),
    })
    .strict(),
  z
    .object({
      id: VerificationCriterionIdSchema,
      kind: z.literal("test-suite"),
      required: z.boolean(),
    })
    .strict(),
]);

export const PlatformProhibitionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      id: VerificationCriterionIdSchema,
      kind: z.literal("arbitrary-command"),
      enforcement: z.literal("PLATFORM"),
    })
    .strict(),
  z
    .object({
      id: VerificationCriterionIdSchema,
      kind: z.literal("outbound-network-during-build"),
      enforcement: z.literal("PLATFORM"),
    })
    .strict(),
  z
    .object({
      id: VerificationCriterionIdSchema,
      kind: z.literal("outbound-network-during-test"),
      enforcement: z.literal("PLATFORM"),
    })
    .strict(),
]);

export const VerificationContractSchema = z
  .object({
    version: VerificationContractVersionSchema,
    subject: z
      .object({
        repositoryUrl: RepositoryUrlSchema,
        resolvedCommitSha: FullCommitShaSchema,
        skillHash: Sha256Schema,
        runtimeImageDigest: RuntimeImageDigestSchema,
      })
      .strict(),
    criteria: z.array(VerificationCriterionSchema).min(1).max(16),
    prohibitions: z.array(PlatformProhibitionSchema).max(8),
  })
  .strict()
  .superRefine((contract, context) => {
    const ids = new Set<string>();
    const criterionKinds = new Set<string>();
    const prohibitionKinds = new Set<string>();
    for (const requirement of [
      ...contract.criteria,
      ...contract.prohibitions,
    ]) {
      if (ids.has(requirement.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "verification requirement IDs must be unique",
          path: ["criteria"],
        });
      }
      ids.add(requirement.id);
    }
    for (const [index, criterion] of contract.criteria.entries()) {
      if (criterionKinds.has(criterion.kind)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "contract version 1 permits at most one criterion of each kind",
          path: ["criteria", index, "kind"],
        });
      }
      criterionKinds.add(criterion.kind);
    }
    for (const [index, prohibition] of contract.prohibitions.entries()) {
      if (prohibitionKinds.has(prohibition.kind)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "contract version 1 permits at most one prohibition of each kind",
          path: ["prohibitions", index, "kind"],
        });
      }
      prohibitionKinds.add(prohibition.kind);
    }
  });

export const CriterionCoverageStatusSchema = z.enum([
  "EXECUTED",
  "OBSERVED",
  "DECLARED",
  "UNVERIFIED",
]);

export const CriterionCoverageReasonCodeSchema = z.enum([
  "RUN_NOT_TERMINAL",
  "CHECK_NOT_REPORTED",
  "CHECK_NOT_EXECUTED",
  "PLATFORM_CONTROL_NOT_PROVEN",
  "CLAIM_NOT_MACHINE_VERIFIED",
  "UNSUPPORTED_CRITERION",
]);

export const CriterionCoverageProvenanceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("NORMALIZED_CHECK"),
      checkId: VerificationCriterionIdSchema,
      outcome: z.enum([
        "PENDING",
        "RUNNING",
        "PASSED",
        "FAILED",
        "SKIPPED",
        "INCONCLUSIVE",
      ]),
    })
    .strict(),
  z
    .object({
      type: z.literal("PLATFORM_CONTROL"),
      control: z.enum([
        "COMMAND_ALLOWLIST",
        "BUILD_NETWORK_DISABLED",
        "TEST_NETWORK_DISABLED",
      ]),
      status: z.enum(["ENFORCED", "VIOLATED"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("INSPECTION"),
      observation: z.enum(["BUILD_SCRIPT_PRESENT", "TEST_SCRIPT_PRESENT"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("CONTRACT_DECLARATION"),
      contractVersion: VerificationContractVersionSchema,
    })
    .strict(),
]);

export const CriterionCoverageSchema = z
  .object({
    criterionId: VerificationCriterionIdSchema,
    kind: z.enum([
      "build",
      "test-suite",
      "arbitrary-command",
      "outbound-network-during-build",
      "outbound-network-during-test",
    ]),
    required: z.boolean(),
    status: CriterionCoverageStatusSchema,
    provenance: CriterionCoverageProvenanceSchema.nullable(),
    reasonCode: CriterionCoverageReasonCodeSchema.nullable(),
  })
  .strict()
  .superRefine((coverage, context) => {
    const invalid = (message: string, path: string): void => {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message,
        path: [path],
      });
    };

    if (coverage.status === "EXECUTED") {
      if (
        coverage.provenance?.type !== "NORMALIZED_CHECK" &&
        !(
          coverage.provenance?.type === "PLATFORM_CONTROL" &&
          coverage.provenance.status === "ENFORCED"
        )
      ) {
        invalid("executed coverage requires machine provenance", "provenance");
      }
      if (coverage.reasonCode !== null) {
        invalid("executed coverage cannot have a reason code", "reasonCode");
      }
    }
    if (coverage.status === "OBSERVED") {
      const prohibition = !["build", "test-suite"].includes(coverage.kind);
      if (
        coverage.provenance?.type !== "INSPECTION" &&
        !(
          prohibition &&
          coverage.provenance?.type === "PLATFORM_CONTROL" &&
          coverage.provenance.status === "VIOLATED"
        )
      ) {
        invalid(
          "observed coverage requires typed machine provenance",
          "provenance",
        );
      }
      if (coverage.reasonCode !== null) {
        invalid("observed coverage cannot have a reason code", "reasonCode");
      }
    }
    if (coverage.status === "DECLARED") {
      if (coverage.provenance?.type !== "CONTRACT_DECLARATION") {
        invalid("declared coverage requires contract provenance", "provenance");
      }
      if (coverage.reasonCode !== "CLAIM_NOT_MACHINE_VERIFIED") {
        invalid(
          "declared coverage must remain explicitly unverified",
          "reasonCode",
        );
      }
    }
    if (coverage.status === "UNVERIFIED") {
      if (coverage.provenance !== null) {
        invalid("unverified coverage cannot claim provenance", "provenance");
      }
      if (coverage.reasonCode === null) {
        invalid("unverified coverage requires a reason code", "reasonCode");
      }
    }
  });

export const VerificationEvaluationSchema = z
  .object({
    contract: VerificationContractSchema,
    coverage: z.array(CriterionCoverageSchema).min(1).max(24),
  })
  .strict();

export type VerificationContract = z.infer<typeof VerificationContractSchema>;
export type CriterionCoverage = z.infer<typeof CriterionCoverageSchema>;
export type VerificationEvaluation = z.infer<
  typeof VerificationEvaluationSchema
>;
