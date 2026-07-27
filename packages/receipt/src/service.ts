import {
  type ReceiptPublicKey,
  type ReceiptVerificationResponse,
  type SignedReceipt,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptSigner,
  type ReceiptSignerConfig,
  type ReceiptVerifierKey,
  validateReceiptKeyConfig,
  verifyReceipt,
} from "./index.js";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import { ReceiptStore, type PersistReceiptOptions, type StoredReceipt } from "./store.js";

export class ReceiptService {
  readonly signer: ReceiptSigner;
  private readonly signingKeyring: Map<string, ReceiptSigner>;

  constructor(
    config: ReceiptSignerConfig,
    private readonly store: ReceiptStore,
    private readonly verificationKeys: ReceiptVerifierKey[] = [],
    signingKeys: ReceiptSignerConfig[] = [],
  ) {
    validateReceiptKeyConfig(config, verificationKeys, signingKeys);
    this.signer = new ReceiptSigner(config);
    this.signingKeyring = new Map(
      [this.signer, ...signingKeys.map((key) => new ReceiptSigner(key))].map(
        (signer) => [signer.config.keyId, signer],
      ),
    );
  }

  issue(report: VerificationReport, options: PersistReceiptOptions = {}): SignedReceipt {
    const receipt = this.signer.issue(report);
    this.store.save(receipt, options);
    return receipt;
  }

  get(id: string): StoredReceipt | null {
    return this.store.get(id);
  }

  getByPayloadHash(payloadHash: string): StoredReceipt | null {
    return this.store.getByPayloadHash(payloadHash);
  }

  publicKey(keyId: string): ReceiptPublicKey | null {
    const signingKey = this.signingKeyring.get(keyId);
    if (signingKey) return signingKey.publicKey();
    const legacy = this.verificationKeys.find((key) => key.keyId === keyId);
    return legacy
      ? {
          contractVersion: CONTRACT_VERSION,
          keyId: legacy.keyId,
          signatureAlgorithm: "Ed25519",
          publicKey: legacy.publicKeyPem,
        }
      : null;
  }

  signerFor(keyId: string): ReceiptSigner | null {
    return this.signingKeyring.get(keyId) ?? null;
  }

  verify(receipt: unknown): ReceiptVerificationResponse {
    return verifyReceipt(receipt, [
      ...[...this.signingKeyring.values()].map((signer) => ({
        keyId: signer.config.keyId,
        publicKeyPem: signer.publicKeyPem,
      })),
      ...this.verificationKeys,
    ]);
  }
}
