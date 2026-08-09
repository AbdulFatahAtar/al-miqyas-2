begin;

-- The room used to issue many browser-side table queries every few seconds and
-- inferred unmatched xAPI events from trainee codes.  This read model keeps the
-- tenant and cohort boundary in one authorized database contract, returns exact
-- aggregate counts, and exposes only the small event projection used by the UI.
create index if not exists xapi_room_accepted_enrollment_idx
  on public.xapi_statements (
    org_id,
    program_id,
    enrollment_id,
    occurred_at desc
  )
  where processing_status = 'accepted';

create index if not exists xapi_room_unmatched_enrollment_idx
  on public.xapi_statements (
    org_id,
    program_id,
    ((context #>> array[
      'extensions',
      'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id'
    ])),
    occurred_at desc
  )
  where processing_status = 'unmatched';

create or replace function public.get_cohort_room(
  target_org_id uuid,
  target_cohort_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  selected_cohort record;
  participant_limit constant integer := 200;
  test_event_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/test-event';
begin
  if target_org_id is null or target_cohort_id is null then
    raise exception 'Organization and cohort are required'
      using errcode = '22004';
  end if;

  if not public.has_permission('sessions.read', target_org_id) then
    raise exception 'Cohort room access is not allowed'
      using errcode = '42501';
  end if;

  select
    cohort.id,
    cohort.code,
    cohort.title,
    cohort.status,
    cohort.starts_on,
    cohort.ends_on,
    cohort.program_id,
    cohort.program_version_id,
    program.title_ar as program_title,
    version.pass_threshold
  into selected_cohort
  from public.cohorts as cohort
  join public.programs as program
    on program.id = cohort.program_id
   and program.org_id = cohort.org_id
  join public.program_versions as version
    on version.id = cohort.program_version_id
   and version.program_id = cohort.program_id
   and version.org_id = cohort.org_id
  where cohort.org_id = target_org_id
    and cohort.id = target_cohort_id;

  if not found then
    raise exception 'Cohort was not found in the requested organization'
      using errcode = 'P0002';
  end if;

  return (
    with eligible_enrollments as materialized (
      select
        enrollment.id,
        enrollment.trainee_id,
        enrollment.status,
        enrollment.enrolled_at,
        trainee.code as trainee_code,
        trainee.full_name as trainee_name,
        trainee.status as trainee_status
      from public.enrollments as enrollment
      left join public.trainees as trainee
        on trainee.id = enrollment.trainee_id
       and trainee.org_id = enrollment.org_id
      where enrollment.org_id = target_org_id
        and enrollment.cohort_id = target_cohort_id
        and enrollment.status in ('invited', 'active', 'completed')
    ),
    latest_pre as materialized (
      select distinct on (assessment.enrollment_id)
        assessment.enrollment_id,
        assessment.score_percentage,
        assessment.submitted_at
      from public.assessments as assessment
      join eligible_enrollments as enrollment
        on enrollment.id = assessment.enrollment_id
      where assessment.org_id = target_org_id
        and assessment.cohort_id = target_cohort_id
        and assessment.assessment_kind = 'pre'
      order by
        assessment.enrollment_id,
        assessment.submitted_at desc,
        assessment.id desc
    ),
    latest_post as materialized (
      select distinct on (assessment.enrollment_id)
        assessment.enrollment_id,
        assessment.score_percentage,
        assessment.submitted_at
      from public.assessments as assessment
      join eligible_enrollments as enrollment
        on enrollment.id = assessment.enrollment_id
      where assessment.org_id = target_org_id
        and assessment.cohort_id = target_cohort_id
        and assessment.assessment_kind = 'post'
      order by
        assessment.enrollment_id,
        assessment.submitted_at desc,
        assessment.id desc
    ),
    scoped_xapi as materialized (
      select
        statement.id,
        statement.enrollment_id,
        statement.trainee_code_received,
        statement.verb_id,
        statement.processing_status,
        statement.occurred_at,
        statement.context #>> array[
          'extensions',
          'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id'
        ]
          as requested_enrollment_id,
        coalesce(
          statement.context #>> array['extensions', test_event_extension]
            = 'true',
          false
        ) as is_test_event
      from public.xapi_statements as statement
      where statement.org_id = target_org_id
        and statement.program_id = selected_cohort.program_id
        and (
          (
            statement.processing_status = 'accepted'
            and exists (
              select 1
              from eligible_enrollments as enrollment
              where enrollment.id = statement.enrollment_id
            )
          )
          or
          (
            statement.processing_status = 'unmatched'
            and exists (
              select 1
              from eligible_enrollments as enrollment
              where enrollment.id::text =
                statement.context #>> array[
                  'extensions',
                  'https://miqyas.al-amad.com.sa/xapi/extensions/enrollment-id'
                ]
            )
          )
        )
    ),
    live_enrollments as materialized (
      select distinct statement.enrollment_id
      from scoped_xapi as statement
      where statement.processing_status = 'accepted'
        and not statement.is_test_event
        and statement.enrollment_id is not null
    ),
    unmatched_enrollments as materialized (
      select distinct statement.requested_enrollment_id
      from scoped_xapi as statement
      where statement.processing_status = 'unmatched'
        and statement.requested_enrollment_id is not null
    ),
    latest_impact_version as materialized (
      select distinct on (report.enrollment_id)
        report.enrollment_id,
        report.status,
        report.verdict,
        report.computed_at
      from public.impact_reports as report
      join eligible_enrollments as enrollment
        on enrollment.id = report.enrollment_id
      where report.org_id = target_org_id
      order by
        report.enrollment_id,
        report.version_number desc,
        report.computed_at desc,
        report.id desc
    ),
    latest_impact as materialized (
      select report.*
      from latest_impact_version as report
      where report.status = 'computed'
    ),
    scoped_certificates as materialized (
      select
        certificate.enrollment_id,
        certificate.certificate_number,
        certificate.verify_code,
        certificate.status,
        certificate.issued_at
      from public.certificates as certificate
      join eligible_enrollments as enrollment
        on enrollment.id = certificate.enrollment_id
      where certificate.org_id = target_org_id
    ),
    valid_certificates as materialized (
      select certificate.*
      from scoped_certificates as certificate
      where certificate.status = 'valid'
    ),
    participant_rows as (
      select
        enrollment.id as enrollment_id,
        enrollment.trainee_id,
        enrollment.status as enrollment_status,
        enrollment.enrolled_at,
        enrollment.trainee_code,
        enrollment.trainee_name,
        enrollment.trainee_status,
        pre.enrollment_id is not null as has_pre,
        live.enrollment_id is not null as has_live,
        unmatched.requested_enrollment_id is not null as has_unmatched,
        post.enrollment_id is not null as has_post,
        impact.verdict as report_verdict,
        certificate.enrollment_id is not null as has_valid_certificate
      from eligible_enrollments as enrollment
      left join latest_pre as pre
        on pre.enrollment_id = enrollment.id
      left join live_enrollments as live
        on live.enrollment_id = enrollment.id
      left join unmatched_enrollments as unmatched
        on unmatched.requested_enrollment_id = enrollment.id::text
      left join latest_post as post
        on post.enrollment_id = enrollment.id
      left join latest_impact as impact
        on impact.enrollment_id = enrollment.id
      left join valid_certificates as certificate
        on certificate.enrollment_id = enrollment.id
      order by enrollment.trainee_name nulls last, enrollment.id
      limit participant_limit
    ),
    latest_events as (
      select statement.*
      from scoped_xapi as statement
      order by statement.occurred_at desc, statement.id desc
      limit 8
    ),
    latest_valid_certificates as (
      select certificate.*
      from valid_certificates as certificate
      order by certificate.issued_at desc, certificate.verify_code
      limit 8
    )
    select jsonb_build_object(
      'cohort', jsonb_build_object(
        'id', selected_cohort.id,
        'code', selected_cohort.code,
        'title', selected_cohort.title,
        'status', selected_cohort.status,
        'starts_on', selected_cohort.starts_on,
        'ends_on', selected_cohort.ends_on,
        'program_id', selected_cohort.program_id,
        'program_version_id', selected_cohort.program_version_id
      ),
      'programTitle', selected_cohort.program_title,
      'passThreshold', selected_cohort.pass_threshold,
      'enrollmentCount', (
        select count(*) from eligible_enrollments
      ),
      'participantLimit', participant_limit,
      'participants', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'enrollment_id', participant.enrollment_id,
            'trainee_id', participant.trainee_id,
            'enrollment_status', participant.enrollment_status,
            'enrolled_at', participant.enrolled_at,
            'trainee_code', participant.trainee_code,
            'trainee_name', participant.trainee_name,
            'trainee_status', participant.trainee_status,
            'has_pre', participant.has_pre,
            'has_live', participant.has_live,
            'has_unmatched', participant.has_unmatched,
            'has_post', participant.has_post,
            'report_verdict', participant.report_verdict,
            'has_valid_certificate', participant.has_valid_certificate
          )
          order by participant.trainee_name nulls last,
            participant.enrollment_id
        )
        from participant_rows as participant
      ), '[]'::jsonb),
      'stageCounts', jsonb_build_object(
        'pre', (select count(*) from latest_pre),
        'live', (select count(*) from live_enrollments),
        'post', (select count(*) from latest_post),
        'report', (select count(*) from latest_impact),
        'certificate', (select count(*) from valid_certificates)
      ),
      'assessmentSummary', jsonb_build_object(
        'preAverage', (
          select round(avg(pre.score_percentage), 1) from latest_pre as pre
        ),
        'preLatestSubmission', (
          select max(pre.submitted_at) from latest_pre as pre
        ),
        'postAverage', (
          select round(avg(post.score_percentage), 1) from latest_post as post
        ),
        'postLatestSubmission', (
          select max(post.submitted_at) from latest_post as post
        )
      ),
      'xapiSummary', jsonb_build_object(
        'acceptedCount', (
          select count(*)
          from scoped_xapi as statement
          where statement.processing_status = 'accepted'
        ),
        'unmatchedCount', (
          select count(*)
          from scoped_xapi as statement
          where statement.processing_status = 'unmatched'
        ),
        'testCount', (
          select count(*)
          from scoped_xapi as statement
          where statement.processing_status = 'accepted'
            and statement.is_test_event
        ),
        'events', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', event.id,
              'enrollment_id', event.enrollment_id,
              'trainee_code_received', event.trainee_code_received,
              'verb_id', event.verb_id,
              'processing_status', event.processing_status,
              'occurred_at', event.occurred_at,
              'is_test_event', event.is_test_event
            )
            order by event.occurred_at desc, event.id desc
          )
          from latest_events as event
        ), '[]'::jsonb)
      ),
      'reportSummary', jsonb_build_object(
        'computedCount', (select count(*) from latest_impact),
        'passedCount', (
          select count(*) from latest_impact where verdict = 'passed'
        ),
        'notPassedCount', (
          select count(*) from latest_impact where verdict = 'not_passed'
        ),
        'pendingCount', (
          select count(*) from latest_impact where verdict = 'pending'
        ),
        'cohortReport', (
          select case
            when report.status = 'computed' then jsonb_build_object(
              'id', report.id,
              'version_number', report.version_number,
              'sample_pre', report.sample_pre,
              'sample_post', report.sample_post,
              'sample_matched', report.sample_matched,
              'warnings', report.warnings,
              'computed_at', report.computed_at
            )
            else null
          end
          from public.cohort_reports as report
          where report.org_id = target_org_id
            and report.cohort_id = target_cohort_id
          order by report.version_number desc, report.computed_at desc
          limit 1
        )
      ),
      'certificateSummary', jsonb_build_object(
        'validCount', (select count(*) from valid_certificates),
        'revokedCount', (
          select count(*)
          from scoped_certificates
          where status = 'revoked'
        ),
        'supersededCount', (
          select count(*)
          from scoped_certificates
          where status = 'superseded'
        ),
        'validCertificates', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'enrollment_id', certificate.enrollment_id,
              'certificate_number', certificate.certificate_number,
              'verify_code', certificate.verify_code,
              'issued_at', certificate.issued_at
            )
            order by certificate.issued_at desc,
              certificate.verify_code
          )
          from latest_valid_certificates as certificate
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;

revoke all on function public.get_cohort_room(uuid, uuid) from public;
revoke all on function public.get_cohort_room(uuid, uuid) from anon;
grant execute on function public.get_cohort_room(uuid, uuid) to authenticated;

comment on function public.get_cohort_room(uuid, uuid) is
  'Exact, tenant-scoped, read-only cohort room projection for authorized session readers.';

commit;
