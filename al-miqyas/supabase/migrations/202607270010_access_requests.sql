begin;

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique
    check (reference_code ~ '^REQ-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$'),
  org_id uuid not null references public.organizations(id) on delete restrict,
  full_name text not null check (length(btrim(full_name)) between 2 and 160),
  email text not null
    check (
      email = lower(btrim(email))
      and length(email) between 5 and 254
      and position('@' in email) > 1
    ),
  requested_role text not null check (requested_role in ('trainer', 'viewer')),
  status text not null default 'pending'
    check (
      status in (
        'pending',
        'approved',
        'rejected',
        'invited',
        'completed',
        'expired',
        'cancelled'
      )
    ),
  reviewer_user_id uuid references auth.users(id) on delete set null,
  review_note text check (
    review_note is null or length(btrim(review_note)) between 1 and 1000
  ),
  invitation_id uuid unique,
  invitee_user_id uuid references auth.users(id) on delete set null,
  request_fingerprint text check (
    request_fingerprint is null
    or request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  invited_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint access_requests_review_state_check
    check (
      status not in ('approved', 'rejected', 'invited', 'completed', 'cancelled')
      or (reviewer_user_id is not null and reviewed_at is not null)
    ),
  constraint access_requests_invitation_state_check
    check (
      status not in ('invited', 'expired')
      or invitation_id is not null
    )
);

alter table public.access_requests
  add constraint access_requests_invitation_id_fkey
  foreign key (invitation_id)
  references public.membership_invitations(id)
  on delete restrict;

create unique index access_requests_one_open_email_idx
  on public.access_requests (org_id, email)
  where status in ('pending', 'approved', 'invited');

create index access_requests_org_status_submitted_idx
  on public.access_requests (org_id, status, submitted_at desc);

create index access_requests_email_submitted_idx
  on public.access_requests (email, submitted_at desc);

create index access_requests_fingerprint_submitted_idx
  on public.access_requests (request_fingerprint, submitted_at desc)
  where request_fingerprint is not null;

create trigger access_requests_set_updated_at
before update on public.access_requests
for each row execute function public.set_updated_at();

alter table public.access_requests enable row level security;

revoke all on table public.access_requests from anon;
revoke all on table public.access_requests from authenticated;
grant select on table public.access_requests to authenticated;

create policy access_requests_select_owner
on public.access_requests for select to authenticated
using (
  public.is_platform_admin()
  or public.has_org_role(org_id, array['owner'])
);

create or replace function public.generate_access_request_reference()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  attempt integer := 0;
begin
  loop
    attempt := attempt + 1;

    if attempt > 100 then
      raise exception 'Unable to generate access request reference';
    end if;

    candidate := 'REQ-';

    for i in 1..8 loop
      candidate := candidate || substr(
        safe_alphabet,
        1 + floor(random() * length(safe_alphabet))::integer,
        1
      );
    end loop;

    exit when not exists (
      select 1
      from public.access_requests
      where reference_code = candidate
    );
  end loop;

  return candidate;
end;
$$;

revoke all on function public.generate_access_request_reference() from public;
revoke all on function public.generate_access_request_reference() from anon;
revoke all on function public.generate_access_request_reference() from authenticated;

create or replace function public.list_joinable_organizations()
returns table (
  slug text,
  name_ar text,
  logo_url text,
  brand_color text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    organization.slug,
    organization.name_ar,
    organization.logo_url,
    organization.brand_color
  from public.organizations as organization
  where organization.status = 'active'
  order by organization.created_at asc;
$$;

revoke all on function public.list_joinable_organizations() from public;
grant execute on function public.list_joinable_organizations() to anon;
grant execute on function public.list_joinable_organizations() to authenticated;

create or replace function public.submit_access_request(
  target_org_slug text,
  applicant_full_name text,
  applicant_email text,
  applicant_role text,
  applicant_fingerprint text default null
)
returns table (
  result text,
  reference_code text
)
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_org public.organizations%rowtype;
  normalized_name text := btrim(applicant_full_name);
  normalized_email text := lower(btrim(applicant_email));
  normalized_role text := lower(btrim(applicant_role));
  generated_reference text;
  created_request_id uuid;
begin
  if length(normalized_name) not between 2 and 160 then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if (
    length(normalized_email) not between 5 and 254
    or position('@' in normalized_email) <= 1
  ) then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if normalized_role not in ('trainer', 'viewer') then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  if (
    applicant_fingerprint is not null
    and applicant_fingerprint !~ '^[0-9a-f]{64}$'
  ) then
    return query select 'invalid'::text, null::text;
    return;
  end if;

  select organization.*
  into target_org
  from public.organizations as organization
  where organization.slug = btrim(target_org_slug)
    and organization.status = 'active';

  if target_org.id is null then
    return query select 'organization_unavailable'::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from auth.users as account
    join public.memberships as membership
      on membership.user_id = account.id
    where lower(account.email) = normalized_email
      and membership.org_id = target_org.id
      and membership.status = 'active'
  ) then
    return query select 'already_member'::text, null::text;
    return;
  end if;

  if exists (
    select 1
    from public.access_requests as request
    where request.org_id = target_org.id
      and request.email = normalized_email
      and request.status in ('pending', 'approved', 'invited')
  ) then
    return query select 'duplicate'::text, null::text;
    return;
  end if;

  if (
    select count(*)
    from public.access_requests as request
    where request.email = normalized_email
      and request.submitted_at >= now() - interval '24 hours'
  ) >= 3 then
    return query select 'rate_limited'::text, null::text;
    return;
  end if;

  if (
    applicant_fingerprint is not null
    and (
      select count(*)
      from public.access_requests as request
      where request.request_fingerprint = applicant_fingerprint
        and request.submitted_at >= now() - interval '24 hours'
    ) >= 10
  ) then
    return query select 'rate_limited'::text, null::text;
    return;
  end if;

  generated_reference := public.generate_access_request_reference();

  insert into public.access_requests (
    reference_code,
    org_id,
    full_name,
    email,
    requested_role,
    request_fingerprint
  )
  values (
    generated_reference,
    target_org.id,
    normalized_name,
    normalized_email,
    normalized_role,
    applicant_fingerprint
  )
  returning id into created_request_id;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    request_id,
    after_data,
    metadata
  )
  values (
    target_org.id,
    'access_request.submitted',
    'access_request',
    created_request_id::text,
    created_request_id,
    jsonb_build_object(
      'status', 'pending',
      'requested_role', normalized_role
    ),
    jsonb_build_object('reference_code', generated_reference)
  );

  return query select 'created'::text, generated_reference;
end;
$$;

revoke all on function public.submit_access_request(text, text, text, text, text) from public;
grant execute on function public.submit_access_request(text, text, text, text, text) to anon;
grant execute on function public.submit_access_request(text, text, text, text, text) to authenticated;

commit;
