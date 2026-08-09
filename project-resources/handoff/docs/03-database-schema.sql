-- ============================================================
-- Al-Miqyas — Database schema (Supabase / Postgres)
-- منظومة المقياس — شركة الأمد التقنية
-- Run as a single migration. RLS enforced from day one.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- 1. Tenancy ----------

create table organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,              -- e.g. 'uqu-medicine'
  name_ar      text not null,
  name_en      text,
  logo_url     text,
  brand_color  text default '#C9A24B',            -- hex, tenant accent
  is_active    boolean default true,
  created_at   timestamptz default now()
);

create table memberships (
  user_id    uuid references auth.users(id) on delete cascade,
  org_id     uuid references organizations(id) on delete cascade,
  role       text not null check (role in ('owner','trainer','viewer','platform_admin')),
  created_at timestamptz default now(),
  primary key (user_id, org_id)
);

-- helper: orgs current user belongs to
create or replace function user_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from memberships where user_id = auth.uid()
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships
                 where user_id = auth.uid() and role = 'platform_admin')
$$;

-- ---------- 2. Programs & trainees ----------

create table programs (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id),
  title_ar         text not null,                 -- e.g. 'نبض الأمد — BLS Provider'
  pass_threshold   numeric not null default 80,   -- % knowledge pass line
  jotform_pre_id   text,                          -- e.g. '261781032160044'
  jotform_post_id  text,                          -- e.g. '261781060293052'
  answer_key       jsonb,                         -- {questionKey: correctAnswer}
  is_active        boolean default true,
  created_at       timestamptz default now()
);

create table trainees (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id),
  code        text unique not null,               -- 'AMD-7K9FQ' — THE unified ID
  full_name   text not null,
  phone       text,
  email       text,
  created_at  timestamptz default now()
);
create index on trainees (org_id);
create index on trainees (code);

-- ---------- 3. Assessments (Jotform ingestion) ----------

create table assessments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id),
  program_id     uuid not null references programs(id),
  trainee_id     uuid references trainees(id),    -- resolved from code; nullable until matched
  trainee_code   text not null,                   -- as received (must equal trainees.code)
  kind           text not null check (kind in ('pre','post')),
  submission_id  text unique not null,            -- Jotform submission id → idempotency
  score          numeric,                         -- correct answers
  max_score      numeric,
  confidence     jsonb,                           -- self-efficacy items {item: 1..5}
  items          jsonb,                           -- raw graded answers
  submitted_at   timestamptz,
  created_at     timestamptz default now()
);
create index on assessments (org_id, program_id, kind);
create index on assessments (trainee_code);

-- ---------- 4. Live performance (xAPI subset) ----------

create table xapi_statements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id),
  trainee_code  text not null,                    -- actor.account.name = AMD-XXXXX
  program_id    uuid references programs(id),
  session_id    text,                             -- one XR session grouping
  verb          text not null,                    -- e.g. 'completed','adjusted'
  object        text not null,                    -- e.g. 'chest-compressions'
  result        jsonb,                            -- {success, score, extensions...}
  occurred_at   timestamptz not null,
  raw           jsonb,                            -- full original statement
  created_at    timestamptz default now()
);
create index on xapi_statements (org_id, trainee_code, occurred_at);
create index on xapi_statements (session_id);

create table org_api_keys (                       -- dashboard → /api/xapi auth
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id),
  key_hash   text not null,                       -- store hash, never plaintext
  label      text,
  is_active  boolean default true,
  created_at timestamptz default now()
);

-- ---------- 5. Impact & certification ----------

create table impact_reports (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id),
  program_id   uuid not null references programs(id),
  trainee_id   uuid not null references trainees(id),
  metrics      jsonb not null,
  -- metrics shape:
  -- { knowledge: {pre, post, delta_pp},
  --   confidence: {pre_avg, post_avg, delta},
  --   live: {sessions, accuracy, in_range_pct, key_events},
  --   verdict: 'passed' | 'not_passed' }
  computed_at  timestamptz default now(),
  unique (program_id, trainee_id)
);

create table certificates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id),
  program_id   uuid not null references programs(id),
  trainee_id   uuid not null references trainees(id),
  verify_code  text unique not null,              -- e.g. 'AMD-BLS-2026-0417'
  metrics      jsonb not null,                    -- snapshot at issuance
  status       text not null default 'valid' check (status in ('valid','revoked')),
  issued_at    timestamptz default now()
);
create index on certificates (verify_code);

-- ---------- 6. Row Level Security ----------

alter table organizations   enable row level security;
alter table memberships     enable row level security;
alter table programs        enable row level security;
alter table trainees        enable row level security;
alter table assessments     enable row level security;
alter table xapi_statements enable row level security;
alter table org_api_keys    enable row level security;
alter table impact_reports  enable row level security;
alter table certificates    enable row level security;

-- read own orgs (or platform admin reads all)
create policy org_read on organizations for select
  using (id in (select user_org_ids()) or is_platform_admin());

create policy membership_read on memberships for select
  using (user_id = auth.uid() or is_platform_admin());

-- generic tenant policies (repeat pattern per table)
create policy programs_rw on programs for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

create policy trainees_rw on trainees for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

create policy assessments_rw on assessments for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

create policy xapi_rw on xapi_statements for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

create policy keys_rw on org_api_keys for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

create policy impact_rw on impact_reports for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

create policy certs_rw on certificates for all
  using (org_id in (select user_org_ids()) or is_platform_admin())
  with check (org_id in (select user_org_ids()) or is_platform_admin());

-- public verification: read-only via security-definer RPC (no table exposure)
create or replace function verify_certificate(p_code text)
returns table (trainee_name text, program_title text, org_name text,
               status text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.full_name, p.title_ar, o.name_ar, c.status, c.issued_at
  from certificates c
  join trainees t on t.id = c.trainee_id
  join programs p on p.id = c.program_id
  join organizations o on o.id = c.org_id
  where c.verify_code = p_code
$$;

-- ---------- 7. Unified ID generation ----------
-- Safe alphabet: no O/0, no I/1. Capacity 32^5 > 33M.
create or replace function generate_trainee_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := 'AMD-';
    for i in 1..5 loop
      code := code || substr(alphabet, 1 + floor(random()*32)::int, 1);
    end loop;
    exit when not exists (select 1 from trainees where trainees.code = code);
  end loop;
  return code;
end $$;
