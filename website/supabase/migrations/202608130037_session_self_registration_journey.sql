begin;

alter table public.operational_sessions
  add column allow_self_registration boolean not null default false;

alter table public.operational_session_attendances
  add column registration_source text not null default 'existing'
    check (registration_source in ('existing', 'self_registration')),
  add column identity_assurance text not null default 'contact_match'
    check (identity_assurance in ('contact_match', 'self_asserted')),
  add column consented_at timestamptz;

alter table public.operational_session_attendances
  add constraint operational_session_attendance_registration_check
  check (
    (registration_source = 'existing' and identity_assurance = 'contact_match' and consented_at is null)
    or
    (registration_source = 'self_registration' and identity_assurance = 'self_asserted' and consented_at is not null)
  );

alter table public.operational_session_attendances
  add constraint operational_session_attendances_id_session_org_unique
  unique (id, session_id, org_id);

create table public.operational_session_access_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  org_id uuid not null,
  session_id uuid not null,
  attendance_id uuid not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  foreign key (session_id, org_id)
    references public.operational_sessions(id, org_id) on delete restrict,
  foreign key (attendance_id, session_id, org_id)
    references public.operational_session_attendances(id, session_id, org_id) on delete restrict,
  constraint operational_session_access_token_expiry_check
    check (expires_at > created_at),
  constraint operational_session_access_token_revocation_check
    check (revoked_at is null or revoked_at >= created_at)
);

create index operational_session_access_tokens_lookup_idx
  on public.operational_session_access_tokens (token_hash, expires_at)
  where revoked_at is null;

alter table public.operational_session_access_tokens enable row level security;
revoke all on table public.operational_session_access_tokens
  from public, anon, authenticated, service_role;

create trigger operational_sessions_require_active_org
before insert or update or delete on public.operational_sessions
for each row execute function public.enforce_active_organization_write();

create trigger operational_session_attendances_require_active_org
before insert or update or delete on public.operational_session_attendances
for each row execute function public.enforce_active_organization_write();

create trigger operational_session_access_tokens_require_active_org
before insert or update or delete on public.operational_session_access_tokens
for each row execute function public.enforce_active_organization_write();

drop function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz
);

create function public.create_operational_session(
  target_org_id uuid,
  target_program_id uuid,
  target_cohort_id uuid,
  target_title text,
  target_station_key text,
  target_scheduled_for timestamptz,
  target_open_now boolean default false,
  target_token_hash text default null,
  target_token_expires_at timestamptz default null,
  target_allow_self_registration boolean default false
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
  allow_self_registration boolean,
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
  allows_registration boolean := coalesce(target_allow_self_registration, false);
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
    and cohort.status in ('draft', 'open', 'in_progress')
    and program.status in ('draft', 'active')
  for update of cohort;

  if target_cohort.id is null then
    raise exception 'Available program and cohort were not found' using errcode = '22023';
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
    org_id, program_id, cohort_id, title, station_key, status,
    scheduled_for, opened_at, join_token_hash, token_expires_at,
    token_rotated_at, allow_self_registration, created_by
  )
  values (
    target_org_id, target_program_id, target_cohort_id, normalized_title,
    normalized_station, case when should_open then 'open' else 'scheduled' end,
    target_scheduled_for, case when should_open then now() else null end,
    case when should_open then target_token_hash else null end,
    case when should_open then target_token_expires_at else null end,
    case when should_open then now() else null end,
    allows_registration, auth.uid()
  )
  returning * into created_session;

  insert into public.audit_logs (
    org_id, action, entity_type, entity_id, after_data, metadata
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
      'scheduled_for', created_session.scheduled_for,
      'allow_self_registration', created_session.allow_self_registration
    ),
    jsonb_build_object('opened_immediately', should_open)
  );

  if should_open then
    insert into public.audit_logs (
      org_id, action, entity_type, entity_id, after_data, metadata
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
  select created_session.id, created_session.org_id, created_session.program_id,
    created_session.cohort_id, created_session.title, created_session.station_key,
    created_session.status, created_session.registration, created_session.scheduled_for,
    created_session.opened_at, created_session.token_expires_at,
    created_session.allow_self_registration, created_session.created_at;
end;
$$;

revoke all on function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz, boolean
) from public, anon;
grant execute on function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz, boolean
) to authenticated;

comment on function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz, boolean
) is 'Creates an audited repeated operational session and explicitly controls public self-registration.';

drop function public.list_operational_sessions(uuid);

