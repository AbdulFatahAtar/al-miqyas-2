begin;

alter table public.audit_logs
  add column actor_role text,
  add column actor_scope text,
  add column outcome text,
  add column severity text,
  add column reason text;

create or replace function public.redact_audit_text(input_value text)
returns text
language plpgsql
immutable
strict
set search_path = public, pg_temp
as $$
declare
  redacted_value text := left(btrim(input_value), 500);
begin
  redacted_value := regexp_replace(
    redacted_value,
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
    '[REDACTED_EMAIL]',
    'gi'
  );
  redacted_value := regexp_replace(
    redacted_value,
    '([+]?966|0)?5[0-9][0-9[:space:]().-]{6,}[0-9]',
    '[REDACTED_PHONE]',
    'g'
  );
  redacted_value := regexp_replace(
    redacted_value,
    '(bearer|password|secret|token|api[_ -]?key)[[:space:]:=]+[^[:space:],;]+',
    '[REDACTED_SECRET]',
    'gi'
  );

  return nullif(redacted_value, '');
end;
$$;

create or replace function public.redact_audit_json(
  input_value jsonb,
  target_entity_type text default null
)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  redacted_value jsonb;
begin
  if input_value is null then
    return null;
  end if;

  case jsonb_typeof(input_value)
    when 'object' then
      select coalesce(
        jsonb_object_agg(
          item.key,
          case
            when regexp_replace(
              lower(
                regexp_replace(
                  regexp_replace(
                    item.key,
                    '([A-Z]+)([A-Z][a-z])',
                    E'\\1_\\2',
                    'g'
                  ),
                  '([a-z0-9])([A-Z])',
                  E'\\1_\\2',
                  'g'
                )
              ),
              '[^a-z0-9]+',
              '_',
              'g'
            ) = any (array[
              'access_token',
              'answer_key',
              'api_key',
              'api_key_hash',
              'authorization',
              'client_secret',
              'cookie',
              'email',
              'full_name',
              'identity_number',
              'invitation_token',
              'invitation_token_hash',
              'ip',
              'key_hash',
              'mobile',
              'national_id',
              'password',
              'password_hash',
              'phone',
              'public_snapshot',
              'raw_answers',
              'raw_payload',
              'raw_submission_token',
              'reference_code',
              'refresh_token',
              'secret',
              'statement',
              'submission_token',
              'token',
              'token_hash',
              'trainee_code',
              'trainee_name',
              'user_agent'
            ])
              or (
                lower(coalesce(target_entity_type, '')) = 'trainee'
                and lower(item.key) = 'code'
              )
            then '"[REDACTED]"'::jsonb
            else public.redact_audit_json(
              item.value,
              target_entity_type
            )
          end
        ),
        '{}'::jsonb
      )
      into redacted_value
      from jsonb_each(input_value) as item;

      return redacted_value;
    when 'array' then
      select coalesce(
        jsonb_agg(
          public.redact_audit_json(item.value, target_entity_type)
        ),
        '[]'::jsonb
      )
      into redacted_value
      from jsonb_array_elements(input_value) as item;

      return redacted_value;
    when 'string' then
      return coalesce(
        to_jsonb(public.redact_audit_text(input_value #>> '{}')),
        'null'::jsonb
      );
    else
      return input_value;
  end case;
end;
$$;

-- Existing events did not record the actor's authority at the time of the
-- action. Do not infer a current role and present it as historical fact.
update public.audit_logs as audit
set
  actor_role = case
    when audit.action = 'assessment.processed'
      or lower(coalesce(audit.metadata ->> 'source', '')) in (
        'jotform_webhook',
        'xapi_ingestion'
      )
      then 'integration'
    when audit.actor_user_id is not null then 'legacy_user'
    when audit.action = 'access_request.submitted' then 'anonymous'
    else 'system'
  end,
  actor_scope = case
    when audit.action = 'assessment.processed'
      or lower(coalesce(audit.metadata ->> 'source', '')) in (
        'jotform_webhook',
        'xapi_ingestion'
      )
      then 'integration'
    when audit.actor_user_id is not null and audit.org_id is not null
      then 'organization'
    when audit.actor_user_id is not null then 'unknown'
    when audit.action = 'access_request.submitted' then 'public'
    else 'system'
  end,
  outcome = 'success',
  severity = case
    when audit.action in (
      'platform_owner.provisioned',
      'platform_owner.revoked'
    ) then 'critical'
    when audit.action ~ '(revoked|suspended|archived|status_changed|rejected|cancelled|expired)$'
      then 'warning'
    else 'info'
  end,
  request_id = coalesce(audit.request_id, extensions.gen_random_uuid()),
  reason = public.redact_audit_text(
    coalesce(
      audit.metadata ->> 'reason',
      audit.metadata ->> 'review_note',
      audit.after_data ->> 'reason',
      audit.after_data ->> 'review_note',
      audit.after_data ->> 'cancellation_note'
    )
  ),
  before_data = public.redact_audit_json(
    audit.before_data - array['reason', 'review_note', 'cancellation_note'],
    audit.entity_type
  ),
  after_data = public.redact_audit_json(
    audit.after_data - array['reason', 'review_note', 'cancellation_note'],
    audit.entity_type
  ),
  metadata = public.redact_audit_json(
    audit.metadata - array['reason', 'review_note', 'cancellation_note'],
    audit.entity_type
  );

alter table public.audit_logs
  alter column actor_role set default 'system',
  alter column actor_role set not null,
  alter column actor_scope set default 'system',
  alter column actor_scope set not null,
  alter column outcome set default 'success',
  alter column outcome set not null,
  alter column severity set default 'info',
  alter column severity set not null,
  alter column request_id set default extensions.gen_random_uuid(),
  alter column request_id set not null;

alter table public.audit_logs
  add constraint audit_logs_actor_role_check
    check (
      actor_role in (
        'platform_owner',
        'owner',
        'trainer',
        'viewer',
        'authenticated',
        'integration',
        'service_role',
        'anonymous',
        'system',
        'legacy_user'
      )
    ),
  add constraint audit_logs_actor_scope_check
    check (
      actor_scope in (
        'platform',
        'organization',
        'public',
        'integration',
        'system',
        'unknown'
      )
    ),
  add constraint audit_logs_outcome_check
    check (outcome in ('success', 'denied', 'failure', 'partial')),
  add constraint audit_logs_severity_check
    check (severity in ('info', 'notice', 'warning', 'critical')),
  add constraint audit_logs_reason_check
    check (
      reason is null
      or length(btrim(reason)) between 1 and 500
    );

create index audit_logs_request_created_idx
  on public.audit_logs (request_id, created_at desc);
create index audit_logs_actor_created_idx
  on public.audit_logs (actor_user_id, created_at desc)
  where actor_user_id is not null;
create index audit_logs_org_severity_created_idx
  on public.audit_logs (org_id, severity, created_at desc);

create or replace function public.prepare_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_actor_id uuid := (select auth.uid());
  current_auth_role text := coalesce((select auth.role()), '');
  inferred_actor_role text;
  inferred_actor_scope text;
  candidate_reason text;
  integration_event boolean;
  public_event boolean;
begin
  -- Never trust an actor id supplied in an INSERT payload. Integration and
  -- service JWTs normally have no auth.uid(), so this also prevents spoofing a
  -- human actor through a trusted server endpoint.
  new.actor_user_id := current_actor_id;

  -- Event names and metadata describe the operation, not the caller.  Only a
  -- request without an authenticated user may be classified as a public or
  -- integration actor; otherwise the real user authority wins.
  integration_event :=
    current_actor_id is null
    and current_auth_role in ('anon', 'service_role')
    and (
      new.action in ('assessment.processed', 'xapi.batch_processed')
      or lower(coalesce(new.metadata ->> 'source', '')) in (
        'jotform_webhook',
        'xapi_ingestion'
      )
    );
  public_event :=
    current_actor_id is null
    and current_auth_role in ('anon', 'service_role')
    and new.action = 'access_request.submitted';

  if public_event then
    inferred_actor_role := 'anonymous';
    inferred_actor_scope := 'public';
  elsif integration_event then
    inferred_actor_role := 'integration';
    inferred_actor_scope := 'integration';
  elsif current_auth_role = 'service_role' then
    inferred_actor_role := 'service_role';
    inferred_actor_scope := 'system';
  elsif new.actor_user_id is not null and exists (
    select 1
    from public.platform_admins as assignment
    where assignment.user_id = new.actor_user_id
      and assignment.role_key = 'platform_owner'
      and assignment.is_active = true
  ) then
    inferred_actor_role := 'platform_owner';
    inferred_actor_scope := 'platform';
  elsif new.actor_user_id is not null and new.org_id is not null then
    select membership.role, 'organization'
    into inferred_actor_role, inferred_actor_scope
    from public.memberships as membership
    where membership.user_id = new.actor_user_id
      and membership.org_id = new.org_id
      and membership.status = 'active'
    limit 1;

    if inferred_actor_role is null then
      inferred_actor_role := 'authenticated';
      inferred_actor_scope := 'unknown';
    end if;
  elsif new.actor_user_id is not null then
    inferred_actor_role := 'authenticated';
    inferred_actor_scope := 'unknown';
  elsif current_auth_role = 'anon' then
    inferred_actor_role := 'anonymous';
    inferred_actor_scope := 'public';
  else
    inferred_actor_role := 'system';
    inferred_actor_scope := 'system';
  end if;

  new.actor_role := inferred_actor_role;
  new.actor_scope := inferred_actor_scope;
  new.outcome := lower(coalesce(nullif(btrim(new.outcome), ''), 'success'));
  new.severity := lower(coalesce(nullif(btrim(new.severity), ''), 'info'));

  if new.outcome in ('denied', 'failure') and new.severity = 'info' then
    new.severity := 'warning';
  elsif new.action in (
    'platform_owner.provisioned',
    'platform_owner.revoked'
  ) then
    new.severity := 'critical';
  elsif new.severity = 'info'
    and new.action ~ '(revoked|suspended|archived|status_changed|rejected|cancelled|expired)$'
  then
    new.severity := 'warning';
  end if;

  new.request_id := coalesce(new.request_id, extensions.gen_random_uuid());

  candidate_reason := coalesce(
    new.reason,
    new.metadata ->> 'reason',
    new.metadata ->> 'review_note',
    new.after_data ->> 'reason',
    new.after_data ->> 'review_note',
    new.after_data ->> 'cancellation_note'
  );
  new.reason := public.redact_audit_text(candidate_reason);
  new.before_data := public.redact_audit_json(
    new.before_data - array['reason', 'review_note', 'cancellation_note'],
    new.entity_type
  );
  new.after_data := public.redact_audit_json(
    new.after_data - array['reason', 'review_note', 'cancellation_note'],
    new.entity_type
  );
  new.metadata := public.redact_audit_json(
    coalesce(new.metadata, '{}'::jsonb)
      - array['reason', 'review_note', 'cancellation_note'],
    new.entity_type
  );

  return new;
end;
$$;

revoke all on function public.redact_audit_text(text) from public;
revoke all on function public.redact_audit_text(text) from anon;
revoke all on function public.redact_audit_text(text) from authenticated;
revoke all on function public.redact_audit_json(jsonb, text) from public;
revoke all on function public.redact_audit_json(jsonb, text) from anon;
revoke all on function public.redact_audit_json(jsonb, text)
  from authenticated;
revoke all on function public.prepare_audit_log() from public;
revoke all on function public.prepare_audit_log() from anon;
revoke all on function public.prepare_audit_log() from authenticated;

drop trigger if exists audit_logs_prepare on public.audit_logs;
create trigger audit_logs_prepare
before insert on public.audit_logs
for each row execute function public.prepare_audit_log();

drop policy if exists audit_logs_select_owner on public.audit_logs;
drop policy if exists audit_logs_select_authorized on public.audit_logs;
create policy audit_logs_select_authorized
on public.audit_logs for select to authenticated
using (
  public.has_permission('audit.read_all', null)
  or (
    org_id is not null
    and public.has_permission('audit.read', org_id)
  )
);

revoke all on table public.audit_logs from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;

-- Application service credentials may append and read events, but cannot
-- rewrite or delete history. Database owners retain controlled maintenance.
revoke update, delete, truncate on table public.audit_logs from service_role;
grant select, insert on table public.audit_logs to service_role;
revoke all on sequence public.audit_logs_id_seq
  from public, anon, authenticated;
grant usage, select on sequence public.audit_logs_id_seq to service_role;

comment on table public.audit_logs is
  'Append-only audit events with explicit authority, outcome, severity, correlation, and redacted payloads.';
comment on column public.audit_logs.actor_role is
  'Authority used for the event; legacy_user means the historic role was not provable.';
comment on column public.audit_logs.actor_scope is
  'Boundary in which the actor operated: platform, organization, public, integration, system, or unknown.';
comment on column public.audit_logs.request_id is
  'Correlation identifier. It can be supplied by a workflow or generated per event.';
comment on column public.audit_logs.reason is
  'Optional redacted operational reason, separated from before/after payloads.';

commit;
