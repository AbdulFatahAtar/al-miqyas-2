begin;

create or replace function public.create_program_with_version(
  p_org_id uuid,
  p_title_ar text,
  p_title_en text,
  p_slug text,
  p_certificate_prefix text,
  p_pass_threshold numeric,
  p_live_performance_config jsonb
)
returns table (
  program_id uuid,
  program_version_id uuid
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_program_id uuid;
  v_program_version_id uuid;
begin
  if not (
    public.is_platform_admin()
    or public.has_org_role(p_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'You are not allowed to create programs for this organization'
      using errcode = '42501';
  end if;

  insert into public.programs (
    org_id,
    slug,
    title_ar,
    title_en,
    certificate_prefix,
    status,
    created_by
  )
  values (
    p_org_id,
    lower(btrim(p_slug)),
    btrim(p_title_ar),
    nullif(btrim(p_title_en), ''),
    upper(btrim(p_certificate_prefix)),
    'draft',
    (select auth.uid())
  )
  returning id into v_program_id;

  insert into public.program_versions (
    org_id,
    program_id,
    version_number,
    pass_threshold,
    answer_key,
    confidence_config,
    live_performance_config,
    status,
    created_by
  )
  values (
    p_org_id,
    v_program_id,
    1,
    p_pass_threshold,
    '{}'::jsonb,
    '{}'::jsonb,
    coalesce(p_live_performance_config, '{}'::jsonb),
    'draft',
    (select auth.uid())
  )
  returning id into v_program_version_id;

  return query
  select v_program_id, v_program_version_id;
end;
$$;

revoke all on function public.create_program_with_version(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  jsonb
) from public;
revoke all on function public.create_program_with_version(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  jsonb
) from anon;
grant execute on function public.create_program_with_version(
  uuid,
  text,
  text,
  text,
  text,
  numeric,
  jsonb
) to authenticated;

commit;
