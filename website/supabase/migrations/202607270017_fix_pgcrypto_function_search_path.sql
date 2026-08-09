begin;

do $$
declare
  pgcrypto_schema text;
begin
  select namespace.nspname
  into pgcrypto_schema
  from pg_extension as extension
  join pg_namespace as namespace
    on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    raise exception 'The pgcrypto extension is not installed';
  end if;

  execute format(
    'alter function public.create_assessment_submission_token(uuid, text, interval) set search_path = public, %I, pg_temp',
    pgcrypto_schema
  );

  execute format(
    'alter function public.process_jotform_submission(text, text, text, timestamptz, jsonb, jsonb) set search_path = public, %I, pg_temp',
    pgcrypto_schema
  );

  execute format(
    'select %I.digest($1::text, $2::text)',
    pgcrypto_schema
  )
  using 'migration-017-probe', 'sha256';

  execute format(
    'select %I.gen_random_bytes($1)',
    pgcrypto_schema
  )
  using 1;
end;
$$;

commit;
