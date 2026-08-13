begin;

do $migration$
declare
  source_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.create_operational_session(uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz)'::regprocedure
  )
  into source_definition;

  if source_definition is null then
    raise exception 'create_operational_session was not found; run migration 034 first';
  end if;

  patched_definition := replace(
    source_definition,
    $find$and cohort.status in ('open', 'in_progress')$find$,
    $replace$and cohort.status in ('draft', 'open', 'in_progress')$replace$
  );
  patched_definition := replace(
    patched_definition,
    $find$and program.status = 'active'$find$,
    $replace$and program.status in ('draft', 'active')$replace$
  );

  if patched_definition = source_definition
    or position($needle$cohort.status in ('draft', 'open', 'in_progress')$needle$ in patched_definition) = 0
    or position($needle$program.status in ('draft', 'active')$needle$ in patched_definition) = 0 then
    raise exception 'Unable to patch create_operational_session eligibility';
  end if;

  execute patched_definition;

  select pg_get_functiondef(
    'public.join_public_operational_session(text, text, text)'::regprocedure
  )
  into source_definition;

  if source_definition is null then
    raise exception 'join_public_operational_session was not found; run migration 034 first';
  end if;

  patched_definition := replace(
    source_definition,
    $find$and cohort.status in ('open', 'in_progress')$find$,
    $replace$and cohort.status in ('draft', 'open', 'in_progress')$replace$
  );

  if patched_definition = source_definition
    or position($needle$cohort.status in ('draft', 'open', 'in_progress')$needle$ in patched_definition) = 0 then
    raise exception 'Unable to patch join_public_operational_session eligibility';
  end if;

  execute patched_definition;
end;
$migration$;

comment on function public.create_operational_session(
  uuid, uuid, uuid, text, text, timestamptz, boolean, text, timestamptz
) is 'Creates an audited operational session for a non-archived draft or active program/cohort; repeated sessions are allowed.';

comment on function public.join_public_operational_session(text, text, text) is
  'Verifies identity and active enrollment for an open operational session, including pilot cohorts that remain in draft.';

commit;
