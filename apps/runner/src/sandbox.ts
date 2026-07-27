import { randomUUID } from "node:crypto";
import {
  lstat,
  readFile,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  NormalizedCheck,
  PlatformControlEvidence,
  VerificationReport,
  VerifyRequest,
} from "@ever-guild/proof-runner-schema";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import type { RunnerConfig } from "./config.js";
import {
  asRunnerError,
  RunnerError,
  type RunnerErrorCode,
} from "./errors.js";
import { runCommand, type CommandResult } from "./process.js";
import { assertCanonicalGithubUrl } from "./repository.js";
import { assertSkillHash, loadSkill } from "./skill.js";

export interface SandboxExecution {
  status: "COMPLETED" | "TIMEOUT" | "SYSTEM_ERROR";
  report: VerificationReport | null;
  systemError: {
    code: string;
    message: string;
    retryable: boolean;
  } | null;
}

export interface SandboxHooks {
  signal?: AbortSignal;
  assertActive?: () => void;
  onStage?: (stage: NormalizedCheck["stage"]) => void;
}

export interface ProjectInspection {
  packageManager: "npm" | "pnpm";
  hasBuild: boolean;
  hasTest: boolean;
}

const check = (
  id: string,
  stage: NormalizedCheck["stage"],
  title: string,
): NormalizedCheck => ({
  id,
  stage,
  title,
  outcome: "PENDING",
  startedAt: null,
  completedAt: null,
  durationMs: null,
  exitCode: null,
  summary: "",
});

const summarize = (output: string): string =>
  output.replaceAll("\u001b", "").slice(-2_000);

const startCheck = (item: NormalizedCheck): void => {
  item.outcome = "RUNNING";
  item.startedAt = new Date().toISOString();
};

const finishCheck = (
  item: NormalizedCheck,
  outcome: NormalizedCheck["outcome"],
  result: CommandResult | null,
  summary: string,
): void => {
  item.outcome = outcome;
  item.completedAt = new Date().toISOString();
  item.durationMs =
    result?.durationMs ??
    (item.startedAt ? Date.now() - new Date(item.startedAt).getTime() : 0);
  item.exitCode = result?.exitCode ?? null;
  item.summary = summarize(summary);
};

const safeName = (value: string): string =>
  value.toLowerCase().replaceAll(/[^a-z0-9]/g, "").slice(0, 20);

const confirmsResourceAbsent = (
  result: CommandResult,
  kind: "container" | "network" | "volume",
  name: string,
): boolean =>
  result.exitCode !== 0 && (() => {
    const output = result.output.toLowerCase();
    const resource = name.toLowerCase();
    if (kind === "container") {
      return output.includes(`no such container: ${resource}`);
    }
    if (kind === "network") {
      return output.includes(`network ${resource} not found`);
    }
    return output.includes(`get ${resource}: no such volume`);
  })();

export class DockerSandbox {
  constructor(readonly config: RunnerConfig) {}

