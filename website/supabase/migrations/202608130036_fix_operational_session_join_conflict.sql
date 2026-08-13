begin;

-- The returned table columns of the function become PL/pgSQL variables.
-- Referencing session_id in an ON CONFLICT column list was therefore ambiguous
-- at runtime. Use the physical unique constraint name instead.
do $migration$
declare
  source_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.join_public_operational_session(text, text, text)'::regprocedure
  )
  into source_definition;

  if source_definition is null then
    raise exception 'join_public_operational_session was not found; run migration 034 first';
  end if;

  patched_definition := replace(
    source_definition,
    $find$on conflict (session_id, enrollment_id) do nothing$find$,
    $replace$on conflict on constraint operational_session_attendances_session_id_enrollment_id_key do nothing$replace$
  );

  if patched_definition = source_definition
    or position(
      $needle$on conflict on constraint operational_session_attendances_session_id_enrollment_id_key do nothing$needle$
      in patched_definition
    ) = 0 then
    raise exception 'Unable to patch join_public_operational_session conflict target';
  end if;

  execute patched_definition;
end;
$migration$;

comment on function public.join_public_operational_session(text, text, text) is
  'Verifies identity and an active enrollment, then records exactly one attendance per operational session.';

commit;
