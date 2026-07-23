export type RunnerErrorCode =
  | "INVALID_REPOSITORY_URL"
  | "UNSUPPORTED_HOST"
  | "REF_NOT_FOUND"
  | "SUBMODULES_UNSUPPORTED"
  | "GIT_LFS_UNSUPPORTED"
  | "REPOSITORY_LIMIT_EXCEEDED"
  | "FILE_COUNT_LIMIT_EXCEEDED"
  | "SYMLINKS_UNSUPPORTED"
  | "DISK_LIMIT_EXCEEDED"
  | "OUTPUT_LIMIT_EXCEEDED"
  | "LOCKFILE_MISSING"
  | "LOCKFILE_MISMATCH"
  | "UNSUPPORTED_PACKAGE_MANAGER"
  | "LIFECYCLE_SCRIPTS_REQUIRED"
  | "NO_SUPPORTED_SKILL"
  | "SKILL_HASH_MISMATCH"
  | "INDETERMINATE_SKILL_RESULT"
  | "REGISTRY_FAILURE"
  | "DAMAGED_LOCKFILE"
  | "TIMEOUT"
  | "CANCELLED"
  | "LEASE_EXPIRED"
  | "RUNNER_FAILURE";

export class RunnerError extends Error {
  constructor(
    readonly code: RunnerErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

export const asRunnerError = (error: unknown): RunnerError =>
  error instanceof RunnerError
    ? error
    : new RunnerError(
        "RUNNER_FAILURE",
        error instanceof Error ? error.message : "Unknown runner failure",
        true,
      );
