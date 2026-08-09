begin;

-- Browser clients must use the audited RPC contracts below and the existing
-- business RPCs. RLS remains defense in depth, but is not the write API.
revoke insert, update, delete on table
  public.organizations,
  public.memberships,
  public.membership_invitations,
  public.programs,
  public.program_versions,
  public.jotform_forms,
  public.cohorts,
  public.trainees,
  public.enrollments,
  public.access_requests,
  public.assessment_submission_tokens,
  public.webhook_ingestions,
  public.assessments,
  public.org_api_keys,
  public.xapi_statements,
  public.impact_reports,
  public.cohort_reports,
  public.certificates,
  public.audit_logs
from public, anon, authenticated;

create or replace function public.protect_trainee_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.code is distinct from old.code then
    raise exception 'Trainee code is immutable'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_trainee_code() from public;
revoke all on function public.protect_trainee_code() from anon;
revoke all on function public.protect_trainee_code() from authenticated;

drop trigger if exists trainees_protect_code on public.trainees;
create trigger trainees_protect_code
before update on public.trainees
for each row execute function public.protect_trainee_code();

create or replace function public.protect_final_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  remaining_owner_count integer;
  removes_active_owner boolean := false;
  serializes_owner_change boolean := false;
  lock_org_id uuid;
begin
  if tg_op = 'INSERT' then
    lock_org_id := new.org_id;
    serializes_owner_change :=
      new.role = 'owner' and new.status = 'active';
  elsif tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id
      or new.org_id is distinct from old.org_id
    then
      raise exception 'Membership identity is immutable'
        using errcode = '22023';
    end if;

    lock_org_id := old.org_id;
    serializes_owner_change :=
      (old.role = 'owner' and old.status = 'active')
      or (new.role = 'owner' and new.status = 'active');
  else
    lock_org_id := old.org_id;
    serializes_owner_change :=
      old.role = 'owner' and old.status = 'active';
  end if;

  if tg_op <> 'INSERT'
    and old.role = 'owner'
    and old.status = 'active'
  then
    if tg_op = 'DELETE' then
      removes_active_owner := true;
    else
      removes_active_owner :=
        new.role <> 'owner' or new.status <> 'active';
    end if;
  end if;

  if serializes_owner_change then
    perform pg_advisory_xact_lock(
      hashtextextended('membership-owner:' || lock_org_id::text, 0)
    );
  end if;

  if removes_active_owner then
    select count(distinct membership.user_id)
    into remaining_owner_count
    from public.memberships as membership
    join auth.users as account
      on account.id = membership.user_id
    where membership.org_id = old.org_id
      and membership.role = 'owner'
      and membership.status = 'active'
      and membership.user_id is distinct from old.user_id;

    if remaining_owner_count < 1 then
      raise exception 'The final active organization owner cannot be changed'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.protect_final_organization_owner()
  from public;
revoke all on function public.protect_final_organization_owner()
  from anon;
revoke all on function public.protect_final_organization_owner()
  from authenticated;

drop trigger if exists memberships_protect_final_owner
  on public.memberships;
create trigger memberships_protect_final_owner
before insert or update or delete on public.memberships
for each row execute function public.protect_final_organization_owner();

-- This trigger also protects SECURITY DEFINER ingestion/reporting functions.
-- An inactive tenant cannot receive new operational data or mutate existing
-- operational data, even if a caller reaches a function that predates RBAC.
create or replace function public.enforce_active_organization_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_org_id uuid;
  destination_org_id uuid;
begin
  if tg_op = 'DELETE' then
    -- Deletion cannot introduce data into an inactive tenant. Allowing it is
    -- required for service-role cleanup and for future FK cascades; table/RPC
    -- privileges still decide who may perform the deletion.
    return old;
  elsif tg_op = 'UPDATE' then
    source_org_id := old.org_id;
    destination_org_id := new.org_id;

    if source_org_id is not null
      and destination_org_id is distinct from source_org_id
    then
      raise exception 'Operational records cannot move between organizations'
        using errcode = '22023';
    end if;
  else
    destination_org_id := new.org_id;
  end if;

  -- webhook_ingestions may be received before an organization is resolved.
  if destination_org_id is not null and not exists (
    select 1
    from public.organizations as organization
    where organization.id = destination_org_id
      and organization.status = 'active'
  ) then
    raise exception 'Organization is not active'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_organization_write()
  from public;
