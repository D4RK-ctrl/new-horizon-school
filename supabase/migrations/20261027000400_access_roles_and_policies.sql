-- Forward-only access foundation: no client table grants or product mutations.
begin;

-- Roles survive a local database reset. Reuse only the expected inert roles.
do $$
begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'nhs_public_reader') then
        create role nhs_public_reader nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
    end if;
    if not exists (select 1 from pg_catalog.pg_roles where rolname = 'nhs_identity_reader') then
        create role nhs_identity_reader nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname in ('nhs_public_reader', 'nhs_identity_reader')
        and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit)) then
        raise exception 'Unexpected access-owner role attributes';
    end if;
    if exists (select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = m.member
        where r.rolname in ('nhs_public_reader', 'nhs_identity_reader') and member_role.rolname <> 'postgres') then
        raise exception 'Unexpected access-owner membership';
    end if;
    if exists (select 1 from pg_catalog.pg_auth_members m join pg_catalog.pg_roles r on r.oid = m.member
        where r.rolname in ('nhs_public_reader', 'nhs_identity_reader')) then
        raise exception 'Access owners must not inherit other roles';
    end if;
end;
$$;
grant nhs_public_reader, nhs_identity_reader to postgres;

create schema api;
revoke all on schema api from public, anon, authenticated, service_role;
grant usage on schema api to anon, authenticated, nhs_public_reader, nhs_identity_reader;
grant usage on schema app to nhs_public_reader, nhs_identity_reader;

-- These creators must also default-deny future routines. Existing baseline
-- defaults already harden postgres. No client gets membership in owner roles.
alter default privileges for role nhs_public_reader revoke all on functions from public, anon, authenticated, service_role;
alter default privileges for role nhs_identity_reader revoke all on functions from public, anon, authenticated, service_role;

grant select (page_key, title, content, status, published_at) on app.school_pages to nhs_public_reader;
grant select (id, slug, title, description, starts_at, ends_at, status, cover_media_id, published_at) on app.events to nhs_public_reader;
grant select (id, slug, title, description, max_votes_per_voter, starts_at, ends_at, enabled, paused, archived_at, published_at) on app.competitions to nhs_public_reader;
grant select (id, competition_id, slug, display_name, description, photo_media_id, eligible, youtube_video_id, video_start_seconds) on app.candidates to nhs_public_reader;
grant select (id, bucket_name, object_path, alt_text, approval_status, permission_status, is_public_derivative) on app.media_assets to nhs_public_reader;
grant select (user_id, role, active) on app.staff_roles to nhs_identity_reader;

create policy public_content_read on app.school_pages for select to nhs_public_reader
    using (status = 'published' and published_at <= pg_catalog.statement_timestamp());
create policy public_content_read on app.events for select to nhs_public_reader
    using (status = 'published' and published_at <= pg_catalog.statement_timestamp());
create policy public_content_read on app.competitions for select to nhs_public_reader
    using (published_at <= pg_catalog.statement_timestamp());
create policy public_content_read on app.candidates for select to nhs_public_reader
    using (eligible and exists (
        select 1 from app.competitions c where c.id = competition_id
            and c.published_at <= pg_catalog.statement_timestamp()
    ));
create policy public_content_read on app.media_assets for select to nhs_public_reader
    using (is_public_derivative and approval_status = 'approved' and permission_status = 'authorized');

-- Parse only the sub from PostgREST's verified JWT context, never user_metadata.
-- No Auth schema grants or Auth table access are needed by the limited owner.
create function app.request_user_id() returns uuid
language sql stable security invoker set search_path = ''
as $$
    select (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;
revoke all on function app.request_user_id() from public, anon, authenticated, service_role;
grant create on schema app to nhs_identity_reader;
alter function app.request_user_id() owner to nhs_identity_reader;
revoke create on schema app from nhs_identity_reader;

create policy own_active_staff_read on app.staff_roles for select to nhs_identity_reader
    using (active and user_id = (select app.request_user_id()));

-- API users retain zero schema/table rights in app, including staff members.
revoke all on schema app from public, anon, authenticated, service_role;
revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all sequences in schema app from public, anon, authenticated, service_role;
commit;
