-- Forward-only authenticated competition/candidate management. No voting,
-- deletion, archive, result, adjustment, role-management or media operations.
begin;

do $$
begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'nhs_management_writer') then
        create role nhs_management_writer nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname = 'nhs_management_writer'
        and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit))
        or exists (select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.roleid
            join pg_catalog.pg_roles u on u.oid = m.member where r.rolname = 'nhs_management_writer' and u.rolname <> 'postgres')
        or exists (select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.member where r.rolname = 'nhs_management_writer') then
        raise exception 'Unexpected management-owner attributes or membership';
    end if;
end;
$$;
grant nhs_management_writer to postgres;
grant usage on schema app, api to nhs_management_writer;
grant create on schema app, api to nhs_management_writer;
alter default privileges for role nhs_management_writer revoke all on functions from public, anon, authenticated, service_role;
grant execute on function api.require_admin(), api.account_status(), app.request_user_id(),
    app.check_slug(text), app.check_pagination(integer, integer) to nhs_management_writer;

grant select (id, slug, title, description, starts_at, ends_at, max_votes_per_voter,
    published_at, enabled, paused, archived_at, show_vote_totals, show_live_counts, show_rankings, created_at, updated_at)
    on app.competitions to nhs_management_writer;
grant insert (slug, title, description, starts_at, ends_at, max_votes_per_voter, created_by, updated_by)
    on app.competitions to nhs_management_writer;
grant update (title, description, starts_at, ends_at, max_votes_per_voter, show_vote_totals, show_live_counts,
    show_rankings, published_by, published_at, enabled, paused, updated_by, updated_at)
    on app.competitions to nhs_management_writer;
grant select (id, competition_id, slug, display_name, description, eligible, youtube_video_id, video_start_seconds, updated_at)
    on app.candidates to nhs_management_writer;
grant insert (competition_id, slug, display_name, description, eligible, youtube_video_id, video_start_seconds, created_by, updated_by)
    on app.candidates to nhs_management_writer;
grant update (display_name, description, eligible, youtube_video_id, video_start_seconds, updated_by, updated_at)
    on app.candidates to nhs_management_writer;
grant insert (actor_id, actor_role, action, target_type, target_id, details) on app.audit_logs to nhs_management_writer;

create policy management_select on app.competitions for select to nhs_management_writer using ((select api.require_admin()));
create policy management_insert on app.competitions for insert to nhs_management_writer
    with check ((select api.require_admin()) and created_by = app.request_user_id() and updated_by = app.request_user_id());
create policy management_update on app.competitions for update to nhs_management_writer
    using ((select api.require_admin())) with check ((select api.require_admin()) and updated_by = app.request_user_id());
create policy management_select on app.candidates for select to nhs_management_writer using ((select api.require_admin()));
create policy management_insert on app.candidates for insert to nhs_management_writer
    with check ((select api.require_admin()) and created_by = app.request_user_id() and updated_by = app.request_user_id());
create policy management_update on app.candidates for update to nhs_management_writer
    using ((select api.require_admin())) with check ((select api.require_admin()) and updated_by = app.request_user_id());
create policy management_audit_insert on app.audit_logs for insert to nhs_management_writer
    with check (actor_id = app.request_user_id() and actor_role in ('admin', 'super_admin')
        and actor_role = (select s.staff_role from api.account_status() s)
        and target_type in ('competitions', 'candidates')
        and action in ('create_competition', 'update_draft_competition', 'set_competition_visibility',
            'publish_competition', 'set_competition_paused', 'add_candidate', 'update_candidate'));

create function app.check_management_text(p_name text, p_description text) returns void
language plpgsql immutable security invoker set search_path = '' as $$
begin
    if p_name is null or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 200
        or p_description is null or pg_catalog.char_length(p_description) > 10000 then
        raise exception 'Invalid title/name or description' using errcode = '22023';
    end if;
end;
$$;
alter function app.check_management_text(text, text) owner to nhs_management_writer;