revoke all on function public.enforce_active_organization_write()
  from anon;
revoke all on function public.enforce_active_organization_write()
  from authenticated;

-- Close credentials and pending invitations that predate this migration.
-- This runs before the active-organization triggers are installed.
update public.org_api_keys as api_key
set
  status = 'revoked',
  revoked_at = coalesce(api_key.revoked_at, now())
from public.organizations as organization
where organization.id = api_key.org_id
  and organization.status <> 'active'
  and api_key.status = 'active';

update public.membership_invitations as invitation
set
  status = 'revoked',
  updated_at = now()
from public.organizations as organization
where organization.id = invitation.org_id
  and organization.status <> 'active'
  and invitation.status = 'pending';

drop trigger if exists membership_invitations_require_active_org
  on public.membership_invitations;
create trigger membership_invitations_require_active_org
before insert or update or delete on public.membership_invitations
for each row execute function public.enforce_active_organization_write();

drop trigger if exists programs_require_active_org on public.programs;
create trigger programs_require_active_org
before insert or update or delete on public.programs
for each row execute function public.enforce_active_organization_write();

drop trigger if exists program_versions_require_active_org
  on public.program_versions;
create trigger program_versions_require_active_org
before insert or update or delete on public.program_versions
for each row execute function public.enforce_active_organization_write();

drop trigger if exists jotform_forms_require_active_org
  on public.jotform_forms;
create trigger jotform_forms_require_active_org
before insert or update or delete on public.jotform_forms
for each row execute function public.enforce_active_organization_write();

drop trigger if exists cohorts_require_active_org on public.cohorts;
create trigger cohorts_require_active_org
before insert or update or delete on public.cohorts
for each row execute function public.enforce_active_organization_write();

drop trigger if exists trainees_require_active_org on public.trainees;
create trigger trainees_require_active_org
before insert or update or delete on public.trainees
for each row execute function public.enforce_active_organization_write();

drop trigger if exists enrollments_require_active_org on public.enrollments;
create trigger enrollments_require_active_org
before insert or update or delete on public.enrollments
for each row execute function public.enforce_active_organization_write();

drop trigger if exists access_requests_require_active_org
  on public.access_requests;
create trigger access_requests_require_active_org
before insert or update or delete on public.access_requests
for each row execute function public.enforce_active_organization_write();

drop trigger if exists assessment_tokens_require_active_org
  on public.assessment_submission_tokens;
create trigger assessment_tokens_require_active_org
before insert or update or delete on public.assessment_submission_tokens
for each row execute function public.enforce_active_organization_write();

drop trigger if exists webhook_ingestions_require_active_org
  on public.webhook_ingestions;
create trigger webhook_ingestions_require_active_org
before insert or update or delete on public.webhook_ingestions
for each row execute function public.enforce_active_organization_write();

drop trigger if exists assessments_require_active_org on public.assessments;
create trigger assessments_require_active_org
before insert or update or delete on public.assessments
for each row execute function public.enforce_active_organization_write();

drop trigger if exists org_api_keys_require_active_org on public.org_api_keys;
create trigger org_api_keys_require_active_org
before insert or update or delete on public.org_api_keys
for each row execute function public.enforce_active_organization_write();

drop trigger if exists xapi_statements_require_active_org
  on public.xapi_statements;
create trigger xapi_statements_require_active_org
before insert or update or delete on public.xapi_statements
for each row execute function public.enforce_active_organization_write();

drop trigger if exists impact_reports_require_active_org
  on public.impact_reports;
create trigger impact_reports_require_active_org
before insert or update or delete on public.impact_reports
for each row execute function public.enforce_active_organization_write();

drop trigger if exists cohort_reports_require_active_org
  on public.cohort_reports;
create trigger cohort_reports_require_active_org
before insert or update or delete on public.cohort_reports
for each row execute function public.enforce_active_organization_write();

drop trigger if exists certificates_require_active_org
  on public.certificates;
create trigger certificates_require_active_org
before insert or update or delete on public.certificates
for each row execute function public.enforce_active_organization_write();

