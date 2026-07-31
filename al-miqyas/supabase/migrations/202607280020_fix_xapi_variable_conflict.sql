begin;

do $migration$
declare
  source_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.process_xapi_statements(text, uuid, jsonb)'::regprocedure
  )
  into source_definition;

  if source_definition is null then
    raise exception
      'process_xapi_statements function was not found; run migration 019 first';
  end if;

  if position(
    '#variable_conflict use_variable' in source_definition
  ) > 0 then
    return;
  end if;

  patched_definition := replace(
    source_definition,
    E'AS $function$\n',
    E'AS $function$\n#variable_conflict use_variable\n'
  );

  if patched_definition = source_definition then
    raise exception
      'Unable to patch process_xapi_statements function definition';
  end if;

  execute patched_definition;
end;
$migration$;

commit;
