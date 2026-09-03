-- Enforce the event's category-prefixed participant numbering scheme.
begin;
alter table public.teams add constraint teams_number_format
  check (team_number ~ '^[A-D][0-9]{3}$');
alter table public.teams add constraint teams_number_category
  check (left(team_number,1)=case category_id
    when 'preschool' then 'A'
    when 'power' then 'B'
    when 'program' then 'C'
    when 'creative' then 'D'
  end);
commit;
