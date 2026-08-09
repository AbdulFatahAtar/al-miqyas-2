import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const proxySource = source("../proxy.ts");
const accessProviderSource = source("../components/access-provider.tsx");
const authSource = source("../components/auth-frame.tsx");
const lookupRouteSource = source("../app/verify/page.tsx");
const lookupPageSource = source(
  "../components/verification-lookup-page.tsx",
);

test("the verification lookup entry is public in the server and client guards", () => {
  assert.match(proxySource, /pathname === "\/verify"/);
  assert.match(accessProviderSource, /pathname === "\/verify"/);
  assert.match(proxySource, /pathname\.startsWith\("\/verify\/"\)/);
  assert.match(accessProviderSource, /pathname\.startsWith\("\/verify\/"\)/);
});

test("the verification entry renders a real code lookup instead of a demo record", () => {
  assert.match(lookupRouteSource, /<VerificationLookupPage \/>/);
  assert.match(lookupPageSource, /verificationCode\.trim\(\)\.toUpperCase\(\)/);
  assert.match(
    lookupPageSource,
    /router\.push\(`\/verify\/\$\{encodeURIComponent\(normalizedCode\)\}`\)/,
  );
  assert.match(lookupPageSource, /verificationCodePattern\.test\(normalizedCode\)/);
  assert.doesNotMatch(lookupPageSource, /AMD-7K9FQ|VER-AMD-7K9FQ/);
});

test("authentication pages no longer link to hard-coded trainee or certificate examples", () => {
  assert.match(authSource, /href="\/verify"/);
  assert.doesNotMatch(authSource, /href="\/verify\/VER-|href="\/t\/AMD-/);
});