  async execute(
    runId: string,
    request: VerifyRequest,
    hooks: SandboxHooks = {},
  ): Promise<SandboxExecution> {
    const startedAt = Date.now();
    const deadline = startedAt + this.config.limits.executionMs;
    const checks = [
      check("repository", "REPOSITORY", "Clone and inspect repository"),
      check("sandbox", "SANDBOX", "Prepare isolated execution"),
      check("install", "INSTALL", "Install locked dependencies"),
      check("build", "BUILD", "Run build"),
      check("test", "TEST", "Run tests"),
    ];
    const repositoryCheck = checks[0]!;
    const sandboxCheck = checks[1]!;
    const installCheck = checks[2]!;
    const buildCheck = checks[3]!;
    const testCheck = checks[4]!;
    const suffix = `${safeName(runId)}${randomUUID().slice(0, 8)}`;
    const internalNetwork = `pr-internal-${suffix}`;
    const egressNetwork = `pr-egress-${suffix}`;
    const proxyContainer = `pr-proxy-${suffix}`;
    const workspaceKeeper = `pr-keeper-${suffix}`;
    const workspaceVolume = `pr-workspace-${suffix}`;
    let runtimeDigest = `sha256:${"0".repeat(64)}`;
    let reasonCode: string | null = null;
    let terminalStatus: SandboxExecution["status"] = "COMPLETED";
    let verdict: VerificationReport["verdict"] = "INCONCLUSIVE";
    const platformControls: PlatformControlEvidence[] = [];

    try {
      assertCanonicalGithubUrl(request.repositoryUrl);
      const skill = await loadSkill();
      assertSkillHash(skill.hash, request.skill.hash);
      platformControls.push({
        control: "COMMAND_ALLOWLIST",
        status: "ENFORCED",
        checkId: null,
      });

      startCheck(sandboxCheck);
      hooks.onStage?.("SANDBOX");
      runtimeDigest = await this.runtimeDigest();
      await this.createWorkspaceVolume(workspaceVolume, deadline);
      await this.startWorkspaceKeeper(
        workspaceKeeper,
        workspaceVolume,
        deadline,
      );
      await this.docker(["network", "create", "--internal", internalNetwork], deadline);
      await this.docker(["network", "create", egressNetwork], deadline);
      await this.startProxy(proxyContainer, egressNetwork, internalNetwork, deadline);
      finishCheck(
        sandboxCheck,
        "PASSED",
        null,
        "Disposable networks and allowlisted egress proxy are ready",
      );

      startCheck(repositoryCheck);
      hooks.onStage?.("REPOSITORY");
      const clone = await this.materializeRepository(
        suffix,
        internalNetwork,
        workspaceVolume,
        request,
        deadline,
        hooks,
        proxyContainer,
      );
      if (clone.exitCode !== 0) {
        throw new RunnerError(
          "RUNNER_FAILURE",
          `Repository clone failed: ${summarize(clone.output)}`,
          true,
        );
      }
      const project = await this.inspectWorkspace(
        workspaceVolume,
        skill.definition.lifecycleScripts,
        deadline,
      );
      finishCheck(repositoryCheck, "PASSED", clone, "Pinned commit cloned and inspected");

      startCheck(installCheck);
      hooks.onStage?.("INSTALL");
      const installCommand = skill.definition.packageManagers[project.packageManager].install;
      const install = await this.runContainer(
        suffix,
        internalNetwork,
        workspaceVolume,
        installCommand,
        deadline,
        hooks,
        {
          HTTP_PROXY: `http://${proxyContainer}:3128`,
          HTTPS_PROXY: `http://${proxyContainer}:3128`,
          NO_PROXY: "localhost,127.0.0.1",
          npm_config_proxy: `http://${proxyContainer}:3128`,
          npm_config_https_proxy: `http://${proxyContainer}:3128`,
        },
        "/workspace/repo",
      );
      if (install.exitCode !== 0) {
        const damaged = /lockfile|integrity|frozen|package-lock/i.test(install.output);
        throw new RunnerError(
          damaged ? "DAMAGED_LOCKFILE" : "REGISTRY_FAILURE",
          `Dependency installation failed: ${summarize(install.output)}`,
          !damaged,
        );
      }
      finishCheck(
        installCheck,
        "PASSED",
        install,
        "Locked dependencies installed with lifecycle scripts disabled",
      );

      await this.stopContainer(proxyContainer);
      await this.removeNetwork(egressNetwork);

      if (project.hasBuild) {
        startCheck(buildCheck);
        hooks.onStage?.("BUILD");
        const build = await this.runContainer(
          suffix,
          "none",
          workspaceVolume,
          skill.definition.commands[project.packageManager].build,
          deadline,
          hooks,
          {},
          "/workspace/repo",
        );
        platformControls.push({
          control: "BUILD_NETWORK_DISABLED",
          status: "ENFORCED",
          checkId: buildCheck.id,
        });
        finishCheck(
          buildCheck,
          build.exitCode === 0 ? "PASSED" : "FAILED",
          build,
          build.output || (build.exitCode === 0 ? "Build passed" : "Build failed"),
        );
        if (build.exitCode !== 0) {
          verdict = "FAIL";
          finishCheck(testCheck, "SKIPPED", null, "Test skipped because build failed");
          return this.result(
            runId,
            request,
            runtimeDigest,
            checks,
            platformControls,
            verdict,
            null,
            startedAt,
            "COMPLETED",
          );
        }
      } else {
        finishCheck(buildCheck, "SKIPPED", null, "No build script declared");
      }

      if (!project.hasBuild && !project.hasTest) {
        reasonCode = "INDETERMINATE_SKILL_RESULT";
        verdict = "INCONCLUSIVE";
        finishCheck(
          testCheck,
          "INCONCLUSIVE",
          null,
          "Project declares neither a build nor a test script",
        );
        return this.result(
          runId,
          request,
          runtimeDigest,
          checks,
          platformControls,
          verdict,
          reasonCode,
          startedAt,
          "COMPLETED",
        );
      }

      if (project.hasTest) {
        startCheck(testCheck);
        hooks.onStage?.("TEST");
        const test = await this.runContainer(
          suffix,
          "none",
          workspaceVolume,
          skill.definition.commands[project.packageManager].test,
          deadline,
          hooks,
          {},
          "/workspace/repo",
        );
        platformControls.push({
          control: "TEST_NETWORK_DISABLED",
          status: "ENFORCED",
          checkId: testCheck.id,
        });
        finishCheck(
          testCheck,
          test.exitCode === 0 ? "PASSED" : "FAILED",
          test,
          test.output || (test.exitCode === 0 ? "Tests passed" : "Tests failed"),
        );
        verdict = test.exitCode === 0 ? "PASS" : "FAIL";
      } else {
        finishCheck(testCheck, "SKIPPED", null, "No test script declared");
        verdict = "PASS";
      }
    } catch (error) {
      const runnerError = asRunnerError(error);
      reasonCode = runnerError.code;
      terminalStatus = runnerError.code === "TIMEOUT" ? "TIMEOUT" : "COMPLETED";
      verdict = "INCONCLUSIVE";
      const active = checks.find((item) => item.outcome === "RUNNING");
      if (active) finishCheck(active, "INCONCLUSIVE", null, runnerError.message);
      else {
        const pending = checks.find((item) => item.outcome === "PENDING");
        if (pending) finishCheck(pending, "INCONCLUSIVE", null, runnerError.message);
      }
      for (const item of checks) {
        if (item.outcome === "PENDING") {
          finishCheck(item, "SKIPPED", null, "Skipped after inconclusive result");
        }
      }
    } finally {
      await this.cleanup(
        workspaceVolume,
        workspaceKeeper,
        proxyContainer,
        internalNetwork,
        egressNetwork,
      );
    }

    return this.result(
      runId,
      request,
      runtimeDigest,
      checks,
      platformControls,
      verdict,
      reasonCode,
      startedAt,
      terminalStatus,
    );
  }

