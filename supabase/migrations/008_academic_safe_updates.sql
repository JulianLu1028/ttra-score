-- Academic state tables contain one row, identified by singleton = true.
-- Keep the existing functions and grants, but explicitly target that row so
-- production's guarded UPDATE policy permits import, marking and publication.
begin;

do $migration$
declare
  routine regprocedure;
  definition text;
begin
  foreach routine in array array[
    'private.import_academic(jsonb)'::regprocedure,
    'private.save_academic_score(jsonb)'::regprocedure,
    'private.publish_academic(bigint,uuid)'::regprocedure
  ] loop
    definition := pg_get_functiondef(routine);
    definition := replace(definition,
      'update private.academic_state set version=version+1;',
      'update private.academic_state set version=version+1 where singleton = true;');
    definition := replace(definition,
      'update public.academic_publication set version=v+1,published_at=stamp;',
      'update public.academic_publication set version=v+1,published_at=stamp where singleton = true;');
    execute definition;
  end loop;
end;
$migration$;

commit;
