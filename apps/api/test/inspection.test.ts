import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION } from "@ever-guild/proof-runner-schema";
import {
  InspectionService,
  InspectionUnavailableError,
  type InspectionGateway,
} from "../src/inspection.js";

const resolvedCommitSha = "a".repeat(40);
const nodeTypescriptSkillHash = createHash("sha256")
  .update(
    readFileSync(
      new URL("../../../skills/node-typescript/skill.json", import.meta.url),
    ),
  )
  .digest("hex");

describe("InspectionService", () => {
  it("returns immutable Node/TypeScript metadata without executing repository code", async () => {
    const requestedFiles: string[] = [];
    const gateway: InspectionGateway = {
      resolve: async (repositoryUrl, ref) => {
        expect(repositoryUrl).toBe("https://github.com/ever-guild/example");
        expect(ref).toEqual({ type: "branch", value: "main" });
        return resolvedCommitSha;
      },
      file: async (_repositoryUrl, commit, path) => {
        expect(commit).toBe(resolvedCommitSha);
        requestedFiles.push(path);
        return {
          "package.json": JSON.stringify({
            packageManager: "pnpm@10.32.1",
            engines: { node: ">=22" },
            scripts: { build: "pnpm build", test: "pnpm test" },
            devDependencies: { typescript: "5.8.3" },
          }),
          "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
          "tsconfig.json": "{}\n",
          ".nvmrc": "22\n",
        }[path] ?? null;
      },
    };

    const result = await new InspectionService(gateway).inspect(
      "https://github.com/ever-guild/example",
      { type: "branch", value: "main" },
    );

    expect(result).toEqual({
      contractVersion: CONTRACT_VERSION,
      supported: true,
      inspection: {
        repositoryUrl: "https://github.com/ever-guild/example",
        requestedRef: { type: "branch", value: "main" },
        resolvedCommitSha,
        packageManager: "pnpm",
        lockfile: "pnpm-lock.yaml",
        nodeVersion: ">=22",
        hasTypeScript: true,
        scripts: { build: "pnpm build", test: "pnpm test" },
        selectedSkill: "node-typescript@1",
        selectedSkillHash: nodeTypescriptSkillHash,
      },
    });
    expect(requestedFiles).toEqual([
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
      ".nvmrc",
    ]);
  });

  it("treats committed empty metadata files as present without reading code", async () => {
    const gateway: InspectionGateway = {
      resolve: async () => resolvedCommitSha,
      file: async (_repositoryUrl, _commit, path) => ({
        "package.json": JSON.stringify({ packageManager: "npm@10.0.0" }),
        "package-lock.json": "",
        "tsconfig.json": "",
      }[path] ?? null),
    };

    const result = await new InspectionService(gateway).inspect(
      "https://github.com/ever-guild/example",
      { type: "commit", value: resolvedCommitSha },
    );

    expect(result).toMatchObject({
      supported: true,
      inspection: {
        lockfile: "package-lock.json",
        hasTypeScript: true,
      },
    });
  });

  it("rejects install lifecycle scripts before a run is scheduled", async () => {
    const gateway: InspectionGateway = {
      resolve: async () => resolvedCommitSha,
      file: async (_repositoryUrl, _commit, path) => ({
        "package.json": JSON.stringify({
          packageManager: "pnpm@10.0.0",
          scripts: { postinstall: "node exfiltrate.js" },
        }),
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }[path] ?? null),
    };

    await expect(
      new InspectionService(gateway).inspect(
        "https://github.com/ever-guild/example",
        { type: "tag", value: "v1.0.0" },
      ),
    ).resolves.toMatchObject({
      supported: false,
      reason: "LIFECYCLE_SCRIPTS_REQUIRED",
    });
  });

  it("rejects a non-canonical .git URL that the runner would refuse", async () => {
    const result = await new InspectionService().inspect(
      "https://github.com/ever-guild/example.git",
      { type: "branch", value: "main" },
    );

    expect(result).toMatchObject({
      supported: false,
      reason: "INVALID_REPOSITORY_URL",
    });
  });

  it("does not misrepresent an unavailable metadata source as a missing ref", async () => {
    const gateway: InspectionGateway = {
      resolve: async () => {
        throw new Error("GitHub is unavailable");
      },
      file: async () => null,
    };

    await expect(
      new InspectionService(gateway).inspect(
        "https://github.com/ever-guild/example",
        { type: "branch", value: "main" },
      ),
    ).rejects.toBeInstanceOf(InspectionUnavailableError);
  });
});
