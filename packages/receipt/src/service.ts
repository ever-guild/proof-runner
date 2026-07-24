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
  verifyReceipt,
} from "./index.js";
import { ReceiptStore, type PersistReceiptOptions, type StoredReceipt } from "./store.js";

export class ReceiptService {
  readonly signer: ReceiptSigner;

  constructor(
    config: ReceiptSignerConfig,
    private readonly store: ReceiptStore,
    private readonly verificationKeys: ReceiptVerifierKey[] = [],
  ) {
    this.signer = new ReceiptSigner(config);
  }

  issue(report: VerificationReport, options: PersistReceiptOptions = {}): SignedReceipt {
    const receipt = this.signer.issue(report);
    this.store.save(receipt, options);
    return receipt;
  }

  get(id: string): StoredReceipt | null {
    return this.store.get(id);
  }

  publicKey(keyId: string): ReceiptPublicKey | null {
    if (keyId === this.signer.config.keyId) return this.signer.publicKey();
    const legacy = this.verificationKeys.find((key) => key.keyId === keyId);
    return legacy
      ? {
          contractVersion: "1.0",
          keyId: legacy.keyId,
          signatureAlgorithm: "Ed25519",
          publicKey: legacy.publicKeyPem,
        }
      : null;
  }

  verify(receipt: unknown): ReceiptVerificationResponse {
    return verifyReceipt(receipt, [
      { keyId: this.signer.config.keyId, publicKeyPem: this.signer.publicKeyPem },
      ...this.verificationKeys,
    ]);
  }
}
