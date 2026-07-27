import {
  createHash,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { TextDecoder } from "node:util";
import { decodeHTML } from "entities";
import {
  CONTRACT_VERSION,
  EVIDENCE_BUNDLE_VERSION,
  EvidenceBundleManifestSchema,
  EvidenceBundleSignatureSchema,
  EvidenceBundleVerificationResponseSchema,
  SignedReceiptSchema,
  VerificationContractSchema,
  VerificationReportSchema,
  canonicalize,
  type EvidenceBundleManifest,
  type EvidenceBundleVerificationResponse,
  type SignedReceipt,
  type VerificationContract,
} from "@ever-guild/proof-runner-schema";
import {
  ReceiptService,
  ReceiptSigner,
  ReceiptStore,
  verifyReceipt,
  type RawLogState,
} from "@ever-guild/proof-runner-receipt";
import { RunStore } from "./store.js";

export const MAX_EVIDENCE_BUNDLE_BYTES = 4 * 1_048_576;
const MAX_EVIDENCE_BUNDLE_ENTRIES = 8;
const MAX_EVIDENCE_BUNDLE_ENTRY_BYTES = 1_048_576;
const MAX_REDACTED_LOG_BYTES = 512 * 1_024;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORED_METHOD = 0;
const ZIP_VERSION = 20;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = 0x0021;

type VerificationFailureReason = Exclude<
  EvidenceBundleVerificationResponse["reason"],
  null
>;

export type EvidenceBundleArchiveEntry = {
  path: string;
  data: Buffer;
};

class EvidenceArchiveError extends Error {
  constructor(readonly reason: VerificationFailureReason) {
    super(reason);
    this.name = "EvidenceArchiveError";
  }
}

export class EvidenceBundleLimitError extends Error {
  constructor() {
    super("Evidence bundle exceeds its bounded archive limits.");
    this.name = "EvidenceBundleLimitError";
  }
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0
      ? 0xedb88320 ^ (value >>> 1)
      : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (data: Buffer): number => {
  let value = 0xffffffff;
  for (const byte of data) {
    value = (crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8)) >>> 0;
  }
  return (value ^ 0xffffffff) >>> 0;
};

const safeArchivePath = (path: string): boolean => {
  if (
    path.length === 0 ||
    path.length > 128 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment),
  );
};

const assertEntryInput = (
  entries: readonly EvidenceBundleArchiveEntry[],
): void => {
  if (
    entries.length === 0 ||
    entries.length > MAX_EVIDENCE_BUNDLE_ENTRIES
  ) {
    throw new EvidenceBundleLimitError();
  }
  const paths = new Set<string>();
  for (const entry of entries) {
    if (!safeArchivePath(entry.path)) {
      throw new EvidenceArchiveError("UNSAFE_ARCHIVE_PATH");
    }
    if (paths.has(entry.path)) {
      throw new EvidenceArchiveError("DUPLICATE_ARCHIVE_PATH");
    }
    paths.add(entry.path);
    if (entry.data.length > MAX_EVIDENCE_BUNDLE_ENTRY_BYTES) {
      throw new EvidenceBundleLimitError();
    }
  }
};

/**
 * Minimal deterministic ZIP writer. Entries are stored without compression,
 * use a fixed 1980 timestamp, carry no extras/comments, and retain caller
 * order. Those constraints also keep verification bounded and auditable.
 */
export const createZipArchive = (
  entries: readonly EvidenceBundleArchiveEntry[],
): Buffer => {
  assertEntryInput(entries);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, "utf8");
    const checksum = crc32(entry.data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(ZIP_VERSION, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_STORED_METHOD, 8);
    localHeader.writeUInt16LE(ZIP_DOS_TIME, 10);
    localHeader.writeUInt16LE(ZIP_DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(entry.data.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, entry.data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(ZIP_VERSION, 4);
    centralHeader.writeUInt16LE(ZIP_VERSION, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_STORED_METHOD, 10);
    centralHeader.writeUInt16LE(ZIP_DOS_TIME, 12);
    centralHeader.writeUInt16LE(ZIP_DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(entry.data.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + entry.data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...localParts, central, end]);
  if (archive.length > MAX_EVIDENCE_BUNDLE_BYTES) {
    throw new EvidenceBundleLimitError();
  }
  return archive;
};

const requireRange = (
  archive: Buffer,
  offset: number,
  length: number,
): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > archive.length
  ) {
    throw new EvidenceArchiveError("INVALID_ARCHIVE");
  }
};

const decodeEntryName = (bytes: Buffer): string => {
  try {
    const path = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!safeArchivePath(path)) {
      throw new EvidenceArchiveError("UNSAFE_ARCHIVE_PATH");
    }
    return path;
  } catch (error) {
    if (error instanceof EvidenceArchiveError) throw error;
    throw new EvidenceArchiveError("UNSAFE_ARCHIVE_PATH");
  }
};

/**
 * Strict bounded ZIP parser. It rejects compressed/encrypted entries,
 * descriptors, comments, extras, hidden bytes, duplicate names, traversal,
 * CRC mismatches, and non-deterministic timestamps.
 */
