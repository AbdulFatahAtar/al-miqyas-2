begin;

create table public.authorization_roles (
  role_key text primary key
    check (role_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  scope text not null check (scope in ('platform', 'organization')),
  name_ar text not null check (length(btrim(name_ar)) between 2 and 100),
  description_ar text not null
    check (length(btrim(description_ar)) between 2 and 500),
  is_system boolean not null default true,
  is_assignable boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.authorization_permissions (
  permission_key text primary key
    check (
      permission_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
    ),
  scope text not null check (scope in ('platform', 'organization')),
  name_ar text not null check (length(btrim(name_ar)) between 2 and 160),
  created_at timestamptz not null default now()
);

create table public.authorization_role_permissions (
  role_key text not null
    references public.authorization_roles(role_key) on delete restrict,
  permission_key text not null
    references public.authorization_permissions(permission_key) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (role_key, permission_key)
);

insert into public.authorization_roles (
  role_key,
  scope,
  name_ar,
  description_ar,
  is_system,
  is_assignable
)
values
  (
    'platform_owner',
    'platform',
    'مالك المنصة',
    'أعلى دور تشغيلي لشركة الأمد ويُهيأ بعملية إدارية غير عامة فقط.',
    true,
    false
  ),
  (
    'owner',
    'organization',
    'مالك الجهة',
    'يدير الجهة وعضوياتها وتكاملاتها وعملياتها داخل نطاقها.',
    true,
    true
  ),
  (
    'trainer',
    'organization',
    'مدرّب',
    'يدير برامج القياس والمتدرّبين والجلسات والتقارير داخل الجهة.',
    true,
    true
  ),
  (
    'viewer',
    'organization',
    'قارئ',
    'يعرض النتائج والتقارير والشهادات المصرح بها دون كتابة.',
    true,
    true
  );

insert into public.authorization_permissions (
  permission_key,
  scope,
  name_ar
)
values
  ('platform.dashboard.read', 'platform', 'عرض لوحة المنصة'),
  ('organizations.read', 'platform', 'عرض جميع الجهات'),
  ('organizations.create', 'platform', 'إنشاء جهة'),
  ('organizations.update', 'platform', 'تعديل بيانات جهة'),
  (
    'organizations.change_status',
    'platform',
    'تعليق جهة أو أرشفتها أو استعادتها'
  ),
  ('users.read', 'platform', 'عرض مستخدمي المنصة'),
  ('users.create', 'platform', 'إنشاء مستخدم أو دعوته'),
  ('users.update', 'platform', 'تحديث بيانات وصول المستخدم'),
  ('users.suspend', 'platform', 'تعليق وصول المستخدم'),
  (
    'memberships.manage_all',
    'platform',
    'إدارة العضويات عبر الجهات'
  ),
  ('roles.read', 'platform', 'عرض مصفوفة الأدوار والصلاحيات'),
  ('roles.manage', 'platform', 'إدارة إسناد الأدوار'),
  (
    'permissions.manage',
    'platform',
    'إدارة إسناد الصلاحيات المعتمدة'
  ),
  (
    'platform.settings.manage',
    'platform',
    'إدارة إعدادات المنصة'
  ),
  ('audit.read_all', 'platform', 'عرض سجل التدقيق لكل الجهات'),
  ('organization.read', 'organization', 'عرض الجهة'),
  ('organization.update', 'organization', 'تعديل الجهة'),
  ('memberships.read', 'organization', 'عرض عضويات الجهة'),
  ('memberships.manage', 'organization', 'إدارة عضويات الجهة'),
  (
    'access_requests.review',
    'organization',
    'مراجعة طلبات الوصول'
  ),
  ('programs.read', 'organization', 'عرض البرامج والدفعات'),
  ('programs.manage', 'organization', 'إدارة البرامج والدفعات'),
  ('trainees.read', 'organization', 'عرض المتدرّبين'),
  ('trainees.manage', 'organization', 'إدارة المتدرّبين'),
  ('sessions.read', 'organization', 'عرض الجلسات'),
  ('sessions.manage', 'organization', 'تشغيل الجلسات وإدارتها'),
  ('assessments.read', 'organization', 'عرض نتائج القياس'),
  ('reports.read', 'organization', 'عرض التقارير'),
  ('reports.compute', 'organization', 'حساب التقارير وتحديثها'),
  ('reports.export', 'organization', 'تصدير التقارير'),
  ('certificates.read', 'organization', 'عرض الشهادات'),
  ('certificates.issue', 'organization', 'إصدار الشهادات'),
  ('certificates.revoke', 'organization', 'إلغاء الشهادات'),
  ('certificates.reissue', 'organization', 'إعادة إصدار الشهادات'),
  ('integrations.read', 'organization', 'عرض حالة التكاملات'),
  (
    'integrations.manage',
    'organization',
    'إدارة التكاملات والمفاتيح'
  ),
  ('audit.read', 'organization', 'عرض سجل تدقيق الجهة');

insert into public.authorization_role_permissions (
  role_key,
  permission_key
)
select 'platform_owner', permission.permission_key
from public.authorization_permissions as permission;

insert into public.authorization_role_permissions (
  role_key,
  permission_key
)
select 'owner', permission.permission_key
from public.authorization_permissions as permission
where permission.scope = 'organization';

insert into public.authorization_role_permissions (
  role_key,
  permission_key
)
values
  ('trainer', 'organization.read'),
  ('trainer', 'memberships.read'),
  ('trainer', 'programs.read'),
  ('trainer', 'programs.manage'),
  ('trainer', 'trainees.read'),
  ('trainer', 'trainees.manage'),
  ('trainer', 'sessions.read'),
  ('trainer', 'sessions.manage'),
  ('trainer', 'assessments.read'),
  ('trainer', 'reports.read'),
  ('trainer', 'reports.compute'),
  ('trainer', 'reports.export'),
  ('trainer', 'certificates.read'),
  ('trainer', 'certificates.issue'),
  ('trainer', 'integrations.read'),
  ('viewer', 'organization.read'),
  ('viewer', 'programs.read'),
  ('viewer', 'trainees.read'),
  ('viewer', 'reports.read'),
  ('viewer', 'certificates.read');

alter table public.platform_admins
  add column role_key text;
alter table public.platform_admins
  add column grant_reason text;
alter table public.platform_admins
  add column revoked_at timestamptz;
alter table public.platform_admins
  add column revoked_by uuid references auth.users(id) on delete set null;
alter table public.platform_admins
  add column revoke_reason text;

update public.platform_admins
set
  role_key = 'platform_owner',
  grant_reason = 'ترحيل صلاحية المنصة القائمة إلى النموذج الصريح',
  revoked_at = case
    when is_active then null
    else coalesce(revoked_at, granted_at, now())
  end,
  revoke_reason = case
    when is_active then null
    else coalesce(revoke_reason, 'كانت الصلاحية غير نشطة قبل الترحيل')
  end;

alter table public.platform_admins
  alter column role_key set not null;
alter table public.platform_admins
  alter column role_key set default 'platform_owner';
alter table public.platform_admins
  alter column grant_reason set not null;

alter table public.platform_admins
  add constraint platform_admins_role_key_fkey
    foreign key (role_key)
    references public.authorization_roles(role_key)
    on delete restrict;
alter table public.platform_admins
  add constraint platform_admins_platform_role_check
    check (role_key = 'platform_owner');
alter table public.platform_admins
  add constraint platform_admins_revocation_check
    check (
      (is_active and revoked_at is null and revoke_reason is null)
      or
      (
        not is_active
        and revoked_at is not null
        and length(btrim(coalesce(revoke_reason, ''))) between 3 and 500
      )
    );

create index authorization_permissions_scope_idx
  on public.authorization_permissions (scope, permission_key);
create index authorization_role_permissions_permission_idx
  on public.authorization_role_permissions (permission_key, role_key);
create index platform_admins_active_role_idx
  on public.platform_admins (role_key, user_id)
  where is_active = true;

-- Protect the platform authority at the table boundary as well as through the
-- administrative RPC. Joining auth.users prevents a stale assignment from
-- being counted as a real owner, while the shared advisory lock serializes
-- direct service-role writes with the supported provisioning functions.
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
    where assignment.is_active = true
      and assignment.user_id is distinct from old.user_id;

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

revoke all on function public.protect_final_platform_owner()
  from public, anon, authenticated;

drop trigger if exists platform_admins_protect_final_owner
  on public.platform_admins;
create trigger platform_admins_protect_final_owner
before update or delete on public.platform_admins
for each row execute function public.protect_final_platform_owner();

alter table public.authorization_roles enable row level security;
alter table public.authorization_permissions enable row level security;
alter table public.authorization_role_permissions enable row level security;

revoke all on table public.authorization_roles from public;
revoke all on table public.authorization_roles from anon;
revoke all on table public.authorization_roles from authenticated;
revoke all on table public.authorization_roles from service_role;
grant select on table public.authorization_roles to authenticated;
grant select on table public.authorization_roles to service_role;

revoke all on table public.authorization_permissions from public;
revoke all on table public.authorization_permissions from anon;
revoke all on table public.authorization_permissions from authenticated;
revoke all on table public.authorization_permissions from service_role;
grant select on table public.authorization_permissions to authenticated;
grant select on table public.authorization_permissions to service_role;

revoke all on table public.authorization_role_permissions from public;
revoke all on table public.authorization_role_permissions from anon;
revoke all on table public.authorization_role_permissions from authenticated;
revoke all on table public.authorization_role_permissions from service_role;
grant select on table public.authorization_role_permissions to authenticated;
grant select on table public.authorization_role_permissions to service_role;

create policy authorization_roles_select_authenticated
on public.authorization_roles for select to authenticated
using (true);

create policy authorization_permissions_select_authenticated
on public.authorization_permissions for select to authenticated
using (true);

create policy authorization_role_permissions_select_authenticated
on public.authorization_role_permissions for select to authenticated
using (true);

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
  platform_access as (
    select 1
    from public.platform_admins as assignment
    join public.authorization_role_permissions as role_permission
      on role_permission.role_key = assignment.role_key
    join requested_permission as permission
      on permission.permission_key = role_permission.permission_key
    where assignment.user_id = (select auth.uid())
      and assignment.is_active = true
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
  )
  select case
    when not exists (select 1 from requested_permission) then false
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

revoke all on function public.has_permission(text, uuid) from public;
revoke all on function public.has_permission(text, uuid) from anon;
grant execute on function public.has_permission(text, uuid) to authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_permission('platform.dashboard.read', null);
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

revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_platform_admin() from anon;
grant execute on function public.is_platform_admin() to authenticated;

revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.has_org_role(uuid, text[]) from anon;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

create or replace function public.provision_platform_owner(
  target_user_id uuid,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required';
  end if;

  if target_user_id is null or not exists (
    select 1 from auth.users as account where account.id = target_user_id
  ) then
    raise exception 'Target user was not found';
  end if;

  if length(btrim(coalesce(target_reason, ''))) not between 5 and 500 then
    raise exception 'A provisioning reason is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-owner:effective-assignment', 0)
  );

  insert into public.platform_admins (
    user_id,
    role_key,
    is_active,
    granted_by,
    granted_at,
    grant_reason,
    revoked_at,
    revoked_by,
    revoke_reason
  )
  values (
    target_user_id,
    'platform_owner',
    true,
    auth.uid(),
    now(),
    btrim(target_reason),
    null,
    null,
    null
  )
  on conflict (user_id) do update
  set
    role_key = 'platform_owner',
    is_active = true,
    granted_by = auth.uid(),
    granted_at = now(),
    grant_reason = excluded.grant_reason,
    revoked_at = null,
    revoked_by = null,
    revoke_reason = null;

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
    null,
    auth.uid(),
    'platform_owner.provisioned',
    'platform_owner',
    target_user_id::text,
    null,
    jsonb_build_object('role_key', 'platform_owner', 'is_active', true),
    jsonb_build_object(
      'reason', btrim(target_reason),
      'provisioning_channel', 'service_role'
    )
  );
