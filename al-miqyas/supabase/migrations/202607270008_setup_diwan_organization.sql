begin;

do $$
declare
  v_org_id uuid;
  v_org_count integer;
  v_before jsonb;
  v_after jsonb;
begin
  select count(distinct p.org_id)
  into v_org_count
  from public.programs p
  where p.slug = 'diwan-onboarding';

  if v_org_count <> 1 then
    raise exception
      'Expected exactly one organization for program diwan-onboarding, found %',
      v_org_count;
  end if;

  select p.org_id
  into v_org_id
  from public.programs p
  where p.slug = 'diwan-onboarding'
  limit 1;

  if exists (
    select 1
    from public.organizations o
    where o.slug = 'diwan'
      and o.id <> v_org_id
  ) then
    raise exception
      'Organization slug diwan is already used by another organization';
  end if;

  select to_jsonb(o)
  into v_before
  from public.organizations o
  where o.id = v_org_id;

  if v_before is null then
    raise exception 'Organization % was not found', v_org_id;
  end if;

  update public.organizations
  set
    slug = 'diwan',
    name_ar = 'ديوان المظالم',
    name_en = 'Board of Grievances',
    status = 'active',
    archived_at = null,
    updated_at = now()
  where id = v_org_id;

  select to_jsonb(o)
  into v_after
  from public.organizations o
  where o.id = v_org_id;

  if v_before is distinct from v_after then
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
      v_org_id,
      'organization.updated',
      'organization',
      v_org_id::text,
      v_before,
      v_after,
      jsonb_build_object(
        'source', 'migration_008',
        'reason', 'Configure the current tenant for the Diwan onboarding program'
      )
    );
  end if;
end;
$$;

commit;
