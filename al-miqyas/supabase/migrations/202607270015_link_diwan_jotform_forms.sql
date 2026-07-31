begin;

alter table public.jotform_forms
  add column if not exists submission_token_field_name text
    not null default 'submissionToken'
    check (length(btrim(submission_token_field_name)) between 1 and 100);

alter table public.jotform_forms
  add column if not exists form_version integer
    not null default 1
    check (form_version > 0);

create table if not exists public.assessment_submission_tokens (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  enrollment_id uuid not null,
  assessment_kind text not null
    check (assessment_kind in ('pre', 'post')),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'active',
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (enrollment_id, org_id)
    references public.enrollments(id, org_id) on delete restrict,
  unique (id, org_id),
  constraint assessment_submission_tokens_expiry_check
    check (expires_at > created_at),
  constraint assessment_submission_tokens_status_check
    check (
      (status = 'active' and used_at is null and revoked_at is null)
      or (status = 'used' and used_at is not null and revoked_at is null)
      or (status = 'revoked' and used_at is null and revoked_at is not null)
    )
);

create index if not exists assessment_submission_tokens_lookup_idx
  on public.assessment_submission_tokens (
    token_hash,
    assessment_kind,
    status,
    expires_at
  );

create index if not exists assessment_submission_tokens_enrollment_idx
  on public.assessment_submission_tokens (
    enrollment_id,
    assessment_kind,
    created_at desc
  );

drop trigger if exists assessment_submission_tokens_set_updated_at
  on public.assessment_submission_tokens;

create trigger assessment_submission_tokens_set_updated_at
before update on public.assessment_submission_tokens
for each row execute function public.set_updated_at();

alter table public.assessment_submission_tokens enable row level security;

revoke all on table public.assessment_submission_tokens from public;
revoke all on table public.assessment_submission_tokens from anon;
revoke all on table public.assessment_submission_tokens from authenticated;
grant select, insert, update on table public.assessment_submission_tokens
  to service_role;

create or replace function public.create_assessment_submission_token(
  target_enrollment_id uuid,
  target_assessment_kind text,
  token_ttl interval default interval '2 hours'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_org_id uuid;
  raw_token text;
begin
  if target_assessment_kind not in ('pre', 'post') then
    raise exception 'Assessment kind must be pre or post';
  end if;

  if token_ttl < interval '5 minutes'
    or token_ttl > interval '24 hours'
  then
    raise exception 'Token lifetime must be between 5 minutes and 24 hours';
  end if;

  select enrollment.org_id
  into target_org_id
  from public.enrollments as enrollment
  join public.cohorts as cohort
    on cohort.id = enrollment.cohort_id
   and cohort.org_id = enrollment.org_id
  where enrollment.id = target_enrollment_id
    and enrollment.status in ('invited', 'active')
    and cohort.status in ('open', 'in_progress')
    and exists (
      select 1
      from public.jotform_forms as form_config
      where form_config.program_version_id = cohort.program_version_id
        and form_config.org_id = enrollment.org_id
        and form_config.assessment_kind = target_assessment_kind
        and form_config.is_active
    );

  if target_org_id is null then
    raise exception
      'Enrollment is not eligible for the requested assessment';
  end if;

  raw_token := encode(extensions.gen_random_bytes(32), 'hex');

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
    encode(extensions.digest(raw_token, 'sha256'), 'hex'),
    now() + token_ttl
  );

  return raw_token;
end;
$$;

revoke all on function public.create_assessment_submission_token(
  uuid,
  text,
  interval
) from public;
revoke all on function public.create_assessment_submission_token(
  uuid,
  text,
  interval
) from anon;
revoke all on function public.create_assessment_submission_token(
  uuid,
  text,
  interval
) from authenticated;
grant execute on function public.create_assessment_submission_token(
  uuid,
  text,
  interval
) to service_role;

do $$
declare
  target_org_id uuid;
  target_program_id uuid;
  target_program_version_id uuid;
  target_program_version_status text;
  target_program_version_number integer;
  matching_program_count integer;
  before_state jsonb;
  after_state jsonb;
