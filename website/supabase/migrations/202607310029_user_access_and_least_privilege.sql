begin;

create table public.user_access_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_suspended boolean not null default false,
  suspension_reason text,
  suspended_at timestamptz,
  suspended_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint user_access_controls_suspension_check
    check (
      (
        is_suspended
        and suspended_at is not null
        and length(btrim(coalesce(suspension_reason, ''))) between 5 and 500
      )
      or
      (
        not is_suspended
        and suspended_at is null
        and suspension_reason is null
      )
    )
);

alter table public.user_access_controls enable row level security;

revoke all on table public.user_access_controls
  from public, anon, authenticated, service_role;
grant select on table public.user_access_controls to authenticated;
grant select on table public.user_access_controls to service_role;

create or replace function public.is_user_access_active(
  target_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_user_id is not null
    and not exists (
      select 1
      from public.user_access_controls as control
      where control.user_id = target_user_id
        and control.is_suspended = true
    );
$$;

revoke all on function public.is_user_access_active(uuid) from public;
revoke all on function public.is_user_access_active(uuid) from anon;
grant execute on function public.is_user_access_active(uuid)
  to authenticated, service_role;

-- Re-evaluate both final-owner guards now that platform suspension exists.
-- An assignment counts only when it belongs to a real auth user whose access
-- is not suspended. The trigger OIDs remain stable because CREATE OR REPLACE
-- updates the functions installed by migrations 026 and 027.
create or replace function public.protect_final_platform_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  removes_active_owner boolean := false;
  remaining_owner_count integer;
begin
  if tg_op = 'UPDATE' and new.user_id is distinct from old.user_id then
    raise exception 'Platform owner identity is immutable'
      using errcode = '22023';
  end if;

  if old.is_active then
    removes_active_owner :=
      tg_op = 'DELETE'
      or (tg_op = 'UPDATE' and not new.is_active);
  end if;

  if removes_active_owner then
    perform pg_advisory_xact_lock(
      hashtextextended('platform-owner:effective-assignment', 0)
    );

    select count(distinct assignment.user_id)
    into remaining_owner_count
    from public.platform_admins as assignment
    join auth.users as account
      on account.id = assignment.user_id
    left join public.user_access_controls as control
      on control.user_id = assignment.user_id
    where assignment.is_active = true
      and assignment.user_id is distinct from old.user_id
      and coalesce(control.is_suspended, false) = false;

    if remaining_owner_count < 1 then
      raise exception 'The final active platform owner cannot be changed'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.protect_final_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
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
    left join public.user_access_controls as control
      on control.user_id = membership.user_id
    where membership.org_id = old.org_id
      and membership.role = 'owner'
      and membership.status = 'active'
      and membership.user_id is distinct from old.user_id
      and coalesce(control.is_suspended, false) = false;

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

create or replace function public.protect_effective_owner_suspension()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  target_org_id uuid;
  remaining_owner_count integer;
begin
  if not new.is_suspended
    or (tg_op = 'UPDATE' and old.is_suspended)
  then
    return new;
  end if;

  if exists (
    select 1
    from public.platform_admins as assignment
    where assignment.user_id = new.user_id
      and assignment.is_active = true
  ) then
    perform pg_advisory_xact_lock(
      hashtextextended('platform-owner:effective-assignment', 0)
    );

    select count(distinct assignment.user_id)
    into remaining_owner_count
    from public.platform_admins as assignment
    join auth.users as account
      on account.id = assignment.user_id
    left join public.user_access_controls as control
      on control.user_id = assignment.user_id
    where assignment.is_active = true
      and assignment.user_id is distinct from new.user_id
      and coalesce(control.is_suspended, false) = false;

    if remaining_owner_count < 1 then
      raise exception 'The final active platform owner cannot be suspended'
        using errcode = '23514';
    end if;
  end if;

  for target_org_id in
    select membership.org_id
    from public.memberships as membership
    where membership.user_id = new.user_id
      and membership.role = 'owner'
      and membership.status = 'active'
    order by membership.org_id
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('membership-owner:' || target_org_id::text, 0)
    );

    select count(distinct membership.user_id)
    into remaining_owner_count
    from public.memberships as membership
    join auth.users as account
      on account.id = membership.user_id
    left join public.user_access_controls as control
      on control.user_id = membership.user_id
    where membership.org_id = target_org_id
      and membership.role = 'owner'
      and membership.status = 'active'
      and membership.user_id is distinct from new.user_id
      and coalesce(control.is_suspended, false) = false;

    if remaining_owner_count < 1 then
      raise exception 'The final active organization owner cannot be suspended'
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.protect_effective_owner_suspension()
  from public, anon, authenticated;

