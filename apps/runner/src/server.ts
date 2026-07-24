import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  CONTRACT_VERSION,
  InternalCancellationRequestSchema,
  InternalDispatchRequestSchema,
  InternalHeartbeatRequestSchema,
  InternalResultDeliveryRequestSchema,
} from "@ever-guild/proof-runner-schema";
import type { RunnerConfig } from "./config.js";
import { loadRunnerConfig } from "./config.js";
import { RunnerService, TransportError } from "./service.js";

const MAX_BODY_BYTES = 1024 * 1024;

const json = (
  response: ServerResponse,
  status: number,
  body: unknown,
): void => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
};

const readJson = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      throw new TransportError("INVALID_REQUEST", "Request body is too large", 400);
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new TransportError("INVALID_REQUEST", "Request body is not JSON", 400);
  }
};

const versionAwareParse = <T>(
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T } },
  value: unknown,
): T => {
  if (
    typeof value === "object" &&
    value !== null &&
    "contractVersion" in value &&
    value.contractVersion !== CONTRACT_VERSION
  ) {
    throw new TransportError(
      "VERSION_MISMATCH",
      `Contract version must be ${CONTRACT_VERSION}`,
      400,
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data === undefined) {
    throw new TransportError("INVALID_REQUEST", "Request does not match contract", 400);
  }
  return parsed.data;
};

const runPath = (
  pathname: string,
): { runId: string; action: "heartbeat" | "status" | "result" | "cancel" } | null => {
  const match = pathname.match(
    /^\/internal\/v1\/runs\/([0-9a-f-]+)\/(heartbeat|status|result|cancel)$/,
  );
  if (!match?.[1] || !match[2]) return null;
  return {
    runId: match[1],
    action: match[2] as "heartbeat" | "status" | "result" | "cancel",
  };
};

export type RunnerHttpServer = ReturnType<typeof createServer> & {
  config: RunnerConfig;
  service: RunnerService;
};

export const createRunnerServer = (
  config = loadRunnerConfig(),
  service = new RunnerService(config),
): RunnerHttpServer => {
  const server = createServer(async (request, response) => {
    try {
      service.authenticate(request.headers.authorization);
      const url = new URL(request.url ?? "/", "http://runner.internal");
      if (request.method === "POST" && url.pathname === "/internal/v1/runs") {
        const body = versionAwareParse(
          InternalDispatchRequestSchema,
          await readJson(request),
        );
        json(response, 202, service.dispatch(body));
        return;
      }
      const route = runPath(url.pathname);
      if (!route) {
        json(response, 404, {
          contractVersion: CONTRACT_VERSION,
          error: {
            code: "RUN_NOT_FOUND",
            message: "Internal runner route was not found",
            retryable: false,
          },
        });
        return;
      }
      if (request.method === "POST" && route.action === "heartbeat") {
        const body = versionAwareParse(
          InternalHeartbeatRequestSchema,
          await readJson(request),
        );
        json(
          response,
          200,
          service.heartbeat(
            route.runId,
            body.leaseId,
            body.observedAt,
            body.activeStage,
          ),
        );
        return;
      }
      if (request.method === "GET" && route.action === "status") {
        json(response, 200, service.status(route.runId));
        return;
      }
      if (request.method === "PUT" && route.action === "result") {
        const body = versionAwareParse(
          InternalResultDeliveryRequestSchema,
          await readJson(request),
        );
        json(response, 200, service.deliverResult(route.runId, body));
        return;
      }
      if (request.method === "POST" && route.action === "cancel") {
        versionAwareParse(
          InternalCancellationRequestSchema,
          await readJson(request),
        );
        json(response, 202, service.cancel(route.runId));
        return;
      }
      throw new TransportError("INVALID_REQUEST", "Method is not allowed", 400);
    } catch (error) {
      const transport =
        error instanceof TransportError
          ? error
          : new TransportError(
              "INTERNAL_ERROR",
              error instanceof Error ? error.message : "Internal runner error",
              500,
              true,
            );
      json(response, transport.status, {
        contractVersion: CONTRACT_VERSION,
        error: {
          code: transport.code,
          message: transport.message,
          retryable: transport.retryable,
        },
      });
    }
  }) as RunnerHttpServer;
  server.config = config;
  server.service = service;
  return server;
};
