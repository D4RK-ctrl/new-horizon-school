import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../supabase/migrations/20261027000600_competition_management.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n').replace(/--[^\n]*/g,'');
const mutations = ['create_competition','update_draft_competition','set_competition_visibility','publish_competition','set_competition_paused','add_candidate','update_candidate'];
const reads = ['managed_competitions','managed_candidates'];

test('management: exact forward API and safe function ownership',()=>{
  assert.match(source.trim(),/^begin;/);assert.match(source.trim(),/commit;$/);
  const entries=[...source.matchAll(/create function api\.(\w+)\(([\s\S]*?)\$\$;/g)];
  assert.deepEqual(entries.map(m=>m[1]),[...mutations,...reads]);
  for(const [body,name] of entries){
    assert.match(body,/security definer set search_path = ''/);
    assert.match(body,new RegExp(`language plpgsql ${mutations.includes(name)?'volatile':'stable'}`));
    assert.match(source,new RegExp(`alter function api\\.${name}\\([^;]*owner to nhs_management_writer;`));
    assert.doesNotMatch(body,/p_actor|p_user_id|user_metadata|raw_user_meta_data|\bexecute\s/i);
  }
});
test('management: limited owner and no client table writes or destructive fields',()=>{
  assert.match(source,/nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit/);
  assert.match(source,/grant nhs_management_writer to postgres;/);
  assert.doesNotMatch(source,/grant (?:select|insert|update|delete|all)[^;]*to (?:anon|authenticated|public|service_role)\b/i);
  assert.doesNotMatch(source,/grant[^;]*on app\.(votes|competition_voters|staff_roles|vote_adjustments|result_rows|media_assets)\b/i);
  assert.doesNotMatch(source,/delete from|truncate app\.|update app\.staff_roles|create function api\.(archive|delete|cast_vote|publish_results|apply_adjustment)/i);
  for(const grant of [...source.matchAll(/grant update \(([^)]+)\)\s+on app\.(\w+)/g)]) assert.doesNotMatch(grant[1],/\b(slug|competition_id|id|archived_at|current_result_publication_id|photo_media_id)\b/);
  assert.match(source,/revoke create on schema app,api from nhs_management_writer;/);
});
test('management: RLS write paths are owner-only and authority is rechecked',()=>{
  assert.equal([...source.matchAll(/create policy/g)].length,7);
  assert.equal([...source.matchAll(/for (?:select|insert|update) to nhs_management_writer/g)].length,7);
  assert.match(source,/actor_role = \(select s.staff_role from api.account_status\(\) s\)/);
  assert.match(source,/actor_id = app.request_user_id\(\)/);
  const lock=source.match(/create function app\.lock_management_competition([\s\S]*?)\$\$;/)[1];
  assert.equal([...lock.matchAll(/perform api\.require_admin\(\)/g)].length,2);
  assert.match(lock,/from app\.competitions c where c.id = p_id for update/);
});
test('management: lifecycle and candidate scope use original post-lock wall clock',()=>{
  assert.match(source,/p_before_start and pg_catalog.clock_timestamp\(\) >= v_parent.starts_at/);
  assert.match(source,/p_draft_only and v_parent.published_at is not null/);
  assert.match(source,/v_now < v_parent.starts_at or v_now >= v_parent.ends_at/);
  assert.match(source,/d.id=p_candidate_id and d.competition_id=p_competition_id for update/);
  assert.match(source,/Candidate configuration is frozen/);
  assert.match(source,/not pg_catalog.isfinite\(p_starts_at\)/);
  assert.match(source,/p_allowance not between 1 and 1000/);
  assert.match(source,/p_show_live_counts and not p_show_vote_totals/);
  assert.match(source,/p_video_id !~ '\^\[A-Za-z0-9_-\]\{11\}\$'/);
});
test('management: every successful mutation audits within its function',()=>{
  for(const name of mutations){
    const body=source.match(new RegExp(`create function api\\.${name}\\(([\\s\\S]*?)\\$\\$;`))[1];
    assert.match(body,new RegExp(`perform app\\.record_management_audit\\('${name}'`));
    assert.doesNotMatch(body,/exception when/i); // No swallowing audit failures.
  }
  const helper=source.match(/create function app\.record_management_audit([\s\S]*?)\$\$;/)[1];
  assert.match(helper,/from api.account_status\(\)/);
  assert.match(helper,/insert into app.audit_logs/);
  assert.match(helper,/pg_column_size\(p_changes\) > 8192/);
});
test('management: execution is allowlisted only to authenticated callers',()=>{
  assert.match(source,/from public,anon,authenticated,service_role;/);
  const grant=source.match(/grant execute on function api\.create_competition([\s\S]*?)to authenticated;/);
  assert.ok(grant);
  assert.equal([...grant[0].matchAll(/api\./g)].length,9);
  assert.doesNotMatch(source,/grant execute[^;]*to anon/);
});
