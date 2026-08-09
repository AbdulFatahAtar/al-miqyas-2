begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public;
revoke all on function public.set_updated_at() from anon;
revoke all on function public.set_updated_at() from authenticated;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name_ar text not null check (length(btrim(name_ar)) between 2 and 160),
  name_en text check (name_en is null or length(btrim(name_en)) between 2 and 160),
  logo_url text,
  brand_color text not null default '#C9A24B'
    check (brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint organizations_status_archived_check
    check (status <> 'archived' or archived_at is not null)
);

create table public.memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete restrict,
  role text not null check (role in ('owner', 'trainer', 'viewer')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, org_id)
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_active boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now()
);

create table public.membership_invitations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  email text not null check (position('@' in email) > 1),
  role text not null check (role in ('owner', 'trainer', 'viewer')),
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint membership_invitations_expiry_check
    check (expires_at > created_at),
  constraint membership_invitations_accepted_check
    check (
      status <> 'accepted'
      or (accepted_by is not null and accepted_at is not null)
    )
);

create unique index membership_invitations_one_pending_idx
  on public.membership_invitations (org_id, lower(email))
  where status = 'pending';

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  slug text not null
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title_ar text not null check (length(btrim(title_ar)) between 2 and 200),
  title_en text,
  certificate_prefix text not null
    check (certificate_prefix ~ '^[A-Z0-9]{2,12}$'),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (org_id, slug),
  unique (id, org_id),
  constraint programs_status_archived_check
    check (status <> 'archived' or archived_at is not null)
);

create table public.program_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  program_id uuid not null,
  version_number integer not null check (version_number > 0),
  pass_threshold numeric(5,2) not null default 80
    check (pass_threshold between 0 and 100),
  answer_key jsonb not null default '{}'::jsonb
    check (jsonb_typeof(answer_key) = 'object'),
  confidence_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(confidence_config) = 'object'),
  live_performance_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(live_performance_config) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'published', 'retired')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, org_id)
    references public.programs(id, org_id) on delete restrict,
  unique (program_id, version_number),
  unique (id, org_id),
  unique (id, program_id, org_id),
  constraint program_versions_published_check
    check (status = 'draft' or published_at is not null)
);

create or replace function public.protect_published_program_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.status in ('published', 'retired') and (
    new.org_id is distinct from old.org_id
    or new.program_id is distinct from old.program_id
    or new.version_number is distinct from old.version_number
    or new.pass_threshold is distinct from old.pass_threshold
    or new.answer_key is distinct from old.answer_key
    or new.confidence_config is distinct from old.confidence_config
    or new.live_performance_config is distinct from old.live_performance_config
  ) then
    raise exception
      'Published program versions are immutable; create a new version instead';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_published_program_version() from public;
revoke all on function public.protect_published_program_version() from anon;
revoke all on function public.protect_published_program_version() from authenticated;

create table public.jotform_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  program_version_id uuid not null,
  form_id text not null check (length(btrim(form_id)) between 1 and 100),
  assessment_kind text not null check (assessment_kind in ('pre', 'post')),
  trainee_field_name text not null default 'traineeId'
    check (length(btrim(trainee_field_name)) between 1 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_version_id, org_id)
    references public.program_versions(id, org_id) on delete restrict,
  unique (form_id),
  unique (program_version_id, assessment_kind),
  unique (id, org_id),
  unique (id, form_id, assessment_kind, org_id)
);

create table public.cohorts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  program_id uuid not null,
  program_version_id uuid not null,
  code text not null check (length(btrim(code)) between 2 and 60),
  title text not null check (length(btrim(title)) between 2 and 200),
  starts_on date,
  ends_on date,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'in_progress', 'closed', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  archived_at timestamptz,
  foreign key (program_id, org_id)
    references public.programs(id, org_id) on delete restrict,
  foreign key (program_version_id, program_id, org_id)
    references public.program_versions(id, program_id, org_id) on delete restrict,
  unique (org_id, code),
  unique (id, org_id),
  constraint cohorts_dates_check
    check (starts_on is null or ends_on is null or ends_on >= starts_on),
  constraint cohorts_closed_check
    check (status <> 'closed' or closed_at is not null),
  constraint cohorts_archived_check
    check (status <> 'archived' or archived_at is not null)
);