end;
$$;

create or replace function public.revoke_platform_owner(
  target_user_id uuid,
  target_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  remaining_owner_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role is required';
  end if;

  if length(btrim(coalesce(target_reason, ''))) not between 5 and 500 then
    raise exception 'A revocation reason is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('platform-owner:effective-assignment', 0)
  );

  select count(distinct assignment.user_id)
  into remaining_owner_count
  from public.platform_admins as assignment
  join auth.users as account
    on account.id = assignment.user_id
  where assignment.is_active = true
    and assignment.user_id is distinct from target_user_id;

  if not exists (
    select 1
    from public.platform_admins as assignment
    where assignment.user_id = target_user_id
      and assignment.is_active = true
  ) then
    raise exception 'Active platform owner was not found';
  end if;

  if remaining_owner_count < 1 then
    raise exception 'The final active platform owner cannot be revoked';
  end if;

  update public.platform_admins as assignment
  set
    is_active = false,
    revoked_at = now(),
    revoked_by = auth.uid(),
    revoke_reason = btrim(target_reason)
  where assignment.user_id = target_user_id;

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
    null,
    auth.uid(),
    'platform_owner.revoked',
    'platform_owner',
    target_user_id::text,
    jsonb_build_object('role_key', 'platform_owner', 'is_active', true),
    jsonb_build_object('role_key', 'platform_owner', 'is_active', false),
    jsonb_build_object(
      'reason', btrim(target_reason),
      'provisioning_channel', 'service_role'
    )
  );
end;
$$;

revoke all on function public.provision_platform_owner(uuid, text)
  from public;
revoke all on function public.provision_platform_owner(uuid, text)
  from anon;
revoke all on function public.provision_platform_owner(uuid, text)
  from authenticated;
grant execute on function public.provision_platform_owner(uuid, text)
  to service_role;

revoke all on function public.revoke_platform_owner(uuid, text)
  from public;
revoke all on function public.revoke_platform_owner(uuid, text)
  from anon;
revoke all on function public.revoke_platform_owner(uuid, text)
  from authenticated;
grant execute on function public.revoke_platform_owner(uuid, text)
  to service_role;

-- The service credential may use the audited provisioning contracts, but it
-- cannot bypass them through direct table writes or truncate the authority
-- catalog. Database-owner maintenance remains an explicit break-glass path.
revoke insert, update, delete, truncate
  on table public.platform_admins
  from service_role;
grant select on table public.platform_admins to service_role;

comment on table public.authorization_roles is
  'Fixed runtime roles. Platform owner assignment is never public.';
comment on function public.has_permission(text, uuid) is
  'Fail-closed permission check. Organization permissions require an explicit organization id.';

commit;
