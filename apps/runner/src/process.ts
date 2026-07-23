import { spawn } from "node:child_process";
import { RunnerError } from "./errors.js";

export interface CommandResult {
  exitCode: number;
  output: string;
  durationMs: number;
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputLimitBytes: number;
  signal?: AbortSignal;
  onTick?: () => Promise<void>;
  tickMs?: number;
}

export const runCommand = (
  command: string,
  args: string[],
  options: CommandOptions,
): Promise<CommandResult> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let settled = false;

    const timers: {
      timeout?: NodeJS.Timeout;
      ticker?: NodeJS.Timeout;
    } = {};
    let tickActive = false;
    const finish = (error?: Error, result?: CommandResult): void => {
      if (settled) return;
      settled = true;
      if (timers.timeout) clearTimeout(timers.timeout);
      if (timers.ticker) clearInterval(timers.ticker);
      options.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else if (result) resolve(result);
    };
    const terminate = (error: RunnerError): void => {
      child.kill("SIGKILL");
      finish(error);
    };
    const collect = (chunk: Buffer): void => {
      byteCount += chunk.byteLength;
      if (byteCount > options.outputLimitBytes) {
        terminate(
          new RunnerError(
            "OUTPUT_LIMIT_EXCEEDED",
            `Command output exceeded ${options.outputLimitBytes} bytes`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => finish(error));
    child.on("close", (exitCode) =>
      finish(undefined, {
        exitCode: exitCode ?? 1,
        output: Buffer.concat(chunks).toString("utf8"),
        durationMs: Date.now() - started,
      }),
    );

    const abort = (): void =>
      terminate(new RunnerError("CANCELLED", "Execution was cancelled"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    if (settled) return;

    timers.timeout = setTimeout(
      () =>
        terminate(
          new RunnerError(
            "TIMEOUT",
            `Execution exceeded ${options.timeoutMs} milliseconds`,
          ),
        ),
      options.timeoutMs,
    );
    timers.ticker = setInterval(() => {
      if (!options.onTick || tickActive) return;
      tickActive = true;
      void options
        .onTick()
        .catch((error: unknown) => {
          terminate(
            error instanceof RunnerError
              ? error
              : new RunnerError(
                  "RUNNER_FAILURE",
                  error instanceof Error ? error.message : "Limit monitor failed",
                  true,
                ),
          );
        })
        .finally(() => {
          tickActive = false;
        });
    }, options.tickMs ?? 250);
    timers.ticker.unref();
  });
