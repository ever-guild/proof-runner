import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONTRACT_VERSION, MOCK_RUN_RESPONSES } from "@ever-guild/proof-runner-schema";
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

  it("fails startup with stable non-secret errors for malformed configured PEM", () => {
    const malformedPrivateKey = "private-key-secret-marker";
    try {
      loadReceiptApiConfig({
        DATABASE_PATH: ":memory:",
        PROOF_RUNNER_RECEIPT_KEY_ID: "receipt-test-1",
        PROOF_RUNNER_RECEIPT_PRIVATE_KEY: malformedPrivateKey,
      });
      throw new Error("Expected malformed private key configuration to fail");
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(
        "PROOF_RUNNER_RECEIPT_PRIVATE_KEY must be a valid Ed25519 private key",
      );
      expect((caught as Error).message).not.toContain("secret-marker");
    }

    try {
      loadReceiptApiConfig({
        DATABASE_PATH: ":memory:",
        PROOF_RUNNER_RECEIPT_KEY_ID: "receipt-test-1",
        PROOF_RUNNER_RECEIPT_PRIVATE_KEY: generateKeyPairSync("ed25519").privateKey
          .export({ type: "pkcs8", format: "pem" }).toString(),
        PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS: JSON.stringify([{
          keyId: "receipt-previous",
          publicKeyPem: "public-key-secret-marker",
        }]),
      });
      throw new Error("Expected malformed verification key configuration to fail");
    } catch (caught) {
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe(
        "PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must contain valid Ed25519 public keys",
      );
      expect((caught as Error).message).not.toContain("secret-marker");
    }
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

  it("rejects an oversized verification body with a stable client error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-api-"));
    const api = createReceiptApi({
      databasePath: join(directory, "api.sqlite"),
      keyId: "receipt-test-1",
      privateKeyPem: generateKeyPairSync("ed25519").privateKey
        .export({ type: "pkcs8", format: "pem" }).toString(),
      verificationKeys: [],
    });
    resources.push({ close: () => { api.server.close(); api.close(); }, directory });
    await new Promise<void>((resolve) => api.server.listen(0, "127.0.0.1", resolve));
    const address = api.server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    const response = await fetch(`http://127.0.0.1:${address.port}/api/receipts/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(1024 * 1024) }),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      contractVersion: CONTRACT_VERSION,
      error: {
        code: "REQUEST_BODY_TOO_LARGE",
        message: "Request body exceeds the 1 MiB limit.",
        retryable: false,
      },
    });
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
    const legacyKey = await fetch(
      `http://127.0.0.1:${address.port}/api/receipt-keys/${previousSigner.config.keyId}`,
    );
    expect(await legacyKey.json()).toMatchObject({
      contractVersion: CONTRACT_VERSION,
      keyId: previousSigner.config.keyId,
    });
  });
});
