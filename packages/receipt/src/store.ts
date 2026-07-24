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
      this.database.exec(
        readFileSync(new URL("../../schema/migrations/001_initial.sql", import.meta.url), "utf8"),
      );
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)").run();
    }
    this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)").run();
    const version = this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get();
    if (!version) {
      this.database.exec(readFileSync(new URL("../../schema/migrations/002_run_orchestration.sql", import.meta.url), "utf8"));
      this.database.prepare("INSERT INTO schema_migrations (version) VALUES (2)").run();
    }
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
      | { payload_json: string; payload_hash: string; key_id: string; signature: string; contract_version: string; is_public: number }
      | undefined;
    if (!row) return null;
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
