-- Server-mediated SMS proof only. No vote submission or Auth-table writes.
begin;
create extension if not exists pgcrypto with schema extensions;
do $$ begin
    if not exists (select 1 from pg_catalog.pg_roles where rolname='nhs_sms_proof_owner') then
        create role nhs_sms_proof_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    end if;
    if exists (select 1 from pg_catalog.pg_roles where rolname='nhs_sms_proof_owner'
        and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
        or exists (select 1 from pg_catalog.pg_auth_members m where m.member='nhs_sms_proof_owner'::regrole
            or (m.roleid='nhs_sms_proof_owner'::regrole and m.member<>'postgres'::regrole)) then
        raise exception 'Unexpected SMS proof owner attributes/membership';
    end if;
end; $$;
grant nhs_sms_proof_owner to postgres;
grant usage on schema app,api,extensions to nhs_sms_proof_owner;
grant create on schema app,api to nhs_sms_proof_owner;
alter default privileges for role nhs_sms_proof_owner revoke all on functions from public,anon,authenticated,service_role;

create table app.sms_proof_key (
    singleton boolean primary key default true check (singleton),
    secret bytea not null check (octet_length(secret)=32)
);
insert into app.sms_proof_key values (true,extensions.gen_random_bytes(32));

create table app.sms_verification_limits (
    bucket_key text primary key check (bucket_key ~ '^[pn]:[0-9a-f]{64}$'),
    window_started_at timestamptz not null default clock_timestamp(),
    attempts integer not null check (attempts between 1 and 20)
);
create table app.sms_verification_challenges (
    user_id uuid not null references auth.users(id) on delete cascade,
    sent_at timestamptz not null,
    phone_binding bytea not null check (octet_length(phone_binding)=32),
    lease_id uuid not null unique default gen_random_uuid(),
    leased_at timestamptz not null default clock_timestamp(),
    lease_until timestamptz not null,
    consumed_at timestamptz,
    primary key (user_id,sent_at),
    check (lease_until>=leased_at),
    check (consumed_at is null or consumed_at>=leased_at)
);
create table app.sms_session_attestations (
    session_id uuid primary key references auth.sessions(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    challenge_sent_at timestamptz not null,
    phone_binding bytea not null check (octet_length(phone_binding)=32),
    phone_confirmed_at timestamptz not null,
    verified_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null,
    foreign key (user_id,challenge_sent_at) references app.sms_verification_challenges(user_id,sent_at) on delete cascade,
    unique (user_id,challenge_sent_at),
    check (expires_at>verified_at and expires_at<=verified_at+interval '15 minutes')
);
create index sms_attestations_user on app.sms_session_attestations(user_id);
create index sms_attestations_expiry on app.sms_session_attestations(expires_at);
create index sms_challenge_expiry on app.sms_verification_challenges(lease_until) where consumed_at is null;

alter table app.sms_proof_key enable row level security;
alter table app.sms_verification_limits enable row level security;
alter table app.sms_verification_challenges enable row level security;
alter table app.sms_session_attestations enable row level security;
revoke all on app.sms_proof_key,app.sms_verification_limits,app.sms_verification_challenges,app.sms_session_attestations
    from public,anon,authenticated,service_role;
grant select on app.sms_proof_key to nhs_sms_proof_owner;
grant select,insert on app.sms_session_attestations to nhs_sms_proof_owner;
grant select,insert on app.sms_verification_limits,app.sms_verification_challenges to nhs_sms_proof_owner;
grant update(window_started_at,attempts) on app.sms_verification_limits to nhs_sms_proof_owner;
grant update(lease_id,leased_at,lease_until,consumed_at) on app.sms_verification_challenges to nhs_sms_proof_owner;
create policy sms_select on app.sms_proof_key for select to nhs_sms_proof_owner using (true);
create policy sms_select on app.sms_session_attestations for select to nhs_sms_proof_owner using (true);
create policy sms_insert on app.sms_session_attestations for insert to nhs_sms_proof_owner with check (true);
create policy sms_select on app.sms_verification_limits for select to nhs_sms_proof_owner using (true);
create policy sms_insert on app.sms_verification_limits for insert to nhs_sms_proof_owner with check (true);
create policy sms_update on app.sms_verification_limits for update to nhs_sms_proof_owner using (true) with check (true);
create policy sms_select on app.sms_verification_challenges for select to nhs_sms_proof_owner using (true);
create policy sms_insert on app.sms_verification_challenges for insert to nhs_sms_proof_owner with check (true);
create policy sms_update on app.sms_verification_challenges for update to nhs_sms_proof_owner using (true) with check (true);
grant execute on function extensions.hmac(bytea,bytea,text) to nhs_sms_proof_owner;

-- Auth owns its schema ACL/RLS. Do not change managed table policies, ownership,
-- or grants. These two non-API operator-owned projections bypass Auth RLS only
-- for the exact required facts. No token/hash/credential is returned or written.
create function app.sms_auth_challenge(p_phone text) returns table(user_id uuid,sent_at timestamptz)
language sql volatile security definer set search_path='' as $$
    select u.id,u.confirmation_sent_at from auth.users u where u.phone=p_phone and not u.is_anonymous
        and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
        and u.confirmation_token<>''
        and u.confirmation_sent_at between pg_catalog.clock_timestamp()-interval '60 seconds' and pg_catalog.clock_timestamp();
$$;
create function app.sms_auth_session(p_user_id uuid,p_session_id uuid)
returns table(phone text,phone_confirmed_at timestamptz,created_at timestamptz,not_after timestamptz,has_otp boolean)
language sql volatile security definer set search_path='' as $$
    select u.phone,u.phone_confirmed_at,s.created_at,s.not_after,
        exists(select 1 from auth.mfa_amr_claims m where m.session_id=s.id and m.authentication_method='otp')
    from auth.users u join auth.sessions s on s.user_id=u.id
    where u.id=p_user_id and s.id=p_session_id and u.phone ~ '^91[0-9]{10}$' and u.phone_confirmed_at is not null
        and not u.is_anonymous and (u.banned_until is null or u.banned_until<=pg_catalog.clock_timestamp())
        and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp());
$$;
alter function app.sms_auth_challenge(text) owner to postgres;
alter function app.sms_auth_session(uuid,uuid) owner to postgres;
revoke all on function app.sms_auth_challenge(text),app.sms_auth_session(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function app.sms_auth_challenge(text),app.sms_auth_session(uuid,uuid) to nhs_sms_proof_owner;

create function app.sms_phone_binding(p_user uuid,p_phone text) returns bytea
language sql stable security invoker set search_path='' as $$
    select extensions.hmac(pg_catalog.convert_to(p_user::text || ':' || p_phone,'UTF8'),k.secret,'sha256')
    from app.sms_proof_key k where k.singleton;
$$;
alter function app.sms_phone_binding(uuid,text) owner to nhs_sms_proof_owner;

-- Server-only: reserve the provider's pending SMS challenge before exchanging
-- its OTP. One leased challenge can produce at most one attestation, including
-- when local fixed-code Auth bypasses normal OTP consumption/expiry.
create function api.reserve_sms_verification(p_phone text,p_network_key text) returns uuid
language plpgsql volatile security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare
    u record; t timestamptz:=pg_catalog.clock_timestamp(); b text; cap integer;
    phone_key text; result uuid; c record;
begin
    if p_phone is null or p_phone !~ '^91[0-9]{10}$' or p_network_key is null or p_network_key !~ '^[0-9a-f]{64}$' then
        raise exception 'Invalid verification input' using errcode='22023';
    end if;
    select pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(p_phone,'UTF8'),k.secret,'sha256'),'hex')
        into phone_key from app.sms_proof_key k where k.singleton;
    -- Consistent key order across both durable buckets prevents deadlocks.
    for b in select x from pg_catalog.unnest(array['p:'||phone_key,'n:'||p_network_key]) x order by x loop
        cap:=case when pg_catalog.left(b,2)='p:' then 5 else 20 end;
        insert into app.sms_verification_limits(bucket_key,attempts) values(b,1)
        on conflict(bucket_key) do update set
            attempts=case when app.sms_verification_limits.window_started_at<=t-interval '5 minutes' then 1
                else app.sms_verification_limits.attempts+1 end,
            window_started_at=case when app.sms_verification_limits.window_started_at<=t-interval '5 minutes' then t
                else app.sms_verification_limits.window_started_at end
        where app.sms_verification_limits.window_started_at<=t-interval '5 minutes' or app.sms_verification_limits.attempts<cap;
        if not found then raise exception 'Verification rate limit' using errcode='P0001'; end if;
    end loop;
    select a.user_id as id,p_phone as phone,a.sent_at as confirmation_sent_at into u from app.sms_auth_challenge(p_phone) a;
    -- Returning NULL commits rate usage even for absent/expired/consumed codes.
    if not found then return null; end if;
    insert into app.sms_verification_challenges(user_id,sent_at,phone_binding,lease_until)
        values(u.id,u.confirmation_sent_at,app.sms_phone_binding(u.id,u.phone),t+interval '30 seconds')
        on conflict(user_id,sent_at) do nothing returning lease_id into result;
    select * into c from app.sms_verification_challenges where user_id=u.id and sent_at=u.confirmation_sent_at for update;
    t:=pg_catalog.clock_timestamp();
    if c.consumed_at is not null or c.sent_at<t-interval '60 seconds'
        or c.phone_binding<>app.sms_phone_binding(u.id,u.phone) then return null; end if;
    -- The creating statement's lease is usable immediately; an existing lease
    -- blocks concurrent attempts until cancellation or expiry.
    if result is not null then return result;
    elsif c.lease_until<=t then
        update app.sms_verification_challenges set lease_id=pg_catalog.gen_random_uuid(),leased_at=t,
            lease_until=t+interval '30 seconds' where user_id=u.id and sent_at=u.confirmation_sent_at returning lease_id into result;
    else return null;
    end if;
    return result;
