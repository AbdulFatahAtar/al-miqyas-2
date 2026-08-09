begin;

create or replace function public.create_staff_assessment_preview_link(
  target_trainee_code text,
  target_assessment_kind text
)
returns table (
  form_id text,
  trainee_field_name text,
  submission_token_field_name text,
  trainee_code text,
  submission_token text
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  target_org_id uuid;
  target_enrollment_id uuid;
  normalized_trainee_code text;
  configured_form_id text;
  configured_trainee_field_name text;
  configured_token_field_name text;
  raw_submission_token text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication is required'
      using errcode = '42501';
  end if;

  normalized_trainee_code := upper(btrim(target_trainee_code));

  if normalized_trainee_code !~
    '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'
  then
    raise exception 'Invalid trainee code';
  end if;

  if target_assessment_kind not in ('pre', 'post') then
    raise exception 'Assessment kind must be pre or post';
  end if;

  select
    enrollment.org_id,
    enrollment.id,
    form_config.form_id,
    form_config.trainee_field_name,
    form_config.submission_token_field_name
  into
    target_org_id,
    target_enrollment_id,
    configured_form_id,
    configured_trainee_field_name,
    configured_token_field_name
  from public.trainees as trainee
  join public.enrollments as enrollment
    on enrollment.trainee_id = trainee.id
   and enrollment.org_id = trainee.org_id
  join public.cohorts as cohort
    on cohort.id = enrollment.cohort_id
   and cohort.org_id = enrollment.org_id
  join public.jotform_forms as form_config
    on form_config.program_version_id = cohort.program_version_id
   and form_config.org_id = cohort.org_id
   and form_config.assessment_kind = target_assessment_kind
   and form_config.is_active
  where trainee.code = normalized_trainee_code
    and trainee.status = 'active'
    and enrollment.status in ('invited', 'active')
    and cohort.status in ('draft', 'open', 'in_progress')
    and (
      public.is_platform_admin()
      or public.has_org_role(
        enrollment.org_id,
        array['owner', 'trainer']
      )
    )
    and not exists (
      select 1
      from public.assessments as completed_assessment
      where completed_assessment.enrollment_id = enrollment.id
        and completed_assessment.assessment_kind =
          target_assessment_kind
    )
  order by enrollment.enrolled_at desc
  limit 1;

  if target_enrollment_id is null then
    raise exception
      'Assessment preview is not available for this trainee';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_enrollment_id::text || ':preview:' ||
        target_assessment_kind,
      0
    )
  );

  if (
    select count(*)
    from public.assessment_submission_tokens as recent_token
    where recent_token.enrollment_id = target_enrollment_id
      and recent_token.assessment_kind = target_assessment_kind
      and recent_token.created_at > now() - interval '10 minutes'
  ) >= 10 then
    raise exception
      'Assessment preview link rate limit exceeded';
  end if;

  raw_submission_token :=
    encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.assessment_submission_tokens (
    org_id,
    enrollment_id,
    assessment_kind,
    token_hash,
    expires_at
  )
  values (
    target_org_id,
    target_enrollment_id,
    target_assessment_kind,
    encode(
      extensions.digest(raw_submission_token, 'sha256'),
      'hex'
    ),
    now() + interval '30 minutes'
  );

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_org_id,
    (select auth.uid()),
    'assessment.preview_link_created',
    'enrollment',
    target_enrollment_id::text,
    jsonb_build_object(
      'assessment_kind', target_assessment_kind,
      'form_id', configured_form_id,
      'expires_in_minutes', 30
    )
  );

  return query
  select
    configured_form_id,
    configured_trainee_field_name,
    configured_token_field_name,
    normalized_trainee_code,
    raw_submission_token;
end;
$$;

revoke all on function public.create_staff_assessment_preview_link(
  text,
  text
) from public;
revoke all on function public.create_staff_assessment_preview_link(
  text,
  text
) from anon;
grant execute on function public.create_staff_assessment_preview_link(
  text,
  text
) to authenticated;

commit;
