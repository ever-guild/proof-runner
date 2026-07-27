import { type IncomingMessage } from "node:http";

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export class InvalidJsonBodyError extends Error {}
export class RequestBodyTooLargeError extends Error {}

export const readBuffer = async (
  request: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<Buffer> => {
  const contentLength = request.headers["content-length"];
  if (contentLength !== undefined) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new RequestBodyTooLargeError();
    }
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > maxBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
};

export const readJson = async (
  request: IncomingMessage,
  maxBytes = MAX_JSON_BODY_BYTES,
): Promise<unknown> => {
  const body = await readBuffer(request, maxBytes);
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new InvalidJsonBodyError();
  }
};
