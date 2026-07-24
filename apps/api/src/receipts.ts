import { createServer, type ServerResponse } from "node:http";
import { CONTRACT_VERSION, type SignedReceipt } from "@ever-guild/proof-runner-schema";
import {
  ReceiptService,
  ReceiptStore,
  validateReceiptKeyConfig,
  type ReceiptVerifierKey,
} from "@ever-guild/proof-runner-receipt";
import {
  InvalidJsonBodyError,
  readJson,
  RequestBodyTooLargeError,
} from "./request-body.js";

export interface ReceiptApiConfig {
  databasePath: string;
  keyId: string;
  privateKeyPem: string;
  verificationKeys: ReceiptVerifierKey[];
}

export const loadReceiptApiConfig = (
  env: NodeJS.ProcessEnv = process.env,
): ReceiptApiConfig => {
  const databasePath = env.DATABASE_PATH;
  const keyId = env.PROOF_RUNNER_RECEIPT_KEY_ID;
  const privateKeyPem = env.PROOF_RUNNER_RECEIPT_PRIVATE_KEY;
  if (!databasePath) throw new Error("DATABASE_PATH is required for receipt persistence");
  if (!keyId) throw new Error("PROOF_RUNNER_RECEIPT_KEY_ID is required");
  if (!privateKeyPem) {
    throw new Error(
      "PROOF_RUNNER_RECEIPT_PRIVATE_KEY is required; API startup fails closed without a receipt signing key",
    );
  }
  let verificationKeys: ReceiptVerifierKey[] = [];
  if (env.PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS) {
    try {
      const parsed: unknown = JSON.parse(env.PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS);
      if (!Array.isArray(parsed) || parsed.some((key) =>
        typeof key !== "object" || key === null ||
        typeof key.keyId !== "string" || typeof key.publicKeyPem !== "string",
      )) {
        throw new Error("invalid key list");
      }
      verificationKeys = parsed as ReceiptVerifierKey[];
    } catch {
      throw new Error("PROOF_RUNNER_RECEIPT_VERIFICATION_KEYS must be a JSON array of keyId/publicKeyPem entries");
    }
  }
  validateReceiptKeyConfig({ keyId, privateKeyPem }, verificationKeys);
  return { databasePath, keyId, privateKeyPem, verificationKeys };
};

const send = (response: ServerResponse, status: number, payload: unknown): void => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

const error = (response: ServerResponse, status: number, code: string, message: string): void => {
  send(response, status, {
    contractVersion: CONTRACT_VERSION,
    error: { code, message, retryable: false },
  });
};

export const createReceiptApi = (config: ReceiptApiConfig) => {
  const store = new ReceiptStore(config.databasePath);
  const service = new ReceiptService(
    { keyId: config.keyId, privateKeyPem: config.privateKeyPem },
    store,
    config.verificationKeys,
  );
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const receiptMatch = url.pathname.match(/^\/api\/receipts\/([^/]+)$/);
    const keyMatch = url.pathname.match(/^\/api\/receipt-keys\/([^/]+)$/);
    try {
      if (request.method === "GET" && receiptMatch) {
        const stored = service.get(decodeURIComponent(receiptMatch[1] ?? ""));
        if (!stored) return error(response, 404, "RECEIPT_NOT_FOUND", "Receipt was not found");
        return send(response, 200, stored.receipt);
      }
      if (request.method === "GET" && keyMatch) {
        const publicKey = service.publicKey(decodeURIComponent(keyMatch[1] ?? ""));
        if (!publicKey) return error(response, 404, "RECEIPT_NOT_FOUND", "Receipt key was not found");
        return send(response, 200, publicKey);
      }
      if (request.method === "POST" && url.pathname === "/api/receipts/verify") {
        const result = service.verify(await readJson(request));
        return send(response, 200, result);
      }
      return error(response, 404, "INVALID_REQUEST", "Route was not found");
    } catch (caught) {
      if (caught instanceof RequestBodyTooLargeError) {
        return error(response, 413, "REQUEST_BODY_TOO_LARGE", "Request body exceeds the 1 MiB limit.");
      }
      if (!(caught instanceof InvalidJsonBodyError)) {
        return error(response, 500, "INTERNAL_ERROR", "The service could not process this request.");
      }
      return error(response, 400, "INVALID_REQUEST", "Request body must be valid JSON");
    }
  });
  return { server, service, close: () => store.close() };
};

export const issueReceipt = (
  api: ReturnType<typeof createReceiptApi>,
  report: SignedReceipt["payload"]["report"],
  options: { isPublic?: boolean } = {},
): SignedReceipt => api.service.issue(report, options);
