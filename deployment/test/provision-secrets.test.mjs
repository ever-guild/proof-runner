import { createPrivateKey, createPublicKey } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { provision } from "../provision-secrets.mjs";

test("provisions a long runner token and an Ed25519 receipt key without exposing either", () => {
  const directory = mkdtempSync(join(tmpdir(), "proof-runner-provision-"));
  const envFile = join(directory, ".env");
  writeFileSync(envFile, "PROOF_RUNNER_DOMAIN=proofrunner.example.com\nPROOF_RUNNER_BEARER_TOKEN=\nPROOF_RUNNER_RECEIPT_PRIVATE_KEY=\n");
  const { publicPath, keyId } = provision({ envFile, keyId: "receipt-test-1" });
  const environment = readFileSync(envFile, "utf8");
  const token = environment.match(/^PROOF_RUNNER_BEARER_TOKEN="([^"]+)"$/m)?.[1];
  const encodedKey = environment.match(/^PROOF_RUNNER_RECEIPT_PRIVATE_KEY=(.+)$/m)?.[1];
  assert.ok(token && token.length >= 32);
  assert.equal(statSync(envFile).mode & 0o777, 0o600);
  assert.equal(keyId, "receipt-test-1");
  assert.match(environment, /^PROOF_RUNNER_DOMAIN=proofrunner.example.com$/m);
  assert.equal(createPrivateKey(JSON.parse(encodedKey)).asymmetricKeyType, "ed25519");
  assert.equal(createPublicKey(readFileSync(publicPath, "utf8")).asymmetricKeyType, "ed25519");
  assert.throws(() => provision({ envFile, keyId: "receipt-test-1" }), /Refusing to overwrite/);
});
