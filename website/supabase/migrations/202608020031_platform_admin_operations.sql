begin;

alter table public.access_requests
  drop constraint if exists access_requests_requested_role_check;
alter table public.access_requests
  add constraint access_requests_requested_role_check
    check (requested_role in ('owner', 'trainer', 'viewer'));

create or replace function public.create_platform_user_invitation(
  target_org_id uuid,
  target_full_name text,
  target_email text,
  target_role text,
  target_reason text
)
returns table (
  request_id uuid,
  request_status text,
  organization_id uuid,
  organization_name text,
  applicant_email text,
  applicant_name text,
  requested_role text,
  existing_user_id uuid,
  existing_user_confirmed boolean
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_organization public.organizations%rowtype;
  normalized_name text := btrim(target_full_name);
  normalized_email text := lower(btrim(target_email));
  normalized_role text := lower(btrim(target_role));
  normalized_reason text := btrim(target_reason);
  matched_user_id uuid;
  matched_user_confirmed boolean := false;
  generated_reference text;
  created_request_id uuid;
  final_status text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    public.has_permission('users.create', null)
    and public.has_permission('memberships.manage_all', null)
  ) then
    raise exception 'Platform user invitation is not allowed'
      using errcode = '42501';
  end if;

  if coalesce(length(normalized_name), 0) not between 2 and 160 then
    raise exception 'Invalid invited user name';
  end if;

  if (
    coalesce(length(normalized_email), 0) not between 5 and 254
    or position('@' in normalized_email) <= 1
  ) then
    raise exception 'Invalid invited user email';
  end if;

  if normalized_role not in ('owner', 'trainer', 'viewer') then
    raise exception 'Invalid invited user role';
  end if;

  if coalesce(length(normalized_reason), 0) not between 5 and 500 then
    raise exception 'An invitation reason is required';
  end if;

  select organization.*
  into target_organization
  from public.organizations as organization
  where organization.id = target_org_id
    and organization.status = 'active'
  for update;

  if target_organization.id is null then
    raise exception 'Active organization was not found';
  end if;

  if exists (
    select 1
    from public.access_requests as access_request
    where access_request.org_id = target_org_id
      and access_request.email = normalized_email
      and access_request.status in ('pending', 'approved', 'invited')
  ) then
    raise exception 'An open invitation already exists for this email';
  end if;

  select
    account.id,
    account.email_confirmed_at is not null
  into matched_user_id, matched_user_confirmed
  from auth.users as account
  where lower(account.email) = normalized_email
  order by account.created_at asc
  limit 1;

  if matched_user_id is not null and exists (
    select 1
    from public.memberships as membership
    where membership.user_id = matched_user_id
      and membership.org_id = target_org_id
      and membership.status = 'active'
  ) then
    raise exception 'The user already has active organization access';
  end if;

  generated_reference := public.generate_access_request_reference();
  final_status := case
    when matched_user_id is not null and matched_user_confirmed
      then 'completed'
    else 'approved'
  end;

  insert into public.access_requests (
    reference_code,
    org_id,
    full_name,
    email,
    requested_role,
    status,
    reviewer_user_id,
    review_note,
    invitee_user_id,
    reviewed_at,
    completed_at
  )
  values (
    generated_reference,
    target_org_id,
    normalized_name,
    normalized_email,
    normalized_role,
    final_status,
    (select auth.uid()),
    normalized_reason,
    matched_user_id,
    now(),
    case when final_status = 'completed' then now() else null end
  )
  returning id into created_request_id;

  if final_status = 'completed' then
    insert into public.memberships (
      user_id,
      org_id,
      role,
      status,
      invited_by
    )
    values (
      matched_user_id,
      target_org_id,
      normalized_role,
      'active',
      (select auth.uid())
    )
    on conflict (user_id, org_id) do update
    set
      role = excluded.role,
      status = 'active',
      invited_by = excluded.invited_by,
      updated_at = now();
  end if;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    after_data,
    reason,
    metadata
  )
  values (
    target_org_id,
    (select auth.uid()),
    case
      when final_status = 'completed' then 'user.access_granted'
      else 'user.invitation_created'
    end,
    'user_access',
    coalesce(matched_user_id::text, created_request_id::text),
    created_request_id,
    jsonb_build_object(
      'status', final_status,
      'requested_role', normalized_role,
      'reference_code', generated_reference
    ),
    normalized_reason,
    jsonb_build_object('channel', 'platform_invitation')
  );

  return query
  select
    created_request_id,
    final_status,
    target_organization.id,
    target_organization.name_ar,
    normalized_email,
    normalized_name,
    normalized_role,
    matched_user_id,
    matched_user_confirmed;
