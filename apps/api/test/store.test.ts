import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
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
});
