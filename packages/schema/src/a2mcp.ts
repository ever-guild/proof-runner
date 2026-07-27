import { z } from "zod";
import { ContractVersionSchema } from "./common.js";
import {
  InspectRequestSchema,
  InspectResultSchema,
  RunResponseSchema,
  VerifyRequestSchema,
} from "./public.js";

export const A2MCP_ROUTES = {
  inspectRepository: {
    method: "POST",
    path: "/a2mcp/inspect_repository",
    freeStatus: 200,
  },
  verifyRepository: {
    method: "POST",
    path: "/a2mcp/verify_repository",
    freeStatus: 200,
    paymentRequiredStatus: 402,
    paymentRequiredHeader: "PAYMENT-REQUIRED",
  },
} as const;

export const InspectRepositoryA2McpRequestSchema = InspectRequestSchema;
export const InspectRepositoryA2McpResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  operation: z.literal("inspect_repository"),
  result: InspectResultSchema,
});

export const VerifyRepositoryA2McpRequestSchema = VerifyRequestSchema.and(
  z.object({
    idempotencyKey: z.string().min(1).max(255),
  }),
);
export const VerifyRepositoryA2McpResponseSchema = z.object({
  contractVersion: ContractVersionSchema,
  operation: z.literal("verify_repository"),
  result: RunResponseSchema,
});

export const X402PaymentRequiredV2Schema = z.object({
  x402Version: z.literal(2),
  resource: z.object({
    url: z.string().url().startsWith("https://"),
    description: z.string().min(1),
    mimeType: z.literal("application/json"),
  }),
  accepts: z
    .array(
      z.object({
        scheme: z.literal("exact"),
        network: z.string().regex(/^eip155:\d+$/),
        asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        amount: z.string().regex(/^\d+$/),
        payTo: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
        maxTimeoutSeconds: z.number().int().positive(),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});
