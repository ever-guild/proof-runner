import { z } from "zod";
import {
  ContractVersionSchema,
  IsoDateTimeSchema,
  RuntimeImageDigestSchema,
  Sha256Schema,
  UuidSchema,
} from "./common.js";
import {
  CheckOutcomeSchema,
  RunStatusSchema,
  VerdictSchema,
  VerifyRequestSchema,
} from "./public.js";

export const ReproducibilityRequestSchema = VerifyRequestSchema;

export const ReproducibilityProjectionSchema = z
  .object({
    runtimeImageDigest: RuntimeImageDigestSchema,
    verdict: VerdictSchema,
    reasonCode: z.string().min(1).nullable(),
    checks: z.array(
      z
        .object({
          id: z.string().min(1).max(64),
          outcome: CheckOutcomeSchema,
        })
        .strict(),
    ),
    artifacts: z.array(
      z
        .object({
          id: z.string().min(1).max(64),
          sha256: Sha256Schema,
        })
        .strict(),
    ),
  })
  .strict();

const ReproducibilityChildSchema = z
  .object({
    runId: UuidSchema,
    status: RunStatusSchema,
    verdict: VerdictSchema.nullable(),
    receipt: z.string().startsWith("/api/receipts/").nullable(),
  })
  .strict()
  .superRefine((child, context) => {
    const reportBearing = ["COMPLETED", "TIMEOUT"].includes(child.status);
    if (reportBearing !== (child.receipt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "only report-bearing child runs expose receipt links",
        path: ["receipt"],
      });
    }
  });

export const ReproducibilityComparisonSchema = z
  .object({
    consistent: z.boolean(),
    baseline: ReproducibilityProjectionSchema,
    candidate: ReproducibilityProjectionSchema,
    baselineHash: Sha256Schema,
    candidateHash: Sha256Schema,
  })
  .strict();

const ReproducibilityBaseSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    id: UuidSchema,
    createdAt: IsoDateTimeSchema,
    children: z.tuple([
      ReproducibilityChildSchema,
      ReproducibilityChildSchema,
    ]),
    links: z
      .object({
        self: z.string().startsWith("/api/reproducibility/"),
      })
      .strict(),
  })
  .strict();

const ReproducibilityPendingResponseSchema =
  ReproducibilityBaseSchema.extend({
    status: z.enum(["QUEUED", "RUNNING"]),
    verdict: z.null(),
    reasonCode: z.null(),
    comparison: z.null(),
  });

const ReproducibilityCompletedResponseSchema =
  ReproducibilityBaseSchema.extend({
    status: z.literal("COMPLETED"),
    verdict: VerdictSchema,
    reasonCode: z.string().min(1).nullable(),
    comparison: ReproducibilityComparisonSchema.extend({
      consistent: z.literal(true),
    }),
  });

export const ReproducibilityReasonCodeSchema = z.enum([
  "NONDETERMINISTIC_RESULT",
  "CHILD_RUN_UNAVAILABLE",
]);

const ReproducibilityInconclusiveResponseSchema =
  ReproducibilityBaseSchema.extend({
    status: z.literal("INCONCLUSIVE"),
    verdict: z.literal("INCONCLUSIVE"),
    reasonCode: ReproducibilityReasonCodeSchema,
    comparison: ReproducibilityComparisonSchema.nullable(),
  });

export const ReproducibilityResponseSchema = z.discriminatedUnion("status", [
  ReproducibilityPendingResponseSchema,
  ReproducibilityCompletedResponseSchema,
  ReproducibilityInconclusiveResponseSchema,
]);

export const ReproducibilityCreationResponseSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    reproducibility: ReproducibilityResponseSchema,
    replayed: z.boolean(),
  })
  .strict();

export type ReproducibilityRequest = typeof ReproducibilityRequestSchema._output;
export type ReproducibilityProjection = z.infer<
  typeof ReproducibilityProjectionSchema
>;
export type ReproducibilityResponse = z.infer<
  typeof ReproducibilityResponseSchema
>;
