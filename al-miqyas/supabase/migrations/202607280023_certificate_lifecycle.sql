begin;

create or replace function public.assign_certificate_identity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  program_prefix text;
  candidate_verify_code text;
begin
  select program.certificate_prefix
  into program_prefix
  from public.enrollments as enrollment
  join public.cohorts as cohort
    on cohort.id = enrollment.cohort_id
   and cohort.org_id = enrollment.org_id
  join public.programs as program
    on program.id = cohort.program_id
   and program.org_id = cohort.org_id
  where enrollment.id = new.enrollment_id
    and enrollment.org_id = new.org_id;

  if program_prefix is null then
    raise exception 'Certificate program could not be resolved';
  end if;

  new.issued_at := coalesce(new.issued_at, now());

  if new.certificate_serial is null then
    raise exception 'Certificate serial was not generated';
  end if;

  new.certificate_number := format(
    'AMD-%s-%s-%s',
    program_prefix,
    extract(year from new.issued_at)::integer,
    lpad(new.certificate_serial::text, 7, '0')
  );

  loop
    candidate_verify_code :=
      'VER-' || upper(encode(extensions.gen_random_bytes(18), 'hex'));
    exit when not exists (
      select 1
      from public.certificates as certificate
      where certificate.verify_code = candidate_verify_code
    );
  end loop;

  new.verify_code := candidate_verify_code;
  return new;
end;
$$;

drop trigger if exists certificates_assign_identity
  on public.certificates;

create trigger certificates_assign_identity
before insert on public.certificates
for each row execute function public.assign_certificate_identity();

create or replace function public.protect_issued_certificate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.certificate_serial is distinct from old.certificate_serial
    or new.certificate_number is distinct from old.certificate_number
    or new.verify_code is distinct from old.verify_code
    or new.org_id is distinct from old.org_id
    or new.enrollment_id is distinct from old.enrollment_id
    or new.impact_report_id is distinct from old.impact_report_id
    or new.public_snapshot is distinct from old.public_snapshot
    or new.metrics_snapshot is distinct from old.metrics_snapshot
    or new.issued_at is distinct from old.issued_at
    or new.issued_by is distinct from old.issued_by
    or new.supersedes_certificate_id
      is distinct from old.supersedes_certificate_id then
    raise exception
      'Issued certificate evidence is immutable; revoke or reissue instead';
  end if;

  if old.status = new.status then
    raise exception
      'Issued certificate cannot be edited; revoke or reissue instead';
  end if;

  if old.status = 'valid' and new.status = 'revoked' then
    if new.revoked_at is null
      or new.revoked_by is null
      or length(btrim(coalesce(new.revoke_reason, ''))) < 5 then
      raise exception 'Certificate revocation details are required';
    end if;
    return new;
  end if;

  if old.status = 'revoked' and new.status = 'superseded' then
    return new;
  end if;

  raise exception 'Invalid certificate status transition';
end;
$$;

drop trigger if exists certificates_protect_issued
  on public.certificates;

create trigger certificates_protect_issued
before update on public.certificates
for each row execute function public.protect_issued_certificate();

