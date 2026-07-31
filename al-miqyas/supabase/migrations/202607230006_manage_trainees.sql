begin;

create unique index if not exists trainees_org_email_active_idx
  on public.trainees (org_id, lower(email))
  where email is not null and status <> 'archived';

create or replace function public.create_trainee_with_enrollment(
  p_org_id uuid,
  p_cohort_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null
)
returns table (
  trainee_id uuid,
  trainee_code text,
  enrollment_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trainee_id uuid;
  v_trainee_code text;
  v_enrollment_id uuid;
  v_clean_phone text;
  v_clean_email text;
  v_trainee_after jsonb;
  v_enrollment_after jsonb;
begin
  if not (
    public.is_platform_admin()
    or public.has_org_role(p_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'You are not allowed to create trainees for this organization'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_full_name), '') is null then
    raise exception 'Trainee full name is required'
      using errcode = '22023';
  end if;

  v_clean_phone := nullif(btrim(p_phone), '');
  v_clean_email := nullif(lower(btrim(p_email)), '');

  if v_clean_phone is null and v_clean_email is null then
    raise exception 'A phone number or email address is required'
      using errcode = '22023';
  end if;

  if v_clean_email is not null and position('@' in v_clean_email) <= 1 then
    raise exception 'Email address is invalid'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.cohorts c
    where c.id = p_cohort_id
      and c.org_id = p_org_id
      and c.status <> 'archived'
  ) then
    raise exception 'The selected cohort does not belong to this organization'
      using errcode = '23503';
  end if;

  if v_clean_email is not null and exists (
    select 1
    from public.trainees t
    where t.org_id = p_org_id
      and lower(t.email) = v_clean_email
      and t.status <> 'archived'
  ) then
    raise exception 'A trainee with this email already exists in the organization'
      using errcode = '23505';
  end if;

  v_trainee_code := public.generate_trainee_code();

  insert into public.trainees (
    org_id,
    code,
    full_name,
    phone,
    email,
    status,
    created_by
  )
  values (
    p_org_id,
    v_trainee_code,
    btrim(p_full_name),
    v_clean_phone,
    v_clean_email,
    'active',
    (select auth.uid())
  )
  returning id into v_trainee_id;

  select to_jsonb(t)
  into v_trainee_after
  from public.trainees t
  where t.id = v_trainee_id;

  insert into public.enrollments (
    org_id,
    cohort_id,
    trainee_id,
    status,
    created_by
  )
  values (
    p_org_id,
    p_cohort_id,
    v_trainee_id,
    'active',
    (select auth.uid())
  )
  returning id into v_enrollment_id;

  select to_jsonb(e)
  into v_enrollment_after
  from public.enrollments e
  where e.id = v_enrollment_id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data,
    metadata
  )
  values (
    p_org_id,
    (select auth.uid()),
    'trainee.created',
    'trainee',
    v_trainee_id::text,
    v_trainee_after,
    jsonb_build_object(
      'enrollment', v_enrollment_after,
      'cohort_id', p_cohort_id
    )
  );

  return query
  select v_trainee_id, v_trainee_code, v_enrollment_id;
end;
$$;

revoke all on function public.create_trainee_with_enrollment(
  uuid,
  uuid,
  text,
  text,
  text
) from public;
revoke all on function public.create_trainee_with_enrollment(
  uuid,
  uuid,
  text,
  text,
  text
) from anon;
grant execute on function public.create_trainee_with_enrollment(
  uuid,
  uuid,
  text,
  text,
  text
) to authenticated;

create or replace function public.update_trainee_profile(
  p_org_id uuid,
  p_trainee_id uuid,
  p_full_name text,
  p_phone text default null,
  p_email text default null,
  p_status text default 'active'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.trainees%rowtype;
  v_after public.trainees%rowtype;
  v_clean_phone text;
  v_clean_email text;
begin
  if not (
    public.is_platform_admin()
    or public.has_org_role(p_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'You are not allowed to update trainees for this organization'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_full_name), '') is null then
    raise exception 'Trainee full name is required'
      using errcode = '22023';
  end if;

  if p_status not in ('active', 'inactive') then
    raise exception 'Trainee status must be active or inactive'
      using errcode = '22023';
  end if;

  v_clean_phone := nullif(btrim(p_phone), '');
  v_clean_email := nullif(lower(btrim(p_email)), '');

  if v_clean_phone is null and v_clean_email is null then
    raise exception 'A phone number or email address is required'
      using errcode = '22023';
  end if;

  if v_clean_email is not null and position('@' in v_clean_email) <= 1 then
    raise exception 'Email address is invalid'
      using errcode = '22023';
  end if;

  select *
  into v_before
  from public.trainees
  where id = p_trainee_id
    and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Trainee was not found'
      using errcode = 'P0002';
  end if;

  if v_before.status = 'archived' then
    raise exception 'Archived trainees cannot be edited directly'
      using errcode = '55000';
  end if;

  if v_clean_email is not null and exists (
    select 1
    from public.trainees t
    where t.org_id = p_org_id
      and t.id <> p_trainee_id
      and lower(t.email) = v_clean_email
      and t.status <> 'archived'
  ) then
    raise exception 'A trainee with this email already exists in the organization'
      using errcode = '23505';
  end if;

  update public.trainees
  set
    full_name = btrim(p_full_name),
    phone = v_clean_phone,
    email = v_clean_email,
    status = p_status
  where id = p_trainee_id
    and org_id = p_org_id
  returning * into v_after;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  )
  values (
    p_org_id,
    (select auth.uid()),
    'trainee.updated',
    'trainee',
    p_trainee_id::text,
    to_jsonb(v_before),
    to_jsonb(v_after)
  );
end;
$$;

revoke all on function public.update_trainee_profile(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.update_trainee_profile(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from anon;
grant execute on function public.update_trainee_profile(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to authenticated;

commit;
