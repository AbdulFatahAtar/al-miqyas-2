begin;

do $migration$
declare
  source_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.create_assessment_submission_token(uuid, text, interval)'::regprocedure
  )
  into source_definition;

  if source_definition is null then
    raise exception
      'create_assessment_submission_token was not found; run migration 015 first';
  end if;

  patched_definition := replace(
    source_definition,
    $find$and cohort.status in ('open', 'in_progress')$find$,
    $replace$and cohort.status in ('draft', 'open', 'in_progress')$replace$
  );

  if patched_definition = source_definition
    or position(
      $needle$cohort.status in ('draft', 'open', 'in_progress')$needle$
      in patched_definition
    ) = 0 then
    raise exception
      'Unable to patch assessment token eligibility for pilot draft cohorts';
  end if;

  execute patched_definition;
end;
$migration$;

comment on function public.create_assessment_submission_token(uuid, text, interval) is
  'Creates a short-lived one-time assessment token for an eligible enrollment, including pilot cohorts that remain in draft.';

commit;
