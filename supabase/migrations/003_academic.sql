-- Private marking workspace and atomic, explicitly published public snapshots.
begin;
alter table private.staff_roles add column can_grade_academic boolean not null default false;
create or replace function private.my_staff_role()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('role',role,'category_ids',category_ids,'can_grade_academic',can_grade_academic or role='admin')
 from private.staff_roles where user_id=auth.uid()
$$;
create table private.academic_candidates(
 id uuid primary key default gen_random_uuid(),
 number text not null unique check(length(btrim(number)) between 1 and 32),
 name text not null check(length(btrim(name)) between 1 and 100),
 score numeric check(score between 0 and 100),
 revision integer not null default 0,
 updated_at timestamptz not null default now()
);
create table private.academic_state(singleton boolean primary key default true check(singleton),version bigint not null default 0);
insert into private.academic_state(singleton) values(true);
create table private.academic_audit(
 id bigint generated always as identity primary key,
 candidate_id uuid references private.academic_candidates(id),
 action text not null, actor_id uuid not null, reason text not null default '',
 old_value jsonb,new_value jsonb,created_at timestamptz not null default now()
);
create table public.academic_results(
 id uuid primary key,number text not null unique,name text not null,
 score numeric not null check(score between 0 and 100),
 published_at timestamptz not null
);
create table public.academic_publication(
 singleton boolean primary key default true check(singleton),version bigint not null default 0,published_at timestamptz
);
insert into public.academic_publication(singleton) values(true);
alter table private.academic_candidates enable row level security;
alter table private.academic_state enable row level security;
alter table private.academic_audit enable row level security;
alter table public.academic_results enable row level security;
alter table public.academic_publication enable row level security;
revoke all on private.academic_candidates,private.academic_state,private.academic_audit from public,anon,authenticated;
revoke all on public.academic_results,public.academic_publication from public,anon,authenticated;
grant select on public.academic_results,public.academic_publication to anon,authenticated;
create policy public_academic_results on public.academic_results for select to anon,authenticated using(true);
create policy public_academic_publication on public.academic_publication for select to anon,authenticated using(true);
create trigger academic_published after update on public.academic_publication for each statement execute function private.touch_event();

create function private.require_academic() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from private.staff_roles where user_id=auth.uid() and (role='admin' or (role='judge' and can_grade_academic)))
 then raise exception '沒有學科成績操作權限' using errcode='42501';end if;
end;$$;
create function private.get_academic_workspace() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_academic();
 select jsonb_build_object('version',s.version,'publishedAt',p.published_at,
 'candidates',coalesce((select jsonb_agg(x order by x.number) from (
 select c.*,r.score published_score from private.academic_candidates c left join public.academic_results r on r.id=c.id)x),'[]'::jsonb),
 'audit',coalesce((select jsonb_agg(x) from(select a.*,c.number from private.academic_audit a left join private.academic_candidates c on c.id=a.candidate_id order by a.id desc limit 200)x),'[]'::jsonb))
 into result from private.academic_state s cross join public.academic_publication p;
 return result;
end;$$;
create function public.get_academic_workspace() returns jsonb language sql stable security invoker set search_path='' as $$select private.get_academic_workspace()$$;
create function public.get_academic_results() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('version',version,'publishedAt',published_at,
 'results',coalesce((select jsonb_agg(r order by r.number) from public.academic_results r),'[]'::jsonb)) from public.academic_publication
