-- Keep existing quotas/publications as ranked awards; merit starts at zero.
begin;
alter table private.award_settings add column merit_quota integer not null default 0 check(merit_quota between 0 and 500);
alter table private.award_settings drop constraint award_settings_quota_check;
alter table private.award_settings add constraint award_settings_quota_check check(quota between 0 and 500);
alter table private.award_settings add constraint award_settings_total_check check(quota is null or quota + merit_quota between 1 and 500);
alter table private.award_publications add column merit_quota integer not null default 0 check(merit_quota between 0 and 500);
alter table private.award_publications drop constraint award_publications_quota_check;
alter table private.award_publications add constraint award_publications_quota_check check(quota between 0 and 500 and quota + merit_quota between 1 and 500);

create or replace function public.get_award_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_staff(array['admin']);
 select coalesce(jsonb_agg(jsonb_build_object('category_id',s.category_id,'heat',s.heat,'quota',s.quota,'merit_quota',s.merit_quota,'revision',s.revision,'published_at',p.published_at) order by s.category_id,s.heat),'[]'::jsonb)
 into result from private.award_settings s left join private.award_publications p on p.id=s.publication_id;
 return result;
end;$$;

create function public.set_award_quotas(p_category text,p_heat integer,p_quota integer,p_merit_quota integer,p_expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare old private.award_settings;
begin
 perform private.require_staff(array['admin']);
 perform 1 from public.event_state where singleton = true for update;
 select * into old from private.award_settings where category_id=p_category and heat=p_heat for update;
 if old.category_id is null then raise exception '此項目或梯次不提供獎狀排名';end if;
 if p_quota is null or p_merit_quota is null or p_quota not between 0 and 500 or p_merit_quota not between 0 and 500 or p_quota+p_merit_quota not between 1 and 500 then
  raise exception '名次名額與佳作名額需為 0–500 的整數，合計 1–500 人';end if;
 if p_expected_revision is distinct from old.revision then raise exception '名額已更新，請重新載入';end if;
 update private.award_settings set quota=p_quota,merit_quota=p_merit_quota,revision=revision+1 where category_id=p_category and heat=p_heat;
 insert into private.audit_log(action,actor_id,old_value,new_value)
 values('award_quota_update',auth.uid(),to_jsonb(old),jsonb_build_object('category_id',p_category,'heat',p_heat,'quota',p_quota,'merit_quota',p_merit_quota));
 update public.event_state set version=version+1 where singleton = true;
end;$$;
-- Older clients may still change the ranked quota without erasing merit settings.
create or replace function public.set_award_quota(p_category text,p_heat integer,p_quota integer,p_expected_revision integer) returns void
language plpgsql security definer set search_path='' as $$
declare merit integer;
begin
 perform private.require_staff(array['admin']);
 select merit_quota into merit from private.award_settings where category_id=p_category and heat=p_heat;
 perform public.set_award_quotas(p_category,p_heat,p_quota,coalesce(merit,0),p_expected_revision);
end;$$;
revoke all on function public.set_award_quotas(text,integer,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.set_award_quotas(text,integer,integer,integer,integer) to authenticated;

create or replace function public.preview_awards(p_category text,p_heat integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare setting private.award_settings; entries jsonb; v bigint; ranked integer; merit integer;
begin
 perform private.require_staff(array['admin']);
 select * into setting from private.award_settings where category_id=p_category and heat=p_heat;
 if setting.quota is null then raise exception '請先設定官方確認的名次名額與佳作名額';end if;
 select version into v from public.event_state where singleton = true;
 select coalesce(jsonb_agg(jsonb_build_object('team_id',t.id,'number',t.team_number,'name',t.name,'rank',r.rank,
  'award_type',case when r.rank<=setting.quota then 'rank' else 'merit' end,
  'primary_score',r.primary_score,'secondary_score',r.secondary_score,'qualified',r.qualified,'complete',r.complete) order by r.rank,t.team_number),'[]'::jsonb),
  count(*) filter(where r.rank<=setting.quota),count(*) filter(where r.rank>setting.quota)
 into entries,ranked,merit from public.results r join public.teams t on t.id=r.team_id
 where t.category_id=p_category and t.heat=p_heat and r.rank<=setting.quota+setting.merit_quota;
 return jsonb_build_object('version',v,'settings_revision',setting.revision,'quota',setting.quota,'merit_quota',setting.merit_quota,
  'boundary_conflict',ranked>setting.quota or merit>setting.merit_quota,'entries',entries);
end;$$;

-- Preserve publication locking, version checks, receipts and audit behavior.
-- Refuse to migrate if the expected installed definitions are different.
do $migration$
declare definition text; updated text; routine regprocedure;
begin
 routine := 'public.publish_awards(text,integer,bigint,integer,uuid)'::regprocedure;
 definition := pg_get_functiondef(routine);
 updated := replace(definition,
  'if jsonb_array_length(preview->''entries'')>(preview->>''quota'')::integer then raise exception ''同名次超過獎狀名額，請先由官方確認名額後再公布'';end if;',
  'if (preview->>''boundary_conflict'')::boolean then raise exception ''同名次跨越名次／佳作名額分界，請先由官方確認名額後再公布'';end if;');
 if updated=definition then raise exception 'Unexpected publish_awards validation';end if;
 definition := updated;
 updated := replace(definition,
  'insert into private.award_publications(id,category_id,heat,quota,entries,published_by)',
  'insert into private.award_publications(id,category_id,heat,quota,merit_quota,entries,published_by)');
 if updated=definition then raise exception 'Unexpected publish_awards columns';end if;
 definition := updated;
 updated := replace(definition,
  'values(p_request_id,p_category,p_heat,(preview->>''quota'')::integer,preview->''entries'',auth.uid())',
  'values(p_request_id,p_category,p_heat,(preview->>''quota'')::integer,(preview->>''merit_quota'')::integer,preview->''entries'',auth.uid())');
 if updated=definition then raise exception 'Unexpected publish_awards values';end if;
 execute updated;

 routine := 'public.publish_all_awards(bigint,uuid)'::regprocedure;
 definition := pg_get_functiondef(routine);
 updated := replace(definition,
  'if jsonb_array_length(g->''entries'')>(g->>''quota'')::integer then raise exception ''% 第 % 梯同名次超過名額，請先由官方確認'',g->>''category_id'',g->>''heat'';end if;',
  'if (g->>''boundary_conflict'')::boolean then raise exception ''% 第 % 梯同名次跨越名次／佳作名額分界，請先由官方確認'',g->>''category_id'',g->>''heat'';end if;');
 if updated=definition then raise exception 'Unexpected publish_all_awards validation';end if;
 definition := updated;
 updated := replace(definition,
  'insert into private.award_publications(id,category_id,heat,quota,entries,published_by)',
  'insert into private.award_publications(id,category_id,heat,quota,merit_quota,entries,published_by)');
 if updated=definition then raise exception 'Unexpected publish_all_awards columns';end if;
 definition := updated;
 updated := replace(definition,
  'values(gen_random_uuid(),old.category_id,old.heat,old.quota,g->''entries'',auth.uid())',
  'values(gen_random_uuid(),old.category_id,old.heat,old.quota,old.merit_quota,g->''entries'',auth.uid())');
 if updated=definition then raise exception 'Unexpected publish_all_awards values';end if;
 execute updated;
end;
$migration$;

create or replace function public.get_awards() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('team_id',entry->>'team_id',
  'award_type',coalesce(entry->>'award_type','rank'),
  'rank',case when entry->>'award_type'='merit' then null else entry->'rank' end,
  'published_at',p.published_at,'category_id',p.category_id,'heat',p.heat)),'[]'::jsonb)
 from private.award_settings s join private.award_publications p on p.id=s.publication_id cross join lateral jsonb_array_elements(p.entries) entry
$$;
update public.event_state set version=version+1 where singleton = true;
commit;
