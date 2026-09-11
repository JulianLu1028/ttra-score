-- Keep exact published grades and full names available only through the
-- authorized staff workspace. Public callers receive a masked pass/fail snapshot.
begin;

create or replace function public.get_academic_results()
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
   'version', p.version,
   'publishedAt', p.published_at,
   'results', coalesce((
     select jsonb_agg(jsonb_build_object(
       'id', r.id,
       'number', r.number,
       'name', case when char_length(btrim(r.name)) < 2 then btrim(r.name)
         else left(btrim(r.name), 1) || 'o' || substr(btrim(r.name), 3) end,
       'passed', r.score >= 80,
       'published_at', r.published_at
     ) order by r.number)
     from public.academic_results r
   ), '[]'::jsonb)
 ) from public.academic_publication p where p.singleton = true
$$;

revoke all on public.academic_results from public, anon, authenticated;
drop policy if exists public_academic_results on public.academic_results;
revoke all on function public.get_academic_results() from public, anon, authenticated;
grant execute on function public.get_academic_results() to anon, authenticated;

commit;
