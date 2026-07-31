begin;

create table if not exists public.xapi_api_rate_windows (
  api_key_id uuid not null references public.org_api_keys(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  statement_count integer not null default 0 check (statement_count >= 0),
  primary key (api_key_id, window_started_at)
);

alter table public.xapi_api_rate_windows enable row level security;
revoke all on table public.xapi_api_rate_windows from anon;
revoke all on table public.xapi_api_rate_windows from authenticated;

create or replace function public.create_org_xapi_key(
  target_org_id uuid,
  target_label text,
  target_key_prefix text,
  target_key_hash text
)
returns table (
  id uuid,
  org_id uuid,
  label text,
  key_prefix text,
  status text,
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_key public.org_api_keys%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner'])
  ) then
    raise exception 'xAPI key management is not allowed';
  end if;

  if length(btrim(coalesce(target_label, ''))) not between 2 and 120 then
    raise exception 'Invalid xAPI key label';
  end if;

  if coalesce(target_key_prefix, '') !~
    '^miq_xapi_[A-F0-9]{8}$' then
    raise exception 'Invalid xAPI key prefix';
  end if;

  if coalesce(target_key_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid xAPI key hash';
  end if;

  insert into public.org_api_keys (
    org_id,
    label,
    key_prefix,
    key_hash,
    created_by
  )
  values (
    target_org_id,
    btrim(target_label),
    target_key_prefix,
    target_key_hash,
    auth.uid()
  )
  returning * into created_key;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    created_key.org_id,
    auth.uid(),
    'xapi.key_created',
    'org_api_key',
    created_key.id::text,
    jsonb_build_object(
      'label', created_key.label,
      'key_prefix', created_key.key_prefix
    )
  );

  return query
  select
    created_key.id,
    created_key.org_id,
    created_key.label,
    created_key.key_prefix,
    created_key.status,
    created_key.created_at,
    created_key.last_used_at,
    created_key.revoked_at;
end;
$$;

revoke all on function public.create_org_xapi_key(
  uuid,
  text,
  text,
  text
) from public;
revoke all on function public.create_org_xapi_key(
  uuid,
  text,
  text,
  text
) from anon;
grant execute on function public.create_org_xapi_key(
  uuid,
  text,
  text,
  text
) to authenticated;

create or replace function public.list_org_xapi_keys(
  target_org_id uuid
)
returns table (
  id uuid,
  org_id uuid,
  label text,
  key_prefix text,
  status text,
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner'])
  ) then
    raise exception 'xAPI key management is not allowed';
  end if;

  return query
  select
    api_key.id,
    api_key.org_id,
    api_key.label,
    api_key.key_prefix,
    api_key.status,
    api_key.created_at,
    api_key.last_used_at,
    api_key.revoked_at
  from public.org_api_keys as api_key
  where api_key.org_id = target_org_id
  order by api_key.created_at desc;
end;
$$;

revoke all on function public.list_org_xapi_keys(uuid) from public;
revoke all on function public.list_org_xapi_keys(uuid) from anon;
grant execute on function public.list_org_xapi_keys(uuid) to authenticated;

create or replace function public.revoke_org_xapi_key(
  target_key_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_key public.org_api_keys%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select api_key.*
  into target_key
  from public.org_api_keys as api_key
  where api_key.id = target_key_id
  for update;

  if target_key.id is null then
    raise exception 'xAPI key not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_key.org_id, array['owner'])
  ) then
    raise exception 'xAPI key management is not allowed';
  end if;

  if target_key.status = 'revoked' then
    return false;
  end if;

  update public.org_api_keys
  set
    status = 'revoked',
    revoked_at = now()
  where public.org_api_keys.id = target_key.id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_key.org_id,
    auth.uid(),
    'xapi.key_revoked',
    'org_api_key',
    target_key.id::text,
    jsonb_build_object(
      'label', target_key.label,
      'key_prefix', target_key.key_prefix
    )
  );

  return true;
end;
$$;

revoke all on function public.revoke_org_xapi_key(uuid) from public;
revoke all on function public.revoke_org_xapi_key(uuid) from anon;
grant execute on function public.revoke_org_xapi_key(uuid) to authenticated;

