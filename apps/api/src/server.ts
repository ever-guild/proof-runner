import { timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { ReceiptService } from "@ever-guild/proof-runner-receipt";
import {
  CONTRACT_VERSION,
  InspectRepositoryA2McpRequestSchema,
  InspectRequestSchema,
  InternalHeartbeatRequestSchema,
  InternalResultDeliveryRequestSchema,
  VerifyRepositoryA2McpRequestSchema,
  VerifyRequestSchema,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import { InspectionService, InspectionUnavailableError } from "./inspection.js";
import { Orchestrator } from "./orchestration.js";
import {
  InvalidJsonBodyError,
  readJson,
  RequestBodyTooLargeError,
} from "./request-body.js";
import { RunStore } from "./store.js";

export interface ApiServerDependencies {
  store: RunStore;
  inspection: InspectionService;
  orchestrator: Orchestrator;
  bearerToken: string;
  receipts?: Pick<ReceiptService, "get" | "publicKey" | "verify">;
}

const send = (response: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
};

const publicError = (
  response: ServerResponse,
  status: number,
  code:
    | "INVALID_REQUEST"
    | "IDEMPOTENCY_KEY_REQUIRED"
    | "IDEMPOTENCY_KEY_CONFLICT"
    | "RUN_NOT_FOUND"
    | "RECEIPT_NOT_FOUND"
    | "REQUEST_BODY_TOO_LARGE"
    | "NOT_READY"
    | "INTERNAL_ERROR",
  message: string,
  retryable = false,
): void => {
  send(response, status, {
    contractVersion: CONTRACT_VERSION,
    error: { code, message, retryable },
  });
};

const internalError = (
  response: ServerResponse,
  status: number,
  code:
    | "UNAUTHORIZED"
    | "INVALID_REQUEST"
    | "RUN_NOT_FOUND"
    | "LEASE_EXPIRED"
    | "RESULT_CONFLICT"
    | "INTERNAL_ERROR",
  message: string,
  retryable = false,
): void => {
  send(response, status, {
    contractVersion: CONTRACT_VERSION,
    error: { code, message, retryable },
  });
};

const queueFull = (response: ServerResponse): void => {
  send(response, 429, {
    contractVersion: CONTRACT_VERSION,
    error: {
      code: "RUN_QUEUE_FULL",
      message: "The run queue is full.",
      retryable: true,
      capacity: { active: 1, waiting: 5 },
    },
  });
};

const parse = <T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  candidate: unknown,
): T | null => {
  const parsed = schema.safeParse(candidate);
  return parsed.success && parsed.data !== undefined ? parsed.data : null;
};

const authenticated = (header: string | undefined, expected: string): boolean => {
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const token = Buffer.from(expected);
  return supplied.byteLength === token.byteLength && timingSafeEqual(supplied, token);
};

const decodePathSegment = (value: string): string | null => {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

const escapeHtml = (str: string): string =>
  str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export const renderReceiptOpenGraphHtml = (params: {
  id: string;
  title: string;
  description: string;
  url: string;
}): string => {
  const safeTitle = escapeHtml(params.title);
  const safeDesc = escapeHtml(params.description);
  const safeUrl = escapeHtml(params.url);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDesc}" />
    <meta property="og:title" content="${safeTitle}" />
    <meta property="og:description" content="${safeDesc}" />
    <meta property="og:url" content="${safeUrl}" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${safeTitle}" />
    <meta name="twitter:description" content="${safeDesc}" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  </head>
  <body style="background-color:#020617;color:#ffffff;font-family:sans-serif;padding:2rem;">
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeDesc}</p>
    </main>
  </body>
</html>`;
};


export const createApiServer = (dependencies: ApiServerDependencies) => {
  const startVerification = (
    idempotencyKey: string,
    request: VerifyRequest,
  ) => {
    const created = dependencies.store.create(idempotencyKey, request);
    if (created.kind === "created" || created.kind === "replayed") {
      void dependencies.orchestrator.dispatchNext();
    }
    return created;
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://api.internal");
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    const receiptMatch = url.pathname.match(/^\/api\/receipts\/([^/]+)$/);
    const htmlReceiptMatch = url.pathname.match(/^\/(?:receipts|examples)\/([^/]+)$/);
    const receiptKeyMatch = url.pathname.match(/^\/api\/receipt-keys\/([^/]+)$/);
    const callbackMatch = url.pathname.match(
      /^\/internal\/v1\/runs\/([^/]+)\/(heartbeat|result)$/,
    );

    try {
const apiDemoReceipts: Record<string, { verdict: string; status: string; gitTag: string; repository: string; summary: string }> = {
  passed: { verdict: "PASS", status: "COMPLETED", gitTag: "demo-fixed", repository: "ever-guild/proof-runner", summary: "All 5 demo checks passed in 12.4 seconds." },
  broken: { verdict: "FAIL", status: "COMPLETED", gitTag: "demo-broken", repository: "ever-guild/proof-runner", summary: "4 of 5 demo checks passed in 14.1 seconds. 1 reproducible code test failure found." },
  timeout: { verdict: "INCONCLUSIVE", status: "TIMEOUT", gitTag: "demo-timeout", repository: "ever-guild/proof-runner", summary: "Execution timed out after 45,000 ms before completing all checks." },
  "system-error": { verdict: "INCONCLUSIVE", status: "SYSTEM_ERROR", gitTag: "demo-system-error", repository: "ever-guild/proof-runner", summary: "Runner daemon lost connection (RUNNER_DISCONNECTED)." },
  inconclusive: { verdict: "INCONCLUSIVE", status: "COMPLETED", gitTag: "demo-inconclusive", repository: "ever-guild/proof-runner", summary: "Build succeeded but test framework output was ambiguous." },
};

      if (request.method === "GET" && htmlReceiptMatch && (request.headers.accept?.includes("text/html") ?? true)) {
        const receiptId = decodePathSegment(htmlReceiptMatch[1] ?? "");
        if (receiptId !== null) {
          const hostHeader = (request.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || request.headers.host || "proofrunner.org";
          const protoHeader = (request.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim() || "https";
          const fullUrl = `${protoHeader}://${hostHeader}${url.pathname}`;
          const isDemo = receiptId === "passed" || receiptId === "broken" || receiptId === "timeout" || receiptId === "system-error" || receiptId === "inconclusive" || url.pathname.startsWith("/examples/");

          if (isDemo) {
            const kind = receiptId === "timeout" || url.pathname.includes("/timeout") ? "timeout"
              : receiptId === "system-error" || url.pathname.includes("/system-error") ? "system-error"
                : receiptId === "inconclusive" || url.pathname.includes("/inconclusive") ? "inconclusive"
                  : receiptId === "broken" || url.pathname.endsWith("/broken") ? "broken"
                    : "passed";
            const demo = apiDemoReceipts[kind] ?? apiDemoReceipts["passed"]!;
            const displayVerdict = demo.status === "TIMEOUT" ? "TIMEOUT" : demo.status === "SYSTEM_ERROR" ? "SYSTEM_ERROR" : demo.verdict;
            const title = `[DEMO] ${displayVerdict} Verification Receipt (${demo.gitTag}) · ProofRunner`;
            const description = `Demo verification evidence for ${demo.repository} at tag ${demo.gitTag}: ${demo.summary}`;

            const html = renderReceiptOpenGraphHtml({ id: receiptId, title, description, url: fullUrl });
            response.writeHead(200, {
              "cache-control": "public, max-age=60",
              "content-length": Buffer.byteLength(html),
              "content-type": "text/html; charset=utf-8",
            });
            return response.end(html);
          }


          const liveReceipt = dependencies.receipts?.get(receiptId);
          if (!liveReceipt) {
            const title = `Receipt Not Found · ProofRunner`;
            const description = `Verification receipt ${receiptId} was not found.`;
            const html = renderReceiptOpenGraphHtml({ id: receiptId, title, description, url: fullUrl });
            response.writeHead(404, {
              "cache-control": "no-store",
              "content-length": Buffer.byteLength(html),
              "content-type": "text/html; charset=utf-8",
            });
            return response.end(html);
          }

          const rawReceipt = liveReceipt.receipt as Record<string, unknown>;
          const payload = rawReceipt.payload as Record<string, unknown> | undefined;
          const report = (payload?.report ?? rawReceipt.report) as Record<string, unknown> | undefined;
          const verdict = typeof report?.verdict === "string" ? report.verdict : typeof rawReceipt.verdict === "string" ? rawReceipt.verdict : "INCONCLUSIVE";

          const title = `Verification Receipt ${receiptId} · ${verdict} · ProofRunner`;
          const description = `Signed verification evidence receipt for run ${receiptId} with verdict ${verdict}.`;
          const html = renderReceiptOpenGraphHtml({ id: receiptId, title, description, url: fullUrl });
          response.writeHead(200, {
            "cache-control": "public, max-age=60",
            "content-length": Buffer.byteLength(html),
            "content-type": "text/html; charset=utf-8",
          });
          return response.end(html);
        }
      }


      if (request.method === "GET" && url.pathname === "/health/live") {
        return send(response, 200, { status: "live" });
      }
      if (request.method === "GET" && url.pathname === "/health/ready") {
        return dependencies.store.isReady()
          ? send(response, 200, { status: "ready" })
          : publicError(
              response,
              503,
              "NOT_READY",
              "The service is not ready.",
              true,
            );
      }

      if (request.method === "POST" && url.pathname === "/api/inspect") {
        const body = parse(InspectRequestSchema, await readJson(request));
        if (!body) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Request does not match the inspection contract.",
          );
        }
        return send(
          response,
          200,
          await dependencies.inspection.inspect(body.repositoryUrl, body.ref),
        );
      }

      if (request.method === "POST" && url.pathname === "/a2mcp/inspect_repository") {
        const body = parse(
          InspectRepositoryA2McpRequestSchema,
          await readJson(request),
        );
        if (!body) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Request does not match the inspection contract.",
          );
        }
        return send(response, 200, {
          contractVersion: CONTRACT_VERSION,
          operation: "inspect_repository",
          result: await dependencies.inspection.inspect(body.repositoryUrl, body.ref),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/verify") {
        const idempotencyKey = request.headers["idempotency-key"];
        if (
          typeof idempotencyKey !== "string" ||
          !idempotencyKey.trim() ||
          idempotencyKey.length > 255
        ) {
          return publicError(
            response,
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Idempotency-Key is required.",
          );
        }

        const body = parse(VerifyRequestSchema, await readJson(request));
        if (!body) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Request does not match the verification contract.",
          );
        }

        const created = startVerification(idempotencyKey, body);
        if (created.kind === "conflict") {
          return publicError(
            response,
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "Idempotency-Key was used with a different request.",
          );
        }
        if (created.kind === "full") return queueFull(response);

        const current = dependencies.store.get(created.run.response.id) ?? created.run;
        return send(response, created.kind === "created" ? 202 : 200, {
          contractVersion: CONTRACT_VERSION,
          run: current.response,
          replayed: created.kind === "replayed",
        });
      }

      if (request.method === "POST" && url.pathname === "/a2mcp/verify_repository") {
        const body = parse(
          VerifyRepositoryA2McpRequestSchema,
          await readJson(request),
        );
        if (!body) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Request does not match the verification contract.",
          );
        }
        const { idempotencyKey, ...verifyRequest } = body;
        const created = startVerification(idempotencyKey, verifyRequest);
        if (created.kind === "conflict") {
          return publicError(
            response,
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "Idempotency-Key was used with a different request.",
          );
        }
        if (created.kind === "full") return queueFull(response);

        const current = dependencies.store.get(created.run.response.id) ?? created.run;
        return send(response, 200, {
          contractVersion: CONTRACT_VERSION,
          operation: "verify_repository",
          result: current.response,
        });
      }

      if (request.method === "GET" && runMatch) {
        const runId = decodePathSegment(runMatch[1] ?? "");
        if (runId === null) {
          return publicError(response, 400, "INVALID_REQUEST", "Run ID is invalid.");
        }
        const run = dependencies.store.get(runId);
        if (!run) {
          return publicError(response, 404, "RUN_NOT_FOUND", "Run was not found.");
        }
        return send(response, 200, run.response);
      }

      if (request.method === "GET" && receiptMatch) {
        const receiptId = decodePathSegment(receiptMatch[1] ?? "");
        if (receiptId === null) {
          return publicError(response, 400, "INVALID_REQUEST", "Receipt ID is invalid.");
        }
        const receipt = dependencies.receipts?.get(receiptId);
        if (!receipt) {
          return publicError(
            response,
            404,
            "RECEIPT_NOT_FOUND",
            "Receipt was not found.",
          );
        }
        return send(response, 200, receipt.receipt);
      }

      if (request.method === "GET" && receiptKeyMatch) {
        const keyId = decodePathSegment(receiptKeyMatch[1] ?? "");
        if (keyId === null) {
          return publicError(response, 400, "INVALID_REQUEST", "Receipt key ID is invalid.");
        }
        const key = dependencies.receipts?.publicKey(keyId);
        if (!key) {
          return publicError(
            response,
            404,
            "RECEIPT_NOT_FOUND",
            "Receipt key was not found.",
          );
        }
        return send(response, 200, key);
      }

      if (request.method === "POST" && url.pathname === "/api/receipts/verify") {
        if (!dependencies.receipts) {
          return publicError(
            response,
            404,
            "RECEIPT_NOT_FOUND",
            "Receipt verification is not configured.",
          );
        }
        return send(response, 200, dependencies.receipts.verify(await readJson(request)));
      }

      if (callbackMatch) {
        if (!authenticated(request.headers.authorization, dependencies.bearerToken)) {
          return internalError(
            response,
            401,
            "UNAUTHORIZED",
            "Internal authentication is required.",
          );
        }
        const runId = decodePathSegment(callbackMatch[1] ?? "");
        if (runId === null) {
          return internalError(response, 400, "INVALID_REQUEST", "Run ID is invalid.");
        }

        if (callbackMatch[2] === "heartbeat" && request.method === "POST") {
          const body = parse(
            InternalHeartbeatRequestSchema,
            await readJson(request),
          );
          if (!body) {
            return internalError(
              response,
              400,
              "INVALID_REQUEST",
              "Request does not match the internal contract.",
            );
          }
          const outcome = dependencies.orchestrator.heartbeat(
            runId,
            body.leaseId,
            body.activeStage,
          );
          if (outcome.kind === "RUN_NOT_FOUND") {
            return internalError(response, 404, "RUN_NOT_FOUND", "Run was not found.");
          }
          if (outcome.kind === "LEASE_EXPIRED") {
            return internalError(
              response,
              409,
              "LEASE_EXPIRED",
              "Run lease is no longer active.",
            );
          }
          return send(response, 200, {
            contractVersion: CONTRACT_VERSION,
            lease: { leaseId: body.leaseId, leaseExpiresAt: outcome.leaseExpiresAt },
            cancellationRequested: false,
          });
        }

        if (callbackMatch[2] === "result" && request.method === "PUT") {
          const body = parse(
            InternalResultDeliveryRequestSchema,
            await readJson(request),
          );
          if (!body) {
            return internalError(
              response,
              400,
              "INVALID_REQUEST",
              "Request does not match the internal contract.",
            );
          }
          const outcome = await dependencies.orchestrator.result(runId, body);
          if (outcome !== "ACCEPTED") {
            if (outcome === "RUN_NOT_FOUND") {
              return internalError(response, 404, "RUN_NOT_FOUND", "Run was not found.");
            }
            return internalError(
              response,
              409,
              outcome,
              outcome === "RESULT_CONFLICT"
                ? "A different terminal result is already stored."
                : "Run lease is no longer active.",
            );
          }
          return send(response, 200, {
            contractVersion: CONTRACT_VERSION,
            runId,
            accepted: true,
          });
        }
      }

      return publicError(response, 404, "INVALID_REQUEST", "Route was not found.");
    } catch (error) {
      const internalRoute = url.pathname.startsWith("/internal/v1/");
      if (error instanceof RequestBodyTooLargeError) {
        return internalRoute
          ? internalError(
              response,
              413,
              "INVALID_REQUEST",
              "Request body exceeds the 1 MiB limit.",
            )
          : publicError(
              response,
              413,
              "REQUEST_BODY_TOO_LARGE",
              "Request body exceeds the 1 MiB limit.",
            );
      }
      if (error instanceof InvalidJsonBodyError) {
        return internalRoute
          ? internalError(
              response,
              400,
              "INVALID_REQUEST",
              "Request body must be valid JSON.",
            )
          : publicError(
              response,
              400,
              "INVALID_REQUEST",
              "Request body must be valid JSON.",
            );
      }
      if (error instanceof InspectionUnavailableError) {
        return publicError(
          response,
          503,
          "INTERNAL_ERROR",
          "Repository metadata is temporarily unavailable.",
          true,
        );
      }
      return internalRoute
        ? internalError(
            response,
            500,
            "INTERNAL_ERROR",
            "The API could not process this request.",
            true,
          )
        : publicError(
            response,
            500,
            "INTERNAL_ERROR",
            "The API could not process this request.",
            true,
          );
    }
  });
};
