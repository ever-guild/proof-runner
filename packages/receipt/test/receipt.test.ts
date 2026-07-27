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
      .toMatchObject({ valid: false, reason: "INVALID_RECEIPT" });
  });

  it("retains an explicit private signing-key ring for historical receipts", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-keyring-"));
    const databasePath = join(directory, "receipts.sqlite");
    const previous = {
      keyId: "receipt-previous",
      privateKeyPem: privateKeyPem(),
    };
    const store = new ReceiptStore(databasePath);
    const service = new ReceiptService(
      { keyId: "receipt-current", privateKeyPem: privateKeyPem() },
      store,
      [],
      [previous],
    );
    const previousSigner = service.signerFor(previous.keyId);
    expect(previousSigner?.config.keyId).toBe(previous.keyId);
    const receipt = previousSigner!.issue(report());
    store.save(receipt);
    expect(service.verify(receipt)).toMatchObject({
      valid: true,
      reason: null,
    });
    expect(service.publicKey(previous.keyId)?.keyId).toBe(previous.keyId);
    store.close();
    rmSync(directory, { recursive: true, force: true });
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
    expect(
      firstStore.rawLogs(
        receipt.payload.id,
        "2026-07-31T00:00:00.000Z",
      ),
    ).toMatchObject({
      kind: "retained",
      logs: [{ sequence: 0, content: "temporary log" }],
    });
    expect(firstStore.deleteExpiredRawLogs("2026-09-01T00:00:00.000Z")).toBe(1);
    expect(
      firstStore.rawLogs(
        receipt.payload.id,
        "2026-09-01T00:00:00.000Z",
      ),
    ).toEqual({ kind: "expired" });
    expect(
      firstStore.rawLogs(
        "018f47ac-5d7b-7c20-a1aa-0242ac129999",
        "2026-09-01T00:00:00.000Z",
      ),
    ).toEqual({ kind: "unavailable" });
    firstStore.close();

    const secondStore = new ReceiptStore(databasePath);
    const secondService = new ReceiptService(config, secondStore);
    expect(secondService.get(receipt.payload.id)).toMatchObject({ receipt, isPublic: false });
    expect(secondService.getByPayloadHash(receipt.payloadHash)).toMatchObject({
      receipt,
      isPublic: false,
    });
    expect(secondService.getByPayloadHash("0".repeat(64))).toBeNull();
    expect(secondService.verify(receipt)).toMatchObject({ valid: true, reason: null });
    secondStore.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("repairs interrupted verification and reproducibility migration bookkeeping", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-receipt-migration-"));
    const databasePath = join(directory, "receipts.sqlite");
    const initial = new ReceiptStore(databasePath);
    initial.close();

    const interrupted = new DatabaseSync(databasePath);
    interrupted.exec("DELETE FROM schema_migrations WHERE version IN (4, 5)");
    interrupted.exec("DROP INDEX reproducibility_jobs_children_idx");
    interrupted.close();

    const repaired = new ReceiptStore(databasePath);
    const migrated = new DatabaseSync(databasePath);
    try {
      const runColumns = migrated
        .prepare("SELECT name FROM pragma_table_info('run_metadata')")
        .all() as Array<{ name: string }>;
      expect(runColumns.map((column) => column.name)).toContain(
        "verification_contract_json",
      );
      const reproducibilityColumns = migrated
        .prepare("SELECT name FROM pragma_table_info('reproducibility_jobs')")
        .all() as Array<{ name: string }>;
      expect(reproducibilityColumns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "id",
          "baseline_run_id",
          "candidate_run_id",
        ]),
      );
      expect(
        migrated
          .prepare(
            `SELECT version FROM schema_migrations
             WHERE version IN (4, 5)
             ORDER BY version`,
          )
          .all(),
      ).toEqual([{ version: 4 }, { version: 5 }]);
      expect(
        migrated
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index'
               AND name = 'reproducibility_jobs_children_idx'`,
          )
          .get(),
      ).toEqual({ name: "reproducibility_jobs_children_idx" });
    } finally {
      migrated.close();
      repaired.close();
      rmSync(directory, { recursive: true, force: true });
    }
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
