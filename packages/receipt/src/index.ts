import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  CONTRACT_VERSION,
  ReceiptPayloadSchema,
  SignedReceiptSchema,
  type ReceiptPublicKey,
  type ReceiptVerificationResponse,
  type SignedReceipt,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import { canonicalize } from "./jcs.js";

export { canonicalize } from "./jcs.js";
export { ReceiptService } from "./service.js";
export { ReceiptStore } from "./store.js";
export type { PersistReceiptOptions, StoredReceipt } from "./store.js";

export interface ReceiptSignerConfig {
  keyId: string;
  privateKeyPem: string;
}

export interface ReceiptVerifierKey {
  keyId: string;
  publicKeyPem: string;
}

const privateKey = (pem: string): KeyObject => {
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    return key;
  } catch {
    throw new Error("PROOF_RUNNER_RECEIPT_PRIVATE_KEY must be a valid Ed25519 private key");
  }
};

export const validateReceiptKeyConfig = (
  config: ReceiptSignerConfig,
  verificationKeys: Iterable<ReceiptVerifierKey> = [],
): void => {
  if (!config.keyId.trim()) throw new Error("PROOF_RUNNER_RECEIPT_KEY_ID is required");
  privateKey(config.privateKeyPem);
  for (const key of verificationKeys) {
    try {
      const publicKey = createPublicKey(key.publicKeyPem);
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error();
    } catch {
      throw new Error("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must contain valid Ed25519 public keys");
    }
  }
};

export class ReceiptSigner {
  readonly privateKey: KeyObject;
  readonly publicKeyPem: string;

  constructor(readonly config: ReceiptSignerConfig) {
    if (!config.keyId.trim()) throw new Error("PROOF_RUNNER_RECEIPT_KEY_ID is required");
    this.privateKey = privateKey(config.privateKeyPem);
    this.publicKeyPem = createPublicKey(this.privateKey)
      .export({ type: "spki", format: "pem" })
      .toString();
  }

  publicKey(): ReceiptPublicKey {
    return {
      contractVersion: CONTRACT_VERSION,
      keyId: this.config.keyId,
      signatureAlgorithm: "Ed25519",
      publicKey: this.publicKeyPem,
    };
  }

  issue(report: VerificationReport, createdAt = report.completedAt): SignedReceipt {
    const payload = ReceiptPayloadSchema.parse({
      contractVersion: CONTRACT_VERSION,
      id: report.runId,
      report,
      createdAt,
    });
    const canonicalPayload = canonicalize(payload);
    const payloadHash = createHash("sha256").update(canonicalPayload).digest("hex");
    const signature = sign(null, Buffer.from(canonicalPayload), this.privateKey).toString("base64");
    return SignedReceiptSchema.parse({
      contractVersion: CONTRACT_VERSION,
      payload,
      canonicalization: "JCS-RFC8785",
      hashAlgorithm: "SHA-256",
      payloadHash,
      signatureAlgorithm: "Ed25519",
      keyId: this.config.keyId,
      signature,
    });
  }
}

export const verifyReceipt = (
  candidate: unknown,
  keys: Iterable<ReceiptVerifierKey>,
): ReceiptVerificationResponse => {
  const parsed = SignedReceiptSchema.safeParse(candidate);
  if (!parsed.success) return { contractVersion: CONTRACT_VERSION, valid: false, reason: "INVALID_RECEIPT" };
  const receipt = parsed.data;
  const canonicalPayload = canonicalize(receipt.payload);
  const payloadHash = createHash("sha256").update(canonicalPayload).digest("hex");
  if (payloadHash !== receipt.payloadHash) {
    return { contractVersion: CONTRACT_VERSION, valid: false, reason: "PAYLOAD_HASH_MISMATCH" };
  }
  const key = [...keys].find((entry) => entry.keyId === receipt.keyId);
  if (!key) return { contractVersion: CONTRACT_VERSION, valid: false, reason: "UNKNOWN_KEY" };
  const valid = verify(
    null,
    Buffer.from(canonicalPayload),
    createPublicKey(key.publicKeyPem),
    Buffer.from(receipt.signature, "base64"),
  );
  return {
    contractVersion: CONTRACT_VERSION,
    valid,
    reason: valid ? null : "INVALID_SIGNATURE",
  };
};
