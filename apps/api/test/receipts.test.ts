import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MOCK_RUN_RESPONSES } from "@ever-guild/proof-runner-schema";
import { ReceiptSigner } from "@ever-guild/proof-runner-receipt";
import { createReceiptApi, loadReceiptApiConfig } from "../src/receipts.js";

const resources: Array<{ close: () => void; directory: string }> = [];
afterEach(() => {
  resources.splice(0).forEach(({ close, directory }) => {
    close();
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("receipt API", () => {
  it("fails closed when the signing key is missing", () => {
    expect(() => loadReceiptApiConfig({
      DATABASE_PATH: ":memory:",
      PROOF_RUNNER_RECEIPT_KEY_ID: "receipt-test-1",
    })).toThrow(/fails closed/);
  });

  it("retrieves receipts and public keys and verifies an untrusted payload", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-api-"));
    const privateKeyPem = generateKeyPairSync("ed25519").privateKey
      .export({ type: "pkcs8", format: "pem" }).toString();
    const api = createReceiptApi({
      databasePath: join(directory, "api.sqlite"),
      keyId: "receipt-test-1",
      privateKeyPem,
      verificationKeys: [],
    });
    resources.push({ close: () => { api.server.close(); api.close(); }, directory });
    const report = MOCK_RUN_RESPONSES.PASS.report;
    if (!report) throw new Error("PASS mock requires a report");
    const receipt = api.service.issue(report);
    await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
    const address = api.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const fetched = await fetch(`${baseUrl}/api/receipts/${receipt.payload.id}`);
    expect(await fetched.json()).toMatchObject(receipt);
    const key = await fetch(`${baseUrl}/api/receipt-keys/receipt-test-1`);
    expect(await key.json()).toMatchObject({ keyId: "receipt-test-1", signatureAlgorithm: "Ed25519" });
    const verification = await fetch(`${baseUrl}/api/receipts/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(receipt),
    });
    expect(await verification.json()).toMatchObject({ valid: true, reason: null });
  });

  it("continues verifying receipts signed by a rotated key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-api-"));
    const previousSigner = new ReceiptSigner({
      keyId: "receipt-previous",
      privateKeyPem: generateKeyPairSync("ed25519").privateKey
        .export({ type: "pkcs8", format: "pem" }).toString(),
    });
    const report = MOCK_RUN_RESPONSES.FAIL.report;
    if (!report) throw new Error("FAIL mock requires a report");
    const previousReceipt = previousSigner.issue(report);
    const api = createReceiptApi({
      databasePath: join(directory, "api.sqlite"),
      keyId: "receipt-current",
      privateKeyPem: generateKeyPairSync("ed25519").privateKey
        .export({ type: "pkcs8", format: "pem" }).toString(),
      verificationKeys: [{ keyId: previousSigner.config.keyId, publicKeyPem: previousSigner.publicKeyPem }],
    });
    resources.push({ close: () => { api.server.close(); api.close(); }, directory });
    await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
    const address = api.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const result = await fetch(`http://127.0.0.1:${address.port}/api/receipts/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(previousReceipt),
    });
    expect(await result.json()).toMatchObject({ valid: true, reason: null });
  });
});
