import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const roomSource = readFileSync(
  new URL("../components/cohort-room.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../app/cohorts/[cohortId]/run/page.tsx", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/202608020030_cohort_room_read_model.sql",
    import.meta.url,
  ),
  "utf8",
);

function occurrenceCount(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0;
}

test("protected route uses least privilege and handles invalid or missing scope", () => {
  assert.match(pageSource, /requirePagePermission\("sessions\.read"/);
  assert.doesNotMatch(pageSource, /requirePagePermission\("sessions\.manage"/);
  assert.match(pageSource, /uuidPattern\.test\(cohortId\)/);
  assert.match(pageSource, /notFound\(\)/);
  assert.match(pageSource, /if \(!access\.activeOrganizationId\)/);
  assert.match(pageSource, /notice=no-organization/);
  assert.match(pageSource, /organizationId=\{access\.activeOrganizationId\}/);
  assert.doesNotMatch(pageSource, /activeOrganizationId!/);
});

test("browser performs one abortable read-model request without direct table scans", () => {
  assert.equal(occurrenceCount(roomSource, /\.rpc\("get_cohort_room"/g), 1);
  assert.doesNotMatch(roomSource, /\.from\(/);
  assert.doesNotMatch(roomSource, /raw_statement|\.limit\(1000\)/);
  assert.doesNotMatch(roomSource, /\.(insert|update|upsert|delete)\(/);
  assert.match(roomSource, /target_org_id: organizationId/);
  assert.match(roomSource, /target_cohort_id: cohortId/);
  assert.match(roomSource, /\.abortSignal\(controller\.signal\)/);
});

test("database read model enforces permission and exact tenant/cohort boundaries", () => {
  assert.match(
    migrationSource,
    /create or replace function public\.get_cohort_room\(\s*target_org_id uuid,\s*target_cohort_id uuid/,
  );
  assert.match(
    migrationSource,
    /public\.has_permission\('sessions\.read', target_org_id\)/,
  );
  assert.match(migrationSource, /cohort\.org_id = target_org_id/);
  assert.match(migrationSource, /cohort\.id = target_cohort_id/);
  assert.match(migrationSource, /enrollment\.org_id = target_org_id/);
  assert.match(migrationSource, /enrollment\.cohort_id = target_cohort_id/);
  assert.match(migrationSource, /assessment\.cohort_id = target_cohort_id/g);
  assert.match(migrationSource, /statement\.org_id = target_org_id/);
  assert.match(
    migrationSource,
    /enrollment\.id::text =\s*statement\.context #>> array\[/,
  );
  assert.doesNotMatch(
    migrationSource,
    /processing_status = 'unmatched'[\s\S]{0,500}trainee\.code =/,
  );
  assert.doesNotMatch(migrationSource, /raw_statement/);
  assert.match(migrationSource, /limit 8/);
  assert.match(migrationSource, /participant_limit constant integer := 200/);
});

test("read model returns server-side exact stage aggregates and a minimal event feed", () => {
  for (const cte of [
    "latest_pre",
    "latest_post",
    "live_enrollments",
    "latest_impact",
    "valid_certificates",
  ]) {
    assert.match(migrationSource, new RegExp(`from ${cte}`));
  }

  assert.match(migrationSource, /'stageCounts', jsonb_build_object/);
  assert.match(migrationSource, /'acceptedCount'/);
  assert.match(migrationSource, /'unmatchedCount'/);
  assert.match(migrationSource, /'testCount'/);
  assert.match(migrationSource, /'is_test_event'/);
  assert.match(migrationSource, /'validCertificates'/);
  assert.match(migrationSource, /security definer/);
  assert.match(
    migrationSource,
    /revoke all on function public\.get_cohort_room\(uuid, uuid\) from anon/,
  );
  assert.match(
    migrationSource,
    /grant execute on function public\.get_cohort_room\(uuid, uuid\) to authenticated/,
  );
});

test("authorization failures clear stale data and route away while network failures remain retryable", () => {
  assert.match(roomSource, /code === "42501"/);
  assert.match(roomSource, /code === "PGRST301"/);
  assert.match(roomSource, /code === "P0002"/);
  assert.match(
    roomSource,
    /failure\.kind === "authorization"[\s\S]{0,160}failure\.kind === "not_found"[\s\S]{0,100}setData\(null\)/,
  );
  assert.match(roomSource, /window\.location\.replace\([\s\S]*?\/login\?next=/);
  assert.match(roomSource, /window\.location\.replace\([\s\S]*?\/forbidden\?from=/);
  assert.match(roomSource, /المعروض أدناه هو آخر تحديث ناجح/);
});

test("polling is visibility-aware, cancellable, and materially cheaper", () => {
  assert.match(roomSource, /document\.visibilityState === "visible"/);
  assert.match(roomSource, /"visibilitychange"/);
  assert.match(roomSource, /30_000/);
  assert.doesNotMatch(roomSource, /15_000/);
  assert.match(roomSource, /abortController\.current\?\.abort\(\)/);
  assert.match(roomSource, /requestVersion\.current \+= 1/);
});

test("tabs, RTL keyboard navigation, progress, and event table expose coherent semantics", () => {
  assert.match(roomSource, /role="tablist"/);
  assert.match(roomSource, /role="tab"/);
  assert.match(roomSource, /aria-controls="cohort-stage-panel"/);
  assert.match(roomSource, /id="cohort-stage-panel"/);
  assert.doesNotMatch(roomSource, /cohort-stage-panel-\$\{/);
  assert.match(roomSource, /role="tabpanel"/);
  assert.match(roomSource, /role="progressbar"/);
  assert.match(roomSource, /document\.documentElement\.dir === "rtl"/);
  assert.match(
    roomSource,
    /event\.key === "ArrowRight"[\s\S]{0,120}currentIndex - 1/,
  );
  assert.match(
    roomSource,
    /event\.key === "ArrowLeft"[\s\S]{0,120}currentIndex \+ 1/,
  );
  assert.match(roomSource, /role="table"/);
  assert.match(roomSource, /role="columnheader"/);
  assert.match(roomSource, /role="cell"/);
});

test("automatic refresh does not create recurring screen-reader announcements", () => {
  assert.doesNotMatch(roomSource, /room-live-feed" aria-live=/);
  assert.doesNotMatch(roomSource, /live-data-notice" role="status"/);
  assert.doesNotMatch(roomSource, /live-data-notice" aria-live=/);
  assert.match(roomSource, /aria-busy=\{isRefreshing\}/);
});

test("room contains no demo outcomes and labels the counted enrollment set honestly", () => {
  assert.doesNotMatch(roomSource, /DemoNotice|محاكاة|setReceived|AMD-7K9FQ/);
  assert.doesNotMatch(roomSource, /التسجيلات الفعّالة/);
  assert.match(roomSource, /التسجيلات المحتسبة/);
  assert.match(
    migrationSource,
    /enrollment\.status in \('invited', 'active', 'completed'\)/,
  );
});
