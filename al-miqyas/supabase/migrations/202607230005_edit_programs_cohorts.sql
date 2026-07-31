begin;

create or replace function public.update_draft_program(
  p_org_id uuid,
  p_program_id uuid,
  p_program_version_id uuid,
  p_title_ar text,
  p_title_en text,
  p_slug text,
  p_certificate_prefix text,
  p_pass_threshold numeric
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_program_status text;
  v_version_status text;
begin
  if not (
    public.is_platform_admin()
    or public.has_org_role(p_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'You are not allowed to update programs for this organization'
      using errcode = '42501';
  end if;

  if nullif(btrim(p_title_ar), '') is null then
    raise exception 'Program Arabic title is required'
      using errcode = '22023';
  end if;

  if lower(btrim(p_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Program slug is invalid'
      using errcode = '22023';
  end if;

  if upper(btrim(p_certificate_prefix)) !~ '^[A-Z0-9]{2,12}$' then
    raise exception 'Certificate prefix is invalid'
      using errcode = '22023';
  end if;

  if p_pass_threshold is null or p_pass_threshold < 0 or p_pass_threshold > 100 then
    raise exception 'Pass threshold must be between 0 and 100'
      using errcode = '22023';
  end if;

  select
    jsonb_build_object(
      'program', to_jsonb(p),
      'program_version', to_jsonb(pv)
    ),
    p.status,
    pv.status
  into v_before, v_program_status, v_version_status
  from public.programs p
  join public.program_versions pv
    on pv.id = p_program_version_id
   and pv.program_id = p.id
   and pv.org_id = p.org_id
  where p.id = p_program_id
    and p.org_id = p_org_id
  for update of p, pv;

  if v_before is null then
    raise exception 'Program or program version was not found'
      using errcode = 'P0002';
  end if;

  if v_program_status <> 'draft' or v_version_status <> 'draft' then
    raise exception 'Only draft programs and draft versions can be edited directly'
      using errcode = '55000';
  end if;

  update public.programs
  set
    title_ar = btrim(p_title_ar),
    title_en = nullif(btrim(p_title_en), ''),
    slug = lower(btrim(p_slug)),
    certificate_prefix = upper(btrim(p_certificate_prefix))
  where id = p_program_id
    and org_id = p_org_id;

  update public.program_versions
  set pass_threshold = p_pass_threshold
  where id = p_program_version_id
    and program_id = p_program_id
    and org_id = p_org_id;

  select jsonb_build_object(
    'program', to_jsonb(p),
    'program_version', to_jsonb(pv)
  )
  into v_after
  from public.programs p
  join public.program_versions pv
    on pv.id = p_program_version_id
   and pv.program_id = p.id
   and pv.org_id = p.org_id
  where p.id = p_program_id
    and p.org_id = p_org_id;

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
    'program.updated',
    'program',
    p_program_id::text,
    v_before,
    v_after
  );
end;
$$;

revoke all on function public.update_draft_program(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric
) from public;
revoke all on function public.update_draft_program(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric
) from anon;
grant execute on function public.update_draft_program(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  numeric
) to authenticated;

create or replace function public.update_draft_cohort(
  p_org_id uuid,
  p_cohort_id uuid,
  p_program_id uuid,
  p_program_version_id uuid,
  p_code text,
  p_title text,
  p_starts_on date default null,
  p_ends_on date default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before public.cohorts%rowtype;
  v_after public.cohorts%rowtype;
  v_has_enrollments boolean;
begin
  if not (
    public.is_platform_admin()
    or public.has_org_role(p_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'You are not allowed to update cohorts for this organization'
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

  select *
  into v_before
  from public.cohorts
  where id = p_cohort_id
    and org_id = p_org_id
  for update;

  if not found then
    raise exception 'Cohort was not found'
      using errcode = 'P0002';
  end if;

  if v_before.status <> 'draft' then
    raise exception 'Only draft cohorts can be edited directly'
      using errcode = '55000';
  end if;

  select exists (
    select 1
    from public.enrollments e
    where e.cohort_id = p_cohort_id
      and e.org_id = p_org_id
  )
  into v_has_enrollments;

  if v_has_enrollments and (
    v_before.program_id is distinct from p_program_id
    or v_before.program_version_id is distinct from p_program_version_id
    or v_before.code is distinct from upper(btrim(p_code))
  ) then
    raise exception 'Program, version, and cohort code are locked after the first enrollment'
      using errcode = '55000';
  end if;

  update public.cohorts
  set
    program_id = p_program_id,
    program_version_id = p_program_version_id,
    code = upper(btrim(p_code)),
    title = btrim(p_title),
    starts_on = p_starts_on,
    ends_on = p_ends_on
  where id = p_cohort_id
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
    'cohort.updated',
    'cohort',
    p_cohort_id::text,
    to_jsonb(v_before),
    to_jsonb(v_after)
  );
end;
$$;

revoke all on function public.update_draft_cohort(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date
) from public;
revoke all on function public.update_draft_cohort(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date
) from anon;
grant execute on function public.update_draft_cohort(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  date,
  date
) to authenticated;

commit;