  private result(
    runId: string,
    request: VerifyRequest,
    runtimeImageDigest: string,
    checks: NormalizedCheck[],
    platformControls: PlatformControlEvidence[],
    verdict: VerificationReport["verdict"],
    reasonCode: string | null,
    startedAt: number,
    status: SandboxExecution["status"],
  ): SandboxExecution {
    const report: VerificationReport = {
      contractVersion: CONTRACT_VERSION,
      runId,
      repositoryUrl: request.repositoryUrl,
      resolvedCommitSha: request.resolvedCommitSha,
      resolvedRef: request.resolvedRef,
      skill: request.skill,
      runtimeImageDigest,
      verdict,
      checks,
      ...(platformControls.length > 0 ? { platformControls } : {}),
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
      reasonCode,
    };
    return { status, report, systemError: null };
  }

  private async runtimeDigest(): Promise<string> {
    const result = await this.docker(
      ["image", "inspect", "--format", "{{.Id}}", this.config.runtimeImage],
      Date.now() + 30_000,
    );
    const digest = result.output.trim();
    if (!/^sha256:[a-f0-9]{64}$/.test(digest)) {
      throw new RunnerError(
        "RUNNER_FAILURE",
        `Runtime image ${this.config.runtimeImage} is unavailable`,
        true,
      );
    }
    return digest;
  }

  private async createWorkspaceVolume(
    name: string,
    deadline: number,
  ): Promise<void> {
    await this.docker(
      [
        "volume",
        "create",
        "--driver",
        "local",
        "--opt",
        "type=tmpfs",
        "--opt",
        "device=tmpfs",
        "--opt",
        `o=size=${this.config.limits.diskBytes},uid=10001,gid=10001,mode=0700`,
        name,
      ],
      deadline,
    );
  }

  private async startWorkspaceKeeper(
    name: string,
    volume: string,
    deadline: number,
  ): Promise<void> {
    await this.docker(
      [
        "run",
        "-d",
        "--name",
        name,
        "--network",
        "none",
        "--user",
        "10001:10001",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=8",
        "--memory=32m",
        "--cpus=0.1",
        "--mount",
        `type=volume,src=${volume},dst=/workspace`,
        this.config.runtimeImage,
        "sleep",
        "infinity",
      ],
      deadline,
    );
  }

