-- Record arrival times, let judges check participants in, and expose only masked
-- names to anonymous visitors.
begin;

alter table public.teams
  add column if not exists checked_in_at timestamptz;

update public.teams
set checkin_status = 'pending', checked_in_at = null
where checkin_status not in ('pending', 'checked_in');

update public.teams
set checked_in_at = clock_timestamp()
where checkin_status = 'checked_in' and checked_in_at is null;

alter table public.teams drop constraint if exists teams_checkin_status_check;
alter table public.teams add constraint teams_checkin_status_check
  check (checkin_status in ('pending', 'checked_in'));

create or replace function private.set_checkin(p_team_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.teams; arrived_at timestamptz;
begin
 select * into t from public.teams where id=p_team_id for update;
 if t.id is null then raise exception '參賽者不存在';end if;
 perform private.require_staff(array['admin','judge','checkin'],t.category_id);
 if p_status not in ('pending','checked_in') or p_status is null then raise exception '報到狀態不正確';end if;
 if t.checkin_status=p_status then return;end if;
 if exists(select 1 from public.attempts where team_id=t.id) and p_status<>'checked_in' then raise exception '已有成績，不可取消報到；請由主辦人先處理成績';end if;
 arrived_at=case when p_status='checked_in' then clock_timestamp() else null end;
 update public.teams set checkin_status=p_status,checked_in_at=arrived_at where id=t.id;
 insert into private.audit_log(team_id,action,actor_id,old_value,new_value)
 values(t.id,'checkin_update',auth.uid(),jsonb_build_object('status',t.checkin_status,'checked_in_at',t.checked_in_at),jsonb_build_object('status',p_status,'checked_in_at',arrived_at));
end;$$;

create or replace function public.get_scoreboard(p_version bigint default -1)
returns jsonb language sql stable security definer set search_path='' as $$
select case when version=p_version then jsonb_build_object('version',version,'unchanged',true) else
jsonb_build_object(
  'version',version,
  'teams',coalesce((
    select jsonb_agg(
      case
        when exists(select 1 from private.staff_roles s where s.user_id=auth.uid())
          then to_jsonb(t)
        else to_jsonb(t) || jsonb_build_object(
          'name',case when char_length(t.name)>=2
            then substring(t.name from 1 for 1)||'o'||substring(t.name from 3)
            else t.name end
        )
      end order by t.team_number
    ) from public.teams t
  ),'[]'::jsonb),
  'attempts',coalesce((select jsonb_agg(a) from public.attempts a),'[]'::jsonb),
  'results',coalesce((select jsonb_agg(r) from public.results r),'[]'::jsonb)
) end from public.event_state
$$;

revoke select on public.teams from anon;
grant select on public.teams to authenticated;
drop policy if exists public_teams on public.teams;
create policy staff_teams on public.teams for select to authenticated
  using (private.my_staff_role() is not null);
revoke all on function public.get_scoreboard(bigint) from public,anon,authenticated;
grant execute on function public.get_scoreboard(bigint) to anon,authenticated;

commit;
