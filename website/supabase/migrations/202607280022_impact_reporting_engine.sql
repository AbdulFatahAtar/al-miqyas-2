begin;

create or replace function public.compute_enrollment_impact(
  target_enrollment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  target_org_id uuid;
  target_cohort_id uuid;
  target_pass_threshold numeric;
  pre_score numeric;
  post_score numeric;
  pre_confidence numeric;
  post_confidence numeric;
  performance_event_count integer := 0;
  performance_session_count integer := 0;
  item_attempt_count integer := 0;
  scored_item_count integer := 0;
  correct_item_count integer := 0;
  hint_event_count integer := 0;
  completed_experience_count integer := 0;
  average_response_time_ms numeric;
  knowledge_metrics jsonb;
  confidence_metrics jsonb;
  live_metrics jsonb;
  completeness jsonb;
  target_verdict text;
  existing_report public.impact_reports%rowtype;
  next_version integer;
  created_report_id uuid;
  correct_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/is-correct';
  response_time_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/response-time-ms';
  test_event_extension constant text :=
    'https://miqyas.al-amad.com.sa/xapi/extensions/test-event';
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select
    enrollment.org_id,
    enrollment.cohort_id,
    program_version.pass_threshold
  into
    target_org_id,
    target_cohort_id,
    target_pass_threshold
  from public.enrollments as enrollment
  join public.cohorts as cohort
    on cohort.id = enrollment.cohort_id
   and cohort.org_id = enrollment.org_id
  join public.program_versions as program_version
    on program_version.id = cohort.program_version_id
   and program_version.org_id = cohort.org_id
  where enrollment.id = target_enrollment_id;

  if target_org_id is null then
    raise exception 'Enrollment not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'Impact report computation is not allowed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'impact:enrollment:' || target_enrollment_id::text,
      0
    )
  );

  select
    assessment.score_percentage,
    nullif(assessment.confidence ->> 'mean', '')::numeric
  into pre_score, pre_confidence
  from public.assessments as assessment
  where assessment.enrollment_id = target_enrollment_id
    and assessment.org_id = target_org_id
    and assessment.assessment_kind = 'pre'
  order by assessment.submitted_at desc
  limit 1;

  select
    assessment.score_percentage,
    nullif(assessment.confidence ->> 'mean', '')::numeric
  into post_score, post_confidence
  from public.assessments as assessment
  where assessment.enrollment_id = target_enrollment_id
    and assessment.org_id = target_org_id
    and assessment.assessment_kind = 'post'
  order by assessment.submitted_at desc
  limit 1;

  select
    count(*)::integer,
    count(distinct statement.session_id)::integer,
    count(*) filter (
      where statement.verb_id =
        'https://miqyas.al-amad.com.sa/xapi/verbs/item-attempted'
    )::integer,
    count(*) filter (
      where coalesce(
        nullif(
          statement.result #>> array['extensions', correct_extension],
          ''
        ),
        statement.result ->> 'success'
      ) in ('true', 'false')
    )::integer,
    count(*) filter (
      where coalesce(
        nullif(
          statement.result #>> array['extensions', correct_extension],
          ''
        ),
        statement.result ->> 'success'
      ) = 'true'
    )::integer,
    count(*) filter (
      where statement.verb_id =
        'https://miqyas.al-amad.com.sa/xapi/verbs/hint-used'
    )::integer,
    count(*) filter (
      where statement.verb_id =
        'https://miqyas.al-amad.com.sa/xapi/verbs/experience-completed'
    )::integer,
    round(avg(
      case
        when (
          statement.result
            #>> array['extensions', response_time_extension]
        ) ~ '^[0-9]+([.][0-9]+)?$'
          then (
            statement.result
              #>> array['extensions', response_time_extension]
          )::numeric
        else null
      end
    ), 2)
  into
    performance_event_count,
    performance_session_count,
    item_attempt_count,
    scored_item_count,
    correct_item_count,
    hint_event_count,
    completed_experience_count,
    average_response_time_ms
  from public.xapi_statements as statement
  where statement.enrollment_id = target_enrollment_id
    and statement.org_id = target_org_id
    and statement.processing_status = 'accepted'
    and coalesce(
      statement.context
        #>> array['extensions', test_event_extension],
      'false'
    ) <> 'true';

  knowledge_metrics := jsonb_build_object(
    'pre_score', pre_score,
    'post_score', post_score,
    'delta', case
      when pre_score is not null and post_score is not null
        then round(post_score - pre_score, 2)
      else null
    end,
    'pass_threshold', target_pass_threshold,
    'passed', case
      when post_score is null then null
      else post_score >= target_pass_threshold
    end
  );

  confidence_metrics := jsonb_build_object(
    'pre_mean', pre_confidence,
    'post_mean', post_confidence,
    'delta', case
      when pre_confidence is not null and post_confidence is not null
        then round(post_confidence - pre_confidence, 2)
      else null
    end
  );

  live_metrics := jsonb_build_object(
    'event_count', performance_event_count,
    'session_count', performance_session_count,
    'item_attempt_count', item_attempt_count,
    'scored_item_count', scored_item_count,
    'correct_item_count', correct_item_count,
    'accuracy_percentage', case
      when scored_item_count > 0
        then round(correct_item_count::numeric / scored_item_count * 100, 2)
      else null
    end,
    'hint_event_count', hint_event_count,
    'completed_experience_count', completed_experience_count,
    'average_response_time_ms', average_response_time_ms
  );

  completeness := jsonb_build_object(
    'has_pre', pre_score is not null,
    'has_post', post_score is not null,
    'has_live', performance_event_count > 0,
    'is_complete',
      pre_score is not null
      and post_score is not null
      and performance_event_count > 0,
    'missing', to_jsonb(array_remove(array[
      case when pre_score is null then 'pre_assessment' end,
      case when post_score is null then 'post_assessment' end,
      case
        when performance_event_count = 0 then 'live_performance'
      end
    ], null))
  );

  target_verdict := case
    when post_score is null then 'pending'
    when post_score >= target_pass_threshold then 'passed'
    else 'not_passed'
  end;

  select report.*
  into existing_report
  from public.impact_reports as report
  where report.enrollment_id = target_enrollment_id
    and report.org_id = target_org_id
    and report.status = 'computed'
  order by report.version_number desc
  limit 1;

  if existing_report.id is not null
    and existing_report.knowledge_metrics = knowledge_metrics
    and existing_report.confidence_metrics = confidence_metrics
    and existing_report.live_metrics = live_metrics
    and existing_report.completeness = completeness
    and existing_report.verdict = target_verdict then
    return existing_report.id;
  end if;

  update public.impact_reports as report
  set status = 'superseded'
  where report.enrollment_id = target_enrollment_id
    and report.org_id = target_org_id
    and report.status = 'computed';

  select coalesce(max(report.version_number), 0) + 1
  into next_version
  from public.impact_reports as report
  where report.enrollment_id = target_enrollment_id;

  insert into public.impact_reports (
    org_id,
    enrollment_id,
    version_number,
    knowledge_metrics,
    confidence_metrics,
    live_metrics,
    completeness,
    verdict,
    computed_by
  )
  values (
    target_org_id,
    target_enrollment_id,
    next_version,
    knowledge_metrics,
    confidence_metrics,
    live_metrics,
    completeness,
    target_verdict,
    auth.uid()
  )
  returning id into created_report_id;

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
    'impact_report.computed',
    'impact_report',
    created_report_id::text,
    jsonb_build_object(
      'enrollment_id', target_enrollment_id,
      'cohort_id', target_cohort_id,
      'version_number', next_version,
      'verdict', target_verdict
    )
  );

  return created_report_id;
