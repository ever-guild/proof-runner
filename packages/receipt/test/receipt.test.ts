import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MOCK_RUN_RESPONSES } from "@ever-guild/proof-runner-schema";
import { ReceiptService, ReceiptSigner, ReceiptStore, verifyReceipt } from "../src/index.js";

const privateKeyPem = (): string => generateKeyPairSync("ed25519").privateKey
  .export({ type: "pkcs8", format: "pem" }).toString();

const report = () => {
  const value = MOCK_RUN_RESPONSES.FAIL.report;
  if (!value) throw new Error("FAIL mock requires a report");
  return value;
};

describe("signed receipts", () => {
  it.each(["PASS", "FAIL", "INCONCLUSIVE"] as const)("issues a verifiable %s receipt", (verdict) => {
    const value = MOCK_RUN_RESPONSES[verdict].report;
    if (!value) throw new Error(`${verdict} mock requires a report`);
    const signer = new ReceiptSigner({ keyId: "receipt-test-1", privateKeyPem: privateKeyPem() });
    const receipt = signer.issue(value);
    expect(verifyReceipt(receipt, [{ keyId: signer.config.keyId, publicKeyPem: signer.publicKeyPem }]))
      .toMatchObject({ valid: true, reason: null });
  });

  it("signs a canonical report and detects modified payloads and signatures", () => {
    const signer = new ReceiptSigner({ keyId: "receipt-test-1", privateKeyPem: privateKeyPem() });
    const receipt = signer.issue(report());
    const keys = [{ keyId: signer.config.keyId, publicKeyPem: signer.publicKeyPem }];
    expect(verifyReceipt(receipt, keys)).toMatchObject({ valid: true, reason: null });
    expect(verifyReceipt({ ...receipt, payload: { ...receipt.payload, createdAt: "2026-07-24T00:00:00.000Z" } }, keys))
      .toMatchObject({ valid: false, reason: "PAYLOAD_HASH_MISMATCH" });
    expect(verifyReceipt({ ...receipt, signature: "AA==" }, keys))
      .toMatchObject({ valid: false, reason: "INVALID_SIGNATURE" });
  });

  it("keeps receipts and normalized checks after raw-log expiry and a SQLite restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-receipt-"));
    const databasePath = join(directory, "receipts.sqlite");
    const config = { keyId: "receipt-test-1", privateKeyPem: privateKeyPem() };
    const firstStore = new ReceiptStore(databasePath);
    const firstService = new ReceiptService(config, firstStore);
    const receipt = firstService.issue(report(), {
      rawLogs: [{ stream: "stdout", content: "temporary log", expiresAt: "2026-08-01T00:00:00.000Z" }],
    });
    expect(firstStore.deleteExpiredRawLogs("2026-09-01T00:00:00.000Z")).toBe(1);
    firstStore.close();

    const secondStore = new ReceiptStore(databasePath);
    const secondService = new ReceiptService(config, secondStore);
    expect(secondService.get(receipt.payload.id)).toMatchObject({ receipt, isPublic: false });
    expect(secondService.verify(receipt)).toMatchObject({ valid: true, reason: null });
    secondStore.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("attaches a receipt to an existing finalized run without duplicating it", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-receipt-"));
    const databasePath = join(directory, "receipts.sqlite");
    const config = { keyId: "receipt-test-1", privateKeyPem: privateKeyPem() };
    const initialStore = new ReceiptStore(databasePath);
    const initialService = new ReceiptService(config, initialStore);
    const receipt = initialService.issue(report());
    initialStore.close();
    const database = new DatabaseSync(databasePath);
    database.exec("DELETE FROM signed_receipts");
    database.close();

    const restartedStore = new ReceiptStore(databasePath);
    restartedStore.save(receipt);
    expect(restartedStore.get(receipt.payload.id)).toMatchObject({ receipt });
    restartedStore.close();
    rmSync(directory, { recursive: true, force: true });
  });
});