create or replace function public.process_xapi_statements(
  target_key_hash text,
  target_request_id uuid,
  target_statements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  contract_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/contract-version';
  program_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/program-id';
  enrollment_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id';
  scene_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/scene-id';
  object_namespace constant text :=
    'https://miqyas.al-amad.com.sa/xapi/activities/';
  allowed_verbs constant text[] := array[
    'https://miqyas.al-amad.com.sa/xapi/verbs/experience-started',
    'https://miqyas.al-amad.com.sa/xapi/verbs/scene-started',
    'https://miqyas.al-amad.com.sa/xapi/verbs/item-attempted',
    'https://miqyas.al-amad.com.sa/xapi/verbs/hint-used',
    'https://miqyas.al-amad.com.sa/xapi/verbs/scene-completed',
    'https://miqyas.al-amad.com.sa/xapi/verbs/experience-completed'
  ];
  target_api_key public.org_api_keys%rowtype;
  rate_window public.xapi_api_rate_windows%rowtype;
  current_statement jsonb;
  existing_statement public.xapi_statements%rowtype;
  existing_ingestion public.webhook_ingestions%rowtype;
  statement_index integer;
  statement_count integer;
  statement_id text;
  external_event_id text;
  trainee_code text;
  actor_home_page text;
  verb_id text;
  object_id text;
  session_id text;
  program_id_text text;
  enrollment_id_text text;
  contract_version text;
  scene_id text;
  occurred_at timestamptz;
  target_program_id uuid;
  requested_enrollment_id uuid;
  matched_enrollment_id uuid;
  ingestion_id uuid;
  rejection_reason text;
  item_status text;
  accepted_count integer := 0;
  duplicate_count integer := 0;
  unmatched_count integer := 0;
  rejected_count integer := 0;
  results jsonb := '[]'::jsonb;
begin
  if coalesce(target_key_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid organization API key';
  end if;

  if target_request_id is null then
    raise exception 'Invalid xAPI request id';
  end if;

  if jsonb_typeof(target_statements) <> 'array' then
    raise exception 'xAPI payload must be an array';
  end if;

  statement_count := jsonb_array_length(target_statements);
  if statement_count < 1 or statement_count > 100 then
    raise exception 'xAPI statement count must be between 1 and 100';
  end if;

  select api_key.*
  into target_api_key
  from public.org_api_keys as api_key
  where api_key.key_hash = target_key_hash
    and api_key.status = 'active';

  if target_api_key.id is null then
    raise exception 'Invalid or revoked organization API key';
  end if;

  insert into public.xapi_api_rate_windows (
    api_key_id,
    window_started_at,
    request_count,
    statement_count
  )
  values (
    target_api_key.id,
    date_trunc('minute', now()),
    1,
    statement_count
  )
  on conflict (api_key_id, window_started_at)
  do update
  set
    request_count =
      public.xapi_api_rate_windows.request_count + 1,
    statement_count =
      public.xapi_api_rate_windows.statement_count +
        excluded.statement_count
  returning * into rate_window;

  if rate_window.request_count > 120
    or rate_window.statement_count > 5000 then
    raise exception 'xAPI rate limit exceeded';
  end if;

  update public.org_api_keys
  set last_used_at = now()
  where public.org_api_keys.id = target_api_key.id;

  for current_statement, statement_index in
    select item.value, item.ordinality::integer
    from jsonb_array_elements(target_statements)
      with ordinality as item(value, ordinality)
  loop
    statement_id := btrim(coalesce(current_statement ->> 'id', ''));
    external_event_id := case
      when statement_id <> '' then statement_id
      else target_request_id::text || ':' || statement_index::text
    end;
    trainee_code := btrim(coalesce(
      current_statement #>> '{actor,account,name}',
      ''
    ));
    actor_home_page := btrim(coalesce(
      current_statement #>> '{actor,account,homePage}',
      ''
    ));
    verb_id := btrim(coalesce(
      current_statement #>> '{verb,id}',
      ''
    ));
    object_id := btrim(coalesce(
      current_statement #>> '{object,id}',
      ''
    ));
    session_id := btrim(coalesce(
      current_statement #>> '{context,registration}',
      ''
    ));
    program_id_text := btrim(coalesce(
      current_statement #>> array[
        'context',
        'extensions',
        program_extension
      ],
      ''
    ));
    enrollment_id_text := btrim(coalesce(
      current_statement #>> array[
        'context',
        'extensions',
        enrollment_extension
      ],
      ''
    ));
    contract_version := btrim(coalesce(
      current_statement #>> array[
        'context',
        'extensions',
        contract_extension
      ],
      ''
    ));
    scene_id := btrim(coalesce(
      current_statement #>> array[
        'context',
        'extensions',
        scene_extension
      ],
      ''
    ));
    occurred_at := null;
    target_program_id := null;
    requested_enrollment_id := null;
    matched_enrollment_id := null;
    ingestion_id := null;
    rejection_reason := null;
    item_status := null;

    if jsonb_typeof(current_statement) <> 'object' then
      rejection_reason := 'Statement must be a JSON object';
    elsif statement_id !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      rejection_reason := 'Statement id must be a UUID';
    else
      perform pg_advisory_xact_lock(
        hashtextextended('xapi:' || statement_id, 0)
      );

      select saved_statement.*
      into existing_statement
      from public.xapi_statements as saved_statement
      where saved_statement.statement_id = statement_id;

      if existing_statement.id is not null then
        if existing_statement.org_id = target_api_key.org_id
          and existing_statement.raw_statement = current_statement then
          duplicate_count := duplicate_count + 1;
          results := results || jsonb_build_array(
            jsonb_build_object(
              'statementId', statement_id,
              'status', 'duplicate'
            )
          );
        else
          rejected_count := rejected_count + 1;
          results := results || jsonb_build_array(
            jsonb_build_object(
              'statementId', statement_id,
              'status', 'rejected',
              'reason', 'Statement id collision'
            )
          );
        end if;

        continue;
      end if;

      select saved_ingestion.*
      into existing_ingestion
      from public.webhook_ingestions as saved_ingestion
      where saved_ingestion.provider = 'xapi'
        and saved_ingestion.external_event_id = statement_id;

      if existing_ingestion.id is not null then
        rejected_count := rejected_count + 1;
        results := results || jsonb_build_array(
          jsonb_build_object(
            'statementId', statement_id,
            'status', 'rejected',
            'reason', case
              when existing_ingestion.payload = current_statement
                then 'Statement was previously rejected'
              else 'Statement id collision'
            end
          )
        );
        continue;
      end if;
    end if;

    if rejection_reason is null
      and actor_home_page !~ '^https://[^[:space:]]+$' then
      rejection_reason := 'actor.account.homePage must be an HTTPS URL';
    end if;

    if rejection_reason is null
      and trainee_code !~
        '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$' then
      rejection_reason := 'actor.account.name must be AMD-XXXXX';
    end if;

    if rejection_reason is null
      and not (verb_id = any(allowed_verbs)) then
      rejection_reason := 'Unsupported xAPI verb';
    end if;

    if rejection_reason is null
      and left(object_id, length(object_namespace)) <>
        object_namespace then
      rejection_reason := 'Unsupported xAPI object id';
    end if;

    if rejection_reason is null
      and session_id !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      rejection_reason := 'context.registration must be a UUID';
    end if;

    if rejection_reason is null
      and program_id_text !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      rejection_reason := 'program-id must be a UUID';
    end if;

    if rejection_reason is null
      and enrollment_id_text !~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then
      rejection_reason := 'enrollment-id must be a UUID';
    end if;

    if rejection_reason is null and contract_version <> '1.0' then
      rejection_reason := 'Unsupported xAPI contract version';
    end if;

    if rejection_reason is null
      and scene_id !~ '^S[0-7]$' then
      rejection_reason := 'scene-id must be between S0 and S7';
    end if;

    if rejection_reason is null
      and jsonb_typeof(current_statement -> 'result') <> 'object' then
      rejection_reason := 'result must be a JSON object';
    end if;

    if rejection_reason is null then
      begin
        occurred_at := (current_statement ->> 'timestamp')::timestamptz;
      exception
        when others then
          rejection_reason := 'timestamp must be a valid ISO 8601 value';
      end;
    end if;

    if rejection_reason is null then
      target_program_id := program_id_text::uuid;
      requested_enrollment_id := enrollment_id_text::uuid;

      if not exists (
        select 1
        from public.programs as program
        where program.id = target_program_id
          and program.org_id = target_api_key.org_id
      ) then
        rejection_reason := 'Program does not belong to organization';
      end if;
    end if;

    if rejection_reason is not null then
      insert into public.webhook_ingestions (
        org_id,
        provider,
        channel,
        external_event_id,
        payload,
        status,
        attempt_count,
        last_error,
        processed_at
      )
      values (
        target_api_key.org_id,
        'xapi',
        'api',
        external_event_id,
        current_statement,
        'rejected',
        1,
        rejection_reason,
        now()
      )
      on conflict (provider, external_event_id)
      do update
      set
        status = 'rejected',
        attempt_count =
          public.webhook_ingestions.attempt_count + 1,
        last_error = excluded.last_error,
        updated_at = now(),
        processed_at = now();

      rejected_count := rejected_count + 1;
      results := results || jsonb_build_array(
        jsonb_build_object(
          'statementId',
          nullif(statement_id, ''),
          'status',
          'rejected',
          'reason',
          rejection_reason
        )
      );
      continue;
    end if;

    insert into public.webhook_ingestions (
      org_id,
      provider,
      channel,
      external_event_id,
      payload,
      status,
      attempt_count
    )
    values (
      target_api_key.org_id,
      'xapi',
      'api',
      external_event_id,
      current_statement,
      'processing',
      1
    )
    returning id into ingestion_id;

    select enrollment.id
    into matched_enrollment_id
    from public.enrollments as enrollment
    join public.trainees as trainee
      on trainee.id = enrollment.trainee_id
     and trainee.org_id = enrollment.org_id
    join public.cohorts as cohort
      on cohort.id = enrollment.cohort_id
     and cohort.org_id = enrollment.org_id
    where enrollment.id = requested_enrollment_id
      and enrollment.org_id = target_api_key.org_id
      and enrollment.status in (
        'invited',
        'active',
        'completed'
      )
      and trainee.code = trainee_code
      and trainee.status = 'active'
      and cohort.program_id = target_program_id
      and cohort.status in (
        'draft',
        'open',
        'in_progress',
        'closed'
      )
    limit 1;

    item_status := case
      when matched_enrollment_id is null then 'unmatched'
      else 'accepted'
    end;

    insert into public.xapi_statements (
      statement_id,
      org_id,
      api_key_id,
      enrollment_id,
      trainee_code_received,
      program_id,
      session_id,
      verb_id,
      object_id,
      result,
      context,
      raw_statement,
      processing_status,
      rejection_reason,
      occurred_at
    )
    values (
      statement_id,
      target_api_key.org_id,
      target_api_key.id,
      matched_enrollment_id,
      trainee_code,
      target_program_id,
      session_id,
      verb_id,
      object_id,
      current_statement -> 'result',
      current_statement -> 'context',
      current_statement,
      item_status,
      null,
      occurred_at
    );

    update public.webhook_ingestions
    set
      status = 'processed',
      processed_at = now(),
      updated_at = now(),
      last_error = case
        when item_status = 'unmatched'
          then 'Enrollment could not be matched'
        else null
      end
    where public.webhook_ingestions.id = ingestion_id;

    if item_status = 'accepted' then
      accepted_count := accepted_count + 1;
    else
      unmatched_count := unmatched_count + 1;
    end if;

    results := results || jsonb_build_array(
      jsonb_build_object(
        'statementId', statement_id,
        'status', item_status
      )
    );
  end loop;

  delete from public.xapi_api_rate_windows
  where window_started_at < now() - interval '1 day';

  return jsonb_build_object(
    'status',
    case
      when rejected_count > 0 or unmatched_count > 0
        then 'mixed'
      else 'processed'
    end,
    'accepted',
    accepted_count,
    'duplicates',
    duplicate_count,
    'unmatched',
    unmatched_count,
    'rejected',
    rejected_count,
    'results',
    results
  );
end;
$$;

revoke all on function public.process_xapi_statements(
  text,
  uuid,
  jsonb
) from public;
grant execute on function public.process_xapi_statements(
  text,
  uuid,
  jsonb
) to anon;
grant execute on function public.process_xapi_statements(
  text,
  uuid,
  jsonb
) to authenticated;

commit;
