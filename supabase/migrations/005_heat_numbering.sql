-- Encode both category and heat in participant numbers, for example 幼A001.
begin;

alter table public.teams drop constraint teams_number_format;
alter table public.teams drop constraint teams_number_category;

-- Preserve any roster imported under the previous A001/B001/C001/D001 scheme.
update public.teams
set team_number =
  case category_id
    when 'preschool' then '幼'
    when 'power' then '動'
    when 'program' then '程'
    when 'creative' then '機'
  end || chr(64 + heat) || right(team_number, 3)
where team_number ~ '^[A-D][0-9]{3}$';

alter table public.teams add constraint teams_number_format
  check (
    team_number ~ '^(幼|動|程|機)[A-C][0-9]{3}$'
    and right(team_number, 3) <> '000'
  );

alter table public.teams add constraint teams_number_category
  check (
    left(team_number, 1) = case category_id
      when 'preschool' then '幼'
      when 'power' then '動'
      when 'program' then '程'
      when 'creative' then '機'
    end
  );

alter table public.teams add constraint teams_number_heat
  check (substring(team_number from 2 for 1) = chr(64 + heat));

commit;
