/**
 * RFC 8785 requires lexicographic object keys and ECMAScript JSON number and
 * string serialization. JSON.stringify already supplies the latter; this
 * small normalizer supplies deterministic key ordering and rejects values JCS
 * cannot represent.
 */
export const canonicalize = (value: unknown): string => {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === "string" || typeof input === "boolean") {
      return input;
    }
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("JCS cannot encode non-finite numbers");
      return input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === "object") {
      const record = input as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) result[key] = normalize(record[key]);
      return result;
    }
    throw new TypeError(`JCS cannot encode ${typeof input}`);
  };

  return JSON.stringify(normalize(value));
};
