begin;

create or replace function public.create_cohort(
  p_org_id uuid,
  p_program_id uuid,
  p_program_version_id uuid,
  p_code text,
  p_title text,
  p_starts_on date default null,
  p_ends_on date default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cohort_id uuid;
begin
  if not (
    public.is_platform_admin()
    or public.has_org_role(p_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'You are not allowed to create cohorts for this organization'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_title), '') is null then
    raise exception 'Cohort title is required'
      using errcode = '22023';
  end if;

  if upper(btrim(p_code)) !~ '^[A-Z0-9]+(?:-[A-Z0-9]+)*$' then
    raise exception 'Cohort code must contain uppercase letters, numbers, and hyphens only'
      using errcode = '22023';
  end if;

  if p_starts_on is not null
     and p_ends_on is not null
     and p_ends_on < p_starts_on then
    raise exception 'Cohort end date cannot be before its start date'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.program_versions pv
    where pv.id = p_program_version_id
      and pv.program_id = p_program_id
      and pv.org_id = p_org_id
  ) then
    raise exception 'The selected program version does not belong to this organization'
      using errcode = '23503';
  end if;

  insert into public.cohorts (
    org_id,
    program_id,
    program_version_id,
    code,
    title,
    starts_on,
    ends_on,
    status,
    created_by
  )
  values (
    p_org_id,
    p_program_id,
    p_program_version_id,
    upper(btrim(p_code)),
    btrim(p_title),
    p_starts_on,
    p_ends_on,
    'draft',
    (select auth.uid())
  )
  returning id into v_cohort_id;

  return v_cohort_id;
end;
$$;

revoke all on function public.create_cohort(
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date
) from public;
revoke all on function public.create_cohort(
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date
) from anon;
grant execute on function public.create_cohort(
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date
) to authenticated;

create or replace function public.enforce_cohort_run_readiness()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program_status text;
  v_version_status text;
  v_active_jotform_kinds integer;
  v_active_xapi_keys integer;
begin
  if new.status not in ('open', 'in_progress') then
    return new;
  end if;

  select p.status, pv.status
  into v_program_status, v_version_status
  from public.programs p
  join public.program_versions pv
    on pv.id = new.program_version_id
   and pv.program_id = p.id
   and pv.org_id = p.org_id
  where p.id = new.program_id
    and p.org_id = new.org_id;

  if v_program_status is distinct from 'active'
     or v_version_status is distinct from 'published' then
    raise exception 'The program and its selected version must be published before opening the cohort'
      using errcode = '55000';
  end if;

  select count(distinct jf.assessment_kind)
  into v_active_jotform_kinds
  from public.jotform_forms jf
  where jf.org_id = new.org_id
    and jf.program_version_id = new.program_version_id
    and jf.assessment_kind in ('pre', 'post')
    and jf.is_active;

  if v_active_jotform_kinds <> 2 then
    raise exception 'Active pre-test and post-test Jotform forms are required before opening the cohort'
      using errcode = '55000';
  end if;

  select count(*)
  into v_active_xapi_keys
  from public.org_api_keys oak
  where oak.org_id = new.org_id
    and oak.status = 'active';

  if v_active_xapi_keys = 0 then
    raise exception 'An active xAPI organization key is required before opening the cohort'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_cohort_run_readiness() from public;
revoke all on function public.enforce_cohort_run_readiness() from anon;
revoke all on function public.enforce_cohort_run_readiness() from authenticated;

drop trigger if exists cohorts_enforce_run_readiness on public.cohorts;
create trigger cohorts_enforce_run_readiness
before insert or update of status on public.cohorts
for each row execute function public.enforce_cohort_run_readiness();

commit;
