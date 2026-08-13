begin;

alter table public.cohorts
  add constraint cohorts_id_program_org_unique
  unique (id, program_id, org_id);

create table public.operational_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  program_id uuid not null,
  cohort_id uuid not null,
  title text not null check (length(btrim(title)) between 2 and 160),
  station_key text not null
    check (station_key in ('ALL', 'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'open', 'closed', 'cancelled')),
  registration uuid not null default extensions.gen_random_uuid(),
  scheduled_for timestamptz not null default now(),
  opened_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  join_token_hash text,
  token_expires_at timestamptz,
  token_rotated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, org_id)
    references public.programs(id, org_id) on delete restrict,
  foreign key (cohort_id, program_id, org_id)
    references public.cohorts(id, program_id, org_id) on delete restrict,
  unique (id, org_id),
  unique (id, cohort_id, org_id),
  unique (registration),
  unique (join_token_hash),
  constraint operational_sessions_token_hash_check
    check (join_token_hash is null or join_token_hash ~ '^[0-9a-f]{64}$'),
  constraint operational_sessions_token_pair_check
    check (
      (join_token_hash is null and token_expires_at is null)
      or (join_token_hash is not null and token_expires_at is not null)
    ),
  constraint operational_sessions_open_state_check
    check (status <> 'open' or opened_at is not null),
  constraint operational_sessions_closed_state_check
    check (status <> 'closed' or closed_at is not null),
  constraint operational_sessions_cancelled_state_check
    check (status <> 'cancelled' or cancelled_at is not null)
);

