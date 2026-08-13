import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequestFingerprint } from "../lib/access-requests.ts";
import { isTrustedSameOriginRequest } from "../lib/http/request-security.ts";

const protectedMutationRoutes = [
  "../app/api/access-requests/[requestId]/cancel/route.ts",
  "../app/api/access-requests/[requestId]/resend/route.ts",
  "../app/api/access-requests/[requestId]/review/route.ts",
  "../app/api/access-requests/accept/route.ts",
  "../app/api/assessments/preview-link/route.ts",
  "../app/api/integrations/xapi/keys/route.ts",
  "../app/api/integrations/xapi/keys/[keyId]/route.ts",
  "../app/api/integrations/xapi/test/route.ts",
  "../app/api/platform/invitations/route.ts",
  "../app/api/sessions/route.ts",
  "../app/api/sessions/[sessionId]/actions/route.ts",
  "../app/api/session/organization/route.ts",
] as const;

test("same-origin guard rejects sibling and cross-site origins", () => {
  const url = "https://miqyas.example/api/secure-action";

  assert.equal(
    isTrustedSameOriginRequest(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://miqyas.example",
          "sec-fetch-site": "same-origin",
        },
      }),
    ),
    true,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://admin.miqyas.example",
          "sec-fetch-site": "same-site",
        },
      }),
    ),
    false,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(url, {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
    false,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(url, {
        method: "POST",
        headers: { origin: "null" },
      }),
    ),
    false,
  );
  assert.equal(
    isTrustedSameOriginRequest(
      new Request(url, {
        method: "POST",
        headers: { "sec-fetch-site": "none" },
      }),
    ),
    true,
  );
});

test("every cookie-authenticated mutation checks origin before work", () => {
  for (const relativePath of protectedMutationRoutes) {
    const routeSource = readFileSync(
      new URL(relativePath, import.meta.url),
      "utf8",
    );
    const handlerIndex = Math.max(
      routeSource.indexOf("export async function POST"),
      routeSource.indexOf("export async function DELETE"),
    );
    const source = routeSource.slice(handlerIndex);
    const guardIndex = source.indexOf(
      "if (!isTrustedSameOriginRequest(request))",
    );
    const bodyIndex = source.indexOf("await request.json()");
    const authIndex = source.indexOf("supabase.auth.getUser()");
    const rpcIndex = source.indexOf("supabase.rpc(");
    const firstSensitiveWork = [bodyIndex, authIndex, rpcIndex]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0];

    assert.notEqual(handlerIndex, -1, relativePath);
    assert.notEqual(guardIndex, -1, relativePath);
    assert.notEqual(firstSensitiveWork, undefined, relativePath);
    assert.ok(guardIndex < firstSensitiveWork, relativePath);
  }
});

test("production rate fingerprints trust only an explicitly controlled proxy header", () => {
  const previousEnvironment = {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: process.env.VERCEL,
    TRUSTED_CLIENT_IP_HEADER: process.env.TRUSTED_CLIENT_IP_HEADER,
    ACCESS_REQUEST_RATE_LIMIT_SALT:
      process.env.ACCESS_REQUEST_RATE_LIMIT_SALT,
  };

  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    delete process.env.VERCEL;
    delete process.env.TRUSTED_CLIENT_IP_HEADER;
    process.env.ACCESS_REQUEST_RATE_LIMIT_SALT = "s".repeat(64);

    const spoofedForward = new Request("https://miqyas.example/register", {
      headers: { "x-forwarded-for": "203.0.113.10" },
    });
    assert.equal(createRequestFingerprint(spoofedForward), null);

    process.env.TRUSTED_CLIENT_IP_HEADER = "x-real-ip";
    const trustedProxy = new Request("https://miqyas.example/register", {
      headers: {
        "x-forwarded-for": "198.51.100.30",
        "x-real-ip": "203.0.113.10",
      },
    });
    const trustedFingerprint = createRequestFingerprint(trustedProxy);
    assert.match(trustedFingerprint ?? "", /^[0-9a-f]{64}$/);

    process.env.ACCESS_REQUEST_RATE_LIMIT_SALT = "short";
    assert.equal(createRequestFingerprint(trustedProxy), null);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        Reflect.set(process.env, key, value);
      }
    }
  }
});
