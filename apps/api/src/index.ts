import { ReceiptService, ReceiptStore } from "@ever-guild/proof-runner-receipt";
import { isInternalServiceUrl } from "@ever-guild/proof-runner-schema";
import { InspectionService } from "./inspection.js";
import { HttpRunnerClient, Orchestrator } from "./orchestration.js";
import { loadReceiptApiConfig } from "./receipts.js";
import { createApiServer } from "./server.js";
import { RunStore } from "./store.js";

export { PUBLIC_API_ROUTES } from "@ever-guild/proof-runner-schema";
export { createReceiptApi, issueReceipt, loadReceiptApiConfig } from "./receipts.js";
export { InspectionService } from "./inspection.js";
export { HttpRunnerClient, Orchestrator } from "./orchestration.js";
export { createApiServer } from "./server.js";
export { RunStore } from "./store.js";

export const createProductionApi = (env: NodeJS.ProcessEnv = process.env) => {
  const bearerToken = env.PROOF_RUNNER_BEARER_TOKEN;
  if (!bearerToken || bearerToken.length < 32) {
    throw new Error("PROOF_RUNNER_BEARER_TOKEN must contain at least 32 characters");
  }

  const runnerUrl = env.PROOF_RUNNER_RUNNER_URL;
  if (!runnerUrl || !isInternalServiceUrl(runnerUrl)) {
    throw new Error("PROOF_RUNNER_RUNNER_URL must be an internal HTTP(S) URL");
  }

  const receiptConfig = loadReceiptApiConfig(env);
  const store = new RunStore(receiptConfig.databasePath);
  const receiptStore = new ReceiptStore(receiptConfig.databasePath);
  const receipts = new ReceiptService(
    {
      keyId: receiptConfig.keyId,
      privateKeyPem: receiptConfig.privateKeyPem,
    },
    receiptStore,
    receiptConfig.verificationKeys,
  );
  const orchestrator = new Orchestrator(
    store,
    new HttpRunnerClient(runnerUrl, bearerToken),
    receipts.signer,
  );
  const server = createApiServer({
    store,
    inspection: new InspectionService(),
    orchestrator,
    bearerToken,
    receipts,
  });

  return {
    server,
    store,
    orchestrator,
    close: () => {
      orchestrator.stop();
      store.close();
      receiptStore.close();
    },
  };
};

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const api = createProductionApi();
  api.orchestrator.start();
  api.server.listen(
    Number(process.env.PROOF_RUNNER_API_PORT ?? 8787),
    process.env.PROOF_RUNNER_API_HOST ?? "127.0.0.1",
  );
}
