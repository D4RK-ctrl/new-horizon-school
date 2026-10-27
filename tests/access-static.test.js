import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const roles = read('supabase/migrations/20261027000400_access_roles_and_policies.sql').replace(/--[^\n]*/g, '');
const routines = read('supabase/migrations/20261027000500_read_only_api.sql').replace(/--[^\n]*/g, '');
const publicNames = ['published_school_pages', 'published_events', 'published_competitions', 'competition_details', 'candidate_profiles'];
const protectedNames = ['account_status', 'is_admin', 'is_super_admin', 'require_admin', 'require_super_admin'];

test('access: forward migration order and exact API inventory', () => {
  assert.equal(readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((name) => /^20261027000[1-5]00_.*\.sql$/.test(name)).length, 5);
  assert.deepEqual([...routines.matchAll(/create function api\.(\w+)\(/g)].map((m) => m[1]), [...publicNames, ...protectedNames]);
  for (const source of [roles, routines]) { assert.match(source.trim(), /^begin;/); assert.match(source.trim(), /commit;$/); }
});
test('access: definer entry points have safe owner/path and no protected-data or mutation SQL', () => {
  const definitions = [...routines.matchAll(/create function api\.(\w+)\(([\s\S]*?)\$\$;/g)];
  assert.equal(definitions.length, 10);
  for (const [source, name] of definitions) {
    assert.match(source, /stable security definer set search_path = ''/);
    assert.match(routines, new RegExp(`alter function api\\.${name}\\([^;]*owner to nhs_${publicNames.includes(name) ? 'public' : 'identity'}_reader;`));
  }
  const bodies = [...routines.matchAll(/as \$\$([\s\S]*?)\$\$;/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(bodies, /\b(insert into|update app\.|delete from|execute\s|select \*)/i);
  assert.doesNotMatch(routines, /app\.(votes|vote_adjustments|audit_logs|enquiries|result_rows|result_publications)\b/);
  assert.doesNotMatch(routines, /\b(user_metadata|raw_user_meta_data|current_result_publication_id|official_total|rank)\b/);
});
test('access: grants are explicit and roles cannot bypass RLS or log in', () => {
  assert.equal([...roles.matchAll(/nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit/g)].length, 2);
  assert.match(roles, /grant nhs_public_reader, nhs_identity_reader to postgres;/);
  assert.equal([...roles.matchAll(/create policy/g)].length, 6);
  assert.equal([...roles.matchAll(/for select to nhs_/g)].length, 6);
  assert.doesNotMatch(roles, /grant (?:select|all)[^;]*to (?:anon|authenticated|public|service_role)\b/i);
  assert.match(routines, /revoke all on all functions in schema api from public, anon, authenticated, service_role;/);
  const grants = [...routines.matchAll(/grant execute on function ([\s\S]*?) to ([^;]+);/g)];
  assert.equal(grants.length, 2);
  assert.equal(grants[0][2], 'anon, authenticated');
  assert.equal(grants[1][2], 'authenticated');
  assert.deepEqual([...grants[0][1].matchAll(/api\.(\w+)/g)].map((m) => m[1]), publicNames);
  assert.deepEqual([...grants[1][1].matchAll(/api\.(\w+)/g)].map((m) => m[1]), protectedNames);
  assert.match(routines, /revoke create on schema app, api from nhs_public_reader, nhs_identity_reader;/);
});
test('access: published projections, neutral order and bounded arguments are explicit', () => {
  assert.match(roles, /is_public_derivative and approval_status = 'approved' and permission_status = 'authorized'/);
  assert.match(routines, /order by d\.slug collate "C", d\.id/);
  assert.match(routines, /p_limit not between 1 and 100 or p_offset not between 0 and 10000/);
  assert.match(routines, /p_slug !~ '\^\[a-z0-9\]/);
  assert.match(routines, /using errcode = '22023'/);
  assert.match(roles, /user_id = \(select app\.request_user_id\(\)\)/);
  assert.match(roles, /current_setting\('request\.jwt\.claims', true\)/);
});
test('access: first-Super-Admin bootstrap is an audited local operator script, not a routine', () => {
  const source = read('supabase/scripts/bootstrap_local_super_admin.sql').replace(/--[^\n]*/g, '');
  assert.match(source, /lock table app\.staff_roles in exclusive mode;/);
  assert.match(source, /session_user <> 'postgres' or current_user <> 'postgres'/);
  assert.match(source, /exists \(select 1 from app\.staff_roles where role = 'super_admin'\)/);
  assert.match(source, /insert into app\.audit_logs/);
  assert.match(source.trim(), /commit;$/);
  assert.doesNotMatch(source, /create function|security definer|insert into auth\.|update auth\./i);
  assert.doesNotMatch(roles + routines, /create function [\w.]*bootstrap/i);
});
test('access: local API exposes only api and no credentials are configured', () => {
  const config = read('supabase/config.toml');
  assert.match(config, /schemas = \["api"\]/);
  assert.doesNotMatch(config, /schemas = \[[^\n]*"app"/);
  assert.doesNotMatch(config, /jwt_secret\s*=|service_role_key\s*=|supabase\.co/);
});