create table public.trainees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  code text not null unique
    check (code ~ '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'),
  full_name text not null check (length(btrim(full_name)) between 2 and 200),
  phone text,
  email text,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, org_id),
  constraint trainees_status_archived_check
    check (status <> 'archived' or archived_at is not null)
);

create or replace function public.generate_trainee_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  safe_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  attempt integer := 0;
begin
  loop
    attempt := attempt + 1;
    if attempt > 100 then
      raise exception 'Unable to generate a unique trainee code';
    end if;

    candidate := 'AMD-';
    for i in 1..5 loop
      candidate := candidate || substr(
        safe_alphabet,
        1 + floor(random() * length(safe_alphabet))::integer,
        1
      );
    end loop;

    exit when not exists (
      select 1 from public.trainees where code = candidate
    );
  end loop;

  return candidate;
end;
$$;

revoke all on function public.generate_trainee_code() from public;
revoke all on function public.generate_trainee_code() from anon;
revoke all on function public.generate_trainee_code() from authenticated;
grant execute on function public.generate_trainee_code() to service_role;

create table public.enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cohort_id uuid not null,
  trainee_id uuid not null,
  status text not null default 'active'
    check (status in ('invited', 'active', 'completed', 'withdrawn', 'cancelled')),
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (cohort_id, org_id)
    references public.cohorts(id, org_id) on delete restrict,
  foreign key (trainee_id, org_id)
    references public.trainees(id, org_id) on delete restrict,
  unique (cohort_id, trainee_id),
  unique (id, org_id),
  unique (id, cohort_id, org_id),
  constraint enrollments_completed_check
    check (status <> 'completed' or completed_at is not null)
);

create table public.webhook_ingestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete restrict,
  provider text not null check (provider in ('jotform', 'xapi')),
  channel text not null check (channel in ('webhook', 'reconciliation', 'api')),
  external_event_id text not null check (length(btrim(external_event_id)) > 0),
  form_id text,
  payload jsonb not null,
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'duplicate', 'rejected', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint webhook_ingestions_provider_channel_check
    check (
      (provider = 'jotform' and channel in ('webhook', 'reconciliation'))
      or (provider = 'xapi' and channel = 'api')
    ),
  unique (provider, external_event_id),
  unique (id, org_id)
);

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cohort_id uuid not null,
  enrollment_id uuid not null,
  ingestion_id uuid not null,
  jotform_form_id uuid not null,
  source text not null default 'jotform' check (source = 'jotform'),
  form_id text not null,
  submission_id text not null,
  assessment_kind text not null check (assessment_kind in ('pre', 'post')),
  trainee_code_received text not null
    check (trainee_code_received ~ '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'),
  score numeric(10,2) not null check (score >= 0),
  max_score numeric(10,2) not null check (max_score > 0),
  score_percentage numeric(5,2) not null check (score_percentage between 0 and 100),
  confidence jsonb not null default '{}'::jsonb,
  graded_items jsonb not null default '{}'::jsonb,
  raw_answers jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (enrollment_id, cohort_id, org_id)
    references public.enrollments(id, cohort_id, org_id) on delete restrict,
  foreign key (ingestion_id, org_id)
    references public.webhook_ingestions(id, org_id) on delete restrict,
  foreign key (jotform_form_id, form_id, assessment_kind, org_id)
    references public.jotform_forms(id, form_id, assessment_kind, org_id)
    on delete restrict,
  unique (source, submission_id),
  unique (id, org_id),
  constraint assessments_score_consistency_check
    check (
      score <= max_score
      and abs(score_percentage - round((score / max_score) * 100, 2)) <= 0.01
    )
);