create table public.operational_session_attendances (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  cohort_id uuid not null,
  enrollment_id uuid not null,
  identity_method text not null check (identity_method in ('email', 'phone')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (session_id, cohort_id, org_id)
    references public.operational_sessions(id, cohort_id, org_id) on delete restrict,
  foreign key (enrollment_id, cohort_id, org_id)
    references public.enrollments(id, cohort_id, org_id) on delete restrict,
  unique (session_id, enrollment_id),
  unique (id, org_id)
);

alter table public.xapi_statements
  add column operational_session_id uuid;

alter table public.xapi_statements
  add constraint xapi_statements_operational_session_fkey
  foreign key (operational_session_id, org_id)
  references public.operational_sessions(id, org_id)
  on delete restrict;

create index operational_sessions_org_status_scheduled_idx
  on public.operational_sessions (org_id, status, scheduled_for desc);
create index operational_sessions_cohort_status_idx
  on public.operational_sessions (cohort_id, status, scheduled_for desc);
create index operational_sessions_registration_idx
  on public.operational_sessions (registration);
create index operational_sessions_token_active_idx
  on public.operational_sessions (join_token_hash, token_expires_at)
  where status = 'open' and join_token_hash is not null;
create index operational_session_attendances_session_joined_idx
  on public.operational_session_attendances (session_id, joined_at desc);
create index operational_session_attendances_enrollment_idx
  on public.operational_session_attendances (enrollment_id, joined_at desc);
create index xapi_operational_session_occurred_idx
  on public.xapi_statements (operational_session_id, occurred_at)
  where operational_session_id is not null;

create trigger operational_sessions_set_updated_at
before update on public.operational_sessions
for each row execute function public.set_updated_at();

alter table public.operational_sessions enable row level security;
alter table public.operational_session_attendances enable row level security;

revoke all on table public.operational_sessions
  from public, anon, authenticated;
revoke all on table public.operational_session_attendances
  from public, anon, authenticated;

grant select (
  id,
  org_id,
  program_id,
  cohort_id,
  title,
  station_key,
  status,
  registration,
  scheduled_for,
  opened_at,
  closed_at,
  cancelled_at,
  token_expires_at,
  token_rotated_at,
  created_by,
  created_at,
  updated_at
) on table public.operational_sessions to authenticated;

grant select on table public.operational_session_attendances to authenticated;

create policy operational_sessions_select_authorized
on public.operational_sessions for select to authenticated
using (public.has_permission('sessions.read', org_id));

create policy operational_session_attendances_select_authorized
on public.operational_session_attendances for select to authenticated
using (public.has_permission('sessions.read', org_id));

create or replace function public.create_operational_session(
  target_org_id uuid,
  target_program_id uuid,
  target_cohort_id uuid,
  target_title text,
  target_station_key text,
  target_scheduled_for timestamptz,
  target_open_now boolean default false,
  target_token_hash text default null,
  target_token_expires_at timestamptz default null
)
returns table (
  id uuid,
  org_id uuid,
  program_id uuid,
  cohort_id uuid,
  title text,
  station_key text,
  status text,
  registration uuid,
  scheduled_for timestamptz,
  opened_at timestamptz,
  token_expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cohort public.cohorts%rowtype;
  created_session public.operational_sessions%rowtype;
  normalized_title text := btrim(regexp_replace(coalesce(target_title, ''), '\s+', ' ', 'g'));
  normalized_station text := upper(btrim(coalesce(target_station_key, '')));
  should_open boolean := coalesce(target_open_now, false);
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not public.has_permission('sessions.manage', target_org_id) then
    raise exception 'Session management is not allowed' using errcode = '42501';
  end if;

  if length(normalized_title) not between 2 and 160 then
    raise exception 'Invalid operational session title' using errcode = '22023';
  end if;

  if normalized_station not in ('ALL', 'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7') then
    raise exception 'Invalid operational station' using errcode = '22023';
  end if;

  select cohort.*
  into target_cohort
  from public.cohorts as cohort
  join public.programs as program
    on program.id = cohort.program_id
   and program.org_id = cohort.org_id
  where cohort.id = target_cohort_id
    and cohort.org_id = target_org_id
    and cohort.program_id = target_program_id
    and cohort.status in ('open', 'in_progress')
    and program.status = 'active'
  for update of cohort;

  if target_cohort.id is null then
    raise exception 'Active program and cohort were not found' using errcode = '22023';
  end if;

  if target_scheduled_for is null then
    raise exception 'Session schedule is required' using errcode = '22023';
  end if;

  if should_open and (
    coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
    or target_token_expires_at is null
    or target_token_expires_at <= now() + interval '5 minutes'
    or target_token_expires_at > now() + interval '8 hours'
  ) then
    raise exception 'Invalid operational session token window' using errcode = '22023';
  end if;

  insert into public.operational_sessions (
    org_id,
    program_id,
    cohort_id,
    title,
    station_key,
    status,
    scheduled_for,
    opened_at,
    join_token_hash,
    token_expires_at,
    token_rotated_at,
    created_by
  )
  values (
    target_org_id,
    target_program_id,
    target_cohort_id,
    normalized_title,
    normalized_station,
    case when should_open then 'open' else 'scheduled' end,
    target_scheduled_for,
    case when should_open then now() else null end,
    case when should_open then target_token_hash else null end,
    case when should_open then target_token_expires_at else null end,
    case when should_open then now() else null end,
    auth.uid()
  )
  returning * into created_session;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    after_data,
    metadata
  )
  values (
    created_session.org_id,
    'operational_session.created',
    'operational_session',
    created_session.id::text,
    jsonb_build_object(
      'status', created_session.status,
      'program_id', created_session.program_id,
      'cohort_id', created_session.cohort_id,
      'station_key', created_session.station_key,
      'registration', created_session.registration,
      'scheduled_for', created_session.scheduled_for
    ),
    jsonb_build_object('opened_immediately', should_open)
  );

  if should_open then
    insert into public.audit_logs (
      org_id,
      action,
      entity_type,
      entity_id,
      after_data,
      metadata
    )
    values (
      created_session.org_id,
      'operational_session.opened',
      'operational_session',
      created_session.id::text,
      jsonb_build_object(
        'status', created_session.status,
        'opened_at', created_session.opened_at,
        'token_expires_at', created_session.token_expires_at
      ),
      jsonb_build_object('token_rotated', true)
    );
  end if;

  return query
  select
    created_session.id,
    created_session.org_id,
    created_session.program_id,
    created_session.cohort_id,
    created_session.title,
    created_session.station_key,
    created_session.status,
    created_session.registration,
    created_session.scheduled_for,
    created_session.opened_at,
    created_session.token_expires_at,
    created_session.created_at;
end;
$$;

revoke all on function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz
) from public, anon;
grant execute on function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz
) to authenticated;

