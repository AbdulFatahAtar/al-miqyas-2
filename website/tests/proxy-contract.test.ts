import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const proxySource = readFileSync(
  new URL("../proxy.ts", import.meta.url),
  "utf8",
);
const loginRouteSource = readFileSync(
  new URL("../app/login/page.tsx", import.meta.url),
  "utf8",
);
const authSource = readFileSync(
  new URL("../components/login-page.tsx", import.meta.url),
  "utf8",
);

test("protected API requests fail with JSON instead of a login redirect", () => {
  const unauthenticatedBranch = proxySource.slice(
    proxySource.indexOf("if (!user && !isPublicPath(pathname))"),
    proxySource.indexOf("if (user && pathname === \"/login\")"),
  );

  assert.match(unauthenticatedBranch, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(unauthenticatedBranch, /NextResponse\.json\(/);
  assert.match(unauthenticatedBranch, /status: 401/);
  assert.ok(
    unauthenticatedBranch.indexOf("NextResponse.json") <
      unauthenticatedBranch.indexOf("NextResponse.redirect"),
  );
});

test("public API and verification paths remain explicitly public", () => {
  assert.match(proxySource, /pathname\.startsWith\("\/api\/public\/"\)/);
  assert.match(proxySource, /pathname === "\/verify"/);
  assert.match(proxySource, /pathname\.startsWith\("\/verify\/"\)/);
  assert.match(proxySource, /pathname\.startsWith\("\/t\/"\)/);
});

test("login preserves only known internal destinations", () => {
  assert.match(loginRouteSource, /searchParams: Promise<\{ next\?: string \}>/);
  assert.match(loginRouteSource, /<LoginPage nextPath=\{next\}/);
  assert.match(authSource, /!value\.startsWith\("\/"\)/);
  assert.match(authSource, /value\.startsWith\("\/\/"\)/);
  assert.match(authSource, /value\.includes\("\\\\"\)/);
  assert.match(authSource, /pagePermissionForPath\(value\)/);
  assert.match(
    authSource,
    /window\.location\.assign\(requestedPath \?\? "\/dashboard"\)/,
  );
  assert.doesNotMatch(authSource, /supabase\.rpc\("is_platform_admin"\)/);
  assert.doesNotMatch(authSource, /\.from\("memberships"\)/);
});