create or replace function public.create_platform_organization(
  target_slug text,
  target_name_ar text,
  target_name_en text default null,
  target_logo_url text default null,
  target_brand_color text default '#C9A24B'
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(btrim(target_slug));
  normalized_name_ar text := btrim(target_name_ar);
  normalized_name_en text := nullif(btrim(target_name_en), '');
  normalized_logo_url text := nullif(btrim(target_logo_url), '');
  normalized_brand_color text := upper(btrim(target_brand_color));
  created_organization public.organizations%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  if not public.has_permission('organizations.create', null) then
    raise exception 'Organization creation is not allowed'
      using errcode = '42501';
  end if;

  if coalesce(length(normalized_slug), 0) not between 1 and 100
    or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  then
    raise exception 'Invalid organization slug';
  end if;

  if coalesce(length(normalized_name_ar), 0) not between 2 and 160
    or (
      normalized_name_en is not null
      and length(normalized_name_en) not between 2 and 160
    )
  then
    raise exception 'Invalid organization name';
  end if;

  if normalized_logo_url is not null
    and normalized_logo_url !~ '^https://[^[:space:]]+$'
  then
    raise exception 'Organization logo must use HTTPS';
  end if;

  if coalesce(normalized_brand_color, '') !~ '^#[0-9A-F]{6}$' then
    raise exception 'Invalid organization brand color';
  end if;

  insert into public.organizations (
    slug,
    name_ar,
    name_en,
    logo_url,
    brand_color,
    status
  )
  values (
    normalized_slug,
    normalized_name_ar,
    normalized_name_en,
    normalized_logo_url,
    normalized_brand_color,
    'active'
  )
  returning * into created_organization;

  -- A tenant must never exist without a recoverable authority path. The
  -- creating platform owner becomes the first organization owner atomically
  -- and can transfer that role through the audited membership contract.
  insert into public.memberships (
    user_id,
    org_id,
    role,
    status,
    invited_by
  )
  values (
    (select auth.uid()),
    created_organization.id,
    'owner',
    'active',
    (select auth.uid())
  );

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_data,
    metadata
  )
  values (
    created_organization.id,
    (select auth.uid()),
    'organization.created',
    'organization',
    created_organization.id::text,
    jsonb_build_object(
      'slug', created_organization.slug,
      'name_ar', created_organization.name_ar,
      'name_en', created_organization.name_en,
      'brand_color', created_organization.brand_color,
      'status', created_organization.status
    ),
    jsonb_build_object(
      'channel', 'platform_rpc',
      'initial_owner_user_id', (select auth.uid())
    )
  );

  return created_organization;
end;
$$;

create or replace function public.update_organization_profile(
  target_org_id uuid,
  target_name_ar text,
  target_name_en text,
  target_logo_url text,
  target_brand_color text
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_name_ar text := btrim(target_name_ar);
  normalized_name_en text := nullif(btrim(target_name_en), '');
  normalized_logo_url text := nullif(btrim(target_logo_url), '');
  normalized_brand_color text := upper(btrim(target_brand_color));
  before_organization public.organizations%rowtype;
  updated_organization public.organizations%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    public.has_permission('organizations.update', null)
    or public.has_permission('organization.update', target_org_id)
  ) then
    raise exception 'Organization update is not allowed'
      using errcode = '42501';
  end if;

  if coalesce(length(normalized_name_ar), 0) not between 2 and 160
    or (
      normalized_name_en is not null
      and length(normalized_name_en) not between 2 and 160
    )
  then
    raise exception 'Invalid organization name';
  end if;

  if normalized_logo_url is not null
    and normalized_logo_url !~ '^https://[^[:space:]]+$'
  then
    raise exception 'Organization logo must use HTTPS';
  end if;

  if coalesce(normalized_brand_color, '') !~ '^#[0-9A-F]{6}$' then
    raise exception 'Invalid organization brand color';
  end if;

  select organization.*
  into before_organization
  from public.organizations as organization
  where organization.id = target_org_id
  for update;

  if before_organization.id is null then
    raise exception 'Organization was not found';
  end if;

  update public.organizations as organization
  set
    name_ar = normalized_name_ar,
    name_en = normalized_name_en,
    logo_url = normalized_logo_url,
    brand_color = normalized_brand_color
  where organization.id = target_org_id
  returning * into updated_organization;

  if row(
    before_organization.name_ar,
    before_organization.name_en,
    before_organization.logo_url,
    before_organization.brand_color
  ) is not distinct from row(
    updated_organization.name_ar,
    updated_organization.name_en,
    updated_organization.logo_url,
    updated_organization.brand_color
  ) then
    raise exception 'Organization profile did not change';
  end if;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  )
  values (
    target_org_id,
    (select auth.uid()),
    'organization.profile_updated',
    'organization',
    target_org_id::text,
    jsonb_build_object(
      'name_ar', before_organization.name_ar,
      'name_en', before_organization.name_en,
      'logo_url', before_organization.logo_url,
      'brand_color', before_organization.brand_color
    ),
    jsonb_build_object(
      'name_ar', updated_organization.name_ar,
      'name_en', updated_organization.name_en,
      'logo_url', updated_organization.logo_url,
      'brand_color', updated_organization.brand_color
    ),
    jsonb_build_object('channel', 'organization_rpc')
  );

  return updated_organization;
