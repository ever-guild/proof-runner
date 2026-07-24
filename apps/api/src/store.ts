import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  CONTRACT_VERSION,
  canonicalize,
  ReceiptPayloadSchema,
  RunResponseSchema,
  SignedReceiptSchema,
  VerificationReportSchema,
  VerifyRequestSchema,
  type NormalizedCheck,
  type RunResponse,
  type SignedReceipt,
  type VerificationReport,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";

type RunRow = {
  id: string;
  contract_version: "1.0";
  idempotency_scope: string;
  idempotency_key: string;
  request_fingerprint: string;
  repository_url: string;
  resolved_commit_sha: string;
  resolved_ref_json: string;
  skill_name: "node-typescript";
  skill_version: "1";
  skill_hash: string;
  status: RunResponse["status"];
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE" | null;
  queue_sequence: number;
  active_stage: NormalizedCheck["stage"] | null;
  is_public: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  report_json: string | null;
  system_error_code: string | null;
  system_error_message: string | null;
  system_error_retryable: number | null;
  result_fingerprint: string | null;
};

export type StoredRun = {
  request: VerifyRequest;
  response: RunResponse;
  sequence: number;
};

export type CreateRunResult =
  | { kind: "created" | "replayed"; run: StoredRun }
  | { kind: "conflict" }
  | { kind: "full" };

export type PersistedResultDeliveryOutcome =
  | "PENDING"
  | "ACCEPTED"
  | "RESULT_CONFLICT"
  | "RUN_NOT_FOUND";

const idempotencyScope = "anonymous";

const fingerprint = (request: VerifyRequest): string =>
  createHash("sha256").update(canonicalize(request)).digest("hex");

const fingerprintPattern = /^[a-f0-9]{64}$/;

const initialSchemaTables = {
  run_metadata: [
    "id",
    "contract_version",
    "idempotency_scope",
    "idempotency_key",
    "request_fingerprint",
    "repository_url",
    "resolved_commit_sha",
    "resolved_ref_json",
    "skill_name",
    "skill_version",
    "skill_hash",
    "status",
    "verdict",
    "queue_sequence",
    "active_stage",
    "is_public",
    "created_at",
    "started_at",
    "completed_at",
  ],
  normalized_checks: [
    "run_id",
    "check_index",
    "check_id",
    "stage",
    "title",
    "outcome",
    "started_at",
    "completed_at",
    "duration_ms",
    "exit_code",
    "summary",
  ],
  signed_receipts: [
    "id",
    "run_id",
    "payload_json",
    "payload_hash",
    "key_id",
    "signature",
    "created_at",
  ],
  raw_logs: ["run_id", "sequence", "stream", "content", "created_at", "expires_at"],
} as const;

// This mirrors 002_run_orchestration.sql so an interrupted legacy migration can
// be repaired one column at a time before the version is recorded.
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
  ["result_fingerprint", "ALTER TABLE run_metadata ADD COLUMN result_fingerprint TEXT"],
] as const;

/**
 * The persistence seam owns queue admission, idempotency and run-state
 * transitions. Callers only deal in validated requests and normalized reports.
 */
export class RunStore {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  create(idempotencyKey: string, request: VerifyRequest): CreateRunResult {
    const requestFingerprint = fingerprint(request);

