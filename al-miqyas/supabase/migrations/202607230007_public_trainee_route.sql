begin;

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
      t.code as trainee_code,
      p.title_ar as program_title,
      c.title as cohort_title,
      c.status as cohort_status,
      e.id as enrollment_id,
      pv.id as program_version_id
    from public.trainees t
    join public.enrollments e
      on e.trainee_id = t.id
     and e.org_id = t.org_id
    join public.cohorts c
      on c.id = e.cohort_id
     and c.org_id = e.org_id
    join public.programs p
      on p.id = c.program_id
     and p.org_id = c.org_id
    join public.program_versions pv
      on pv.id = c.program_version_id
     and pv.program_id = c.program_id
     and pv.org_id = c.org_id
    where t.code = upper(btrim(p_trainee_code))
      and t.status = 'active'
      and e.status in ('invited', 'active', 'completed')
      and c.status <> 'archived'
    order by e.enrolled_at desc
    limit 1
  )
  select
    ce.trainee_code,
    ce.program_title,
    ce.cohort_title,
    ce.cohort_status,
    pre_form.form_id as pre_form_id,
    pre_form.trainee_field_name as pre_field_name,
    post_form.form_id as post_form_id,
    post_form.trainee_field_name as post_field_name,
    exists (
      select 1
      from public.assessments a
      where a.enrollment_id = ce.enrollment_id
        and a.assessment_kind = 'pre'
    ) as pre_completed,
    (
      select count(*)
      from public.xapi_statements xs
      where xs.enrollment_id = ce.enrollment_id
        and xs.processing_status = 'accepted'
        and coalesce(
          xs.context #>> array[
            'extensions',
            'https://miqyas.al-amad.com.sa/xapi/extensions/test-event'
          ],
          'false'
        ) <> 'true'
    ) as live_event_count,
    exists (
      select 1
      from public.assessments a
      where a.enrollment_id = ce.enrollment_id
        and a.assessment_kind = 'post'
    ) as post_completed,
    (
      select cert.verify_code
      from public.certificates cert
      where cert.enrollment_id = ce.enrollment_id
        and cert.status = 'valid'
      limit 1
    ) as certificate_verify_code
  from current_enrollment ce
  left join public.jotform_forms pre_form
    on pre_form.program_version_id = ce.program_version_id
   and pre_form.assessment_kind = 'pre'
   and pre_form.is_active
  left join public.jotform_forms post_form
    on post_form.program_version_id = ce.program_version_id
   and post_form.assessment_kind = 'post'
   and post_form.is_active;
$$;

revoke all on function public.get_public_trainee_route(text) from public;
grant execute on function public.get_public_trainee_route(text) to anon;
grant execute on function public.get_public_trainee_route(text) to authenticated;

commit;
