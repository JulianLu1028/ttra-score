-- Retain measurements for unsuccessful attempts, without counting them as
-- valid results. Existing attempts/audit history are not rewritten.
begin;
create or replace function private.normalize_score(c text,s text,d jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb; failure text; allowed text[];
begin
 if s is null or s not in ('valid','invalid') then raise exception '不再提供提前終止，請選擇完成或未完成';end if;
 if jsonb_typeof(d) is distinct from 'object' then raise exception '成績資料格式不正確';end if;
 if s='invalid' then
  if c='preschool' then raise exception '幼兒組請直接記錄進球數';end if;
  allowed=case when c in ('power','program') then array['超過邊界','車體鬆脫'] when c='creative' then array['車體掉出場地','零件脫落','翻覆'] else '{}'::text[] end;
  failure=d->>'failureReason';
  if failure is null or not(failure=any(allowed)) then raise exception '請選擇此組別的未完成原因';end if;
 end if;
 case c
 when 'preschool' then v=jsonb_build_object('childGoals',private.num(d,'childGoals',0,4,true),'parentGoals',private.num(d,'parentGoals',0,2,true));
 when 'power' then v=jsonb_build_object('bottles',private.num(d,'bottles',0,999,true));
 when 'program' then
  if s='valid' and d->>'completed' is distinct from '1' then raise exception '必須完成自主折返';end if;
  v=jsonb_build_object('completed',case when s='valid' then 1 else 0 end,'weight',round(private.num(d,'weight',0.1,100000),1));
 when 'creative' then
  if coalesce(d->>'red','') not in ('none','correct','wrong') or coalesce(d->>'blue','') not in ('none','correct','wrong') then raise exception '特殊瓶結果不正確';end if;
  v=jsonb_build_object('regular',private.num(d,'regular',0,8,true),'red',d->>'red','blue',d->>'blue');
 else raise exception '組別不正確';
 end case;
 if c<>'preschool' then
  if s='valid' then
   v=v||jsonb_build_object('seconds',round(private.num(d,'seconds',case when c='creative' then 0 else 0.1 end,case when c='power' then 30 else 40 end),1));
  elsif d ? 'seconds' and d->'seconds'<>'null'::jsonb and d->>'seconds'<>'' then
   v=v||jsonb_build_object('seconds',round(private.num(d,'seconds',0,9007199254740991),1));
  end if;
 end if;
 if s='invalid' then v=v||jsonb_build_object('failureReason',failure);end if;
 return v;
end;$$;

create or replace view public.results with (security_invoker=true) as
with raw as (
 select a.*,
  coalesce((score_data->>'seconds')::numeric,0) seconds,
  coalesce((score_data->>'weight')::numeric,0) weight,
  coalesce((score_data->>'bottles')::numeric,0) bottles,
  case category_id
   when 'preschool' then coalesce((score_data->>'childGoals')::numeric,0)+coalesce((score_data->>'parentGoals')::numeric,0)
   when 'creative' then coalesce((score_data->>'regular')::numeric,0)*10+case score_data->>'red' when 'correct' then 20 when 'wrong' then 5 else 0 end+case score_data->>'blue' when 'correct' then 20 when 'wrong' then 5 else 0 end
  end score
 from public.attempts a where status='valid'
), best as (
 select distinct on(team_id) * from raw where category_id<>'power'
 order by team_id,case when category_id='program' then seconds else -score end,
 case when category_id='program' then weight else seconds end
), power_best as (
 select distinct on(team_id,split_part(slot_key,'-',1)) * from raw where category_id='power'
 order by team_id,split_part(slot_key,'-',1),bottles desc,seconds
), power_totals as (
 select team_id,
  case when count(*)=2 then sum(bottles) end primary_score,
  case when count(*)=2 then sum(seconds) end secondary_score,
  count(*)=2 and bool_or(bottles>=7) qualified
 from power_best group by team_id
), combined as (
 select t.id team_id,t.category_id,t.heat,
 case when t.category_id='power' then p.primary_score when t.category_id='program' then b.seconds else b.score end primary_score,
 case when t.category_id='power' then p.secondary_score when t.category_id='program' then b.weight when t.category_id='creative' then b.seconds end secondary_score,
 coalesce(case t.category_id when 'power' then p.qualified when 'preschool' then b.score>=3 when 'program' then b.seconds<=20 when 'creative' then b.score>=50 end,false) qualified,
 (select count(*) from public.attempts a where a.team_id=t.id)>=case when t.category_id='power' then 4 else 2 end complete
 from public.teams t left join best b on b.team_id=t.id left join power_totals p on p.team_id=t.id
)
select team_id,category_id,primary_score,secondary_score,qualified,complete,
 case when category_id='preschool' or primary_score is null then null else rank() over (
 partition by category_id,heat
 order by case when category_id='program' then primary_score else -primary_score end nulls last,secondary_score nulls last
 ) end rank
from combined;
update public.event_state set version=version+1 where singleton = true;
commit;