end;
$$;

create or replace function public.change_platform_organization_status(
  target_org_id uuid,
  target_status text,
  target_reason text
)
returns public.organizations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_status text := lower(btrim(target_status));
  normalized_reason text := btrim(target_reason);
  before_organization public.organizations%rowtype;
  updated_organization public.organizations%rowtype;
  revoked_key_count integer := 0;
  revoked_invitation_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  if not public.has_permission('organizations.change_status', null) then
    raise exception 'Organization status management is not allowed'
      using errcode = '42501';
  end if;

  if coalesce(normalized_status, '')
    not in ('active', 'suspended', 'archived')
  then
    raise exception 'Invalid organization status';
  end if;

  if coalesce(length(normalized_reason), 0) not between 5 and 500 then
    raise exception 'A status-change reason is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('organization-status:' || target_org_id::text, 0)
  );

  select organization.*
  into before_organization
  from public.organizations as organization
  where organization.id = target_org_id
  for update;

  if before_organization.id is null then
    raise exception 'Organization was not found';
  end if;

  if before_organization.status = normalized_status then
    raise exception 'Organization already has the requested status';
  end if;

  -- Suspend access credentials before the organization becomes inactive.
  -- Reactivation never restores a revoked credential or invitation.
  if normalized_status <> 'active'
    and before_organization.status = 'active'
  then
    update public.org_api_keys as api_key
    set
      status = 'revoked',
      revoked_at = coalesce(api_key.revoked_at, now())
    where api_key.org_id = target_org_id
      and api_key.status = 'active';
    get diagnostics revoked_key_count = row_count;

    update public.membership_invitations as invitation
    set
      status = 'revoked',
      updated_at = now()
    where invitation.org_id = target_org_id
      and invitation.status = 'pending';
    get diagnostics revoked_invitation_count = row_count;
  end if;

  update public.organizations as organization
  set
    status = normalized_status,
    archived_at = case
      when normalized_status = 'archived' then now()
      else null
    end
  where organization.id = target_org_id
  returning * into updated_organization;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  )
  values (
    target_org_id,
    (select auth.uid()),
    'organization.status_changed',
    'organization',
    target_org_id::text,
    jsonb_build_object('status', before_organization.status),
    jsonb_build_object('status', updated_organization.status),
    jsonb_build_object(
      'reason', normalized_reason,
      'channel', 'platform_rpc',
      'revoked_api_keys', revoked_key_count,
      'revoked_pending_invitations', revoked_invitation_count
    )
  );

  return updated_organization;
end;
$$;