    return this.transaction(() => {
      const existing = this.database.prepare(
        `SELECT * FROM run_metadata
         WHERE idempotency_scope = ? AND idempotency_key = ?`,
      ).get(idempotencyScope, idempotencyKey) as RunRow | undefined;

      if (existing) {
        if (existing.request_fingerprint !== requestFingerprint) {
          return { kind: "conflict" };
        }
        return { kind: "replayed", run: this.inflate(existing) };
      }

      const waiting = this.database.prepare(
        `SELECT COUNT(*) AS value FROM run_metadata
         WHERE status = 'QUEUED'`,
      ).get() as { value: number };
      if (Number(waiting.value) >= 5) return { kind: "full" };

      const sequence = this.database.prepare(
        "SELECT COALESCE(MAX(queue_sequence), 0) + 1 AS value FROM run_metadata",
      ).get() as { value: number };
      const id = randomUUID();
      const createdAt = new Date().toISOString();

      this.database.prepare(
        `INSERT INTO run_metadata (
          id, contract_version, idempotency_scope, idempotency_key,
          request_fingerprint, repository_url, resolved_commit_sha,
          resolved_ref_json, skill_name, skill_version, skill_hash, status,
          verdict, queue_sequence, active_stage, is_public, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', NULL, ?, NULL, ?, ?)`,
      ).run(
        id,
        CONTRACT_VERSION,
        idempotencyScope,
        idempotencyKey,
        requestFingerprint,
        request.repositoryUrl,
        request.resolvedCommitSha,
        JSON.stringify(request.resolvedRef),
        request.skill.name,
        request.skill.version,
        request.skill.hash,
        Number(sequence.value),
        request.public ? 1 : 0,
        createdAt,
      );

      const row = this.row(id);
      if (!row) throw new Error("Run creation did not persist metadata");
      return { kind: "created", run: this.inflate(row) };
    });
  }

  get(id: string): StoredRun | null {
    const row = this.row(id);
    return row ? this.inflate(row) : null;
  }

  resultDeliveryOutcome(
    id: string,
    resultFingerprint: string,
  ): PersistedResultDeliveryOutcome {
    const row = this.row(id);
    if (!row) return "RUN_NOT_FOUND";
    if (row.result_fingerprint === null) return "PENDING";
    return row.result_fingerprint === resultFingerprint
      ? "ACCEPTED"
      : "RESULT_CONFLICT";
  }

  claimNext(): StoredRun | null {
    return this.transaction(() => {
      const active = this.database.prepare(
        "SELECT 1 FROM run_metadata WHERE status = 'RUNNING' LIMIT 1",
      ).get();
      if (active) return null;

      const queued = this.database.prepare(
        `SELECT * FROM run_metadata
         WHERE status = 'QUEUED'
         ORDER BY queue_sequence ASC
         LIMIT 1`,
      ).get() as RunRow | undefined;
      if (!queued) return null;

      const startedAt = new Date().toISOString();
      const changed = this.database.prepare(
        `UPDATE run_metadata
         SET status = 'RUNNING', started_at = ?, active_stage = 'SANDBOX'
         WHERE id = ? AND status = 'QUEUED'`,
      ).run(startedAt, queued.id);
      if (changed.changes !== 1) return null;

      const running = this.row(queued.id);
      if (!running) throw new Error("Claimed run was not persisted");
      return this.inflate(running);
    });
  }

  /**
   * Returns a run to its original FIFO position when the runner explicitly
   * reports that its single slot is still occupied. This differs from an
   * ambiguous transport failure: the runner has confirmed it did not accept
   * the dispatch, so preserving the queued work is safe.
   */
  requeue(id: string): boolean {
    return this.database.prepare(
      `UPDATE run_metadata
       SET status = 'QUEUED', verdict = NULL, active_stage = NULL,
           started_at = NULL, completed_at = NULL, report_json = NULL,
           system_error_code = NULL, system_error_message = NULL,
           system_error_retryable = NULL, result_fingerprint = NULL
       WHERE id = ? AND status = 'RUNNING'`,
    ).run(id).changes === 1;
  }

  heartbeat(id: string, stage: NormalizedCheck["stage"] | null): boolean {
    if (stage === null) {
      return this.database.prepare(
        "SELECT 1 FROM run_metadata WHERE id = ? AND status = 'RUNNING'",
      ).get(id) !== undefined;
    }
    return this.database.prepare(
      `UPDATE run_metadata
       SET active_stage = ?
       WHERE id = ? AND status = 'RUNNING'`,
    ).run(stage, id).changes === 1;
  }