drop trigger if exists user_access_controls_protect_effective_owner
  on public.user_access_controls;
create trigger user_access_controls_protect_effective_owner
before insert or update of is_suspended on public.user_access_controls
for each row execute function public.protect_effective_owner_suspension();

create or replace function public.enforce_active_membership_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'active'
    and not public.is_user_access_active(new.user_id)
  then
    raise exception 'A suspended user cannot receive an active membership'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_active_membership_user()
  from public, anon, authenticated;

drop trigger if exists memberships_enforce_active_user
  on public.memberships;
create trigger memberships_enforce_active_user
before insert or update of user_id, status on public.memberships
for each row execute function public.enforce_active_membership_user();

create or replace function public.has_permission(
  target_permission text,
  target_org_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with requested_permission as (
    select permission.permission_key, permission.scope
    from public.authorization_permissions as permission
    where permission.permission_key = target_permission
  ),
  active_actor as (
    select public.is_user_access_active((select auth.uid())) as allowed
  ),
  platform_access as (
    select 1
    from public.platform_admins as assignment
    join public.authorization_role_permissions as role_permission
      on role_permission.role_key = assignment.role_key
    join requested_permission as permission
      on permission.permission_key = role_permission.permission_key
    where assignment.user_id = (select auth.uid())
      and assignment.is_active = true
      and (select allowed from active_actor)
  ),
  organization_access as (
    select 1
    from public.memberships as membership
    join public.organizations as organization
      on organization.id = membership.org_id
    join public.authorization_role_permissions as role_permission
      on role_permission.role_key = membership.role
    join requested_permission as permission
      on permission.permission_key = role_permission.permission_key
     and permission.scope = 'organization'
    where target_org_id is not null
      and membership.user_id = (select auth.uid())
      and membership.org_id = target_org_id
      and membership.status = 'active'
      and organization.status = 'active'
      and (select allowed from active_actor)
  )
  select case
    when not exists (select 1 from requested_permission) then false
    when not (select allowed from active_actor) then false
    when (
      select permission.scope = 'organization'
      from requested_permission as permission
    ) and (
      target_org_id is null
      or not exists (
        select 1
        from public.organizations as organization
        where organization.id = target_org_id
      )
    ) then false
    else
      exists (select 1 from platform_access)
      or exists (select 1 from organization_access)
  end;
$$;

create or replace function public.has_org_role(
  target_org_id uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    target_org_id is not null
    and public.is_user_access_active((select auth.uid()))
    and exists (
      select 1
      from public.memberships as membership
      join public.organizations as organization
        on organization.id = membership.org_id
      where membership.user_id = (select auth.uid())
        and membership.org_id = target_org_id
        and membership.status = 'active'
        and membership.role = any(allowed_roles)
        and organization.status = 'active'
    );
$$;

revoke all on function public.has_permission(text, uuid) from public;
revoke all on function public.has_permission(text, uuid) from anon;
grant execute on function public.has_permission(text, uuid)
  to authenticated;
revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.has_org_role(uuid, text[]) from anon;
grant execute on function public.has_org_role(uuid, text[])
  to authenticated;

create policy user_access_controls_select_authorized
on public.user_access_controls for select to authenticated
using (
  user_id = (select auth.uid())
  or public.has_permission('users.read', null)
);

create or replace function public.list_platform_users()
returns table (
  user_id uuid,
  email text,
  display_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_suspended boolean,
  suspension_reason text,
  membership_count bigint,
  is_platform_owner boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('users.read', null) then
    raise exception 'Platform user listing is not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    account.id,
    account.email::text,
    nullif(btrim(account.raw_user_meta_data ->> 'full_name'), ''),
    account.created_at,
    account.last_sign_in_at,
    coalesce(control.is_suspended, false),
    control.suspension_reason,
    (
      select count(*)
      from public.memberships as membership
      where membership.user_id = account.id
        and membership.status = 'active'
    ),
    exists (
      select 1
      from public.platform_admins as assignment
      where assignment.user_id = account.id
        and assignment.is_active = true
    )
  from auth.users as account
  left join public.user_access_controls as control
    on control.user_id = account.id
  order by account.created_at desc;
end;
$$;

revoke all on function public.list_platform_users() from public;
revoke all on function public.list_platform_users() from anon;
grant execute on function public.list_platform_users() to authenticated;

create or replace function public.set_platform_user_suspension(
  target_user_id uuid,
  target_suspended boolean,
  target_reason text
)
returns public.user_access_controls
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_reason text := btrim(target_reason);
  before_control public.user_access_controls%rowtype;
  updated_control public.user_access_controls%rowtype;
  remaining_owner_count integer;
  target_is_platform_owner boolean;
  owned_org_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required';
  end if;

  if not public.has_permission('users.suspend', null) then
    raise exception 'Platform user suspension is not allowed'
      using errcode = '42501';
  end if;

  if target_user_id is null or not exists (
    select 1 from auth.users as account where account.id = target_user_id
  ) then
    raise exception 'Target user was not found';
  end if;

  if target_user_id = (select auth.uid()) then
    raise exception 'A platform owner cannot suspend their own account';
  end if;

  if coalesce(length(normalized_reason), 0) not between 5 and 500 then
    raise exception 'A suspension change reason is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-owner:effective-assignment', 0)
  );

  select control.*
  into before_control
  from public.user_access_controls as control
  where control.user_id = target_user_id
  for update;

  if coalesce(before_control.is_suspended, false) = target_suspended then
    raise exception 'User access state did not change';
  end if;

  select exists (
    select 1
    from public.platform_admins as assignment
    where assignment.user_id = target_user_id
      and assignment.is_active = true
  ) into target_is_platform_owner;

  if target_suspended and target_is_platform_owner then
    select count(distinct assignment.user_id)
    into remaining_owner_count
    from public.platform_admins as assignment
    join auth.users as account
      on account.id = assignment.user_id
    left join public.user_access_controls as control
      on control.user_id = assignment.user_id
    where assignment.is_active = true
      and assignment.user_id is distinct from target_user_id
      and coalesce(control.is_suspended, false) = false;

    if remaining_owner_count < 1 then
      raise exception 'The final active platform owner cannot be suspended';
    end if;
  end if;

  if target_suspended then
    for owned_org_id in
      select membership.org_id
      from public.memberships as membership
      where membership.user_id = target_user_id
        and membership.role = 'owner'
        and membership.status = 'active'
      order by membership.org_id
    loop
      perform pg_advisory_xact_lock(
        hashtextextended('membership-owner:' || owned_org_id::text, 0)
      );

      select count(distinct membership.user_id)
      into remaining_owner_count
      from public.memberships as membership
      join auth.users as account
        on account.id = membership.user_id
      left join public.user_access_controls as control
        on control.user_id = membership.user_id
      where membership.org_id = owned_org_id
        and membership.role = 'owner'
        and membership.status = 'active'
        and membership.user_id is distinct from target_user_id
        and coalesce(control.is_suspended, false) = false;

      if remaining_owner_count < 1 then
        raise exception 'The final active organization owner cannot be suspended';
      end if;
    end loop;
  end if;

  insert into public.user_access_controls (
    user_id,
    is_suspended,
    suspension_reason,
    suspended_at,
    suspended_by,
    updated_at
  )
  values (
    target_user_id,
    target_suspended,
    case when target_suspended then normalized_reason else null end,
    case when target_suspended then now() else null end,
    case when target_suspended then (select auth.uid()) else null end,
    now()
  )
  on conflict (user_id) do update
  set
    is_suspended = excluded.is_suspended,
    suspension_reason = excluded.suspension_reason,
    suspended_at = excluded.suspended_at,
    suspended_by = excluded.suspended_by,
    updated_at = now()
  returning * into updated_control;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    reason,
    metadata
  )
  values (
    null,
    (select auth.uid()),
    case
      when target_suspended then 'user.suspended'
      else 'user.restored'
    end,
    'user',
    target_user_id::text,
    jsonb_build_object(
      'is_suspended', coalesce(before_control.is_suspended, false)
    ),
    jsonb_build_object('is_suspended', updated_control.is_suspended),
    normalized_reason,
    jsonb_build_object('channel', 'platform_rpc')
  );

  return updated_control;
