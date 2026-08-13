import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const migration = read("../supabase/migrations/202608130034_operational_sessions.sql");
const draftEligibilityMigration = read(
  "../supabase/migrations/202608130035_allow_draft_operational_sessions.sql",
);
const joinConflictMigration = read(
  "../supabase/migrations/202608130036_fix_operational_session_join_conflict.sql",
);
const sessionRoute = read("../app/api/sessions/route.ts");
const actionRoute = read("../app/api/sessions/[sessionId]/actions/route.ts");
const publicRoute = read("../app/api/public/sessions/[token]/route.ts");
const tokenLibrary = read("../lib/operational-sessions.ts");
const joinPage = read("../components/operational-session-join-page.tsx");
const panel = read("../components/operational-sessions-panel.tsx");
const proxy = read("../proxy.ts");
const accessProvider = read("../components/access-provider.tsx");

test("operational sessions persist tenant, lifecycle, station, and xAPI registration", () => {
  assert.match(migration, /create table public\.operational_sessions/);
  assert.match(migration, /status in \('scheduled', 'open', 'closed', 'cancelled'\)/);
  assert.match(migration, /station_key in \('ALL', 'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'\)/);
  assert.match(migration, /registration uuid not null default extensions\.gen_random_uuid\(\)/);
  assert.match(migration, /foreign key \(program_id, org_id\)/);
  assert.match(migration, /foreign key \(cohort_id, program_id, org_id\)/);
  assert.match(migration, /public\.has_permission\('sessions\.manage', target_org_id\)/);
  assert.match(migration, /public\.has_permission\('sessions\.read', org_id\)/);
});

test("join tokens are opaque, expiring, hashed at rest, and rotated on demand", () => {
  assert.match(tokenLibrary, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(tokenLibrary, /createHash\("sha256"\)/);
  assert.match(tokenLibrary, /QRCode\.toDataURL/);
  assert.match(migration, /join_token_hash text/);
  assert.doesNotMatch(migration, /join_token text/);
  assert.match(migration, /token_expires_at > now\(\)/);
  assert.match(migration, /'operational_session\.token_rotated'/);
  assert.match(migration, /join_token_hash = null,[\s\S]+token_expires_at = null/);
  assert.match(actionRoute, /createOperationalSessionToken\(\)/);
  assert.match(actionRoute, /createOperationalSessionQr\(request, generatedToken\.token\)/);
});

test("public join requires independent trainee identity and active cohort enrollment", () => {
  assert.match(migration, /create table public\.operational_session_attendances/);
  assert.match(migration, /unique \(session_id, enrollment_id\)/);
  assert.match(migration, /foreign key \(enrollment_id, cohort_id, org_id\)/);
  assert.match(migration, /target_trainee\.email/);
  assert.match(migration, /target_trainee\.phone/);
  assert.match(migration, /enrollment\.status = 'active'/);
  assert.match(migration, /'operational_session\.scanned'/);
  assert.match(migration, /'operational_session\.joined'/);
  assert.match(
    migration,
    /on conflict on constraint operational_session_attendances_session_id_enrollment_id_key do nothing/,
  );
  assert.doesNotMatch(migration, /metadata[\s\S]{0,200}target_identity_value/);
  assert.match(joinPage, /البريد الإلكتروني أو رقم الجوال المسجل/);
  assert.match(joinPage, /رمز الجلسة لا يثبت هوية المتدرّب/);
});

test("public session route is rate limited and service-role only", () => {
  assert.match(publicRoute, /createRequestFingerprint\(request\)/);
  assert.match(publicRoute, /consume_public_api_rate_limit/);
  assert.match(publicRoute, /createSupabaseServiceRoleClient\(\)/);
  assert.match(publicRoute, /target_scope: scope/);
  assert.match(migration, /when 'session_scan'/);
  assert.match(migration, /when 'session_join'/);
  assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(publicRoute, /"Cache-Control": "no-store"/);
  assert.match(publicRoute, /"Referrer-Policy": "no-referrer"/);
});

test("real xAPI statements require the matching open session and attendance", () => {
  assert.match(migration, /add column operational_session_id uuid/);
  assert.match(migration, /session\.registration = registration_text::uuid/);
  assert.match(migration, /attendance\.enrollment_id = enrollment_text::uuid/);
  assert.match(migration, /session\.status = 'open'/);
  assert.match(migration, /session\.station_key = 'ALL' or session\.station_key = scene_text/);
  assert.match(migration, /Operational session or attendance could not be matched/);
  assert.match(migration, /is_test_event/);
  assert.match(migration, /set operational_session_id = session\.id/);
});

test("session UI exposes creation, lifecycle, QR, attendees, and public entry", () => {
  assert.match(sessionRoute, /create_operational_session/);
  assert.match(actionRoute, /manage_operational_session/);
  assert.match(panel, /جلسة جديدة/);
  assert.match(panel, /إصدار QR جديد/);
  assert.match(panel, /إغلاق الجلسة/);
  assert.match(panel, /عرض الملتحقين/);
  assert.match(proxy, /pathname\.startsWith\("\/join\/"\)/);
  assert.match(accessProvider, /pathname\.startsWith\("\/join\/"\)/);
});

test("pilot draft programs and cohorts can create repeated operational sessions", () => {
  assert.match(
    draftEligibilityMigration,
    /cohort\.status in \('draft', 'open', 'in_progress'\)/,
  );
  assert.match(
    draftEligibilityMigration,
    /program\.status in \('draft', 'active'\)/,
  );
  assert.match(draftEligibilityMigration, /repeated sessions are allowed/);
  assert.doesNotMatch(
    migration,
    /unique \(cohort_id, station_key\)|unique \(cohort_id, scheduled_for\)/,
  );
  assert.match(panel, /\.in\("status", \["draft", "active"\]\)/);
  assert.match(panel, /\.in\("status", \["draft", "open", "in_progress"\]\)/);
});

test("public attendance join uses an unambiguous conflict target", () => {
  assert.match(
    joinConflictMigration,
    /on conflict on constraint operational_session_attendances_session_id_enrollment_id_key do nothing/,
  );
  assert.match(joinConflictMigration, /pg_get_functiondef/);
});
