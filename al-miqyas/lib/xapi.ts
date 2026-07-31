import { createHash, randomBytes, randomUUID } from "node:crypto";

export const xapiVersion = "1.0.3";
export const xapiContractVersion = "1.0";
export const maximumXapiRequestBytes = 1_000_000;
export const maximumXapiBatchSize = 100;

export type XapiStatement = Record<string, unknown>;

export class XapiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "XapiRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function readXapiBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim() ?? "";

  if (token.length < 40 || token.length > 200) {
    throw new XapiRequestError(
      "Organization API key is missing or invalid.",
      401,
    );
  }

  return token;
}

export function hashXapiApiKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createXapiApiKey() {
  const prefix = `miq_xapi_${randomBytes(4)
    .toString("hex")
    .toUpperCase()}`;
  const token = `${prefix}_${randomBytes(32).toString("base64url")}`;

  return {
    prefix,
    token,
    tokenHash: hashXapiApiKey(token),
  };
}

export function createXapiRequestId() {
  return randomUUID();
}

export async function parseXapiStatements(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new XapiRequestError(
      "Content-Type must be application/json.",
      400,
    );
  }

  const contentLength = Number(
    request.headers.get("content-length") ?? "0",
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > maximumXapiRequestBytes
  ) {
    throw new XapiRequestError("Payload is too large.", 413);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maximumXapiRequestBytes) {
    throw new XapiRequestError("Payload is too large.", 413);
  }

  let body: unknown;

  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    throw new XapiRequestError("Malformed JSON payload.", 400);
  }

  const statements = Array.isArray(body) ? body : [body];

  if (
    statements.length === 0 ||
    statements.length > maximumXapiBatchSize ||
    !statements.every(isRecord)
  ) {
    throw new XapiRequestError(
      `Payload must contain between 1 and ${maximumXapiBatchSize} statements.`,
      400,
    );
  }

  return statements as XapiStatement[];
}

