import { z } from "zod";
import {
  ContractVersionSchema,
  FullCommitShaSchema,
  IsoDateTimeSchema,
  RepositoryRefSchema,
  RepositoryUrlSchema,
  RuntimeImageDigestSchema,
  Sha256Schema,
  UuidSchema,
} from "./common.js";

export const PUBLIC_API_ROUTES = {
  inspect: { method: "POST", path: "/api/inspect" },
  verify: { method: "POST", path: "/api/verify" },
  run: { method: "GET", path: "/api/runs/:id" },
  receipt: { method: "GET", path: "/api/receipts/:id" },
  receiptPublicKey: { method: "GET", path: "/api/receipt-keys/:keyId" },
  verifyReceipt: { method: "POST", path: "/api/receipts/verify" },
} as const;

export const RunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "TIMEOUT",
  "SYSTEM_ERROR",
]);
export const VerdictSchema = z.enum(["PASS", "FAIL", "INCONCLUSIVE"]);
export const ExecutionStageSchema = z.enum([
  "REPOSITORY",
  "SANDBOX",
  "INSTALL",
  "BUILD",
  "TEST",
  "RECEIPT",
]);
export const CheckOutcomeSchema = z.enum([
  "PENDING",
  "RUNNING",
  "PASSED",
  "FAILED",
  "SKIPPED",
  "INCONCLUSIVE",
]);

export const InspectRequestSchema = z.object({
  contractVersion: ContractVersionSchema,
  repositoryUrl: RepositoryUrlSchema,
  ref: RepositoryRefSchema,
});

const RepositoryInspectionSchema = z.object({
  repositoryUrl: RepositoryUrlSchema,
  requestedRef: RepositoryRefSchema,
  resolvedCommitSha: FullCommitShaSchema,
  packageManager: z.enum(["npm", "pnpm"]),
  lockfile: z.enum(["package-lock.json", "pnpm-lock.yaml"]),
  nodeVersion: z.string().min(1).nullable(),
  hasTypeScript: z.boolean(),
  scripts: z.object({
    build: z.string().min(1).nullable(),
    test: z.string().min(1).nullable(),
  }),
  selectedSkill: z.literal("node-typescript@1"),
  selectedSkillHash: Sha256Schema,
});

export const UnsupportedReasonSchema = z.enum([
  "INVALID_REPOSITORY_URL",
  "REF_NOT_FOUND",
  "UNSUPPORTED_HOST",
  "UNSUPPORTED_PACKAGE_MANAGER",
  "LOCKFILE_MISSING",
  "LOCKFILE_MISMATCH",
  "SUBMODULES_UNSUPPORTED",
  "GIT_LFS_UNSUPPORTED",
  "REPOSITORY_LIMIT_EXCEEDED",
  "LIFECYCLE_SCRIPTS_REQUIRED",
  "NO_SUPPORTED_SKILL",
]);

export const InspectResultSchema = z.discriminatedUnion("supported", [
  z.object({
    contractVersion: ContractVersionSchema,
    supported: z.literal(true),
    inspection: RepositoryInspectionSchema,
  }),
  z.object({
    contractVersion: ContractVersionSchema,
    supported: z.literal(false),
    reason: UnsupportedReasonSchema,
    message: z.string().min(1),
  }),
]);

export const VerifyRequestSchema = z.object({
  contractVersion: ContractVersionSchema,
  repositoryUrl: RepositoryUrlSchema,
  resolvedCommitSha: FullCommitShaSchema,
  resolvedRef: RepositoryRefSchema,
  skill: z.object({
    name: z.literal("node-typescript"),
    version: z.literal("1"),
    hash: Sha256Schema,
  }),
  public: z.boolean().default(false),
});

export const NormalizedCheckSchema = z.object({
  id: z.string().min(1).max(64),
  stage: ExecutionStageSchema,
  title: z.string().min(1).max(160),
  outcome: CheckOutcomeSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  exitCode: z.number().int().nullable(),
  summary: z.string().max(2_000),
});

export const VerificationReportSchema = z.object({
  contractVersion: ContractVersionSchema,
  runId: UuidSchema,
  repositoryUrl: RepositoryUrlSchema,
  resolvedCommitSha: FullCommitShaSchema,
  resolvedRef: RepositoryRefSchema,
  skill: z.object({
    name: z.literal("node-typescript"),
    version: z.literal("1"),
    hash: Sha256Schema,
  }),
  runtimeImageDigest: RuntimeImageDigestSchema,
  verdict: VerdictSchema,
  checks: z.array(NormalizedCheckSchema).min(1),
  durationMs: z.number().int().nonnegative(),
  completedAt: IsoDateTimeSchema,
  reasonCode: z.string().min(1).nullable(),
}).superRefine((report, context) => {
  const outcomes = report.checks.map((check) => check.outcome);
  if (
    report.verdict === "PASS" &&
    outcomes.some((outcome) => !["PASSED", "SKIPPED"].includes(outcome))
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "PASS reports may contain only passed or skipped checks",
      path: ["checks"],
    });
  }
  if (report.verdict === "FAIL" && !outcomes.includes("FAILED")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "FAIL reports require a failed check",
      path: ["checks"],
    });
  }
  if (
    report.verdict === "INCONCLUSIVE" &&
    !outcomes.includes("INCONCLUSIVE")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "INCONCLUSIVE reports require an inconclusive check",
      path: ["checks"],
    });
  }
});

const RunLinksSchema = z.object({
  self: z.string().startsWith("/api/runs/"),
  receipt: z.string().startsWith("/api/receipts/").nullable(),
});
const SystemErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean(),
});
const RunBaseSchema = z.object({
  contractVersion: ContractVersionSchema,
  id: UuidSchema,
  createdAt: IsoDateTimeSchema,
  links: RunLinksSchema,
});