begin
  select count(*)
  into matching_program_count
  from public.programs as program
  where program.slug = 'diwan-onboarding';

  if matching_program_count <> 1 then
    raise exception
      'Expected exactly one diwan-onboarding program, found %',
      matching_program_count;
  end if;

  select program.id, program.org_id
  into target_program_id, target_org_id
  from public.programs as program
  where program.slug = 'diwan-onboarding';

  select
    program_version.id,
    program_version.status,
    program_version.version_number
  into
    target_program_version_id,
    target_program_version_status,
    target_program_version_number
  from public.program_versions as program_version
  where program_version.program_id = target_program_id
    and program_version.org_id = target_org_id
  order by program_version.version_number desc
  limit 1;

  if target_program_version_id is null then
    raise exception
      'No program version exists for diwan-onboarding';
  end if;

  if target_program_version_status <> 'draft' then
    raise exception
      'Latest diwan-onboarding version must remain draft while internal questions await approval; current status is %',
      target_program_version_status;
  end if;

  if exists (
    select 1
    from public.jotform_forms as form_config
    where form_config.form_id in (
      '262072857573465',
      '262072849441460'
    )
      and (
        form_config.org_id <> target_org_id
        or form_config.program_version_id <> target_program_version_id
      )
  ) then
    raise exception
      'A Diwan Jotform form is already linked to another tenant or program version';
  end if;

  select jsonb_build_object(
    'program_version', to_jsonb(program_version),
    'forms', coalesce(
      (
        select jsonb_agg(
          to_jsonb(form_config)
          order by form_config.assessment_kind
        )
        from public.jotform_forms as form_config
        where form_config.program_version_id = target_program_version_id
      ),
      '[]'::jsonb
    )
  )
  into before_state
  from public.program_versions as program_version
  where program_version.id = target_program_version_id;

  update public.program_versions
  set
    pass_threshold = 80,
    answer_key = jsonb_build_object(
      'schema_version', 1,
      'program_code', 'diwan-onboarding',
      'form_version', 1,
      'scoring', jsonb_build_object(
        'method', 'binary',
        'question_count', 10,
        'points_per_question', 1,
        'max_score', 10,
        'pass_threshold_percent', 80
      ),
      'questions', jsonb_build_object(
        'K01', jsonb_build_object(
          'learning_objective', 'LO-1',
          'correct_option_key', 'A',
          'correct_value', 'عام 1373هـ.'
        ),
        'K02', jsonb_build_object(
          'learning_objective', 'LO-1',
          'correct_option_key', 'B',
          'correct_value', 'هيئة قضاء إداري مستقلة ترتبط مباشرة بالملك.'
        ),
        'K03', jsonb_build_object(
          'learning_objective', 'LO-1',
          'correct_option_key', 'B',
          'correct_value', 'المحكمة الإدارية العليا.'
        ),
        'K04', jsonb_build_object(
          'learning_objective', 'LO-2',
          'correct_option_key', 'C',
          'correct_value', 'الدور السابع.',
          'internal_approval_required', true
        ),
        'K05', jsonb_build_object(
          'learning_objective', 'LO-3',
          'correct_option_key', 'A',
          'correct_value', 'إدارة التواصل الداخلي.',
          'internal_approval_required', true
        ),
        'K06', jsonb_build_object(
          'learning_objective', 'LO-3',
          'correct_option_key', 'A',
          'correct_value', 'إدارة عمليات الموارد البشرية.',
          'internal_approval_required', true
        ),
        'K07', jsonb_build_object(
          'learning_objective', 'LO-4',
          'correct_option_key', 'B',
          'correct_value', 'رفضها بلباقة.'
        ),
        'K08', jsonb_build_object(
          'learning_objective', 'LO-4',
          'correct_option_key', 'B',
          'correct_value', 'الإفصاح خطيًا والانسحاب من المهمة.'
        ),
        'K09', jsonb_build_object(
          'learning_objective', 'LO-5',
          'correct_option_key', 'C',
          'correct_value', 'التطبيق الكفي.',
          'internal_approval_required', true
        ),
        'K10', jsonb_build_object(
          'learning_objective', 'LO-6',
          'correct_option_key', 'B',
          'correct_value', 'تسجيل البيانات والتحقق من الهوية لدى خدمة الزائرين.',
          'internal_approval_required', true
        )
      ),
      'internal_approval_required', jsonb_build_array(
        'K04',
        'K05',
        'K06',
        'K09',
        'K10'
      )
    ),
    confidence_config = jsonb_build_object(
      'schema_version', 1,
      'min', 1,
      'max', 5,
      'response_values', jsonb_build_object(
        '1 — لا أستطيع تنفيذ ذلك.', 1,
        '2 — أستطيع بدرجة ضعيفة.', 2,
        '3 — أستطيع بدرجة متوسطة.', 3,
        '4 — أستطيع بدرجة جيدة.', 4,
        '5 — أستطيع بثقة عالية.', 5
      ),
      'items', jsonb_build_object(
        'C01', jsonb_build_object('learning_objective', 'LO-1'),
        'C02', jsonb_build_object('learning_objective', 'LO-2'),
        'C03', jsonb_build_object('learning_objective', 'LO-3'),
        'C04', jsonb_build_object('learning_objective', 'LO-4'),
        'C05', jsonb_build_object('learning_objective', 'LO-5'),
        'C06', jsonb_build_object('learning_objective', 'LO-6')
      ),
      'aggregation', 'mean'
    )
  where id = target_program_version_id;

  insert into public.jotform_forms (
    org_id,
    program_version_id,
    form_id,
    assessment_kind,
    trainee_field_name,
    submission_token_field_name,
    form_version,
    is_active
  )
  values
    (
      target_org_id,
      target_program_version_id,
      '262072857573465',
      'pre',
      'traineeId',
      'submissionToken',
      1,
      true
    ),
    (
      target_org_id,
      target_program_version_id,
      '262072849441460',
      'post',
      'traineeId',
      'submissionToken',
      1,
      true
    )
  on conflict (program_version_id, assessment_kind)
  do update set
    form_id = excluded.form_id,
    trainee_field_name = excluded.trainee_field_name,
    submission_token_field_name = excluded.submission_token_field_name,
    form_version = excluded.form_version,
    is_active = excluded.is_active;

  if (
    select count(*)
    from public.jotform_forms as form_config
    where form_config.program_version_id = target_program_version_id
      and form_config.org_id = target_org_id
      and form_config.is_active
      and (
        (
          form_config.assessment_kind = 'pre'
          and form_config.form_id = '262072857573465'
        )
        or (
          form_config.assessment_kind = 'post'
          and form_config.form_id = '262072849441460'
        )
      )
  ) <> 2 then
    raise exception
      'Diwan Jotform configuration verification failed';
  end if;

  if (
    select count(*)
    from public.program_versions as program_version
    cross join lateral jsonb_object_keys(
      program_version.answer_key -> 'questions'
    ) as question_key
    where program_version.id = target_program_version_id
  ) <> 10 then
    raise exception
      'Diwan answer key verification failed';
  end if;

  if (
    select count(*)
    from public.program_versions as program_version
    cross join lateral jsonb_object_keys(
      program_version.confidence_config -> 'items'
    ) as confidence_key
    where program_version.id = target_program_version_id
  ) <> 6 then
    raise exception
      'Diwan confidence configuration verification failed';
  end if;

  select jsonb_build_object(
    'program_version', to_jsonb(program_version),
    'forms', coalesce(
      (
        select jsonb_agg(
          to_jsonb(form_config)
          order by form_config.assessment_kind
        )
        from public.jotform_forms as form_config
        where form_config.program_version_id = target_program_version_id
      ),
      '[]'::jsonb
    )
  )
  into after_state
  from public.program_versions as program_version
  where program_version.id = target_program_version_id;

  if before_state is distinct from after_state then
    insert into public.audit_logs (
      org_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data,
      metadata
    )
    values (
      target_org_id,
      'jotform.configuration.linked',
      'program_version',
      target_program_version_id::text,
      before_state,
      after_state,
      jsonb_build_object(
        'source', 'migration_015',
        'program_slug', 'diwan-onboarding',
        'program_version_number', target_program_version_number,
        'form_version', 1,
        'pre_form_id', '262072857573465',
        'post_form_id', '262072849441460'
      )
    );
  end if;
end;
$$;

commit;