create table public.org_api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete restrict,
  label text not null check (length(btrim(label)) between 2 and 120),
  key_prefix text not null check (length(btrim(key_prefix)) between 6 and 20),
  key_hash text not null unique,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (org_id, key_prefix),
  unique (id, org_id),
  constraint org_api_keys_revoked_check
    check (status <> 'revoked' or revoked_at is not null)
);

create table public.xapi_statements (
  id uuid primary key default gen_random_uuid(),
  statement_id text not null unique
    check (length(btrim(statement_id)) between 1 and 200),
  org_id uuid not null,
  api_key_id uuid not null,
  enrollment_id uuid,
  trainee_code_received text not null
    check (length(btrim(trainee_code_received)) between 1 and 100),
  program_id uuid not null,
  session_id text not null check (length(btrim(session_id)) > 0),
  verb_id text not null check (length(btrim(verb_id)) > 0),
  object_id text not null check (length(btrim(object_id)) > 0),
  result jsonb not null default '{}'::jsonb,
  context jsonb not null default '{}'::jsonb,
  raw_statement jsonb not null,
  processing_status text not null default 'accepted'
    check (processing_status in ('accepted', 'unmatched', 'rejected')),
  rejection_reason text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  foreign key (api_key_id, org_id)
    references public.org_api_keys(id, org_id) on delete restrict,
  foreign key (enrollment_id, org_id)
    references public.enrollments(id, org_id) on delete restrict,
  foreign key (program_id, org_id)
    references public.programs(id, org_id) on delete restrict,
  unique (id, org_id),
  constraint xapi_rejection_reason_check
    check (processing_status <> 'rejected' or rejection_reason is not null),
  constraint xapi_accepted_link_check
    check (
      processing_status <> 'accepted'
      or (
        enrollment_id is not null
        and trainee_code_received
          ~ '^AMD-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'
      )
    )
);

create table public.impact_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  enrollment_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'computed'
    check (status in ('computed', 'superseded', 'invalidated')),
  knowledge_metrics jsonb not null,
  confidence_metrics jsonb not null default '{}'::jsonb,
  live_metrics jsonb not null default '{}'::jsonb,
  completeness jsonb not null default '{}'::jsonb,
  verdict text not null check (verdict in ('passed', 'not_passed', 'pending')),
  computed_at timestamptz not null default now(),
  computed_by uuid references auth.users(id) on delete set null,
  unique (enrollment_id, version_number),
  unique (id, org_id),
  foreign key (enrollment_id, org_id)
    references public.enrollments(id, org_id) on delete restrict
);

create table public.cohort_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  cohort_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'computed'
    check (status in ('computed', 'superseded', 'invalidated')),
  sample_pre integer not null default 0 check (sample_pre >= 0),
  sample_post integer not null default 0 check (sample_post >= 0),
  sample_matched integer not null default 0 check (sample_matched >= 0),
  knowledge_metrics jsonb not null,
  confidence_metrics jsonb not null default '{}'::jsonb,
  live_metrics jsonb not null default '{}'::jsonb,
  trainee_breakdown jsonb not null default '[]'::jsonb
    check (jsonb_typeof(trainee_breakdown) = 'array'),
  warnings jsonb not null default '[]'::jsonb
    check (jsonb_typeof(warnings) = 'array'),
  computed_at timestamptz not null default now(),
  computed_by uuid references auth.users(id) on delete set null,
  unique (cohort_id, version_number),
  unique (id, org_id),
  foreign key (cohort_id, org_id)
    references public.cohorts(id, org_id) on delete restrict,
  constraint cohort_reports_samples_check
    check (sample_matched <= sample_pre and sample_matched <= sample_post)
);

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  certificate_serial bigint generated always as identity unique,
  certificate_number text not null unique,
  verify_code text not null unique
    default encode(extensions.gen_random_bytes(18), 'hex'),
  org_id uuid not null,
  enrollment_id uuid not null,
  impact_report_id uuid,
  status text not null default 'valid'
    check (status in ('valid', 'revoked', 'superseded')),
  public_snapshot jsonb not null
    check (jsonb_typeof(public_snapshot) = 'object'),
  metrics_snapshot jsonb not null
    check (jsonb_typeof(metrics_snapshot) = 'object'),
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete set null,
  revoke_reason text,
  supersedes_certificate_id uuid,
  unique (id, org_id),
  foreign key (enrollment_id, org_id)
    references public.enrollments(id, org_id) on delete restrict,
  foreign key (impact_report_id, org_id)
    references public.impact_reports(id, org_id) on delete restrict,
  foreign key (supersedes_certificate_id, org_id)
    references public.certificates(id, org_id) on delete restrict,
  constraint certificates_revocation_check
    check (
      status <> 'revoked'
      or (revoked_at is not null and revoke_reason is not null)
    )
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (length(btrim(action)) between 2 and 120),
  entity_type text not null check (length(btrim(entity_type)) between 2 and 120),
  entity_id text,
  request_id uuid,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index certificates_one_valid_per_enrollment_idx
  on public.certificates (enrollment_id)
  where status = 'valid';

