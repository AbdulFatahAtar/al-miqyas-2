import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const forgotSource = read("../components/forgot-password-page.tsx");
const resetSource = read("../components/reset-password-page.tsx");
const callbackSource = read("../app/auth/callback/route.ts");
const accessProviderSource = read("../components/access-provider.tsx");

test("password recovery requests use the same-origin PKCE callback", () => {
  assert.match(forgotSource, /resetPasswordForEmail/);
  assert.match(forgotSource, /new URL\("\/auth\/callback", window\.location\.origin\)/);
  assert.match(forgotSource, /searchParams\.set\("next", "\/reset-password"\)/);
  assert.match(forgotSource, /email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(forgotSource, /if \(error\)/);
  assert.match(forgotSource, /setIsSent\(true\)/);
});

test("password reset validates the recovery user before changing credentials", () => {
  assert.ok(resetSource.indexOf("auth.getUser()") < resetSource.indexOf("auth.updateUser"));
  assert.match(resetSource, /password\.length < 10/);
  assert.match(resetSource, /password !== passwordConfirmation/);
  assert.match(resetSource, /auth\.updateUser\(\{ password \}\)/);
  assert.match(resetSource, /auth\.signOut\(\)/);
  assert.match(resetSource, /window\.location\.assign\("\/login\?reset=success"\)/);
});

test("auth callback reports failed exchanges and forbids response caching", () => {
  assert.match(callbackSource, /exchangeCodeForSession\(code\)/);
  assert.match(callbackSource, /exchangeFailed = Boolean\(error\)/);
  assert.match(callbackSource, /\/auth\/session-transition\?next=/);
  assert.match(callbackSource, /\/login\?error=auth_callback/);
  assert.match(callbackSource, /Cache-Control", "private, no-store"/);
});

test("forgot-password bypasses both server and client access guards", () => {
  assert.match(accessProviderSource, /pathname === "\/forgot-password"/);
});
