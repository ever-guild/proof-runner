import { timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import {
  getDemoKind,
  getDemoReceiptOpenGraphMetadata,
  isDemoKind,
} from "@ever-guild/proof-runner-metadata";
import type { ReceiptService } from "@ever-guild/proof-runner-receipt";
import {
  ComparisonRequestSchema,
  CONTRACT_VERSION,
  InspectRepositoryA2McpRequestSchema,
  InspectRequestSchema,
  InternalHeartbeatRequestSchema,
  InternalResultDeliveryRequestSchema,
  ReproducibilityRequestSchema,
  VerifyRepositoryA2McpRequestSchema,
  VerifyRequestSchema,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import {
  ComparisonCompatibilityError,
  ComparisonEvidenceNotFoundError,
  ComparisonInvalidSelectorError,
  ComparisonService,
} from "./comparison.js";
import {
  EvidenceBundleLimitError,
  EvidenceBundleNotFoundError,
  EvidenceBundleService,
  MAX_EVIDENCE_BUNDLE_BYTES,
} from "./evidence-bundle.js";
import { InspectionService, InspectionUnavailableError } from "./inspection.js";
import { Orchestrator } from "./orchestration.js";
import {
  InvalidJsonBodyError,
  readBuffer,
  readJson,
  RequestBodyTooLargeError,
} from "./request-body.js";
import { ReproducibilityService } from "./reproducibility.js";
import { RunStore } from "./store.js";

export interface ApiServerDependencies {
  store: RunStore;
  inspection: InspectionService;
  orchestrator: Orchestrator;
  bearerToken: string;
  receipts?: Pick<ReceiptService, "get" | "publicKey" | "verify"> &
    Partial<Pick<ReceiptService, "getByPayloadHash">>;
  reproducibility?: ReproducibilityService;
  comparison?: ComparisonService;
  evidenceBundles?: EvidenceBundleService;
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

const sendArchive = (
  response: ServerResponse,
  filename: string,
  archive: Buffer,
): void => {
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${filename}"`,
    "content-length": archive.length,
    "content-type": "application/zip",
  });
  response.end(archive);
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
    | "COMPARISON_EVIDENCE_NOT_FOUND"
    | "INCOMPATIBLE_EVIDENCE"
    | "REQUEST_BODY_TOO_LARGE"
    | "NOT_READY"
    | "INTERNAL_ERROR",
  message: string,
  retryable = false,
  details?: Record<string, unknown>,
): void => {
  send(response, status, {
    contractVersion: CONTRACT_VERSION,
    error: {
      code,
      message,
      retryable,
      ...(details ? { details } : {}),
    },
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
  const reproducibility =
    dependencies.reproducibility ??
    new ReproducibilityService(dependencies.store);
  const comparison =
    dependencies.comparison ??
    new ComparisonService(
      {
        get: (id) => dependencies.receipts?.get(id) ?? null,
        getByPayloadHash: (payloadHash) =>
          dependencies.receipts?.getByPayloadHash?.(payloadHash) ?? null,
      },
      (runId) =>
        dependencies.store.get(runId)?.request.verificationContract ?? null,
    );
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
  const startReproducibility = (
    idempotencyKey: string,
    request: VerifyRequest,
  ) => {
    const created = reproducibility.create(idempotencyKey, request);
    if (created.kind === "created" || created.kind === "replayed") {
      void dependencies.orchestrator.dispatchNext();
    }
    return created;
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://api.internal");
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
    const reproducibilityMatch = url.pathname.match(
      /^\/api\/reproducibility\/([^/]+)$/,
    );
    const comparisonMatch = url.pathname.match(
      /^\/api\/comparisons\/([^/]+)\/([^/]+)$/,
    );
    const receiptMatch = url.pathname.match(/^\/api\/receipts\/([^/]+)$/);
    const receiptBundleMatch = url.pathname.match(
      /^\/api\/receipts\/([^/]+)\/bundle$/,
    );
    const htmlReceiptMatch = url.pathname.match(/^\/(?:receipts|examples)\/([^/]+)$/);
    const receiptKeyMatch = url.pathname.match(/^\/api\/receipt-keys\/([^/]+)$/);
    const callbackMatch = url.pathname.match(
      /^\/internal\/v1\/runs\/([^/]+)\/(heartbeat|result)$/,
    );

    try {
      if (request.method === "GET" && htmlReceiptMatch && (request.headers.accept?.includes("text/html") ?? true)) {
        const receiptId = decodePathSegment(htmlReceiptMatch[1] ?? "");
        if (receiptId !== null) {
          const forwardedHeader = (name: "x-forwarded-host" | "x-forwarded-proto") => {
            const value = request.headers[name];
            return (Array.isArray(value) ? value[0] : value)?.split(",")[0]?.trim();
          };
          const hostHeader = forwardedHeader("x-forwarded-host") || request.headers.host || "proofrunner.org";
          const protoHeader = forwardedHeader("x-forwarded-proto") || "https";
          const fullUrl = `${protoHeader}://${hostHeader}${url.pathname}`;
          const isDemo = isDemoKind(receiptId);

          if (isDemo) {
            const kind = getDemoKind(receiptId, url.pathname);
            const { title, description } = getDemoReceiptOpenGraphMetadata(kind);

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

      if (request.method === "POST" && url.pathname === "/api/comparisons") {
        const body = parse(ComparisonRequestSchema, await readJson(request));
        if (!body) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Request does not match the comparison contract.",
          );
        }
        return send(response, 200, comparison.compare(body));
      }

      if (
        request.method === "POST" &&
        url.pathname === "/api/reproducibility"
      ) {
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

        const body = parse(
          ReproducibilityRequestSchema,
          await readJson(request),
        );
        if (!body) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Request does not match the reproducibility contract.",
          );
        }

        const created = startReproducibility(idempotencyKey, body);
        if (created.kind === "conflict") {
          return publicError(
            response,
            409,
            "IDEMPOTENCY_KEY_CONFLICT",
            "Idempotency-Key was used with a different request.",
          );
        }
        if (created.kind === "full") return queueFull(response);

        const current =
          reproducibility.get(created.reproducibility.id) ??
          created.reproducibility;
        return send(response, created.kind === "created" ? 202 : 200, {
          contractVersion: CONTRACT_VERSION,
          reproducibility: current,
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

      if (request.method === "GET" && reproducibilityMatch) {
        const reproducibilityId = decodePathSegment(
          reproducibilityMatch[1] ?? "",
        );
        if (reproducibilityId === null) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Reproducibility ID is invalid.",
          );
        }
        const result = reproducibility.get(reproducibilityId);
        if (!result) {
          return publicError(
            response,
            404,
            "RUN_NOT_FOUND",
            "Reproducibility request was not found.",
          );
        }
        return send(response, 200, result);
      }

      if (request.method === "GET" && comparisonMatch) {
        const baseline = decodePathSegment(comparisonMatch[1] ?? "");
        const candidate = decodePathSegment(comparisonMatch[2] ?? "");
        if (baseline === null || candidate === null) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Comparison selector is invalid.",
          );
        }
        return send(response, 200, comparison.comparePath(baseline, candidate));
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

      if (request.method === "GET" && receiptBundleMatch) {
        const receiptId = decodePathSegment(receiptBundleMatch[1] ?? "");
        if (receiptId === null) {
          return publicError(
            response,
            400,
            "INVALID_REQUEST",
            "Receipt ID is invalid.",
          );
        }
        if (!dependencies.evidenceBundles) {
          return publicError(
            response,
            503,
            "NOT_READY",
            "Evidence bundles are not configured.",
            true,
          );
        }
        return sendArchive(
          response,
          `proofrunner-evidence-${receiptId}.zip`,
          dependencies.evidenceBundles.create(receiptId),
        );
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

      if (
        request.method === "POST" &&
        url.pathname === "/api/evidence-bundles/verify"
      ) {
        if (!dependencies.evidenceBundles) {
          return publicError(
            response,
            503,
            "NOT_READY",
            "Evidence bundle verification is not configured.",
            true,
          );
        }
        return send(
          response,
          200,
          dependencies.evidenceBundles.verify(
            await readBuffer(request, MAX_EVIDENCE_BUNDLE_BYTES),
          ),
        );
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
        const limitMessage =
          url.pathname === "/api/evidence-bundles/verify"
            ? "Request body exceeds the 4 MiB limit."
            : "Request body exceeds the 1 MiB limit.";
        return internalRoute
          ? internalError(
              response,
              413,
              "INVALID_REQUEST",
              limitMessage,
            )
          : publicError(
              response,
              413,
              "REQUEST_BODY_TOO_LARGE",
              limitMessage,
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
      if (error instanceof ComparisonInvalidSelectorError) {
        return publicError(
          response,
          400,
          "INVALID_REQUEST",
          "Comparison selectors must be run IDs or receipt hashes.",
        );
      }
      if (error instanceof ComparisonEvidenceNotFoundError) {
        return publicError(
          response,
          404,
          "COMPARISON_EVIDENCE_NOT_FOUND",
          "The selected verified evidence was not found.",
        );
      }
      if (error instanceof ComparisonCompatibilityError) {
        return publicError(
          response,
          422,
          "INCOMPATIBLE_EVIDENCE",
          "The selected receipts are not compatible for comparison.",
          false,
          { reasonCodes: error.reasonCodes },
        );
      }
      if (error instanceof EvidenceBundleNotFoundError) {
        return publicError(
          response,
          404,
          "RECEIPT_NOT_FOUND",
          "Receipt was not found.",
        );
      }
      if (error instanceof EvidenceBundleLimitError) {
        return publicError(
          response,
          413,
          "REQUEST_BODY_TOO_LARGE",
          "Evidence bundle exceeds the 4 MiB limit.",
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
