import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Structural source checks only. This is not a PostgreSQL parser or database.
const directory = new URL('../supabase/migrations/', import.meta.url);
// Freeze checks to the reviewed Phase 2A baseline; forward access migrations
// have their own suite and must not invalidate historical schema invariants.
const files = readdirSync(directory).filter((name) => /^20261027000[123]00_.*\.sql$/.test(name)).sort();
const sources = files.map((name) => readFileSync(new URL(name, directory), 'utf8').replace(/\r\n/g, '\n'));
const sql = sources.map((source) => source.replace(/--[^\n]*/g, '')).join('\n');
const expectedTables = ['staff_roles', 'media_assets', 'school_pages', 'events', 'competitions', 'candidates', 'gallery_items', 'competition_voters', 'votes', 'vote_adjustment_requests', 'vote_adjustments', 'result_publications', 'result_rows', 'enquiries', 'analytics_daily', 'audit_logs'];
const immutable = ['votes', 'vote_adjustments', 'result_publications', 'result_rows', 'audit_logs'];

function checkDelimiters(source) {
  let depth = 0;
  let mode = null;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === 'comment') { if (char === '\n') mode = null; continue; }
    if (mode === 'string') {
      if (char === "'" && next === "'") index++;
      else if (char === "'") mode = null;
      continue;
    }
    if (mode === 'dollar') { if (char === '$' && next === '$') { mode = null; index++; } continue; }
    if (char === '-' && next === '-') { mode = 'comment'; index++; }
    else if (char === "'") mode = 'string';
    else if (char === '$' && next === '$') { mode = 'dollar'; index++; }
    else if (char === '(') depth++;
    else if (char === ')') { depth--; assert.ok(depth >= 0, 'Unexpected closing parenthesis'); }
  }
  assert.ok(mode === null || mode === 'comment', 'Unclosed literal');
  assert.equal(depth, 0, 'Unbalanced parentheses');
}

test('schema: deterministic ordered baseline is transactional and lexically balanced', () => {
  assert.deepEqual(files, ['20261027000100_private_app_schema.sql', '20261027000200_application_tables.sql', '20261027000300_indexes_and_immutability.sql']);
  for (const source of sources) {
    checkDelimiters(source);
    const code = source.replace(/--[^\n]*/g, '').trim();
    assert.match(code, /^begin;/i);
    assert.match(code, /commit;$/i);
  }
  assert.throws(() => checkDelimiters('('));
  assert.throws(() => checkDelimiters("'unclosed"));
});

test('schema: exactly the 16 approved private tables, each with a primary key', () => {
  const tables = [...sql.matchAll(/create table app\.(\w+)\s*\(([\s\S]*?)\n\);/g)];
  assert.deepEqual(tables.map((entry) => entry[1]), expectedTables);
  for (const [, name, body] of tables) assert.match(body, /primary key/i, name);
  assert.equal([...sql.matchAll(/create table\s/g)].length, 16);
});

test('schema: defaults and namespace deny PUBLIC and all API roles', () => {
  assert.match(sql, /create schema app;/);
  assert.match(sql, /revoke all on schema app from public, anon, authenticated, service_role;/);
  for (const kind of ['tables', 'sequences', 'functions']) {
    assert.ok(sql.includes(`alter default privileges revoke all on ${kind} from public, anon, authenticated, service_role;`));
    assert.ok(sql.includes(`alter default privileges in schema app revoke all on ${kind} from public, anon, authenticated, service_role;`));
  }
});

test('schema: every table enables RLS before commit and final table/sequence grants are revoked', () => {
  for (const table of expectedTables) assert.ok(sources[1].includes(`alter table app.${table} enable row level security;`));
  assert.match(sql, /revoke all on all tables in schema app from public, anon, authenticated, service_role;/);
  assert.match(sql, /revoke all on all sequences in schema app from public, anon, authenticated, service_role;/);
});

