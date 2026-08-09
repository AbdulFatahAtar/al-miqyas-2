begin;

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
  final_status text;
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

  if matched_user_id is not null and matched_user_confirmed then
    if target_request.invitation_id is not null then
      update public.membership_invitations
      set status = 'revoked'
      where id = target_request.invitation_id
        and status = 'pending';
    end if;

    insert into public.memberships (
      user_id,
      org_id,
      role,
      status,
      invited_by
    )
    values (
      matched_user_id,
      target_request.org_id,
      target_request.requested_role,
      'active',
      (select auth.uid())
    )
    on conflict (user_id, org_id) do update
    set
      role = case
        when public.memberships.status = 'active'
          then public.memberships.role
        else excluded.role
      end,
      status = 'active',
      invited_by = excluded.invited_by,
      updated_at = now();

    update public.access_requests
    set
      status = 'completed',
      invitee_user_id = matched_user_id,
      completed_at = now(),
      invitation_id = null,
      expires_at = null
    where id = target_request.id;

    insert into public.audit_logs (
      org_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      request_id,
      before_data,
      after_data
    )
    values (
      target_request.org_id,
      (select auth.uid()),
      'access_request.completed_existing_user',
      'access_request',
      target_request.id::text,
      target_request.id,
      jsonb_build_object('status', target_request.status),
      jsonb_build_object('status', 'completed')
    );

    final_status := 'completed';
  else
    if target_request.invitation_id is not null then
      update public.membership_invitations
      set status = 'revoked'
      where id = target_request.invitation_id
        and status = 'pending';
    end if;

    if target_request.invitee_user_id is not null then
      update public.memberships
      set status = 'revoked'
      where user_id = target_request.invitee_user_id
        and org_id = target_request.org_id
        and status = 'invited';
    end if;

    update public.access_requests
    set
      status = 'approved',
      invitation_id = null,
      invitee_user_id = matched_user_id,
      invited_at = null,
      expires_at = null
    where id = target_request.id;

    final_status := 'approved';
  end if;

  return query
  select
    target_request.id,
    final_status,
    target_request.org_id,
    target_organization.name_ar,
    target_request.email,
    target_request.full_name,
    target_request.requested_role,
    matched_user_id,
    matched_user_confirmed;
end;
$$;

revoke all on function public.prepare_access_request_invitation(uuid) from public;
revoke all on function public.prepare_access_request_invitation(uuid) from anon;
grant execute on function public.prepare_access_request_invitation(uuid) to authenticated;

create or replace function public.mark_access_request_invited(
  target_request_id uuid,
  invited_user_id uuid,
  invitation_token_hash text,
  invitation_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_request public.access_requests%rowtype;
  created_invitation_id uuid;
  invited_email text;
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

  if target_request.status <> 'approved' then
    raise exception 'Access request is not approved';
  end if;

  if invitation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation token';
  end if;

  if (
    invitation_expires_at <= now()
    or invitation_expires_at > now() + interval '7 days'
  ) then
    raise exception 'Invalid invitation expiry';
  end if;

  select lower(account.email)
  into invited_email
  from auth.users as account
  where account.id = invited_user_id;

  if invited_email is null or invited_email <> target_request.email then
    raise exception 'Invitation email does not match the request';
  end if;

  insert into public.memberships (
    user_id,
    org_id,
    role,
    status,
    invited_by
  )
  values (
    invited_user_id,
    target_request.org_id,
    target_request.requested_role,
    'invited',
    (select auth.uid())
  )
  on conflict (user_id, org_id) do update
  set
    role = case
      when public.memberships.status = 'active'
        then public.memberships.role
      else excluded.role
    end,
    status = case
      when public.memberships.status = 'active'
        then 'active'
      else 'invited'
    end,
    invited_by = excluded.invited_by,
    updated_at = now();

  insert into public.membership_invitations (
    org_id,
    email,
    role,
    token_hash,
    status,
    invited_by,
    expires_at
  )
  values (
    target_request.org_id,
    target_request.email,
    target_request.requested_role,
    invitation_token_hash,
    'pending',
    (select auth.uid()),
    invitation_expires_at
  )
  returning id into created_invitation_id;

  update public.access_requests
  set
    status = 'invited',
    invitation_id = created_invitation_id,
    invitee_user_id = invited_user_id,
    invited_at = now(),
    expires_at = invitation_expires_at
  where id = target_request.id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    before_data,
    after_data
  )
  values (
    target_request.org_id,
    (select auth.uid()),
    'access_request.invited',
    'access_request',
    target_request.id::text,
    target_request.id,
    jsonb_build_object('status', target_request.status),
    jsonb_build_object(
      'status', 'invited',
      'invitation_id', created_invitation_id,
      'expires_at', invitation_expires_at
    )
  );

  return created_invitation_id;
end;
$$;

revoke all on function public.mark_access_request_invited(uuid, uuid, text, timestamptz) from public;
revoke all on function public.mark_access_request_invited(uuid, uuid, text, timestamptz) from anon;
grant execute on function public.mark_access_request_invited(uuid, uuid, text, timestamptz) to authenticated;

create or replace function public.cancel_access_request(
  target_request_id uuid,
  cancellation_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_request public.access_requests%rowtype;
  normalized_note text := nullif(btrim(cancellation_note), '');
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
    raise exception 'Invitation cancellation is not allowed';
  end if;

  if target_request.status not in ('approved', 'invited') then
    raise exception 'Access request cannot be cancelled';
  end if;

  if normalized_note is not null and length(normalized_note) > 1000 then
    raise exception 'Cancellation note is too long';
  end if;

  if target_request.invitation_id is not null then
    update public.membership_invitations
    set status = 'revoked'
    where id = target_request.invitation_id
      and status = 'pending';
  end if;

  if target_request.invitee_user_id is not null then
    update public.memberships
    set status = 'revoked'
    where user_id = target_request.invitee_user_id
      and org_id = target_request.org_id
      and status = 'invited';
  end if;

  update public.access_requests
  set
    status = 'cancelled',
    review_note = coalesce(normalized_note, review_note),
    cancelled_at = now()
  where id = target_request.id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    request_id,
    before_data,
    after_data
  )
  values (
    target_request.org_id,
    (select auth.uid()),
    'access_request.cancelled',
    'access_request',
    target_request.id::text,
    target_request.id,
    jsonb_build_object('status', target_request.status),
    jsonb_build_object('status', 'cancelled', 'review_note', normalized_note)
  );

  return 'cancelled';
end;
$$;

revoke all on function public.cancel_access_request(uuid, text) from public;
revoke all on function public.cancel_access_request(uuid, text) from anon;
grant execute on function public.cancel_access_request(uuid, text) to authenticated;

commit;
