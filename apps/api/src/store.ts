import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  CONTRACT_VERSION,
  RunResponseSchema,
  type NormalizedCheck,
  type RunResponse,
  type SignedReceipt,
  type VerificationReport,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";

type RunRow = {
  id: string; contract_version: "1.0"; request_fingerprint: string;
  repository_url: string; resolved_commit_sha: string; resolved_ref_json: string;
  skill_name: "node-typescript"; skill_version: "1"; skill_hash: string;
  status: RunResponse["status"]; verdict: "PASS" | "FAIL" | "INCONCLUSIVE" | null;
  queue_sequence: number; active_stage: NormalizedCheck["stage"] | null;
  is_public: number; created_at: string; started_at: string | null; completed_at: string | null;
  system_error_code?: string | null; system_error_message?: string | null; system_error_retryable?: number | null;
  report_json?: string | null;
};

export type StoredRun = { request: VerifyRequest; response: RunResponse; sequence: number };
export type CreateResult = { kind: "created" | "replayed"; run: StoredRun } | { kind: "conflict" } | { kind: "full" };

const fingerprint = (request: VerifyRequest): string => createHash("sha256")
  .update(JSON.stringify(request)).digest("hex");

export class RunStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
    const migrated = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'run_metadata'").get();
    this.database.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
    if (!migrated) {
      this.database.exec(readFileSync(new URL("../../../packages/schema/migrations/001_initial.sql", import.meta.url), "utf8"));
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)").run();
    } else {
      this.database.prepare("INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)").run();
    }
    const version = this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get();
    if (!version) {
      this.database.exec(readFileSync(new URL("../../../packages/schema/migrations/002_run_orchestration.sql", import.meta.url), "utf8"));
      this.database.prepare("INSERT INTO schema_migrations (version) VALUES (2)").run();
    }
  }

  create(idempotencyKey: string, request: VerifyRequest): CreateResult {
    const requestFingerprint = fingerprint(request);
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database.prepare("SELECT * FROM run_metadata WHERE idempotency_scope = 'anonymous' AND idempotency_key = ?").get(idempotencyKey) as RunRow | undefined;
      if (existing) {
        this.database.exec("COMMIT");
        return existing.request_fingerprint === requestFingerprint
          ? { kind: "replayed", run: this.inflate(existing) }
          : { kind: "conflict" };
      }
      const admitted = this.database.prepare("SELECT COUNT(*) AS value FROM run_metadata WHERE status IN ('QUEUED', 'RUNNING')").get() as { value: number };
      if (admitted.value >= 6) { this.database.exec("COMMIT"); return { kind: "full" }; }
      const sequence = (this.database.prepare("SELECT COALESCE(MAX(queue_sequence), 0) + 1 AS value FROM run_metadata").get() as { value: number }).value;
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      this.database.prepare(`INSERT INTO run_metadata (
        id, contract_version, idempotency_scope, idempotency_key, request_fingerprint,
        repository_url, resolved_commit_sha, resolved_ref_json, skill_name, skill_version,
        skill_hash, status, verdict, queue_sequence, active_stage, is_public, created_at
      ) VALUES (?, ?, 'anonymous', ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', NULL, ?, NULL, ?, ?)`)
        .run(id, CONTRACT_VERSION, idempotencyKey, requestFingerprint, request.repositoryUrl,
          request.resolvedCommitSha, JSON.stringify(request.resolvedRef), request.skill.name,
          request.skill.version, request.skill.hash, sequence, request.public ? 1 : 0, createdAt);
      const row = this.database.prepare("SELECT * FROM run_metadata WHERE id = ?").get(id) as RunRow;
      this.database.exec("COMMIT");
      return { kind: "created", run: this.inflate(row) };
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  get(id: string): StoredRun | null {
    const row = this.database.prepare("SELECT * FROM run_metadata WHERE id = ?").get(id) as RunRow | undefined;
    return row ? this.inflate(row) : null;
  }

  claimNext(): StoredRun | null {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const active = this.database.prepare("SELECT 1 FROM run_metadata WHERE status = 'RUNNING'").get();
      if (active) { this.database.exec("COMMIT"); return null; }
      const queued = this.database.prepare("SELECT * FROM run_metadata WHERE status = 'QUEUED' ORDER BY queue_sequence LIMIT 1").get() as RunRow | undefined;
      if (!queued) { this.database.exec("COMMIT"); return null; }
      const now = new Date().toISOString();
      this.database.prepare("UPDATE run_metadata SET status = 'RUNNING', started_at = ?, active_stage = 'SANDBOX' WHERE id = ? AND status = 'QUEUED'").run(now, queued.id);
      const row = this.database.prepare("SELECT * FROM run_metadata WHERE id = ?").get(queued.id) as RunRow;
      this.database.exec("COMMIT");
      return this.inflate(row);
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  heartbeat(id: string, stage: NormalizedCheck["stage"] | null): boolean {
    return this.database.prepare("UPDATE run_metadata SET active_stage = ? WHERE id = ? AND status = 'RUNNING'").run(stage, id).changes > 0;
  }

  complete(id: string, status: "COMPLETED" | "TIMEOUT", report: VerificationReport, receipt: SignedReceipt): StoredRun | null {
    if (report.runId !== id) return null;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.database.prepare("SELECT * FROM run_metadata WHERE id = ?").get(id) as RunRow | undefined;
      if (!row || row.status !== "RUNNING") { this.database.exec("COMMIT"); return null; }
      const completedAt = report.completedAt;
      this.database.prepare("UPDATE run_metadata SET status = ?, verdict = ?, active_stage = NULL, completed_at = ?, report_json = ? WHERE id = ?").run(status, report.verdict, completedAt, JSON.stringify(report), id);
      this.database.prepare("DELETE FROM normalized_checks WHERE run_id = ?").run(id);
      const insert = this.database.prepare(`INSERT INTO normalized_checks (run_id, check_index, check_id, stage, title, outcome, started_at, completed_at, duration_ms, exit_code, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      report.checks.forEach((check, index) => insert.run(id, index, check.id, check.stage, check.title, check.outcome, check.startedAt, check.completedAt, check.durationMs, check.exitCode, check.summary));
      this.database.prepare(`INSERT INTO signed_receipts (id, run_id, payload_json, payload_hash, key_id, signature, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(receipt.payload.id, id, JSON.stringify(receipt.payload), receipt.payloadHash, receipt.keyId, receipt.signature, receipt.payload.createdAt);
      const updated = this.database.prepare("SELECT * FROM run_metadata WHERE id = ?").get(id) as RunRow;
      this.database.exec("COMMIT");
      return this.inflate(updated);
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }

  systemError(id: string, code: string, message: string, retryable: boolean): StoredRun | null {
    const now = new Date().toISOString();
    const changes = this.database.prepare("UPDATE run_metadata SET status = 'SYSTEM_ERROR', verdict = 'INCONCLUSIVE', active_stage = NULL, completed_at = ?, system_error_code = ?, system_error_message = ?, system_error_retryable = ? WHERE id = ? AND status = 'RUNNING'").run(now, code, message, retryable ? 1 : 0, id).changes;
    return changes ? this.get(id) : null;
  }

  requeue(id: string): boolean {
    return this.database.prepare("UPDATE run_metadata SET status = 'QUEUED', started_at = NULL, active_stage = NULL WHERE id = ? AND status = 'RUNNING'").run(id).changes > 0;
  }

  recoverInterruptedRuns(): void {
    const now = new Date().toISOString();
    this.database.prepare("UPDATE run_metadata SET status = 'SYSTEM_ERROR', verdict = 'INCONCLUSIVE', active_stage = NULL, completed_at = ?, system_error_code = 'API_RESTARTED', system_error_message = 'The API restarted before the run completed.', system_error_retryable = 1 WHERE status = 'RUNNING'").run(now);
  }

  close(): void { this.database.close(); }

  private inflate(row: RunRow): StoredRun {
    const checks = this.database.prepare("SELECT * FROM normalized_checks WHERE run_id = ? ORDER BY check_index").all(row.id) as Array<{
      check_id: string; stage: NormalizedCheck["stage"]; title: string; outcome: NormalizedCheck["outcome"]; started_at: string | null; completed_at: string | null; duration_ms: number | null; exit_code: number | null; summary: string;
    }>;
    const request: VerifyRequest = {
      contractVersion: row.contract_version, repositoryUrl: row.repository_url, resolvedCommitSha: row.resolved_commit_sha,
      resolvedRef: JSON.parse(row.resolved_ref_json), skill: { name: row.skill_name, version: row.skill_version, hash: row.skill_hash }, public: row.is_public === 1,
    };
    const base = { contractVersion: CONTRACT_VERSION, id: row.id, createdAt: row.created_at, links: { self: `/api/runs/${row.id}`, receipt: null } };
    let response: RunResponse;
    if (row.status === "QUEUED") response = { ...base, status: "QUEUED", verdict: null, activeStage: null, queuePosition: this.queuePosition(row.queue_sequence), startedAt: null, completedAt: null, report: null, systemError: null };
    else if (row.status === "RUNNING") response = { ...base, status: "RUNNING", verdict: null, activeStage: row.active_stage ?? "SANDBOX", queuePosition: null, startedAt: row.started_at!, completedAt: null, report: null, systemError: null };
    else if (row.status === "SYSTEM_ERROR") response = { ...base, status: "SYSTEM_ERROR", verdict: "INCONCLUSIVE", activeStage: null, queuePosition: null, startedAt: row.started_at, completedAt: row.completed_at!, report: null, systemError: { code: row.system_error_code ?? "SYSTEM_ERROR", message: row.system_error_message ?? "The runner could not complete this run.", retryable: row.system_error_retryable === 1 } };
    else {
      const report: VerificationReport = row.report_json
        ? JSON.parse(row.report_json) as VerificationReport
        : { contractVersion: CONTRACT_VERSION, runId: row.id, repositoryUrl: row.repository_url, resolvedCommitSha: row.resolved_commit_sha, resolvedRef: request.resolvedRef, skill: request.skill, runtimeImageDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000", verdict: row.verdict!, checks: checks.map((check) => ({ id: check.check_id, stage: check.stage, title: check.title, outcome: check.outcome, startedAt: check.started_at, completedAt: check.completed_at, durationMs: check.duration_ms, exitCode: check.exit_code, summary: check.summary })), durationMs: Math.max(0, Date.parse(row.completed_at!) - Date.parse(row.started_at!)), completedAt: row.completed_at!, reasonCode: null };
      response = { ...base, links: { ...base.links, receipt: `/api/receipts/${row.id}` }, status: row.status, verdict: row.verdict!, activeStage: null, queuePosition: null, startedAt: row.started_at!, completedAt: row.completed_at!, report, systemError: null } as RunResponse;
    }
    return { request, response: RunResponseSchema.parse(response), sequence: row.queue_sequence };
  }

  private queuePosition(sequence: number): number {
    const before = this.database.prepare("SELECT COUNT(*) AS value FROM run_metadata WHERE status = 'QUEUED' AND queue_sequence <= ?").get(sequence) as { value: number };
    return before.value;
  }
}
