import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/202607310028_audit_log_hardening.sql",
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

test("audit events have explicit authority, outcome, severity, reason, and correlation", () => {
  const schema = section(
    "alter table public.audit_logs\n  add column actor_role",
    "create index audit_logs_request_created_idx",
  );

  for (const column of [
    "actor_role",
    "actor_scope",
    "outcome",
    "severity",
    "reason",
  ]) {
    assert.match(schema, new RegExp(`add column ${column} text`));
  }

  assert.match(
    schema,
    /alter column request_id set default extensions\.gen_random_uuid\(\)/,
  );
  assert.match(schema, /alter column request_id set not null/);
  assert.match(
    schema,
    /check \(outcome in \('success', 'denied', 'failure', 'partial'\)\)/,
  );
  assert.match(
    schema,
    /check \(severity in \('info', 'notice', 'warning', 'critical'\)\)/,
  );
  assert.match(schema, /when audit\.actor_user_id is not null then 'legacy_user'/);
  assert.match(schema, /then 'integration'/);
  assert.match(
    schema,
    /Do not infer a current role and present it as historical fact/,
  );
});

test("redaction is recursive and covers secrets and direct trainee identifiers", () => {
  const redaction = section(
    "create or replace function public.redact_audit_text",
    "-- Existing events did not record",
  );

  assert.match(redaction, /jsonb_each\(input_value\)/);
  assert.match(redaction, /jsonb_array_elements\(input_value\)/);
  assert.match(redaction, /public\.redact_audit_json\(\s*item\.value/);
  assert.match(redaction, /\(\[A-Z\]\+\)\(\[A-Z\]\[a-z\]\)/);
  assert.match(redaction, /\(\[a-z0-9\]\)\(\[A-Z\]\)/);
  assert.match(redaction, /'\[REDACTED_EMAIL\]'/);
  assert.match(redaction, /'\[REDACTED_PHONE\]'/);
  assert.match(redaction, /'\[REDACTED_SECRET\]'/);

  for (const sensitiveKey of [
    "access_token",
    "answer_key",
    "authorization",
    "email",
    "full_name",
    "key_hash",
    "phone",
    "raw_payload",
    "reference_code",
    "token_hash",
    "trainee_code",
  ]) {
    assert.match(redaction, new RegExp(`'${sensitiveKey}'`));
  }

  assert.match(
    redaction,
    /target_entity_type[\s\S]+lower\(item\.key\) = 'code'/,
  );
});

test("insert trigger derives actor authority and does not trust a browser-supplied actor", () => {
  const trigger = section(
    "create or replace function public.prepare_audit_log",
    "drop policy if exists audit_logs_select_owner",
  );

  assert.match(trigger, /security definer/);
  assert.match(trigger, /current_actor_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(trigger, /new\.actor_user_id := current_actor_id/);
  assert.match(trigger, /current_auth_role = 'service_role'/);
  assert.match(
    trigger,
    /integration_event :=[\s\S]+current_actor_id is null[\s\S]+current_auth_role in \('anon', 'service_role'\)[\s\S]+new\.action in \('assessment\.processed', 'xapi\.batch_processed'\)[\s\S]+'jotform_webhook'[\s\S]+'xapi_ingestion'[\s\S]+inferred_actor_role := 'integration'/,
  );
  assert.match(
    trigger,
    /assignment\.role_key = 'platform_owner'[\s\S]+assignment\.is_active = true/,
  );
  assert.match(
    trigger,
    /membership\.org_id = new\.org_id[\s\S]+membership\.status = 'active'/,
  );
  assert.match(
    trigger,
    /public_event :=[\s\S]+current_actor_id is null[\s\S]+current_auth_role in \('anon', 'service_role'\)[\s\S]+new\.action = 'access_request\.submitted'[\s\S]+inferred_actor_role := 'anonymous'[\s\S]+inferred_actor_scope := 'public'/,
  );
  assert.match(trigger, /new\.request_id := coalesce\([\s\S]+gen_random_uuid/);
  assert.match(trigger, /before insert on public\.audit_logs/);
});

test("legacy and new payloads centralize a redacted reason", () => {
  const backfill = section(
    "update public.audit_logs as audit",
    "alter table public.audit_logs\n  alter column actor_role",
  );
  const trigger = section(
    "create or replace function public.prepare_audit_log",
    "revoke all on function public.redact_audit_text",
  );

  for (const source of [backfill, trigger]) {
    assert.match(source, /metadata ->> 'reason'/);
    assert.match(source, /after_data ->> 'review_note'/);
    assert.match(source, /public\.redact_audit_text/);
    assert.match(
      source,
      /- array\['reason', 'review_note', 'cancellation_note'\]/,
    );
  }
});

test("audit reads use explicit RBAC permissions and tenant scope", () => {
  const policy = section(
    "drop policy if exists audit_logs_select_owner",
    "revoke all on table public.audit_logs",
  );

  assert.match(policy, /public\.has_permission\('audit\.read_all', null\)/);
  assert.match(policy, /org_id is not null/);
  assert.match(policy, /public\.has_permission\('audit\.read', org_id\)/);
  assert.doesNotMatch(policy, /is_platform_admin|has_org_role/);
});

test("authenticated users cannot mutate audit history and service credentials cannot rewrite it", () => {
  const grants = section(
    "revoke all on table public.audit_logs",
    "comment on table public.audit_logs",
  );

  assert.match(
    grants,
    /revoke all on table public\.audit_logs from public, anon, authenticated/,
  );
  assert.match(grants, /grant select on table public\.audit_logs to authenticated/);
  assert.match(
    grants,
    /revoke update, delete, truncate on table public\.audit_logs from service_role/,
  );
  assert.match(
    grants,
    /grant select, insert on table public\.audit_logs to service_role/,
  );
  assert.doesNotMatch(grants, /grant[^;]*insert[^;]*authenticated/);
});

test("failed or destructive events are promoted above informational severity", () => {
  const trigger = section(
    "create or replace function public.prepare_audit_log",
    "revoke all on function public.redact_audit_text",
  );

  assert.match(
    trigger,
    /new\.outcome in \('denied', 'failure'\)[\s\S]+new\.severity := 'warning'/,
  );
  assert.match(
    trigger,
    /'platform_owner\.provisioned'[\s\S]+'platform_owner\.revoked'[\s\S]+new\.severity := 'critical'/,
  );
  assert.match(
    trigger,
    /\(revoked\|suspended\|archived\|status_changed\|rejected\|cancelled\|expired\)/,
  );
});
