-- Operator-run LOCAL psql script only. Not installed as a function or RPC.
-- Provision the identity with local Auth first. Required psql variables:
-- bootstrap_user_id and bootstrap_reason. No default identity or credentials.
\set ON_ERROR_STOP on
begin;
create temporary table bootstrap_context (target_id uuid not null, reason text not null) on commit drop;
insert into bootstrap_context values (:'bootstrap_user_id'::uuid, :'bootstrap_reason');
lock table app.staff_roles in exclusive mode;
do $$
declare
    target uuid := (select target_id from bootstrap_context);
    action_reason text := (select reason from bootstrap_context);
begin
    if session_user <> 'postgres' or current_user <> 'postgres' then
        raise exception 'Trusted local migration operator required' using errcode = '42501';
    end if;
    if pg_catalog.char_length(pg_catalog.btrim(action_reason)) not between 1 and 2000 then
        raise exception 'Bootstrap reason required' using errcode = '22023';
    end if;
    if exists (select 1 from app.staff_roles where role = 'super_admin') then
        raise exception 'First Super Admin already exists' using errcode = '55000';
    end if;
    if not exists (select 1 from auth.users where id = target and email is not null
        and email_confirmed_at is not null and not coalesce(is_anonymous, false)) then
        raise exception 'Confirmed local Auth identity required' using errcode = '22023';
    end if;
    insert into app.staff_roles (user_id, role, active, granted_by) values (target, 'super_admin', true, target);
    insert into app.audit_logs (actor_id, actor_role, action, target_type, target_id, reason, details)
        values (target, 'operator', 'bootstrap_super_admin', 'staff_roles', target, action_reason,
            pg_catalog.jsonb_build_object('database_operator', session_user, 'method', 'local_operator_script'));
end;
$$;
commit;
