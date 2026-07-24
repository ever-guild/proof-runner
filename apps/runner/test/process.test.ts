import { describe, expect, it } from "vitest";
import { runCommand } from "../src/process.js";

describe("bounded command execution", () => {
  it("kills commands that exceed the output limit", async () => {
    await expect(
      runCommand(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(4096))"],
        { timeoutMs: 2_000, outputLimitBytes: 1024 },
      ),
    ).rejects.toMatchObject({ code: "OUTPUT_LIMIT_EXCEEDED" });
  });

  it("kills commands that exceed their timeout", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
        timeoutMs: 50,
        outputLimitBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    const result = runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 10000)"],
      {
        timeoutMs: 2_000,
        outputLimitBytes: 1024,
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" });
  });
});