  complete(
    id: string,
    status: "COMPLETED" | "TIMEOUT",
    report: VerificationReport,
    receipt: SignedReceipt,
    resultFingerprint: string,
  ): boolean {
    const parsedReport = VerificationReportSchema.safeParse(report);
    const parsedReceipt = SignedReceiptSchema.safeParse(receipt);
    if (
      !parsedReport.success ||
      !parsedReceipt.success ||
      parsedReport.data.runId !== id ||
      (status === "TIMEOUT" && parsedReport.data.verdict !== "INCONCLUSIVE") ||
      parsedReceipt.data.payload.id !== id ||
      canonicalize(parsedReceipt.data.payload.report) !== canonicalize(parsedReport.data) ||
      !fingerprintPattern.test(resultFingerprint)
    ) {
      return false;
    }
    const normalizedReport = parsedReport.data;
    const signedReceipt = parsedReceipt.data;

    return this.transaction(() => {
      const current = this.row(id);
      if (
        !current ||
        current.status !== "RUNNING" ||
        !this.matchesReport(current, normalizedReport)
      ) {
        return false;
      }

      const changed = this.database.prepare(
        `UPDATE run_metadata
         SET status = ?, verdict = ?, active_stage = NULL, completed_at = ?,
             report_json = ?, system_error_code = NULL,
             system_error_message = NULL, system_error_retryable = NULL,
             result_fingerprint = ?
         WHERE id = ? AND status = 'RUNNING'`,
      ).run(
        status,
        normalizedReport.verdict,
        normalizedReport.completedAt,
        JSON.stringify(normalizedReport),
        resultFingerprint,
        id,
      );
      if (changed.changes !== 1) return false;

      this.database.prepare("DELETE FROM normalized_checks WHERE run_id = ?").run(id);
      const insertCheck = this.database.prepare(
        `INSERT INTO normalized_checks (
          run_id, check_index, check_id, stage, title, outcome, started_at,
          completed_at, duration_ms, exit_code, summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      normalizedReport.checks.forEach((check, index) => {
        insertCheck.run(
          id,
          index,
          check.id,
          check.stage,
          check.title,
          check.outcome,
          check.startedAt ?? null,
          check.completedAt ?? null,
          check.durationMs ?? null,
          check.exitCode ?? null,
          check.summary,
        );
      });
      this.database.prepare(
        `INSERT INTO signed_receipts (
          id, run_id, payload_json, payload_hash, key_id, signature, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        signedReceipt.payload.id,
        id,
        JSON.stringify(signedReceipt.payload),
        signedReceipt.payloadHash,
        signedReceipt.keyId,
        signedReceipt.signature,
        signedReceipt.payload.createdAt,
      );
      return true;
    });
  }

  systemError(
    id: string,
    code: string,
    message: string,
    retryable: boolean,
    resultFingerprint: string | null = null,
  ): boolean {
    if (resultFingerprint !== null && !fingerprintPattern.test(resultFingerprint)) {
      return false;
    }
    return this.database.prepare(
      `UPDATE run_metadata
       SET status = 'SYSTEM_ERROR', verdict = 'INCONCLUSIVE', active_stage = NULL,
           completed_at = ?, system_error_code = ?, system_error_message = ?,
           system_error_retryable = ?, report_json = NULL, result_fingerprint = ?
       WHERE id = ? AND status = 'RUNNING'`,
    ).run(
      new Date().toISOString(),
      code,
      message,
      retryable ? 1 : 0,
      resultFingerprint,
      id,
    ).changes === 1;
  }

  recoverInterruptedRuns(): string[] {
    const interrupted = this.database.prepare(
      "SELECT id FROM run_metadata WHERE status = 'RUNNING'",
    ).all() as Array<{ id: string }>;
    if (interrupted.length === 0) return [];
    this.database.prepare(
      `UPDATE run_metadata
       SET status = 'SYSTEM_ERROR', verdict = 'INCONCLUSIVE', active_stage = NULL,
           completed_at = ?, system_error_code = 'API_RESTARTED',
           system_error_message = 'The API restarted before the run completed.',
           system_error_retryable = 1, report_json = NULL, result_fingerprint = NULL
       WHERE status = 'RUNNING'`,
    ).run(new Date().toISOString());
    return interrupted.map((run) => run.id);
  }

  close(): void {
    this.database.close();
  }

  isReady(): boolean {
    return this.database.prepare("SELECT 1 AS ready").get() !== undefined;
  }

  private migrate(): void {
    this.database.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)",
    );
    this.migrateInitialSchema();
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
  }

  private migrateInitialSchema(): void {
    const tables = Object.entries(initialSchemaTables) as Array<
      [keyof typeof initialSchemaTables, readonly string[]]
    >;
    const presentTables = tables.filter(([table]) => this.tableColumns(table).length > 0);
    const complete = tables.every(([table, requiredColumns]) => {
      const available = new Set(this.tableColumns(table));
      return requiredColumns.every((column) => available.has(column));
    });
    const applied = this.migrationApplied(1);
    if (!complete) {
      if (applied || presentTables.length > 0) {
        throw new Error("Incomplete initial schema migration detected; refusing to serve database");
      }
      this.transaction(() => {
        this.database.exec(
          readFileSync(
            new URL("../../../packages/schema/migrations/001_initial.sql", import.meta.url),
            "utf8",
          ),
        );
        this.recordMigration(1);
      });
      return;
    }
    if (!applied) this.recordMigration(1);
  }

  private migrateColumnAdditions(
    version: number,
    columns: readonly (readonly [string, string])[],
    filename: string,
  ): void {
    const knownColumns = new Set(this.tableColumns("run_metadata"));
    if (this.migrationApplied(version) && columns.every(([name]) => knownColumns.has(name))) {
      return;
    }
    this.transaction(() => {
      const currentColumns = new Set(this.tableColumns("run_metadata"));
      if (columns.every(([name]) => !currentColumns.has(name))) {
        this.database.exec(
          readFileSync(
            new URL(`../../../packages/schema/migrations/${filename}`, import.meta.url),
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

  private tableColumns(table: keyof typeof initialSchemaTables | "run_metadata"): string[] {
    return (this.database.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{
      name: string;
    }>).map((column) => column.name);
  }

  private migrationApplied(version: number): boolean {
    return this.database.prepare(
      "SELECT 1 FROM schema_migrations WHERE version = ?",
    ).get(version) !== undefined;
  }

  private recordMigration(version: number): void {
    this.database.prepare(
      "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
    ).run(version);
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

  private row(id: string): RunRow | undefined {
    return this.database.prepare("SELECT * FROM run_metadata WHERE id = ?").get(id) as
      | RunRow
      | undefined;
  }

  private requestFor(row: RunRow): VerifyRequest {
    return VerifyRequestSchema.parse({
      contractVersion: row.contract_version,
      repositoryUrl: row.repository_url,
      resolvedCommitSha: row.resolved_commit_sha,
      resolvedRef: JSON.parse(row.resolved_ref_json),
      skill: {
        name: row.skill_name,
        version: row.skill_version,
        hash: row.skill_hash,
      },
      public: row.is_public === 1,
    });
  }

  private inflate(row: RunRow): StoredRun {
    const request = this.requestFor(row);
    const base = {
      contractVersion: CONTRACT_VERSION,
      id: row.id,
      createdAt: row.created_at,
      links: {
        self: `/api/runs/${row.id}`,
        receipt: null,
      },
    };
    let response: RunResponse;

    switch (row.status) {
      case "QUEUED":
        response = {
          ...base,
          status: "QUEUED",
          verdict: null,
          activeStage: null,
          queuePosition: this.queuePosition(row.queue_sequence),
          startedAt: null,
          completedAt: null,
          report: null,
          systemError: null,
        };
        break;
      case "RUNNING":
        response = {
          ...base,
          status: "RUNNING",
          verdict: null,
          activeStage: row.active_stage ?? "SANDBOX",
          queuePosition: null,
          startedAt: row.started_at ?? row.created_at,
          completedAt: null,
          report: null,
          systemError: null,
        };
        break;
      case "SYSTEM_ERROR":
        response = {
          ...base,
          status: "SYSTEM_ERROR",
          verdict: "INCONCLUSIVE",
          activeStage: null,
          queuePosition: null,
          startedAt: row.started_at ?? row.created_at,
          completedAt: row.completed_at ?? row.created_at,
          report: null,
          systemError: {
            code: row.system_error_code ?? "SYSTEM_ERROR",
            message: row.system_error_message ?? "The runner could not complete this run.",
            retryable: row.system_error_retryable === 1,
          },
        };
        break;
      case "COMPLETED": {
        const report = this.reportFor(row);
        const receiptId = this.receiptId(row.id);
        if (!receiptId) {
          throw new Error("Terminal run has no signed receipt");
        }
        response = {
          ...base,
          links: {
            ...base.links,
            receipt: `/api/receipts/${receiptId}`,
          },
          status: "COMPLETED",
          verdict: report.verdict,
          activeStage: null,
          queuePosition: null,
          startedAt: row.started_at ?? row.created_at,
          completedAt: row.completed_at ?? report.completedAt,
          report,
          systemError: null,
        };
        break;
      }
      case "TIMEOUT": {
        const report = this.reportFor(row);
        const receiptId = this.receiptId(row.id);
        if (!receiptId) {
          throw new Error("Terminal run has no signed receipt");
        }
        if (report.verdict !== "INCONCLUSIVE") {
          throw new Error("Timeout run has a conclusive report");
        }
        response = {
          ...base,
          links: {
            ...base.links,
            receipt: `/api/receipts/${receiptId}`,
          },
          status: "TIMEOUT",
          verdict: "INCONCLUSIVE",
          activeStage: null,
          queuePosition: null,
          startedAt: row.started_at ?? row.created_at,
          completedAt: row.completed_at ?? report.completedAt,
          report,
          systemError: null,
        };
        break;
      }
    }

    return {
      request,
      response: RunResponseSchema.parse(response),
      sequence: row.queue_sequence,
    };
  }

  private matchesReport(row: RunRow, report: VerificationReport): boolean {
    const request = this.requestFor(row);
    return (
      report.contractVersion === request.contractVersion &&
      report.repositoryUrl === request.repositoryUrl &&
      report.resolvedCommitSha === request.resolvedCommitSha &&
      JSON.stringify(report.resolvedRef) === JSON.stringify(request.resolvedRef) &&
      report.skill.name === request.skill.name &&
      report.skill.version === request.skill.version &&
      report.skill.hash === request.skill.hash
    );
  }

  private reportFor(row: RunRow): VerificationReport {
    if (row.report_json) {
      return VerificationReportSchema.parse(JSON.parse(row.report_json));
    }
    const receipt = this.database.prepare(
      "SELECT payload_json FROM signed_receipts WHERE run_id = ?",
    ).get(row.id) as { payload_json: string } | undefined;
    if (!receipt) throw new Error("Terminal run has no persisted report");
    return ReceiptPayloadSchema.parse(JSON.parse(receipt.payload_json)).report;
  }

  private receiptId(runId: string): string | null {
    const receipt = this.database.prepare(
      "SELECT id FROM signed_receipts WHERE run_id = ?",
    ).get(runId) as { id: string } | undefined;
    return receipt?.id ?? null;
  }

  private queuePosition(sequence: number): number {
    const queued = this.database.prepare(
      `SELECT COUNT(*) AS value FROM run_metadata
       WHERE status = 'QUEUED' AND queue_sequence <= ?`,
    ).get(sequence) as { value: number };
    return Number(queued.value);
  }
}
