begin;

create table public.integration_processing_failures (
  id uuid primary key default extensions.gen_random_uuid(),
  provider text not null check (provider in ('jotform', 'xapi')),
  channel text not null check (channel in ('webhook', 'reconciliation', 'api')),
  external_event_id text not null check (length(btrim(external_event_id)) > 0),
  form_id text,
  payload jsonb not null,
  last_error text not null check (length(btrim(last_error)) > 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  first_failed_at timestamptz not null default now(),
  last_attempt_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (provider, channel, external_event_id)
);

alter table public.integration_processing_failures enable row level security;
revoke all on table public.integration_processing_failures
  from public, anon, authenticated;
grant select, insert, update on table public.integration_processing_failures
  to service_role;

create index integration_processing_failures_unresolved_idx
  on public.integration_processing_failures (provider, channel, last_attempt_at desc)
  where resolved_at is null;

create function public.record_integration_processing_failure(
  target_provider text,
  target_channel text,
  target_external_event_id text,
  target_form_id text,
  target_payload jsonb,
  target_error text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.integration_processing_failures (
    provider,
    channel,
    external_event_id,
    form_id,
    payload,
    last_error,
    attempt_count,
    last_attempt_at
  )
  values (
    target_provider,
    target_channel,
    target_external_event_id,
    target_form_id,
    target_payload,
    target_error,
    1,
    now()
  )
  on conflict (provider, channel, external_event_id)
  do update
  set
    form_id = excluded.form_id,
    payload = excluded.payload,
    last_error = excluded.last_error,
    attempt_count = public.integration_processing_failures.attempt_count + 1,
    last_attempt_at = now(),
    resolved_at = null;
end;
$$;

revoke all on function public.record_integration_processing_failure(
  text,
  text,
  text,
  text,
  jsonb,
  text
) from public, anon, authenticated;

grant execute on function public.record_integration_processing_failure(
  text,
  text,
  text,
  text,
  jsonb,
  text
) to service_role;

create function public.process_jotform_submission(
  target_form_id text,
  target_submission_id text,
  target_submission_token text,
  target_submitted_at timestamptz,
  target_answers jsonb,
  target_payload jsonb,
  target_channel text
)
returns table (
  processing_result text,
  assessment_id uuid,
  ingestion_id uuid,
  score_percentage numeric,
  confidence_mean numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  result_row record;
begin
  if target_channel not in ('webhook', 'reconciliation') then
    raise exception 'Invalid Jotform ingestion channel';
  end if;

  select *
  into result_row
  from public.process_jotform_submission(
    target_form_id,
    target_submission_id,
    target_submission_token,
    target_submitted_at,
    target_answers,
    target_payload
  );

  if target_channel = 'reconciliation'
    and result_row.processing_result = 'processed'
    and result_row.ingestion_id is not null
  then
    update public.webhook_ingestions
    set channel = 'reconciliation'
    where id = result_row.ingestion_id
      and provider = 'jotform';
  end if;

  return query
  select
    result_row.processing_result,
    result_row.assessment_id,
    result_row.ingestion_id,
    result_row.score_percentage,
    result_row.confidence_mean;
end;
$$;

revoke all on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  text
) from public, anon, authenticated;

grant execute on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb,
  text
) to service_role;

create function public.resolve_jotform_processing_failure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.integration_processing_failures
  set resolved_at = now()
  where provider = 'jotform'
    and external_event_id = new.external_event_id
    and resolved_at is null;

  return new;
end;
$$;

revoke all on function public.resolve_jotform_processing_failure()
  from public, anon, authenticated;

create trigger webhook_ingestions_resolve_jotform_failure
after insert on public.webhook_ingestions
for each row
when (new.provider = 'jotform')
execute function public.resolve_jotform_processing_failure();

commit;