create function app.check_management_window(p_starts_at timestamptz, p_ends_at timestamptz, p_allowance integer) returns void
language plpgsql volatile security invoker set search_path = '' as $$
begin
    if p_starts_at is null or p_ends_at is null or not pg_catalog.isfinite(p_starts_at) or not pg_catalog.isfinite(p_ends_at)
        or p_starts_at >= p_ends_at or p_starts_at <= pg_catalog.clock_timestamp()
        or p_allowance is null or p_allowance not between 1 and 1000 then
        raise exception 'Invalid future voting window or allowance' using errcode = '22023';
    end if;
end;
$$;
alter function app.check_management_window(timestamptz, timestamptz, integer) owner to nhs_management_writer;

create function app.check_candidate_video(p_video_id text, p_start_seconds integer, p_eligible boolean) returns void
language plpgsql immutable security invoker set search_path = '' as $$
begin
    if p_eligible is null or p_start_seconds is null or p_start_seconds < 0
        or (p_video_id is null and p_start_seconds <> 0)
        or (p_video_id is not null and p_video_id !~ '^[A-Za-z0-9_-]{11}$') then
        raise exception 'Invalid video mapping or eligibility' using errcode = '22023';
    end if;
end;
$$;
alter function app.check_candidate_video(text, integer, boolean) owner to nhs_management_writer;

create function app.lock_management_competition(p_id uuid, p_draft_only boolean, p_before_start boolean)
returns table (starts_at timestamptz, ends_at timestamptz, max_votes_per_voter integer, published_at timestamptz,
    enabled boolean, paused boolean, show_vote_totals boolean, show_live_counts boolean, show_rankings boolean)
language plpgsql volatile security invoker set search_path = '' as $$
declare v_parent record;
begin
    perform api.require_admin();
    if p_id is null then raise exception 'Competition ID required' using errcode = '22023'; end if;
    select c.starts_at, c.ends_at, c.max_votes_per_voter, c.published_at, c.enabled, c.paused, c.archived_at,
        c.show_vote_totals, c.show_live_counts, c.show_rankings into v_parent
        from app.competitions c where c.id = p_id for update;
    if not found then raise exception 'Competition not found' using errcode = 'P0002'; end if;
    -- Fresh statement after any lock wait; no reliance on transaction-start now().
    perform api.require_admin();
    if v_parent.archived_at is not null or (p_draft_only and v_parent.published_at is not null)
        or (p_before_start and pg_catalog.clock_timestamp() >= v_parent.starts_at) then
        raise exception 'Competition configuration is frozen or not draft' using errcode = '55000';
    end if;
    return query select v_parent.starts_at, v_parent.ends_at, v_parent.max_votes_per_voter,
        v_parent.published_at, v_parent.enabled, v_parent.paused, v_parent.show_vote_totals, v_parent.show_live_counts, v_parent.show_rankings;
end;
$$;
alter function app.lock_management_competition(uuid, boolean, boolean) owner to nhs_management_writer;

create function app.record_management_audit(p_action text, p_type text, p_id uuid, p_changes jsonb) returns void
language plpgsql volatile security invoker set search_path = '' as $$
declare v_actor record;
begin
    perform api.require_admin();
    select s.user_id, s.staff_role into v_actor from api.account_status() s;
    if p_changes is null or pg_catalog.pg_column_size(p_changes) > 8192 then
        raise exception 'Audit change information exceeds bounds' using errcode = '22023';
    end if;
    insert into app.audit_logs (actor_id, actor_role, action, target_type, target_id, details)
        values (v_actor.user_id, v_actor.staff_role, p_action, p_type, p_id, p_changes);
end;
$$;
alter function app.record_management_audit(text, text, uuid, jsonb) owner to nhs_management_writer;

