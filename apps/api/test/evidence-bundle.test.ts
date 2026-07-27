import {
  createHash,
  generateKeyPairSync,
  sign as signPayload,
} from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  EvidenceBundleManifestSchema,
  canonicalize,
  type VerificationContract,
  type VerificationReport,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptService,
  ReceiptSigner,
  ReceiptStore,
} from "@ever-guild/proof-runner-receipt";
import {
  EvidenceBundleService,
  MAX_EVIDENCE_BUNDLE_BYTES,
  createEvidenceBundle,
  createZipArchive,
  parseEvidenceBundleArchive,
  redactRawLog,
  verifyEvidenceBundle,
} from "../src/evidence-bundle.js";
import { RunStore } from "../src/store.js";

const { privateKey } = generateKeyPairSync("ed25519");
const signer = new ReceiptSigner({
  keyId: "bundle-test",
  privateKeyPem: privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
});

const report: VerificationReport = {
  contractVersion: CONTRACT_VERSION,
  runId: "018f47ac-5d7b-7c20-a1aa-0242ac120301",
  repositoryUrl: "https://github.com/ever-guild/example",
  resolvedCommitSha: "a".repeat(40),
  resolvedRef: { type: "commit", value: "a".repeat(40) },
  skill: {
    name: "node-typescript",
    version: "1",
    hash: "b".repeat(64),
  },
  runtimeImageDigest: `sha256:${"c".repeat(64)}`,
  verdict: "PASS",
  checks: [
    {
      id: "test",
      stage: "TEST",
      title: "Run tests",
      outcome: "PASSED",
      startedAt: "2026-07-26T12:00:00.000Z",
      completedAt: "2026-07-26T12:00:01.000Z",
      durationMs: 1_000,
      exitCode: 0,
      summary: "Tests passed.",
    },
  ],
  artifacts: [{ id: "dist", sha256: "d".repeat(64) }],
  durationMs: 1_000,
  completedAt: "2026-07-26T12:00:01.000Z",
  reasonCode: null,
};
const receipt = signer.issue(report);
const verificationContract: VerificationContract = {
  version: "1",
  subject: {
    repositoryUrl: report.repositoryUrl,
    resolvedCommitSha: report.resolvedCommitSha,
    skillHash: report.skill.hash,
    runtimeImageDigest: report.runtimeImageDigest,
  },
  criteria: [{ id: "tests", kind: "test-suite", required: true }],
  prohibitions: [],
};
const keyResolver = (keyId: string) =>
  keyId === signer.config.keyId ? signer.publicKeyPem : null;

const filesByPath = (archive: Buffer) =>
  new Map(
    parseEvidenceBundleArchive(archive).map((entry) => [
      entry.path,
      entry.data,
    ]),
  );

const replaceAscii = (
  archive: Buffer,
  source: string,
  replacement: string,
): Buffer => {
  if (Buffer.byteLength(source) !== Buffer.byteLength(replacement)) {
    throw new Error("test replacements must have equal byte lengths");
  }
  const result = Buffer.from(archive);
  const sourceBytes = Buffer.from(source);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(sourceBytes, offset)) !== -1) {
    result.write(replacement, offset, "ascii");
    offset += sourceBytes.length;
    replacements += 1;
  }
  if (replacements === 0) throw new Error(`missing ${source} in fixture`);
  return result;
};

const sha256 = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

const canonicalJsonBuffer = (value: unknown): Buffer =>
  Buffer.from(`${canonicalize(value)}\n`, "utf8");

const resignArchiveWithRawLog = (
  archive: Buffer,
  content: string,
): Buffer => {
  const entries = parseEvidenceBundleArchive(archive);
  const files = new Map(entries.map((entry) => [entry.path, entry.data]));
  const originalLog = JSON.parse(
    files.get("logs/raw.ndjson")!.toString("utf8").trimEnd(),
  ) as Record<string, unknown>;
  const logsData = canonicalJsonBuffer({ ...originalLog, content });
  files.set("logs/raw.ndjson", logsData);

  const manifest = EvidenceBundleManifestSchema.parse(
    JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
  );
  const changedManifest = EvidenceBundleManifestSchema.parse({
    ...manifest,
    files: manifest.files.map((file) =>
      file.path === "logs/raw.ndjson"
        ? { ...file, sha256: sha256(logsData), bytes: logsData.length }
        : file,
    ),
  });
  const canonicalManifest = canonicalize(changedManifest);
  const manifestData = canonicalJsonBuffer(changedManifest);
  const signatureData = canonicalJsonBuffer({
    bundleVersion: changedManifest.bundleVersion,
    keyId: changedManifest.receipt.keyId,
    canonicalization: "JCS-RFC8785",
    hashAlgorithm: "SHA-256",
    manifestHash: sha256(canonicalManifest),
    signatureAlgorithm: "Ed25519",
    signature: signPayload(
      null,
      Buffer.from(canonicalManifest),
      signer.privateKey,
    ).toString("base64"),
  });
  files.set("bundle-manifest.json", manifestData);
  files.set("bundle-manifest.sig", signatureData);
  files.set(
    "checksums.txt",
    Buffer.from(
      `${[
        ...changedManifest.files.map((file) => ({
          path: file.path,
          sha256: file.sha256,
        })),
        {
          path: "bundle-manifest.json",
          sha256: sha256(manifestData),
        },
        {
          path: "bundle-manifest.sig",
          sha256: sha256(signatureData),
        },
      ]
        .map((file) => `${file.sha256}  ${file.path}`)
        .join("\n")}\n`,
      "utf8",
    ),
  );
  return createZipArchive(
    entries.map((entry) => ({
      path: entry.path,
      data: files.get(entry.path)!,
    })),
  );
};