export const parseEvidenceBundleArchive = (
  archive: Buffer,
): EvidenceBundleArchiveEntry[] => {
  if (archive.length > MAX_EVIDENCE_BUNDLE_BYTES) {
    throw new EvidenceArchiveError("ARCHIVE_LIMIT_EXCEEDED");
  }
  if (archive.length < 22) {
    throw new EvidenceArchiveError("INVALID_ARCHIVE");
  }
  const endOffset = archive.length - 22;
  if (archive.readUInt32LE(endOffset) !== 0x06054b50) {
    throw new EvidenceArchiveError("INVALID_ARCHIVE");
  }
  if (
    archive.readUInt16LE(endOffset + 4) !== 0 ||
    archive.readUInt16LE(endOffset + 6) !== 0 ||
    archive.readUInt16LE(endOffset + 20) !== 0
  ) {
    throw new EvidenceArchiveError("INVALID_ARCHIVE");
  }
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  if (
    entryCount === 0 ||
    entryCount !== entriesOnDisk ||
    entryCount > MAX_EVIDENCE_BUNDLE_ENTRIES ||
    centralOffset + centralSize !== endOffset
  ) {
    throw new EvidenceArchiveError(
      entryCount > MAX_EVIDENCE_BUNDLE_ENTRIES
        ? "ARCHIVE_LIMIT_EXCEEDED"
        : "INVALID_ARCHIVE",
    );
  }
  requireRange(archive, centralOffset, centralSize);

  const entries: EvidenceBundleArchiveEntry[] = [];
  const seen = new Set<string>();
  let centralCursor = centralOffset;
  let expectedLocalOffset = 0;

  for (let index = 0; index < entryCount; index += 1) {
    requireRange(archive, centralCursor, 46);
    if (archive.readUInt32LE(centralCursor) !== 0x02014b50) {
      throw new EvidenceArchiveError("INVALID_ARCHIVE");
    }
    const versionMadeBy = archive.readUInt16LE(centralCursor + 4);
    const versionNeeded = archive.readUInt16LE(centralCursor + 6);
    const flags = archive.readUInt16LE(centralCursor + 8);
    const method = archive.readUInt16LE(centralCursor + 10);
    const dosTime = archive.readUInt16LE(centralCursor + 12);
    const dosDate = archive.readUInt16LE(centralCursor + 14);
    const expectedCrc = archive.readUInt32LE(centralCursor + 16);
    const compressedSize = archive.readUInt32LE(centralCursor + 20);
    const uncompressedSize = archive.readUInt32LE(centralCursor + 24);
    const nameLength = archive.readUInt16LE(centralCursor + 28);
    const extraLength = archive.readUInt16LE(centralCursor + 30);
    const commentLength = archive.readUInt16LE(centralCursor + 32);
    const disk = archive.readUInt16LE(centralCursor + 34);
    const internalAttributes = archive.readUInt16LE(centralCursor + 36);
    const externalAttributes = archive.readUInt32LE(centralCursor + 38);
    const localOffset = archive.readUInt32LE(centralCursor + 42);
    if (
      versionMadeBy !== ZIP_VERSION ||
      versionNeeded !== ZIP_VERSION ||
      flags !== ZIP_UTF8_FLAG ||
      method !== ZIP_STORED_METHOD ||
      dosTime !== ZIP_DOS_TIME ||
      dosDate !== ZIP_DOS_DATE ||
      compressedSize !== uncompressedSize ||
      uncompressedSize > MAX_EVIDENCE_BUNDLE_ENTRY_BYTES ||
      nameLength === 0 ||
      extraLength !== 0 ||
      commentLength !== 0 ||
      disk !== 0 ||
      internalAttributes !== 0 ||
      externalAttributes !== 0 ||
      localOffset !== expectedLocalOffset
    ) {
      throw new EvidenceArchiveError(
        uncompressedSize > MAX_EVIDENCE_BUNDLE_ENTRY_BYTES
          ? "ARCHIVE_LIMIT_EXCEEDED"
          : "INVALID_ARCHIVE",
      );
    }
    requireRange(archive, centralCursor + 46, nameLength);
    const centralNameBytes = archive.subarray(
      centralCursor + 46,
      centralCursor + 46 + nameLength,
    );
    const path = decodeEntryName(centralNameBytes);
    if (seen.has(path)) {
      throw new EvidenceArchiveError("DUPLICATE_ARCHIVE_PATH");
    }
    seen.add(path);

    requireRange(archive, localOffset, 30);
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new EvidenceArchiveError("INVALID_ARCHIVE");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    if (
      archive.readUInt16LE(localOffset + 4) !== ZIP_VERSION ||
      archive.readUInt16LE(localOffset + 6) !== flags ||
      archive.readUInt16LE(localOffset + 8) !== method ||
      archive.readUInt16LE(localOffset + 10) !== dosTime ||
      archive.readUInt16LE(localOffset + 12) !== dosDate ||
      archive.readUInt32LE(localOffset + 14) !== expectedCrc ||
      archive.readUInt32LE(localOffset + 18) !== compressedSize ||
      archive.readUInt32LE(localOffset + 22) !== uncompressedSize ||
      localNameLength !== nameLength ||
      localExtraLength !== 0
    ) {
      throw new EvidenceArchiveError("INVALID_ARCHIVE");
    }
    requireRange(archive, localOffset + 30, localNameLength);
    const localNameBytes = archive.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLength,
    );
    if (!localNameBytes.equals(centralNameBytes)) {
      throw new EvidenceArchiveError("INVALID_ARCHIVE");
    }
    const dataOffset = localOffset + 30 + localNameLength;
    requireRange(archive, dataOffset, uncompressedSize);
    const data = Buffer.from(
      archive.subarray(dataOffset, dataOffset + uncompressedSize),
    );
    if (crc32(data) !== expectedCrc) {
      throw new EvidenceArchiveError("INVALID_ARCHIVE");
    }
    expectedLocalOffset = dataOffset + uncompressedSize;
    centralCursor += 46 + nameLength;
    entries.push({ path, data });
  }

  if (
    expectedLocalOffset !== centralOffset ||
    centralCursor !== endOffset
  ) {
    throw new EvidenceArchiveError("INVALID_ARCHIVE");
  }
  return entries;
};

