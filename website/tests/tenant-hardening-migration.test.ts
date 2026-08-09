import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202607310027_tenant_write_and_admin_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);

function section(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing migration section: ${start}`);
  assert.notEqual(endIndex, -1, `missing migration section end: ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("authenticated clients cannot mutate sensitive tables directly", () => {
  const revokeSection = section(
    "revoke insert, update, delete on table",
    "create or replace function public.protect_trainee_code",
  );
  const sensitiveTables = [
    "organizations",
    "memberships",
    "membership_invitations",
    "programs",
    "program_versions",
    "jotform_forms",
    "cohorts",
    "trainees",
    "enrollments",
    "access_requests",
    "assessment_submission_tokens",
    "webhook_ingestions",
    "assessments",
    "org_api_keys",
    "xapi_statements",
    "impact_reports",
    "cohort_reports",
    "certificates",
    "audit_logs",
  ];

  for (const table of sensitiveTables) {
    assert.match(revokeSection, new RegExp(`public\\.${table}(?:,|\\s)`));
  }

  assert.match(revokeSection, /from public, anon, authenticated;/);
});

test("trainee identity is immutable at the table boundary", () => {
  const traineeGuard = section(
    "create or replace function public.protect_trainee_code",
    "create or replace function public.enforce_active_organization_write",
  );

  assert.match(traineeGuard, /new\.code is distinct from old\.code/);
  assert.match(traineeGuard, /before update on public\.trainees/);
  assert.match(traineeGuard, /Trainee code is immutable/);
});

test("all operational tenant tables enforce active organization state", () => {
  const guardedTables = [
    "membership_invitations",
    "programs",
    "program_versions",
    "jotform_forms",
    "cohorts",
    "trainees",
    "enrollments",
    "access_requests",
    "assessment_submission_tokens",
    "webhook_ingestions",
    "assessments",
    "org_api_keys",
    "xapi_statements",
    "impact_reports",
    "cohort_reports",
    "certificates",
  ];

  assert.match(
    migration,
    /organization\.status = 'active'[\s\S]+Organization is not active/,
  );
  assert.match(
    migration,
    /Operational records cannot move between organizations/,
  );

  for (const table of guardedTables) {
    assert.match(
      migration,
      new RegExp(
        `before insert or update or delete on public\\.${table}\\s+` +
          "for each row execute function " +
          "public\\.enforce_active_organization_write\\(\\);",
      ),
    );
  }
});

test("organization administration uses explicit permissions and audit logs", () => {
  const createOrganization = section(
    "create or replace function public.create_platform_organization",
    "create or replace function public.update_organization_profile",
  );
  const updateOrganization = section(
    "create or replace function public.update_organization_profile",
    "create or replace function public.change_platform_organization_status",
  );
  const changeStatus = section(
    "create or replace function public.change_platform_organization_status",
    "create or replace function public.set_organization_membership",
  );

  assert.match(
    createOrganization,
    /has_permission\('organizations\.create', null\)/,
  );
  assert.match(
    createOrganization,
    /insert into public\.memberships[\s\S]+'owner'[\s\S]+'active'/,
  );
  assert.match(createOrganization, /'organization\.created'/);
  assert.match(
    updateOrganization,
    /has_permission\('organizations\.update', null\)/,
  );
  assert.match(
    updateOrganization,
    /has_permission\('organization\.update', target_org_id\)/,
  );
  assert.match(updateOrganization, /'organization\.profile_updated'/);
  assert.doesNotMatch(updateOrganization, /set[\s\S]+status\s*=/);
  assert.match(
    changeStatus,
    /has_permission\('organizations\.change_status', null\)/,
  );
  assert.match(
    changeStatus,
    /coalesce\(length\(normalized_reason\), 0\) not between 5 and 500/,
  );
  assert.match(changeStatus, /'organization\.status_changed'/);
  assert.match(
    changeStatus,
    /update public\.org_api_keys[\s\S]+api_key\.status = 'active'/,
  );
  assert.match(
    changeStatus,
    /update public\.membership_invitations[\s\S]+invitation\.status = 'pending'/,
  );
  assert.match(changeStatus, /'revoked_api_keys', revoked_key_count/);
  assert.match(
    changeStatus,
    /'revoked_pending_invitations', revoked_invitation_count/,
  );
});

test("inactive legacy tenants start with credentials and invitations closed", () => {
  const cleanup = section(
    "-- Close credentials and pending invitations that predate this migration.",
    "drop trigger if exists membership_invitations_require_active_org",
  );

  assert.match(cleanup, /update public\.org_api_keys/);
  assert.match(cleanup, /organization\.status <> 'active'/);
  assert.match(cleanup, /api_key\.status = 'active'/);
  assert.match(cleanup, /update public\.membership_invitations/);
  assert.match(cleanup, /invitation\.status = 'pending'/);
});

test("membership administration protects the final owner and records a reason", () => {
  const membership = section(
    "create or replace function public.set_organization_membership",
    "revoke all on function public.create_platform_organization",
  );

  assert.match(
    membership,
    /has_permission\('memberships\.manage_all', null\)/,
  );
  assert.match(
    membership,
    /has_permission\('memberships\.manage', target_org_id\)/,
  );
  assert.match(membership, /pg_advisory_xact_lock/);
  assert.match(
    membership,
    /membership\.role = 'owner'[\s\S]+membership\.status = 'active'/,
  );
  assert.match(
    membership,
    /The final active organization owner cannot be changed/,
  );
  assert.match(
    membership,
    /Organization owners cannot remove their own access/,
  );
  assert.match(membership, /'reason', normalized_reason/);
  assert.match(membership, /'membership\.created'/);
  assert.match(membership, /'membership\.updated'/);
});

test("final-owner protection also exists at the table boundary", () => {
  const finalOwnerGuard = section(
    "create or replace function public.protect_final_organization_owner",
    "create or replace function public.enforce_active_organization_write",
  );

  assert.match(
    finalOwnerGuard,
    /before insert or update or delete on public\.memberships/,
  );
  assert.match(finalOwnerGuard, /pg_advisory_xact_lock/);
  assert.match(finalOwnerGuard, /join auth\.users as account/);
  assert.match(finalOwnerGuard, /remaining_owner_count < 1/);
  assert.match(
    finalOwnerGuard,
    /The final active organization owner cannot be changed/,
  );
  assert.match(finalOwnerGuard, /Membership identity is immutable/);
});

test("inactive-tenant cleanup and FK maintenance may delete but not insert or update", () => {
  const activeGuard = section(
    "create or replace function public.enforce_active_organization_write",
    "revoke all on function public.enforce_active_organization_write",
  );

  assert.match(activeGuard, /if tg_op = 'DELETE'[\s\S]+return old/);
  assert.match(activeGuard, /Organization is not active/);
  assert.match(activeGuard, /Operational records cannot move between organizations/);
});

test("public trainee workflow is hidden for inactive organizations", () => {
  const publicRoute = section(
    "create or replace function public.get_public_trainee_route",
    "comment on function public.enforce_active_organization_write",
  );

  assert.match(publicRoute, /join public\.organizations as organization/);
  assert.match(publicRoute, /organization\.id = trainee\.org_id/);
  assert.match(publicRoute, /organization\.status = 'active'/);
  assert.doesNotMatch(publicRoute, /certificate\.verify_code/);
  assert.match(publicRoute, /null::text as certificate_verify_code/);
  assert.match(
    publicRoute,
    /grant execute on function public\.get_public_trainee_route\(text\) to anon/,
  );
});

test("admin write contracts are not executable by anonymous users", () => {
  const contracts = [
    "create_platform_organization",
    "update_organization_profile",
    "change_platform_organization_status",
    "set_organization_membership",
  ];

  for (const contract of contracts) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${contract}\\([\\s\\S]+?\\) from anon;`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${contract}\\([\\s\\S]+?\\) to authenticated;`,
      ),
    );
  }
});
