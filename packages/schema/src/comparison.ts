import { z } from "zod";
import {
  ContractVersionSchema,
  FullCommitShaSchema,
  RepositoryUrlSchema,
  RuntimeImageDigestSchema,
  Sha256Schema,
  UuidSchema,
} from "./common.js";
import {
  CheckOutcomeSchema,
  SignedReceiptSchema,
  VerdictSchema,
} from "./public.js";

const RunIdSelectorSchema = z
  .object({
    type: z.literal("run-id"),
    value: UuidSchema,
  })
  .strict();

const ReceiptHashSelectorSchema = z
  .object({
    type: z.literal("receipt-hash"),
    value: Sha256Schema,
  })
  .strict();

export const ComparisonEvidenceSelectorSchema = z.discriminatedUnion("type", [
  RunIdSelectorSchema,
  ReceiptHashSelectorSchema,
]);

export const ComparisonRequestSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    baseline: ComparisonEvidenceSelectorSchema,
    candidate: ComparisonEvidenceSelectorSchema,
  })
  .strict();

const ComparisonEvidenceSchema = z
  .object({
    selector: ComparisonEvidenceSelectorSchema,
    runId: UuidSchema,
    receiptHash: Sha256Schema,
    commitSha: FullCommitShaSchema,
    verdict: VerdictSchema,
    receipt: SignedReceiptSchema,
  })
  .strict();

export const CheckComparisonClassificationSchema = z.enum([
  "RESOLVED",
  "NEW",
  "UNCHANGED",
  "ADDED",
  "REMOVED",
]);

export const ComparisonDriftLabelSchema = z.enum([
  "VERDICT_DRIFT",
  "CHECK_SET_DRIFT",
  "CHECK_OUTCOME_DRIFT",
  "ARTIFACT_DRIFT",
]);

const ComparisonCompatibilitySchema = z
  .object({
    repositoryUrl: RepositoryUrlSchema,
    contractVersion: ContractVersionSchema,
    skill: z
      .object({
        name: z.literal("node-typescript"),
        version: z.literal("1"),
        hash: Sha256Schema,
      })
      .strict(),
    runtimeImageDigest: RuntimeImageDigestSchema,
    verificationContractHash: Sha256Schema.nullable(),
  })
  .strict();

export const ComparisonResponseSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    id: Sha256Schema,
    baseline: ComparisonEvidenceSchema,
    candidate: ComparisonEvidenceSchema,
    compatibility: ComparisonCompatibilitySchema,
    checks: z.array(
      z
        .object({
          checkId: z.string().min(1).max(64),
          classification: CheckComparisonClassificationSchema,
          baselineOutcome: CheckOutcomeSchema.nullable(),
          candidateOutcome: CheckOutcomeSchema.nullable(),
        })
        .strict(),
    ),
    driftLabels: z.array(ComparisonDriftLabelSchema),
    links: z
      .object({
        self: z.string().startsWith("/api/comparisons/"),
        ui: z.string().startsWith("/compare/"),
      })
      .strict(),
  })
  .strict()
  .superRefine((comparison, context) => {
    for (const sideName of ["baseline", "candidate"] as const) {
      const side = comparison[sideName];
      const report = side.receipt.payload.report;
      const contradictions = [
        ["runId", side.runId, report.runId],
        ["receiptHash", side.receiptHash, side.receipt.payloadHash],
        ["commitSha", side.commitSha, report.resolvedCommitSha],
        ["verdict", side.verdict, report.verdict],
        [
          "repositoryUrl",
          comparison.compatibility.repositoryUrl,
          report.repositoryUrl,
        ],
        [
          "contractVersion",
          comparison.compatibility.contractVersion,
          report.contractVersion,
        ],
        [
          "skill.name",
          comparison.compatibility.skill.name,
          report.skill.name,
        ],
        [
          "skill.version",
          comparison.compatibility.skill.version,
          report.skill.version,
        ],
        [
          "skill.hash",
          comparison.compatibility.skill.hash,
          report.skill.hash,
        ],
        [
          "runtimeImageDigest",
          comparison.compatibility.runtimeImageDigest,
          report.runtimeImageDigest,
        ],
      ] as const;
      for (const [field, actual, expected] of contradictions) {
        if (actual !== expected) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field} contradicts the signed receipt`,
            path: [sideName, field],
          });
        }
      }
      if (side.receipt.payload.id !== side.runId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "receipt payload ID contradicts the selected run",
          path: [sideName, "receipt", "payload", "id"],
        });
      }
    }

    const checkIds = comparison.checks.map((check) => check.checkId);
    if (new Set(checkIds).size !== checkIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "comparison check IDs must be unique",
        path: ["checks"],
      });
    }
    if (
      new Set(comparison.driftLabels).size !==
      comparison.driftLabels.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "drift labels must be unique",
        path: ["driftLabels"],
      });
    }
  });

export type ComparisonEvidenceSelector = z.infer<
  typeof ComparisonEvidenceSelectorSchema
>;
export type ComparisonRequest = z.infer<typeof ComparisonRequestSchema>;
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;
