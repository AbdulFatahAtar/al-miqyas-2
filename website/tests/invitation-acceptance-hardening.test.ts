import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const migration = read(
  "../supabase/migrations/202608130033_require_explicit_invitation_acceptance.sql",
);
const callback = read("../app/auth/callback/route.ts");
const transition = read("../components/auth-session-transition.tsx");
const requestsPanel = read("../components/access-requests-panel.tsx");

test("confirmed accounts still require explicit invitation acceptance", () => {
  assert.match(migration, /normalized_role,\s*'approved'/);
  assert.match(migration, /'user\.invitation_created'/);
  assert.doesNotMatch(migration, /user\.access_granted/);
  assert.doesNotMatch(migration, /if final_status = 'completed'/);
  assert.doesNotMatch(migration, /access_request\.completed_existing_user/);
  assert.match(migration, /create or replace function public\.prepare_access_request_invitation/);
  assert.match(migration, /target_request\.status not in \('approved', 'invited'\)/);
  assert.match(migration, /set\s+status = 'approved',[\s\S]+invitation_id = null/);
});

test("email callbacks clear stale browser sessions before invitation activation", () => {
  assert.match(callback, /\/auth\/session-transition\?next=/);
  assert.match(transition, /window\.localStorage/);
  assert.match(transition, /window\.sessionStorage/);
  assert.match(transition, /key\?\.startsWith\("sb-"\)/);
  assert.match(transition, /window\.location\.replace\(nextPath\)/);
});

test("invitation queue supports every organization role and resending", () => {
  assert.match(requestsPanel, /requested_role: "owner" \| "trainer" \| "viewer"/);
  assert.match(requestsPanel, /if \(role === "owner"\) return "مالك الجهة"/);
  assert.match(requestsPanel, /إعادة إرسال الدعوة/);
  assert.match(requestsPanel, /\/api\/access-requests\/\$\{requestRecord\.id\}\/resend/);
});
