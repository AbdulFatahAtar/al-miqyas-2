begin;

create or replace function public.assign_certificate_identity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  program_prefix text;
  trainee_code_suffix text;
  candidate_certificate_number text;
  candidate_verify_code text;
begin
  select
    program.certificate_prefix,
    regexp_replace(upper(trainee.code), '^AMD-', '')
  into
    program_prefix,
    trainee_code_suffix
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
  where enrollment.id = new.enrollment_id
    and enrollment.org_id = new.org_id;

  if program_prefix is null or trainee_code_suffix is null then
    raise exception 'Certificate program or trainee could not be resolved';
  end if;

  new.issued_at := coalesce(new.issued_at, now());

  if new.certificate_serial is null then
    raise exception 'Certificate serial was not generated';
  end if;

  loop
    candidate_certificate_number := format(
      'AMD-%s-%s-%s-%s',
      program_prefix,
      extract(year from new.issued_at)::integer,
      trainee_code_suffix,
      upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 5))
    );

    exit when not exists (
      select 1
      from public.certificates as certificate
      where certificate.certificate_number =
        candidate_certificate_number
    );
  end loop;

  new.certificate_number := candidate_certificate_number;

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

revoke all on function public.assign_certificate_identity()
  from public;
revoke all on function public.assign_certificate_identity()
  from anon;
revoke all on function public.assign_certificate_identity()
  from authenticated;

commit;