create or replace function public.set_organization_membership(
  target_org_id uuid,
  target_user_id uuid,
  target_role text,
  target_status text,
  target_reason text
)
returns public.memberships
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_role text := lower(btrim(target_role));
  normalized_status text := lower(btrim(target_status));
  normalized_reason text := btrim(target_reason);
  can_manage_all boolean;
  can_manage_organization boolean;
  target_organization public.organizations%rowtype;
  before_membership public.memberships%rowtype;
  updated_membership public.memberships%rowtype;
  remaining_owner_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  can_manage_all :=
    public.has_permission('memberships.manage_all', null);
  can_manage_organization :=
    public.has_permission('memberships.manage', target_org_id);

  if not (can_manage_all or can_manage_organization) then
    raise exception 'Membership management is not allowed'
      using errcode = '42501';
  end if;

  if coalesce(normalized_role, '')
    not in ('owner', 'trainer', 'viewer')
  then
    raise exception 'Invalid membership role';
  end if;

  if coalesce(normalized_status, '')
    not in ('active', 'suspended', 'revoked')
  then
    raise exception 'Invalid membership status';
  end if;

  if coalesce(length(normalized_reason), 0) not between 5 and 500 then
    raise exception 'A membership-change reason is required';
  end if;

  if target_user_id is null or not exists (
    select 1
    from auth.users as account
    where account.id = target_user_id
  ) then
    raise exception 'Target user was not found';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('membership-owner:' || target_org_id::text, 0)
  );

  select organization.*
  into target_organization
  from public.organizations as organization
  where organization.id = target_org_id
  for update;

  if target_organization.id is null then
    raise exception 'Organization was not found';
  end if;

  if target_organization.status <> 'active' then
    raise exception 'Memberships cannot be changed for an inactive organization'
      using errcode = '42501';
  end if;

  select membership.*
  into before_membership
  from public.memberships as membership
  where membership.org_id = target_org_id
    and membership.user_id = target_user_id
  for update;

  if before_membership.user_id is null
    and normalized_status <> 'active'
  then
    raise exception 'A new membership must start active';
  end if;

  if before_membership.user_id is not null
    and before_membership.role = normalized_role
    and before_membership.status = normalized_status
  then
    raise exception 'Membership did not change';
  end if;

  if before_membership.user_id is not null
    and before_membership.role = 'owner'
    and before_membership.status = 'active'
    and not (
      normalized_role = 'owner'
      and normalized_status = 'active'
    )
  then
    select count(distinct membership.user_id)
    into remaining_owner_count
    from public.memberships as membership
    join auth.users as account
      on account.id = membership.user_id
    where membership.org_id = target_org_id
      and membership.role = 'owner'
      and membership.status = 'active'
      and membership.user_id is distinct from target_user_id;

    if remaining_owner_count < 1 then
      raise exception 'The final active organization owner cannot be changed';
    end if;

    if target_user_id = (select auth.uid()) and not can_manage_all then
      raise exception 'Organization owners cannot remove their own access';
    end if;
  end if;

  insert into public.memberships (
    user_id,
    org_id,
    role,
    status,
    invited_by
  )
  values (
    target_user_id,
    target_org_id,
    normalized_role,
    normalized_status,
    (select auth.uid())
  )
  on conflict (user_id, org_id) do update
  set
    role = excluded.role,
    status = excluded.status,
    updated_at = now()
  returning * into updated_membership;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  )
  values (
    target_org_id,
    (select auth.uid()),
    case
      when before_membership.user_id is null then 'membership.created'
      else 'membership.updated'
    end,
    'membership',
    target_user_id::text,
    case
      when before_membership.user_id is null then null
      else jsonb_build_object(
        'role', before_membership.role,
        'status', before_membership.status
      )
    end,
    jsonb_build_object(
      'role', updated_membership.role,
      'status', updated_membership.status
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'channel', case
        when can_manage_all then 'platform_rpc'
        else 'organization_rpc'
      end
    )
  );

  return updated_membership;
end;
$$;

