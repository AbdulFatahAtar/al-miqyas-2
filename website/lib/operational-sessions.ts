import "server-only";

import { createHash, randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { getApplicationUrl } from "./access-requests";

const sessionTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createOperationalSessionToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashOperationalSessionToken(token) };
}

export function isOperationalSessionToken(value: string) {
  return sessionTokenPattern.test(value);
}

export function hashOperationalSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createOperationalSessionQr(
  request: Request,
  token: string,
) {
  const joinUrl = `${getApplicationUrl(request)}/join/${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });

  return { joinUrl, qrDataUrl };
}