  private async inspectWorkspace(
    volume: string,
    lifecycleScripts: string[],
    deadline: number,
  ): Promise<ProjectInspection> {
    const assetMount = this.packagedAssetMount();
    const inspectorPath = "/opt/proof-runner-assets/inspect.cjs";
    const result = await this.docker(
      [
        "run",
        "--rm",
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
        "--mount",
        `type=volume,src=${volume},dst=/workspace`,
        ...assetMount.args,
        "--env",
        `REPOSITORY_BYTES=${this.config.limits.repositoryBytes}`,
        "--env",
        `FILE_COUNT=${this.config.limits.fileCount}`,
        "--env",
        `LIFECYCLE_SCRIPTS=${JSON.stringify(lifecycleScripts)}`,
        this.config.runtimeImage,
        "node",
        inspectorPath,
      ],
      deadline,
      true,
    );
    const line = result.output.trim().split("\n").at(-1);
    let inspection:
      | (ProjectInspection & { ok: true })
      | { ok: false; code: string; message: string };
    try {
      inspection = JSON.parse(line ?? "") as typeof inspection;
    } catch {
      throw new RunnerError(
        "RUNNER_FAILURE",
        "Repository inspector returned an invalid response",
        true,
      );
    }
    if (!inspection.ok) {
      throw new RunnerError(
        inspection.code as RunnerErrorCode,
        inspection.message,
      );
    }
    if (result.exitCode !== 0) {
      throw new RunnerError(
        "RUNNER_FAILURE",
        "Repository inspector failed",
        true,
      );
    }
    return inspection;
  }

  protected async materializeRepository(
    suffix: string,
    internalNetwork: string,
    workspaceVolume: string,
    request: VerifyRequest,
    deadline: number,
    hooks: SandboxHooks,
    proxyContainer: string,
  ): Promise<CommandResult> {
    return this.runContainer(
      suffix,
      internalNetwork,
      workspaceVolume,
      [
        "sh",
        "-euc",
        [
          "git -c http.followRedirects=false init /workspace/repo",
          "git -C /workspace/repo remote add origin \"$REPOSITORY_URL\"",
          "git -C /workspace/repo -c http.followRedirects=false fetch --depth=1 origin \"$COMMIT_SHA\"",
          "test \"$(git -C /workspace/repo rev-parse FETCH_HEAD)\" = \"$COMMIT_SHA\"",
          "git -C /workspace/repo checkout --detach FETCH_HEAD",
        ].join("\n"),
      ],
      deadline,
      hooks,
      {
        REPOSITORY_URL: request.repositoryUrl,
        COMMIT_SHA: request.resolvedCommitSha,
        HTTP_PROXY: `http://${proxyContainer}:3128`,
        HTTPS_PROXY: `http://${proxyContainer}:3128`,
        NO_PROXY: "localhost,127.0.0.1",
      },
    );
  }

  private async startProxy(
    name: string,
    egressNetwork: string,
    internalNetwork: string,
    deadline: number,
  ): Promise<void> {
    const assetMount = this.packagedAssetMount();
    const configPath = "/opt/proof-runner-assets/squid.conf";
    await this.docker(
      [
        "run",
        "-d",
        "--name",
        name,
        "--network",
        egressNetwork,
        "--user",
        "13:13",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=64",
        "--memory=128m",
        "--cpus=0.5",
        ...assetMount.args,
        this.config.proxyImage,
        "-NYC",
        "-f",
        configPath,
      ],
      deadline,
    );
    await this.docker(["network", "connect", internalNetwork, name], deadline);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const ready = await this.docker(
        [
          "exec",
          name,
          "sh",
          "-c",
          "grep -q 'Accepting HTTP Socket' /tmp/squid-cache.log",
        ],
        deadline,
        true,
      );
      if (ready.exitCode === 0) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new RunnerError(
      "RUNNER_FAILURE",
      "Allowlisted egress proxy did not become ready",
      true,
    );
  }

  private packagedAssetMount(): { args: string[] } {
    const configured = process.env.PROOF_RUNNER_DOCKER_ASSET_CONTAINER;
    if (configured) {
      const container = configured === "self" ? process.env.HOSTNAME : configured;
      if (!container) {
        throw new RunnerError(
          "RUNNER_FAILURE",
          "PROOF_RUNNER_DOCKER_ASSET_CONTAINER=self requires Docker to provide HOSTNAME",
          false,
        );
      }
      return { args: ["--volumes-from", `${container}:ro`] };
    }
    const assetDirectory = resolve(
      fileURLToPath(new URL("../docker", import.meta.url)),
    );
    return {
      args: [
        "--mount",
        `type=bind,src=${assetDirectory},dst=/opt/proof-runner-assets,readonly`,
      ],
    };
  }

