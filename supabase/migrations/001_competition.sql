-- TTRA 2026 fixed-event schema. Apply to a NEW Supabase project.
begin;
create schema if not exists private;
create table private.staff_roles(
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','judge','checkin')),
 category_ids text[] not null default '{}' check(category_ids <@ array['preschool','power','program','creative']::text[])
);
create table public.teams(
 id uuid primary key default gen_random_uuid(),
 team_number text not null unique check(length(team_number) between 1 and 32),
 name text not null check(length(name) between 1 and 100),
 organization text not null default '' check(length(organization)<=100),
 category_id text not null check(category_id in ('preschool','power','program','creative')),
 checkin_status text not null default 'pending' check(checkin_status in ('pending','checked_in','absent','withdrawn')),
 created_at timestamptz not null default now(),
 unique(id,category_id)
);
create table public.attempts(
 id uuid primary key default gen_random_uuid(),
 team_id uuid not null,
 category_id text not null,
 slot_key text not null,
 attempt_no integer not null check(attempt_no between 1 and 4),
 status text not null check(status in ('valid','invalid','terminated')),
 score_data jsonb not null,
 revision integer not null default 1,
 submitted_at timestamptz not null default now(),
 unique(team_id,slot_key),
 foreign key(team_id,category_id) references public.teams(id,category_id)
);
create index attempts_team on public.attempts(team_id);
create table public.event_state(singleton boolean primary key default true check(singleton),version bigint not null default 0);
insert into public.event_state(singleton) values(true);
alter table public.event_state enable row level security;
revoke all on public.event_state from anon,authenticated;
grant select on public.event_state to anon,authenticated;
create policy public_event_state on public.event_state for select to anon,authenticated using(true);
create function private.touch_event() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.event_state set version=version+1 where singleton;return null;end;$$;
create trigger teams_changed after insert or update or delete on public.teams for each statement execute function private.touch_event();
create trigger attempts_changed after insert or update or delete on public.attempts for each statement execute function private.touch_event();
create table private.audit_log(
 id bigint generated always as identity primary key,
 team_id uuid references public.teams(id),
 action text not null, actor_id uuid not null, reason text not null default '',
 old_value jsonb, new_value jsonb, created_at timestamptz not null default now()
);
create table private.requests(
 id uuid primary key, actor_id uuid not null, payload jsonb not null,
 result jsonb not null, created_at timestamptz not null default now()
);
alter table public.teams enable row level security;
alter table public.attempts enable row level security;
alter table private.staff_roles enable row level security;
alter table private.audit_log enable row level security;
alter table private.requests enable row level security;
revoke all on public.teams,public.attempts from anon,authenticated;
grant select on public.teams,public.attempts to anon,authenticated;
create policy public_teams on public.teams for select to anon,authenticated using(true);
create policy public_attempts on public.attempts for select to anon,authenticated using(true);
revoke all on all tables in schema private from public,anon,authenticated;
grant usage on schema private to authenticated;

create function private.require_staff(p_roles text[],p_category text default null)
returns text language plpgsql security definer set search_path='' as $$
declare s private.staff_roles;
begin
 select * into s from private.staff_roles where user_id=auth.uid();
 if s.user_id is null or not(s.role=any(p_roles)) then raise exception '沒有操作權限' using errcode='42501';end if;
 if p_category is not null and s.role<>'admin' and cardinality(s.category_ids)>0 and not(p_category=any(s.category_ids)) then raise exception '沒有此組別的操作權限' using errcode='42501';end if;
 return s.role;
end;$$;
create function private.my_staff_role()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',role,'category_ids',category_ids) from private.staff_roles where user_id=auth.uid()
$$;
create function public.my_staff_role()
returns jsonb language sql stable security invoker set search_path='' as $$select private.my_staff_role()$$;

create function private.num(d jsonb,k text,lo numeric,hi numeric,whole boolean default false)
returns numeric language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
 if jsonb_typeof(d->k) is distinct from 'number' then raise exception '欄位 % 必須為數字',k;end if;
 v=(d->>k)::numeric;
 if v<lo or v>hi or (whole and v<>trunc(v)) then raise exception '欄位 % 超出有效範圍',k;end if;
 return v;
