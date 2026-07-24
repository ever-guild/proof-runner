import { createHash } from "node:crypto";

/**
 * Implements RFC 8785 (JSON Canonicalization Scheme - JCS).
 * Recursively sorts keys, ignores undefined properties, and formats JSON deterministically.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    const serializedItems = obj.map((item) =>
      item === undefined ? "null" : canonicalizeJson(item)
    );
    return `[${serializedItems.join(",")}]`;
  }

  const record = obj as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  const serializedEntries = keys.map((key) => {
    return `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`;
  });

  return `{${serializedEntries.join(",")}}`;
}

/**
 * Computes the SHA-256 hash of a JSON object in RFC 8785 canonical form.
 */
export function hashCanonicalJson(obj: unknown): string {
  const canonicalString = canonicalizeJson(obj);
  return createHash("sha256").update(canonicalString, "utf8").digest("hex");
}
