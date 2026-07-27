import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  EvidenceBundleVerificationResponseSchema,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptService,
  ReceiptStore,
} from "@ever-guild/proof-runner-receipt";
import {
  EvidenceBundleService,
  MAX_EVIDENCE_BUNDLE_BYTES,
} from "../src/evidence-bundle.js";
import { InspectionService } from "../src/inspection.js";
import {
  Orchestrator,
  type RunnerClient,
} from "../src/orchestration.js";
import { createApiServer } from "../src/server.js";
import { RunStore } from "../src/store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const report: VerificationReport = {
  contractVersion: CONTRACT_VERSION,
  runId: "018f47ac-5d7b-7c20-a1aa-0242ac120401",
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "commit", value: "a".repeat(40) },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  runtimeImageDigest: `sha256:${"c".repeat(64)}`,
  verdict: "PASS",
  checks: [
    {
      id: "test",
      stage: "TEST",
      title: "Run tests",
      outcome: "PASSED",
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:00:01.000Z",
      durationMs: 1_000,
      exitCode: 0,
      summary: "Tests passed.",
    },
  ],
  durationMs: 1_000,
  completedAt: "2026-07-26T12:00:01.000Z",
  reasonCode: null,
};

const idleRunner: RunnerClient = {
  dispatch: async () => undefined,
  cancel: async () => undefined,
};

describe("evidence bundle API", () => {
  it("downloads and verifies a retained-log bundle", async () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-bundle-api-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const store = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const { privateKey } = generateKeyPairSync("ed25519");
    const receipts = new ReceiptService(
      {
        keyId: "bundle-api-test",
        privateKeyPem: privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      receiptStore,
    );
    const receipt = receipts.issue(report, {
      rawLogs: [
        {
          stream: "stdout",
          content: "token=super-secret-value",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
    });
    const evidenceBundles = new EvidenceBundleService(
      receipts,
      receiptStore,
      store,
    );
    const orchestrator = new Orchestrator(store, idleRunner, receipts.signer);
    const server = createApiServer({
      store,
      inspection: new InspectionService(),
      orchestrator,
      bearerToken: "t".repeat(32),
      receipts,
      evidenceBundles,
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("missing server address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const download = await fetch(
        `${baseUrl}/api/receipts/${receipt.payload.id}/bundle`,
      );
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toBe("application/zip");
      expect(download.headers.get("content-disposition")).toContain(
        `proofrunner-evidence-${receipt.payload.id}.zip`,
      );
      const archive = Buffer.from(await download.arrayBuffer());
      expect(archive.toString("utf8")).not.toContain("super-secret-value");

      const verification = await fetch(
        `${baseUrl}/api/evidence-bundles/verify`,
        {
          method: "POST",
          headers: { "content-type": "application/zip" },
          body: archive,
        },
      );
      expect(verification.status).toBe(200);
      expect(
        EvidenceBundleVerificationResponseSchema.parse(
          await verification.json(),
        ),
      ).toMatchObject({ valid: true, reason: null });

      const missing = await fetch(
        `${baseUrl}/api/receipts/018f47ac-5d7b-7c20-a1aa-0242ac120499/bundle`,
      );
      expect(missing.status).toBe(404);
      await expect(missing.json()).resolves.toMatchObject({
        error: { code: "RECEIPT_NOT_FOUND" },
      });

      const oversized = await fetch(
        `${baseUrl}/api/evidence-bundles/verify`,
        {
          method: "POST",
          headers: { "content-type": "application/zip" },
          body: Buffer.alloc(MAX_EVIDENCE_BUNDLE_BYTES + 1),
        },
      );
      expect(oversized.status).toBe(413);
      await expect(oversized.json()).resolves.toMatchObject({
        error: { code: "REQUEST_BODY_TOO_LARGE" },
      });
    } finally {
      orchestrator.stop();
      store.close();
      receiptStore.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
