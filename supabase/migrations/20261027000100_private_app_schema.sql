-- Initial baseline, part 1: private namespace and deny-by-default privileges.
-- Requires Supabase-managed anon, authenticated, service_role and auth.users.
-- Apply as the same trusted migration owner for every baseline migration.
begin;

create schema app;
revoke all on schema app from public, anon, authenticated, service_role;

-- PostgreSQL's implicit PUBLIC function EXECUTE privilege is global. A scoped
-- revoke alone cannot remove a global default. These global revokes affect only
-- FUTURE objects created by THIS migration owner, including in other schemas.
-- Existing Supabase/Auth objects and their grants are not altered.
alter default privileges revoke all on tables from public, anon, authenticated, service_role;
alter default privileges revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges revoke all on functions from public, anon, authenticated, service_role;

-- Also remove any schema-specific additions for this creator in app.
alter default privileges in schema app revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema app revoke all on functions from public, anon, authenticated, service_role;

comment on schema app is 'Private application storage. Never add to Data API exposed schemas. Access requires future reviewed RPCs.';
commit;
