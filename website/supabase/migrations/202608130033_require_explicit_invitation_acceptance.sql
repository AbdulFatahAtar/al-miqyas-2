begin;

-- A confirmed Supabase account is not proof that its holder accepted a new
-- organization invitation. Both new and existing accounts must follow the
-- same one-time invitation acceptance path before a membership becomes active.
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
    'approved',
    (select auth.uid()),
    normalized_reason,
    matched_user_id,
    now(),
    null
  )
  returning id into created_request_id;

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
    'user.invitation_created',
    'user_access',
    coalesce(matched_user_id::text, created_request_id::text),
    created_request_id,
    jsonb_build_object(
      'status', 'approved',
      'requested_role', normalized_role,
      'reference_code', generated_reference
    ),
    normalized_reason,
    jsonb_build_object('channel', 'platform_invitation')
  );

  return query
  select
    created_request_id,
    'approved'::text,
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

create or replace function public.prepare_access_request_invitation(
  target_request_id uuid
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
  target_request public.access_requests%rowtype;
  target_organization public.organizations%rowtype;
  matched_user_id uuid;
  matched_user_confirmed boolean := false;
begin
  select request.*
  into target_request
  from public.access_requests as request
  where request.id = target_request_id
  for update;

  if target_request.id is null then
    raise exception 'Access request not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_request.org_id, array['owner'])
  ) then
    raise exception 'Invitation management is not allowed';
  end if;

  if target_request.status not in ('approved', 'invited') then
    raise exception 'Access request cannot be invited';
  end if;

  select organization.*
  into target_organization
  from public.organizations as organization
  where organization.id = target_request.org_id;

  select
    account.id,
    account.email_confirmed_at is not null
  into matched_user_id, matched_user_confirmed
  from auth.users as account
  where lower(account.email) = target_request.email
  order by account.created_at asc
  limit 1;

  if target_request.invitation_id is not null then
    update public.membership_invitations
    set status = 'revoked'
    where id = target_request.invitation_id
      and status = 'pending';
  end if;

  update public.access_requests
  set
    status = 'approved',
    invitation_id = null,
    invitee_user_id = matched_user_id,
    invited_at = null,
    expires_at = null
  where id = target_request.id;

  return query
  select
    target_request.id,
    'approved'::text,
    target_request.org_id,
    target_organization.name_ar,
    target_request.email,
    target_request.full_name,
    target_request.requested_role,
    matched_user_id,
    matched_user_confirmed;
end;
$$;

revoke all on function public.prepare_access_request_invitation(uuid) from public, anon;
grant execute on function public.prepare_access_request_invitation(uuid) to authenticated;

comment on function public.create_platform_user_invitation(
  uuid,
  text,
  text,
  text,
  text
) is 'Creates an audited organization invitation request; membership activation always requires explicit invitation acceptance.';

comment on function public.prepare_access_request_invitation(uuid)
is 'Prepares an invitation without activating an existing confirmed account; explicit acceptance remains required.';

commit;