create or replace function public.manage_operational_session(
  target_session_id uuid,
  target_action text,
  target_token_hash text default null,
  target_token_expires_at timestamptz default null
)
returns table (
  id uuid,
  org_id uuid,
  status text,
  registration uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  token_expires_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_session public.operational_sessions%rowtype;
  normalized_action text := lower(btrim(coalesce(target_action, '')));
  previous_status text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select session.*
  into target_session
  from public.operational_sessions as session
  where session.id = target_session_id
  for update;

  if target_session.id is null then
    raise exception 'Operational session not found' using errcode = 'P0002';
  end if;

  if not public.has_permission('sessions.manage', target_session.org_id) then
    raise exception 'Session management is not allowed' using errcode = '42501';
  end if;

  previous_status := target_session.status;

  if normalized_action in ('open', 'rotate') then
    if (normalized_action = 'open' and target_session.status <> 'scheduled')
      or (normalized_action = 'rotate' and target_session.status <> 'open') then
      raise exception 'Session cannot issue a token in its current state' using errcode = '55000';
    end if;

    if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
      or target_token_expires_at is null
      or target_token_expires_at <= now() + interval '5 minutes'
      or target_token_expires_at > now() + interval '8 hours' then
      raise exception 'Invalid operational session token window' using errcode = '22023';
    end if;

    update public.operational_sessions as session
    set
      status = 'open',
      opened_at = coalesce(session.opened_at, now()),
      join_token_hash = target_token_hash,
      token_expires_at = target_token_expires_at,
      token_rotated_at = now()
    where session.id = target_session.id
    returning * into target_session;
  elsif normalized_action = 'close' then
    if target_session.status <> 'open' then
      raise exception 'Only an open session can be closed' using errcode = '55000';
    end if;

    update public.operational_sessions as session
    set
      status = 'closed',
      closed_at = now(),
      join_token_hash = null,
      token_expires_at = null
    where session.id = target_session.id
    returning * into target_session;
  elsif normalized_action = 'cancel' then
    if target_session.status not in ('scheduled', 'open') then
      raise exception 'Session cannot be cancelled in its current state' using errcode = '55000';
    end if;

    update public.operational_sessions as session
    set
      status = 'cancelled',
      cancelled_at = now(),
      join_token_hash = null,
      token_expires_at = null
    where session.id = target_session.id
    returning * into target_session;
  else
    raise exception 'Unsupported operational session action' using errcode = '22023';
  end if;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  )
  values (
    target_session.org_id,
    case normalized_action
      when 'open' then 'operational_session.opened'
      when 'rotate' then 'operational_session.token_rotated'
      when 'close' then 'operational_session.closed'
      else 'operational_session.cancelled'
    end,
    'operational_session',
    target_session.id::text,
    jsonb_build_object('status', previous_status),
    jsonb_build_object(
      'status', target_session.status,
      'opened_at', target_session.opened_at,
      'closed_at', target_session.closed_at,
      'cancelled_at', target_session.cancelled_at,
      'token_expires_at', target_session.token_expires_at
    ),
    jsonb_build_object('token_rotated', normalized_action in ('open', 'rotate'))
  );

  return query
  select
    target_session.id,
    target_session.org_id,
    target_session.status,
    target_session.registration,
    target_session.opened_at,
    target_session.closed_at,
    target_session.cancelled_at,
    target_session.token_expires_at,
    target_session.updated_at;
end;
$$;

revoke all on function public.manage_operational_session(
  uuid, text, text, timestamptz
) from public, anon;
grant execute on function public.manage_operational_session(
  uuid, text, text, timestamptz
) to authenticated;

