begin;

-- These helpers run with the migration owner's privileges so policy checks do
-- not recurse through memberships or platform_admins RLS policies.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.platform_admins
    where user_id = (select auth.uid())
      and is_active = true
  );
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
  select exists (
    select 1
    from public.memberships
    where user_id = (select auth.uid())
      and org_id = target_org_id
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.is_platform_admin() from anon;
revoke all on function public.has_org_role(uuid, text[]) from public;
revoke all on function public.has_org_role(uuid, text[]) from anon;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_org_role(uuid, text[]) to authenticated;

-- Organization and access management.
create policy organizations_select_member
on public.organizations for select to authenticated
using (public.is_platform_admin() or public.has_org_role(id, array['owner', 'trainer', 'viewer']));

create policy organizations_update_owner
on public.organizations for update to authenticated
using (public.is_platform_admin() or public.has_org_role(id, array['owner']))
with check (public.is_platform_admin() or public.has_org_role(id, array['owner']));

create policy memberships_select_self_or_owner
on public.memberships for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_platform_admin()
  or public.has_org_role(org_id, array['owner'])
);

create policy memberships_insert_owner
on public.memberships for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

create policy memberships_update_owner
on public.memberships for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

create policy memberships_delete_owner
on public.memberships for delete to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

create policy platform_admins_select_self_or_platform_admin
on public.platform_admins for select to authenticated
using (user_id = (select auth.uid()) or public.is_platform_admin());

create policy membership_invitations_select_owner
on public.membership_invitations for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

create policy membership_invitations_insert_owner
on public.membership_invitations for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

create policy membership_invitations_update_owner
on public.membership_invitations for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

-- Operational master data. Viewer is read-only; owner and trainer manage it.
create policy programs_select_member
on public.programs for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));
create policy programs_insert_staff
on public.programs for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy programs_update_staff
on public.programs for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

create policy program_versions_select_member
on public.program_versions for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy program_versions_insert_staff
on public.program_versions for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy program_versions_update_staff
on public.program_versions for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

create policy jotform_forms_select_member
on public.jotform_forms for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy jotform_forms_insert_owner
on public.jotform_forms for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));
create policy jotform_forms_update_owner
on public.jotform_forms for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

create policy cohorts_select_member
on public.cohorts for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));
create policy cohorts_insert_staff
on public.cohorts for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy cohorts_update_staff
on public.cohorts for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

create policy trainees_select_member
on public.trainees for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));
create policy trainees_insert_staff
on public.trainees for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy trainees_update_staff
on public.trainees for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

create policy enrollments_select_member
on public.enrollments for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));
create policy enrollments_insert_staff
on public.enrollments for insert to authenticated
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));
create policy enrollments_update_staff
on public.enrollments for update to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']))
with check (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

-- Ingestion records, raw answers, API-key hashes, statements and certificates
-- are written only by trusted server code using service_role. Members can read
-- the organization-level results they need, but never raw integration secrets.
create policy assessments_select_member
on public.assessments for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

create policy xapi_statements_select_member
on public.xapi_statements for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer']));

create policy impact_reports_select_member
on public.impact_reports for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));

create policy cohort_reports_select_member
on public.cohort_reports for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));

create policy certificates_select_member
on public.certificates for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner', 'trainer', 'viewer']));

create policy audit_logs_select_owner
on public.audit_logs for select to authenticated
using (public.is_platform_admin() or public.has_org_role(org_id, array['owner']));

commit;