const sha256 = (data: Buffer | string): string =>
  createHash("sha256").update(data).digest("hex");

const canonicalJson = (value: unknown): Buffer =>
  Buffer.from(`${canonicalize(value)}\n`, "utf8");

const credentialCorePattern = [
  "password",
  "passwd",
  "pwd",
  "(?:access|refresh|session|id)[_-]?token",
  "token",
  "secret",
  "api[_-]?key",
  "private[_-]?key",
  "ssh[_-]?key",
  "signing[_-]?key",
  "(?:aws[_-]?)?access[_-]?key(?:[_-]?id)?",
  "(?:aws[_-]?)?secret[_-]?access[_-]?key",
  "client[_-]?secret",
  "credentials?",
  "authorization",
  "auth",
  "database[_-]?url",
  "connection[_-]?string",
  "cookie",
].join("|");

const credentialKeyPattern =
  `(?:[A-Za-z0-9]+[_-])*(?:${credentialCorePattern})`;

const credentialOptionNamePattern = `-{1,2}(?:${credentialKeyPattern})`;

const credentialAssignmentNamePattern =
  `(?:"(?:${credentialKeyPattern})"|'(?:${credentialKeyPattern})'|` +
  `${credentialOptionNamePattern}|` +
  `(?<![A-Za-z0-9_-])(?:${credentialKeyPattern}))`;

const credentialAssignmentPattern = new RegExp(
  `((${credentialAssignmentNamePattern})\\s*[=:])\\s*` +
    `(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|` +
    `(?![\\x5b{])[^\\s,;{}]+)`,
  "gi",
);

const credentialAssignmentStartPattern = new RegExp(
  `(?:${credentialAssignmentNamePattern})\\s*[=:]\\s*`,
  "gim",
);

const unquotedCredentialLinePattern = new RegExp(
  `((${credentialAssignmentNamePattern})\\s*[=:])\\s*` +
    `(?!["'\\x5b{])[^\\r\\n]*`,
  "gim",
);

const whitespaceCredentialOptionPattern = new RegExp(
  `((${credentialOptionNamePattern})\\s+)[^\\r\\n]*`,
  "gim",
);

const credentialLineContinuationPattern = new RegExp(
  `(?:(?:${credentialAssignmentNamePattern})\\s*[=:]\\s*|` +
    `(?:${credentialOptionNamePattern})\\s+)[^\\r\\n]*\\\\\\r?\\n`,
  "im",
);

const credentialBlockScalarPattern = new RegExp(
  `(?:${credentialAssignmentNamePattern})\\s*:\\s*[|>][+-]?` +
    `[^\\r\\n]*\\r?\\n`,
  "im",
);

const nonCanonicalCredentialPrefixPattern = new RegExp(
  `[|\\x28\\x5b{]\\s*(?:${credentialAssignmentNamePattern})\\s*[=:]`,
  "i",
);

const unresolvedCredentialPattern = new RegExp(
  `(?:${credentialAssignmentNamePattern})\\s*[=:]` +
    `(?!\\s*\\[REDACTED\\])`,
  "i",
);

const unsafeRedactedCredentialTailPattern = new RegExp(
  `(?:${credentialAssignmentNamePattern})\\s*[=:]\\s*` +
    `\\[REDACTED\\](?:[^\\s;\\x29\\x5d\\x7d\\r\\n]|\\s+\\S)`,
  "i",
);

const unsafeRedactedCredentialCloserTailPattern = new RegExp(
  `(?:${credentialAssignmentNamePattern})\\s*[=:]\\s*` +
    `\\[REDACTED\\][\\x29\\x5d\\x7d]+` +
    `(?:[^\\s;\\x29\\x5d\\x7d\\r\\n]|\\s+\\S)`,
  "i",
);

const credentialKeyNamePattern = new RegExp(
  `^(?:${credentialKeyPattern})$`,
  "i",
);

const credentialMentionPattern = new RegExp(
  `(?<![A-Za-z0-9_-])(?:${credentialKeyPattern})(?![A-Za-z0-9_-])`,
  "i",
);

const compactCredentialNames = [
  "password",
  "passwd",
  "pwd",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "idtoken",
  "token",
  "secret",
  "apikey",
  "privatekey",
  "sshkey",
  "signingkey",
  "accesskey",
  "accesskeyid",
  "secretaccesskey",
  "clientsecret",
  "credential",
  "credentials",
  "authorization",
  "auth",
  "databaseurl",
  "connectionstring",
  "cookie",
] as const;

const maxCompactCredentialNameLength = Math.max(
  ...compactCredentialNames.map((name) => name.length),
);

const safelyRedactedCredentialReferencePattern = new RegExp(
  `(?:(?:${credentialAssignmentNamePattern})\\s*[=:]|` +
    `(?:${credentialOptionNamePattern})\\s+)\\s*\\[REDACTED\\]`,
  "gi",
);

const encodedKeyEscapePatternGlobal =
  /\\(?:u(?:([0-9a-fA-F]{4})|\{([0-9a-fA-F]{1,6})\})|x([0-9a-fA-F]{2})|([0-7]{1,3}))|&#(?:x(0*[0-9a-fA-F]{1,6})(?![0-9a-fA-F])|(0*[0-9]{1,7})(?![0-9]));?/gi;

const percentEscapeRunPatternGlobal = /(?:%[0-9a-fA-F]{2})+/g;

