import { createHash, randomBytes } from "node:crypto";

export const accessRequestRoles = ["trainer", "viewer"] as const;

export type AccessRequestRole = (typeof accessRequestRoles)[number];
export type InvitableOrganizationRole = AccessRequestRole | "owner";

export type AccessRequestReviewContext = {
  request_id: string;
  request_status: string;
  organization_id: string;
  organization_name: string;
  applicant_email: string;
  applicant_name: string;
  requested_role: InvitableOrganizationRole;
  existing_user_id: string | null;
  existing_user_confirmed: boolean;
};

export function isAccessRequestRole(
  value: unknown,
): value is AccessRequestRole {
  return (
    typeof value === "string" &&
    accessRequestRoles.includes(value as AccessRequestRole)
  );
}

export function normalizeApplicantName(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ")
    : "";
}

export function normalizeApplicantEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isValidApplicantEmail(email: string) {
  return (
    email.length >= 5 &&
    email.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
  );
}

export function createRequestFingerprint(request: Request) {
  const salt = process.env.ACCESS_REQUEST_RATE_LIMIT_SALT;

  if (!salt || salt.length < 32 || salt.length > 512) {
    return null;
  }

  const trustedHeader = (() => {
    if (process.env.VERCEL === "1") {
      return "x-vercel-forwarded-for";
    }

    const configuredHeader = process.env.TRUSTED_CLIENT_IP_HEADER
      ?.trim()
      .toLowerCase();
    return configuredHeader &&
      [
        "cf-connecting-ip",
        "x-forwarded-for",
        "x-real-ip",
        "x-vercel-forwarded-for",
      ].includes(configuredHeader)
      ? configuredHeader
      : null;
  })();
  const trustedAddress = trustedHeader
    ? request.headers.get(trustedHeader)?.split(",")[0]?.trim()
    : null;
  const address =
    trustedAddress && trustedAddress.length <= 128
      ? trustedAddress
      : process.env.NODE_ENV !== "production"
        ? "local-development"
        : null;

  if (!address) {
    return null;
  }

  return createHash("sha256")
    .update(`${salt}:${address}`)
    .digest("hex");
}

export function createInvitationToken() {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashInvitationToken(token);

  return { token, tokenHash };
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getApplicationUrl(request: Request) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");

  return configuredUrl || new URL(request.url).origin;
}

export function firstRpcRow<T>(data: T[] | T | null) {
  return Array.isArray(data) ? data[0] : data;
}
