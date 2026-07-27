import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  EvidenceBundleManifestSchema,
  EvidenceBundleSignatureSchema,
  EvidenceBundleVerificationResponseSchema,
  PUBLIC_API_ROUTES,
} from "../src/index.js";

const manifest = {
  bundleVersion: "1",
  contractVersion: CONTRACT_VERSION,
  receipt: {
    id: "018f47ac-5d7b-7c20-a1aa-0242ac120301",
    payloadHash: "a".repeat(64),
    keyId: "receipt-key-1",
  },
  createdAt: "2026-07-26T12:00:00.000Z",
  files: [
    {
      path: "receipt.json",
      role: "RECEIPT",
      mediaType: "application/json",
      sha256: "b".repeat(64),
      bytes: 1_024,
    },
    {
      path: "report.json",
      role: "REPORT",
      mediaType: "application/json",
      sha256: "c".repeat(64),
      bytes: 512,
    },
  ],
  omissions: [
    {
      path: "logs/raw.ndjson",
      reason: "RAW_LOG_EXPIRED",
    },
  ],
  metadata: {
    manifestPath: "bundle-manifest.json",
    signaturePath: "bundle-manifest.sig",
    checksumsPath: "checksums.txt",
    digestExclusions: [
      "bundle-manifest.json",
      "bundle-manifest.sig",
      "checksums.txt",
    ],
  },
} as const;

describe("evidence bundle contracts", () => {
  it("defines download and offline verification routes", () => {
    expect(PUBLIC_API_ROUTES.receiptBundle).toEqual({
      method: "GET",
      path: "/api/receipts/:id/bundle",
    });
    expect(PUBLIC_API_ROUTES.verifyEvidenceBundle).toEqual({
      method: "POST",
      path: "/api/evidence-bundles/verify",
    });
  });

  it("makes metadata self-reference exclusions explicit", () => {
    expect(EvidenceBundleManifestSchema.parse(manifest)).toEqual(manifest);
    expect(
      EvidenceBundleSignatureSchema.parse({
        bundleVersion: "1",
        keyId: "receipt-key-1",
        canonicalization: "JCS-RFC8785",
        hashAlgorithm: "SHA-256",
        manifestHash: "d".repeat(64),
        signatureAlgorithm: "Ed25519",
        signature: `${"A".repeat(86)}==`,
      }).manifestHash,
    ).toBe("d".repeat(64));
  });

  it("rejects unsafe, duplicate, and metadata-covered payload paths", () => {
    expect(
      EvidenceBundleManifestSchema.safeParse({
        ...manifest,
        files: [
          ...manifest.files,
          {
            ...manifest.files[0],
            path: "../receipt.json",
            role: "VERIFICATION_CONTRACT",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      EvidenceBundleManifestSchema.safeParse({
        ...manifest,
        files: [...manifest.files, manifest.files[0]],
      }).success,
    ).toBe(false);
    expect(
      EvidenceBundleManifestSchema.safeParse({
        ...manifest,
        files: [
          ...manifest.files,
          {
            ...manifest.files[0],
            path: "bundle-manifest.json",
            role: "VERIFICATION_CONTRACT",
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("returns bounded verification reasons without exposing archive data", () => {
    expect(
      EvidenceBundleVerificationResponseSchema.parse({
        contractVersion: CONTRACT_VERSION,
        valid: false,
        reason: "CHECKSUM_MISMATCH",
        bundleId: null,
      }),
    ).toEqual({
      contractVersion: CONTRACT_VERSION,
      valid: false,
      reason: "CHECKSUM_MISMATCH",
      bundleId: null,
    });
  });

  it("accepts 128-character boundary and 129-character first-above-boundary key IDs in manifest and signature", () => {
    const keyId128 = "k".repeat(128);
    const keyId129 = "k".repeat(129);

    for (const keyId of [keyId128, keyId129]) {
      const manifestWithKey = {
        ...manifest,
        receipt: {
          ...manifest.receipt,
          keyId,
        },
      };
      expect(EvidenceBundleManifestSchema.parse(manifestWithKey).receipt.keyId).toBe(keyId);

      const signatureWithKey = {
        bundleVersion: "1",
        keyId,
        canonicalization: "JCS-RFC8785",
        hashAlgorithm: "SHA-256",
        manifestHash: "d".repeat(64),
        signatureAlgorithm: "Ed25519",
        signature: `${"A".repeat(86)}==`,
      };
      expect(EvidenceBundleSignatureSchema.parse(signatureWithKey).keyId).toBe(keyId);
    }
  });
});
