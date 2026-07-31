begin;

create or replace function public.review_access_request(
  target_request_id uuid,
  review_decision text,
  reviewer_note text default null
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
  normalized_decision text := lower(btrim(review_decision));
  normalized_note text := nullif(btrim(reviewer_note), '');
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
    raise exception 'Access request review is not allowed';
  end if;

  if target_request.status <> 'pending' then
    raise exception 'Access request is no longer pending';
  end if;

  if normalized_decision not in ('approve', 'reject') then
    raise exception 'Unsupported access request decision';
  end if;

  if (
    normalized_note is not null
    and length(normalized_note) > 1000
  ) then
    raise exception 'Review note is too long';
  end if;

  if normalized_decision = 'reject' and length(coalesce(normalized_note, '')) < 3 then
    raise exception 'A rejection reason is required';
  end if;

  select organization.*
  into target_organization
  from public.organizations as organization
  where organization.id = target_request.org_id;

  if normalized_decision = 'reject' then
    update public.access_requests
    set
      status = 'rejected',
      reviewer_user_id = (select auth.uid()),
      review_note = normalized_note,
      reviewed_at = now()
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
      'access_request.rejected',
      'access_request',
      target_request.id::text,
      target_request.id,
      jsonb_build_object('status', target_request.status),
      jsonb_build_object('status', 'rejected', 'review_note', normalized_note)
    );

    return query
    select
      target_request.id,
      'rejected'::text,
      target_request.org_id,
      target_organization.name_ar,
      target_request.email,
      target_request.full_name,
      target_request.requested_role,
      null::uuid,
      false;
    return;
  end if;

  select
    account.id,
    account.email_confirmed_at is not null
  into matched_user_id, matched_user_confirmed
  from auth.users as account
  where lower(account.email) = target_request.email
  order by account.created_at asc
  limit 1;

  final_status := 'approved';

  update public.access_requests
  set
    status = 'approved',
    reviewer_user_id = (select auth.uid()),
    review_note = normalized_note,
    reviewed_at = now(),
    invitee_user_id = matched_user_id
  where id = target_request.id;

  if matched_user_id is not null and matched_user_confirmed then
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
      completed_at = now()
    where id = target_request.id;

    final_status := 'completed';
  end if;

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
    case
      when final_status = 'completed'
        then 'access_request.approved_existing_user'
      else 'access_request.approved'
    end,
    'access_request',
    target_request.id::text,
    target_request.id,
    jsonb_build_object('status', target_request.status),
    jsonb_build_object(
      'status', final_status,
      'requested_role', target_request.requested_role
    )
  );

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

revoke all on function public.review_access_request(uuid, text, text) from public;
revoke all on function public.review_access_request(uuid, text, text) from anon;
grant execute on function public.review_access_request(uuid, text, text) to authenticated;

commit;