end; $$;
alter function api.reserve_sms_verification(text,text) owner to nhs_sms_proof_owner;

create function api.cancel_sms_verification(p_lease_id uuid) returns void
language sql volatile security definer set search_path='' as $$
    update app.sms_verification_challenges set lease_until=leased_at where lease_id=p_lease_id and consumed_at is null;
$$;
alter function api.cancel_sms_verification(uuid) owner to nhs_sms_proof_owner;

create function api.attest_sms_session(p_lease_id uuid,p_session_id uuid) returns timestamptz
language plpgsql volatile security definer set search_path='' set lock_timeout='2s' set statement_timeout='5s' as $$
declare c record; s record; t timestamptz; deadline timestamptz;
begin
    select * into c from app.sms_verification_challenges where lease_id=p_lease_id for update;
    t:=pg_catalog.clock_timestamp();
    if not found or c.consumed_at is not null or c.lease_until<=t or c.sent_at<t-interval '60 seconds' then
        raise exception 'Verification unavailable' using errcode='42501'; end if;
    select * into s from app.sms_auth_session(c.user_id,p_session_id);
    if not found or not s.has_otp or app.sms_phone_binding(c.user_id,s.phone)<>c.phone_binding
        or s.created_at<c.leased_at-interval '1 second' or s.created_at>t then
        raise exception 'Verification unavailable' using errcode='42501'; end if;
    deadline:=least(s.created_at+interval '15 minutes',s.not_after);
    insert into app.sms_session_attestations(session_id,user_id,challenge_sent_at,phone_binding,phone_confirmed_at,expires_at)
        values(p_session_id,c.user_id,c.sent_at,c.phone_binding,s.phone_confirmed_at,deadline);
    update app.sms_verification_challenges set consumed_at=pg_catalog.clock_timestamp() where lease_id=p_lease_id;
    return deadline;
