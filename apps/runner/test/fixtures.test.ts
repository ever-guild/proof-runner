import {
  access,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunnerConfig } from "../src/config.js";
import { DockerSandbox } from "../src/sandbox.js";

const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));
const lifecycleScripts = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare",
  "pnpm:devPreinstall",
];
const config: RunnerConfig = {
  host: "127.0.0.1",
  port: 8788,
  bearerToken: "a".repeat(32),
  leaseExtensionMs: 30_000,
  runtimeImage: "unused",
  proxyImage: "unused",
  workspaceRoot: "/tmp/proof-runner-fixture-tests",
  limits: {
    repositoryBytes: 1024 * 1024,
    fileCount: 100,
    diskBytes: 1024 * 1024,
    cpuCount: 1,
    memoryBytes: 16 * 1024 * 1024,
    pids: 16,
    executionMs: 180_000,
    commandOutputBytes: 1024,
  },
};

describe("runner fixtures", () => {
  it("recognizes the passing and failing locked projects", async () => {
    const sandbox = new DockerSandbox(config);
    await expect(
      sandbox.inspectProject(`${fixtures}/passing`, lifecycleScripts),
    ).resolves.toMatchObject({ packageManager: "npm", hasTest: true });
    await expect(
      sandbox.inspectProject(`${fixtures}/failing`, lifecycleScripts),
    ).resolves.toMatchObject({ packageManager: "npm", hasTest: true });
    await expect(
      sandbox.inspectProject(`${fixtures}/pnpm-passing`, lifecycleScripts),
    ).resolves.toMatchObject({ packageManager: "pnpm", hasTest: true });
  });

  it("returns a stable lifecycle reason before malicious code executes", async () => {
    const sandbox = new DockerSandbox(config);
    await expect(
      sandbox.inspectProject(`${fixtures}/lifecycle`, lifecycleScripts),
    ).rejects.toMatchObject({ code: "LIFECYCLE_SCRIPTS_REQUIRED" });
    await expect(
      access(`${fixtures}/lifecycle/postinstall-executed`),
    ).rejects.toThrow();
    await expect(
      access(`${fixtures}/lifecycle/postinstall-network-succeeded`),
    ).rejects.toThrow();
  });

  it("rejects invalid and oversized fixtures", async () => {
    const sandbox = new DockerSandbox({
      ...config,
      limits: { ...config.limits, repositoryBytes: 32 },
    });
    await expect(
      sandbox.inspectProject(`${fixtures}/invalid`, lifecycleScripts),
    ).rejects.toMatchObject({ code: "LOCKFILE_MISSING" });
    await expect(
      sandbox.assertRepositoryLimits(`${fixtures}/oversized`),
    ).rejects.toMatchObject({ code: "REPOSITORY_LIMIT_EXCEEDED" });
    await expect(
      sandbox.inspectProject(`${fixtures}/git-lfs`, lifecycleScripts),
    ).rejects.toMatchObject({ code: "GIT_LFS_UNSUPPORTED" });
  });

  it("rejects Git-controlled symlinks without reading or leaking their host target", async () => {
    const root = await mkdtemp(join(tmpdir(), "proof-runner-symlink-test-"));
    const repository = join(root, "repository");
    const secret = "host-secret-must-never-be-read";
    try {
      await mkdir(repository);
      await writeFile(join(root, "host-secret"), secret);
      await symlink(join(root, "host-secret"), join(repository, "package.json"));
      const sandbox = new DockerSandbox(config);
      let failure: unknown;
      try {
        await sandbox.assertRepositoryLimits(repository);
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: "SYMLINKS_UNSUPPORTED" });
      expect(String(failure)).not.toContain(secret);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
