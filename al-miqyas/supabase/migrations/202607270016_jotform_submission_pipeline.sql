begin;

do $$
begin
  if exists (
    select 1
    from public.assessments as assessment
    group by assessment.enrollment_id, assessment.assessment_kind
    having count(*) > 1
  ) then
    raise exception
      'Duplicate pre/post assessments must be resolved before migration 016';
  end if;
end;
$$;

create unique index if not exists assessments_one_per_enrollment_kind_idx
  on public.assessments (enrollment_id, assessment_kind);

create or replace function public.create_public_assessment_link(
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
set search_path = public, pg_temp
as $$
declare
  target_enrollment_id uuid;
  normalized_trainee_code text;
  configured_form_id text;
  configured_trainee_field_name text;
  configured_token_field_name text;
  raw_submission_token text;
begin
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
    enrollment.id,
    form_config.form_id,
    form_config.trainee_field_name,
    form_config.submission_token_field_name
  into
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
    and cohort.status in ('open', 'in_progress')
    and not exists (
      select 1
      from public.assessments as completed_assessment
      where completed_assessment.enrollment_id = enrollment.id
        and completed_assessment.assessment_kind = target_assessment_kind
    )
    and (
      target_assessment_kind = 'pre'
      or exists (
        select 1
        from public.assessments as pre_assessment
        where pre_assessment.enrollment_id = enrollment.id
          and pre_assessment.assessment_kind = 'pre'
      )
    )
  order by enrollment.enrolled_at desc
  limit 1;

  if target_enrollment_id is null then
    raise exception
      'Assessment is not available for this trainee';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_enrollment_id::text || ':' || target_assessment_kind,
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
      'Assessment link rate limit exceeded';
  end if;

  raw_submission_token :=
    public.create_assessment_submission_token(
      target_enrollment_id,
      target_assessment_kind,
      interval '2 hours'
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

revoke all on function public.create_public_assessment_link(
  text,
  text
) from public;
grant execute on function public.create_public_assessment_link(
  text,
  text
) to anon;
grant execute on function public.create_public_assessment_link(
  text,
  text
) to authenticated;

create or replace function public.process_jotform_submission(
  target_form_id text,
  target_submission_id text,
  target_submission_token text,
  target_submitted_at timestamptz,
  target_answers jsonb,
  target_payload jsonb
)
returns table (
  processing_result text,
  assessment_id uuid,
  ingestion_id uuid,
  score_percentage numeric,
  confidence_mean numeric
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  token_record_id uuid;
  token_record_status text;
  token_record_expires_at timestamptz;
  target_org_id uuid;
  target_enrollment_id uuid;
  target_cohort_id uuid;
  target_assessment_kind text;
  target_trainee_code text;
  target_jotform_config_id uuid;
  target_answer_key jsonb;
  target_confidence_config jsonb;
  existing_ingestion_id uuid;
  existing_assessment_id uuid;
  existing_score_percentage numeric;
  existing_confidence_mean numeric;
  created_ingestion_id uuid;
  created_assessment_id uuid;
  question_key text;
  question_config jsonb;
  submitted_answer text;
  correct_answer text;
  question_is_correct boolean;
  graded_items jsonb := '{}'::jsonb;
  earned_score numeric := 0;
  maximum_score numeric := 0;
  calculated_score_percentage numeric;
  confidence_key text;
  confidence_item_config jsonb;
  confidence_answer text;
  confidence_value_text text;
  confidence_value numeric;
  confidence_total numeric := 0;
  confidence_count integer := 0;
  confidence_items jsonb := '{}'::jsonb;
  calculated_confidence_mean numeric;
begin
  if target_form_id is null
    or target_form_id !~ '^[0-9]{5,30}$'
    or target_submission_id is null
    or length(btrim(target_submission_id)) not between 5 and 100
    or target_submission_token is null
    or target_submission_token !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Invalid Jotform submission identifiers';
  end if;

  if target_answers is null
    or jsonb_typeof(target_answers) <> 'object'
    or target_payload is null
    or jsonb_typeof(target_payload) <> 'object'
  then
    raise exception 'Invalid Jotform submission payload';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('jotform:' || target_submission_id, 0)
  );

  select
    ingestion.id,
    assessment.id,
    assessment.score_percentage,
    nullif(assessment.confidence ->> 'mean', '')::numeric
  into
    existing_ingestion_id,
    existing_assessment_id,
    existing_score_percentage,
    existing_confidence_mean
  from public.webhook_ingestions as ingestion
  left join public.assessments as assessment
    on assessment.ingestion_id = ingestion.id
   and assessment.org_id = ingestion.org_id
  where ingestion.provider = 'jotform'
    and ingestion.external_event_id = target_submission_id
  limit 1;

  if existing_ingestion_id is not null then
    return query
    select
      'duplicate'::text,
      existing_assessment_id,
      existing_ingestion_id,
      existing_score_percentage,
      existing_confidence_mean;
    return;
  end if;

  select
    submission_token.id,
    submission_token.status,
    submission_token.expires_at,
    submission_token.org_id,
    submission_token.enrollment_id,
    enrollment.cohort_id,
    submission_token.assessment_kind,
    trainee.code,
    form_config.id,
    program_version.answer_key,
    program_version.confidence_config
  into
    token_record_id,
    token_record_status,
    token_record_expires_at,
    target_org_id,
    target_enrollment_id,
    target_cohort_id,
    target_assessment_kind,
    target_trainee_code,
    target_jotform_config_id,
    target_answer_key,
    target_confidence_config
  from public.assessment_submission_tokens as submission_token
  join public.enrollments as enrollment
    on enrollment.id = submission_token.enrollment_id
   and enrollment.org_id = submission_token.org_id
  join public.trainees as trainee
    on trainee.id = enrollment.trainee_id
   and trainee.org_id = enrollment.org_id
  join public.cohorts as cohort
    on cohort.id = enrollment.cohort_id
   and cohort.org_id = enrollment.org_id
  join public.jotform_forms as form_config
    on form_config.program_version_id = cohort.program_version_id
   and form_config.org_id = cohort.org_id
   and form_config.assessment_kind = submission_token.assessment_kind
   and form_config.form_id = target_form_id
   and form_config.is_active
  join public.program_versions as program_version
    on program_version.id = form_config.program_version_id
   and program_version.org_id = form_config.org_id
  where submission_token.token_hash =
    encode(
      extensions.digest(target_submission_token, 'sha256'),
      'hex'
    )
  for update of submission_token;

  if token_record_id is null then
    raise exception 'Submission token is invalid for this form';
  end if;

  if token_record_status <> 'active'
    or token_record_expires_at <= now()
  then
    raise exception 'Submission token is no longer active';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      target_enrollment_id::text || ':' || target_assessment_kind,
      0
    )
  );

  select
    assessment.id,
    assessment.score_percentage,
    nullif(assessment.confidence ->> 'mean', '')::numeric
  into
    existing_assessment_id,
    existing_score_percentage,
    existing_confidence_mean
  from public.assessments as assessment
  where assessment.enrollment_id = target_enrollment_id
    and assessment.assessment_kind = target_assessment_kind
  order by assessment.submitted_at asc
  limit 1;

  if existing_assessment_id is not null then
    update public.assessment_submission_tokens
    set
      status = 'revoked',
      revoked_at = now()
    where id = token_record_id;

    return query
    select
      'already_completed'::text,
      existing_assessment_id,
      null::uuid,
      existing_score_percentage,
      existing_confidence_mean;
    return;
  end if;

  if jsonb_typeof(target_answer_key -> 'questions') <> 'object'
    or jsonb_typeof(target_confidence_config -> 'items') <> 'object'
    or jsonb_typeof(
      target_confidence_config -> 'response_values'
    ) <> 'object'
  then
    raise exception 'Program assessment configuration is invalid';
  end if;

  for question_key, question_config in
    select question.key, question.value
    from jsonb_each(target_answer_key -> 'questions') as question
  loop
    submitted_answer := nullif(btrim(target_answers ->> question_key), '');
    correct_answer := question_config ->> 'correct_value';

    if submitted_answer is null or correct_answer is null then
      raise exception 'A required knowledge answer is missing';
    end if;

    question_is_correct := submitted_answer = correct_answer;
    maximum_score := maximum_score + 1;

    if question_is_correct then
      earned_score := earned_score + 1;
    end if;

    graded_items := graded_items || jsonb_build_object(
      question_key,
      jsonb_build_object(
        'submitted_value', submitted_answer,
        'correct_value', correct_answer,
        'is_correct', question_is_correct,
        'score', case when question_is_correct then 1 else 0 end,
        'max_score', 1,
        'learning_objective',
          question_config ->> 'learning_objective'
      )
    );
  end loop;

  if maximum_score <> 10 then
    raise exception 'Answer key must contain exactly ten questions';
  end if;

  for confidence_key, confidence_item_config in
    select confidence_item.key, confidence_item.value
    from jsonb_each(
      target_confidence_config -> 'items'
    ) as confidence_item
  loop
    confidence_answer :=
      nullif(btrim(target_answers ->> confidence_key), '');
    confidence_value_text :=
      target_confidence_config
        -> 'response_values'
        ->> confidence_answer;

    if confidence_answer is null or confidence_value_text is null then
      raise exception 'A required confidence answer is missing or invalid';
    end if;

    confidence_value := confidence_value_text::numeric;
    confidence_total := confidence_total + confidence_value;
    confidence_count := confidence_count + 1;
    confidence_items := confidence_items || jsonb_build_object(
      confidence_key,
      jsonb_build_object(
        'submitted_value', confidence_answer,
        'numeric_value', confidence_value,
        'learning_objective',
          confidence_item_config ->> 'learning_objective'
      )
    );
  end loop;

  if confidence_count <> 6 then
    raise exception 'Confidence configuration must contain exactly six items';
  end if;

  calculated_score_percentage :=
    round((earned_score / maximum_score) * 100, 2);
  calculated_confidence_mean :=
    round(confidence_total / confidence_count, 2);

  insert into public.webhook_ingestions (
    org_id,
    provider,
    channel,
    external_event_id,
    form_id,
    payload,
    status,
    attempt_count
  )
  values (
    target_org_id,
    'jotform',
    'webhook',
    target_submission_id,
    target_form_id,
    target_payload,
    'processing',
    1
  )
  returning id into created_ingestion_id;

  insert into public.assessments (
    org_id,
    cohort_id,
    enrollment_id,
    ingestion_id,
    jotform_form_id,
    form_id,
    submission_id,
    assessment_kind,
    trainee_code_received,
    score,
    max_score,
    score_percentage,
    confidence,
    graded_items,
    raw_answers,
    submitted_at
  )
  values (
    target_org_id,
    target_cohort_id,
    target_enrollment_id,
    created_ingestion_id,
    target_jotform_config_id,
    target_form_id,
    target_submission_id,
    target_assessment_kind,
    target_trainee_code,
    earned_score,
    maximum_score,
    calculated_score_percentage,
    jsonb_build_object(
      'items', confidence_items,
      'mean', calculated_confidence_mean,
      'min', target_confidence_config -> 'min',
      'max', target_confidence_config -> 'max'
    ),
    graded_items,
    target_answers,
    coalesce(target_submitted_at, now())
  )
  returning id into created_assessment_id;

  update public.assessment_submission_tokens
  set
    status = 'used',
    used_at = now()
  where id = token_record_id;

  update public.webhook_ingestions
  set
    status = 'processed',
    processed_at = now()
  where id = created_ingestion_id;

  insert into public.audit_logs (
    org_id,
    action,
    entity_type,
    entity_id,
    after_data,
    metadata
  )
  values (
    target_org_id,
    'assessment.processed',
    'assessment',
    created_assessment_id::text,
    jsonb_build_object(
      'assessment_kind', target_assessment_kind,
      'score_percentage', calculated_score_percentage,
      'confidence_mean', calculated_confidence_mean
    ),
    jsonb_build_object(
      'source', 'jotform_webhook',
      'form_id', target_form_id,
      'submission_id', target_submission_id
    )
  );

  return query
  select
    'processed'::text,
    created_assessment_id,
    created_ingestion_id,
    calculated_score_percentage,
    calculated_confidence_mean;
end;
$$;

revoke all on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public;
grant execute on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to anon;
grant execute on function public.process_jotform_submission(
  text,
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to authenticated;

commit;