end; $$;
alter function api.attest_sms_session(uuid,uuid) owner to nhs_sms_proof_owner;

create function app.sms_session_is_valid() returns boolean
language sql volatile security invoker set search_path='' as $$
    select exists(select 1 from app.sms_session_attestations p
        cross join lateral app.sms_auth_session(p.user_id,p.session_id) s
        where p.user_id=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
        and p.session_id=(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid
        and p.expires_at>pg_catalog.clock_timestamp()
        and (s.not_after is null or s.not_after>pg_catalog.clock_timestamp())
        and s.phone_confirmed_at=p.phone_confirmed_at
        and app.sms_phone_binding(p.user_id,s.phone)=p.phone_binding);
$$;
alter function app.sms_session_is_valid() owner to nhs_sms_proof_owner;
create function api.sms_session_status() returns boolean
language sql volatile security definer set search_path='' as $$ select app.sms_session_is_valid(); $$;
alter function api.sms_session_status() owner to nhs_sms_proof_owner;

revoke all on function app.sms_phone_binding(uuid,text),app.sms_session_is_valid(),
    api.reserve_sms_verification(text,text),api.cancel_sms_verification(uuid),api.attest_sms_session(uuid,uuid),api.sms_session_status()
    from public,anon,authenticated,service_role;
grant usage on schema api to service_role;
grant execute on function api.reserve_sms_verification(text,text),api.cancel_sms_verification(uuid),api.attest_sms_session(uuid,uuid) to service_role;
grant execute on function api.sms_session_status() to authenticated;
revoke create on schema app,api from nhs_sms_proof_owner;
notify pgrst,'reload schema';
commit;
