-- Apply after 001. Existing entries are provisionally assigned to heat 1;
-- the organizer must check these assignments before the competition.
begin;
alter table public.teams add column heat integer not null default 1
  check (heat between 1 and case when category_id='program' then 3 else 2 end);
alter table public.teams alter column heat drop default;
alter table public.teams drop column organization;
-- Remove the retired field from historical imported roster snapshots as well.
update private.audit_log set old_value=old_value-'organization',new_value=new_value-'organization';
create or replace function private.import_teams(p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare row jsonb;t public.teams;n integer=0;h integer;
begin
 perform private.require_staff(array['admin']);
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception '名單格式不正確';end if;
 if jsonb_array_length(p_rows) not between 1 and 500 then raise exception '每次匯入 1–500 人';end if;
 for row in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row) is distinct from 'object' then raise exception '名單格式不正確';end if;
  if row-array['team_number','name','category_id','heat'] <> '{}'::jsonb then raise exception '名單包含不接受的欄位';end if;
  h=private.num(row,'heat',1,case when row->>'category_id'='program' then 3 else 2 end,true);
  insert into public.teams(team_number,name,category_id,heat)
  values(btrim(row->>'team_number'),btrim(row->>'name'),row->>'category_id',h) returning * into t;
  insert into private.audit_log(team_id,action,actor_id,new_value) values(t.id,'participant_import',auth.uid(),to_jsonb(t));
  n=n+1;
 end loop;
 return n;
end;$$;
create or replace function private.normalize_score(c text,s text,d jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb;
begin
 if s='invalid' then return '{}'::jsonb;end if;
 if s is null or s not in ('valid','terminated') or (s='terminated' and c<>'creative') then raise exception '回合狀態不正確';end if;
 case c
 when 'preschool' then v=jsonb_build_object('childGoals',private.num(d,'childGoals',0,4,true),'parentGoals',private.num(d,'parentGoals',0,2,true));
 when 'power' then v=jsonb_build_object('bottles',private.num(d,'bottles',0,999,true),'seconds',round(private.num(d,'seconds',0.1,30),1));
 when 'program' then
  if d->>'completed' is distinct from '1' then raise exception '必須完成自主折返';end if;
  v=jsonb_build_object('completed',1,'seconds',round(private.num(d,'seconds',0.1,40),1),'weight',round(private.num(d,'weight',0.1,100000),1));
 when 'creative' then
  if coalesce(d->>'red','') not in ('none','correct','wrong') or coalesce(d->>'blue','') not in ('none','correct','wrong') then raise exception '特殊瓶結果不正確';end if;
  v=jsonb_build_object('regular',private.num(d,'regular',0,8,true),'seconds',round(private.num(d,'seconds',0,40),1),'red',d->>'red','blue',d->>'blue');
 else raise exception '組別不正確';
 end case;
 return v;
end;$$;
update public.event_state set version=version+1;
commit;