export const QueuedRunResponseSchema = RunBaseSchema.extend({
  status: z.literal("QUEUED"),
  verdict: z.null(),
  activeStage: z.null(),
  queuePosition: z.number().int().min(1).max(5),
  startedAt: z.null(),
  completedAt: z.null(),
  report: z.null(),
  systemError: z.null(),
});
export const RunningRunResponseSchema = RunBaseSchema.extend({
  status: z.literal("RUNNING"),
  verdict: z.null(),
  activeStage: ExecutionStageSchema,
  queuePosition: z.null(),
  startedAt: IsoDateTimeSchema,
  completedAt: z.null(),
  report: z.null(),
  systemError: z.null(),
});
export const CompletedRunResponseSchema = RunBaseSchema.extend({
  status: z.literal("COMPLETED"),
  verdict: VerdictSchema,
  activeStage: z.null(),
  queuePosition: z.null(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  report: VerificationReportSchema,
  systemError: z.null(),
});
export const TimeoutRunResponseSchema = RunBaseSchema.extend({
  status: z.literal("TIMEOUT"),
  verdict: z.literal("INCONCLUSIVE"),
  activeStage: z.null(),
  queuePosition: z.null(),
  startedAt: IsoDateTimeSchema,
  completedAt: IsoDateTimeSchema,
  report: VerificationReportSchema,
  systemError: z.null(),
});
export const SystemErrorRunResponseSchema = RunBaseSchema.extend({
  status: z.literal("SYSTEM_ERROR"),
  verdict: z.literal("INCONCLUSIVE"),
  activeStage: z.null(),
  queuePosition: z.null(),
  startedAt: IsoDateTimeSchema.nullable(),
  completedAt: IsoDateTimeSchema,
  report: z.null(),
  systemError: SystemErrorSchema,
});

export const RunResponseSchema = z
  .discriminatedUnion("status", [
    QueuedRunResponseSchema,
    RunningRunResponseSchema,
    CompletedRunResponseSchema,
    TimeoutRunResponseSchema,
    SystemErrorRunResponseSchema,
  ])
  .superRefine((run, context) => {
    if (
      run.report !== null &&
      (run.report.runId !== run.id || run.report.verdict !== run.verdict)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "run and report identities and verdicts must match",
        path: ["report"],
      });
    }
    if (run.status === "TIMEOUT" && run.report.verdict !== "INCONCLUSIVE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeout reports are always inconclusive",
        path: ["report", "verdict"],
      });
    }
    if (
      ["QUEUED", "RUNNING", "SYSTEM_ERROR"].includes(run.status) &&
      run.links.receipt !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "this run state cannot expose a receipt",
        path: ["links", "receipt"],
      });
    }
    if (
      ["COMPLETED", "TIMEOUT"].includes(run.status) &&
      run.links.receipt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "report-bearing terminal runs require a receipt link",
        path: ["links", "receipt"],
      });
    }
  });

export const VerifyCreationResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  run: RunResponseSchema,
  replayed: z.boolean(),
});

export const IdempotencyKeyHeaderSchema = z.string().min(1).max(255);
export const VerifyHttpRequestSchema = z.object({
  headers: z.object({
    "idempotency-key": IdempotencyKeyHeaderSchema,
  }),
  body: VerifyRequestSchema,
});

export const ReceiptPayloadSchema = z.object({
  contractVersion: ContractVersionSchema,
  id: UuidSchema,
  report: VerificationReportSchema,
  createdAt: IsoDateTimeSchema,
});

export const SignedReceiptSchema = z.object({
  contractVersion: ContractVersionSchema,
  payload: ReceiptPayloadSchema,
  canonicalization: z.literal("JCS-RFC8785"),
  hashAlgorithm: z.literal("SHA-256"),
  payloadHash: Sha256Schema,
  signatureAlgorithm: z.literal("Ed25519"),
  keyId: z.string().min(1),
  signature: z.string().min(1),
});

export const ReceiptPublicKeySchema = z.object({
  contractVersion: ContractVersionSchema,
  keyId: z.string().min(1),
  signatureAlgorithm: z.literal("Ed25519"),
  publicKey: z.string().min(1),
});

export const ReceiptVerificationResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  valid: z.boolean(),
  reason: z
    .enum([
      "PAYLOAD_HASH_MISMATCH",
      "UNKNOWN_KEY",
      "INVALID_SIGNATURE",
      "INVALID_RECEIPT",
    ])
    .nullable(),
});

export const PublicErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "REQUEST_BODY_TOO_LARGE",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_CONFLICT",
  "RUN_QUEUE_FULL",
  "RUN_NOT_FOUND",
  "RECEIPT_NOT_FOUND",
  "INTERNAL_ERROR",
]);

export const PublicErrorResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  error: z.object({
    code: PublicErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export const RunQueueFullResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  error: z.object({
    code: z.literal("RUN_QUEUE_FULL"),
    message: z.string().min(1),
    retryable: z.literal(true),
    capacity: z.object({
      active: z.literal(1),
      waiting: z.literal(5),
    }),
  }),
});

export type InspectRequest = z.infer<typeof InspectRequestSchema>;
export type InspectResult = z.infer<typeof InspectResultSchema>;
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type NormalizedCheck = z.infer<typeof NormalizedCheckSchema>;
export type VerificationReport = z.infer<typeof VerificationReportSchema>;
export type RunResponse = z.infer<typeof RunResponseSchema>;
export type SignedReceipt = z.infer<typeof SignedReceiptSchema>;
export type ReceiptPublicKey = z.infer<typeof ReceiptPublicKeySchema>;
export type ReceiptVerificationResponse = z.infer<
  typeof ReceiptVerificationResponseSchema
>;