describe("signed evidence bundles", () => {
  it("creates a deterministic, complete, redacted, verifiable archive", () => {
    const input = {
      receipt,
      verificationContract,
      rawLogs: {
        kind: "retained" as const,
        logs: [
          {
            sequence: 0,
            stream: "stdout" as const,
            content:
              "Authorization: Basic dXNlcjpwYXNz Bearer secret-token-123 " +
              "ghp_abcdefghijklmnopqrstuvwxyz123456 password=hunter2",
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    };
    const first = createEvidenceBundle(input);
    const second = createEvidenceBundle(input);
    expect(first.equals(second)).toBe(true);

    const entries = parseEvidenceBundleArchive(first);
    expect(entries.map((entry) => entry.path)).toEqual([
      "receipt.json",
      "report.json",
      "verification-contract.json",
      "logs/raw.ndjson",
      "bundle-manifest.json",
      "bundle-manifest.sig",
      "checksums.txt",
    ]);
    const files = new Map(entries.map((entry) => [entry.path, entry.data]));
    const logs = files.get("logs/raw.ndjson")!.toString("utf8");
    expect(logs).toContain("[REDACTED]");
    expect(logs).not.toContain("secret-token-123");
    expect(logs).not.toContain("dXNlcjpwYXNz");
    expect(logs).not.toContain("hunter2");
    expect(logs).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");

    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.files.map((file) => file.path)).toEqual([
      "receipt.json",
      "report.json",
      "verification-contract.json",
      "logs/raw.ndjson",
    ]);
    expect(manifest.metadata.digestExclusions).toEqual([
      "bundle-manifest.json",
      "bundle-manifest.sig",
      "checksums.txt",
    ]);
    const checksums = files.get("checksums.txt")!.toString("utf8");
    expect(checksums).toContain("  bundle-manifest.json\n");
    expect(checksums).toContain("  bundle-manifest.sig\n");
    expect(checksums).not.toContain("  checksums.txt\n");
    expect(verifyEvidenceBundle(first, keyResolver)).toEqual({
      contractVersion: CONTRACT_VERSION,
      valid: true,
      reason: null,
      bundleId: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it.each([
    "authentication succeeded",
    "authoritative result",
    "tokenization passed",
    "secretary scheduled",
    "GET /?a=1&b=2",
    "foo=bar&baz=qux",
    "https://example.test/path?a=1&b=2",
    "Tom &amp; Jerry",
    "&copy; 2026",
    "copyright &#169;",
    "Tom &amp Jerry",
    "&copy 2026",
    "Price &pound 10",
    "Value &cent 5",
  ])("retains benign vocabulary without a credential context: %s", (content) => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    const bundledLog = JSON.parse(
      filesByPath(archive).get("logs/raw.ndjson")!.toString("utf8").trimEnd(),
    ) as { content: string };
    expect(bundledLog.content).toBe(content);
    expect(verifyEvidenceBundle(archive, keyResolver).valid).toBe(true);
  });

  it("handles near-limit encoded-marker noise without rescanning prefixes", () => {
    const content = "a%ZZ".repeat(100_000);
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    expect(filesByPath(archive).has("logs/raw.ndjson")).toBe(true);
    expect(verifyEvidenceBundle(archive, keyResolver).valid).toBe(true);
  });

  it("omits structured JSON logs containing credential fields", () => {
    const secrets = [
      "AKIA-SYNTHETIC-123",
      "aws-secret-synthetic-456",
      "credential-secret-789",
      "Basic dXNlcjpwYXNz",
    ];
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content: JSON.stringify({
              aws_access_key_id: secrets[0],
              aws_secret_access_key: secrets[1],
              credential: secrets[2],
              auth: secrets[3],
            }),
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    const files = filesByPath(archive);
    expect(files.has("logs/raw.ndjson")).toBe(false);
    for (const secret of secrets) {
      expect(archive.toString("utf8")).not.toContain(secret);
    }
    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.omissions).toEqual([
      {
        path: "logs/raw.ndjson",
        reason: "RAW_LOG_REDACTION_UNSAFE",
      },
    ]);
    expect(verifyEvidenceBundle(archive, keyResolver).valid).toBe(true);
  });

  it("omits Unicode-escaped credential keys in structured JSON logs", () => {
    const secrets = [
      "synthetic-aws-id-secret",
      "synthetic-aws-secret-key",
      "synthetic-credential-secret",
      "Basic dXNlcjpwYXNz",
    ];
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content: String.raw`{"aws\u005faccess\u005fkey\u005fid":"${secrets[0]}","aws\u005fsecret\u005faccess\u005fkey":"${secrets[1]}","cred\u0065ntial":"${secrets[2]}","a\u0075th":"${secrets[3]}"}`,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    const files = filesByPath(archive);
    expect(files.has("logs/raw.ndjson")).toBe(false);
    for (const secret of secrets) {
      expect(archive.toString("utf8")).not.toContain(secret);
    }
    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.omissions).toEqual([
      {
        path: "logs/raw.ndjson",
        reason: "RAW_LOG_REDACTION_UNSAFE",
      },
    ]);
    expect(verifyEvidenceBundle(archive, keyResolver)).toMatchObject({
      valid: true,
      reason: null,
    });
  });

  it.each([
    [
      String.raw`prefix {"cred\u0065ntial":"mixed-json-secret"} suffix`,
      "mixed-json-secret",
    ],
    [
      String.raw`prefix cred\u0065ntial=mixed-assignment-secret suffix`,
      "mixed-assignment-secret",
    ],
    [
      String.raw`prefix "cred\u0065ntial" = "mixed-equals-secret" suffix`,
      "mixed-equals-secret",
    ],
    [
      String.raw`prefix cred\u{65}ntial=braced-assignment-secret suffix`,
      "braced-assignment-secret",
    ],
    [
      String.raw`prefix cred\x65ntial=hex-assignment-secret suffix`,
      "hex-assignment-secret",
    ],
    [
      String.raw`prefix cred\145ntial=unknown-escape-secret suffix`,
      "unknown-escape-secret",
    ],
    [
      String.raw`prefix cred\u{110000}ential=invalid-escape-secret suffix`,
      "invalid-escape-secret",
    ],
    [
      String.raw`prefix {cred\u0065ntial=brace-encoded-secret}`,
      "brace-encoded-secret",
    ],
    [
      String.raw`cmd --passw\u006frd=cli-encoded-secret`,
      "cli-encoded-secret",
    ],
    [
      String.raw`cmd -passw\u006frd=single-encoded-secret`,
      "single-encoded-secret",
    ],
    [
      String.raw`prefix $cred\u0065ntial=dollar-encoded-secret`,
      "dollar-encoded-secret",
    ],
    [
      "prefix ${cred\\u0065ntial}=shell-braced-secret",
      "shell-braced-secret",
    ],
    [
      String.raw`cmd --passw\u006frd whitespace-cli-secret`,
      "whitespace-cli-secret",
    ],
    [
      String.raw`cmd -api\u005fkey "quoted-encoded-secret"`,
      "quoted-encoded-secret",
    ],
    [
      String.raw`(cred\u0065ntial)=encoded-paren-secret`,
      "encoded-paren-secret",
    ],
    [
      String.raw`[cred\u0065ntial]=encoded-bracket-secret`,
      "encoded-bracket-secret",
    ],
    ["(password)=literal-paren-secret", "literal-paren-secret"],
    ["[password]=literal-bracket-secret", "literal-bracket-secret"],
    ["${password}=literal-shell-secret", "literal-shell-secret"],
    ["DB__PASSWORD=double-separator-secret", "double-separator-secret"],
    [
      String.raw`prefix }cred\u0065ntial=closer-secret`,
      "closer-secret",
    ],
    [
      String.raw`cred\u0065ntial{=opening-secret`,
      "opening-secret",
    ],
    [
      String.raw`password\u003dencoded-equals-secret`,
      "encoded-equals-secret",
    ],
    [
      String.raw`password\x3dhex-encoded-equals-secret`,
      "hex-encoded-equals-secret",
    ],
    [
      String.raw`cmd --password\u0020encoded-space-secret`,
      "encoded-space-secret",
    ],
    [
      String.raw`passw\u006frd\u003dencoded-key-separator-secret`,
      "encoded-key-separator-secret",
    ],
    [
      String.raw`password\75octal-separator-secret`,
      "octal-separator-secret",
    ],
    [
      String.raw`password\\u003ddouble-escaped-separator-secret`,
      "double-escaped-separator-secret",
    ],
    [
      String.raw`passw\u006frd\75encoded-key-octal-separator-secret`,
      "encoded-key-octal-separator-secret",
    ],
    [
      String.raw`passw\157rd\75both-octal-secret`,
      "both-octal-secret",
    ],
    [
      String.raw`cred\145ntial\75octal-credential-secret`,
      "octal-credential-secret",
    ],
    [
      String.raw`--passw\157rd\40octal-cli-secret`,
      "octal-cli-secret",
    ],
    ["( password )=spaced-wrapper-secret", "spaced-wrapper-secret"],
    ["' password '=spaced-quote-secret", "spaced-quote-secret"],
    ["%70assword=percent-key-secret", "percent-key-secret"],
    [
      "%70%61%73%73%77%6f%72%64%3Dpercent-all-secret",
      "percent-all-secret",
    ],
    ["&#112;assword&#61;html-encoded-secret", "html-encoded-secret"],
    ["&#112assword=html-decimal-no-semi-secret", "html-decimal-no-semi-secret"],
    ["p&#x61ssword=html-hex-no-semi-secret", "html-hex-no-semi-secret"],
    [
      "&#00000112;assword=html-decimal-leading-zero-secret",
      "html-decimal-leading-zero-secret",
    ],
    [
      "p&#x00000061;ssword=html-hex-leading-zero-secret",
      "html-hex-leading-zero-secret",
    ],
    [
      "passw&ordm;rd&equals;html-named-secret",
      "html-named-secret",
    ],
    [
      "passw&ordmrd=html-legacy-no-semi-secret",
      "html-legacy-no-semi-secret",
    ],
    [
      "passw&copyrd=html-copy-no-semi-secret",
      "html-copy-no-semi-secret",
    ],
    [
      "passw&regrd=html-reg-no-semi-secret",
      "html-reg-no-semi-secret",
    ],
    [
      "passw%26copyrd=encoded-html-copy-no-semi-secret",
      "encoded-html-copy-no-semi-secret",
    ],
    ["passw&copyrd=CONTROLCOPY", "CONTROLCOPY"],
    ["passw&regrd=CONTROLREG", "CONTROLREG"],
    ["passw%26copyrd=CONTROLPCOPY", "CONTROLPCOPY"],
    ["passw&centrd=CONTROLCENT", "CONTROLCENT"],
    ["passw&poundrd=CONTROLPOUND", "CONTROLPOUND"],
    ["passw%26centrd=CONTROLPCENT", "CONTROLPCENT"],
    ["pass&nbspword=CONTROLNBSP", "CONTROLNBSP"],
    ["pass&shy;word=CONTROLSHY", "CONTROLSHY"],
    ["pass%26nbspword=CONTROLPNBSP", "CONTROLPNBSP"],
    ["pass%26shy%3Bword=CONTROLPSHY", "CONTROLPSHY"],
    ["pass%5C77%20ord=CONTROLCSSPCT", "CONTROLCSSPCT"],
    [String.raw`pass\25 5C77%20ord=CONTROLMIXED1`, "CONTROLMIXED1"],
    ["pass%5C25%205C77%2520ord=CONTROLMIXED2", "CONTROLMIXED2"],
    [
      "pass&percnt;5C77&percnt;20ord=CONTROLHTMLMIXED",
      "CONTROLHTMLMIXED",
    ],
    ["pass％5C77％20ord=CONTROLNFKC1", "CONTROLNFKC1"],
    [
      "pass%EF%BC%855C77%EF%BC%8520ord=CONTROLNFKC2",
      "CONTROLNFKC2",
    ],
    ["pass＼77 ord=CONTROLNFKC3", "CONTROLNFKC3"],
    ["passw＆centrd=CONTROLNFKC4", "CONTROLNFKC4"],
    [String.raw`pass\u005c77 ord=CONTROLU005C`, "CONTROLU005C"],
    [String.raw`pass\x5c77 ord=CONTROLX5C`, "CONTROLX5C"],
    [String.raw`pass\13477 ord=CONTROLOCTBACKSLASH`, "CONTROLOCTBACKSLASH"],
    ["pass&#92;77 ord=CONTROLHTMLBACKSLASH", "CONTROLHTMLBACKSLASH"],
    [
      "pass&amp;percnt;5C77&amp;percnt;20ord=CONTROLAMPHTML",
      "CONTROLAMPHTML",
    ],
    [
      "pass%26amp%3Bpercnt%3B5C77%26amp%3Bpercnt%3B20ord=CONTROLPAMPHTML",
      "CONTROLPAMPHTML",
    ],
    [
      "-----BEGIN%20PRIVATE%20KEY-----\nCONTROLENCODEDPEM",
      "CONTROLENCODEDPEM",
    ],
    [
      "%67hp_abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
    ],
    [
      "postgres://user:CONTROLENCODEDURI%40host/db",
      "CONTROLENCODEDURI",
    ],
    [
      "Authorization&#58; Basic CONTROLHTMLAUTH",
      "CONTROLHTMLAUTH",
    ],
    [
      "Authorization&colon; Bearer CONTROLNAMEDAUTH",
      "CONTROLNAMEDAUTH",
    ],
    [
      "postgres：／／user：CONTROLUNICODEURI＠host/db",
      "CONTROLUNICODEURI",
    ],
    [
      String.raw`g\68 p_abcdefghijklmnopqrstuvwxyz123456`,
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
    ],
    [
      "postgres://user:CONTROLCOMMAT&commat;host/db",
      "CONTROLCOMMAT",
    ],
    [
      "g&hopf;p_abcdefghijklmnopqrstuvwxyz123456",
      "ghp_abcdefghijklmnopqrstuvwxyz123456",
    ],
    [
      "postgres://user:CONTROLNESTED&amp;commat;host/db",
      "CONTROLNESTED",
    ],
    [
      "postgres://user:CONTROLPERCENT%26commat%3Bhost/db",
      "CONTROLPERCENT",
    ],
    [
      "passw%26ordm%3Brd%26equals%3Bencoded-html-named-secret",
      "encoded-html-named-secret",
    ],
    [
      "password=[REDACTED])partial-closer-secret",
      "partial-closer-secret",
    ],
    [
      "password /*comment*/ = comment-separated-secret",
      "comment-separated-secret",
    ],
    ["ｐａｓｓｗｏｒｄ＝fullwidth-secret", "fullwidth-secret"],
    ["pass\u200bword=zero-width-secret", "zero-width-secret"],
    [
      "%2570assword=nested-percent-key-secret",
      "nested-percent-key-secret",
    ],
    [
      "password%2525253Dnested-percent-separator-secret",
      "nested-percent-separator-secret",
    ],
    ["p.a.s.s.w.o.r.d=dot-split-secret", "dot-split-secret"],
    ["p a s s w o r d = spaced-key-secret", "spaced-key-secret"],
    ["pass-word=hyphen-split-secret", "hyphen-split-secret"],
    [String.raw`pass\77 ord=css-escaped-secret`, "css-escaped-secret"],
    [
      String.raw`pass\000077ord=css-padded-secret`,
      "css-padded-secret",
    ],
    [
      "%EF%BD%90assword=utf8-fullwidth-percent-secret",
      "utf8-fullwidth-percent-secret",
    ],
    ["%FFassword=invalid-utf8-percent-secret", "invalid-utf8-percent-secret"],
    [
      "&#99999999password=oversized-decimal-prefix-secret",
      "oversized-decimal-prefix-secret",
    ],
    [
      "&#x1111111password=oversized-hex-prefix-secret",
      "oversized-hex-prefix-secret",
    ],
    ["pass\\\nword=line-continuation-secret", "line-continuation-secret"],
    ["pass\\\r\nword=crlf-continuation-secret", "crlf-continuation-secret"],
    [
      "pass%5C%0Aword=encoded-continuation-secret",
      "encoded-continuation-secret",
    ],
  ])(
    "omits a non-canonical credential key: %s",
    (content, secret) => {
      const archive = createEvidenceBundle({
        receipt,
        rawLogs: {
          kind: "retained",
          logs: [
            {
              sequence: 0,
              stream: "stderr",
              content,
              createdAt: "2026-07-26T12:00:00.000Z",
              expiresAt: "2026-08-26T12:00:00.000Z",
            },
          ],
        },
        signer,
      });

      const files = filesByPath(archive);
      expect(files.has("logs/raw.ndjson")).toBe(false);
      expect(archive.toString("utf8")).not.toContain(secret);
      const manifest = EvidenceBundleManifestSchema.parse(
        JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
      );
      expect(manifest.omissions).toEqual([
        {
          path: "logs/raw.ndjson",
          reason: "RAW_LOG_REDACTION_UNSAFE",
        },
      ]);
    },
  );

  it("redacts credentials from non-HTTP connection URIs", () => {
    const secrets = [
      "postgres-secret",
      "redis-secret",
      "mongo-secret",
      "relative-secret",
    ];
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content:
              `postgresql://demo:${secrets[0]}@db.internal/app ` +
              `redis://cache:${secrets[1]}@cache.internal/0 ` +
              `mongodb://:${secrets[2]}@mongo.internal/app ` +
              `//demo:${secrets[3]}@relative.internal/path`,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    const logs = filesByPath(archive)
      .get("logs/raw.ndjson")!
      .toString("utf8");
    expect(logs).toContain("[REDACTED]");
    for (const secret of secrets) {
      expect(logs).not.toContain(secret);
    }
    expect(verifyEvidenceBundle(archive, keyResolver).valid).toBe(true);
  });

  it.each([
    [
      "pipe",
      "prefix|password=first pipe-suffix-secret",
      "pipe-suffix-secret",
    ],
    [
      "parenthesis",
      "(password=first parenthesis-suffix-secret)",
      "parenthesis-suffix-secret",
    ],
    [
      "bracket",
      "[password=first bracket-suffix-secret]",
      "bracket-suffix-secret",
    ],
  ])("omits an ambiguous credential after a %s separator", (_name, content, secret) => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    const files = filesByPath(archive);
    expect(files.has("logs/raw.ndjson")).toBe(false);
    expect(archive.toString("utf8")).not.toContain(secret);
    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.omissions).toEqual([
      {
        path: "logs/raw.ndjson",
        reason: "RAW_LOG_REDACTION_UNSAFE",
      },
    ]);
    expect(verifyEvidenceBundle(archive, keyResolver)).toMatchObject({
      valid: true,
      reason: null,
    });
  });

  it.each([
    ["password option", "cmd --password cli-secret", "cli-secret"],
    [
      "quoted API key option",
      'cmd --api-key "quoted-cli-secret"',
      "quoted-cli-secret",
    ],
  ])("redacts a whitespace-delimited CLI %s", (_name, content, secret) => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });
    const logs = filesByPath(archive)
      .get("logs/raw.ndjson")!
      .toString("utf8");
    expect(logs).toContain("[REDACTED]");
    expect(logs).not.toContain(secret);
    expect(verifyEvidenceBundle(archive, keyResolver).valid).toBe(true);
  });

  it.each([
    ["DB_PASSWORD=db-prefixed-secret", "db-prefixed-secret"],
    ["X-API-Key: x-prefixed-secret", "x-prefixed-secret"],
    ["AUTH_TOKEN=auth-prefixed-secret", "auth-prefixed-secret"],
  ])("redacts a prefixed credential identifier: %s", (content, secret) => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stdout",
            content,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });
    const logs = filesByPath(archive)
      .get("logs/raw.ndjson")!
      .toString("utf8");
    expect(logs).toContain("[REDACTED]");
    expect(logs).not.toContain(secret);
    const bundledLog = JSON.parse(logs.trimEnd()) as { content: string };
    expect(redactRawLog(bundledLog.content)).toBe(bundledLog.content);
    expect(verifyEvidenceBundle(archive, keyResolver)).toMatchObject({
      valid: true,
      reason: null,
    });
  });

  it.each([
    ['password="very secret value', "very secret value"],
    ['cmd --password="cli-quote-secret', "cli-quote-secret"],
    [
      [
        "PRIVATE_KEY=-----BEGIN PRIVATE KEY-----",
        "very-secret-key-material",
        "-----END PRIVATE KEY-----",
      ].join("\n"),
      "very-secret-key-material",
    ],
    [
      [
        "-----BEGIN CUSTOM-PRIVATE KEY-----",
        "custom-private-secret",
        "-----END CUSTOM-PRIVATE KEY-----",
      ].join("\n"),
      "custom-private-secret",
    ],
    [
      "PRIVATE_KEY=first-part\\\ncontinued-private-secret",
      "continued-private-secret",
    ],
    ["password: |\n  yaml-block-secret", "yaml-block-secret"],
    [
      'password="first"quoted-suffix-secret',
      "quoted-suffix-secret",
    ],
    [
      'password="first",quoted-comma-secret',
      "quoted-comma-secret",
    ],
  ])("omits an unsafe multiline or unterminated credential: %s", (content, secret) => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stderr",
            content,
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });

    const files = filesByPath(archive);
    expect(files.has("logs/raw.ndjson")).toBe(false);
    expect(archive.toString("utf8")).not.toContain(secret);
    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.omissions).toEqual([
      {
        path: "logs/raw.ndjson",
        reason: "RAW_LOG_REDACTION_UNSAFE",
      },
    ]);
  });

  it.each([
    ['password="very secret value'],
    ["prefix|password=very secret value"],
    ["(password=very secret value)"],
    ["[password=very secret value]"],
    ["cmd --password=cli-secret"],
    ['cmd --password="cli-quote-secret'],
    [String.raw`prefix {cred\u0065ntial=brace-encoded-secret}`],
    [String.raw`cmd --passw\u006frd=cli-encoded-secret`],
    [String.raw`cmd -passw\u006frd=single-encoded-secret`],
    [String.raw`prefix $cred\u0065ntial=dollar-encoded-secret`],
    ["prefix ${cred\\u0065ntial}=shell-braced-secret"],
    [
      [
        "-----BEGIN CUSTOM-PRIVATE KEY-----",
        "custom-private-secret",
        "-----END CUSTOM-PRIVATE KEY-----",
      ].join("\n"),
    ],
    ["PRIVATE_KEY=first-part\\\ncontinued-private-secret"],
    ["//demo:relative-secret@host/path"],
    ["cmd --password cli-secret"],
    ['cmd --api-key "quoted-cli-secret"'],
    ["DB_PASSWORD=db-prefixed-secret"],
    ["X-API-Key: x-prefixed-secret"],
    ["AUTH_TOKEN=auth-prefixed-secret"],
    ["password: |\n  yaml-block-secret"],
    ['password="first"quoted-suffix-secret'],
    ["password=[REDACTED] leaked-suffix-secret"],
    ["password=[REDACTED]leaked-suffix-secret"],
    [String.raw`cmd --passw\u006frd whitespace-cli-secret`],
    [String.raw`cmd -api\u005fkey "quoted-encoded-secret"`],
    [String.raw`(cred\u0065ntial)=encoded-paren-secret`],
    [String.raw`[cred\u0065ntial]=encoded-bracket-secret`],
    ["(password)=literal-paren-secret"],
    ["[password]=literal-bracket-secret"],
    ["${password}=literal-shell-secret"],
    ["DB__PASSWORD=double-separator-secret"],
    ['password="first",quoted-comma-secret'],
    ["password=[REDACTED],partial-comma-secret"],
    [String.raw`prefix }cred\u0065ntial=closer-secret`],
    [String.raw`cred\u0065ntial{=opening-secret`],
    [String.raw`password\u003dencoded-equals-secret`],
    [String.raw`password\x3dhex-encoded-equals-secret`],
    [String.raw`cmd --password\u0020encoded-space-secret`],
    [String.raw`passw\u006frd\u003dencoded-key-separator-secret`],
    [String.raw`password\75octal-separator-secret`],
    [String.raw`password\\u003ddouble-escaped-separator-secret`],
    [String.raw`passw\u006frd\75encoded-key-octal-separator-secret`],
    [String.raw`passw\157rd\75both-octal-secret`],
    [String.raw`cred\145ntial\75octal-credential-secret`],
    [String.raw`--passw\157rd\40octal-cli-secret`],
    ["( password )=spaced-wrapper-secret"],
    ["' password '=spaced-quote-secret"],
    ["%70assword=percent-key-secret"],
    ["%70%61%73%73%77%6f%72%64%3Dpercent-all-secret"],
    ["&#112;assword&#61;html-encoded-secret"],
    ["&#112assword=html-decimal-no-semi-secret"],
    ["p&#x61ssword=html-hex-no-semi-secret"],
    ["&#00000112;assword=html-decimal-leading-zero-secret"],
    ["p&#x00000061;ssword=html-hex-leading-zero-secret"],
    ["passw&ordm;rd&equals;html-named-secret"],
    ["passw&ordmrd=html-legacy-no-semi-secret"],
    ["passw&copyrd=html-copy-no-semi-secret"],
    ["passw&regrd=html-reg-no-semi-secret"],
    ["passw%26copyrd=encoded-html-copy-no-semi-secret"],
    ["passw&copyrd=CONTROLCOPY"],
    ["passw&regrd=CONTROLREG"],
    ["passw%26copyrd=CONTROLPCOPY"],
    ["passw&centrd=CONTROLCENT"],
    ["passw&poundrd=CONTROLPOUND"],
    ["passw%26centrd=CONTROLPCENT"],
    ["pass&nbspword=CONTROLNBSP"],
    ["pass&shy;word=CONTROLSHY"],
    ["pass%26nbspword=CONTROLPNBSP"],
    ["pass%26shy%3Bword=CONTROLPSHY"],
    ["pass%5C77%20ord=CONTROLCSSPCT"],
    [String.raw`pass\25 5C77%20ord=CONTROLMIXED1`],
    ["pass%5C25%205C77%2520ord=CONTROLMIXED2"],
    ["pass&percnt;5C77&percnt;20ord=CONTROLHTMLMIXED"],
    ["pass％5C77％20ord=CONTROLNFKC1"],
    ["pass%EF%BC%855C77%EF%BC%8520ord=CONTROLNFKC2"],
    ["pass＼77 ord=CONTROLNFKC3"],
    ["passw＆centrd=CONTROLNFKC4"],
    [String.raw`pass\u005c77 ord=CONTROLU005C`],
    [String.raw`pass\x5c77 ord=CONTROLX5C`],
    [String.raw`pass\13477 ord=CONTROLOCTBACKSLASH`],
    ["pass&#92;77 ord=CONTROLHTMLBACKSLASH"],
    ["pass&amp;percnt;5C77&amp;percnt;20ord=CONTROLAMPHTML"],
    [
      "pass%26amp%3Bpercnt%3B5C77%26amp%3Bpercnt%3B20ord=CONTROLPAMPHTML",
    ],
    ["-----BEGIN%20PRIVATE%20KEY-----\nCONTROLENCODEDPEM"],
    ["%67hp_abcdefghijklmnopqrstuvwxyz123456"],
    ["postgres://user:CONTROLENCODEDURI%40host/db"],
    ["Authorization&#58; Basic CONTROLHTMLAUTH"],
    ["Authorization&colon; Bearer CONTROLNAMEDAUTH"],
    ["postgres：／／user：CONTROLUNICODEURI＠host/db"],
    [String.raw`g\68 p_abcdefghijklmnopqrstuvwxyz123456`],
    ["postgres://user:CONTROLCOMMAT&commat;host/db"],
    ["g&hopf;p_abcdefghijklmnopqrstuvwxyz123456"],
    ["postgres://user:CONTROLNESTED&amp;commat;host/db"],
    ["postgres://user:CONTROLPERCENT%26commat%3Bhost/db"],
    ["passw%26ordm%3Brd%26equals%3Bencoded-html-named-secret"],
    ["password=[REDACTED])partial-closer-secret"],
    ["password /*comment*/ = comment-separated-secret"],
    ["ｐａｓｓｗｏｒｄ＝fullwidth-secret"],
    ["pass\u200bword=zero-width-secret"],
    ["%2570assword=nested-percent-key-secret"],
    ["password%2525253Dnested-percent-separator-secret"],
    ["p.a.s.s.w.o.r.d=dot-split-secret"],
    ["p a s s w o r d = spaced-key-secret"],
    ["pass-word=hyphen-split-secret"],
    [String.raw`pass\77 ord=css-escaped-secret`],
    [String.raw`pass\000077ord=css-padded-secret`],
    ["%EF%BD%90assword=utf8-fullwidth-percent-secret"],
    ["%FFassword=invalid-utf8-percent-secret"],
    ["&#99999999password=oversized-decimal-prefix-secret"],
    ["&#x1111111password=oversized-hex-prefix-secret"],
    ["pass\\\nword=line-continuation-secret"],
    ["pass\\\r\nword=crlf-continuation-secret"],
    ["pass%5C%0Aword=encoded-continuation-secret"],
  ])(
    "rejects a freshly signed bundle containing an unsafe raw log: %s",
    (content) => {
      const safe = createEvidenceBundle({
        receipt,
        rawLogs: {
          kind: "retained",
          logs: [
            {
              sequence: 0,
              stream: "stdout",
              content: "status=ok",
              createdAt: "2026-07-26T12:00:00.000Z",
              expiresAt: "2026-08-26T12:00:00.000Z",
            },
          ],
        },
        signer,
      });
      const unsafe = resignArchiveWithRawLog(safe, content);
      expect(verifyEvidenceBundle(unsafe, keyResolver)).toMatchObject({
        valid: false,
        reason: "MANIFEST_INVALID",
      });
    },
  );

  it("omits expired logs with an explicit reason", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: { kind: "expired" },
      signer,
    });
    const files = filesByPath(archive);
    expect(files.has("logs/raw.ndjson")).toBe(false);
    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.omissions).toEqual([
      { path: "logs/raw.ndjson", reason: "RAW_LOG_EXPIRED" },
    ]);
    expect(verifyEvidenceBundle(archive, keyResolver).valid).toBe(true);
  });

  it("creates a bundle for a historical receipt through the private key ring", () => {
    const directory = mkdtempSync(join(tmpdir(), "proof-runner-bundle-rotation-"));
    const databasePath = join(directory, "runs.sqlite");
    const runs = new RunStore(databasePath);
    const receiptStore = new ReceiptStore(databasePath);
    const { privateKey: currentPrivateKey } =
      generateKeyPairSync("ed25519");
    const receipts = new ReceiptService(
      {
        keyId: "bundle-current",
        privateKeyPem: currentPrivateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
      receiptStore,
      [],
      [signer.config],
    );
    try {
      receiptStore.save(receipt);
      const bundles = new EvidenceBundleService(
        receipts,
        receiptStore,
        runs,
      );
      const archive = bundles.create(
        receipt.payload.id,
        "2026-07-26T12:00:02.000Z",
      );
      const signature = JSON.parse(
        filesByPath(archive).get("bundle-manifest.sig")!.toString("utf8"),
      ) as { keyId: string };
      expect(signature.keyId).toBe(receipt.keyId);
      expect(bundles.verify(archive)).toMatchObject({
        valid: true,
        reason: null,
      });
    } finally {
      runs.close();
      receiptStore.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("omits retained logs when a credential has an unsafe structured value", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: {
        kind: "retained",
        logs: [
          {
            sequence: 0,
            stream: "stderr",
            content: '{"password":{"nested":"must-not-ship"}}',
            createdAt: "2026-07-26T12:00:00.000Z",
            expiresAt: "2026-08-26T12:00:00.000Z",
          },
        ],
      },
      signer,
    });
    const files = filesByPath(archive);
    expect(files.has("logs/raw.ndjson")).toBe(false);
    expect(archive.toString("utf8")).not.toContain("must-not-ship");
    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    expect(manifest.omissions).toEqual([
      {
        path: "logs/raw.ndjson",
        reason: "RAW_LOG_REDACTION_UNSAFE",
      },
    ]);
  });

  it("detects direct payload tampering before trusting report data", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: { kind: "unavailable" },
      signer,
    });
    const entries = parseEvidenceBundleArchive(archive).map((entry) =>
      entry.path === "report.json"
        ? {
            ...entry,
            data: Buffer.from(
              entry.data.toString("utf8").replace("Tests passed.", "Tests forged."),
            ),
          }
        : entry,
    );
    const tampered = createZipArchive(entries);
    expect(verifyEvidenceBundle(tampered, keyResolver)).toMatchObject({
      valid: false,
      reason: "CHECKSUM_MISMATCH",
    });
  });

  it("rejects recomputed checksums and manifest without a fresh signature", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: { kind: "unavailable" },
      signer,
    });
    const entries = parseEvidenceBundleArchive(archive);
    const files = new Map(entries.map((entry) => [entry.path, entry.data]));
    const changedReport = Buffer.from(
      files
        .get("report.json")!
        .toString("utf8")
        .replace("Tests passed.", "Tests forged."),
    );
    files.set("report.json", changedReport);

    const manifest = EvidenceBundleManifestSchema.parse(
      JSON.parse(files.get("bundle-manifest.json")!.toString("utf8")),
    );
    const changedManifest = {
      ...manifest,
      files: manifest.files.map((file) =>
        file.path === "report.json"
          ? {
              ...file,
              sha256: createHash("sha256")
                .update(changedReport)
                .digest("hex"),
              bytes: changedReport.length,
            }
          : file,
      ),
    };
    const changedManifestData = Buffer.from(
      `${canonicalize(changedManifest)}\n`,
    );
    files.set("bundle-manifest.json", changedManifestData);
    const signatureData = files.get("bundle-manifest.sig")!;
    files.set(
      "checksums.txt",
      Buffer.from(
        `${[
          ...changedManifest.files.map((file) => ({
            path: file.path,
            sha256: file.sha256,
          })),
          {
            path: "bundle-manifest.json",
            sha256: createHash("sha256")
              .update(changedManifestData)
              .digest("hex"),
          },
          {
            path: "bundle-manifest.sig",
            sha256: createHash("sha256")
              .update(signatureData)
              .digest("hex"),
          },
        ]
          .map((file) => `${file.sha256}  ${file.path}`)
          .join("\n")}\n`,
      ),
    );

    const recomputed = createZipArchive(
      entries.map((entry) => ({
        path: entry.path,
        data: files.get(entry.path)!,
      })),
    );
    expect(verifyEvidenceBundle(recomputed, keyResolver)).toMatchObject({
      valid: false,
      reason: "INVALID_MANIFEST_SIGNATURE",
    });
  });

  it("rejects non-canonical base64 in the detached manifest signature", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: { kind: "unavailable" },
      signer,
    });
    const entries = parseEvidenceBundleArchive(archive);
    const changed = entries.map((entry) => {
      if (entry.path !== "bundle-manifest.sig") return entry;
      const signature = JSON.parse(entry.data.toString("utf8")) as {
        signature: string;
      };
      return {
        ...entry,
        data: Buffer.from(
          `${canonicalize({
            ...signature,
            signature: `${signature.signature}!!!!`,
          })}\n`,
        ),
      };
    });
    expect(
      verifyEvidenceBundle(createZipArchive(changed), keyResolver),
    ).toMatchObject({ valid: false, reason: "MANIFEST_INVALID" });
  });

  it("rejects non-canonical ZIP creator and external attribute metadata", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: { kind: "unavailable" },
      signer,
    });
    const changed = Buffer.from(archive);
    const endOffset = changed.length - 22;
    const centralOffset = changed.readUInt32LE(endOffset + 16);
    changed.writeUInt16LE((3 << 8) | 20, centralOffset + 4);
    changed.writeUInt32LE((0xa000 << 16) >>> 0, centralOffset + 38);
    expect(verifyEvidenceBundle(changed, keyResolver)).toMatchObject({
      valid: false,
      reason: "INVALID_ARCHIVE",
    });
  });

  it("rejects traversal, duplicate paths, and oversized archives", () => {
    const archive = createEvidenceBundle({
      receipt,
      rawLogs: { kind: "unavailable" },
      signer,
    });
    const traversal = replaceAscii(archive, "report.json", "../evil.txt");
    expect(verifyEvidenceBundle(traversal, keyResolver)).toMatchObject({
      valid: false,
      reason: "UNSAFE_ARCHIVE_PATH",
    });

    const duplicateSource = createZipArchive([
      { path: "first.txt", data: Buffer.from("first") },
      { path: "other.txt", data: Buffer.from("other") },
    ]);
    const duplicate = replaceAscii(
      duplicateSource,
      "other.txt",
      "first.txt",
    );
    expect(verifyEvidenceBundle(duplicate, keyResolver)).toMatchObject({
      valid: false,
      reason: "DUPLICATE_ARCHIVE_PATH",
    });

    expect(
      verifyEvidenceBundle(
        Buffer.alloc(MAX_EVIDENCE_BUNDLE_BYTES + 1),
        keyResolver,
      ),
    ).toMatchObject({
      valid: false,
      reason: "ARCHIVE_LIMIT_EXCEEDED",
    });
  });
});
