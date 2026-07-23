import { z } from "zod";

export const CONTRACT_VERSION = "1.0" as const;
export const ContractVersionSchema = z.literal(CONTRACT_VERSION);
export const UuidSchema = z.string().uuid();
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const FullCommitShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const RuntimeImageDigestSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/);

export const RepositoryUrlSchema = z
  .string()
  .url()
  .regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

export const RepositoryRefSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("branch"), value: z.string().min(1).max(255) }),
  z.object({ type: z.literal("tag"), value: z.string().min(1).max(255) }),
  z.object({ type: z.literal("commit"), value: FullCommitShaSchema }),
]);

export const ErrorEnvelopeSchema = z.object({
  contractVersion: ContractVersionSchema,
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
