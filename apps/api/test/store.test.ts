import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  type VerificationReport,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import { ReceiptSigner } from "@ever-guild/proof-runner-receipt";
import { RunStore } from "../src/store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const request: VerifyRequest = {
  contractVersion: CONTRACT_VERSION,
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "branch", value: "main" },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  public: false,
};

const createStore = (): RunStore => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-store-"));
  directories.push(directory);
  return new RunStore(join(directory, "runs.sqlite"));
};

describe("RunStore", () => {
  it("upgrades an existing receipt database before using orchestration fields", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-migration-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const original = new DatabaseSync(databasePath);
    original.exec(
      readFileSync(
        new URL("../../../packages/schema/migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    original.close();

    const store = new RunStore(databasePath);
    const migrated = new DatabaseSync(databasePath);
    try {
      const columns = migrated.prepare(
        "SELECT name FROM pragma_table_info('run_metadata')",
      ).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "report_json",
          "system_error_code",
          "system_error_message",
          "system_error_retryable",
          "result_fingerprint",
        ]),
      );
    } finally {
      migrated.close();
      store.close();
    }
  });

  it("repairs an interrupted orchestration migration before serving runs", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-partial-migration-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const original = new DatabaseSync(databasePath);
    original.exec(
      readFileSync(
        new URL("../../../packages/schema/migrations/001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    original.exec("ALTER TABLE run_metadata ADD COLUMN report_json TEXT");
    original.close();

    const store = new RunStore(databasePath);
    const migrated = new DatabaseSync(databasePath);
    try {
      const columns = migrated.prepare(
        "SELECT name FROM pragma_table_info('run_metadata')",
      ).all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(
        expect.arrayContaining([
          "report_json",
          "system_error_code",
          "system_error_message",
          "system_error_retryable",
        ]),
      );
    } finally {
      migrated.close();
      store.close();
    }
  });

  it("fails closed instead of marking a partial initial schema as migrated", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-partial-initial-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const original = new DatabaseSync(databasePath);
    original.exec("CREATE TABLE run_metadata (id TEXT PRIMARY KEY)");
    original.close();

    expect(() => new RunStore(databasePath)).toThrow(/incomplete initial schema/i);
  });

  it("repairs evidence-bundle backfill and index postconditions after interruption", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "proof-runner-partial-bundle-migration-"),
    );
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const initial = new RunStore(databasePath);
    const created = initial.create("bundle-migration", request);
    if (created.kind !== "created") {
      throw new Error("expected a newly created migration fixture run");
    }
    const runId = created.run.response.id;
    initial.close();

    const interrupted = new DatabaseSync(databasePath);
    interrupted
      .prepare(
        `INSERT INTO raw_logs (
          run_id, sequence, stream, content, created_at, expires_at
        ) VALUES (?, 0, 'stdout', 'retained', ?, ?)`,
      )
      .run(
        runId,
        "2026-07-26T12:00:00.000Z",
        "2026-08-26T12:00:00.000Z",
      );
    interrupted.exec("DELETE FROM raw_log_metadata");
    interrupted.exec("DROP INDEX signed_receipts_payload_hash_idx");
    interrupted.close();

    const repaired = new RunStore(databasePath);
    const migrated = new DatabaseSync(databasePath);
    try {
      expect(
        migrated
          .prepare(
            "SELECT retention_expires_at FROM raw_log_metadata WHERE run_id = ?",
          )
          .get(runId),
      ).toEqual({ retention_expires_at: "2026-08-26T12:00:00.000Z" });
      expect(
        migrated
          .prepare(
            `SELECT name FROM sqlite_master
             WHERE type = 'index'
               AND name = 'signed_receipts_payload_hash_idx'`,
          )
          .get(),
      ).toEqual({ name: "signed_receipts_payload_hash_idx" });
    } finally {
      migrated.close();
      repaired.close();
    }
  });

  it("keeps idempotent requests stable and admits only one active plus five FIFO waiters", () => {
    const store = createStore();
    try {
      const first = store.create("first", request);
      expect(first.kind).toBe("created");
      if (first.kind !== "created") throw new Error("expected an initial run");

      const replay = store.create("first", request);
      expect(replay).toMatchObject({
        kind: "replayed",
        run: { response: { id: first.run.response.id, status: "QUEUED" } },
      });

      const reordered: VerifyRequest = {
        public: request.public,
        skill: {
          hash: request.skill.hash,
          version: request.skill.version,
          name: request.skill.name,
        },
        resolvedRef: {
          value: request.resolvedRef.value,
          type: request.resolvedRef.type,
        },
        resolvedCommitSha: request.resolvedCommitSha,
        repositoryUrl: request.repositoryUrl,
        contractVersion: request.contractVersion,
      };
      expect(store.create("first", reordered)).toMatchObject({
        kind: "replayed",
        run: { response: { id: first.run.response.id } },
      });

      expect(store.create("first", { ...request, public: true })).toEqual({
        kind: "conflict",
      });

      const active = store.claimNext();
      expect(active?.response).toMatchObject({
        id: first.run.response.id,
        status: "RUNNING",
        queuePosition: null,
      });

      for (let index = 0; index < 5; index += 1) {
        expect(store.create(`queued-${index}`, request)).toMatchObject({
          kind: "created",
        });
      }
      expect(store.create("overflow", request)).toEqual({ kind: "full" });
      expect(store.get(first.run.response.id)?.response.status).toBe("RUNNING");
    } finally {
      store.close();
    }
  });

  it("persists a verification contract and reports non-terminal coverage after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-contract-"));
    directories.push(directory);
    const databasePath = join(directory, "runs.sqlite");
    const contractRequest: VerifyRequest = {
      ...request,
      verificationContract: {
        version: "1",
        subject: {
          repositoryUrl: request.repositoryUrl,
          resolvedCommitSha: request.resolvedCommitSha,
          skillHash: request.skill.hash,
          runtimeImageDigest: `sha256:${"c".repeat(64)}`,
        },
        criteria: [
          { id: "build", kind: "build", required: true },
          { id: "tests", kind: "test-suite", required: true },
        ],
        prohibitions: [
          {
            id: "commands",
            kind: "arbitrary-command",
            enforcement: "PLATFORM",
          },
        ],
      },
    };

    const store = new RunStore(databasePath);
    const created = store.create("contract-run", contractRequest);
    if (created.kind !== "created") throw new Error("expected a queued run");
    const runId = created.run.response.id;
    store.close();

    const restarted = new RunStore(databasePath);
    try {
      expect(restarted.get(runId)).toMatchObject({
        request: {
          verificationContract: contractRequest.verificationContract,
        },
        response: {
          status: "QUEUED",
          verification: {
            contract: contractRequest.verificationContract,
            coverage: [
              {
                criterionId: "build",
                status: "UNVERIFIED",
                reasonCode: "RUN_NOT_TERMINAL",
              },
              {
                criterionId: "tests",
                status: "UNVERIFIED",
                reasonCode: "RUN_NOT_TERMINAL",
              },
              {
                criterionId: "commands",
                status: "UNVERIFIED",
                reasonCode: "RUN_NOT_TERMINAL",
              },
            ],
          },
        },
      });
    } finally {
      restarted.close();
    }
  });

  it("binds contract runtime evidence without adding unsigned coverage to the receipt", () => {
    const store = createStore();
    const runtimeImageDigest = `sha256:${"c".repeat(64)}`;
    const contractRequest: VerifyRequest = {
      ...request,
      verificationContract: {
        version: "1",
        subject: {
          repositoryUrl: request.repositoryUrl,
          resolvedCommitSha: request.resolvedCommitSha,
          skillHash: request.skill.hash,
          runtimeImageDigest,
        },
        criteria: [
          { id: "build", kind: "build", required: true },
          { id: "tests", kind: "test-suite", required: true },
        ],
        prohibitions: [],
      },
    };
    const created = store.create("contract-terminal", contractRequest);
    if (created.kind !== "created") throw new Error("expected a queued run");
    const running = store.claimNext();
    if (!running) throw new Error("expected a running run");
    const completedAt = new Date().toISOString();
    const report: VerificationReport = {
      contractVersion: CONTRACT_VERSION,
      runId: running.response.id,
      repositoryUrl: request.repositoryUrl,
      resolvedCommitSha: request.resolvedCommitSha,
      resolvedRef: request.resolvedRef,
      skill: request.skill,
      runtimeImageDigest,
      verdict: "PASS",
      checks: [
        {
          id: "build",
          stage: "BUILD",
          title: "Run build",
          outcome: "PASSED",
          startedAt: completedAt,
          completedAt,
          durationMs: 0,
          exitCode: 0,
          summary: "Build passed.",
        },
        {
          id: "test",
          stage: "TEST",
          title: "Run tests",
          outcome: "PASSED",
          startedAt: completedAt,
          completedAt,
          durationMs: 0,
          exitCode: 0,
          summary: "Tests passed.",
        },
      ],
      durationMs: 0,
      completedAt,
      reasonCode: null,
    };
    const { privateKey } = generateKeyPairSync("ed25519");
    const signer = new ReceiptSigner({
      keyId: "contract-test",
      privateKeyPem: privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
    });

    try {
      const wrongRuntimeReport = {
        ...report,
        runtimeImageDigest: `sha256:${"d".repeat(64)}`,
      };
      expect(
        store.complete(
          running.response.id,
          "COMPLETED",
          wrongRuntimeReport,
          signer.issue(wrongRuntimeReport),
          "e".repeat(64),
        ),
      ).toBe(false);

      const receipt = signer.issue(report);
      expect(
        store.complete(
          running.response.id,
          "COMPLETED",
          report,
          receipt,
          "f".repeat(64),
        ),
      ).toBe(true);
      expect(store.get(running.response.id)?.response).toMatchObject({
        verification: {
          coverage: [
            { criterionId: "build", status: "EXECUTED" },
            { criterionId: "tests", status: "EXECUTED" },
          ],
          decision: {
            policyVersion: "1",
            advisory: true,
            outcome: "ACCEPT",
            reasonCodes: [
              "EXECUTION_PASSED",
              "REQUIRED_COVERAGE_EXECUTED",
            ],
          },
        },
      });
      expect(receipt.payload).not.toHaveProperty("verification");
      expect(receipt.payload.report).not.toHaveProperty("verificationContract");
    } finally {
      store.close();
    }
  });

  it("atomically reserves two adjacent FIFO child runs for an idempotent reproducibility request", () => {
    const store = createStore();
    try {
      const created = store.createReproducibility("repro-1", request);
      expect(created.kind).toBe("created");
      if (created.kind !== "created") {
        throw new Error("expected a reproducibility job");
      }
      expect(created.reproducibility.children).toHaveLength(2);
      expect(
        created.reproducibility.children.map((child) => child.response.status),
      ).toEqual(["QUEUED", "QUEUED"]);
      expect(
        created.reproducibility.children[1]!.sequence -
          created.reproducibility.children[0]!.sequence,
      ).toBe(1);

      expect(store.createReproducibility("repro-1", request)).toMatchObject({
        kind: "replayed",
        reproducibility: { id: created.reproducibility.id },
      });
      expect(
        store.createReproducibility("repro-1", {
          ...request,
          public: true,
        }),
      ).toEqual({ kind: "conflict" });

      const first = store.claimNext();
      expect(first?.response.id).toBe(
        created.reproducibility.children[0]!.response.id,
      );
      expect(
        store.get(created.reproducibility.children[1]!.response.id)?.response,
      ).toMatchObject({ status: "QUEUED", queuePosition: 1 });
    } finally {
      store.close();
    }
  });

  it("fails a two-run reservation without partially consuming queue capacity", () => {
    const store = createStore();
    try {
      for (let index = 0; index < 4; index += 1) {
        expect(store.create(`regular-${index}`, request).kind).toBe("created");
      }
      expect(store.createReproducibility("repro-full", request)).toEqual({
        kind: "full",
      });
      expect(store.create("regular-final", request).kind).toBe("created");
      expect(store.create("regular-overflow", request)).toEqual({
        kind: "full",
      });
    } finally {
      store.close();
    }
  });
});
