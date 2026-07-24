import { ReceiptService, ReceiptStore } from "@ever-guild/proof-runner-receipt";
import { loadReceiptApiConfig } from "./receipts.js";
import { InspectionService } from "./inspection.js";
import { HttpRunnerClient, Orchestrator } from "./orchestration.js";
import { createApiServer } from "./server.js";
import { RunStore } from "./store.js";

export { PUBLIC_API_ROUTES } from "@ever-guild/proof-runner-schema";
export { createReceiptApi, issueReceipt, loadReceiptApiConfig } from "./receipts.js";
export { InspectionService } from "./inspection.js";
export { HttpRunnerClient, Orchestrator } from "./orchestration.js";
export { createApiServer } from "./server.js";
export { RunStore } from "./store.js";

const isInternalServiceUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return url.hostname === "127.0.0.1" || url.hostname === "localhost" || !url.hostname.includes(".");
  } catch {
    return false;
  }
};

export const createProductionApi = (env: NodeJS.ProcessEnv = process.env) => {
  const receiptConfig = loadReceiptApiConfig(env);
  const token = env.PROOF_RUNNER_BEARER_TOKEN;
  const runnerUrl = env.PROOF_RUNNER_RUNNER_URL;
  if (!token || token.length < 32) throw new Error("PROOF_RUNNER_BEARER_TOKEN must contain at least 32 characters");
  if (!runnerUrl || !isInternalServiceUrl(runnerUrl)) throw new Error("PROOF_RUNNER_RUNNER_URL must be an internal HTTP(S) URL");
  const store = new RunStore(receiptConfig.databasePath);
  const receipts = new ReceiptService({ keyId: receiptConfig.keyId, privateKeyPem: receiptConfig.privateKeyPem }, new ReceiptStore(receiptConfig.databasePath), receiptConfig.verificationKeys);
  const orchestrator = new Orchestrator(store, new HttpRunnerClient(runnerUrl, token), receipts.signer);
  const server = createApiServer({ store, inspection: new InspectionService(), orchestrator, bearerToken: token, receiptReader: receipts });
  return { server, store, orchestrator, close: () => { orchestrator.stop(); store.close(); } };
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const api = createProductionApi();
  api.orchestrator.start();
  api.server.listen(process.env.PORT ? Number(process.env.PORT) : 8787, process.env.HOST ?? "127.0.0.1");
}