revoke all on function public.create_platform_organization(
  text,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.create_platform_organization(
  text,
  text,
  text,
  text,
  text
) from anon;
grant execute on function public.create_platform_organization(
  text,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.update_organization_profile(
  uuid,
  text,
  text,
  text,
  text
) from public;
revoke all on function public.update_organization_profile(
  uuid,
  text,
  text,
  text,
  text
) from anon;
grant execute on function public.update_organization_profile(
  uuid,
  text,
  text,
  text,
  text
) to authenticated;

revoke all on function public.change_platform_organization_status(
  uuid,
  text,
  text
) from public;
revoke all on function public.change_platform_organization_status(
  uuid,
  text,
  text
) from anon;
grant execute on function public.change_platform_organization_status(
  uuid,
  text,
  text
) to authenticated;

revoke all on function public.set_organization_membership(
  uuid,
  uuid,
  text,
  text,
  text
) from public;
revoke all on function public.set_organization_membership(
  uuid,
  uuid,
  text,
  text,
  text
) from anon;
grant execute on function public.set_organization_membership(
  uuid,
  uuid,
  text,
  text,
  text
) to authenticated;

-- Keep historical certificate verification available, but hide every active
-- trainee workflow as soon as the tenant is suspended or archived.
create or replace function public.get_public_trainee_route(
  p_trainee_code text
)
returns table (
  trainee_code text,
  program_title text,
  cohort_title text,
  cohort_status text,
  pre_form_id text,
  pre_field_name text,
  post_form_id text,
  post_field_name text,
  pre_completed boolean,
  live_event_count bigint,
  post_completed boolean,
  certificate_verify_code text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with current_enrollment as (
    select
      trainee.code as trainee_code,
      program.title_ar as program_title,
      cohort.title as cohort_title,
      cohort.status as cohort_status,
      enrollment.id as enrollment_id,
      program_version.id as program_version_id
    from public.trainees as trainee
    join public.organizations as organization
      on organization.id = trainee.org_id
     and organization.status = 'active'
    join public.enrollments as enrollment
      on enrollment.trainee_id = trainee.id
     and enrollment.org_id = trainee.org_id
    join public.cohorts as cohort
      on cohort.id = enrollment.cohort_id
     and cohort.org_id = enrollment.org_id
    join public.programs as program
      on program.id = cohort.program_id
     and program.org_id = cohort.org_id
    join public.program_versions as program_version
      on program_version.id = cohort.program_version_id
     and program_version.program_id = cohort.program_id
     and program_version.org_id = cohort.org_id
    where trainee.code = upper(btrim(p_trainee_code))
      and trainee.status = 'active'
      and enrollment.status in ('invited', 'active', 'completed')
      and cohort.status <> 'archived'
    order by enrollment.enrolled_at desc
    limit 1
  )
  select
    current_enrollment.trainee_code,
    current_enrollment.program_title,
    current_enrollment.cohort_title,
    current_enrollment.cohort_status,
    pre_form.form_id as pre_form_id,
    pre_form.trainee_field_name as pre_field_name,
    post_form.form_id as post_form_id,
    post_form.trainee_field_name as post_field_name,
    exists (
      select 1
      from public.assessments as assessment
      where assessment.enrollment_id = current_enrollment.enrollment_id
        and assessment.assessment_kind = 'pre'
    ) as pre_completed,
    (
      select count(*)
      from public.xapi_statements as statement
      where statement.enrollment_id = current_enrollment.enrollment_id
        and statement.processing_status = 'accepted'
        and coalesce(
          statement.context #>> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/test-event'
          ],
          'false'
        ) <> 'true'
    ) as live_event_count,
    exists (
      select 1
      from public.assessments as assessment
      where assessment.enrollment_id = current_enrollment.enrollment_id
        and assessment.assessment_kind = 'post'
    ) as post_completed,
    -- Preserve the established return signature without linking the short,
    -- enumerable trainee code to the high-trust public certificate record.
    null::text as certificate_verify_code
  from current_enrollment
  left join public.jotform_forms as pre_form
    on pre_form.program_version_id = current_enrollment.program_version_id
   and pre_form.assessment_kind = 'pre'
   and pre_form.is_active
  left join public.jotform_forms as post_form
    on post_form.program_version_id = current_enrollment.program_version_id
   and post_form.assessment_kind = 'post'
   and post_form.is_active;
$$;

revoke all on function public.get_public_trainee_route(text) from public;
grant execute on function public.get_public_trainee_route(text) to anon;
grant execute on function public.get_public_trainee_route(text)
  to authenticated;

comment on function public.enforce_active_organization_write() is
  'Rejects operational writes for suspended or archived organizations.';
comment on function public.set_organization_membership(
  uuid,
  uuid,
  text,
  text,
  text
) is
  'Audited membership mutation contract with final-owner protection.';

commit;
