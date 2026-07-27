import { access, chmod, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  CONTRACT_VERSION,
  type VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerConfig } from "../src/config.js";
import { runCommand } from "../src/process.js";
import {
  DockerSandbox,
  type SandboxHooks,
} from "../src/sandbox.js";
import { loadSkill } from "../src/skill.js";
import type { CommandResult } from "../src/process.js";

const enabled = process.env.PROOF_RUNNER_DOCKER_TESTS === "1";
const suite = enabled ? describe : describe.skip;
const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));
const image = process.env.PROOF_RUNNER_RUNTIME_IMAGE ?? "proof-runner-node:1";
let temporaryRoot = "";

class FixtureSandbox extends DockerSandbox {
  constructor(
    config: RunnerConfig,
    private readonly fixturePath: string,
  ) {
    super(config);
  }

  protected override materializeRepository(
    suffix: string,
    _internalNetwork: string,
    workspaceVolume: string,
    _request: VerifyRequest,
    deadline: number,
    hooks: SandboxHooks,
    _proxyContainer: string,
  ): Promise<CommandResult> {
    void _proxyContainer;
    return runCommand(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        `pr-fixture-${suffix}`,
        "--network",
        "none",
        "--user",
        "10001:10001",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--mount",
        `type=bind,src=${this.fixturePath},dst=/fixture,readonly`,
        "--mount",
        `type=volume,src=${workspaceVolume},dst=/workspace`,
        this.config.runtimeImage,
        "sh",
        "-euc",
        "mkdir /workspace/repo && cp -R /fixture/. /workspace/repo/",
      ],
      {
        timeoutMs: Math.max(1, deadline - Date.now()),
        outputLimitBytes: this.config.limits.commandOutputBytes,
        onTick: async () => hooks.assertActive?.(),
        tickMs: 100,
        ...(hooks.signal ? { signal: hooks.signal } : {}),
      },
    );
  }
}

const docker = async (
  fixture: string,
  command: string[],
  name?: string,
  timeoutMs = 10_000,
) =>
  runCommand(
    "docker",
    [
      "run",
      "--rm",
      ...(name ? ["--name", name] : []),
      "--network",
      "none",
      "--user",
      "10001:10001",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--pids-limit=32",
      "--memory=128m",
      "--cpus=1",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=16m",
      "--mount",
      `type=bind,src=${fixture},dst=/fixture`,
      "--workdir",
      "/fixture",
      image,
      ...command,
    ],
    { timeoutMs, outputLimitBytes: 128 * 1024 },
  );