end;
$$;

revoke all on function public.set_platform_user_suspension(
  uuid,
  boolean,
  text
) from public;
revoke all on function public.set_platform_user_suspension(
  uuid,
  boolean,
  text
) from anon;
grant execute on function public.set_platform_user_suspension(
  uuid,
  boolean,
  text
) to authenticated;

-- Contact details are not part of the viewer role. Safe trainee columns remain
-- selectable under RLS; contact data is available only through an audited-role
-- checked function for staff who can manage trainees.
revoke select on table public.trainees from authenticated;
grant select (
  id,
  org_id,
  code,
  full_name,
  status,
  created_by,
  created_at,
  updated_at,
  archived_at
) on table public.trainees to authenticated;

create or replace function public.get_trainee_contacts(
  target_org_id uuid
)
returns table (
  trainee_id uuid,
  phone text,
  email text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('trainees.manage', target_org_id) then
    raise exception 'Trainee contact access is not allowed'
      using errcode = '42501';
  end if;

  return query
  select trainee.id, trainee.phone, trainee.email
  from public.trainees as trainee
  where trainee.org_id = target_org_id;
end;
$$;

revoke all on function public.get_trainee_contacts(uuid) from public;
revoke all on function public.get_trainee_contacts(uuid) from anon;
grant execute on function public.get_trainee_contacts(uuid)
  to authenticated;

-- Raw provider payloads, answer bodies, answer keys embedded in graded items,
-- and complete xAPI statements are server evidence, not browser read models.
-- Keep only the normalized fields used by staff pages available under RLS.
revoke select on table public.webhook_ingestions from authenticated;
revoke select on table public.assessments from authenticated;
grant select (
  id,
  org_id,
  cohort_id,
  enrollment_id,
  ingestion_id,
  jotform_form_id,
  source,
  form_id,
  submission_id,
  assessment_kind,
  trainee_code_received,
  score,
  max_score,
  score_percentage,
  confidence,
  submitted_at,
  created_at
) on table public.assessments to authenticated;

create or replace function public.safe_xapi_result_projection(
  input_value jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(
    jsonb_build_object(
      'success', case
        when jsonb_typeof(input_value -> 'success') = 'boolean'
          then input_value -> 'success'
        else null
      end,
      'completion', case
        when jsonb_typeof(input_value -> 'completion') = 'boolean'
          then input_value -> 'completion'
        else null
      end,
      'extensions', jsonb_strip_nulls(
        jsonb_build_object(
          'https://miqyas.al-amad.com.sa/xapi/extensions/is-correct', case
            when jsonb_typeof(input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/is-correct'
            ]) = 'boolean'
              then input_value #> array[
                'extensions',
                'https://miqyas.al-amad.com.sa/xapi/extensions/is-correct'
              ]
            when input_value #>> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/is-correct'
            ] in ('true', 'false')
              then to_jsonb(input_value #>> array[
                'extensions',
                'https://miqyas.al-amad.com.sa/xapi/extensions/is-correct'
              ])
            else null
          end,
          'https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms', case
            when jsonb_typeof(input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms'
            ]) = 'number'
              then input_value #> array[
                'extensions',
                'https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms'
              ]
            when input_value #>> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms'
            ] ~ '^[0-9]+([.][0-9]+)?$'
              then to_jsonb(input_value #>> array[
                'extensions',
                'https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms'
              ])
            else null
          end
        )
      ),
      'score', case
        when jsonb_typeof(input_value -> 'score') = 'object'
          then jsonb_strip_nulls(
            jsonb_build_object(
              'raw', case
                when jsonb_typeof(input_value #> '{score,raw}') = 'number'
                  then input_value #> '{score,raw}'
                else null
              end,
              'min', case
                when jsonb_typeof(input_value #> '{score,min}') = 'number'
                  then input_value #> '{score,min}'
                else null
              end,
              'max', case
                when jsonb_typeof(input_value #> '{score,max}') = 'number'
                  then input_value #> '{score,max}'
                else null
              end,
              'scaled', case
                when jsonb_typeof(input_value #> '{score,scaled}') = 'number'
                  then input_value #> '{score,scaled}'
                else null
              end
            )
          )
        else null
      end
    )
  );
$$;

create or replace function public.safe_xapi_context_projection(
  input_value jsonb
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'extensions',
    jsonb_strip_nulls(
      jsonb_build_object(
        'https://miqyas.al-amad.com.sa/xapi/extensions/test-event', case
          when jsonb_typeof(input_value #> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/test-event'
          ]) = 'boolean'
            then input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/test-event'
            ]
          else null
        end,
        'https://miqyas.al-amad.com.sa/xapi/extensions/contract-version', case
          when jsonb_typeof(input_value #> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/contract-version'
          ]) = 'string'
            then input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/contract-version'
            ]
          else null
        end,
        'https://miqyas.al-amad.com.sa/xapi/extensions/program-id', case
          when jsonb_typeof(input_value #> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/program-id'
          ]) = 'string'
            then input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/program-id'
            ]
          else null
        end,
        'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id', case
          when jsonb_typeof(input_value #> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id'
          ]) = 'string'
            then input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id'
            ]
          else null
        end,
        'https://miqyas.al-amad.com.sa/xapi/extensions/scene-id', case
          when jsonb_typeof(input_value #> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/scene-id'
          ]) = 'string'
            then input_value #> array[
              'extensions',
              'https://miqyas.al-amad.com.sa/xapi/extensions/scene-id'
            ]
          else null
        end
      )
    )
  );
