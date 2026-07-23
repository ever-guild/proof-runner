import { z } from "zod";
import {
  ContractVersionSchema,
  IsoDateTimeSchema,
  UuidSchema,
} from "./common.js";
import {
  ExecutionStageSchema,
  RunStatusSchema,
  VerificationReportSchema,
  VerifyRequestSchema,
} from "./public.js";

export const INTERNAL_AUTH_SCHEME = "Bearer" as const;
export const INTERNAL_RUNNER_ROUTES = {
  dispatch: { method: "POST", path: "/internal/v1/runs" },
  heartbeat: { method: "POST", path: "/internal/v1/runs/:id/heartbeat" },
  status: { method: "GET", path: "/internal/v1/runs/:id/status" },
  result: { method: "PUT", path: "/internal/v1/runs/:id/result" },
  cancel: { method: "POST", path: "/internal/v1/runs/:id/cancel" },
} as const;

export const LeaseSchema = z.object({
  leaseId: UuidSchema,
  leaseExpiresAt: IsoDateTimeSchema,
});

export const InternalDispatchRequestSchema = z.object({
  contractVersion: ContractVersionSchema,
  runId: UuidSchema,
  lease: LeaseSchema,
  request: VerifyRequestSchema,
});

export const InternalDispatchResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  runId: UuidSchema,
  accepted: z.literal(true),
  lease: LeaseSchema,
});

export const InternalHeartbeatRequestSchema = z.object({
  contractVersion: ContractVersionSchema,
  leaseId: UuidSchema,
  observedAt: IsoDateTimeSchema,
  activeStage: ExecutionStageSchema.nullable(),
});

export const InternalHeartbeatResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  lease: LeaseSchema,
  cancellationRequested: z.boolean(),
});

export const InternalStatusResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  runId: UuidSchema,
  lease: LeaseSchema,
  status: RunStatusSchema,
  activeStage: ExecutionStageSchema.nullable(),
  cancellationRequested: z.boolean(),
  lastHeartbeatAt: IsoDateTimeSchema,
});

const InternalResultBaseSchema = z.object({
  contractVersion: ContractVersionSchema,
  leaseId: UuidSchema,
  completedAt: IsoDateTimeSchema,
});
export const InternalCompletedResultSchema = InternalResultBaseSchema.extend({
  status: z.literal("COMPLETED"),
  report: VerificationReportSchema,
  systemError: z.null(),
});
export const InternalTimeoutResultSchema = InternalResultBaseSchema.extend({
  status: z.literal("TIMEOUT"),
  report: VerificationReportSchema,
  systemError: z.null(),
});
export const InternalSystemErrorResultSchema = InternalResultBaseSchema.extend({
  status: z.literal("SYSTEM_ERROR"),
  report: z.null(),
  systemError: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
});
export const InternalResultDeliveryRequestSchema = z
  .discriminatedUnion("status", [
    InternalCompletedResultSchema,
    InternalTimeoutResultSchema,
    InternalSystemErrorResultSchema,
  ])
  .superRefine((result, context) => {
    if (result.status === "TIMEOUT" && result.report.verdict !== "INCONCLUSIVE") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "timeout reports are always inconclusive",
        path: ["report", "verdict"],
      });
    }
  });

export const InternalResultDeliveryResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  runId: UuidSchema,
  accepted: z.literal(true),
});

export const InternalCancellationRequestSchema = z.object({
  contractVersion: ContractVersionSchema,
  reason: z.enum(["USER_REQUESTED", "LEASE_EXPIRED", "SHUTDOWN"]),
  requestedAt: IsoDateTimeSchema,
});

export const InternalCancellationResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  runId: UuidSchema,
  cancellationRequested: z.literal(true),
});

export const InternalTransportErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INVALID_REQUEST",
  "VERSION_MISMATCH",
  "RUN_NOT_FOUND",
  "RUN_ALREADY_DISPATCHED",
  "RUN_ALREADY_TERMINAL",
  "LEASE_MISMATCH",
  "LEASE_EXPIRED",
  "RESULT_CONFLICT",
  "RUNNER_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const InternalTransportErrorSchema = z.object({
  contractVersion: ContractVersionSchema,
  error: z.object({
    code: InternalTransportErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
});

export type InternalDispatchRequest = z.infer<
  typeof InternalDispatchRequestSchema
>;
export type InternalResultDeliveryRequest = z.infer<
  typeof InternalResultDeliveryRequestSchema
>;
