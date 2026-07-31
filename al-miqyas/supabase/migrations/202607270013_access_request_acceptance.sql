begin;

create or replace function public.complete_access_request(
  target_request_id uuid,
  invitation_token_hash text
)
returns table (
  result text,
  organization_slug text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_request public.access_requests%rowtype;
  target_invitation public.membership_invitations%rowtype;
  current_email text;
  target_org_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  select request.*
  into target_request
  from public.access_requests as request
  where request.id = target_request_id
  for update;

  if (
    target_request.id is null
    or target_request.status <> 'invited'
    or target_request.invitation_id is null
  ) then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  select invitation.*
  into target_invitation
  from public.membership_invitations as invitation
  where invitation.id = target_request.invitation_id
  for update;

  if (
    target_invitation.id is null
    or target_invitation.status <> 'pending'
    or target_invitation.token_hash <> invitation_token_hash
  ) then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if target_invitation.expires_at <= now() then
    update public.membership_invitations
    set status = 'expired'
    where id = target_invitation.id;

    update public.memberships
    set status = 'revoked'
    where user_id = target_request.invitee_user_id
      and org_id = target_request.org_id
      and status = 'invited';

    update public.access_requests
    set status = 'expired'
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
      'access_request.expired',
      'access_request',
      target_request.id::text,
      target_request.id,
      jsonb_build_object('status', target_request.status),
      jsonb_build_object('status', 'expired')
    );

    return query select 'expired'::text, null::text;
    return;
  end if;

  select lower(account.email)
  into current_email
  from auth.users as account
  where account.id = (select auth.uid());

  if (
    current_email is null
    or current_email <> target_request.email
    or target_request.invitee_user_id is distinct from (select auth.uid())
  ) then
    return query select 'email_mismatch'::text, null::text;
    return;
  end if;

  insert into public.memberships (
    user_id,
    org_id,
    role,
    status,
    invited_by
  )
  values (
    (select auth.uid()),
    target_request.org_id,
    target_request.requested_role,
    'active',
    target_request.reviewer_user_id
  )
  on conflict (user_id, org_id) do update
  set
    role = case
      when public.memberships.status = 'active'
        then public.memberships.role
      else excluded.role
    end,
    status = 'active',
    updated_at = now();

  update public.membership_invitations
  set
    status = 'accepted',
    accepted_by = (select auth.uid()),
    accepted_at = now()
  where id = target_invitation.id;

  update public.access_requests
  set
    status = 'completed',
    completed_at = now()
  where id = target_request.id;

  select organization.slug
  into target_org_slug
  from public.organizations as organization
  where organization.id = target_request.org_id;

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
    'access_request.completed',
    'access_request',
    target_request.id::text,
    target_request.id,
    jsonb_build_object('status', target_request.status),
    jsonb_build_object(
      'status', 'completed',
      'membership_status', 'active'
    )
  );

  return query select 'completed'::text, target_org_slug;
end;
$$;

revoke all on function public.complete_access_request(uuid, text) from public;
revoke all on function public.complete_access_request(uuid, text) from anon;
grant execute on function public.complete_access_request(uuid, text) to authenticated;

commit;