$$;

create or replace function public.prepare_xapi_browser_projection()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.result := public.safe_xapi_result_projection(new.result);
  new.context := public.safe_xapi_context_projection(new.context);
  return new;
end;
$$;

revoke all on function public.safe_xapi_result_projection(jsonb)
  from public, anon, authenticated;
revoke all on function public.safe_xapi_context_projection(jsonb)
  from public, anon, authenticated;
revoke all on function public.prepare_xapi_browser_projection()
  from public, anon, authenticated;

update public.xapi_statements as statement
set
  result = public.safe_xapi_result_projection(statement.result),
  context = public.safe_xapi_context_projection(statement.context);

drop trigger if exists xapi_statements_prepare_browser_projection
  on public.xapi_statements;
create trigger xapi_statements_prepare_browser_projection
before insert or update of result, context on public.xapi_statements
for each row execute function public.prepare_xapi_browser_projection();

revoke select on table public.xapi_statements from authenticated;
grant select (
  id,
  statement_id,
  org_id,
  enrollment_id,
  trainee_code_received,
  program_id,
  session_id,
  verb_id,
  object_id,
  result,
  context,
  processing_status,
  rejection_reason,
  occurred_at,
  received_at
) on table public.xapi_statements to authenticated;

revoke select on table public.org_api_keys from authenticated;

