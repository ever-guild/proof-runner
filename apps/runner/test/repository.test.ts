import { describe, expect, it } from "vitest";
import { assertCanonicalGithubUrl } from "../src/repository.js";

describe("canonical public GitHub URL policy", () => {
  it("accepts only canonical owner/repository HTTPS URLs", () => {
    expect(
      assertCanonicalGithubUrl("https://github.com/ever-guild/proof-runner"),
    ).toEqual({
      url: "https://github.com/ever-guild/proof-runner",
      owner: "ever-guild",
      name: "proof-runner",
    });
  });

  it.each([
    "http://github.com/ever-guild/proof-runner",
    "https://github.com.evil.example/ever-guild/proof-runner",
    "https://127.0.0.1/ever-guild/proof-runner",
    "https://localhost/ever-guild/proof-runner",
    "https://github.com:443/ever-guild/proof-runner",
    "https://user@github.com/ever-guild/proof-runner",
    "https://github.com/ever-guild/proof-runner.git",
    "https://github.com/ever-guild/proof-runner/",
    "https://github.com/ever-guild/proof-runner?x=1",
    "https://github.com/ever-guild/proof-runner/tree/main",
    "https://github.com/ever-guild%2Fproof-runner",
  ])("rejects %s", (candidate) => {
    expect(() => assertCanonicalGithubUrl(candidate)).toThrow();
  });
});
