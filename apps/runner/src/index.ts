export { loadRunnerConfig } from "./config.js";
export { RunnerError } from "./errors.js";
export {
  assertCanonicalGithubUrl,
  resolveRepositoryRef,
} from "./repository.js";
export { DockerSandbox } from "./sandbox.js";
export { RunnerService } from "./service.js";
export { createRunnerServer } from "./server.js";
export { HttpApiCallbackClient } from "./api-client.js";

import { createRunnerServer } from "./server.js";

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  const server = createRunnerServer();
  server.listen(server.config.port, server.config.host, () => {
    process.stdout.write(
      `proof-runner listening on ${server.config.host}:${server.config.port}\n`,
    );
  });
}