-- Every low-entropy public workflow passes through a server endpoint with a
-- keyed, non-reversible network fingerprint. Direct RPC execution is removed
-- below so a caller cannot omit the fingerprint or bypass these windows.
create table public.public_api_rate_windows (
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  scope text not null check (
    scope in ('trainee_route', 'assessment_link', 'access_request')
  ),
  window_started_at timestamptz not null,
  request_count integer not null default 0 check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (fingerprint, scope, window_started_at)
);

alter table public.public_api_rate_windows enable row level security;
revoke all on table public.public_api_rate_windows
  from public, anon, authenticated, service_role;

create or replace function public.consume_public_api_rate_limit(
  target_fingerprint text,
  target_scope text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  window_seconds integer;
  maximum_requests integer;
  current_window timestamptz;
  current_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required'
      using errcode = '42501';
  end if;

  if coalesce(target_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid public request fingerprint is required';
  end if;

  case target_scope
    when 'trainee_route' then
      window_seconds := 300;
      maximum_requests := 20;
    when 'assessment_link' then
      window_seconds := 600;
      maximum_requests := 6;
    when 'access_request' then
      window_seconds := 86400;
      maximum_requests := 10;
    else
      raise exception 'Invalid public rate-limit scope';
  end case;

  current_window := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / window_seconds)
      * window_seconds
  );

  insert into public.public_api_rate_windows (
    fingerprint,
    scope,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    target_fingerprint,
    target_scope,
    current_window,
    1,
    now()
  )
  on conflict (fingerprint, scope, window_started_at)
  do update
  set
    request_count = public.public_api_rate_windows.request_count + 1,
    updated_at = now()
  returning request_count into current_count;

  delete from public.public_api_rate_windows
  where window_started_at < now() - interval '2 days';

  return current_count <= maximum_requests;