end;
$$;

revoke all on function public.create_platform_user_invitation(
  uuid,
  text,
  text,
  text,
  text
) from public, anon;
grant execute on function public.create_platform_user_invitation(
  uuid,
  text,
  text,
  text,
  text
) to authenticated;

create or replace function public.list_platform_audit_events(
  search_filter text default null,
  actor_user_filter uuid default null,
  organization_filter uuid default null,
  action_filter text default null,
  entity_type_filter text default null,
  outcome_filter text default null,
  severity_filter text default null,
  created_from timestamptz default null,
  created_until timestamptz default null,
  page_size integer default 20,
  page_offset integer default 0
)
returns table (
  id bigint,
  org_id uuid,
  actor_user_id uuid,
  actor_role text,
  actor_scope text,
  action text,
  entity_type text,
  entity_id text,
  request_id uuid,
  outcome text,
  severity text,
  reason text,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_search text := nullif(btrim(search_filter), '');
  normalized_action text := nullif(btrim(action_filter), '');
  normalized_entity_type text := nullif(btrim(entity_type_filter), '');
  normalized_outcome text := nullif(lower(btrim(outcome_filter)), '');
  normalized_severity text := nullif(lower(btrim(severity_filter)), '');
begin
  if not public.has_permission('audit.read_all', null) then
    raise exception 'Platform audit listing is not allowed'
      using errcode = '42501';
  end if;

  if page_size not between 1 and 100 or page_offset not between 0 and 100000 then
    raise exception 'Invalid audit page bounds';
  end if;

  if created_from is not null
    and created_until is not null
    and created_from > created_until
  then
    raise exception 'Invalid audit date range';
  end if;

  if normalized_outcome is not null
    and normalized_outcome not in ('success', 'denied', 'failure', 'partial')
  then
    raise exception 'Invalid audit outcome filter';
  end if;

  if normalized_severity is not null
    and normalized_severity not in ('info', 'notice', 'warning', 'critical')
  then
    raise exception 'Invalid audit severity filter';
  end if;

  return query
  select
    audit.id,
    audit.org_id,
    audit.actor_user_id,
    audit.actor_role,
    audit.actor_scope,
    audit.action,
    audit.entity_type,
    audit.entity_id,
    audit.request_id,
    audit.outcome,
    audit.severity,
    audit.reason,
    audit.created_at,
    count(*) over() as total_count
  from public.audit_logs as audit
  where (actor_user_filter is null or audit.actor_user_id = actor_user_filter)
    and (organization_filter is null or audit.org_id = organization_filter)
    and (normalized_action is null or audit.action = normalized_action)
    and (
      normalized_entity_type is null
      or audit.entity_type = normalized_entity_type
    )
    and (normalized_outcome is null or audit.outcome = normalized_outcome)
    and (normalized_severity is null or audit.severity = normalized_severity)
    and (created_from is null or audit.created_at >= created_from)
    and (created_until is null or audit.created_at <= created_until)
    and (
      normalized_search is null
      or audit.action ilike '%' || normalized_search || '%'
      or audit.entity_type ilike '%' || normalized_search || '%'
      or coalesce(audit.entity_id, '') ilike '%' || normalized_search || '%'
      or coalesce(audit.reason, '') ilike '%' || normalized_search || '%'
      or coalesce(audit.actor_user_id::text, '') ilike '%' || normalized_search || '%'
      or coalesce(audit.request_id::text, '') ilike '%' || normalized_search || '%'
    )
  order by audit.created_at desc, audit.id desc
  limit page_size
  offset page_offset;
end;
$$;

revoke all on function public.list_platform_audit_events(
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) from public, anon;
grant execute on function public.list_platform_audit_events(
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) to authenticated;

comment on function public.create_platform_user_invitation(
  uuid,
  text,
  text,
  text,
  text
) is 'Creates an audited organization invitation from the platform console without exposing credentials.';

comment on function public.list_platform_audit_events(
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  timestamptz,
  timestamptz,
  integer,
  integer
) is 'Returns a permission-checked, filterable, paginated platform audit feed without before/after payloads.';

commit;