end;$$;
create function private.normalize_score(c text,s text,d jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb;
begin
 if s='invalid' then return '{}'::jsonb;end if;
 if s not in ('valid','terminated') or (s='terminated' and c<>'creative') then raise exception '回合狀態不正確';end if;
 case c
 when 'preschool' then v=jsonb_build_object('childGoals',private.num(d,'childGoals',0,4,true),'parentGoals',private.num(d,'parentGoals',0,2,true));
 when 'power' then v=jsonb_build_object('bottles',private.num(d,'bottles',0,999,true),'seconds',round(private.num(d,'seconds',0.1,30),1));
 when 'program' then
  if d->>'completed' is distinct from '1' then raise exception '必須完成自主折返';end if;
  v=jsonb_build_object('completed',1,'seconds',round(private.num(d,'seconds',0.1,40),1),'weight',round(private.num(d,'weight',0.1,100000),1));
 when 'creative' then
  if coalesce(d->>'red','') not in ('none','correct','wrong') or coalesce(d->>'blue','') not in ('none','correct','wrong') then raise exception '特殊瓶結果不正確';end if;
  v=jsonb_build_object('regular',private.num(d,'regular',0,8,true),'seconds',round(private.num(d,'seconds',0,30),1),'red',d->>'red','blue',d->>'blue');
 else raise exception '組別不正確';
 end case;
 return v;
end;$$;

create function private.submit_attempt(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 t public.teams; old public.attempts; saved public.attempts; receipt private.requests;
 req uuid=(p_input->>'request_id')::uuid;
 expected integer=(p_input->>'expected_revision')::integer;
 slot text=p_input->>'slot_key'; s text=p_input->>'status'; reason text=btrim(coalesce(p_input->>'reason',''));
 clean jsonb; no integer; weight numeric;
begin
 if auth.uid() is null then raise exception '請先登入' using errcode='42501';end if;
 if req is null or expected is null or expected<0 then raise exception '缺少送出識別碼或版本';end if;
 -- Serialize identical requests as well as all submissions for a team.
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select * into receipt from private.requests where id=req;
 if receipt.id is not null then
  if receipt.actor_id<>auth.uid() or receipt.payload<>p_input then raise exception '送出識別碼已用於其他內容';end if;
  perform private.require_staff(array['admin','judge'],p_input->>'category_id');
  return receipt.result;
 end if;
 select * into t from public.teams where id=(p_input->>'team_id')::uuid for update;
 if t.id is null then raise exception '參賽者不存在';end if;
 perform private.require_staff(array['admin','judge'],t.category_id);
 if t.checkin_status<>'checked_in' then raise exception '參賽者尚未報到或已取消參賽';end if;
 if p_input->>'category_id' is distinct from t.category_id then raise exception '參賽者與組別不符';end if;
 if t.category_id='power' then no=array_position(array['pull-1','pull-2','push-1','push-2'],slot);
 elsif t.category_id='creative' then no=array_position(array['left','right'],slot);
 else no=array_position(array['round-1','round-2'],slot);end if;
 if no is null then raise exception '回合不正確';end if;
 select * into old from public.attempts where team_id=t.id and slot_key=slot;
 if coalesce(old.revision,0)<>expected then raise exception '此回合已被更新，請重新選取回合並檢查最新成績';end if;
 if (old.id is not null or s<>'valid') and reason='' then raise exception '請填寫修改或無效原因';end if;
 if length(reason)>1000 then raise exception '原因過長';end if;
 clean=private.normalize_score(t.category_id,s,p_input->'score_data');
 if t.category_id='program' and s='valid' then
  select (a.score_data->>'weight')::numeric into weight from public.attempts a where a.team_id=t.id and a.slot_key<>slot and a.status='valid' limit 1;
  if weight is not null and weight<>(clean->>'weight')::numeric then raise exception '車頭淨重須與另一回合一致；請先核對原始量測';end if;
 end if;
 insert into public.attempts(team_id,category_id,slot_key,attempt_no,status,score_data,revision,submitted_at)
 values(t.id,t.category_id,slot,no,s,clean,expected+1,clock_timestamp())
 on conflict(team_id,slot_key) do update set status=excluded.status,score_data=excluded.score_data,revision=excluded.revision,submitted_at=excluded.submitted_at
 returning * into saved;
 insert into private.audit_log(team_id,action,actor_id,reason,old_value,new_value)
 values(t.id,case when old.id is null then 'score_create' else 'score_update' end,auth.uid(),reason,case when old.id is null then null else to_jsonb(old) end,to_jsonb(saved));
 insert into private.requests(id,actor_id,payload,result) values(req,auth.uid(),p_input,to_jsonb(saved));
 return to_jsonb(saved);
end;$$;
create function public.submit_attempt(p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$select private.submit_attempt(p_input)$$;

create function private.set_checkin(p_team_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.teams;
begin
 select * into t from public.teams where id=p_team_id for update;
 if t.id is null then raise exception '參賽者不存在';end if;
 perform private.require_staff(array['admin','checkin'],t.category_id);
 if p_status not in ('pending','checked_in','absent','withdrawn') or p_status is null then raise exception '報到狀態不正確';end if;
 if t.checkin_status=p_status then return;end if;
 if exists(select 1 from public.attempts where team_id=t.id) and p_status<>'checked_in' then raise exception '已有成績，不可取消報到；請由主辦人先處理成績';end if;
 update public.teams set checkin_status=p_status where id=t.id;
 insert into private.audit_log(team_id,action,actor_id,old_value,new_value)
 values(t.id,'checkin_update',auth.uid(),jsonb_build_object('status',t.checkin_status),jsonb_build_object('status',p_status));
end;$$;
create function public.set_checkin(p_team_id uuid,p_status text)
returns void language sql security invoker set search_path='' as $$select private.set_checkin(p_team_id,p_status)$$;

create function private.import_teams(p_rows jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare row jsonb;t public.teams;n integer=0;
begin
 perform private.require_staff(array['admin']);
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception '每次匯入 1–500 人';end if;
 for row in select * from jsonb_array_elements(p_rows) loop
  insert into public.teams(team_number,name,organization,category_id)
  values(btrim(row->>'team_number'),btrim(row->>'name'),btrim(coalesce(row->>'organization','')),row->>'category_id') returning * into t;
  insert into private.audit_log(team_id,action,actor_id,new_value) values(t.id,'team_import',auth.uid(),to_jsonb(t));
  n=n+1;
 end loop;
 return n;
end;$$;
create function public.import_teams(p_rows jsonb)
returns integer language sql security invoker set search_path='' as $$select private.import_teams(p_rows)$$;

create function private.read_audit()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_staff(array['admin']);
 select coalesce(jsonb_agg(x),'[]'::jsonb) into result from(select a.*,t.team_number from private.audit_log a left join public.teams t on t.id=a.team_id order by a.id desc limit 200)x;
 return result;
end;$$;
create function public.read_audit()
returns jsonb language sql stable security invoker set search_path='' as $$select private.read_audit()$$;

-- Authoritative ranking, computed from validated and normalized attempts.
create view public.results with(security_invoker=true) as
with raw as (
 select a.*,coalesce((score_data->>'seconds')::numeric,0) seconds,
 coalesce((score_data->>'weight')::numeric,0) weight,
 coalesce((score_data->>'bottles')::numeric,0) bottles,
 case category_id
 when 'preschool' then coalesce((score_data->>'childGoals')::numeric,0)+coalesce((score_data->>'parentGoals')::numeric,0)
 when 'creative' then coalesce((score_data->>'regular')::numeric,0)*10+case score_data->>'red' when 'correct' then 20 when 'wrong' then 5 else 0 end+case score_data->>'blue' when 'correct' then 20 when 'wrong' then 5 else 0 end
 end score
 from public.attempts a where status<>'invalid'
), best as (
 select distinct on(team_id) * from raw where category_id<>'power'
 order by team_id,case when category_id='program' then seconds else -score end,case when category_id='program' then weight else seconds end
), power_best as (
 select distinct on(team_id,split_part(slot_key,'-',1)) * from raw where category_id='power'
 order by team_id,split_part(slot_key,'-',1),bottles desc,seconds
), power_totals as (
 select team_id,case when count(*)=2 then sum(bottles) end primary_score,case when count(*)=2 then sum(seconds) end secondary_score,bool_or(bottles>=7) qualified from power_best group by team_id
), combined as (
 select t.id team_id,t.category_id,
 case when t.category_id='power' then p.primary_score when t.category_id='program' then b.seconds else b.score end primary_score,
 case when t.category_id='power' then p.secondary_score when t.category_id='program' then b.weight when t.category_id='creative' then b.seconds end secondary_score,
 coalesce(case t.category_id when 'power' then p.qualified when 'preschool' then b.score>=3 when 'program' then b.seconds<=20 when 'creative' then b.score>=50 end,false) qualified,
 (select count(*) from public.attempts a where a.team_id=t.id)>=case when t.category_id='power' then 4 else 2 end complete
 from public.teams t left join best b on b.team_id=t.id left join power_totals p on p.team_id=t.id
)
select *,case when category_id='preschool' or primary_score is null then null else rank()over(partition by category_id order by case when category_id='program' then primary_score else -primary_score end nulls last,secondary_score nulls last) end rank from combined;
grant select on public.results to anon,authenticated;
create function public.get_scoreboard(p_version bigint default -1)
returns jsonb language sql stable security invoker set search_path='' as $$
select case when version=p_version then jsonb_build_object('version',version,'unchanged',true) else
jsonb_build_object('version',version,'teams',coalesce((select jsonb_agg(t order by t.team_number)from public.teams t),'[]'::jsonb),'attempts',coalesce((select jsonb_agg(a)from public.attempts a),'[]'::jsonb),'results',coalesce((select jsonb_agg(r)from public.results r),'[]'::jsonb)) end from public.event_state
$$;

revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.my_staff_role(),public.submit_attempt(jsonb),public.set_checkin(uuid,text),public.import_teams(jsonb),public.read_audit(),public.get_scoreboard(bigint) from public,anon,authenticated;
grant execute on function private.my_staff_role(),private.submit_attempt(jsonb),private.set_checkin(uuid,text),private.import_teams(jsonb),private.read_audit() to authenticated;
grant execute on function public.my_staff_role(),public.submit_attempt(jsonb),public.set_checkin(uuid,text),public.import_teams(jsonb),public.read_audit() to authenticated;
grant execute on function public.get_scoreboard(bigint) to anon,authenticated;
-- All public tables contain ONLY public information. Internal reasons/identities are private.
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.event_state;
 end if;
end$$;
commit;
