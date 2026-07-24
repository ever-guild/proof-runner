import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  CONTRACT_VERSION,
  InspectRequestSchema,
  InternalHeartbeatRequestSchema,
  InternalResultDeliveryRequestSchema,
  VerifyRequestSchema,
} from "@ever-guild/proof-runner-schema";
import { InspectionService } from "./inspection.js";
import { Orchestrator } from "./orchestration.js";
import { RunStore } from "./store.js";

const MAX_BODY = 1024 * 1024;
class RequestBodyError extends Error {}

const send = (response: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), "cache-control": "no-store" });
  response.end(body);
};
const publicError = (response: ServerResponse, status: number, code: string, message: string, retryable = false): void => send(response, status, { contractVersion: CONTRACT_VERSION, error: { code, message, retryable } });
const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of request) { const buffer = Buffer.from(chunk); length += buffer.length; if (length > MAX_BODY) throw new RequestBodyError(); chunks.push(buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new RequestBodyError(); }
};
const parse = <T>(schema: { safeParse(value: unknown): { success: boolean; data?: T } }, body: unknown): T | null => {
  if (typeof body === "object" && body !== null && "contractVersion" in body && body.contractVersion !== CONTRACT_VERSION) return null;
  const result = schema.safeParse(body); return result.success ? result.data! : null;
};

export interface ApiServerDependencies {
  store: RunStore;
  inspection: InspectionService;
  orchestrator: Orchestrator;
  bearerToken: string;
  receiptReader?: {
    get(id: string): { receipt: unknown } | null;
    publicKey(keyId: string): unknown | null;
    verify(receipt: unknown): unknown;
  };
}

export const createApiServer = (dependencies: ApiServerDependencies) => {
  const authenticated = (header: string | undefined): boolean => {
    const supplied = header?.startsWith("Bearer ") ? Buffer.from(header.slice(7)) : null;
    const expected = Buffer.from(dependencies.bearerToken);
    return supplied !== null && supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://api.internal");
    try {
      if (request.method === "POST" && url.pathname === "/api/inspect") {
        const body = parse(InspectRequestSchema, await readJson(request));
        if (!body) return publicError(response, 400, "INVALID_REQUEST", "Request does not match the inspection contract.");
        return send(response, 200, await dependencies.inspection.inspect(body.repositoryUrl, body.ref));
      }
      if (request.method === "POST" && url.pathname === "/api/verify") {
        const key = request.headers["idempotency-key"];
        if (typeof key !== "string" || !key.trim() || key.length > 255) return publicError(response, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.");
        const body = parse(VerifyRequestSchema, await readJson(request));
        if (!body) return publicError(response, 400, "INVALID_REQUEST", "Request does not match the verification contract.");
        const created = dependencies.store.create(key, body);
        if (created.kind === "conflict") return publicError(response, 409, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency-Key was used with a different request.");
        if (created.kind === "full") return send(response, 429, { contractVersion: CONTRACT_VERSION, error: { code: "RUN_QUEUE_FULL", message: "The run queue is full.", retryable: true, capacity: { active: 1, waiting: 5 } } });
        void dependencies.orchestrator.dispatchNext();
        return send(response, created.kind === "created" ? 202 : 200, { contractVersion: CONTRACT_VERSION, run: dependencies.store.get(created.run.response.id)!.response, replayed: created.kind === "replayed" });
      }
      const publicRun = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (request.method === "GET" && publicRun) {
        const run = dependencies.store.get(decodeURIComponent(publicRun[1] ?? ""));
        return run ? send(response, 200, run.response) : publicError(response, 404, "RUN_NOT_FOUND", "Run was not found.");
      }
      const receipt = url.pathname.match(/^\/api\/receipts\/([^/]+)$/);
      if (request.method === "GET" && receipt) {
        const stored = dependencies.receiptReader?.get(decodeURIComponent(receipt[1] ?? ""));
        return stored ? send(response, 200, stored.receipt) : publicError(response, 404, "RECEIPT_NOT_FOUND", "Receipt was not found.");
      }
      const receiptKey = url.pathname.match(/^\/api\/receipt-keys\/([^/]+)$/);
      if (request.method === "GET" && receiptKey) {
        const key = dependencies.receiptReader?.publicKey(decodeURIComponent(receiptKey[1] ?? ""));
        return key ? send(response, 200, key) : publicError(response, 404, "RECEIPT_NOT_FOUND", "Receipt key was not found.");
      }
      if (request.method === "POST" && url.pathname === "/api/receipts/verify") {
        if (!dependencies.receiptReader) return publicError(response, 404, "RECEIPT_NOT_FOUND", "Receipt service is not configured.");
        return send(response, 200, dependencies.receiptReader.verify(await readJson(request)));
      }
      const callback = url.pathname.match(/^\/internal\/v1\/runs\/([^/]+)\/(heartbeat|result)$/);
      if (callback) {
        if (!authenticated(request.headers.authorization)) return publicError(response, 401, "UNAUTHORIZED", "Internal authentication is required.");
        const runId = decodeURIComponent(callback[1] ?? "");
        if (callback[2] === "heartbeat" && request.method === "POST") {
          const body = parse(InternalHeartbeatRequestSchema, await readJson(request));
          if (!body) return publicError(response, 400, "INVALID_REQUEST", "Request does not match the internal contract.");
          const leaseExpiresAt = dependencies.orchestrator.heartbeat(runId, body.leaseId, body.activeStage);
          return leaseExpiresAt
            ? send(response, 200, { contractVersion: CONTRACT_VERSION, lease: { leaseId: body.leaseId, leaseExpiresAt }, cancellationRequested: false })
            : publicError(response, 409, "LEASE_EXPIRED", "Run lease is no longer active.");
        }
        if (callback[2] === "result" && request.method === "PUT") {
          const body = parse(InternalResultDeliveryRequestSchema, await readJson(request));
          if (!body) return publicError(response, 400, "INVALID_REQUEST", "Request does not match the internal contract.");
          return await dependencies.orchestrator.result(runId, body)
            ? send(response, 200, { contractVersion: CONTRACT_VERSION, runId, accepted: true })
            : publicError(response, 409, "LEASE_EXPIRED", "Run lease is no longer active.");
        }
      }
      return publicError(response, 404, "INVALID_REQUEST", "Route was not found.");
    } catch (error) {
      if (error instanceof RequestBodyError) return publicError(response, 400, "INVALID_REQUEST", "Request body must be valid JSON.");
      return publicError(response, 500, "INTERNAL_ERROR", "The service could not process this request.", true);
    }
  });
};