create index memberships_org_role_idx
  on public.memberships (org_id, role)
  where status = 'active';
create index programs_org_status_idx
  on public.programs (org_id, status);
create index program_versions_program_status_idx
  on public.program_versions (program_id, status);
create index cohorts_org_program_status_idx
  on public.cohorts (org_id, program_id, status);
create index trainees_org_name_idx
  on public.trainees (org_id, full_name);
create index enrollments_org_trainee_status_idx
  on public.enrollments (org_id, trainee_id, status);
create index enrollments_cohort_status_idx
  on public.enrollments (cohort_id, status);
create index webhook_ingestions_status_received_idx
  on public.webhook_ingestions (status, received_at);
create index assessments_enrollment_kind_submitted_idx
  on public.assessments (enrollment_id, assessment_kind, submitted_at desc);
create index assessments_org_form_submission_idx
  on public.assessments (org_id, form_id, submission_id);
create index xapi_org_trainee_occurred_idx
  on public.xapi_statements (org_id, trainee_code_received, occurred_at desc);
create index xapi_session_occurred_idx
  on public.xapi_statements (session_id, occurred_at)
  where session_id is not null;
create index impact_reports_enrollment_computed_idx
  on public.impact_reports (enrollment_id, computed_at desc);
create index cohort_reports_cohort_computed_idx
  on public.cohort_reports (cohort_id, computed_at desc);
create index certificates_verify_status_idx
  on public.certificates (verify_code, status);
create index audit_logs_org_created_idx
  on public.audit_logs (org_id, created_at desc);
create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

create trigger membership_invitations_set_updated_at
before update on public.membership_invitations
for each row execute function public.set_updated_at();

create trigger programs_set_updated_at
before update on public.programs
for each row execute function public.set_updated_at();

create trigger program_versions_set_updated_at
before update on public.program_versions
for each row execute function public.set_updated_at();

create trigger program_versions_protect_published
before update on public.program_versions
for each row execute function public.protect_published_program_version();

create trigger jotform_forms_set_updated_at
before update on public.jotform_forms
for each row execute function public.set_updated_at();

create trigger cohorts_set_updated_at
before update on public.cohorts
for each row execute function public.set_updated_at();

create trigger trainees_set_updated_at
before update on public.trainees
for each row execute function public.set_updated_at();

create trigger enrollments_set_updated_at
before update on public.enrollments
for each row execute function public.set_updated_at();

create trigger webhook_ingestions_set_updated_at
before update on public.webhook_ingestions
for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.platform_admins enable row level security;
alter table public.membership_invitations enable row level security;
alter table public.programs enable row level security;
alter table public.program_versions enable row level security;
alter table public.jotform_forms enable row level security;
alter table public.cohorts enable row level security;
alter table public.trainees enable row level security;
alter table public.enrollments enable row level security;
alter table public.webhook_ingestions enable row level security;
alter table public.assessments enable row level security;
alter table public.org_api_keys enable row level security;
alter table public.xapi_statements enable row level security;
alter table public.impact_reports enable row level security;
alter table public.cohort_reports enable row level security;
alter table public.certificates enable row level security;
alter table public.audit_logs enable row level security;

commit;
