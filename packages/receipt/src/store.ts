import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { SignedReceipt, VerificationReport } from "@ever-guild/proof-runner-schema";

export interface StoredReceipt {
  receipt: SignedReceipt;
  isPublic: boolean;
}

export interface PersistReceiptOptions {
  isPublic?: boolean;
  rawLogs?: Array<{ stream: "stdout" | "stderr" | "system"; content: string; expiresAt: string }>;
}

export type RawLogState =
  | {
      kind: "retained";
      logs: Array<{
        sequence: number;
        stream: "stdout" | "stderr" | "system";
        content: string;
        createdAt: string;
        expiresAt: string;
      }>;
    }
  | { kind: "expired" }
  | { kind: "unavailable" };

type ReceiptRow = {
  payload_json: string;
  payload_hash: string;
  key_id: string;
  signature: string;
  contract_version: string;
  is_public: number;
};

const orchestrationMigrationColumns = [
  ["report_json", "ALTER TABLE run_metadata ADD COLUMN report_json TEXT"],
  [
    "system_error_code",
    "ALTER TABLE run_metadata ADD COLUMN system_error_code TEXT",
  ],
  [
    "system_error_message",
    "ALTER TABLE run_metadata ADD COLUMN system_error_message TEXT",
  ],
  [
    "system_error_retryable",
    `ALTER TABLE run_metadata ADD COLUMN system_error_retryable INTEGER CHECK (
      system_error_retryable IN (0, 1)
    )`,
  ],
] as const;

const resultDeliveryMigrationColumns = [
  [
    "result_fingerprint",
    "ALTER TABLE run_metadata ADD COLUMN result_fingerprint TEXT",
  ],
] as const;

const verificationContractMigrationColumns = [
  [
    "verification_contract_json",
    "ALTER TABLE run_metadata ADD COLUMN verification_contract_json TEXT",
  ],
] as const;

const reproducibilityJobColumns = [
  "id",
  "contract_version",
  "idempotency_scope",
  "idempotency_key",
  "request_fingerprint",
  "request_json",
  "baseline_run_id",
  "candidate_run_id",
  "created_at",
] as const;

/**
 * The receipt path intentionally owns no raw-log reads. Retention jobs may
 * delete raw_logs at any time without affecting the normalized checks and
 * signed receipt needed for later verification.
 */