const cssEscapePatternGlobal =
  /\\([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?/g;

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

const knownTokenPattern =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|npm_[A-Za-z0-9]{20,}|glpat-[A-Za-z0-9_-]{20,})\b/g;

const privateKeyMaterialPattern =
  /-----BEGIN [^\r\n]*PRIVATE[^\r\n]*KEY[^\r\n]*-----/i;

const htmlLegacyReferenceNames = [
  "aacute",
  "acirc",
  "acute",
  "aelig",
  "agrave",
  "amp",
  "aring",
  "atilde",
  "auml",
  "brvbar",
  "ccedil",
  "cedil",
  "cent",
  "copy",
  "curren",
  "deg",
  "divide",
  "eacute",
  "ecirc",
  "egrave",
  "eth",
  "euml",
  "frac12",
  "frac14",
  "frac34",
  "gt",
  "iacute",
  "icirc",
  "iexcl",
  "igrave",
  "iquest",
  "iuml",
  "laquo",
  "lt",
  "macr",
  "micro",
  "middot",
  "nbsp",
  "not",
  "ntilde",
  "oacute",
  "ocirc",
  "ograve",
  "ordf",
  "ordm",
  "oslash",
  "otilde",
  "ouml",
  "para",
  "plusmn",
  "pound",
  "quot",
  "raquo",
  "reg",
  "sect",
  "shy",
  "sup1",
  "sup2",
  "sup3",
  "szlig",
  "thorn",
  "times",
  "uacute",
  "ucirc",
  "ugrave",
  "uml",
  "uuml",
  "yacute",
  "yen",
  "yuml",
] as const;
const htmlLegacyReferencePatternGlobal = new RegExp(
  `&(${htmlLegacyReferenceNames.join("|")});?`,
  "gi",
);
const htmlNamedReferencePatternGlobal =
  /&([A-Za-z][A-Za-z0-9]{1,31});/g;
const htmlNumericReferencePrefixPatternGlobal =
  /&#(?:x[0-9a-fA-F]+|[0-9]+)/gi;
const htmlEntityWildcard = "\u0001";

const decodePercentEscapes = (
  token: string,
): { decoded: string; invalid: boolean } => {
  let decoded = token;
  let invalid = false;
  for (let pass = 0; pass < 32; pass += 1) {
    percentEscapeRunPatternGlobal.lastIndex = 0;
    let changed = false;
    decoded = decoded.replace(
      percentEscapeRunPatternGlobal,
      (escapeRun) => {
        const bytes = new Uint8Array(
          escapeRun
            .split("%")
            .slice(1)
            .map((hexadecimal) => Number.parseInt(hexadecimal, 16)),
        );
        changed = true;
        try {
          return strictUtf8Decoder.decode(bytes);
        } catch {
          invalid = true;
          return "\\";
        }
      },
    );
    if (!changed) break;
  }
  percentEscapeRunPatternGlobal.lastIndex = 0;
  if (percentEscapeRunPatternGlobal.test(decoded)) invalid = true;
  return { decoded, invalid };
};

const decodeCredentialEscapes = (
  token: string,
): { decoded: string; invalid: boolean } => {
  let invalid = false;
  encodedKeyEscapePatternGlobal.lastIndex = 0;
  const decoded = token.replace(
    encodedKeyEscapePatternGlobal,
    (
      _escape,
      fixed: string,
      braced: string,
      hexadecimal: string,
      octal: string,
      htmlHexadecimal: string,
      htmlDecimal: string,
    ) => {
      const digits =
        fixed ??
        braced ??
        hexadecimal ??
        octal ??
        htmlHexadecimal ??
        htmlDecimal;
      const radix =
        htmlDecimal !== undefined
          ? 10
          : octal !== undefined
            ? 8
            : 16;
      const codePoint = Number.parseInt(digits, radix);
      if (codePoint > 0x10ffff) {
        invalid = true;
        return "\\";
      }
      return String.fromCodePoint(codePoint);
    },
  );
  return { decoded, invalid };
};

const decodeCssEscapes = (
  token: string,
): { decoded: string; invalid: boolean } => {
  let invalid = false;
  cssEscapePatternGlobal.lastIndex = 0;
  const decoded = token.replace(
    cssEscapePatternGlobal,
    (_escape, hexadecimal: string) => {
      const codePoint = Number.parseInt(hexadecimal, 16);
      if (codePoint === 0 || codePoint > 0x10ffff) {
        invalid = true;
        return "\\";
      }
      return String.fromCodePoint(codePoint);
    },
  );
  return { decoded, invalid };
};

const markHtmlLegacyReferences = (content: string): string => {
  htmlLegacyReferencePatternGlobal.lastIndex = 0;
  return content.replace(
    htmlLegacyReferencePatternGlobal,
    htmlEntityWildcard,
  );
};

const markHtmlNamedReferences = (content: string): string => {
  htmlNamedReferencePatternGlobal.lastIndex = 0;
  return content.replace(
    htmlNamedReferencePatternGlobal,
    htmlEntityWildcard,
  );
};

const markHtmlNumericReferencePrefixes = (content: string): string => {
  htmlNumericReferencePrefixPatternGlobal.lastIndex = 0;
  return content.replace(
    htmlNumericReferencePrefixPatternGlobal,
    htmlEntityWildcard,
  );
};

const decodeCredentialCandidateClosure = (
  content: string,
): { candidates: string[]; invalid: boolean } => {
  const candidates = [content];
  const seen = new Set(candidates);
  for (let cursor = 0; cursor < candidates.length; cursor += 1) {
    const candidate = candidates[cursor]!;
    const credentialDecoded = decodeCredentialEscapes(candidate);
    const percentDecoded = decodePercentEscapes(candidate);
    const cssDecoded = decodeCssEscapes(candidate);
    if (
      credentialDecoded.invalid ||
      percentDecoded.invalid ||
      cssDecoded.invalid
    ) {
      return { candidates, invalid: true };
    }
    const transformed = [
      credentialDecoded.decoded,
      percentDecoded.decoded,
      cssDecoded.decoded,
      decodeHTML(candidate),
      markHtmlLegacyReferences(candidate),
      markHtmlNamedReferences(candidate),
      markHtmlNumericReferencePrefixes(candidate),
      candidate.replace(/\\\r?\n/g, ""),
      candidate.normalize("NFKC").replace(/\p{Cf}/gu, ""),
    ];
    for (const next of transformed) {
      if (seen.has(next)) continue;
      if (seen.size >= 64) return { candidates, invalid: true };
      seen.add(next);
      candidates.push(next);
    }
  }
  return { candidates, invalid: false };
};

const hasUnsafeCredentialQuote = (content: string): boolean => {
  credentialAssignmentStartPattern.lastIndex = 0;
  for (const match of content.matchAll(credentialAssignmentStartPattern)) {
    const valueStart = (match.index ?? 0) + match[0].length;
    const quote = content[valueStart];
    if (quote !== '"' && quote !== "'") continue;
    let escaped = false;
    let terminated = false;
    for (let index = valueStart + 1; index < content.length; index += 1) {
      const character = content[index]!;
      if (character === quote && !escaped) {
        terminated = true;
        const next = content[index + 1];
        if (
          next !== undefined &&
          !/[\s;\x29\x5d\x7d]/.test(next)
        ) {
          return true;
        }
        break;
      }
      escaped = character === "\\" ? !escaped : false;
    }
    if (!terminated) return true;
  }
  return false;
};

const redactStructuredJsonCredentials = (content: string): string => {
  let changed = false;
  try {
    const parsed: unknown = JSON.parse(
      content,
      (key: string, value: unknown): unknown => {
        if (credentialKeyNamePattern.test(key)) {
          changed = true;
          return "[REDACTED]";
        }
        return value;
      },
    );
    const serialized = JSON.stringify(parsed);
    return changed && serialized !== undefined ? serialized : content;
  } catch {
    return content;
  }
};

const hasUnsafeStructuredCredentialValue = (content: string): boolean => {
  let unsafe = false;
  try {
    JSON.parse(content, (key: string, value: unknown): unknown => {
      if (
        credentialKeyNamePattern.test(key) &&
        value !== null &&
        typeof value === "object"
      ) {
        unsafe = true;
      }
      return value;
    });
  } catch {
    return false;
  }
  return unsafe;
};

const compactSuffixCouldMatchCredential = (
  compact: string,
  credential: string,
): boolean => {
  const memo = new Map<string, boolean>();
  const matches = (compactIndex: number, credentialIndex: number): boolean => {
    if (credentialIndex < 0) return true;
    if (compactIndex < 0) return false;
    const key = `${compactIndex}:${credentialIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const candidate = compact[compactIndex]!;
    const result =
      candidate === "?"
        ? matches(compactIndex - 1, credentialIndex) ||
          matches(compactIndex - 1, credentialIndex - 1)
        : candidate === credential[credentialIndex] &&
          matches(compactIndex - 1, credentialIndex - 1);
    memo.set(key, result);
    return result;
  };
  return matches(compact.length - 1, credential.length - 1);
};

const hasCompactCredentialAssignment = (content: string): boolean => {
  let compact = "";
  let hadSoftSeparator = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index]!;
    const code = content.charCodeAt(index);
    const isAsciiAlphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (character === htmlEntityWildcard) {
      if (compact.length >= 64) {
        compact = compact.slice(-(maxCompactCredentialNameLength - 1));
      }
      compact += "?";
      hadSoftSeparator = true;
      continue;
    }
    if (isAsciiAlphaNumeric) {
      if (compact.length >= 64) {
        compact = compact.slice(-(maxCompactCredentialNameLength - 1));
      }
      compact += character.toLowerCase();
      continue;
    }
    if (character === "=" || character === ":") {
      if (
        hadSoftSeparator &&
        compactCredentialNames.some((name) =>
          compact.includes("?")
            ? compactSuffixCouldMatchCredential(compact, name)
            : compact.endsWith(name),
        )
      ) {
        return true;
      }
      compact = "";
      hadSoftSeparator = false;
      continue;
    }
    if (
      character === "\r" ||
      character === "\n" ||
      character === ";" ||
      character === "," ||
      character === "|" ||
      character === "?" ||
      character === "&"
    ) {
      compact = "";
      hadSoftSeparator = false;
      continue;
    }
    if (compact.length > 0) hadSoftSeparator = true;
  }
  return false;
};

const hasUnsafeCredentialMention = (content: string): boolean => {
  safelyRedactedCredentialReferencePattern.lastIndex = 0;
  const residual = content.replace(
    safelyRedactedCredentialReferencePattern,
    "",
  );
  const closure = decodeCredentialCandidateClosure(residual);
  if (closure.invalid) return true;
  for (const candidate of closure.candidates) {
    const normalized = candidate
      .normalize("NFKC")
      .replace(/\p{Cf}/gu, "");
    if (
      privateKeyMaterialPattern.test(candidate) ||
      hasUnsafeStructuredCredentialValue(candidate) ||
      hasUnsafeCredentialQuote(candidate) ||
      credentialLineContinuationPattern.test(candidate) ||
      credentialBlockScalarPattern.test(candidate) ||
      nonCanonicalCredentialPrefixPattern.test(candidate) ||
      redactRawLog(candidate) !== candidate ||
      credentialMentionPattern.test(normalized) ||
      hasCompactCredentialAssignment(normalized)
    ) {
      return true;
    }
  }
  return false;
};

export const redactRawLog = (content: string): string => {
  knownTokenPattern.lastIndex = 0;
  credentialAssignmentPattern.lastIndex = 0;
  unquotedCredentialLinePattern.lastIndex = 0;
  whitespaceCredentialOptionPattern.lastIndex = 0;
  return redactStructuredJsonCredentials(content)
    .replace(
      /\b((?:proxy-)?authorization\s*:\s*)(?:basic|bearer|digest|token)\s+[^\s,;]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
      "Bearer [REDACTED]",
    )
    .replace(
      knownTokenPattern,
      "[REDACTED]",
    )
    .replace(
      /((?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/)[^/\s:@]*:[^/\s@]+@/g,
      "$1[REDACTED]@",
    )
    .replace(whitespaceCredentialOptionPattern, "$1[REDACTED]")
    .replace(unquotedCredentialLinePattern, "$1[REDACTED]")
    .replace(credentialAssignmentPattern, "$1[REDACTED]");
};

const safelyRedactedRawLog = (content: string): string | null => {
  const unsafeStructuredCredential =
    hasUnsafeStructuredCredentialValue(content);
  const unsafeCredentialMaterial =
    privateKeyMaterialPattern.test(content) ||
    hasUnsafeCredentialQuote(content) ||
    credentialLineContinuationPattern.test(content) ||
    credentialBlockScalarPattern.test(content) ||
    nonCanonicalCredentialPrefixPattern.test(content);
  const redacted = redactRawLog(content);
  const unresolvedAuthorization =
    /\b(?:proxy-)?authorization\s*:(?!\s*\[REDACTED\])/i;
  knownTokenPattern.lastIndex = 0;
  return unsafeStructuredCredential ||
    unsafeCredentialMaterial ||
    unresolvedCredentialPattern.test(redacted) ||
    unresolvedAuthorization.test(redacted) ||
    unsafeRedactedCredentialTailPattern.test(redacted) ||
    unsafeRedactedCredentialCloserTailPattern.test(redacted) ||
    hasUnsafeCredentialMention(redacted) ||
    knownTokenPattern.test(redacted)
    ? null
    : redacted;
};

const contractMatchesReceipt = (
  contract: VerificationContract,
  receipt: SignedReceipt,
): boolean => {
  const report = receipt.payload.report;
  return (
    contract.subject.repositoryUrl === report.repositoryUrl &&
    contract.subject.resolvedCommitSha === report.resolvedCommitSha &&
    contract.subject.skillHash === report.skill.hash &&
    contract.subject.runtimeImageDigest === report.runtimeImageDigest
  );
};

type PayloadFile = {
  path: string;
  data: Buffer;
  manifest: EvidenceBundleManifest["files"][number];
};

const payloadFile = (
  input:
    | {
        path: "receipt.json";
        role: "RECEIPT";
        mediaType: "application/json";
        data: Buffer;
      }
    | {
        path: "report.json";
        role: "REPORT";
        mediaType: "application/json";
        data: Buffer;
      }
    | {
        path: "verification-contract.json";
        role: "VERIFICATION_CONTRACT";
        mediaType: "application/json";
        data: Buffer;
      }
    | {
        path: "logs/raw.ndjson";
        role: "RAW_LOGS";
        mediaType: "application/x-ndjson";
        redactionProfile: "proofrunner-secrets-v1";
        data: Buffer;
      },
): PayloadFile => ({
  path: input.path,
  data: input.data,
  manifest: {
    path: input.path,
    role: input.role,
    mediaType: input.mediaType,
    sha256: sha256(input.data),
    bytes: input.data.length,
    ...("redactionProfile" in input
      ? { redactionProfile: input.redactionProfile }
      : {}),
  } as EvidenceBundleManifest["files"][number],
});

export const createEvidenceBundle = (input: {
  receipt: SignedReceipt;
  verificationContract?: VerificationContract;
  rawLogs: RawLogState;
  signer: ReceiptSigner;
}): Buffer => {
  const receipt = SignedReceiptSchema.parse(input.receipt);
  if (
    receipt.keyId !== input.signer.config.keyId ||
    !verifyReceipt(receipt, [
      {
        keyId: input.signer.config.keyId,
        publicKeyPem: input.signer.publicKeyPem,
      },
    ]).valid
  ) {
    throw new Error("The receipt key is not available for bundle signing");
  }
  const verificationContract = input.verificationContract
    ? VerificationContractSchema.parse(input.verificationContract)
    : null;
  if (
    verificationContract &&
    !contractMatchesReceipt(verificationContract, receipt)
  ) {
    throw new Error("Verification contract does not match the signed receipt");
  }

  const files: PayloadFile[] = [
    payloadFile({
      path: "receipt.json",
      role: "RECEIPT",
      mediaType: "application/json",
      data: canonicalJson(receipt),
    }),
    payloadFile({
      path: "report.json",
      role: "REPORT",
      mediaType: "application/json",
      data: canonicalJson(receipt.payload.report),
    }),
  ];
  if (verificationContract) {
    files.push(
      payloadFile({
        path: "verification-contract.json",
        role: "VERIFICATION_CONTRACT",
        mediaType: "application/json",
        data: canonicalJson(verificationContract),
      }),
    );
  }

  const omissions: EvidenceBundleManifest["omissions"] = [];
  if (input.rawLogs.kind === "retained" && input.rawLogs.logs.length > 0) {
    const ordered = [...input.rawLogs.logs].sort(
      (left, right) => left.sequence - right.sequence,
    );
    if (
      new Set(ordered.map((log) => log.sequence)).size !== ordered.length
    ) {
      throw new Error("Raw-log sequences must be unique");
    }
    const redacted = ordered.map((log) => safelyRedactedRawLog(log.content));
    if (redacted.some((content) => content === null)) {
      omissions.push({
        path: "logs/raw.ndjson",
        reason: "RAW_LOG_REDACTION_UNSAFE",
      });
    } else {
      const lines = ordered.map((log, index) =>
        canonicalize({
          sequence: log.sequence,
          stream: log.stream,
          content: redacted[index],
          createdAt: log.createdAt,
          expiresAt: log.expiresAt,
        }),
      );
      const data = Buffer.from(`${lines.join("\n")}\n`, "utf8");
      if (data.length > MAX_REDACTED_LOG_BYTES) {
        throw new EvidenceBundleLimitError();
      }
      files.push(
        payloadFile({
          path: "logs/raw.ndjson",
          role: "RAW_LOGS",
          mediaType: "application/x-ndjson",
          redactionProfile: "proofrunner-secrets-v1",
          data,
        }),
      );
    }
  } else {
    omissions.push({
      path: "logs/raw.ndjson",
      reason:
        input.rawLogs.kind === "expired"
          ? "RAW_LOG_EXPIRED"
          : "RAW_LOG_UNAVAILABLE",
    });
  }

  const manifest = EvidenceBundleManifestSchema.parse({
    bundleVersion: EVIDENCE_BUNDLE_VERSION,
    contractVersion: CONTRACT_VERSION,
    receipt: {
      id: receipt.payload.id,
      payloadHash: receipt.payloadHash,
      keyId: receipt.keyId,
    },
    createdAt: receipt.payload.createdAt,
    files: files.map((file) => file.manifest),
    omissions,
    metadata: {
      manifestPath: "bundle-manifest.json",
      signaturePath: "bundle-manifest.sig",
      checksumsPath: "checksums.txt",
      digestExclusions: [
        "bundle-manifest.json",
        "bundle-manifest.sig",
        "checksums.txt",
      ],
    },
  });
  const canonicalManifest = canonicalize(manifest);
  const manifestHash = sha256(canonicalManifest);
  const manifestSignature = EvidenceBundleSignatureSchema.parse({
    bundleVersion: EVIDENCE_BUNDLE_VERSION,
    keyId: receipt.keyId,
    canonicalization: "JCS-RFC8785",
    hashAlgorithm: "SHA-256",
    manifestHash,
    signatureAlgorithm: "Ed25519",
    signature: sign(
      null,
      Buffer.from(canonicalManifest),
      input.signer.privateKey,
    ).toString("base64"),
  });
  const manifestData = canonicalJson(manifest);
  const signatureData = canonicalJson(manifestSignature);
  const checksums = Buffer.from(
    `${[
      ...manifest.files.map((file) => ({
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
  );

  return createZipArchive([
    ...files.map(({ path, data }) => ({ path, data })),
    { path: "bundle-manifest.json", data: manifestData },
    { path: "bundle-manifest.sig", data: signatureData },
    { path: "checksums.txt", data: checksums },
  ]);
};

const invalid = (
  reason: VerificationFailureReason,
): EvidenceBundleVerificationResponse =>
  EvidenceBundleVerificationResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    valid: false,
    reason,
    bundleId: null,
  });

const parseCanonicalJson = <T>(
  data: Buffer,
  schema: { parse(value: unknown): T },
): T => {
  const parsed = schema.parse(JSON.parse(data.toString("utf8")));
  if (!data.equals(canonicalJson(parsed))) {
    throw new Error("JSON entry is not canonical");
  }
  return parsed;
};

const decodeEd25519Signature = (value: string): Buffer | null => {
  if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 64 && decoded.toString("base64") === value
    ? decoded
    : null;
};

export const verifyEvidenceBundle = (
  archive: Buffer,
  resolvePublicKey: (keyId: string) => string | null,
): EvidenceBundleVerificationResponse => {
  let entries: EvidenceBundleArchiveEntry[];
  try {
    entries = parseEvidenceBundleArchive(archive);
  } catch (error) {
    if (error instanceof EvidenceArchiveError) return invalid(error.reason);
    if (error instanceof EvidenceBundleLimitError) {
      return invalid("ARCHIVE_LIMIT_EXCEEDED");
    }
    return invalid("INVALID_ARCHIVE");
  }
  const files = new Map(entries.map((entry) => [entry.path, entry.data]));

  let manifest: EvidenceBundleManifest;
  let manifestSignature: ReturnType<
    typeof EvidenceBundleSignatureSchema.parse
  >;
  try {
    const manifestData = files.get("bundle-manifest.json");
    const signatureData = files.get("bundle-manifest.sig");
    const checksumsData = files.get("checksums.txt");
    if (!manifestData || !signatureData || !checksumsData) {
      return invalid("MANIFEST_INVALID");
    }
    manifest = parseCanonicalJson(
      manifestData,
      EvidenceBundleManifestSchema,
    );
    manifestSignature = parseCanonicalJson(
      signatureData,
      EvidenceBundleSignatureSchema,
    );
  } catch {
    return invalid("MANIFEST_INVALID");
  }

  const expectedPaths = [
    ...manifest.files.map((file) => file.path),
    "bundle-manifest.json",
    "bundle-manifest.sig",
    "checksums.txt",
  ];
  if (
    entries.length !== expectedPaths.length ||
    entries.some((entry, index) => entry.path !== expectedPaths[index])
  ) {
    return invalid("MANIFEST_COVERAGE_MISMATCH");
  }
  for (const file of manifest.files) {
    const data = files.get(file.path);
    if (
      !data ||
      data.length !== file.bytes ||
      sha256(data) !== file.sha256
    ) {
      return invalid("CHECKSUM_MISMATCH");
    }
  }
  const expectedChecksums = Buffer.from(
    `${[
      ...manifest.files.map((file) => ({
        path: file.path,
        sha256: file.sha256,
      })),
      {
        path: "bundle-manifest.json",
        sha256: sha256(files.get("bundle-manifest.json")!),
      },
      {
        path: "bundle-manifest.sig",
        sha256: sha256(files.get("bundle-manifest.sig")!),
      },
    ]
      .map((file) => `${file.sha256}  ${file.path}`)
      .join("\n")}\n`,
    "utf8",
  );
  if (!files.get("checksums.txt")!.equals(expectedChecksums)) {
    return invalid("CHECKSUM_MISMATCH");
  }

  const canonicalManifest = canonicalize(manifest);
  const manifestHash = sha256(canonicalManifest);
  if (
    manifestSignature.keyId !== manifest.receipt.keyId ||
    manifestSignature.manifestHash !== manifestHash
  ) {
    return invalid("INVALID_MANIFEST_SIGNATURE");
  }
  const publicKeyPem = resolvePublicKey(manifestSignature.keyId);
  if (!publicKeyPem) return invalid("UNKNOWN_KEY");
  const signature = decodeEd25519Signature(manifestSignature.signature);
  if (!signature) return invalid("INVALID_MANIFEST_SIGNATURE");
  try {
    if (
      !verify(
        null,
        Buffer.from(canonicalManifest),
        createPublicKey(publicKeyPem),
        signature,
      )
    ) {
      return invalid("INVALID_MANIFEST_SIGNATURE");
    }
  } catch {
    return invalid("INVALID_MANIFEST_SIGNATURE");
  }

  let receipt: SignedReceipt;
  try {
    receipt = parseCanonicalJson(files.get("receipt.json")!, SignedReceiptSchema);
  } catch {
    return invalid("INVALID_RECEIPT");
  }
  if (
    receipt.payload.id !== manifest.receipt.id ||
    receipt.payloadHash !== manifest.receipt.payloadHash ||
    receipt.keyId !== manifest.receipt.keyId ||
    receipt.payload.createdAt !== manifest.createdAt ||
    !verifyReceipt(receipt, [
      { keyId: receipt.keyId, publicKeyPem },
    ]).valid
  ) {
    return invalid("INVALID_RECEIPT");
  }

  try {
    const report = parseCanonicalJson(
      files.get("report.json")!,
      VerificationReportSchema,
    );
    if (canonicalize(report) !== canonicalize(receipt.payload.report)) {
      return invalid("RECEIPT_REPORT_MISMATCH");
    }
  } catch {
    return invalid("RECEIPT_REPORT_MISMATCH");
  }

  const contractData = files.get("verification-contract.json");
  if (contractData) {
    try {
      const contract = parseCanonicalJson(
        contractData,
        VerificationContractSchema,
      );
      if (!contractMatchesReceipt(contract, receipt)) {
        return invalid("CONTRACT_MISMATCH");
      }
    } catch {
      return invalid("CONTRACT_MISMATCH");
    }
  }

  const logsData = files.get("logs/raw.ndjson");
  if (logsData) {
    try {
      const text = logsData.toString("utf8");
      if (!text.endsWith("\n")) throw new Error("NDJSON must end in newline");
      for (const line of text.slice(0, -1).split("\n")) {
        const value = JSON.parse(line) as { content?: unknown };
        const safelyRedacted =
          typeof value.content === "string"
            ? safelyRedactedRawLog(value.content)
            : null;
        if (
          typeof value.content !== "string" ||
          safelyRedacted === null ||
          safelyRedacted !== value.content ||
          `${canonicalize(value)}\n` !== `${line}\n`
        ) {
          throw new Error("Raw log entry is not canonical and redacted");
        }
      }
    } catch {
      return invalid("MANIFEST_INVALID");
    }
  }

  return EvidenceBundleVerificationResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    valid: true,
    reason: null,
    bundleId: manifestHash,
  });
};

export class EvidenceBundleNotFoundError extends Error {
  constructor() {
    super("The requested signed receipt was not found.");
    this.name = "EvidenceBundleNotFoundError";
  }
}

/**
 * Joins trusted receipt storage, optional run contract metadata, retained logs,
 * and the receipt signing key without exposing those persistence details to
 * the HTTP layer.
 */
export class EvidenceBundleService {
  constructor(
    private readonly receipts: ReceiptService,
    private readonly receiptStore: ReceiptStore,
    private readonly runs: RunStore,
  ) {}

  create(receiptId: string, now = new Date().toISOString()): Buffer {
    const stored = this.receipts.get(receiptId);
    if (!stored) throw new EvidenceBundleNotFoundError();
    const signer = this.receipts.signerFor(stored.receipt.keyId);
    if (!signer) {
      throw new Error("The receipt key is not available for bundle signing");
    }
    const run = this.runs.get(stored.receipt.payload.report.runId);
    const rawLogs: RawLogState = stored.isPublic
      ? this.receiptStore.rawLogs(
          stored.receipt.payload.report.runId,
          now,
        )
      : { kind: "unavailable" };
    return createEvidenceBundle({
      receipt: stored.receipt,
      ...(run?.request.verificationContract
        ? { verificationContract: run.request.verificationContract }
        : {}),
      rawLogs,
      signer,
    });
  }

  verify(archive: Buffer): EvidenceBundleVerificationResponse {
    return verifyEvidenceBundle(archive, (keyId) =>
      this.receipts.publicKey(keyId)?.publicKey ?? null,
    );
  }
}
