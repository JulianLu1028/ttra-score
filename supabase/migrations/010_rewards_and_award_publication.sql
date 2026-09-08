begin;
create table private.drink_claims(
 team_id uuid primary key references public.teams(id),
 claimed boolean not null default false,
 revision integer not null default 0,
 claimed_at timestamptz,
 updated_by uuid not null references auth.users(id)
);
create table private.award_publications(
 id uuid primary key,
 category_id text not null check(category_id in ('power','program','creative')),
 heat integer not null check(heat between 1 and 3),
 quota integer not null check(quota between 1 and 500),
 entries jsonb not null,
 published_at timestamptz not null default clock_timestamp(),
 published_by uuid not null references auth.users(id)
);
create table private.award_settings(
 category_id text not null check(category_id in ('power','program','creative')),
 heat integer not null check(heat between 1 and case when category_id='program' then 3 else 2 end),
 quota integer check(quota between 1 and 500),
 revision integer not null default 0,
 publication_id uuid references private.award_publications(id),
 primary key(category_id,heat)
);
insert into private.award_settings(category_id,heat)
select c,n from unnest(array['power','program','creative']) c cross join generate_series(1,3) n where n<=case when c='program' then 3 else 2 end;
alter table private.drink_claims enable row level security;
alter table private.award_settings enable row level security;
alter table private.award_publications enable row level security;
revoke all on private.drink_claims,private.award_settings,private.award_publications from public,anon,authenticated;

create function public.get_drink_claims() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; staff private.staff_roles;
begin
 perform private.require_staff(array['admin','judge','checkin']);
 select * into staff from private.staff_roles where user_id=auth.uid();
 select coalesce(jsonb_agg(d),'[]'::jsonb) into result from private.drink_claims d join public.teams t on t.id=d.team_id
 where staff.role='admin' or cardinality(staff.category_ids)=0 or t.category_id=any(staff.category_ids);
 return result;
