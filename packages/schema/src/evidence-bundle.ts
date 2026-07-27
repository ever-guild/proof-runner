import { z } from "zod";
import {
  ContractVersionSchema,
  Ed25519SignatureSchema,
  IsoDateTimeSchema,
  Sha256Schema,
  UuidSchema,
} from "./common.js";

export const EVIDENCE_BUNDLE_VERSION = "1" as const;
export const EvidenceBundleVersionSchema = z.literal(
  EVIDENCE_BUNDLE_VERSION,
);

const ReceiptBundleFileSchema = z
  .object({
    path: z.literal("receipt.json"),
    role: z.literal("RECEIPT"),
    mediaType: z.literal("application/json"),
    sha256: Sha256Schema,
    bytes: z.number().int().nonnegative().max(1_048_576),
  })
  .strict();

const ReportBundleFileSchema = z
  .object({
    path: z.literal("report.json"),
    role: z.literal("REPORT"),
    mediaType: z.literal("application/json"),
    sha256: Sha256Schema,
    bytes: z.number().int().nonnegative().max(1_048_576),
  })
  .strict();

const ContractBundleFileSchema = z
  .object({
    path: z.literal("verification-contract.json"),
    role: z.literal("VERIFICATION_CONTRACT"),
    mediaType: z.literal("application/json"),
    sha256: Sha256Schema,
    bytes: z.number().int().nonnegative().max(1_048_576),
  })
  .strict();

const RawLogsBundleFileSchema = z
  .object({
    path: z.literal("logs/raw.ndjson"),
    role: z.literal("RAW_LOGS"),
    mediaType: z.literal("application/x-ndjson"),
    sha256: Sha256Schema,
    bytes: z.number().int().nonnegative().max(1_048_576),
    redactionProfile: z.literal("proofrunner-secrets-v1"),
  })
  .strict();

export const EvidenceBundleFileSchema = z.discriminatedUnion("role", [
  ReceiptBundleFileSchema,
  ReportBundleFileSchema,
  ContractBundleFileSchema,
  RawLogsBundleFileSchema,
]);

export const EvidenceBundleManifestSchema = z
  .object({
    bundleVersion: EvidenceBundleVersionSchema,
    contractVersion: ContractVersionSchema,
    receipt: z
      .object({
        id: UuidSchema,
        payloadHash: Sha256Schema,
        keyId: z.string().min(1),
      })
      .strict(),
    createdAt: IsoDateTimeSchema,
    files: z.array(EvidenceBundleFileSchema).min(2).max(4),
    omissions: z
      .array(
        z
          .object({
            path: z.literal("logs/raw.ndjson"),
            reason: z.enum([
              "RAW_LOG_EXPIRED",
              "RAW_LOG_UNAVAILABLE",
              "RAW_LOG_REDACTION_UNSAFE",
            ]),
          })
          .strict(),
      )
      .max(1),
    metadata: z
      .object({
        manifestPath: z.literal("bundle-manifest.json"),
        signaturePath: z.literal("bundle-manifest.sig"),
        checksumsPath: z.literal("checksums.txt"),
        digestExclusions: z.tuple([
          z.literal("bundle-manifest.json"),
          z.literal("bundle-manifest.sig"),
          z.literal("checksums.txt"),
        ]),
      })
      .strict(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const roles = manifest.files.map((file) => file.role);
    const expected = [
      "RECEIPT",
      "REPORT",
      ...(roles.includes("VERIFICATION_CONTRACT")
        ? ["VERIFICATION_CONTRACT"]
        : []),
      ...(roles.includes("RAW_LOGS") ? ["RAW_LOGS"] : []),
    ];
    if (
      roles.length !== new Set(roles).size ||
      roles.join(",") !== expected.join(",")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bundle payload files must be unique and deterministically ordered",
        path: ["files"],
      });
    }
    if (manifest.omissions.length > 0 && roles.includes("RAW_LOGS")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "raw logs cannot be both included and omitted",
        path: ["omissions"],
      });
    }
    const totalBytes = manifest.files.reduce(
      (sum, file) => sum + file.bytes,
      0,
    );
    if (totalBytes > 2 * 1_048_576) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bundle payload exceeds the 2 MiB manifest limit",
        path: ["files"],
      });
    }
  });

export const EvidenceBundleSignatureSchema = z
  .object({
    bundleVersion: EvidenceBundleVersionSchema,
    keyId: z.string().min(1),
    canonicalization: z.literal("JCS-RFC8785"),
    hashAlgorithm: z.literal("SHA-256"),
    manifestHash: Sha256Schema,
    signatureAlgorithm: z.literal("Ed25519"),
    signature: Ed25519SignatureSchema,
  })
  .strict();

export const EvidenceBundleVerificationReasonSchema = z.enum([
  "INVALID_ARCHIVE",
  "ARCHIVE_LIMIT_EXCEEDED",
  "UNSAFE_ARCHIVE_PATH",
  "DUPLICATE_ARCHIVE_PATH",
  "MANIFEST_INVALID",
  "MANIFEST_COVERAGE_MISMATCH",
  "CHECKSUM_MISMATCH",
  "UNKNOWN_KEY",
  "INVALID_MANIFEST_SIGNATURE",
  "INVALID_RECEIPT",
  "RECEIPT_REPORT_MISMATCH",
  "CONTRACT_MISMATCH",
]);

export const EvidenceBundleVerificationResponseSchema = z
  .object({
    contractVersion: ContractVersionSchema,
    valid: z.boolean(),
    reason: EvidenceBundleVerificationReasonSchema.nullable(),
    bundleId: Sha256Schema.nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.valid !== (result.reason === null && result.bundleId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "valid bundles require an ID and no failure reason",
        path: ["valid"],
      });
    }
  });

export type EvidenceBundleManifest = z.infer<
  typeof EvidenceBundleManifestSchema
>;
export type EvidenceBundleSignature = z.infer<
  typeof EvidenceBundleSignatureSchema
>;
export type EvidenceBundleVerificationResponse = z.infer<
  typeof EvidenceBundleVerificationResponseSchema
>;
