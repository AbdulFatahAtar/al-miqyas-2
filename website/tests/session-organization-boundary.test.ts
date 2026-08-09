import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  new URL("../app/api/session/organization/route.ts", import.meta.url),
  "utf8",
);

test("organization switching rejects cross-site requests before parsing input", () => {
  assert.match(routeSource, /isTrustedSameOriginRequest/);
  assert.ok(
    routeSource.indexOf("if (!isTrustedSameOriginRequest(request))") <
      routeSource.indexOf("await request.json()"),
  );
});

test("organization switching validates identity, tenant membership, and cookie safety", () => {
  assert.match(routeSource, /uuidPattern\.test\(organizationId\)/);
  assert.match(routeSource, /getCurrentAccessContext\(\)/);
  assert.match(routeSource, /context\.loadError/);
  assert.match(routeSource, /context\.organizations\.find/);
  assert.match(routeSource, /!context\.isPlatformOwner && organization\.status !== "active"/);
  assert.match(routeSource, /httpOnly: true/);
  assert.match(routeSource, /sameSite: "lax"/);
  assert.match(routeSource, /secure: process\.env\.NODE_ENV === "production"/);
});
