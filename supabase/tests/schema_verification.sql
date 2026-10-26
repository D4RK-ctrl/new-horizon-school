-- PENDING EXECUTION. psql integration checks for a DISPOSABLE LOCAL database.
-- Requires all migrations, the same trusted migration owner, and one synthetic
-- auth.users identity already provisioned through local Auth (no Auth DML here).
-- Run: psql ... -v ON_ERROR_STOP=1 -v test_user_id=UUID -f this-file.sql
-- Everything created/inserted here is rolled back. No real identities/data.
\set ON_ERROR_STOP on
begin;
create temporary table schema_test_context (user_id uuid not null) on commit drop;
insert into schema_test_context values (:'test_user_id'::uuid);

create function pg_temp.expect_failure(command text, expected_state text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
    caught_state text;
begin
    begin
        execute command;
    exception when others then
        get stacked diagnostics caught_state = returned_sqlstate;
    end;
    if caught_state is distinct from expected_state then
        raise exception 'Expected SQLSTATE %, got % for %', expected_state, coalesce(caught_state, 'success'), command;
    end if;
end;
$$;

do $$
declare
    table_names text[] := array['staff_roles', 'media_assets', 'school_pages', 'events', 'competitions', 'candidates', 'gallery_items', 'competition_voters', 'votes', 'vote_adjustment_requests', 'vote_adjustments', 'result_publications', 'result_rows', 'enquiries', 'analytics_daily', 'audit_logs'];
    table_name text;
    role_name text;
    table_oid oid;
    voter uuid := (select user_id from schema_test_context);
    competition_a uuid := gen_random_uuid();
    competition_b uuid := gen_random_uuid();
    candidate_a uuid := gen_random_uuid();
    candidate_b uuid := gen_random_uuid();
    publication_a uuid := gen_random_uuid();
    publication_b uuid := gen_random_uuid();
    request_a uuid := gen_random_uuid();
    passed integer := 0;
begin
    if not exists (select 1 from auth.users where id = voter) then
        raise exception 'Provision a synthetic LOCAL Auth test identity first; no Auth tables are written by this test';
    end if;
    if (select count(*) from pg_tables where schemaname = 'app') <> 16 then raise exception 'Wrong application table inventory'; end if;
    foreach table_name in array table_names loop
        table_oid := to_regclass(format('app.%I', table_name));
        if table_oid is null or not (select relrowsecurity from pg_class where oid = table_oid) then raise exception 'Missing table/RLS: %', table_name; end if;
        if not exists (select 1 from pg_constraint where conrelid = table_oid and contype = 'p') then raise exception 'Missing primary key: %', table_name; end if;
        if exists (select 1 from pg_constraint where conrelid = table_oid and not convalidated) then raise exception 'Unvalidated constraint: %', table_name; end if;
        -- Baseline has no policies. The access foundation adds only named SELECT
        -- policies for non-login readers; client-role/default policies stay forbidden.
        if exists (select 1 from pg_policy where polrelid = table_oid and not (
            (polname = 'public_content_read' and polcmd = 'r'
                and polroles = array[coalesce(to_regrole('nhs_public_reader')::oid, 0::oid)])
            or (polname = 'own_active_staff_read' and polcmd = 'r'
                and polroles = array[coalesce(to_regrole('nhs_identity_reader')::oid, 0::oid)])
        )) then raise exception 'Unexpected client or mutation policy: %', table_name; end if;
        foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
            if has_schema_privilege(role_name, 'app', 'USAGE,CREATE') or has_table_privilege(role_name, table_oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Unexpected access for % on %', role_name, table_name; end if;
        end loop;
        if exists (select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a where c.oid = table_oid and a.grantee = 0) then raise exception 'PUBLIC table privilege: %', table_name; end if;
    end loop;
    passed := passed + 1;

    insert into app.competitions (id, slug, title, max_votes_per_voter, starts_at, ends_at, published_by, published_at, created_by, updated_by)
        values (competition_a, 'schema-test-' || competition_a, 'Synthetic A', 3, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', voter, '2026-01-01T00:00:00Z', voter, voter),
               (competition_b, 'schema-test-' || competition_b, 'Synthetic B', 2, '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', voter, '2026-01-01T00:00:00Z', voter, voter);
    insert into app.candidates (id, competition_id, slug, display_name, created_by, updated_by)
        values (candidate_a, competition_a, 'synthetic-a', 'Synthetic candidate A', voter, voter),
               (candidate_b, competition_b, 'synthetic-b', 'Synthetic candidate B', voter, voter);
    insert into app.competition_voters (competition_id, voter_id) values (competition_a, voter), (competition_b, voter);
    insert into app.votes (competition_id, voter_id, candidate_id) values (competition_a, voter, candidate_a);
    perform pg_temp.expect_failure(format('insert into app.votes (competition_id, voter_id, candidate_id) values (%L, %L, %L)', competition_a, voter, candidate_a), '23505');
    perform pg_temp.expect_failure(format('insert into app.votes (competition_id, voter_id, candidate_id) values (%L, %L, %L)', competition_a, voter, candidate_b), '23503');
    passed := passed + 2;

    perform pg_temp.expect_failure(format('update app.competitions set max_votes_per_voter = 0 where id = %L', competition_a), '23514');
    perform pg_temp.expect_failure(format('update app.competitions set max_votes_per_voter = -1 where id = %L', competition_a), '23514');
    perform pg_temp.expect_failure(format('update app.competitions set max_votes_per_voter = 1001 where id = %L', competition_a), '23514');
    perform pg_temp.expect_failure(format('update app.competitions set starts_at = ends_at where id = %L', competition_a), '23514');
    perform pg_temp.expect_failure(format('update app.competitions set show_live_counts = true, show_vote_totals = false where id = %L', competition_a), '23514');
    update app.competitions set show_rankings = true, show_vote_totals = false, show_live_counts = false where id = competition_a;
    passed := passed + 6;

    insert into app.result_publications (id, competition_id, version, outcome, published_by, ledger_cutoff_at)
        values (publication_a, competition_a, 1, 'winners', voter, '2026-01-02T00:00:00Z'),
               (publication_b, competition_b, 1, 'no_votes_received', voter, '2026-01-02T00:00:00Z');
    perform pg_temp.expect_failure(format('update app.competitions set current_result_publication_id = %L where id = %L', publication_b, competition_a), '23503');
    update app.competitions set current_result_publication_id = publication_a where id = competition_a;
    perform pg_temp.expect_failure(format('insert into app.result_publications (competition_id, version, outcome, published_by, ledger_cutoff_at) values (%L, 1, %L, %L, %L)', competition_a, 'winners', voter, '2026-01-02T00:00:00Z'), '23505');
    perform pg_temp.expect_failure(format('insert into app.result_rows (publication_id, candidate_id, competition_id, outcome, original_count, adjustment_sum, official_total, rank) values (%L,%L,%L,%L,0,0,0,1)', publication_a, candidate_b, competition_b, 'winners'), '23503');
    perform pg_temp.expect_failure(format('insert into app.result_rows (publication_id, candidate_id, competition_id, outcome, original_count, adjustment_sum, official_total, rank) values (%L,%L,%L,%L,0,0,0,1)', publication_a, candidate_b, competition_a, 'winners'), '23503');
    perform pg_temp.expect_failure(format('insert into app.result_rows (publication_id, candidate_id, competition_id, outcome, original_count, adjustment_sum, official_total, rank) values (%L,%L,%L,%L,0,-1,-1,1)', publication_a, candidate_a, competition_a, 'winners'), '23514');
    perform pg_temp.expect_failure(format('insert into app.result_rows (publication_id, candidate_id, competition_id, outcome, original_count, adjustment_sum, official_total, rank, is_winner) values (%L,%L,%L,%L,0,0,0,1,true)', publication_b, candidate_b, competition_b, 'no_votes_received'), '23514');
    insert into app.result_rows (publication_id, candidate_id, competition_id, outcome, original_count, adjustment_sum, official_total, rank, is_winner)
        values (publication_a, candidate_a, competition_a, 'winners', 1, 0, 1, 1, true), (publication_b, candidate_b, competition_b, 'no_votes_received', 0, 0, 0, 1, false);
    passed := passed + 7;

    insert into app.vote_adjustment_requests (id, competition_id, candidate_id, delta, reason, proposed_by)
        values (request_a, competition_a, candidate_a, 1, 'Synthetic schema test', voter);
    perform pg_temp.expect_failure(format('update app.vote_adjustment_requests set state = %L where id = %L', 'applied', request_a), '23514');
    perform pg_temp.expect_failure(format('update app.vote_adjustment_requests set state = %L where id = %L', 'approved', request_a), '23514');
    perform pg_temp.expect_failure(format('insert into app.vote_adjustments (competition_id,candidate_id,request_id,delta,reason,applied_by) values (%L,%L,%L,1,%L,%L)', competition_a, candidate_a, request_a, 'Synthetic schema test', voter), '23503');
    update app.vote_adjustment_requests set state = 'approved', reviewed_by = voter, reviewed_at = clock_timestamp() where id = request_a;
    insert into app.vote_adjustments (competition_id,candidate_id,request_id,delta,reason,applied_by)
        values (competition_a, candidate_a, request_a, 1, 'Synthetic schema test', voter);
    perform pg_temp.expect_failure(format('insert into app.vote_adjustments (competition_id,candidate_id,request_id,delta,reason,applied_by) values (%L,%L,%L,1,%L,%L)', competition_a, candidate_a, request_a, 'Synthetic schema test', voter), '23505');
    passed := passed + 4;

    foreach table_name in array array['votes', 'vote_adjustments', 'result_publications', 'result_rows', 'audit_logs'] loop
        perform pg_temp.expect_failure(format('delete from app.%I where false', table_name), '55000');
        perform pg_temp.expect_failure(format('update app.%I set %I = %I where false', table_name, case when table_name = 'result_rows' then 'rank' else 'id' end, case when table_name = 'result_rows' then 'rank' else 'id' end), '55000');
        perform pg_temp.expect_failure(format('truncate app.%I cascade', table_name), '55000');
        passed := passed + 3;
    end loop;
    raise notice 'PASS: % integration assertion groups (rolled back)', passed;
end;
$$;

-- Probe future defaults under the SAME creator; never committed.
create table app.schema_default_probe (id integer);
create function app.schema_default_probe() returns integer language sql security invoker as 'select 1';
do $$
declare role_name text;
begin
    foreach role_name in array array['anon', 'authenticated', 'service_role'] loop
        if has_table_privilege(role_name, 'app.schema_default_probe', 'SELECT,INSERT,UPDATE,DELETE') or has_function_privilege(role_name, 'app.schema_default_probe()', 'EXECUTE') then raise exception 'Unexpected future-object default grants for %', role_name; end if;
        if has_function_privilege(role_name, 'app.reject_immutable_mutation()', 'EXECUTE') then raise exception 'Unexpected helper EXECUTE grant'; end if;
    end loop;
    raise notice 'PASS: future table/function privilege defaults and helper permissions (rolled back)';
end;
$$;
rollback;
