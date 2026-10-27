-- Atomic original voting only. Approved migrations and SMS proof lifetime unchanged.
begin;
do $$ begin
    if not exists(select 1 from pg_catalog.pg_roles where rolname='nhs_voting_writer') then
        create role nhs_voting_writer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
    end if;
    if exists(select 1 from pg_catalog.pg_roles where rolname='nhs_voting_writer'
        and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
        or exists(select 1 from pg_catalog.pg_auth_members m where m.member='nhs_voting_writer'::regrole
            or (m.roleid='nhs_voting_writer'::regrole and m.member<>'postgres'::regrole)) then
        raise exception 'Unexpected voting owner attributes/membership';
    end if;
end; $$;
grant nhs_voting_writer to postgres;
grant usage on schema app,api to nhs_voting_writer;
grant create on schema app,api to nhs_voting_writer;
alter default privileges for role nhs_voting_writer revoke all on functions from public,anon,authenticated,service_role;

-- The approved SMS helper is INVOKER. Bridge it under its existing limited owner
-- rather than giving the voting role access to proofs, binding keys or Auth.
create function app.require_voting_identity() returns uuid
language plpgsql volatile security definer set search_path='' as $$
begin
    if (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'role') is distinct from 'authenticated'
        or not app.sms_session_is_valid() then
        raise exception 'Live SMS session proof required' using errcode='42501';
    end if;
    return (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
end; $$;
grant create on schema app to nhs_sms_proof_owner;
alter function app.require_voting_identity() owner to nhs_sms_proof_owner;
revoke create on schema app from nhs_sms_proof_owner;
revoke all on function app.require_voting_identity() from public,anon,authenticated,service_role;
grant execute on function app.require_voting_identity() to nhs_voting_writer;

grant select(id,published_at,enabled,paused,archived_at,starts_at,ends_at,max_votes_per_voter)
    on app.competitions to nhs_voting_writer;
grant select(id,competition_id,eligible) on app.candidates to nhs_voting_writer;
grant select(competition_id,voter_id),insert(competition_id,voter_id) on app.competition_voters to nhs_voting_writer;
grant select(id,competition_id,voter_id,candidate_id,accepted_at),insert(competition_id,voter_id,candidate_id,accepted_at)
    on app.votes to nhs_voting_writer;
-- PostgreSQL needs UPDATE privilege/policy to lock rows. These grants exist
-- solely for SELECT FOR SHARE/UPDATE: WITH CHECK(false) denies actual updates.
grant update(id) on app.competitions to nhs_voting_writer;
grant update(voter_id) on app.competition_voters to nhs_voting_writer;
create policy voting_competition_select on app.competitions for select to nhs_voting_writer
    using(published_at<=pg_catalog.clock_timestamp());
create policy voting_competition_lock on app.competitions for update to nhs_voting_writer
    using(published_at<=pg_catalog.clock_timestamp()) with check(false);
create policy voting_candidate_select on app.candidates for select to nhs_voting_writer
    using(exists(select 1 from app.competitions c where c.id=competition_id));
create policy voting_guard_select on app.competition_voters for select to nhs_voting_writer
    using(voter_id=(select app.require_voting_identity()));
create policy voting_guard_insert on app.competition_voters for insert to nhs_voting_writer
    with check(voter_id=(select app.require_voting_identity()) and exists(select 1 from app.competitions c where c.id=competition_id));
create policy voting_guard_lock on app.competition_voters for update to nhs_voting_writer
    using(voter_id=(select app.require_voting_identity())) with check(false);
create policy voting_own_votes on app.votes for select to nhs_voting_writer
    using(voter_id=(select app.require_voting_identity()));
create policy voting_vote_insert on app.votes for insert to nhs_voting_writer
    with check(voter_id=(select app.require_voting_identity())
        and exists(select 1 from app.candidates d where d.id=app.votes.candidate_id and d.competition_id=app.votes.competition_id and d.eligible)
        and exists(select 1 from app.competitions c where c.id=app.votes.competition_id
            and c.enabled and not c.paused and c.archived_at is null
            and app.votes.accepted_at>=c.starts_at and app.votes.accepted_at<c.ends_at));

create function api.cast_vote(p_competition_id uuid,p_candidate_id uuid)
returns table(vote_id uuid,competition_id uuid,candidate_id uuid,accepted_at timestamptz,replayed boolean,
    max_votes_per_voter integer,accepted_vote_count bigint,remaining_allowance bigint)
language plpgsql volatile security definer set search_path='' set lock_timeout='2s' set statement_timeout='8s' set default_transaction_isolation='read committed' as $$
declare voter uuid; c record; receipt record; used bigint; instant timestamptz; was_replay boolean:=true;
begin
    voter:=app.require_voting_identity();
    perform pg_catalog.set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
    if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
        raise exception 'READ COMMITTED required' using errcode='25001'; end if;
    if p_competition_id is null or p_candidate_id is null then
        raise exception 'Competition and candidate IDs required' using errcode='22023'; end if;
    perform c0.id from app.competitions c0 where c0.id=p_competition_id for share;
    if not found then raise exception 'Competition unavailable' using errcode='P0002'; end if;
    insert into app.competition_voters(competition_id,voter_id) values(p_competition_id,voter)
        on conflict on constraint competition_voters_pkey do nothing;
    perform g.competition_id from app.competition_voters g where g.competition_id=p_competition_id and g.voter_id=voter for update;
    if not found then raise exception 'Voter guard unavailable' using errcode='42501'; end if;
    -- Separate statements after guard acquisition see the preceding transaction's
    -- committed votes at READ COMMITTED; never count from a pre-lock snapshot.
    perform app.require_voting_identity();
    select c0.id,c0.max_votes_per_voter,c0.enabled,c0.paused,c0.archived_at,c0.starts_at,c0.ends_at into c
        from app.competitions c0 where c0.id=p_competition_id;
    select v.id,v.candidate_id,v.accepted_at into receipt from app.votes v
        where v.competition_id=p_competition_id and v.voter_id=voter and v.candidate_id=p_candidate_id;
    if not found then
        if not c.enabled or c.paused or c.archived_at is not null then
            raise exception 'Voting unavailable' using errcode='55000'; end if;
        if not exists(select 1 from app.candidates d where d.id=p_candidate_id and d.competition_id=p_competition_id and d.eligible) then
            raise exception 'Candidate unavailable' using errcode='P0002'; end if;
        select pg_catalog.count(*) into used from app.votes v where v.competition_id=p_competition_id and v.voter_id=voter;
        if used>=c.max_votes_per_voter then raise exception 'Voting allowance exhausted' using errcode='54000'; end if;
        perform app.require_voting_identity();
        instant:=pg_catalog.clock_timestamp();
        if instant<c.starts_at or instant>=c.ends_at then raise exception 'Voting window closed' using errcode='55000'; end if;
        insert into app.votes as v(competition_id,voter_id,candidate_id,accepted_at)
            values(p_competition_id,voter,p_candidate_id,instant)
            on conflict on constraint votes_one_per_candidate do nothing
            returning v.id,v.candidate_id,v.accepted_at into receipt;
        if found then was_replay:=false;
        else
            select v.id,v.candidate_id,v.accepted_at into receipt from app.votes v
                where v.competition_id=p_competition_id and v.voter_id=voter and v.candidate_id=p_candidate_id;
            if not found then raise exception 'Retry vote transaction' using errcode='40001'; end if;
        end if;
    end if;
    perform app.require_voting_identity();
    select pg_catalog.count(*) into used from app.votes v where v.competition_id=p_competition_id and v.voter_id=voter;
    return query select receipt.id,p_competition_id,receipt.candidate_id,receipt.accepted_at,was_replay,
        c.max_votes_per_voter,used,greatest(c.max_votes_per_voter::bigint-used,0::bigint);
end; $$;
alter function api.cast_vote(uuid,uuid) owner to nhs_voting_writer;

create function api.own_voting_state(p_competition_id uuid)
returns table(competition_id uuid,max_votes_per_voter integer,accepted_vote_count bigint,remaining_allowance bigint,
    availability text,receipts jsonb)
language plpgsql volatile security definer set search_path='' set lock_timeout='2s' set statement_timeout='8s' set default_transaction_isolation='read committed' as $$
declare voter uuid;
begin
    voter:=app.require_voting_identity();
    perform pg_catalog.set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
    if pg_catalog.current_setting('transaction_isolation')<>'read committed' then
        raise exception 'READ COMMITTED required' using errcode='25001'; end if;
    if p_competition_id is null then raise exception 'Competition ID required' using errcode='22023'; end if;
    -- One statement/snapshot keeps count and own receipt list consistent without
    -- creating a guard or locking a competition merely to read historical votes.
    return query select c.id,c.max_votes_per_voter,a.used,greatest(c.max_votes_per_voter::bigint-a.used,0::bigint),
        case when c.archived_at is not null then 'archived' when not c.enabled then 'disabled'
            when pg_catalog.clock_timestamp()<c.starts_at then 'upcoming'
            when pg_catalog.clock_timestamp()>=c.ends_at then 'closed' when c.paused then 'paused' else 'active' end,
        a.items from app.competitions c cross join lateral (
            select pg_catalog.count(*) as used,coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                'vote_id',v.id,'candidate_id',v.candidate_id,'accepted_at',v.accepted_at) order by v.accepted_at,v.id),'[]'::jsonb) as items
            from app.votes v where v.competition_id=c.id and v.voter_id=voter
        ) a where c.id=p_competition_id;
    if not found then raise exception 'Competition unavailable' using errcode='P0002'; end if;
end; $$;
alter function api.own_voting_state(uuid) owner to nhs_voting_writer;
revoke all on function api.cast_vote(uuid,uuid),api.own_voting_state(uuid) from public,anon,authenticated,service_role;
grant execute on function api.cast_vote(uuid,uuid),api.own_voting_state(uuid) to authenticated;
revoke create on schema app,api from nhs_voting_writer;
comment on table app.votes is 'Immutable original votes. Only reviewed cast_vote admits application votes using competition SHARE then own-guard UPDATE locking, live SMS proof and ledger-derived allowance.';
notify pgrst,'reload schema';
commit;