create or replace function public.issue_certificate_internal(
  target_enrollment_id uuid,
  target_supersedes_certificate_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_variable
declare
  target_org_id uuid;
  target_trainee_name text;
  target_trainee_code text;
  target_program_title text;
  target_organization_name text;
  target_cohort_title text;
  target_pass_threshold numeric;
  target_post_score numeric;
  target_impact_report public.impact_reports%rowtype;
  existing_valid_certificate_id uuid;
  created_certificate_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select
    enrollment.org_id,
    trainee.full_name,
    trainee.code,
    program.title_ar,
    organization.name_ar,
    cohort.title,
    greatest(program_version.pass_threshold, 80)
  into
    target_org_id,
    target_trainee_name,
    target_trainee_code,
    target_program_title,
    target_organization_name,
    target_cohort_title,
    target_pass_threshold
  from public.enrollments as enrollment
  join public.trainees as trainee
    on trainee.id = enrollment.trainee_id
   and trainee.org_id = enrollment.org_id
  join public.cohorts as cohort
    on cohort.id = enrollment.cohort_id
   and cohort.org_id = enrollment.org_id
  join public.programs as program
    on program.id = cohort.program_id
   and program.org_id = cohort.org_id
  join public.program_versions as program_version
    on program_version.id = cohort.program_version_id
   and program_version.org_id = cohort.org_id
  join public.organizations as organization
    on organization.id = enrollment.org_id
  where enrollment.id = target_enrollment_id
    and enrollment.status in ('active', 'completed')
    and trainee.status = 'active';

  if target_org_id is null then
    raise exception 'Active enrollment not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'Certificate issuance is not allowed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'certificate:enrollment:' || target_enrollment_id::text,
      0
    )
  );

  select certificate.id
  into existing_valid_certificate_id
  from public.certificates as certificate
  where certificate.enrollment_id = target_enrollment_id
    and certificate.org_id = target_org_id
    and certificate.status = 'valid'
  limit 1;

  if existing_valid_certificate_id is not null
    and target_supersedes_certificate_id is not null then
    raise exception 'A valid replacement certificate already exists';
  end if;

  if existing_valid_certificate_id is not null then
    return existing_valid_certificate_id;
  end if;

  if target_supersedes_certificate_id is null
    and exists (
      select 1
      from public.certificates as certificate
      where certificate.enrollment_id = target_enrollment_id
        and certificate.org_id = target_org_id
    ) then
    raise exception
      'A previous certificate exists; use the reissue workflow';
  end if;

  if target_supersedes_certificate_id is not null
    and not exists (
      select 1
      from public.certificates as certificate
      where certificate.id = target_supersedes_certificate_id
        and certificate.enrollment_id = target_enrollment_id
        and certificate.org_id = target_org_id
        and certificate.status = 'revoked'
    ) then
    raise exception 'Revoked certificate to supersede was not found';
  end if;

  select assessment.score_percentage
  into target_post_score
  from public.assessments as assessment
  where assessment.enrollment_id = target_enrollment_id
    and assessment.org_id = target_org_id
    and assessment.assessment_kind = 'post'
  order by assessment.submitted_at desc
  limit 1;

  if target_post_score is null then
    raise exception 'Post assessment is required for certificate issuance';
  end if;

  if target_post_score < target_pass_threshold then
    raise exception
      'Post assessment does not meet the certificate threshold';
  end if;

  perform public.compute_enrollment_impact(target_enrollment_id);

  select report.*
  into target_impact_report
  from public.impact_reports as report
  where report.enrollment_id = target_enrollment_id
    and report.org_id = target_org_id
    and report.status = 'computed'
  order by report.version_number desc
  limit 1;

  if target_impact_report.id is null
    or target_impact_report.verdict <> 'passed' then
    raise exception 'A passing impact report is required';
  end if;

  insert into public.certificates (
    certificate_number,
    verify_code,
    org_id,
    enrollment_id,
    impact_report_id,
    public_snapshot,
    metrics_snapshot,
    issued_by,
    supersedes_certificate_id
  )
  values (
    'PENDING-' || encode(extensions.gen_random_bytes(16), 'hex'),
    'PENDING-' || encode(extensions.gen_random_bytes(16), 'hex'),
    target_org_id,
    target_enrollment_id,
    target_impact_report.id,
    jsonb_build_object(
      'trainee_name', target_trainee_name,
      'trainee_code', target_trainee_code,
      'program_title', target_program_title,
      'organization_name', target_organization_name,
      'cohort_title', target_cohort_title
    ),
    jsonb_build_object(
      'impact_report_version', target_impact_report.version_number,
      'knowledge', target_impact_report.knowledge_metrics,
      'confidence', target_impact_report.confidence_metrics,
      'live', target_impact_report.live_metrics,
      'completeness', target_impact_report.completeness,
      'verdict', target_impact_report.verdict
    ),
    auth.uid(),
    target_supersedes_certificate_id
  )
  returning id into created_certificate_id;

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
    auth.uid(),
    case
      when target_supersedes_certificate_id is null
        then 'certificate.issued'
      else 'certificate.reissued'
    end,
    'certificate',
    created_certificate_id::text,
    jsonb_build_object(
      'enrollment_id', target_enrollment_id,
      'post_score', target_post_score,
      'pass_threshold', target_pass_threshold,
      'supersedes_certificate_id',
        target_supersedes_certificate_id
    )
  );

  return created_certificate_id;