create or replace function public.list_operational_sessions(
  target_org_id uuid
)
returns table (
  id uuid,
  org_id uuid,
  program_id uuid,
  cohort_id uuid,
  program_title text,
  cohort_title text,
  title text,
  station_key text,
  status text,
  registration uuid,
  scheduled_for timestamptz,
  opened_at timestamptz,
  closed_at timestamptz,
  cancelled_at timestamptz,
  token_expires_at timestamptz,
  attendance_count bigint,
  attendees jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  if not public.has_permission('sessions.read', target_org_id) then
    raise exception 'Session reading is not allowed' using errcode = '42501';
  end if;

  return query
  select
    session.id,
    session.org_id,
    session.program_id,
    session.cohort_id,
    program.title_ar,
    cohort.title,
    session.title,
    session.station_key,
    session.status,
    session.registration,
    session.scheduled_for,
    session.opened_at,
    session.closed_at,
    session.cancelled_at,
    session.token_expires_at,
    count(attendance.id),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'attendanceId', attendance.id,
          'enrollmentId', enrollment.id,
          'traineeCode', trainee.code,
          'traineeName', trainee.full_name,
          'joinedAt', attendance.joined_at
        ) order by attendance.joined_at desc
      ) filter (where attendance.id is not null),
      '[]'::jsonb
    ),
    session.created_at,
    session.updated_at
  from public.operational_sessions as session
  join public.programs as program
    on program.id = session.program_id
   and program.org_id = session.org_id
  join public.cohorts as cohort
    on cohort.id = session.cohort_id
   and cohort.org_id = session.org_id
  left join public.operational_session_attendances as attendance
    on attendance.session_id = session.id
   and attendance.org_id = session.org_id
  left join public.enrollments as enrollment
    on enrollment.id = attendance.enrollment_id
   and enrollment.org_id = attendance.org_id
  left join public.trainees as trainee
    on trainee.id = enrollment.trainee_id
   and trainee.org_id = enrollment.org_id
  where session.org_id = target_org_id
  group by session.id, program.title_ar, cohort.title
  order by session.scheduled_for desc, session.created_at desc
  limit 100;
end;
$$;

revoke all on function public.list_operational_sessions(uuid)
  from public, anon;
grant execute on function public.list_operational_sessions(uuid)
  to authenticated;

alter table public.public_api_rate_windows
  drop constraint public_api_rate_windows_scope_check;
alter table public.public_api_rate_windows
  add constraint public_api_rate_windows_scope_check
  check (
    scope in (
      'trainee_route',
      'assessment_link',
      'access_request',
      'session_scan',
      'session_join'
    )
  );

create or replace function public.consume_public_api_rate_limit(
  target_fingerprint text,
  target_scope text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  window_seconds integer;
  maximum_requests integer;
  current_window timestamptz;
  current_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  if coalesce(target_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid public request fingerprint is required';
  end if;

  case target_scope
    when 'trainee_route' then
      window_seconds := 300;
      maximum_requests := 20;
    when 'assessment_link' then
      window_seconds := 600;
      maximum_requests := 6;
    when 'access_request' then
      window_seconds := 86400;
      maximum_requests := 10;
    when 'session_scan' then
      window_seconds := 300;
      maximum_requests := 30;
    when 'session_join' then
      window_seconds := 600;
      maximum_requests := 8;
    else
      raise exception 'Invalid public rate-limit scope';
  end case;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / window_seconds)
      * window_seconds
  );

  insert into public.public_api_rate_windows (
    fingerprint,
    scope,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    target_fingerprint,
    target_scope,
    current_window,
    1,
    now()
  )
  on conflict (fingerprint, scope, window_started_at)
  do update
  set
    request_count = public.public_api_rate_windows.request_count + 1,
    updated_at = now()
  returning request_count into current_count;

  delete from public.public_api_rate_windows
  where window_started_at < now() - interval '2 days';

  return current_count <= maximum_requests;
end;
$$;

revoke all on function public.consume_public_api_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_public_api_rate_limit(text, text)
  to service_role;

create or replace function public.get_public_operational_session(
  target_token_hash text
)
returns table (
  session_id uuid,
  title text,
  program_title text,
  cohort_title text,
  station_key text,
  token_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_session public.operational_sessions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select session.*
  into target_session
  from public.operational_sessions as session
  where session.join_token_hash = target_token_hash
    and session.status = 'open'
    and session.token_expires_at > now();

  if target_session.id is null then
    return;
  end if;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_session.org_id,
    'operational_session.scanned',
    'operational_session',
    target_session.id::text,
    jsonb_build_object('station_key', target_session.station_key)
  );

  return query
  select
    target_session.id,
    target_session.title,
    program.title_ar,
    cohort.title,
    target_session.station_key,
    target_session.token_expires_at
  from public.programs as program
  join public.cohorts as cohort
    on cohort.id = target_session.cohort_id
   and cohort.org_id = target_session.org_id
  where program.id = target_session.program_id
    and program.org_id = target_session.org_id;
end;
$$;

revoke all on function public.get_public_operational_session(text)
  from public, anon, authenticated;
