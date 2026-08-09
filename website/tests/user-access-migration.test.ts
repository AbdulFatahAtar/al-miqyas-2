import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202607310029_user_access_and_least_privilege.sql",
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

test("suspended users fail closed in both permission helpers", () => {
  const permission = section(
    "create or replace function public.has_permission",
    "create policy user_access_controls_select_authorized",
  );

  assert.match(permission, /public\.is_user_access_active\(\(select auth\.uid\(\)\)\)/);
  assert.match(permission, /when not \(select allowed from active_actor\) then false/);
  assert.match(permission, /create or replace function public\.has_org_role/);
  assert.match(permission, /organization\.status = 'active'/);
});

test("platform user suspension protects self and the final active owner", () => {
  const suspension = section(
    "create or replace function public.set_platform_user_suspension",
    "-- Contact details are not part of the viewer role.",
  );

  assert.match(suspension, /has_permission\('users\.suspend', null\)/);
  assert.match(suspension, /cannot suspend their own account/);
  assert.match(suspension, /pg_advisory_xact_lock/);
  assert.match(suspension, /join auth\.users as account/);
  assert.match(suspension, /assignment\.user_id is distinct from target_user_id/);
  assert.match(suspension, /The final active platform owner cannot be suspended/);
  assert.match(suspension, /The final active organization owner cannot be suspended/);
  assert.match(suspension, /'user\.suspended'/);
  assert.match(suspension, /'user\.restored'/);
  assert.match(suspension, /normalized_reason/);
});

test("platform user listing exposes safe operational fields only to users.read", () => {
  const listing = section(
    "create or replace function public.list_platform_users",
    "create or replace function public.set_platform_user_suspension",
  );

  assert.match(listing, /has_permission\('users\.read', null\)/);
  assert.match(listing, /from auth\.users as account/);
  assert.match(listing, /account\.raw_user_meta_data ->> 'full_name'/);
  assert.doesNotMatch(listing, /encrypted_password|confirmation_token|recovery_token/);
  assert.match(migration, /revoke all on function public\.list_platform_users\(\) from anon/);
});

test("viewer table grants exclude trainee contact details", () => {
  const contacts = section(
    "-- Contact details are not part of the viewer role.",
    "-- Align xAPI contracts with the explicit permission catalog.",
  );

  assert.match(contacts, /revoke select on table public\.trainees from authenticated/);
  assert.match(contacts, /grant select \([\s\S]+full_name[\s\S]+archived_at[\s\S]+\) on table public\.trainees to authenticated/);
  assert.doesNotMatch(
    contacts.slice(
      contacts.indexOf("grant select ("),
      contacts.indexOf(") on table public.trainees"),
    ),
    /\bphone\b|\bemail\b/,
  );
  assert.match(contacts, /has_permission\('trainees\.manage', target_org_id\)/);
});