end;
$$;

create or replace function public.issue_enrollment_certificate(
  target_enrollment_id uuid
)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$
  select public.issue_certificate_internal(
    target_enrollment_id,
    null
  );
$$;

create or replace function public.issue_eligible_certificates(
  target_org_id uuid,
  target_cohort_id uuid default null
)
returns table (
  issued_count integer,
  existing_count integer,
  skipped_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  enrollment_row record;
  issued_total integer := 0;
  existing_total integer := 0;
  skipped_total integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'Certificate issuance is not allowed';
  end if;

  if target_cohort_id is not null
    and not exists (
      select 1
      from public.cohorts as cohort
      where cohort.id = target_cohort_id
        and cohort.org_id = target_org_id
    ) then
    raise exception 'Cohort does not belong to organization';
  end if;

  for enrollment_row in
    select
      enrollment.id,
      greatest(program_version.pass_threshold, 80) as pass_threshold,
      (
        select assessment.score_percentage
        from public.assessments as assessment
        where assessment.enrollment_id = enrollment.id
          and assessment.org_id = enrollment.org_id
          and assessment.assessment_kind = 'post'
        order by assessment.submitted_at desc
        limit 1
      ) as post_score,
      (
        select certificate.status
        from public.certificates as certificate
        where certificate.enrollment_id = enrollment.id
          and certificate.org_id = enrollment.org_id
        order by certificate.issued_at desc
        limit 1
      ) as latest_certificate_status
    from public.enrollments as enrollment
    join public.cohorts as cohort
      on cohort.id = enrollment.cohort_id
     and cohort.org_id = enrollment.org_id
    join public.program_versions as program_version
      on program_version.id = cohort.program_version_id
     and program_version.org_id = cohort.org_id
    where enrollment.org_id = target_org_id
      and enrollment.status in ('active', 'completed')
      and (
        target_cohort_id is null
        or enrollment.cohort_id = target_cohort_id
      )
    order by enrollment.enrolled_at, enrollment.id
  loop
    if enrollment_row.latest_certificate_status = 'valid' then
      existing_total := existing_total + 1;
    elsif enrollment_row.latest_certificate_status is not null then
      skipped_total := skipped_total + 1;
    elsif enrollment_row.post_score is null
      or enrollment_row.post_score
        < enrollment_row.pass_threshold then
      skipped_total := skipped_total + 1;
    else
      perform public.issue_certificate_internal(
        enrollment_row.id,
        null
      );
      issued_total := issued_total + 1;
    end if;
  end loop;

  return query
  select issued_total, existing_total, skipped_total;
end;
$$;

create or replace function public.revoke_certificate(
  target_certificate_id uuid,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  target_certificate public.certificates%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select certificate.*
  into target_certificate
  from public.certificates as certificate
  where certificate.id = target_certificate_id
  for update;

  if target_certificate.id is null then
    raise exception 'Certificate not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_certificate.org_id, array['owner'])
  ) then
    raise exception 'Certificate revocation is not allowed';
  end if;

  if target_certificate.status <> 'valid' then
    raise exception 'Only a valid certificate can be revoked';
  end if;

  if length(btrim(coalesce(target_reason, ''))) not between 5 and 500 then
    raise exception 'Revocation reason must be between 5 and 500 characters';
  end if;

  update public.certificates as certificate
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = auth.uid(),
    revoke_reason = btrim(target_reason)
  where certificate.id = target_certificate.id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  )
  values (
    target_certificate.org_id,
    auth.uid(),
    'certificate.revoked',
    'certificate',
    target_certificate.id::text,
    jsonb_build_object('status', target_certificate.status),
    jsonb_build_object(
      'status', 'revoked',
      'reason', btrim(target_reason)
    )
  );

  return target_certificate.id;