end;
$$;

revoke all on function public.consume_public_api_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_public_api_rate_limit(text, text)
  to service_role;

revoke all on function public.get_public_trainee_route(text)
  from public, anon, authenticated;
grant execute on function public.get_public_trainee_route(text)
  to service_role;

revoke all on function public.create_public_assessment_link(text, text)
  from public, anon, authenticated;
grant execute on function public.create_public_assessment_link(text, text)
  to service_role;

revoke all on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;

alter function public.submit_access_request(text, text, text, text, text)
  rename to submit_access_request_internal;

revoke all on function public.submit_access_request_internal(
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated, service_role;

create function public.submit_access_request(
  target_org_slug text,
  applicant_full_name text,
  applicant_email text,
  applicant_role text,
  applicant_fingerprint text
)
returns table (
  result text,
  reference_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required'
      using errcode = '42501';
  end if;

  if coalesce(applicant_fingerprint, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid public request fingerprint is required';
  end if;

  return query
  select submission.result, submission.reference_code
  from public.submit_access_request_internal(
    target_org_slug,
    applicant_full_name,
    applicant_email,
    applicant_role,
    applicant_fingerprint
  ) as submission;
end;
$$;

revoke all on function public.submit_access_request(
  text,
  text,
  text,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.submit_access_request(
  text,
  text,
  text,
  text,
  text
) to service_role;

-- Align xAPI contracts with the explicit permission catalog. Reading key
-- metadata and mutating credentials are separate capabilities.
create or replace function public.list_org_xapi_keys(
  target_org_id uuid
)
returns table (
  id uuid,
  org_id uuid,
  label text,
  key_prefix text,
  status text,
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.has_permission('integrations.read', target_org_id) then
    raise exception 'xAPI key listing is not allowed'
      using errcode = '42501';
  end if;

  return query
  select
    api_key.id,
    api_key.org_id,
    api_key.label,
    api_key.key_prefix,
    api_key.status,
    api_key.created_at,
    api_key.last_used_at,
    api_key.revoked_at
  from public.org_api_keys as api_key
  where api_key.org_id = target_org_id
  order by api_key.created_at desc;
end;
$$;

create or replace function public.create_org_xapi_key(
  target_org_id uuid,
  target_label text,
  target_key_prefix text,
  target_key_hash text
)
returns table (
  id uuid,
  org_id uuid,
  label text,
  key_prefix text,
  status text,
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_key public.org_api_keys%rowtype;
begin
  if not public.has_permission('integrations.manage', target_org_id) then
    raise exception 'xAPI key creation is not allowed'
      using errcode = '42501';
  end if;

  if length(btrim(coalesce(target_label, ''))) not between 2 and 120 then
    raise exception 'Invalid xAPI key label';
  end if;

  if coalesce(target_key_prefix, '') !~ '^miq_xapi_[A-F0-9]{8}$' then
    raise exception 'Invalid xAPI key prefix';
  end if;

  if coalesce(target_key_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid xAPI key hash';
  end if;

  insert into public.org_api_keys (
    org_id,
    label,
    key_prefix,
    key_hash,
    created_by
  )
  values (
    target_org_id,
    btrim(target_label),
    target_key_prefix,
    target_key_hash,
    (select auth.uid())
  )
  returning * into created_key;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    created_key.org_id,
    (select auth.uid()),
    'xapi.key_created',
    'org_api_key',
    created_key.id::text,
    jsonb_build_object(
      'label', created_key.label,
      'key_prefix', created_key.key_prefix
    )
  );

  return query
  select
    created_key.id,
    created_key.org_id,
    created_key.label,
    created_key.key_prefix,
    created_key.status,
    created_key.created_at,
    created_key.last_used_at,
    created_key.revoked_at;
end;
$$;

create function public.revoke_org_xapi_key(
  target_key_id uuid,
  target_reason text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_key public.org_api_keys%rowtype;
  normalized_reason text := btrim(target_reason);
begin
  if coalesce(length(normalized_reason), 0) not between 5 and 500 then
    raise exception 'An xAPI key revocation reason is required';
  end if;

  select api_key.*
  into target_key
  from public.org_api_keys as api_key
  where api_key.id = target_key_id
  for update;

  if target_key.id is null then
    raise exception 'xAPI key was not found';
  end if;

  if not public.has_permission('integrations.manage', target_key.org_id) then
    raise exception 'xAPI key revocation is not allowed'
      using errcode = '42501';
  end if;

  if target_key.status = 'revoked' then
    return false;
  end if;

  update public.org_api_keys as api_key
  set
    status = 'revoked',
    revoked_at = now()
  where api_key.id = target_key.id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    reason,
    metadata
  )
  values (
    target_key.org_id,
    (select auth.uid()),
    'xapi.key_revoked',
    'org_api_key',
    target_key.id::text,
    jsonb_build_object('status', target_key.status),
    jsonb_build_object('status', 'revoked'),
    normalized_reason,
    jsonb_build_object('key_prefix', target_key.key_prefix)
  );

  return true;
end;
$$;

-- Preserve the legacy signature long enough for dependency-safe rollout, but
-- make it unusable. Callers must move to the reason-bearing overload before a
-- later cleanup migration removes this compatibility stub.
create or replace function public.revoke_org_xapi_key(
  target_key_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'An xAPI key revocation reason is required'
    using errcode = '22023';
end;
$$;

revoke all on function public.revoke_org_xapi_key(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.list_org_xapi_keys(uuid) from public;
revoke all on function public.list_org_xapi_keys(uuid) from anon;
grant execute on function public.list_org_xapi_keys(uuid)
  to authenticated;
revoke all on function public.create_org_xapi_key(
  uuid,
  text,
  text,
  text
) from public;
revoke all on function public.create_org_xapi_key(
  uuid,
  text,
  text,
  text
) from anon;
grant execute on function public.create_org_xapi_key(
  uuid,
  text,
  text,
  text
) to authenticated;
revoke all on function public.revoke_org_xapi_key(uuid, text)
  from public;
revoke all on function public.revoke_org_xapi_key(uuid, text)
  from anon;
grant execute on function public.revoke_org_xapi_key(uuid, text)
  to authenticated;

-- The ingestion RPC is no longer a browser/anonymous capability. Keep the
-- established implementation private, place a service-role gate in front of
-- it, and append one correlated audit event for every completed batch.
alter function public.process_xapi_statements(text, uuid, jsonb)
  rename to process_xapi_statements_internal;

revoke all on function public.process_xapi_statements_internal(
  text,
  uuid,
  jsonb
) from public, anon, authenticated, service_role;

create function public.process_xapi_statements(
  target_key_hash text,
  target_request_id uuid,
  target_statements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_api_key public.org_api_keys%rowtype;
  processing_result jsonb;
  processing_outcome text;
  processing_severity text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required'
      using errcode = '42501';
  end if;

  select api_key.*
  into target_api_key
  from public.org_api_keys as api_key
  join public.organizations as organization
    on organization.id = api_key.org_id
   and organization.status = 'active'
  where api_key.key_hash = target_key_hash
    and api_key.status = 'active'
  for update of api_key;

  if target_api_key.id is null then
    raise exception 'Invalid or revoked organization API key';
  end if;

  processing_result := public.process_xapi_statements_internal(
    target_key_hash,
    target_request_id,
    target_statements
  );

  processing_outcome := case
    when processing_result ->> 'status' = 'mixed' then 'partial'
    else 'success'
  end;
  processing_severity := case
    when coalesce((processing_result ->> 'rejected')::integer, 0) > 0
      or coalesce((processing_result ->> 'unmatched')::integer, 0) > 0
      then 'warning'
    else 'info'
  end;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    request_id,
    after_data,
    outcome,
    severity,
    metadata
  )
  values (
    target_api_key.org_id,
    'xapi.batch_processed',
    'xapi_batch',
    target_request_id::text,
    target_request_id,
    jsonb_build_object(
      'status', processing_result ->> 'status',
      'accepted', coalesce((processing_result ->> 'accepted')::integer, 0),
      'duplicates', coalesce((processing_result ->> 'duplicates')::integer, 0),
      'unmatched', coalesce((processing_result ->> 'unmatched')::integer, 0),
      'rejected', coalesce((processing_result ->> 'rejected')::integer, 0)
    ),
    processing_outcome,
    processing_severity,
    jsonb_build_object(
      'source', 'xapi_ingestion',
      'key_prefix', target_api_key.key_prefix,
      'statement_count', jsonb_array_length(target_statements)
    )
  );

  return processing_result;
end;
$$;

revoke all on function public.process_xapi_statements(
  text,
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function public.process_xapi_statements(
  text,
  uuid,
  jsonb
) to service_role;

comment on table public.user_access_controls is
  'Platform-level access suspension. Permission helpers fail closed for suspended users.';
comment on function public.get_trainee_contacts(uuid) is
  'Contact details are available only to roles with trainees.manage.';
comment on function public.safe_xapi_result_projection(jsonb) is
  'Removes arbitrary provider result fields before browser-visible storage; raw_statement remains server-only evidence.';
comment on function public.safe_xapi_context_projection(jsonb) is
  'Keeps only the xAPI contract extensions required by browser read models.';

commit;