create function public.list_operational_sessions(target_org_id uuid)
returns table (
  id uuid, org_id uuid, program_id uuid, cohort_id uuid,
  program_title text, cohort_title text, title text, station_key text,
  status text, registration uuid, scheduled_for timestamptz, opened_at timestamptz,
  closed_at timestamptz, cancelled_at timestamptz, token_expires_at timestamptz,
  allow_self_registration boolean, attendance_count bigint, attendees jsonb,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.has_permission('sessions.read', target_org_id) then
    raise exception 'Session reading is not allowed' using errcode = '42501';
  end if;

  return query
  select session.id, session.org_id, session.program_id, session.cohort_id,
    program.title_ar, cohort.title, session.title, session.station_key,
    session.status, session.registration, session.scheduled_for, session.opened_at,
    session.closed_at, session.cancelled_at, session.token_expires_at,
    session.allow_self_registration, count(attendance.id),
    coalesce(jsonb_agg(jsonb_build_object(
      'attendanceId', attendance.id,
      'enrollmentId', enrollment.id,
      'traineeCode', trainee.code,
      'traineeName', trainee.full_name,
      'joinedAt', attendance.joined_at,
      'registrationSource', attendance.registration_source,
      'identityAssurance', attendance.identity_assurance
    ) order by attendance.joined_at desc) filter (where attendance.id is not null), '[]'::jsonb),
    session.created_at, session.updated_at
  from public.operational_sessions as session
  join public.programs as program on program.id = session.program_id and program.org_id = session.org_id
  join public.cohorts as cohort on cohort.id = session.cohort_id and cohort.org_id = session.org_id
  left join public.operational_session_attendances as attendance
    on attendance.session_id = session.id and attendance.org_id = session.org_id
  left join public.enrollments as enrollment
    on enrollment.id = attendance.enrollment_id and enrollment.org_id = attendance.org_id
  left join public.trainees as trainee
    on trainee.id = enrollment.trainee_id and trainee.org_id = enrollment.org_id
  where session.org_id = target_org_id
  group by session.id, program.title_ar, cohort.title
  order by session.scheduled_for desc, session.created_at desc
  limit 100;
end;
$$;

revoke all on function public.list_operational_sessions(uuid) from public, anon;
grant execute on function public.list_operational_sessions(uuid) to authenticated;

drop function public.get_public_operational_session(text);

create function public.get_public_operational_session(target_token_hash text)
returns table (
  session_id uuid, title text, program_title text, cohort_title text,
  station_key text, token_expires_at timestamptz, allow_self_registration boolean
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
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$' then return; end if;

  select session.* into target_session
  from public.operational_sessions as session
  where session.join_token_hash = target_token_hash
    and session.status = 'open' and session.token_expires_at > now();
  if target_session.id is null then return; end if;

  insert into public.audit_logs (org_id, action, entity_type, entity_id, metadata)
  values (target_session.org_id, 'operational_session.scanned', 'operational_session',
    target_session.id::text, jsonb_build_object('station_key', target_session.station_key));

  return query
  select target_session.id, target_session.title, program.title_ar, cohort.title,
    target_session.station_key, target_session.token_expires_at,
    target_session.allow_self_registration
  from public.programs as program
  join public.cohorts as cohort
    on cohort.id = target_session.cohort_id and cohort.org_id = target_session.org_id
  where program.id = target_session.program_id and program.org_id = target_session.org_id;
end;
$$;

revoke all on function public.get_public_operational_session(text)
  from public, anon, authenticated;
grant execute on function public.get_public_operational_session(text) to service_role;

create function public.register_public_operational_session(
  target_token_hash text,
  target_full_name text,
  target_email text,
  target_phone text,
  target_consent boolean,
  target_access_token_hash text,
  target_access_expires_at timestamptz
)
returns table (
  attendance_id uuid, session_id uuid, enrollment_id uuid, trainee_code text,
  trainee_name text, program_id uuid, registration uuid, station_key text,
  joined_at timestamptz, already_joined boolean, created_trainee boolean,
  identity_assurance text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_session public.operational_sessions%rowtype;
  created_trainee_row public.trainees%rowtype;
  created_enrollment public.enrollments%rowtype;
  created_attendance public.operational_session_attendances%rowtype;
  normalized_name text := btrim(regexp_replace(coalesce(target_full_name, ''), '\s+', ' ', 'g'));
  normalized_email text := nullif(lower(btrim(coalesce(target_email, ''))), '');
  normalized_phone text := nullif(regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g'), '');
  matched_method text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(target_access_token_hash, '') !~ '^[0-9a-f]{64}$'
    or target_access_expires_at <= now() + interval '5 minutes'
    or target_access_expires_at > now() + interval '12 hours'
    or length(normalized_name) not between 2 and 200
    or not coalesce(target_consent, false) then
    raise exception 'Self-registration data is invalid' using errcode = '22023';
  end if;
  if normalized_email is null and normalized_phone is null then
    raise exception 'Email or phone is required' using errcode = '22023';
  end if;
  if normalized_email is not null
    and normalized_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Email is invalid' using errcode = '22023';
  end if;
  if normalized_phone is not null and length(normalized_phone) not between 9 and 15 then
    raise exception 'Phone is invalid' using errcode = '22023';
  end if;

  select session.* into target_session
  from public.operational_sessions as session
  join public.cohorts as cohort
    on cohort.id = session.cohort_id and cohort.org_id = session.org_id
   and cohort.status in ('draft', 'open', 'in_progress')
  where session.join_token_hash = target_token_hash
    and session.status = 'open'
    and session.token_expires_at > now()
    and session.allow_self_registration
  for update of session;
  if target_session.id is null then
    raise exception 'Session does not accept self-registration' using errcode = '22023';
  end if;

  -- Serialize public creation inside one organization so concurrent requests
  -- cannot bypass the duplicate phone/email check.
  perform pg_advisory_xact_lock(hashtextextended(target_session.org_id::text, 0));

  if exists (
    select 1 from public.trainees as trainee
    where trainee.org_id = target_session.org_id and trainee.status <> 'archived'
      and (
        (normalized_email is not null and lower(trainee.email) = normalized_email)
        or
        (normalized_phone is not null and regexp_replace(coalesce(trainee.phone, ''), '[^0-9]', '', 'g') = normalized_phone)
      )
  ) then
    raise exception 'Existing trainee must use verified join' using errcode = '23505';
  end if;

  insert into public.trainees (org_id, code, full_name, phone, email, status, created_by)
  values (target_session.org_id, public.generate_trainee_code(), normalized_name,
    normalized_phone, normalized_email, 'active', null)
  returning * into created_trainee_row;

  insert into public.enrollments (org_id, cohort_id, trainee_id, status, created_by)
  values (target_session.org_id, target_session.cohort_id, created_trainee_row.id, 'active', null)
  returning * into created_enrollment;

  matched_method := case when normalized_email is not null then 'email' else 'phone' end;
  insert into public.operational_session_attendances (
    org_id, session_id, cohort_id, enrollment_id, identity_method,
    registration_source, identity_assurance, consented_at
  ) values (
    target_session.org_id, target_session.id, target_session.cohort_id,
    created_enrollment.id, matched_method, 'self_registration', 'self_asserted', now()
  ) returning * into created_attendance;

  insert into public.operational_session_access_tokens (
    org_id, session_id, attendance_id, token_hash, expires_at
  ) values (
    target_session.org_id, target_session.id, created_attendance.id,
    target_access_token_hash, target_access_expires_at
  );

  insert into public.audit_logs (org_id, action, entity_type, entity_id, after_data, metadata)
  values
    (target_session.org_id, 'trainee.self_registered', 'trainee', created_trainee_row.id::text,
      jsonb_build_object('code', created_trainee_row.code, 'status', created_trainee_row.status),
      jsonb_build_object('session_id', target_session.id, 'contact_method', matched_method, 'contact_verified', false)),
    (target_session.org_id, 'enrollment.self_registered', 'enrollment', created_enrollment.id::text,
      jsonb_build_object('cohort_id', created_enrollment.cohort_id, 'status', created_enrollment.status),
      jsonb_build_object('session_id', target_session.id)),
    (target_session.org_id, 'operational_session.joined', 'operational_session_attendance', created_attendance.id::text,
      jsonb_build_object('session_id', target_session.id, 'enrollment_id', created_enrollment.id,
        'joined_at', created_attendance.joined_at),
      jsonb_build_object('identity_method', matched_method, 'identity_assurance', 'self_asserted',
        'registration_source', 'self_registration'));

  return query select created_attendance.id, target_session.id, created_enrollment.id,
    created_trainee_row.code, created_trainee_row.full_name, target_session.program_id,
    target_session.registration, target_session.station_key, created_attendance.joined_at,
    false, true, 'self_asserted';
end;
$$;

revoke all on function public.register_public_operational_session(text, text, text, text, boolean, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.register_public_operational_session(text, text, text, text, boolean, text, timestamptz)
  to service_role;

create function public.issue_operational_session_access_token(
  target_attendance_id uuid,
  target_token_hash text,
  target_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_attendance public.operational_session_attendances%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if coalesce(target_token_hash, '') !~ '^[0-9a-f]{64}$'
    or target_expires_at <= now() + interval '5 minutes'
    or target_expires_at > now() + interval '12 hours' then
    raise exception 'Invalid participant access window' using errcode = '22023';
  end if;

  select attendance.* into target_attendance
  from public.operational_session_attendances as attendance
  join public.operational_sessions as session
    on session.id = attendance.session_id and session.org_id = attendance.org_id
   and session.status = 'open'
  where attendance.id = target_attendance_id;
  if target_attendance.id is null then
    raise exception 'Attendance is unavailable' using errcode = '22023';
  end if;

  insert into public.operational_session_access_tokens (
    org_id, session_id, attendance_id, token_hash, expires_at
  ) values (
    target_attendance.org_id, target_attendance.session_id, target_attendance.id,
    target_token_hash, target_expires_at
  );
  return true;
end;
$$;

revoke all on function public.issue_operational_session_access_token(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.issue_operational_session_access_token(uuid, text, timestamptz)
  to service_role;

create function public.get_operational_session_journey(target_access_token_hash text)
returns table (
  session_id uuid, title text, program_title text, cohort_title text,
  station_key text, registration uuid, attendance_id uuid, enrollment_id uuid,
  trainee_code text, trainee_name text, pre_completed boolean,
  live_event_count bigint, post_completed boolean, report_ready boolean,
  certificate_ready boolean, certificate_verify_code text,
  access_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  access_record public.operational_session_access_tokens%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if coalesce(target_access_token_hash, '') !~ '^[0-9a-f]{64}$' then return; end if;

  select access_token.* into access_record
  from public.operational_session_access_tokens as access_token
  where access_token.token_hash = target_access_token_hash
    and access_token.revoked_at is null and access_token.expires_at > now()
  for update;
  if access_record.id is null then return; end if;

  update public.operational_session_access_tokens
  set last_used_at = now() where id = access_record.id;

  return query
  select session.id, session.title, program.title_ar, cohort.title,
    session.station_key, session.registration, attendance.id, enrollment.id,
    trainee.code, trainee.full_name,
    exists(select 1 from public.assessments a where a.enrollment_id = enrollment.id and a.assessment_kind = 'pre'),
    (select count(*) from public.xapi_statements x
      where x.operational_session_id = session.id
        and x.enrollment_id = enrollment.id
        and x.processing_status = 'accepted'
        and coalesce(x.context #>> array[
          'extensions',
          'https://miqyas.al-amad.com.sa/xapi/extensions/test-event'
        ], 'false') <> 'true'),
    exists(select 1 from public.assessments a where a.enrollment_id = enrollment.id and a.assessment_kind = 'post'),
    exists(select 1 from public.impact_reports r
      where r.enrollment_id = enrollment.id and r.status = 'computed'),
    exists(select 1 from public.certificates c where c.enrollment_id = enrollment.id and c.status = 'valid'),
    (select c.verify_code from public.certificates c
      where c.enrollment_id = enrollment.id and c.status = 'valid'
      order by c.issued_at desc limit 1),
    access_record.expires_at
  from public.operational_session_attendances as attendance
  join public.operational_sessions as session
    on session.id = attendance.session_id and session.org_id = attendance.org_id
  join public.enrollments as enrollment
    on enrollment.id = attendance.enrollment_id and enrollment.org_id = attendance.org_id
  join public.trainees as trainee
    on trainee.id = enrollment.trainee_id and trainee.org_id = enrollment.org_id
  join public.programs as program on program.id = session.program_id and program.org_id = session.org_id
  join public.cohorts as cohort on cohort.id = session.cohort_id and cohort.org_id = session.org_id
  where attendance.id = access_record.attendance_id
    and session.id = access_record.session_id
    and session.status in ('open', 'closed');
end;
$$;

revoke all on function public.get_operational_session_journey(text)
  from public, anon, authenticated;
grant execute on function public.get_operational_session_journey(text) to service_role;

create function public.create_operational_session_assessment_link(
  target_access_token_hash text,
  target_assessment_kind text
)
returns table (
  form_id text, trainee_field_name text, submission_token_field_name text,
  trainee_code text, submission_token text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_enrollment_id uuid;
  configured_form_id text;
  configured_trainee_field_name text;
  configured_token_field_name text;
  normalized_trainee_code text;
  raw_submission_token text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if target_assessment_kind not in ('pre', 'post') then
    raise exception 'Assessment kind must be pre or post' using errcode = '22023';
  end if;

  select enrollment.id, trainee.code, form_config.form_id,
    form_config.trainee_field_name, form_config.submission_token_field_name
  into target_enrollment_id, normalized_trainee_code, configured_form_id,
    configured_trainee_field_name, configured_token_field_name
  from public.operational_session_access_tokens as access_token
  join public.operational_session_attendances as attendance
    on attendance.id = access_token.attendance_id and attendance.org_id = access_token.org_id
  join public.operational_sessions as session
    on session.id = access_token.session_id and session.id = attendance.session_id
   and session.org_id = access_token.org_id and session.status in ('open', 'closed')
  join public.enrollments as enrollment
    on enrollment.id = attendance.enrollment_id and enrollment.org_id = attendance.org_id
   and enrollment.status = 'active'
  join public.trainees as trainee
    on trainee.id = enrollment.trainee_id and trainee.org_id = enrollment.org_id
   and trainee.status = 'active'
  join public.cohorts as cohort
    on cohort.id = session.cohort_id and cohort.org_id = session.org_id
   and cohort.status in ('draft', 'open', 'in_progress')
  join public.jotform_forms as form_config
    on form_config.program_version_id = cohort.program_version_id
   and form_config.org_id = cohort.org_id
   and form_config.assessment_kind = target_assessment_kind and form_config.is_active
  where access_token.token_hash = target_access_token_hash
    and access_token.revoked_at is null and access_token.expires_at > now()
    and not exists (
      select 1 from public.assessments completed
      where completed.enrollment_id = enrollment.id
        and completed.assessment_kind = target_assessment_kind
    )
    and (
      target_assessment_kind = 'pre'
      or exists (select 1 from public.assessments pre
        where pre.enrollment_id = enrollment.id and pre.assessment_kind = 'pre')
    )
  limit 1;

  if target_enrollment_id is null then
    raise exception 'Assessment is not available for this session participant' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_enrollment_id::text || ':' || target_assessment_kind, 0
  ));
  if (
    select count(*)
    from public.assessment_submission_tokens as recent_token
    where recent_token.enrollment_id = target_enrollment_id
      and recent_token.assessment_kind = target_assessment_kind
      and recent_token.created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception 'Assessment link rate limit exceeded' using errcode = '22023';
  end if;
  raw_submission_token := public.create_assessment_submission_token(
    target_enrollment_id, target_assessment_kind, interval '2 hours'
  );

  return query select configured_form_id, configured_trainee_field_name,
    configured_token_field_name, normalized_trainee_code, raw_submission_token;
end;
$$;

revoke all on function public.create_operational_session_assessment_link(text, text)
  from public, anon, authenticated;
grant execute on function public.create_operational_session_assessment_link(text, text)
  to service_role;

alter table public.public_api_rate_windows
  drop constraint public_api_rate_windows_scope_check;
alter table public.public_api_rate_windows
  add constraint public_api_rate_windows_scope_check
  check (scope in (
    'trainee_route', 'assessment_link', 'access_request',
    'session_scan', 'session_join', 'session_register'
  ));

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
    when 'trainee_route' then window_seconds := 300; maximum_requests := 20;
    when 'assessment_link' then window_seconds := 600; maximum_requests := 6;
    when 'access_request' then window_seconds := 86400; maximum_requests := 10;
    when 'session_scan' then window_seconds := 300; maximum_requests := 500;
    when 'session_join' then window_seconds := 600; maximum_requests := 300;
    when 'session_register' then window_seconds := 3600; maximum_requests := 200;
    else raise exception 'Invalid public rate-limit scope';
  end case;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / window_seconds) * window_seconds
  );
  insert into public.public_api_rate_windows (
    fingerprint, scope, window_started_at, request_count, updated_at
  ) values (target_fingerprint, target_scope, current_window, 1, now())
  on conflict (fingerprint, scope, window_started_at)
  do update set request_count = public.public_api_rate_windows.request_count + 1,
    updated_at = now()
  returning request_count into current_count;
  delete from public.public_api_rate_windows
    where window_started_at < now() - interval '2 days';
  return current_count <= maximum_requests;
end;
$$;

comment on column public.operational_sessions.allow_self_registration is
  'Explicit trainer-controlled opt-in for public participant creation from a live session QR.';
comment on table public.operational_session_access_tokens is
  'Hashed, short-lived participant journey credentials; raw values exist only in HttpOnly cookies.';
comment on function public.register_public_operational_session(
  text, text, text, text, boolean, text, timestamptz
) is
  'Atomically creates a new trainee, enrollment, and attendance without creating an Auth account.';

commit;
