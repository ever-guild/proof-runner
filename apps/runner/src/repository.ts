import { request } from "node:https";
import { RunnerError } from "./errors.js";
import { runCommand } from "./process.js";

export interface RepositoryRef {
  type: "branch" | "tag" | "commit";
  value: string;
}

const OWNER_OR_REPOSITORY = /^[A-Za-z0-9_.-]+$/;
const FULL_SHA = /^[a-f0-9]{40}$/;

export interface CanonicalRepository {
  url: string;
  owner: string;
  name: string;
}

export const assertCanonicalGithubUrl = (
  candidate: string,
): CanonicalRepository => {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new RunnerError(
      "INVALID_REPOSITORY_URL",
      "Repository URL must be an absolute HTTPS URL",
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new RunnerError(
      parsed.hostname === "github.com"
        ? "INVALID_REPOSITORY_URL"
        : "UNSUPPORTED_HOST",
      "Only canonical https://github.com/<owner>/<repository> URLs are accepted",
    );
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    segments.length !== 2 ||
    !segments.every((segment) => OWNER_OR_REPOSITORY.test(segment)) ||
    segments[1]?.endsWith(".git")
  ) {
    throw new RunnerError(
      "INVALID_REPOSITORY_URL",
      "Repository URL must contain exactly an owner and repository name",
    );
  }
  const [owner, name] = segments as [string, string];
  const canonical = `https://github.com/${owner}/${name}`;
  if (candidate !== canonical) {
    throw new RunnerError(
      "INVALID_REPOSITORY_URL",
      "Repository URL is not in canonical form",
    );
  }
  return { url: canonical, owner, name };
};

export const assertPublicRepositoryWithoutRedirect = async (
  repository: CanonicalRepository,
  timeoutMs = 10_000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = request(
      repository.url,
      {
        method: "HEAD",
        timeout: timeoutMs,
        headers: {
          "user-agent": "proof-runner/1",
          accept: "text/html",
        },
      },
      (response) => {
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          reject(
            new RunnerError(
              "INVALID_REPOSITORY_URL",
              "Repository redirects are not accepted",
            ),
          );
        } else if (status === 200) {
          resolve();
        } else {
          reject(
            new RunnerError(
              "REF_NOT_FOUND",
              `Public repository could not be read (HTTP ${status})`,
            ),
          );
        }
      },
    );
    req.on("timeout", () => req.destroy(new Error("Repository preflight timed out")));
    req.on("error", (error) =>
      reject(
        new RunnerError(
          "RUNNER_FAILURE",
          `Repository preflight failed: ${error.message}`,
          true,
        ),
      ),
    );
    req.end();
  });

const remoteRef = (ref: RepositoryRef): string => {
  const hasControl = Array.from(ref.value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    ref.value.includes("\0") ||
    ref.value.startsWith("-") ||
    hasControl ||
    /[ ~^:?*[\\]/.test(ref.value) ||
    ref.value.includes("..") ||
    ref.value.includes("@{") ||
    ref.value.endsWith(".") ||
    ref.value.endsWith("/")
  ) {
    throw new RunnerError("REF_NOT_FOUND", "Repository ref is invalid");
  }
  if (ref.type === "branch") return `refs/heads/${ref.value}`;
  if (ref.type === "tag") return `refs/tags/${ref.value}`;
  if (!FULL_SHA.test(ref.value)) {
    throw new RunnerError("REF_NOT_FOUND", "Commit must be a full lowercase SHA");
  }
  return ref.value;
};

const resolveCommit = async (
  repository: CanonicalRepository,
  sha: string,
  timeoutMs: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        protocol: "https:",
        hostname: "api.github.com",
        path: `/repos/${repository.owner}/${repository.name}/commits/${sha}`,
        method: "GET",
        timeout: timeoutMs,
        headers: {
          "user-agent": "proof-runner/1",
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          reject(
            new RunnerError(
              "INVALID_REPOSITORY_URL",
              "Commit resolution redirects are not accepted",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          if (status !== 200) {
            reject(
              new RunnerError(
                "REF_NOT_FOUND",
                `Commit could not be resolved (HTTP ${status})`,
              ),
            );
            return;
          }
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              sha?: string;
            };
            if (body.sha === sha && FULL_SHA.test(body.sha)) resolve(body.sha);
            else reject(new RunnerError("REF_NOT_FOUND", "Commit SHA did not resolve"));
          } catch {
            reject(new RunnerError("RUNNER_FAILURE", "Invalid GitHub response", true));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Commit resolution timed out")));
    req.on("error", (error) =>
      reject(
        new RunnerError(
          "RUNNER_FAILURE",
          `Commit resolution failed: ${error.message}`,
          true,
        ),
      ),
    );
    req.end();
  });

export const resolveRepositoryRef = async (
  repositoryUrl: string,
  ref: RepositoryRef,
  options: { timeoutMs?: number; preflight?: boolean } = {},
): Promise<string> => {
  const repository = assertCanonicalGithubUrl(repositoryUrl);
  if (options.preflight !== false) {
    await assertPublicRepositoryWithoutRedirect(repository, options.timeoutMs);
  }
  const requested = remoteRef(ref);
  if (ref.type === "commit") {
    return resolveCommit(repository, requested, options.timeoutMs ?? 20_000);
  }
  const candidates =
    ref.type === "tag" ? [`${requested}^{}`, requested] : [requested];
  for (const candidate of candidates) {
    const result = await runCommand(
      "git",
      [
        "-c",
        "http.followRedirects=false",
        "-c",
        "credential.helper=",
        "ls-remote",
        "--exit-code",
        repository.url,
        candidate,
      ],
      {
        timeoutMs: options.timeoutMs ?? 20_000,
        outputLimitBytes: 64 * 1024,
        env: {
          PATH: process.env.PATH,
          GIT_TERMINAL_PROMPT: "0",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
    );
    if (result.exitCode === 0) {
      const sha = result.output.trim().split(/\s+/)[0];
      if (sha && FULL_SHA.test(sha)) return sha;
    }
  }
  throw new RunnerError("REF_NOT_FOUND", "Repository ref could not be resolved");
};
