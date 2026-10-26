-- Narrow, explicit public projections and caller-only identity/role checks.
begin;

-- Temporary CREATE permits ownership transfer, revoked before commit.
grant create on schema app, api to nhs_public_reader, nhs_identity_reader;

create function app.check_slug(p_slug text) returns void
language plpgsql immutable security invoker set search_path = '' as $$
begin
    if p_slug is null or pg_catalog.char_length(p_slug) not between 1 and 100
        or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
        raise exception 'Invalid slug' using errcode = '22023';
    end if;
end;
$$;
alter function app.check_slug(text) owner to nhs_public_reader;

create function app.check_pagination(p_limit integer, p_offset integer) returns void
language plpgsql immutable security invoker set search_path = '' as $$
begin
    if p_limit is null or p_offset is null or p_limit not between 1 and 100 or p_offset not between 0 and 10000 then
        raise exception 'Invalid pagination' using errcode = '22023';
    end if;
end;
$$;
alter function app.check_pagination(integer, integer) owner to nhs_public_reader;

create function api.published_school_pages(p_page_key text default null)
returns table (page_key text, title text, content jsonb, published_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    if p_page_key is not null and p_page_key not in ('home', 'about', 'admissions', 'contact') then
        raise exception 'Invalid page key' using errcode = '22023';
    end if;
    return query select p.page_key, p.title, p.content, p.published_at
        from app.school_pages p where p.status = 'published' and p.published_at <= pg_catalog.statement_timestamp()
        and (p_page_key is null or p.page_key = p_page_key) order by p.page_key collate "C";
end;
$$;
alter function api.published_school_pages(text) owner to nhs_public_reader;

create function api.published_events(p_limit integer default 20, p_offset integer default 0)
returns table (event_id uuid, slug text, title text, description text, starts_at timestamptz, ends_at timestamptz,
    cover_bucket text, cover_path text, cover_alt text)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform app.check_pagination(p_limit, p_offset);
    return query select e.id, e.slug, e.title, e.description, e.starts_at, e.ends_at, m.bucket_name, m.object_path, m.alt_text
        from app.events e left join app.media_assets m on m.id = e.cover_media_id
            and m.is_public_derivative and m.approval_status = 'approved' and m.permission_status = 'authorized'
        where e.status = 'published' and e.published_at <= pg_catalog.statement_timestamp()
        order by e.starts_at, e.id limit p_limit offset p_offset;
end;
$$;
alter function api.published_events(integer, integer) owner to nhs_public_reader;

create function api.published_competitions(p_limit integer default 20, p_offset integer default 0)
returns table (competition_id uuid, slug text, title text, description text, max_votes_per_voter integer,
    starts_at timestamptz, ends_at timestamptz, enabled boolean, paused boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform app.check_pagination(p_limit, p_offset);
    return query select c.id, c.slug, c.title, c.description, c.max_votes_per_voter, c.starts_at, c.ends_at, c.enabled, c.paused
        from app.competitions c where c.published_at <= pg_catalog.statement_timestamp() and c.archived_at is null
        order by c.starts_at, c.id limit p_limit offset p_offset;
end;
$$;
alter function api.published_competitions(integer, integer) owner to nhs_public_reader;

create function api.competition_details(p_slug text)
returns table (competition_id uuid, slug text, title text, description text, max_votes_per_voter integer,
    starts_at timestamptz, ends_at timestamptz, enabled boolean, paused boolean, archived_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform app.check_slug(p_slug);
    return query select c.id, c.slug, c.title, c.description, c.max_votes_per_voter, c.starts_at, c.ends_at, c.enabled, c.paused, c.archived_at
        from app.competitions c where c.slug = p_slug and c.published_at <= pg_catalog.statement_timestamp();
end;
$$;
alter function api.competition_details(text) owner to nhs_public_reader;

create function api.candidate_profiles(p_competition_slug text, p_candidate_slug text default null,
    p_limit integer default 20, p_offset integer default 0)
returns table (candidate_id uuid, competition_slug text, candidate_slug text, display_name text, description text,
    youtube_video_id text, video_start_seconds integer, photo_bucket text, photo_path text, photo_alt text)
language plpgsql stable security definer set search_path = '' as $$
begin
    perform app.check_slug(p_competition_slug);
    if p_candidate_slug is not null then perform app.check_slug(p_candidate_slug); end if;
    perform app.check_pagination(p_limit, p_offset);
    return query select d.id, c.slug, d.slug, d.display_name, d.description, d.youtube_video_id, d.video_start_seconds,
        m.bucket_name, m.object_path, m.alt_text
        from app.candidates d join app.competitions c on c.id = d.competition_id
        left join app.media_assets m on m.id = d.photo_media_id
            and m.is_public_derivative and m.approval_status = 'approved' and m.permission_status = 'authorized'
        where c.slug = p_competition_slug and c.published_at <= pg_catalog.statement_timestamp() and d.eligible
            and (p_candidate_slug is null or d.slug = p_candidate_slug)
        order by d.slug collate "C", d.id limit p_limit offset p_offset;
end;
$$;
alter function api.candidate_profiles(text, text, integer, integer) owner to nhs_public_reader;

create function app.current_staff_role() returns text
language sql stable security invoker set search_path = '' as $$
    select s.role from app.staff_roles s where s.user_id = app.request_user_id() and s.active;
$$;
alter function app.current_staff_role() owner to nhs_identity_reader;

create function api.account_status()
returns table (user_id uuid, staff_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
    if app.request_user_id() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    return query select app.request_user_id(), app.current_staff_role();
end;
$$;
alter function api.account_status() owner to nhs_identity_reader;

create function api.is_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
    if app.request_user_id() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    return coalesce(app.current_staff_role() = 'admin', false);
end;
$$;
alter function api.is_admin() owner to nhs_identity_reader;

create function api.is_super_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
    if app.request_user_id() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
    return coalesce(app.current_staff_role() = 'super_admin', false);
end;
$$;
alter function api.is_super_admin() owner to nhs_identity_reader;

-- These read-only gates prove authorization boundaries; they do no CRUD.
create function api.require_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
    if app.request_user_id() is null or app.current_staff_role() is null
        or app.current_staff_role() not in ('admin', 'super_admin') then
        raise exception 'Active staff required' using errcode = '42501';
    end if;
    return true;
end;
$$;
alter function api.require_admin() owner to nhs_identity_reader;

create function api.require_super_admin() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
    if app.request_user_id() is null or app.current_staff_role() is distinct from 'super_admin' then
        raise exception 'Active Super Admin required' using errcode = '42501';
    end if;
    return true;
end;
$$;
alter function api.require_super_admin() owner to nhs_identity_reader;

-- Explicit allowlist, independent of creator/owner-transfer ACL defaults.
revoke all on function app.check_slug(text), app.check_pagination(integer, integer), app.current_staff_role()
    from public, anon, authenticated, service_role;
revoke all on all functions in schema api from public, anon, authenticated, service_role;
grant execute on function api.published_school_pages(text), api.published_events(integer, integer),
    api.published_competitions(integer, integer), api.competition_details(text),
    api.candidate_profiles(text, text, integer, integer) to anon, authenticated;
grant execute on function api.account_status(), api.is_admin(), api.is_super_admin(), api.require_admin(), api.require_super_admin()
    to authenticated;
revoke create on schema app, api from nhs_public_reader, nhs_identity_reader;
notify pgrst, 'reload schema';
commit;