end;$$;
create function public.set_drink_claim(p_team_id uuid,p_claimed boolean,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare team public.teams; old private.drink_claims; saved private.drink_claims;
begin
 select * into team from public.teams where id=p_team_id for update;
 if team.id is null then raise exception '參賽者不存在';end if;
 perform private.require_staff(array['admin','judge','checkin'],team.category_id);
 if p_claimed is null or p_expected_revision is null then raise exception '領取狀態或版本不可空白';end if;
 select * into old from private.drink_claims where team_id=p_team_id;
 if old.team_id is not null and old.claimed=p_claimed then return to_jsonb(old);end if;
 if coalesce(old.revision,0)<>p_expected_revision then raise exception '領取狀態已被其他工作人員更新，請先重新整理';end if;
 insert into private.drink_claims(team_id,claimed,revision,claimed_at,updated_by)
 values(p_team_id,p_claimed,p_expected_revision+1,case when p_claimed then clock_timestamp() end,auth.uid())
 on conflict(team_id) do update set claimed=excluded.claimed,revision=excluded.revision,claimed_at=excluded.claimed_at,updated_by=excluded.updated_by returning * into saved;
 insert into private.audit_log(team_id,action,actor_id,old_value,new_value)
 values(team.id,'drink_claim_update',auth.uid(),case when old.team_id is null then null else to_jsonb(old) end,to_jsonb(saved));
 update public.event_state set version=version+1 where singleton = true;
 return to_jsonb(saved);
end;$$;

create function public.get_award_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_staff(array['admin']);
 select coalesce(jsonb_agg(jsonb_build_object('category_id',s.category_id,'heat',s.heat,'quota',s.quota,'revision',s.revision,'published_at',p.published_at) order by s.category_id,s.heat),'[]'::jsonb)
 into result from private.award_settings s left join private.award_publications p on p.id=s.publication_id;
 return result;
end;$$;
create function public.set_award_quota(p_category text,p_heat integer,p_quota integer,p_expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare old private.award_settings;
begin
 perform private.require_staff(array['admin']);
 perform 1 from public.event_state where singleton = true for update;
 select * into old from private.award_settings where category_id=p_category and heat=p_heat for update;
 if old.category_id is null then raise exception '此項目或梯次不提供獎狀排名';end if;
 if p_quota is null or p_quota not between 1 and 500 then raise exception '請輸入官方確認的獎狀名額（1–500）';end if;
 if p_expected_revision is distinct from old.revision then raise exception '名額已更新，請重新載入';end if;
 update private.award_settings set quota=p_quota,revision=revision+1 where category_id=p_category and heat=p_heat;
 insert into private.audit_log(action,actor_id,old_value,new_value)
 values('award_quota_update',auth.uid(),to_jsonb(old),jsonb_build_object('category_id',p_category,'heat',p_heat,'quota',p_quota));
 update public.event_state set version=version+1 where singleton = true;
end;$$;

create function public.preview_awards(p_category text,p_heat integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare setting private.award_settings; entries jsonb; v bigint;
begin
 perform private.require_staff(array['admin']);
 select * into setting from private.award_settings where category_id=p_category and heat=p_heat;
 if setting.quota is null then raise exception '請先設定官方確認的獎狀名額';end if;
 select version into v from public.event_state where singleton = true;
 select coalesce(jsonb_agg(jsonb_build_object('team_id',t.id,'number',t.team_number,'name',t.name,'rank',r.rank,'primary_score',r.primary_score,'secondary_score',r.secondary_score,'qualified',r.qualified,'complete',r.complete) order by r.rank,t.team_number),'[]'::jsonb)
 into entries from public.results r join public.teams t on t.id=r.team_id
 where t.category_id=p_category and t.heat=p_heat and r.rank<=setting.quota;
 return jsonb_build_object('version',v,'settings_revision',setting.revision,'quota',setting.quota,'entries',entries);
end;$$;

create function public.publish_awards(p_category text,p_heat integer,p_version bigint,p_settings_revision integer,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview jsonb; old private.award_settings; saved private.award_publications; receipt private.requests;
 payload jsonb=jsonb_build_object('operation','publish_awards','category',p_category,'heat',p_heat,'version',p_version,'settings_revision',p_settings_revision);
begin
 perform private.require_staff(array['admin']);
 if p_request_id is null or p_version is null or p_settings_revision is null then raise exception '缺少公告確認資料';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into receipt from private.requests where id=p_request_id;
 if receipt.id is not null then
  if receipt.actor_id<>auth.uid() or receipt.payload<>payload then raise exception '送出識別碼已被其他操作使用';end if;
  return receipt.result;
 end if;
 perform 1 from public.event_state where singleton = true for update;
 preview=public.preview_awards(p_category,p_heat);
 if (preview->>'version')::bigint<>p_version or (preview->>'settings_revision')::integer<>p_settings_revision then raise exception '成績或名額已更新，請重新預覽確認';end if;
 if jsonb_array_length(preview->'entries')=0 then raise exception '尚無可公布的有效成績';end if;
 if jsonb_array_length(preview->'entries')>(preview->>'quota')::integer then raise exception '同名次超過獎狀名額，請先由官方確認名額後再公布';end if;
 select * into old from private.award_settings where category_id=p_category and heat=p_heat for update;
 insert into private.award_publications(id,category_id,heat,quota,entries,published_by)
 values(p_request_id,p_category,p_heat,(preview->>'quota')::integer,preview->'entries',auth.uid()) returning * into saved;
 update private.award_settings set publication_id=saved.id where category_id=p_category and heat=p_heat;
 insert into private.audit_log(action,actor_id,old_value,new_value)
 values('awards_publish',auth.uid(),to_jsonb(old),to_jsonb(saved));
 insert into private.requests(id,actor_id,payload,result) values(p_request_id,auth.uid(),payload,to_jsonb(saved));
 update public.event_state set version=version+1 where singleton = true;
 return to_jsonb(saved);
end;$$;

create function public.get_awards() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('team_id',entry->>'team_id','rank',entry->'rank','published_at',p.published_at,'category_id',p.category_id,'heat',p.heat)),'[]'::jsonb)
 from private.award_settings s join private.award_publications p on p.id=s.publication_id cross join lateral jsonb_array_elements(p.entries) entry
$$;
-- A single transaction can announce all populated, ranked heats together.
create function public.preview_all_awards() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare setting private.award_settings; groups jsonb='[]'::jsonb; preview jsonb; v bigint;
begin
 perform private.require_staff(array['admin']);
 select version into v from public.event_state where singleton = true;
 for setting in select s.* from private.award_settings s where exists(select 1 from public.teams t where t.category_id=s.category_id and t.heat=s.heat) order by s.category_id,s.heat loop
  if setting.quota is null then raise exception '% 第 % 梯尚未設定官方名額',setting.category_id,setting.heat;end if;
  preview=public.preview_awards(setting.category_id,setting.heat);
  groups=groups||jsonb_build_array(preview||jsonb_build_object('category_id',setting.category_id,'heat',setting.heat));
 end loop;
 if jsonb_array_length(groups)=0 then raise exception '尚無可公告的參賽名單';end if;
 return jsonb_build_object('version',v,'groups',groups);
end;$$;
create function public.publish_all_awards(p_version bigint,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preview jsonb; g jsonb; old private.award_settings; saved private.award_publications; receipt private.requests; result jsonb='[]'::jsonb;
 payload jsonb=jsonb_build_object('operation','publish_all_awards','version',p_version);
begin
 perform private.require_staff(array['admin']);
 if p_request_id is null or p_version is null then raise exception '缺少公告確認資料';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into receipt from private.requests where id=p_request_id;
 if receipt.id is not null then
  if receipt.actor_id<>auth.uid() or receipt.payload<>payload then raise exception '送出識別碼已被其他操作使用';end if;
  return receipt.result;
 end if;
 perform 1 from public.event_state where singleton = true for update;
 preview=public.preview_all_awards();
 if (preview->>'version')::bigint<>p_version then raise exception '成績或名額已更新，請重新預覽確認';end if;
 for g in select value from jsonb_array_elements(preview->'groups') loop
  if jsonb_array_length(g->'entries')=0 then raise exception '% 第 % 梯尚無可公布的有效成績',g->>'category_id',g->>'heat';end if;
  if jsonb_array_length(g->'entries')>(g->>'quota')::integer then raise exception '% 第 % 梯同名次超過名額，請先由官方確認',g->>'category_id',g->>'heat';end if;
 end loop;
 for g in select value from jsonb_array_elements(preview->'groups') loop
  select * into old from private.award_settings where category_id=g->>'category_id' and heat=(g->>'heat')::integer for update;
  insert into private.award_publications(id,category_id,heat,quota,entries,published_by)
  values(gen_random_uuid(),old.category_id,old.heat,old.quota,g->'entries',auth.uid()) returning * into saved;
  update private.award_settings set publication_id=saved.id where category_id=old.category_id and heat=old.heat;
  insert into private.audit_log(action,actor_id,old_value,new_value) values('awards_publish',auth.uid(),to_jsonb(old),to_jsonb(saved));
  result=result||jsonb_build_array(to_jsonb(saved));
 end loop;
 insert into private.requests(id,actor_id,payload,result) values(p_request_id,auth.uid(),payload,result);
 update public.event_state set version=version+1 where singleton = true;
 return result;
end;$$;
revoke all on function public.preview_all_awards(),public.publish_all_awards(bigint,uuid) from public,anon,authenticated;
grant execute on function public.preview_all_awards(),public.publish_all_awards(bigint,uuid) to authenticated;
revoke select on public.results from anon;
revoke all on function public.get_drink_claims(),public.set_drink_claim(uuid,boolean,integer),public.get_award_settings(),public.set_award_quota(text,integer,integer,integer),public.preview_awards(text,integer),public.publish_awards(text,integer,bigint,integer,uuid),public.get_awards() from public,anon,authenticated;
grant execute on function public.get_drink_claims(),public.set_drink_claim(uuid,boolean,integer),public.get_award_settings(),public.set_award_quota(text,integer,integer,integer),public.preview_awards(text,integer),public.publish_awards(text,integer,bigint,integer,uuid) to authenticated;
grant execute on function public.get_awards() to anon,authenticated;

create or replace function public.get_scoreboard(p_version bigint default -1)
returns jsonb language sql stable security definer set search_path='' as $$
select case when version=p_version then jsonb_build_object('version',version,'unchanged',true) else jsonb_build_object(
 'version',version,
 'teams',coalesce((select jsonb_agg(case when exists(select 1 from private.staff_roles s where s.user_id=auth.uid()) then to_jsonb(t) else to_jsonb(t)||jsonb_build_object('name',case when char_length(t.name)>=2 then substring(t.name from 1 for 1)||'o'||substring(t.name from 3) else t.name end) end order by t.team_number) from public.teams t),'[]'::jsonb),
 'attempts',coalesce((select jsonb_agg(a) from public.attempts a),'[]'::jsonb),
 'results',coalesce((select jsonb_agg(case when exists(select 1 from private.staff_roles s where s.user_id=auth.uid()) then to_jsonb(r) else to_jsonb(r)||jsonb_build_object('rank',null) end) from public.results r),'[]'::jsonb),
 'awards',public.get_awards()
) end from public.event_state
$$;
update public.event_state set version=version+1 where singleton = true;
commit;