grant execute on function public.get_public_operational_session(text)
  to service_role;

create or replace function public.join_public_operational_session(
  target_token_hash text,
  target_trainee_code text,
  target_identity_value text
)
returns table (
  attendance_id uuid,
  session_id uuid,
  enrollment_id uuid,
  trainee_code text,
  trainee_name text,
  program_id uuid,
  registration uuid,
  station_key text,
  joined_at timestamptz,
  already_joined boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_session public.operational_sessions%rowtype;
  target_enrollment public.enrollments%rowtype;
  target_trainee public.trainees%rowtype;
  saved_attendance public.operational_session_attendances%rowtype;
  normalized_code text := upper(btrim(coalesce(target_trainee_code, '')));
  normalized_identity text := lower(btrim(coalesce(target_identity_value, '')));
  identity_digits text := regexp_replace(coalesce(target_identity_value, ''), '[^0-9]', '', 'g');
  matched_method text;
  was_already_joined boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
    or normalized_code !~ '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'
    or length(normalized_identity) not between 5 and 254 then
    raise exception 'Session identity could not be verified' using errcode = '22023';
  end if;

  select session.*
  into target_session
  from public.operational_sessions as session
  join public.cohorts as cohort
    on cohort.id = session.cohort_id
   and cohort.org_id = session.org_id
   and cohort.status in ('open', 'in_progress')
  where session.join_token_hash = target_token_hash
    and session.status = 'open'
    and session.token_expires_at > now()
  for update of session;

  if target_session.id is null then
    raise exception 'Session identity could not be verified' using errcode = '22023';
  end if;

  select enrollment.*
  into target_enrollment
  from public.enrollments as enrollment
  join public.trainees as trainee
    on trainee.id = enrollment.trainee_id
   and trainee.org_id = enrollment.org_id
  where enrollment.org_id = target_session.org_id
    and enrollment.cohort_id = target_session.cohort_id
    and enrollment.status = 'active'
    and trainee.code = normalized_code
    and trainee.status = 'active'
  limit 1;

  if target_enrollment.id is null then
    raise exception 'Session identity could not be verified' using errcode = '22023';
  end if;

  select trainee.*
  into target_trainee
  from public.trainees as trainee
  where trainee.id = target_enrollment.trainee_id
    and trainee.org_id = target_enrollment.org_id;

  if target_trainee.id is null then
    raise exception 'Session identity could not be verified' using errcode = '22023';
  end if;

  if target_trainee.email is not null
    and lower(btrim(target_trainee.email)) = normalized_identity then
    matched_method := 'email';
  elsif target_trainee.phone is not null
    and length(identity_digits) >= 9
    and regexp_replace(target_trainee.phone, '[^0-9]', '', 'g') = identity_digits then
    matched_method := 'phone';
  else
    raise exception 'Session identity could not be verified' using errcode = '22023';
  end if;

  insert into public.operational_session_attendances (
    org_id,
    session_id,
    cohort_id,
    enrollment_id,
    identity_method
  )
  values (
    target_session.org_id,
    target_session.id,
    target_session.cohort_id,
    target_enrollment.id,
    matched_method
  )
  on conflict on constraint operational_session_attendances_session_id_enrollment_id_key do nothing
  returning * into saved_attendance;

  if saved_attendance.id is not null then
    insert into public.audit_logs (
      org_id,
      action,
      entity_type,
      entity_id,
      after_data,
      metadata
    )
    values (
      target_session.org_id,
      'operational_session.joined',
      'operational_session_attendance',
      saved_attendance.id::text,
      jsonb_build_object(
        'session_id', target_session.id,
        'enrollment_id', target_enrollment.id,
        'joined_at', saved_attendance.joined_at
      ),
      jsonb_build_object('identity_method', matched_method)
    );
  else
    select attendance.*
    into saved_attendance
    from public.operational_session_attendances as attendance
    where attendance.session_id = target_session.id
      and attendance.enrollment_id = target_enrollment.id;

    was_already_joined := true;
  end if;

  return query
  select
    saved_attendance.id,
    target_session.id,
    target_enrollment.id,
    target_trainee.code,
    target_trainee.full_name,
    target_session.program_id,
    target_session.registration,
    target_session.station_key,
    saved_attendance.joined_at,
    was_already_joined;
end;
$$;

revoke all on function public.join_public_operational_session(text, text, text)
  from public, anon, authenticated;
grant execute on function public.join_public_operational_session(text, text, text)
  to service_role;

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
declare
  test_event_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/test-event';
  program_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/program-id';
  enrollment_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id';
  scene_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/scene-id';
  target_api_key public.org_api_keys%rowtype;
  current_statement jsonb;
  statement_index integer;
  statement_id text;
  registration_text text;
  enrollment_text text;
  program_text text;
  scene_text text;
  trainee_code text;
  external_event_id text;
  is_test_event boolean;
  is_existing_statement boolean;
  operationally_matched boolean;
  allowed_statements jsonb := '[]'::jsonb;
  blocked_results jsonb := '[]'::jsonb;
  processing_result jsonb;
  blocked_count integer := 0;
  accepted_count integer;
  duplicate_count integer;
  unmatched_count integer;
  rejected_count integer;
  final_status text;
  processing_outcome text;
  processing_severity text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;

  if target_request_id is null then
    raise exception 'Invalid xAPI request id';
  end if;

  if jsonb_typeof(target_statements) <> 'array'
    or jsonb_array_length(target_statements) not between 1 and 100 then
    raise exception 'xAPI statement count must be between 1 and 100';
  end if;

  select api_key.*
  into target_api_key
  from public.org_api_keys as api_key
  join public.organizations as organization
    on organization.id = api_key.org_id
   and organization.status = 'active'
  where api_key.key_hash = target_key_hash
    and api_key.status = 'active'
  for update of api_key;

  if target_api_key.id is null then
    raise exception 'Invalid or revoked organization API key';
  end if;

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
    registration_text := btrim(coalesce(
      current_statement #>> '{context,registration}',
      ''
    ));
    enrollment_text := btrim(coalesce(current_statement #>> array[
      'context', 'extensions', enrollment_extension
    ], ''));
    program_text := btrim(coalesce(current_statement #>> array[
      'context', 'extensions', program_extension
    ], ''));
    scene_text := btrim(coalesce(current_statement #>> array[
      'context', 'extensions', scene_extension
    ], ''));
    trainee_code := btrim(coalesce(
      current_statement #>> '{actor,account,name}',
      ''
    ));
    is_test_event := lower(coalesce(current_statement #>> array[
      'context', 'extensions', test_event_extension
    ], 'false')) = 'true';

    select exists (
      select 1
      from public.xapi_statements as statement
      where statement.statement_id = statement_id
    ) into is_existing_statement;

    operationally_matched := false;
    if not is_test_event
      and not is_existing_statement
      and registration_text ~ '^[0-9a-fA-F-]{36}$'
      and enrollment_text ~ '^[0-9a-fA-F-]{36}$'
      and program_text ~ '^[0-9a-fA-F-]{36}$'
      and scene_text ~ '^S[0-7]$'
      and trainee_code ~ '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$' then
      begin
        select exists (
          select 1
          from public.operational_sessions as session
          join public.operational_session_attendances as attendance
            on attendance.session_id = session.id
           and attendance.org_id = session.org_id
          join public.enrollments as enrollment
            on enrollment.id = attendance.enrollment_id
           and enrollment.org_id = attendance.org_id
          join public.trainees as trainee
            on trainee.id = enrollment.trainee_id
           and trainee.org_id = enrollment.org_id
          where session.org_id = target_api_key.org_id
            and session.registration = registration_text::uuid
            and session.program_id = program_text::uuid
            and session.status = 'open'
            and attendance.enrollment_id = enrollment_text::uuid
            and enrollment.cohort_id = session.cohort_id
            and enrollment.status = 'active'
            and trainee.code = trainee_code
            and trainee.status = 'active'
            and (session.station_key = 'ALL' or session.station_key = scene_text)
        ) into operationally_matched;
      exception
        when invalid_text_representation then
          operationally_matched := false;
      end;
    end if;

    if is_test_event
      or is_existing_statement
      or operationally_matched
      or registration_text !~ '^[0-9a-fA-F-]{36}$'
      or enrollment_text !~ '^[0-9a-fA-F-]{36}$'
      or program_text !~ '^[0-9a-fA-F-]{36}$'
      or scene_text !~ '^S[0-7]$'
      or trainee_code !~ '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$' then
      allowed_statements := allowed_statements || jsonb_build_array(current_statement);
    else
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
        'Operational session or attendance could not be matched',
        now()
      )
      on conflict (provider, external_event_id)
      do update set
        status = 'rejected',
        attempt_count = public.webhook_ingestions.attempt_count + 1,
        last_error = excluded.last_error,
        updated_at = now(),
        processed_at = now();

      blocked_count := blocked_count + 1;
      blocked_results := blocked_results || jsonb_build_array(
        jsonb_build_object(
          'statementId', nullif(statement_id, ''),
          'status', 'rejected',
          'reason', 'Operational session or attendance could not be matched'
        )
      );
    end if;
  end loop;

  if jsonb_array_length(allowed_statements) > 0 then
    processing_result := public.process_xapi_statements_internal(
      target_key_hash,
      target_request_id,
      allowed_statements
    );
  else
    processing_result := jsonb_build_object(
      'status', 'mixed',
      'accepted', 0,
      'duplicates', 0,
      'unmatched', 0,
      'rejected', 0,
      'results', '[]'::jsonb
    );
  end if;

  update public.xapi_statements as statement
  set operational_session_id = session.id
  from public.operational_sessions as session
  where statement.org_id = target_api_key.org_id
    and statement.statement_id in (
      select item.value ->> 'id'
      from jsonb_array_elements(allowed_statements) as item(value)
    )
    and statement.operational_session_id is null
    and session.org_id = statement.org_id
    and session.registration::text = statement.session_id
    and exists (
      select 1
      from public.operational_session_attendances as attendance
      where attendance.session_id = session.id
        and attendance.org_id = session.org_id
        and attendance.enrollment_id = statement.enrollment_id
    );

  accepted_count := coalesce((processing_result ->> 'accepted')::integer, 0);
  duplicate_count := coalesce((processing_result ->> 'duplicates')::integer, 0);
  unmatched_count := coalesce((processing_result ->> 'unmatched')::integer, 0);
  rejected_count := coalesce((processing_result ->> 'rejected')::integer, 0) + blocked_count;
  final_status := case
    when rejected_count > 0 or unmatched_count > 0 then 'mixed'
    else 'processed'
  end;

  processing_result := jsonb_build_object(
    'status', final_status,
    'accepted', accepted_count,
    'duplicates', duplicate_count,
    'unmatched', unmatched_count,
    'rejected', rejected_count,
    'results', coalesce(processing_result -> 'results', '[]'::jsonb) || blocked_results
  );

  processing_outcome := case when final_status = 'mixed' then 'partial' else 'success' end;
  processing_severity := case
    when rejected_count > 0 or unmatched_count > 0 then 'warning'
    else 'info'
  end;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    request_id,
    after_data,
    outcome,
    severity,
    metadata
  )
  values (
    target_api_key.org_id,
    'xapi.batch_processed',
    'xapi_batch',
    target_request_id::text,
    target_request_id,
    jsonb_build_object(
      'status', final_status,
      'accepted', accepted_count,
      'duplicates', duplicate_count,
      'unmatched', unmatched_count,
      'rejected', rejected_count
    ),
    processing_outcome,
    processing_severity,
    jsonb_build_object(
      'source', 'xapi_ingestion',
      'key_prefix', target_api_key.key_prefix,
      'statement_count', jsonb_array_length(target_statements)
    )
  );

  return processing_result;
end;
$$;

revoke all on function public.process_xapi_statements(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.process_xapi_statements(text, uuid, jsonb)
  to service_role;

revoke select on table public.xapi_statements from authenticated;
grant select (
  id,
  statement_id,
  org_id,
  enrollment_id,
  trainee_code_received,
  program_id,
  operational_session_id,
  session_id,
  verb_id,
  object_id,
  result,
  context,
  processing_status,
  rejection_reason,
  occurred_at,
  received_at
) on table public.xapi_statements to authenticated;

comment on table public.operational_sessions is
  'Tenant-scoped field sessions with opaque expiring join tokens and xAPI registrations.';
comment on table public.operational_session_attendances is
  'Verified trainee attendance for operational sessions; session token alone never proves identity.';
comment on function public.join_public_operational_session(text, text, text) is
  'Verifies an active cohort enrollment using the trainee code plus the exact registered email or phone.';

commit;