end;
$$;

create or replace function public.compute_cohort_impact(
  target_cohort_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  target_org_id uuid;
  target_pass_threshold numeric;
  total_enrollments integer := 0;
  sample_pre integer := 0;
  sample_post integer := 0;
  sample_matched integer := 0;
  live_enrollment_count integer := 0;
  total_live_events integer := 0;
  total_live_sessions integer := 0;
  total_scored_items integer := 0;
  total_correct_items integer := 0;
  pre_mean numeric;
  pre_min numeric;
  pre_max numeric;
  pre_stddev numeric;
  post_mean numeric;
  post_min numeric;
  post_max numeric;
  post_stddev numeric;
  delta_mean numeric;
  confidence_pre_mean numeric;
  confidence_post_mean numeric;
  confidence_delta_mean numeric;
  passed_count integer := 0;
  knowledge_metrics jsonb;
  confidence_metrics jsonb;
  live_metrics jsonb;
  trainee_breakdown jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  existing_report public.cohort_reports%rowtype;
  next_version integer;
  created_report_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select
    cohort.org_id,
    program_version.pass_threshold
  into target_org_id, target_pass_threshold
  from public.cohorts as cohort
  join public.program_versions as program_version
    on program_version.id = cohort.program_version_id
   and program_version.org_id = cohort.org_id
  where cohort.id = target_cohort_id;

  if target_org_id is null then
    raise exception 'Cohort not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'Cohort report computation is not allowed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'impact:cohort:' || target_cohort_id::text,
      0
    )
  );

  with current_reports as (
    select report.*
    from public.impact_reports as report
    join public.enrollments as enrollment
      on enrollment.id = report.enrollment_id
     and enrollment.org_id = report.org_id
    where enrollment.cohort_id = target_cohort_id
      and enrollment.status in ('invited', 'active', 'completed')
      and report.status = 'computed'
  )
  select
    count(*)::integer,
    count(*) filter (
      where (report.completeness ->> 'has_pre')::boolean
    )::integer,
    count(*) filter (
      where (report.completeness ->> 'has_post')::boolean
    )::integer,
    count(*) filter (
      where (report.completeness ->> 'has_pre')::boolean
        and (report.completeness ->> 'has_post')::boolean
    )::integer,
    count(*) filter (
      where (report.completeness ->> 'has_live')::boolean
    )::integer,
    coalesce(sum(
      (report.live_metrics ->> 'event_count')::integer
    ), 0)::integer,
    coalesce(sum(
      (report.live_metrics ->> 'session_count')::integer
    ), 0)::integer,
    coalesce(sum(
      (report.live_metrics ->> 'scored_item_count')::integer
    ), 0)::integer,
    coalesce(sum(
      (report.live_metrics ->> 'correct_item_count')::integer
    ), 0)::integer,
    round(avg(
      (report.knowledge_metrics ->> 'pre_score')::numeric
    ), 2),
    min((report.knowledge_metrics ->> 'pre_score')::numeric),
    max((report.knowledge_metrics ->> 'pre_score')::numeric),
    round(stddev_pop(
      (report.knowledge_metrics ->> 'pre_score')::numeric
    ), 2),
    round(avg(
      (report.knowledge_metrics ->> 'post_score')::numeric
    ), 2),
    min((report.knowledge_metrics ->> 'post_score')::numeric),
    max((report.knowledge_metrics ->> 'post_score')::numeric),
    round(stddev_pop(
      (report.knowledge_metrics ->> 'post_score')::numeric
    ), 2),
    round(avg(
      (report.knowledge_metrics ->> 'delta')::numeric
    ), 2),
    round(avg(
      (report.confidence_metrics ->> 'pre_mean')::numeric
    ), 2),
    round(avg(
      (report.confidence_metrics ->> 'post_mean')::numeric
    ), 2),
    round(avg(
      (report.confidence_metrics ->> 'delta')::numeric
    ), 2),
    count(*) filter (
      where report.verdict = 'passed'
    )::integer
  into
    total_enrollments,
    sample_pre,
    sample_post,
    sample_matched,
    live_enrollment_count,
    total_live_events,
    total_live_sessions,
    total_scored_items,
    total_correct_items,
    pre_mean,
    pre_min,
    pre_max,
    pre_stddev,
    post_mean,
    post_min,
    post_max,
    post_stddev,
    delta_mean,
    confidence_pre_mean,
    confidence_post_mean,
    confidence_delta_mean,
    passed_count
  from current_reports as report;

  knowledge_metrics := jsonb_build_object(
    'pre', jsonb_build_object(
      'mean', pre_mean,
      'min', pre_min,
      'max', pre_max,
      'stddev', pre_stddev
    ),
    'post', jsonb_build_object(
      'mean', post_mean,
      'min', post_min,
      'max', post_max,
      'stddev', post_stddev
    ),
    'matched_delta_mean', delta_mean,
    'pass_threshold', target_pass_threshold,
    'passed_count', passed_count,
    'pass_rate', case
      when sample_post > 0
        then round(passed_count::numeric / sample_post * 100, 2)
      else null
    end
  );

  confidence_metrics := jsonb_build_object(
    'pre_mean', confidence_pre_mean,
    'post_mean', confidence_post_mean,
    'matched_delta_mean', confidence_delta_mean
  );

  live_metrics := jsonb_build_object(
    'enrollment_count', live_enrollment_count,
    'event_count', total_live_events,
    'session_count', total_live_sessions,
    'scored_item_count', total_scored_items,
    'correct_item_count', total_correct_items,
    'accuracy_percentage', case
      when total_scored_items > 0
        then round(
          total_correct_items::numeric / total_scored_items * 100,
          2
        )
      else null
    end
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'enrollment_id', enrollment.id,
        'trainee_code', trainee.code,
        'trainee_name', trainee.full_name,
        'pre_score', report.knowledge_metrics -> 'pre_score',
        'post_score', report.knowledge_metrics -> 'post_score',
        'knowledge_delta', report.knowledge_metrics -> 'delta',
        'pre_confidence', report.confidence_metrics -> 'pre_mean',
        'post_confidence', report.confidence_metrics -> 'post_mean',
        'confidence_delta', report.confidence_metrics -> 'delta',
        'live_event_count', report.live_metrics -> 'event_count',
        'live_accuracy', report.live_metrics -> 'accuracy_percentage',
        'verdict', report.verdict,
        'completeness', report.completeness
      )
      order by trainee.full_name, trainee.code
    ),
    '[]'::jsonb
  )
  into trainee_breakdown
  from public.enrollments as enrollment
  join public.trainees as trainee
    on trainee.id = enrollment.trainee_id
   and trainee.org_id = enrollment.org_id
  left join public.impact_reports as report
    on report.enrollment_id = enrollment.id
   and report.org_id = enrollment.org_id
   and report.status = 'computed'
  where enrollment.cohort_id = target_cohort_id
    and enrollment.org_id = target_org_id
    and enrollment.status in ('invited', 'active', 'completed');

  if total_enrollments = 0 then
    warnings := warnings || jsonb_build_array(
      'لا توجد تسجيلات نشطة في الدفعة.'
    );
  end if;

  if sample_pre = 0 then
    warnings := warnings || jsonb_build_array(
      'لم تصل أي نتائج قبلية.'
    );
  end if;

  if sample_post = 0 then
    warnings := warnings || jsonb_build_array(
      'لم تصل أي نتائج بعدية؛ لا يمكن إصدار حكم نهائي.'
    );
  end if;

  if sample_pre <> sample_post then
    warnings := warnings || jsonb_build_array(
      'العينة القبلية والبعدية غير متساويتين؛ تُعرض المقارنة وصفياً.'
    );
  end if;

  if sample_matched > 0 and sample_matched < 5 then
    warnings := warnings || jsonb_build_array(
      'العينة المطابقة صغيرة؛ لا تُعمم النتيجة خارج هذه الدفعة.'
    );
  end if;

  if live_enrollment_count = 0 then
    warnings := warnings || jsonb_build_array(
      'لم تصل أحداث أداء لحظي فعلية؛ اختبارات الاتصال مستبعدة.'
    );
  end if;

  select report.*
  into existing_report
  from public.cohort_reports as report
  where report.cohort_id = target_cohort_id
    and report.org_id = target_org_id
    and report.status = 'computed'
  order by report.version_number desc
  limit 1;

  if existing_report.id is not null
    and existing_report.sample_pre = sample_pre
    and existing_report.sample_post = sample_post
    and existing_report.sample_matched = sample_matched
    and existing_report.knowledge_metrics = knowledge_metrics
    and existing_report.confidence_metrics = confidence_metrics
    and existing_report.live_metrics = live_metrics
    and existing_report.trainee_breakdown = trainee_breakdown
    and existing_report.warnings = warnings then
    return existing_report.id;
  end if;

  update public.cohort_reports as report
  set status = 'superseded'
  where report.cohort_id = target_cohort_id
    and report.org_id = target_org_id
    and report.status = 'computed';

  select coalesce(max(report.version_number), 0) + 1
  into next_version
  from public.cohort_reports as report
  where report.cohort_id = target_cohort_id;

  insert into public.cohort_reports (
    org_id,
    cohort_id,
    version_number,
    sample_pre,
    sample_post,
    sample_matched,
    knowledge_metrics,
    confidence_metrics,
    live_metrics,
    trainee_breakdown,
    warnings,
    computed_by
  )
  values (
    target_org_id,
    target_cohort_id,
    next_version,
    sample_pre,
    sample_post,
    sample_matched,
    knowledge_metrics,
    confidence_metrics,
    live_metrics,
    trainee_breakdown,
    warnings,
    auth.uid()
  )
  returning id into created_report_id;

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
    'cohort_report.computed',
    'cohort_report',
    created_report_id::text,
    jsonb_build_object(
      'cohort_id', target_cohort_id,
      'version_number', next_version,
      'sample_pre', sample_pre,
      'sample_post', sample_post,
      'sample_matched', sample_matched
    )
  );

  return created_report_id;