test("xAPI key contracts separate read and manage permissions", () => {
  const xapi = section(
    "-- Align xAPI contracts with the explicit permission catalog.",
    "comment on table public.user_access_controls",
  );

  assert.match(xapi, /has_permission\('integrations\.read', target_org_id\)/);
  assert.match(xapi, /has_permission\('integrations\.manage', target_org_id\)/);
  assert.doesNotMatch(xapi, /drop function public\.revoke_org_xapi_key\(uuid\)/);
  assert.match(
    xapi,
    /create or replace function public\.revoke_org_xapi_key\([\s\S]+target_key_id uuid[\s\S]+reason is required/,
  );
  assert.match(
    xapi,
    /revoke all on function public\.revoke_org_xapi_key\(uuid\)[\s\S]+authenticated, service_role/,
  );
  assert.match(xapi, /target_reason text/);
  assert.match(xapi, /An xAPI key revocation reason is required/);
  assert.match(xapi, /'xapi\.key_revoked'/);
});

test("effective-owner guards count real, unsuspended users at table boundaries", () => {
  const guards = section(
    "-- Re-evaluate both final-owner guards",
    "create or replace function public.has_permission",
  );

  assert.match(guards, /create or replace function public\.protect_final_platform_owner/);
  assert.match(guards, /create or replace function public\.protect_final_organization_owner/);
  assert.match(guards, /join auth\.users as account/g);
  assert.match(guards, /coalesce\(control\.is_suspended, false\) = false/g);
  assert.match(guards, /platform-owner:effective-assignment/);
  assert.match(guards, /membership-owner:/);
  assert.match(guards, /user_access_controls_protect_effective_owner/);
});

test("suspended users cannot activate a membership or complete an invitation", () => {
  const guard = section(
    "create or replace function public.enforce_active_membership_user",
    "create or replace function public.has_permission",
  );

  assert.match(guard, /not public\.is_user_access_active\(new\.user_id\)/);
  assert.match(guard, /suspended user cannot receive an active membership/);
  assert.match(guard, /before insert or update of user_id, status on public\.memberships/);
});

test("raw integration evidence is not selectable by browser roles", () => {
  const rawAccess = section(
    "-- Raw provider payloads",
    "-- Align xAPI contracts with the explicit permission catalog.",
  );

  assert.match(rawAccess, /revoke select on table public\.webhook_ingestions from authenticated/);
  assert.match(rawAccess, /revoke select on table public\.assessments from authenticated/);
  assert.match(rawAccess, /revoke select on table public\.xapi_statements from authenticated/);
  assert.match(rawAccess, /revoke select on table public\.org_api_keys from authenticated/);
  assert.match(rawAccess, /create or replace function public\.safe_xapi_result_projection/);
  assert.match(rawAccess, /create or replace function public\.safe_xapi_context_projection/);
  assert.match(rawAccess, /update public\.xapi_statements as statement/);
  assert.match(
    rawAccess,
    /before insert or update of result, context on public\.xapi_statements/,
  );
  const resultProjection = section(
    "create or replace function public.safe_xapi_result_projection",
    "create or replace function public.safe_xapi_context_projection",
  );
  assert.doesNotMatch(resultProjection, /'response'/);
  assert.match(resultProjection, /jsonb_typeof\(input_value -> 'success'\) = 'boolean'/);
  assert.match(resultProjection, /jsonb_typeof\(input_value #> '\{score,raw\}'\) = 'number'/);
  assert.match(resultProjection, /\/xapi\/extensions\/is-correct/);
  assert.match(resultProjection, /\/xapi\/extensions\/response-time-ms/);
  const contextProjection = section(
    "create or replace function public.safe_xapi_context_projection",
    "create or replace function public.prepare_xapi_browser_projection",
  );
  for (const extension of [
    "test-event",
    "contract-version",
    "program-id",
    "enrollment-id",
    "scene-id",
  ]) {
    assert.match(contextProjection, new RegExp(`/xapi/extensions/${extension}`));
  }
  assert.doesNotMatch(
    rawAccess.slice(
      rawAccess.indexOf("grant select (", rawAccess.indexOf("xapi_statements")),
    ),
    /raw_statement|raw_answers|graded_items|payload|key_hash/,
  );
});

test("xAPI ingestion is service-role only and emits one correlated batch audit", () => {
  const ingestion = section(
    "-- The ingestion RPC is no longer a browser/anonymous capability.",
    "comment on table public.user_access_controls",
  );

  assert.match(ingestion, /rename to process_xapi_statements_internal/);
  assert.match(ingestion, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(ingestion, /organization\.status = 'active'/);
  assert.match(ingestion, /'xapi\.batch_processed'/);
  assert.match(ingestion, /'source', 'xapi_ingestion'/);
  assert.match(ingestion, /target_request_id/);
  assert.match(
    ingestion,
    /from public, anon, authenticated;[\s\S]+to service_role;/,
  );
});

test("low-entropy public RPCs are service-only behind mandatory rate limits", () => {
  const boundary = section(
    "-- Every low-entropy public workflow passes through a server endpoint",
    "-- Align xAPI contracts with the explicit permission catalog.",
  );

  assert.match(boundary, /create table public\.public_api_rate_windows/);
  assert.match(
    boundary,
    /revoke all on table public\.public_api_rate_windows[\s\S]+service_role/,
  );
  assert.doesNotMatch(
    boundary,
    /grant all on table public\.public_api_rate_windows to service_role/,
  );
  assert.match(boundary, /auth\.role\(\) is distinct from 'service_role'/);
  assert.match(boundary, /A valid public request fingerprint is required/);
  for (const scope of [
    "trainee_route",
    "assessment_link",
    "access_request",
  ]) {
    assert.match(boundary, new RegExp(`'${scope}'`));
  }
  for (const rpc of [
    "get_public_trainee_route",
    "create_public_assessment_link",
    "process_jotform_submission",
    "submit_access_request",
  ]) {
    assert.match(
      boundary,
      new RegExp(
        `revoke all on function public\\.${rpc}\\([\\s\\S]+?from public, anon, authenticated`,
      ),
    );
  }
  assert.match(boundary, /rename to submit_access_request_internal/);
  assert.match(boundary, /to service_role;/g);
});