end;
$$;

create or replace function public.reissue_certificate(
  target_certificate_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  target_certificate public.certificates%rowtype;
  created_certificate_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select certificate.*
  into target_certificate
  from public.certificates as certificate
  where certificate.id = target_certificate_id
  for update;

  if target_certificate.id is null then
    raise exception 'Certificate not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_certificate.org_id, array['owner'])
  ) then
    raise exception 'Certificate reissue is not allowed';
  end if;

  if target_certificate.status <> 'revoked' then
    raise exception 'Only a revoked certificate can be reissued';
  end if;

  created_certificate_id :=
    public.issue_certificate_internal(
      target_certificate.enrollment_id,
      target_certificate.id
    );

  update public.certificates as certificate
  set status = 'superseded'
  where certificate.id = target_certificate.id;

  insert into public.audit_logs (
    org_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    target_certificate.org_id,
    auth.uid(),
    'certificate.superseded',
    'certificate',
    target_certificate.id::text,
    jsonb_build_object(
      'replacement_certificate_id', created_certificate_id
    )
  );

  return created_certificate_id;
end;
$$;

create or replace function public.get_public_certificate(
  target_verify_code text
)
returns table (
  certificate_status text,
  certificate_number text,
  verify_code text,
  trainee_name text,
  trainee_code text,
  program_title text,
  organization_name text,
  cohort_title text,
  issued_at timestamptz,
  revoked_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    certificate.status,
    certificate.certificate_number,
    certificate.verify_code,
    certificate.public_snapshot ->> 'trainee_name',
    certificate.public_snapshot ->> 'trainee_code',
    certificate.public_snapshot ->> 'program_title',
    certificate.public_snapshot ->> 'organization_name',
    certificate.public_snapshot ->> 'cohort_title',
    certificate.issued_at,
    certificate.revoked_at
  from public.certificates as certificate
  where certificate.verify_code =
    upper(btrim(target_verify_code))
  limit 1;
$$;

create index if not exists certificates_org_status_issued_idx
  on public.certificates (org_id, status, issued_at desc);

revoke all on function public.assign_certificate_identity()
  from public;
revoke all on function public.assign_certificate_identity()
  from anon;
revoke all on function public.assign_certificate_identity()
  from authenticated;
revoke all on function public.protect_issued_certificate()
  from public;
revoke all on function public.protect_issued_certificate()
  from anon;
revoke all on function public.protect_issued_certificate()
  from authenticated;
revoke all on function public.issue_certificate_internal(uuid, uuid)
  from public;
revoke all on function public.issue_certificate_internal(uuid, uuid)
  from anon;
revoke all on function public.issue_certificate_internal(uuid, uuid)
  from authenticated;
revoke all on function public.issue_enrollment_certificate(uuid)
  from public;
revoke all on function public.issue_enrollment_certificate(uuid)
  from anon;
revoke all on function public.issue_eligible_certificates(uuid, uuid)
  from public;
revoke all on function public.issue_eligible_certificates(uuid, uuid)
  from anon;
revoke all on function public.revoke_certificate(uuid, text)
  from public;
revoke all on function public.revoke_certificate(uuid, text)
  from anon;
revoke all on function public.reissue_certificate(uuid)
  from public;
revoke all on function public.reissue_certificate(uuid)
  from anon;
revoke all on function public.get_public_certificate(text)
  from public;

grant execute on function public.issue_enrollment_certificate(uuid)
  to authenticated;
grant execute on function public.issue_eligible_certificates(uuid, uuid)
  to authenticated;
grant execute on function public.revoke_certificate(uuid, text)
  to authenticated;
grant execute on function public.reissue_certificate(uuid)
  to authenticated;
grant execute on function public.get_public_certificate(text)
  to anon;
grant execute on function public.get_public_certificate(text)
  to authenticated;

commit;
