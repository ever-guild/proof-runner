import { describe, expect, it } from "vitest";
import type { RunnerConfig } from "../src/config.js";
import { RunnerError } from "../src/errors.js";
import type { CommandResult } from "../src/process.js";
import { DockerSandbox } from "../src/sandbox.js";

const config = {
  host: "127.0.0.1",
  port: 8788,
  bearerToken: "a".repeat(32),
  leaseExtensionMs: 30_000,
  runtimeImage: "proof-runner-runtime:node20",
  proxyImage: "proxy@example",
  workspaceRoot: "/tmp/proof-runner",
  limits: {
    repositoryBytes: 1024,
    fileCount: 100,
    diskBytes: 2048,
    cpuCount: 1,
    memoryBytes: 1024,
    pids: 16,
    executionMs: 180_000,
    commandOutputBytes: 1024,
  },
} satisfies RunnerConfig;

interface CleanupProbe {
  docker(
    args: string[],
    deadline: number,
    ignoreFailure?: boolean,
  ): Promise<CommandResult>;
  stopContainer(name: string): Promise<void>;
  removeNetwork(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
}

describe("fail-closed cleanup", () => {
  it("propagates Docker control-plane failures instead of assuming absence", async () => {
    const probe = new DockerSandbox(config) as unknown as CleanupProbe;
    probe.docker = () =>
      Promise.reject(
        new RunnerError(
          "RUNNER_FAILURE",
          "Docker daemon unavailable",
          true,
        ),
      );

    await expect(probe.stopContainer("job")).rejects.toMatchObject({
      code: "RUNNER_FAILURE",
    });
    await expect(probe.removeNetwork("network")).rejects.toMatchObject({
      code: "RUNNER_FAILURE",
    });
    await expect(probe.removeVolume("volume")).rejects.toMatchObject({
      code: "RUNNER_FAILURE",
    });
  });

  it("accepts only an explicit resource-not-found response", async () => {
    const probe = new DockerSandbox(config) as unknown as CleanupProbe;
    probe.docker = (args) =>
      Promise.resolve({
        exitCode: args.includes("inspect") ? 1 : 0,
        output: args.includes("container")
          ? "Error: No such container: job"
          : args.includes("network")
            ? "Error: network network not found"
            : "Error: get volume: no such volume",
        durationMs: 1,
      });

    await expect(probe.stopContainer("job")).resolves.toBeUndefined();
    await expect(probe.removeNetwork("network")).resolves.toBeUndefined();
    await expect(probe.removeVolume("volume")).resolves.toBeUndefined();
  });
});