end;
$$;

create or replace function public.refresh_cohort_impact(
  target_cohort_id uuid
)
returns table (
  cohort_report_id uuid,
  individual_report_count integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_variable
declare
  target_org_id uuid;
  enrollment_row record;
  refreshed_count integer := 0;
  refreshed_cohort_report_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select cohort.org_id
  into target_org_id
  from public.cohorts as cohort
  where cohort.id = target_cohort_id;

  if target_org_id is null then
    raise exception 'Cohort not found';
  end if;

  if not (
    public.is_platform_admin()
    or public.has_org_role(target_org_id, array['owner', 'trainer'])
  ) then
    raise exception 'Impact report refresh is not allowed';
  end if;

  for enrollment_row in
    select enrollment.id
    from public.enrollments as enrollment
    where enrollment.cohort_id = target_cohort_id
      and enrollment.org_id = target_org_id
      and enrollment.status in ('invited', 'active', 'completed')
    order by enrollment.enrolled_at, enrollment.id
  loop
    perform public.compute_enrollment_impact(enrollment_row.id);
    refreshed_count := refreshed_count + 1;
  end loop;

  refreshed_cohort_report_id :=
    public.compute_cohort_impact(target_cohort_id);

  return query
  select refreshed_cohort_report_id, refreshed_count;
end;
$$;

revoke all on function public.compute_enrollment_impact(uuid) from public;
revoke all on function public.compute_enrollment_impact(uuid) from anon;
revoke all on function public.compute_cohort_impact(uuid) from public;
revoke all on function public.compute_cohort_impact(uuid) from anon;
revoke all on function public.refresh_cohort_impact(uuid) from public;
revoke all on function public.refresh_cohort_impact(uuid) from anon;

grant execute on function public.compute_enrollment_impact(uuid)
  to authenticated;
grant execute on function public.refresh_cohort_impact(uuid)
  to authenticated;

commit;