create function api.create_competition(p_slug text, p_title text, p_description text, p_starts_at timestamptz,
    p_ends_at timestamptz, p_max_votes_per_voter integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid;
begin
    perform api.require_admin();
    perform app.check_slug(p_slug);
    perform app.check_management_text(p_title, p_description);
    perform app.check_management_window(p_starts_at, p_ends_at, p_max_votes_per_voter);
    v_actor := app.request_user_id();
    insert into app.competitions(slug, title, description, starts_at, ends_at, max_votes_per_voter, created_by, updated_by)
        values (p_slug, pg_catalog.btrim(p_title), p_description, p_starts_at, p_ends_at, p_max_votes_per_voter, v_actor, v_actor) returning id into v_id;
    perform app.record_management_audit('create_competition', 'competitions', v_id,
        pg_catalog.jsonb_build_object('submitted_fields', array['slug','title','description','starts_at','ends_at','max_votes_per_voter'],
            'starts_at',p_starts_at,'ends_at',p_ends_at,'allowance',p_max_votes_per_voter));
    return v_id;
end;
$$;
alter function api.create_competition(text, text, text, timestamptz, timestamptz, integer) owner to nhs_management_writer;

create function api.update_draft_competition(p_competition_id uuid, p_title text, p_description text,
    p_starts_at timestamptz, p_ends_at timestamptz, p_max_votes_per_voter integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_parent record;
begin
    select * into v_parent from app.lock_management_competition(p_competition_id, true, true);
    perform app.check_management_text(p_title, p_description);
    perform app.check_management_window(p_starts_at, p_ends_at, p_max_votes_per_voter);
    update app.competitions set title = pg_catalog.btrim(p_title), description = p_description, starts_at = p_starts_at,
        ends_at = p_ends_at, max_votes_per_voter = p_max_votes_per_voter, updated_by = app.request_user_id(), updated_at = pg_catalog.clock_timestamp()
        where id = p_competition_id;
    perform app.record_management_audit('update_draft_competition', 'competitions', p_competition_id,
        pg_catalog.jsonb_build_object('submitted_fields',array['title','description','starts_at','ends_at','max_votes_per_voter'],
            'before',pg_catalog.jsonb_build_object('starts_at',v_parent.starts_at,'ends_at',v_parent.ends_at,'allowance',v_parent.max_votes_per_voter),
            'after',pg_catalog.jsonb_build_object('starts_at',p_starts_at,'ends_at',p_ends_at,'allowance',p_max_votes_per_voter)));
    return p_competition_id;
end;
$$;
alter function api.update_draft_competition(uuid, text, text, timestamptz, timestamptz, integer) owner to nhs_management_writer;

create function api.set_competition_visibility(p_competition_id uuid, p_show_vote_totals boolean,
    p_show_live_counts boolean, p_show_rankings boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_parent record;
begin
    select * into v_parent from app.lock_management_competition(p_competition_id, false, true);
    if p_show_vote_totals is null or p_show_live_counts is null or p_show_rankings is null
        or (p_show_live_counts and not p_show_vote_totals) then raise exception 'Invalid visibility settings' using errcode = '22023'; end if;
    update app.competitions set show_vote_totals=p_show_vote_totals, show_live_counts=p_show_live_counts, show_rankings=p_show_rankings,
        updated_by=app.request_user_id(), updated_at=pg_catalog.clock_timestamp() where id=p_competition_id;
    perform app.record_management_audit('set_competition_visibility','competitions',p_competition_id,
        pg_catalog.jsonb_build_object('before',pg_catalog.jsonb_build_array(v_parent.show_vote_totals,v_parent.show_live_counts,v_parent.show_rankings),
            'after',pg_catalog.jsonb_build_array(p_show_vote_totals,p_show_live_counts,p_show_rankings)));
    return p_competition_id;
end;
$$;
alter function api.set_competition_visibility(uuid, boolean, boolean, boolean) owner to nhs_management_writer;

create function api.publish_competition(p_competition_id uuid) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
begin
    perform app.lock_management_competition(p_competition_id, true, true);
    update app.competitions set published_by=app.request_user_id(), published_at=pg_catalog.clock_timestamp(), enabled=true, paused=false,
        updated_by=app.request_user_id(), updated_at=pg_catalog.clock_timestamp() where id=p_competition_id;
    perform app.record_management_audit('publish_competition','competitions',p_competition_id,pg_catalog.jsonb_build_object('listing_published',true));
    return p_competition_id;
end;
$$;
alter function api.publish_competition(uuid) owner to nhs_management_writer;

create function api.set_competition_paused(p_competition_id uuid, p_paused boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_parent record; v_now timestamptz;
begin
    select * into v_parent from app.lock_management_competition(p_competition_id, false, false);
    v_now := pg_catalog.clock_timestamp();
    if p_paused is null then raise exception 'Pause state required' using errcode='22023'; end if;
    if v_parent.published_at is null or not v_parent.enabled or v_now < v_parent.starts_at or v_now >= v_parent.ends_at
        or v_parent.paused = p_paused then raise exception 'Voting window is not open or state is unchanged' using errcode='55000'; end if;
    update app.competitions set paused=p_paused, updated_by=app.request_user_id(), updated_at=pg_catalog.clock_timestamp() where id=p_competition_id;
    perform app.record_management_audit('set_competition_paused','competitions',p_competition_id,
        pg_catalog.jsonb_build_object('before',v_parent.paused,'after',p_paused));
    return p_competition_id;
end;
$$;
alter function api.set_competition_paused(uuid, boolean) owner to nhs_management_writer;

create function api.add_candidate(p_competition_id uuid, p_slug text, p_display_name text, p_description text,
    p_eligible boolean default true, p_youtube_video_id text default null, p_video_start_seconds integer default 0) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid;
begin
    perform app.lock_management_competition(p_competition_id, true, true);
    perform app.check_slug(p_slug);
    perform app.check_management_text(p_display_name,p_description);
    perform app.check_candidate_video(p_youtube_video_id,p_video_start_seconds,p_eligible);
    v_actor := app.request_user_id();
    insert into app.candidates(competition_id,slug,display_name,description,eligible,youtube_video_id,video_start_seconds,created_by,updated_by)
        values (p_competition_id,p_slug,pg_catalog.btrim(p_display_name),p_description,p_eligible,p_youtube_video_id,p_video_start_seconds,v_actor,v_actor)
        returning id into v_id;
    perform app.record_management_audit('add_candidate','candidates',v_id,
        pg_catalog.jsonb_build_object('competition_id',p_competition_id,'submitted_fields',array['slug','display_name','description','eligible','youtube_video_id','video_start_seconds']));
    return v_id;
end;
$$;
alter function api.add_candidate(uuid, text, text, text, boolean, text, integer) owner to nhs_management_writer;

create function api.update_candidate(p_competition_id uuid, p_candidate_id uuid, p_display_name text, p_description text,
    p_eligible boolean, p_youtube_video_id text, p_video_start_seconds integer) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_parent record;
begin
    select * into v_parent from app.lock_management_competition(p_competition_id, false, true);
    if p_candidate_id is null then raise exception 'Candidate ID required' using errcode='22023'; end if;
    perform d.id from app.candidates d where d.id=p_candidate_id and d.competition_id=p_competition_id for update;
    if not found then raise exception 'Candidate not found in competition' using errcode='P0002'; end if;
    perform api.require_admin();
    if pg_catalog.clock_timestamp() >= v_parent.starts_at then raise exception 'Candidate configuration is frozen' using errcode='55000'; end if;
    perform app.check_management_text(p_display_name,p_description);
    perform app.check_candidate_video(p_youtube_video_id,p_video_start_seconds,p_eligible);
    update app.candidates set display_name=pg_catalog.btrim(p_display_name),description=p_description,eligible=p_eligible,
        youtube_video_id=p_youtube_video_id,video_start_seconds=p_video_start_seconds,updated_by=app.request_user_id(),updated_at=pg_catalog.clock_timestamp()
        where id=p_candidate_id and competition_id=p_competition_id;
    perform app.record_management_audit('update_candidate','candidates',p_candidate_id,
        pg_catalog.jsonb_build_object('competition_id',p_competition_id,'submitted_fields',array['display_name','description','eligible','youtube_video_id','video_start_seconds']));
    return p_candidate_id;
end;
$$;
alter function api.update_candidate(uuid, uuid, text, text, boolean, text, integer) owner to nhs_management_writer;

create function api.managed_competitions(p_competition_id uuid default null,p_limit integer default 20,p_offset integer default 0)
returns table (competition_id uuid,slug text,title text,description text,starts_at timestamptz,ends_at timestamptz,
    max_votes_per_voter integer,published_at timestamptz,enabled boolean,paused boolean,archived_at timestamptz,
    show_vote_totals boolean,show_live_counts boolean,show_rankings boolean,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform api.require_admin();
    perform app.check_pagination(p_limit,p_offset);
    return query select c.id,c.slug,c.title,c.description,c.starts_at,c.ends_at,c.max_votes_per_voter,c.published_at,c.enabled,c.paused,
        c.archived_at,c.show_vote_totals,c.show_live_counts,c.show_rankings,c.updated_at from app.competitions c
        where p_competition_id is null or c.id=p_competition_id order by c.created_at,c.id limit p_limit offset p_offset;
end;
$$;
alter function api.managed_competitions(uuid, integer, integer) owner to nhs_management_writer;

create function api.managed_candidates(p_competition_id uuid,p_limit integer default 20,p_offset integer default 0)
returns table (candidate_id uuid,competition_id uuid,slug text,display_name text,description text,eligible boolean,
    youtube_video_id text,video_start_seconds integer,updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform api.require_admin();
    if p_competition_id is null then raise exception 'Competition ID required' using errcode='22023'; end if;
    perform app.check_pagination(p_limit,p_offset);
    return query select d.id,d.competition_id,d.slug,d.display_name,d.description,d.eligible,d.youtube_video_id,d.video_start_seconds,d.updated_at
        from app.candidates d where d.competition_id=p_competition_id order by d.slug collate "C",d.id limit p_limit offset p_offset;
end;
$$;
alter function api.managed_candidates(uuid, integer, integer) owner to nhs_management_writer;

revoke all on function app.check_management_text(text,text),app.check_management_window(timestamptz,timestamptz,integer),
    app.check_candidate_video(text,integer,boolean),app.lock_management_competition(uuid,boolean,boolean),
    app.record_management_audit(text,text,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function api.create_competition(text,text,text,timestamptz,timestamptz,integer),
    api.update_draft_competition(uuid,text,text,timestamptz,timestamptz,integer),api.set_competition_visibility(uuid,boolean,boolean,boolean),
    api.publish_competition(uuid),api.set_competition_paused(uuid,boolean),api.add_candidate(uuid,text,text,text,boolean,text,integer),
    api.update_candidate(uuid,uuid,text,text,boolean,text,integer),api.managed_competitions(uuid,integer,integer),api.managed_candidates(uuid,integer,integer)
    from public,anon,authenticated,service_role;
grant execute on function api.create_competition(text,text,text,timestamptz,timestamptz,integer),
    api.update_draft_competition(uuid,text,text,timestamptz,timestamptz,integer),api.set_competition_visibility(uuid,boolean,boolean,boolean),
    api.publish_competition(uuid),api.set_competition_paused(uuid,boolean),api.add_candidate(uuid,text,text,text,boolean,text,integer),
    api.update_candidate(uuid,uuid,text,text,boolean,text,integer),api.managed_competitions(uuid,integer,integer),api.managed_candidates(uuid,integer,integer)
    to authenticated;
revoke create on schema app,api from nhs_management_writer;
notify pgrst,'reload schema';
commit;