  private async stopContainer(name: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.docker(
        ["rm", "-f", name],
        Date.now() + 10_000,
        true,
      ).catch(() => undefined);
      const remaining = await this.docker(
        ["container", "inspect", name],
        Date.now() + 5_000,
        true,
      );
      if (confirmsResourceAbsent(remaining, "container", name)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new RunnerError(
      "RUNNER_FAILURE",
      `Failed to remove disposable container ${name}`,
      true,
    );
  }

  private async removeNetwork(name: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.docker(
        ["network", "rm", name],
        Date.now() + 10_000,
        true,
      ).catch(() => undefined);
      const remaining = await this.docker(
        ["network", "inspect", name],
        Date.now() + 5_000,
        true,
      );
      if (confirmsResourceAbsent(remaining, "network", name)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new RunnerError(
      "RUNNER_FAILURE",
      `Failed to remove Docker network ${name}`,
      true,
    );
  }

  private async removeVolume(name: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.docker(
        ["volume", "rm", "-f", name],
        Date.now() + 10_000,
        true,
      ).catch(() => undefined);
      const remaining = await this.docker(
        ["volume", "inspect", name],
        Date.now() + 5_000,
        true,
      );
      if (confirmsResourceAbsent(remaining, "volume", name)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }
    throw new RunnerError(
      "RUNNER_FAILURE",
      `Failed to remove Docker volume ${name}`,
      true,
    );
  }

  private async runContainer(
    suffix: string,
    network: string,
    workspaceVolume: string,
    command: string[],
    deadline: number,
    hooks: SandboxHooks,
    environment: Record<string, string>,
    workingDirectory = "/workspace",
  ): Promise<CommandResult> {
    hooks.assertActive?.();
    const name = `pr-job-${suffix}-${randomUUID().slice(0, 6)}`;
    const args = [
      "run",
      "--rm",
      "--name",
      name,
      "--network",
      network,
      "--user",
      "10001:10001",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      `--pids-limit=${this.config.limits.pids}`,
      `--memory=${this.config.limits.memoryBytes}`,
      `--cpus=${this.config.limits.cpuCount}`,
      "--ulimit",
      `fsize=${this.config.limits.diskBytes}`,
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--mount",
      `type=volume,src=${workspaceVolume},dst=/workspace`,
      "--workdir",
      workingDirectory,
      "--env",
      "HOME=/tmp",
      "--env",
      "CI=true",
    ];
    for (const [key, value] of Object.entries(environment)) {
      args.push("--env", `${key}=${value}`);
    }
    args.push(this.config.runtimeImage, ...command);
    try {
      const options = {
        timeoutMs: this.remaining(deadline),
        outputLimitBytes: this.config.limits.commandOutputBytes,
        onTick: async () => {
          hooks.assertActive?.();
        },
        tickMs: 100,
        ...(hooks.signal ? { signal: hooks.signal } : {}),
      };
      const result = await runCommand("docker", args, options);
      if (/no space left on device|ENOSPC/i.test(result.output)) {
        throw new RunnerError(
          "DISK_LIMIT_EXCEEDED",
          "Workspace hard disk quota exceeded",
        );
      }
      await this.assertDiskLimit(workspaceVolume, deadline);
      return result;
    } catch (error) {
      await this.docker(["rm", "-f", name], Date.now() + 10_000, true);
      throw error;
    }
  }

  async inspectProject(
    repositoryPath: string,
    lifecycleScripts: string[],
  ): Promise<ProjectInspection> {
    const entries = new Set(await readdir(repositoryPath));
    if (entries.has(".gitmodules")) {
      throw new RunnerError("SUBMODULES_UNSUPPORTED", "Git submodules are unsupported");
    }
    await this.assertNoGitLfs(repositoryPath);
    const npm = entries.has("package-lock.json");
    const pnpm = entries.has("pnpm-lock.yaml");
    if (!npm && !pnpm) {
      throw new RunnerError("LOCKFILE_MISSING", "A supported root lockfile is required");
    }
    if (npm && pnpm) {
      throw new RunnerError(
        "LOCKFILE_MISMATCH",
        "Exactly one supported root lockfile is required",
      );
    }
    const packageJson = JSON.parse(
      await readFile(join(repositoryPath, "package.json"), "utf8"),
    ) as { scripts?: Record<string, unknown>; packageManager?: string };
    const scripts = packageJson.scripts ?? {};
    const lifecycle = lifecycleScripts.find(
      (name) => typeof scripts[name] === "string",
    );
    if (lifecycle) {
      throw new RunnerError(
        "LIFECYCLE_SCRIPTS_REQUIRED",
        `Install lifecycle script '${lifecycle}' is not executed`,
      );
    }
    const packageManager = npm ? "npm" : "pnpm";
    if (
      packageJson.packageManager &&
      !packageJson.packageManager.startsWith(`${packageManager}@`)
    ) {
      throw new RunnerError(
        "LOCKFILE_MISMATCH",
        "packageManager does not match the root lockfile",
      );
    }
    return {
      packageManager,
      hasBuild: typeof scripts.build === "string",
      hasTest: typeof scripts.test === "string",
    };
  }

  async assertRepositoryLimits(path: string): Promise<void> {
    let files = 0;
    let bytes = 0;
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.name === ".git") continue;
        const child = join(directory, entry.name);
        if (entry.isDirectory()) await visit(child);
        else {
          if (entry.isSymbolicLink()) {
            throw new RunnerError(
              "SYMLINKS_UNSUPPORTED",
              "Repository symbolic links are unsupported",
            );
          }
          files += 1;
          bytes += (await lstat(child)).size;
          if (files > this.config.limits.fileCount) {
            throw new RunnerError(
              "FILE_COUNT_LIMIT_EXCEEDED",
              "Repository file count limit exceeded",
            );
          }
          if (bytes > this.config.limits.repositoryBytes) {
            throw new RunnerError(
              "REPOSITORY_LIMIT_EXCEEDED",
              "Repository byte limit exceeded",
            );
          }
        }
      }
    };
    await visit(path);
  }

  private async assertNoGitLfs(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.assertNoGitLfs(child);
      } else if (entry.name === ".lfsconfig") {
        throw new RunnerError("GIT_LFS_UNSUPPORTED", "Git LFS is unsupported");
      } else if (entry.name === ".gitattributes") {
        const attributes = await readFile(child, "utf8");
        if (/filter=lfs/i.test(attributes)) {
          throw new RunnerError("GIT_LFS_UNSUPPORTED", "Git LFS is unsupported");
        }
      }
    }
  }

  private async assertDiskLimit(
    workspaceVolume: string,
    deadline: number,
  ): Promise<void> {
    const result = await this.docker(
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--user",
        "10001:10001",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--mount",
        `type=volume,src=${workspaceVolume},dst=/workspace`,
        this.config.runtimeImage,
        "du",
        "-sb",
        "/workspace",
      ],
      deadline,
    );
    const bytes = Number(result.output.split(/\s+/)[0]);
    if (!Number.isFinite(bytes) || bytes > this.config.limits.diskBytes) {
      throw new RunnerError("DISK_LIMIT_EXCEEDED", "Workspace disk limit exceeded");
    }
  }

  private async docker(
    args: string[],
    deadline: number,
    ignoreFailure = false,
  ): Promise<CommandResult> {
    const result = await runCommand("docker", args, {
      timeoutMs: this.remaining(deadline),
      outputLimitBytes: this.config.limits.commandOutputBytes,
    });
    if (result.exitCode !== 0 && !ignoreFailure) {
      throw new RunnerError(
        "RUNNER_FAILURE",
        `Docker command failed: ${summarize(result.output)}`,
        true,
      );
    }
    return result;
  }

  private remaining(deadline: number): number {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RunnerError("TIMEOUT", "Execution exceeded 180-second hard cap");
    }
    return remaining;
  }

  private async cleanup(
    workspaceVolume: string,
    workspaceKeeper: string,
    proxy: string,
    internalNetwork: string,
    egressNetwork: string,
  ): Promise<void> {
    const failures: unknown[] = [];
    await this.stopContainer(proxy).catch((error: unknown) => failures.push(error));
    await this.stopContainer(workspaceKeeper).catch((error: unknown) =>
      failures.push(error),
    );
    for (const network of [internalNetwork, egressNetwork]) {
      await this.removeNetwork(network).catch((error: unknown) =>
        failures.push(error),
      );
    }
    await this.removeVolume(workspaceVolume).catch((error: unknown) =>
      failures.push(error),
    );
    if (failures.length > 0) {
      throw new RunnerError(
        "RUNNER_FAILURE",
        `Cleanup failed for ${failures.length} disposable resource(s)`,
        true,
      );
    }
  }
}