suite("real non-root/no-network fixture execution", () => {
  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "proof-runner-docker-test-"));
    await chmod(temporaryRoot, 0o777);
  });

  afterEach(async () => {
    if (!temporaryRoot) return;
    await runCommand(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "10001:10001",
        "--mount",
        `type=bind,src=${temporaryRoot},dst=/fixtures`,
        image,
        "sh",
        "-c",
        "rm -rf /fixtures/*/node_modules /fixtures/*/built.txt " +
          "/fixtures/*/postinstall-executed /fixtures/*/postinstall-network-succeeded",
      ],
      { timeoutMs: 10_000, outputLimitBytes: 16 * 1024 },
    ).catch(() => undefined);
    await rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = "";
  });

  const materialize = async (name: string): Promise<string> => {
    const target = join(temporaryRoot, name);
    await cp(join(fixtures, name), target, { recursive: true });
    await chmod(target, 0o777);
    return target;
  };

  it("passes the build/test fixture and fails the deterministic failing fixture", async () => {
    const passing = await materialize("passing");
    expect(
      (await docker(passing, ["npm", "ci", "--ignore-scripts"])).exitCode,
    ).toBe(0);
    expect((await docker(passing, ["npm", "run", "build"])).exitCode).toBe(0);
    expect((await docker(passing, ["npm", "test"])).exitCode).toBe(0);

    const failing = await materialize("failing");
    expect(
      (await docker(failing, ["npm", "ci", "--ignore-scripts"])).exitCode,
    ).toBe(0);
    expect((await docker(failing, ["npm", "test"])).exitCode).toBe(7);

    const pnpm = await materialize("pnpm-passing");
    expect(
      (
        await docker(pnpm, [
          "pnpm",
          "install",
          "--frozen-lockfile",
          "--ignore-scripts",
        ])
      ).exitCode,
    ).toBe(0);
    expect(
      (await docker(pnpm, ["pnpm", "run", "--if-present", "build"])).exitCode,
    ).toBe(0);
    expect(
      (await docker(pnpm, ["pnpm", "run", "--if-present", "test"])).exitCode,
    ).toBe(0);
  }, 15_000);

  it("kills timeout execution and removes its container", async () => {
    const timeout = await materialize("timeout");
    const name = `proof-runner-timeout-test-${process.pid}`;
    await expect(
      docker(timeout, ["npm", "test"], name, 250),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
    await runCommand("docker", ["rm", "-f", name], {
      timeoutMs: 5_000,
      outputLimitBytes: 16 * 1024,
    });
    const remaining = await runCommand(
      "docker",
      ["ps", "-a", "--filter", `name=${name}`, "--format", "{{.Names}}"],
      { timeoutMs: 5_000, outputLimitBytes: 16 * 1024 },
    );
    expect(remaining.output.trim()).toBe("");
  });

  it("does not run lifecycle code or permit its network attempt", async () => {
    const lifecycle = await materialize("lifecycle");
    expect(
      (await docker(lifecycle, ["npm", "ci", "--ignore-scripts"])).exitCode,
    ).toBe(0);
    await expect(access(join(lifecycle, "postinstall-executed"))).rejects.toThrow();
    await expect(
      access(join(lifecycle, "postinstall-network-succeeded")),
    ).rejects.toThrow();
  });

  it("returns TIMEOUT and CANCELLED inconclusive reports with no leaked resources", async () => {
    const baseConfig: RunnerConfig = {
      host: "127.0.0.1",
      port: 8788,
      bearerToken: "a".repeat(32),
      leaseExtensionMs: 30_000,
      runtimeImage: image,
      proxyImage:
        "ubuntu/squid@sha256:3de2e64f0ca6efdac3e98557607dc0f23050037f3885016d5d5bfcf9950501b8",
      workspaceRoot: temporaryRoot,
      limits: {
        repositoryBytes: 100 * 1024 * 1024,
        fileCount: 20_000,
        diskBytes: 512 * 1024 * 1024,
        cpuCount: 1,
        memoryBytes: 512 * 1024 * 1024,
        pids: 128,
        executionMs: 1_000,
        commandOutputBytes: 1024 * 1024,
      },
    };
    const skill = await loadSkill();
    const request = {
      contractVersion: CONTRACT_VERSION,
      repositoryUrl: "https://github.com/Jonny-exe/multi-copy-paste-clipboard",
      resolvedCommitSha: "c4171f24660f727b1e1d6644b97fdc51e1ae1ee7",
      resolvedRef: {
        type: "commit" as const,
        value: "c4171f24660f727b1e1d6644b97fdc51e1ae1ee7",
      },
      skill: {
        name: "node-typescript" as const,
        version: "1" as const,
        hash: skill.hash,
      },
      public: false,
    };

    const diskRunId = randomUUID();
    const timeoutRunId = randomUUID();
    const cancellationRunId = randomUUID();
    const diskLimited = await new DockerSandbox({
      ...baseConfig,
      limits: {
        ...baseConfig.limits,
        diskBytes: 1_024,
        executionMs: 180_000,
      },
    }).execute(diskRunId, request);
    expect(diskLimited).toMatchObject({
      report: {
        verdict: "INCONCLUSIVE",
        reasonCode: "DISK_LIMIT_EXCEEDED",
      },
    });

    const timeout = await new DockerSandbox(baseConfig).execute(
      timeoutRunId,
      request,
    );
    expect(timeout).toMatchObject({
      status: "TIMEOUT",
      report: { verdict: "INCONCLUSIVE", reasonCode: "TIMEOUT" },
    });

    const controller = new AbortController();
    const cancellation = new DockerSandbox({
      ...baseConfig,
      limits: { ...baseConfig.limits, executionMs: 180_000 },
    }).execute(cancellationRunId, request, { signal: controller.signal });
    const cancelTimer = setTimeout(() => controller.abort(), 1_500);
    const cancelled = await cancellation;
    clearTimeout(cancelTimer);
    expect(cancelled).toMatchObject({
      report: { verdict: "INCONCLUSIVE", reasonCode: "CANCELLED" },
    });

    const containers = await runCommand(
      "docker",
      ["ps", "-a", "--format", "{{.Names}}"],
      { timeoutMs: 5_000, outputLimitBytes: 64 * 1024 },
    );
    const networks = await runCommand(
      "docker",
      ["network", "ls", "--format", "{{.Name}}"],
      { timeoutMs: 5_000, outputLimitBytes: 64 * 1024 },
    );
    const runPrefixes = [diskRunId, timeoutRunId, cancellationRunId].map(
      (runId) => runId.replaceAll("-", "").slice(0, 20),
    );
    expect(
      containers.output
        .split("\n")
        .filter((name) => runPrefixes.some((prefix) => name.includes(prefix))),
    ).toEqual([]);
    expect(
      networks.output
        .split("\n")
        .filter((name) => runPrefixes.some((prefix) => name.includes(prefix))),
    ).toEqual([]);
  }, 30_000);

  it("normalizes every required fixture end-to-end through DockerSandbox.execute", async () => {
    const baseConfig: RunnerConfig = {
      host: "127.0.0.1",
      port: 8788,
      bearerToken: "a".repeat(32),
      leaseExtensionMs: 30_000,
      runtimeImage: image,
      proxyImage:
        "ubuntu/squid@sha256:3de2e64f0ca6efdac3e98557607dc0f23050037f3885016d5d5bfcf9950501b8",
      workspaceRoot: temporaryRoot,
      limits: {
        repositoryBytes: 100 * 1024 * 1024,
        fileCount: 20_000,
        diskBytes: 512 * 1024 * 1024,
        cpuCount: 1,
        memoryBytes: 512 * 1024 * 1024,
        pids: 128,
        executionMs: 30_000,
        commandOutputBytes: 1024 * 1024,
      },
    };
    const skill = await loadSkill();
    const request: VerifyRequest = {
      contractVersion: CONTRACT_VERSION,
      repositoryUrl: "https://github.com/ever-guild/proof-runner-fixture",
      resolvedCommitSha: "1".repeat(40),
      resolvedRef: { type: "commit", value: "1".repeat(40) },
      skill: {
        name: "node-typescript",
        version: "1",
        hash: skill.hash,
      },
      public: false,
    };
    const runIds: string[] = [];
    const execute = async (
      fixture: string,
      limits: Partial<RunnerConfig["limits"]> = {},
    ) => {
      const runId = randomUUID();
      runIds.push(runId);
      return new FixtureSandbox(
        {
          ...baseConfig,
          limits: { ...baseConfig.limits, ...limits },
        },
        join(fixtures, fixture),
      ).execute(runId, request);
    };

    const passing = await execute("passing");
    expect(passing).toMatchObject({
      status: "COMPLETED",
      report: { verdict: "PASS", reasonCode: null },
    });
    expect(passing.report?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "build", outcome: "PASSED" }),
        expect.objectContaining({ id: "test", outcome: "PASSED" }),
      ]),
    );
    expect(passing.report?.platformControls).toEqual([
      {
        control: "COMMAND_ALLOWLIST",
        status: "ENFORCED",
        checkId: null,
      },
      {
        control: "BUILD_NETWORK_DISABLED",
        status: "ENFORCED",
        checkId: "build",
      },
      {
        control: "TEST_NETWORK_DISABLED",
        status: "ENFORCED",
        checkId: "test",
      },
    ]);

    const failing = await execute("failing");
    expect(failing).toMatchObject({
      status: "COMPLETED",
      report: { verdict: "FAIL", reasonCode: null },
    });
    expect(failing.report?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "test", outcome: "FAILED", exitCode: 7 }),
      ]),
    );

    await expect(execute("invalid")).resolves.toMatchObject({
      report: { verdict: "INCONCLUSIVE", reasonCode: "LOCKFILE_MISSING" },
    });
    await expect(
      execute("oversized", { repositoryBytes: 32 }),
    ).resolves.toMatchObject({
      report: {
        verdict: "INCONCLUSIVE",
        reasonCode: "REPOSITORY_LIMIT_EXCEEDED",
      },
    });
    await expect(execute("lifecycle")).resolves.toMatchObject({
      report: {
        verdict: "INCONCLUSIVE",
        reasonCode: "LIFECYCLE_SCRIPTS_REQUIRED",
      },
    });
    await expect(execute("git-lfs")).resolves.toMatchObject({
      report: { verdict: "INCONCLUSIVE", reasonCode: "GIT_LFS_UNSUPPORTED" },
    });
    await expect(execute("submodule")).resolves.toMatchObject({
      report: {
        verdict: "INCONCLUSIVE",
        reasonCode: "SUBMODULES_UNSUPPORTED",
      },
    });
    await expect(execute("damaged-lockfile")).resolves.toMatchObject({
      report: { verdict: "INCONCLUSIVE", reasonCode: "DAMAGED_LOCKFILE" },
    });
    await expect(execute("registry-failure")).resolves.toMatchObject({
      report: { verdict: "INCONCLUSIVE", reasonCode: "REGISTRY_FAILURE" },
    });
    await expect(execute("pnpm-passing")).resolves.toMatchObject({
      report: { verdict: "PASS", reasonCode: null },
    });
    await expect(
      execute("timeout", { executionMs: 5_000 }),
    ).resolves.toMatchObject({
      status: "TIMEOUT",
      report: { verdict: "INCONCLUSIVE", reasonCode: "TIMEOUT" },
    });

    const prefixes = runIds.map((runId) =>
      runId.replaceAll("-", "").slice(0, 20),
    );
    const resources = await Promise.all([
      runCommand("docker", ["ps", "-a", "--format", "{{.Names}}"], {
        timeoutMs: 5_000,
        outputLimitBytes: 64 * 1024,
      }),
      runCommand("docker", ["network", "ls", "--format", "{{.Name}}"], {
        timeoutMs: 5_000,
        outputLimitBytes: 64 * 1024,
      }),
      runCommand("docker", ["volume", "ls", "--format", "{{.Name}}"], {
        timeoutMs: 5_000,
        outputLimitBytes: 64 * 1024,
      }),
    ]);
    expect(
      resources.flatMap((resource) =>
        resource.output
          .split("\n")
          .filter((name) => prefixes.some((prefix) => name.includes(prefix))),
      ),
    ).toEqual([]);
  }, 120_000);
});