export class ReceiptStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
    const migrated = this.database
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'run_metadata'")
      .get();
    this.database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
    if (!migrated) {
      this.transaction(() => {
        this.database.exec(
          readFileSync(
            new URL("../../schema/migrations/001_initial.sql", import.meta.url),
            "utf8",
          ),
        );
        this.recordMigration(1);
      });
    }
    this.recordMigration(1);
    this.migrateColumnAdditions(
      2,
      orchestrationMigrationColumns,
      "002_run_orchestration.sql",
    );
    this.migrateColumnAdditions(
      3,
      resultDeliveryMigrationColumns,
      "003_result_delivery_fingerprint.sql",
    );
    this.migrateColumnAdditions(
      4,
      verificationContractMigrationColumns,
      "004_verification_contract.sql",
    );
    this.migrateReproducibilityTable();
    this.transaction(() => {
      this.database.exec(
        readFileSync(
          new URL(
            "../../schema/migrations/006_evidence_bundles.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      this.recordMigration(6);
    });
  }

  save(receipt: SignedReceipt, options: PersistReceiptOptions = {}): void {
    const report = receipt.payload.report;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database.prepare(`SELECT contract_version, repository_url,
        resolved_commit_sha, skill_hash, verdict FROM run_metadata WHERE id = ?`)
        .get(report.runId) as
        | { contract_version: string; repository_url: string; resolved_commit_sha: string; skill_hash: string; verdict: string | null }
        | undefined;
      if (existing) {
        if (
          existing.contract_version !== report.contractVersion ||
          existing.repository_url !== report.repositoryUrl ||
          existing.resolved_commit_sha !== report.resolvedCommitSha ||
          existing.skill_hash !== report.skill.hash ||
          (existing.verdict !== null && existing.verdict !== report.verdict)
        ) {
          throw new Error("Stored run metadata does not match the receipt report");
        }
      } else {
        const nextSequence = this.database
          .prepare("SELECT COALESCE(MAX(queue_sequence), 0) + 1 AS value FROM run_metadata")
          .get() as { value: number };
        this.database.prepare(`INSERT INTO run_metadata (
        id, contract_version, idempotency_scope, idempotency_key, request_fingerprint,
        repository_url, resolved_commit_sha, resolved_ref_json, skill_name, skill_version,
        skill_hash, status, verdict, queue_sequence, active_stage, is_public, created_at,
        started_at, completed_at
      ) VALUES (?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, NULL, ?, ?, ?, ?)`)
        .run(
          report.runId,
          report.contractVersion,
          report.runId,
          receipt.payloadHash,
          report.repositoryUrl,
          report.resolvedCommitSha,
          JSON.stringify(report.resolvedRef),
          report.skill.name,
          report.skill.version,
          report.skill.hash,
          report.verdict,
          nextSequence.value,
          options.isPublic ? 1 : 0,
          receipt.payload.createdAt,
          report.completedAt,
          report.completedAt,
        );
        const insertCheck = this.database.prepare(`INSERT INTO normalized_checks (
        run_id, check_index, check_id, stage, title, outcome, started_at,
        completed_at, duration_ms, exit_code, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        report.checks.forEach((check, index) => {
          insertCheck.run(
            report.runId, index, check.id, check.stage, check.title, check.outcome,
            check.startedAt, check.completedAt, check.durationMs, check.exitCode, check.summary,
          );
        });
      }
      this.database.prepare(`INSERT INTO signed_receipts (
        id, run_id, payload_json, payload_hash, key_id, signature, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(
          receipt.payload.id,
          report.runId,
          JSON.stringify(receipt.payload),
          receipt.payloadHash,
          receipt.keyId,
          receipt.signature,
          receipt.payload.createdAt,
        );
      const insertLog = this.database.prepare(`INSERT INTO raw_logs (
        run_id, sequence, stream, content, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)`);
      options.rawLogs?.forEach((log, index) => {
        insertLog.run(report.runId, index, log.stream, log.content, receipt.payload.createdAt, log.expiresAt);
      });
      if (options.rawLogs && options.rawLogs.length > 0) {
        const retentionExpiresAt = options.rawLogs
          .map((log) => log.expiresAt)
          .sort()
          .at(-1);
        if (!retentionExpiresAt) {
          throw new Error("Raw-log retention metadata could not be determined");
        }
        this.database.prepare(`INSERT INTO raw_log_metadata (
          run_id, retention_expires_at
        ) VALUES (?, ?)
        ON CONFLICT(run_id) DO UPDATE SET retention_expires_at =
          CASE
            WHEN excluded.retention_expires_at > raw_log_metadata.retention_expires_at
              THEN excluded.retention_expires_at
            ELSE raw_log_metadata.retention_expires_at
          END`).run(report.runId, retentionExpiresAt);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: string): StoredReceipt | null {
    const row = this.database.prepare(`SELECT r.payload_json, r.payload_hash, r.key_id,
      r.signature, m.contract_version, m.is_public FROM signed_receipts r
      JOIN run_metadata m ON m.id = r.run_id WHERE r.id = ?`).get(id) as
      | ReceiptRow
      | undefined;
    return row ? this.inflate(row) : null;
  }

  getByPayloadHash(payloadHash: string): StoredReceipt | null {
    const row = this.database.prepare(`SELECT r.payload_json, r.payload_hash, r.key_id,
      r.signature, m.contract_version, m.is_public FROM signed_receipts r
      JOIN run_metadata m ON m.id = r.run_id
      WHERE r.payload_hash = ? ORDER BY r.id LIMIT 1`).get(payloadHash) as
      | ReceiptRow
      | undefined;
    return row ? this.inflate(row) : null;
  }

  rawLogs(runId: string, now: string): RawLogState {
    const rows = this.database.prepare(`SELECT sequence, stream, content,
      created_at, expires_at FROM raw_logs
      WHERE run_id = ? AND expires_at > ?
      ORDER BY sequence`).all(runId, now) as Array<{
        sequence: number;
        stream: "stdout" | "stderr" | "system";
        content: string;
        created_at: string;
        expires_at: string;
      }>;
    if (rows.length > 0) {
      return {
        kind: "retained",
        logs: rows.map((row) => ({
          sequence: row.sequence,
          stream: row.stream,
          content: row.content,
          createdAt: row.created_at,
          expiresAt: row.expires_at,
        })),
      };
    }

    const metadata = this.database.prepare(
      "SELECT retention_expires_at FROM raw_log_metadata WHERE run_id = ?",
    ).get(runId) as { retention_expires_at: string } | undefined;
    if (metadata && metadata.retention_expires_at <= now) {
      return { kind: "expired" };
    }
    return { kind: "unavailable" };
  }

  private migrateColumnAdditions(
    version: number,
    columns: readonly (readonly [string, string])[],
    filename: string,
  ): void {
    const knownColumns = new Set(this.tableColumns("run_metadata"));
    if (
      this.migrationApplied(version) &&
      columns.every(([name]) => knownColumns.has(name))
    ) {
      return;
    }
    this.transaction(() => {
      const currentColumns = new Set(this.tableColumns("run_metadata"));
      if (columns.every(([name]) => !currentColumns.has(name))) {
        this.database.exec(
          readFileSync(
            new URL(`../../schema/migrations/${filename}`, import.meta.url),
            "utf8",
          ),
        );
      } else {
        for (const [name, statement] of columns) {
          if (!currentColumns.has(name)) this.database.exec(statement);
        }
      }
      this.recordMigration(version);
    });
  }

  private migrateReproducibilityTable(): void {
    const available = new Set(this.tableColumns("reproducibility_jobs"));
    const complete = reproducibilityJobColumns.every((column) =>
      available.has(column),
    );
    const applied = this.migrationApplied(5);

    if (available.size === 0) {
      if (applied) {
        throw new Error(
          "Incomplete reproducibility migration detected; refusing to serve database",
        );
      }
      this.transaction(() => {
        this.database.exec(
          readFileSync(
            new URL(
              "../../schema/migrations/005_reproducibility_jobs.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        );
        this.recordMigration(5);
      });
      return;
    }

    if (!complete) {
      throw new Error(
        "Incomplete reproducibility migration detected; refusing to serve database",
      );
    }
    this.transaction(() => {
      this.database.exec(
        `CREATE INDEX IF NOT EXISTS reproducibility_jobs_children_idx
         ON reproducibility_jobs(baseline_run_id, candidate_run_id)`,
      );
      this.recordMigration(5);
    });
  }

  private tableColumns(table: string): string[] {
    return (
      this.database
        .prepare(`SELECT name FROM pragma_table_info('${table}')`)
        .all() as Array<{ name: string }>
    ).map((column) => column.name);
  }

  private migrationApplied(version: number): boolean {
    return (
      this.database
        .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get(version) !== undefined
    );
  }

  private recordMigration(version: number): void {
    this.database
      .prepare(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
      )
      .run(version);
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private inflate(row: ReceiptRow): StoredReceipt {
    return {
      receipt: {
        contractVersion: row.contract_version as "1.0",
        payload: JSON.parse(row.payload_json) as SignedReceipt["payload"],
        canonicalization: "JCS-RFC8785",
        hashAlgorithm: "SHA-256",
        payloadHash: row.payload_hash,
        signatureAlgorithm: "Ed25519",
        keyId: row.key_id,
        signature: row.signature,
      },
      isPublic: row.is_public === 1,
    };
  }

  deleteExpiredRawLogs(now: string): number {
    return Number(
      this.database.prepare("DELETE FROM raw_logs WHERE expires_at <= ?").run(now).changes,
    );
  }

  close(): void {
    this.database.close();
  }
}

export const reportForReceipt = (receipt: SignedReceipt): VerificationReport => receipt.payload.report;