$$;
create function private.import_academic(p_rows jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare row jsonb;c private.academic_candidates;n integer=0;
begin
 perform private.require_staff(array['admin']);
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception '名單格式不正確';end if;
 if jsonb_array_length(p_rows) not between 1 and 500 then raise exception '每次匯入 1–500 人';end if;
 perform 1 from private.academic_state where singleton for update;
 for row in select * from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(row) is distinct from 'object' then raise exception '名單格式不正確';end if;
  if row-array['number','name'] <> '{}'::jsonb then raise exception '學科名單只接受參賽編號與姓名';end if;
  insert into private.academic_candidates(number,name) values(btrim(row->>'number'),btrim(row->>'name')) returning * into c;
  insert into private.academic_audit(candidate_id,action,actor_id,new_value) values(c.id,'import',auth.uid(),to_jsonb(c));
  n=n+1;
 end loop;
 update private.academic_state set version=version+1;
 return n;
end;$$;
create function public.import_academic(p_rows jsonb) returns integer language sql security invoker set search_path='' as $$select private.import_academic(p_rows)$$;

create function private.save_academic_score(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.academic_candidates;saved private.academic_candidates;receipt private.requests;
 req uuid=(p_input->>'request_id')::uuid;expected integer=(p_input->>'expected_revision')::integer;
 reason text=btrim(coalesce(p_input->>'reason',''));value numeric;payload jsonb=p_input||'{"operation":"academic_score"}'::jsonb;
begin
 perform private.require_academic();
 if req is null or expected is null or expected<0 then raise exception '缺少送出識別碼或版本';end if;
 if p_input-array['id','score','reason','expected_revision','request_id'] <> '{}'::jsonb then raise exception '不接受額外欄位';end if;
 perform pg_advisory_xact_lock(hashtextextended(req::text,0));
 select * into receipt from private.requests where id=req;
 if receipt.id is not null then
  if receipt.actor_id<>auth.uid() or receipt.payload<>payload then raise exception '送出識別碼已用於其他內容';end if;
  return receipt.result;
 end if;
 perform 1 from private.academic_state where singleton for update;
 select * into c from private.academic_candidates where id=(p_input->>'id')::uuid for update;
 if c.id is null then raise exception '找不到學科參賽者';end if;
 if expected<>c.revision then raise exception '成績已被更新，請重新載入後核對';end if;
 if (c.score is not null and reason='') or length(reason)>1000 then raise exception '請填寫修改原因（最多 1000 字）';end if;
 value=round(private.num(p_input,'score',0,100),1);
 update private.academic_candidates set score=value,revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into saved;
 insert into private.academic_audit(candidate_id,action,actor_id,reason,old_value,new_value)
 values(c.id,'score',auth.uid(),reason,to_jsonb(c),to_jsonb(saved));
 update private.academic_state set version=version+1;
 insert into private.requests(id,actor_id,payload,result) values(req,auth.uid(),payload,to_jsonb(saved));
 return to_jsonb(saved);
end;$$;
create function public.save_academic_score(p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.save_academic_score(p_input)$$;

create function private.publish_academic(p_expected_version bigint,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v bigint;total integer;stamp timestamptz;result jsonb;receipt private.requests;
 payload jsonb=jsonb_build_object('operation','academic_publish','expected_version',p_expected_version);
begin
 perform private.require_academic();
 if p_request_id is null or p_expected_version is null then raise exception '缺少公布識別碼或版本';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into receipt from private.requests where id=p_request_id;
 if receipt.id is not null then
  if receipt.actor_id<>auth.uid() or receipt.payload<>payload then raise exception '送出識別碼已用於其他內容';end if;
  return receipt.result;
 end if;
 select version into v from private.academic_state where singleton for update;
 if v<>p_expected_version then raise exception '名單或分數已更新，請重新確認公布人數與成績';end if;
 select count(*) into total from private.academic_candidates where score is not null;
 if total=0 then raise exception '尚無可公布的學科成績';end if;
 stamp=clock_timestamp();
 insert into public.academic_results(id,number,name,score,published_at)
 select id,number,name,score,stamp from private.academic_candidates where score is not null
 on conflict(id) do update set number=excluded.number,name=excluded.name,score=excluded.score,published_at=excluded.published_at;
 update private.academic_state set version=version+1;
 update public.academic_publication set version=v+1,published_at=stamp;
 result=jsonb_build_object('publishedAt',stamp,'count',total,'version',v+1);
 insert into private.academic_audit(action,actor_id,new_value) values('publish',auth.uid(),result);
 insert into private.requests(id,actor_id,payload,result) values(p_request_id,auth.uid(),payload,result);
 return result;
end;$$;
create function public.publish_academic(p_expected_version bigint,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select private.publish_academic(p_expected_version,p_request_id)$$;

revoke all on function private.require_academic(),private.get_academic_workspace(),private.import_academic(jsonb),private.save_academic_score(jsonb),private.publish_academic(bigint,uuid) from public,anon,authenticated;
revoke all on function public.get_academic_workspace(),public.import_academic(jsonb),public.save_academic_score(jsonb),public.publish_academic(bigint,uuid),public.get_academic_results() from public,anon,authenticated;
grant execute on function private.get_academic_workspace(),private.import_academic(jsonb),private.save_academic_score(jsonb),private.publish_academic(bigint,uuid) to authenticated;
grant execute on function public.get_academic_workspace(),public.import_academic(jsonb),public.save_academic_score(jsonb),public.publish_academic(bigint,uuid) to authenticated;
grant execute on function public.get_academic_results() to anon,authenticated;
commit;