test('schema: no policies, data, privileged routines, exposed views, or Auth modifications', () => {
  assert.doesNotMatch(sql, /\b(?:grant|create policy|security definer|create view|create materialized view|create role)\b/i);
  assert.doesNotMatch(sql, /\b(?:insert into|update|delete from|alter table|create table|drop table)\s+(?:auth|public)\./i);
  assert.doesNotMatch(sql, /\binsert into\b/i);
  assert.deepEqual([...sql.matchAll(/create function (\S+)\(/g)].map((entry) => entry[1]), ['app.reject_immutable_mutation']);
  assert.match(sql, /references auth\.users\(id\) on delete restrict/);
  assert.doesNotMatch(sql, /on delete cascade/i);
});

test('schema: referenced application tables exist first and circular FK follows publications', () => {
  for (const match of sql.matchAll(/references app\.(\w+)\(/g)) {
    assert.ok(sql.indexOf(`create table app.${match[1]} (`) < match.index, `Out-of-order reference to ${match[1]}`);
  }
  assert.ok(sql.indexOf('alter table app.competitions add constraint competitions_current_result') > sql.indexOf('create table app.result_publications'));
  assert.match(sql, /foreign key \(id, current_result_publication_id\)\s+references app\.result_publications\(competition_id, id\)/);
});

test('schema: voting, adjustment and result invariants have declarative constraints', () => {
  for (const clause of [
    'unique (competition_id, voter_id, candidate_id)',
    'max_votes_per_voter between 1 and 1000', 'starts_at < ends_at',
    'not show_live_counts or show_vote_totals',
    'references app.competition_voters(competition_id, voter_id)',
    'references app.candidates(competition_id, id)',
    "state in ('proposed', 'approved', 'rejected')", "request_state = 'approved'",
    'references app.vote_adjustment_requests(competition_id, candidate_id, id, delta, state)',
    'unique (competition_id, version)',
    'references app.result_publications(competition_id, id, outcome)',
    'official_total >= 0', 'official_total::numeric = original_count::numeric + adjustment_sum::numeric',
    'not is_winner or (official_total > 0 and rank = 1)', 'not is_tied_winner or is_winner',
    "outcome <> 'no_votes_received' or (official_total = 0 and not is_winner and not is_tied_winner)",
  ]) assert.ok(sql.includes(clause), `Missing invariant: ${clause}`);
});

test('schema: immutable records reject UPDATE, DELETE and TRUNCATE with an invoker-only helper', () => {
  for (const table of immutable) assert.ok(sql.includes(`before update or delete or truncate on app.${table}\n    for each statement execute function app.reject_immutable_mutation();`));
  assert.match(sql, /security invoker\s+set search_path = ''/);
  assert.match(sql, /using errcode = '55000'/);
  assert.match(sql, /revoke all on function app\.reject_immutable_mutation\(\) from public, anon, authenticated, service_role;/);
});

test('schema: initial indexes target created tables and no voting counters or phone copies are added', () => {
  const indexes = [...sql.matchAll(/create index (\w+) on app\.(\w+)/g)];
  assert.equal(new Set(indexes.map((entry) => entry[1])).size, indexes.length);
  for (const [ , name] of indexes) assert.ok(name.length <= 63, `Overlong PostgreSQL index name: ${name}`);
  for (const [, , table] of indexes) assert.ok(expectedTables.includes(table));
  for (const name of ['votes_candidate_totals_idx', 'vote_adjustments_candidate_totals_idx', 'enquiries_queue_idx', 'audit_logs_actor_idx']) assert.ok(indexes.some((entry) => entry[1] === name));
  const votingTableBodies = [...sql.matchAll(/create table app\.(votes|competition_voters)\s*\(([\s\S]*?)\n\);/g)].map((entry) => entry[2]).join('\n');
  assert.doesNotMatch(votingTableBodies, /phone|email|remaining_votes|used_votes|vote_count/i);
  assert.doesNotMatch(sql, /\btimestamp\s+(?:without time zone|not null)/i);
});

test('schema: pending integration script is rollback-only and never writes Auth', () => {
  const source = readFileSync(new URL('../supabase/tests/schema_verification.sql', import.meta.url), 'utf8');
  checkDelimiters(source);
  const code = source.replace(/--[^\n]*/g, '').trim();
  assert.match(code, /^\\set ON_ERROR_STOP on\s+begin;/);
  assert.match(code, /rollback;$/);
  assert.doesNotMatch(code, /\bcommit\s*;/i);
  assert.doesNotMatch(code, /\b(?:insert into|update|delete from|alter table|create table|truncate)\s+auth\./i);
  assert.doesNotMatch(code, /security definer/i);
  assert.ok(code.includes(":'test_user_id'::uuid"));
  for (const sqlstate of ['23505', '23503', '23514', '55000']) assert.ok(code.includes(sqlstate));
});
