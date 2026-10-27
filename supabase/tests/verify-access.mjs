// Manual integration runner. Requires the dedicated disposable local stack.
// No external libraries, remote targets, real identities, or persisted tokens.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const container = 'supabase_db_nhs-phase2a-verification';
const cli = resolve('node_modules/supabase/dist/supabase.js');
let checks = 0;
function check(condition, label) { assert.ok(condition, label); checks++; }
function command(binary, args, input, allowFailure = false) {
  const result = spawnSync(binary, args, { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (!allowFailure && result.status !== 0) throw new Error(`Local command failed: ${binary}\n${result.stderr}`);
  return result;
}
function psql(input, variables = {}, allowFailure = false) {
  const args = ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
  for (const [key, value] of Object.entries(variables)) args.push('-v', `${key}=${value}`);
  return command('docker', args, input, allowFailure);
}
const sql = (input) => psql(input).stdout.trim();
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const publicRPCs = ['published_school_pages', 'published_events', 'published_competitions', 'competition_details', 'candidate_profiles'];
const protectedRPCs = ['account_status', 'is_admin', 'is_super_admin', 'require_admin', 'require_super_admin'];

async function main() {
  check(!existsSync('supabase/.temp/project-ref'), 'No remote-link state may exist');
  const config = readFileSync('supabase/config.toml', 'utf8');
  check(config.includes('project_id = "nhs-phase2a-verification"'), 'Dedicated local project required');
  check(config.includes('schemas = ["api"]'), 'Only reviewed API schema exposed');
  const status = JSON.parse(command(process.execPath, [cli, 'status', '-o', 'json', '--workdir', process.cwd()]).stdout);
  check(status.API_URL === 'http://127.0.0.1:55431', 'Loopback API target only');
  const base = status.API_URL;
  const anon = status.ANON_KEY;
  check(Boolean(anon), 'Local anon key available');
  check(sql('select count(*) from app.staff_roles;') === '0', 'Start with a clean disposable database');

  async function request(path, { method = 'POST', body, token = anon, profile = true } = {}) {
    const headers = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Connection: 'close' };
    if (profile) { headers['Accept-Profile'] = 'api'; headers['Content-Profile'] = 'api'; }
    const response = await fetch(`${base}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  }
  const rpc = (name, args = {}, user) => request(`/rest/v1/rpc/${name}`, { body: args, token: user?.access_token ?? anon });
  async function identity(label) {
    const result = await request('/auth/v1/signup', { profile: false, body: {
      email: `access-${label}-${randomUUID()}@example.test`, password: `Synthetic-${randomUUID()}-8Aa!`,
      data: { role: 'super_admin', is_admin: true }, // Deliberately hostile user-editable claims.
    } });
    check(result.status === 200 && result.data.user?.id && result.data.access_token, `Synthetic ${label} signup`);
    check(/^[0-9a-f-]{36}$/.test(result.data.user.id), 'Valid synthetic UUID');
    return result.data;
  }
  const ordinary = await identity('ordinary');
  const admin = await identity('admin');
  const superAdmin = await identity('super');
  const inactive = await identity('inactive');

  const legacy = psql(readFileSync('supabase/tests/schema_verification.sql', 'utf8'), { test_user_id: ordinary.user.id });
  check(legacy.stdout.trim().endsWith('ROLLBACK'), 'Phase 2A regression transaction rolled back');
  check(legacy.stderr.includes('PASS: 35 integration assertion groups'), 'Phase 2A constraint/immutability assertions passed');
  check(legacy.stderr.includes('PASS: future table/function privilege defaults'), 'Phase 2A default-grant checks passed');

  const bootstrap = readFileSync('supabase/scripts/bootstrap_local_super_admin.sql', 'utf8');
  psql(bootstrap, { bootstrap_user_id: superAdmin.user.id, bootstrap_reason: 'CONFIDENTIAL-BOOTSTRAP-MARKER' });
  check(sql("select count(*) from app.audit_logs where action = 'bootstrap_super_admin' and actor_role = 'operator';") === '1', 'Durable operator bootstrap audit');
  const repeat = psql(bootstrap, { bootstrap_user_id: ordinary.user.id, bootstrap_reason: 'Synthetic repeat' }, true);
  check(repeat.status !== 0 && repeat.stderr.includes('First Super Admin already exists'), 'No repeat bootstrap/self-promotion');
  check(sql('select count(*) from app.staff_roles;') === '1', 'Failed bootstrap left roles unchanged');

  const owner = literal(superAdmin.user.id);
  const mediaPublic = randomUUID(), mediaPrivate = randomUUID(), mediaPending = randomUUID();
  const comp = randomUUID(), draft = randomUUID(), archive = randomUUID(), future = randomUUID();
  const candidateA = randomUUID(), candidateZ = randomUUID(), ineligible = randomUUID(), draftCandidate = randomUUID();
  sql(`
    insert into app.staff_roles(user_id,role,active,granted_by) values
      (${literal(admin.user.id)},'admin',true,${owner}),(${literal(inactive.user.id)},'admin',false,${owner});
    insert into app.media_assets(id,bucket_name,object_path,mime_type,byte_size,width,height,alt_text,approval_status,permission_status,is_public_derivative,uploaded_by,approved_by,approved_at) values
      (${literal(mediaPublic)},'approved-public','public-example.png','image/png',100,10,10,'Public placeholder','approved','authorized',true,${owner},${owner},clock_timestamp()),
      (${literal(mediaPrivate)},'private-originals','PRIVATE-MEDIA-MARKER.png','image/png',100,10,10,'Private original','approved','authorized',false,${owner},${owner},clock_timestamp()),
      (${literal(mediaPending)},'staging','PENDING-MEDIA-MARKER.png','image/png',100,10,10,'Pending original','pending','pending',false,${owner},null,null);
    insert into app.school_pages(page_key,title,content,status,published_by,published_at,created_by,updated_by) values
      ('home','Synthetic published page','{"text":"Published content"}','published',${owner},clock_timestamp(),${owner},${owner}),
      ('about','DRAFT-ONLY-MARKER','{"private":"DRAFT-ONLY-MARKER"}','draft',null,null,${owner},${owner}),
      ('contact','FUTURE-ONLY-MARKER','{}','published',${owner},clock_timestamp()+interval '1 day',${owner},${owner});
    insert into app.events(slug,title,starts_at,ends_at,status,published_by,published_at,cover_media_id,created_by,updated_by) values
      ('public-event','Published event','2026-01-01Z','2026-01-02Z','published',${owner},clock_timestamp(),${literal(mediaPublic)},${owner},${owner}),
      ('private-cover-event','Published event with private image','2026-01-01Z','2026-01-02Z','published',${owner},clock_timestamp(),${literal(mediaPrivate)},${owner},${owner}),
      ('draft-event','DRAFT-ONLY-MARKER','2026-01-01Z','2026-01-02Z','draft',null,null,null,${owner},${owner});
    insert into app.competitions(id,slug,title,max_votes_per_voter,starts_at,ends_at,published_by,published_at,archived_at,created_by,updated_by) values
      (${literal(comp)},'public-competition','Published competition',3,'2026-01-01Z','2026-01-02Z',${owner},clock_timestamp(),null,${owner},${owner}),
      (${literal(draft)},'draft-competition','DRAFT-ONLY-MARKER',3,'2026-01-01Z','2026-01-02Z',null,null,null,${owner},${owner}),
      (${literal(archive)},'archived-competition','Archived public competition',2,'2026-01-01Z','2026-01-02Z',${owner},clock_timestamp(),clock_timestamp(),${owner},${owner}),
      (${literal(future)},'future-competition','FUTURE-ONLY-MARKER',2,'2026-01-01Z','2026-01-02Z',${owner},clock_timestamp()+interval '1 day',null,${owner},${owner});
    insert into app.candidates(id,competition_id,slug,display_name,eligible,photo_media_id,created_by,updated_by) values
      (${literal(candidateZ)},${literal(comp)},'z-candidate','Synthetic Z',true,${literal(mediaPublic)},${owner},${owner}),
      (${literal(candidateA)},${literal(comp)},'a-candidate','Synthetic A',true,${literal(mediaPrivate)},${owner},${owner}),
      (${literal(ineligible)},${literal(comp)},'ineligible-candidate','INELIGIBLE-MARKER',false,${literal(mediaPending)},${owner},${owner}),
      (${literal(draftCandidate)},${literal(draft)},'draft-candidate','DRAFT-ONLY-MARKER',true,null,${owner},${owner});
    insert into app.competition_voters(competition_id,voter_id) values (${literal(comp)},${literal(ordinary.user.id)});
    insert into app.votes(competition_id,voter_id,candidate_id) values (${literal(comp)},${literal(ordinary.user.id)},${literal(candidateZ)});
  `.replaceAll('2026-01-01Z', '2026-01-01T00:00:00Z').replaceAll('2026-01-02Z', '2026-01-02T00:00:00Z'));

  const publicResponses = [];
  for (const user of [undefined, ordinary, admin, superAdmin, inactive]) {
    const pages = await rpc('published_school_pages', {}, user);
    check(pages.status === 200 && pages.data.length === 1 && pages.data[0].page_key === 'home', 'Only published pages, no drafts/future publications');
    publicResponses.push(pages.data);
    const events = await rpc('published_events', {}, user);
    check(events.status === 200 && events.data.length === 2, 'Only published events');
    check(events.data.find((row) => row.slug === 'private-cover-event').cover_path === null, 'Private event cover omitted');
    publicResponses.push(events.data);
    const competitions = await rpc('published_competitions', {}, user);
    check(competitions.status === 200 && competitions.data.length === 1, 'Only published nonarchived listings');
    publicResponses.push(competitions.data);
    const detail = await rpc('competition_details', { p_slug: 'public-competition' }, user);
    check(detail.status === 200 && detail.data.length === 1, 'Published details readable');
    check((await rpc('competition_details', { p_slug: 'draft-competition' }, user)).data.length === 0, 'Draft competition hidden');
    check((await rpc('competition_details', { p_slug: 'archived-competition' }, user)).data.length === 1, 'Archived published details retained');
    const profiles = await rpc('candidate_profiles', { p_competition_slug: 'public-competition' }, user);
    check(profiles.status === 200 && profiles.data.length === 2, 'Only eligible profiles');
    check(profiles.data.map((row) => row.candidate_slug).join(',') === 'a-candidate,z-candidate', 'Neutral slug ordering independent of votes');
    check(profiles.data[0].photo_path === null && profiles.data[1].photo_path === 'public-example.png', 'Only approved public media paths');
    check((await rpc('candidate_profiles', { p_competition_slug: 'draft-competition' }, user)).data.length === 0, 'Draft competition candidates hidden');
    check((await rpc('candidate_profiles', { p_competition_slug: 'public-competition', p_candidate_slug: 'ineligible-candidate' }, user)).data.length === 0, 'Ineligible direct profile hidden');
    publicResponses.push(detail.data, profiles.data);
  }
  const serialized = JSON.stringify(publicResponses);
  for (const marker of ['DRAFT-ONLY-MARKER', 'FUTURE-ONLY-MARKER', 'INELIGIBLE-MARKER', 'PRIVATE-MEDIA-MARKER', 'PENDING-MEDIA-MARKER', 'CONFIDENTIAL-BOOTSTRAP-MARKER', 'official_total', 'current_result_publication_id', 'voter_id', 'published_by', 'rank', 'is_winner']) {
    check(!serialized.includes(marker), `Public response excludes ${marker}`);
  }

  for (const [user, role, adminFlag, superFlag, adminAllowed, superAllowed] of [
    [ordinary, null, false, false, false, false], [admin, 'admin', true, false, true, false],
    [superAdmin, 'super_admin', false, true, true, true], [inactive, null, false, false, false, false],
  ]) {
    const own = await rpc('account_status', {}, user);
    check(own.status === 200 && own.data.length === 1 && own.data[0].user_id === user.user.id && own.data[0].staff_role === role, 'Only own non-sensitive status');
    check(Object.keys(own.data[0]).sort().join(',') === 'staff_role,user_id', 'No phone/password/session information');
    check((await rpc('is_admin', {}, user)).data === adminFlag, 'Exact Admin identity check');
    check((await rpc('is_super_admin', {}, user)).data === superFlag, 'Exact Super Admin identity check');
    check((await rpc('require_admin', {}, user)).status === (adminAllowed ? 200 : 403), 'Admin capability gate');
    check((await rpc('require_super_admin', {}, user)).status === (superAllowed ? 200 : 403), 'Super Admin capability gate');
  }
  for (const name of protectedRPCs) {
    const result = await rpc(name);
    check([401, 403].includes(result.status) && result.data.code === '42501', `Anonymous protected execution denied: ${name}`);
  }
  const forged = await request('/auth/v1/user', { method: 'PUT', profile: false, token: ordinary.access_token, body: { data: { role: 'super_admin', active: true, is_super_admin: true } } });
  check(forged.status === 200, 'Synthetic user metadata edit accepted by Auth');
  check((await rpc('require_super_admin', {}, ordinary)).status === 403, 'User metadata cannot grant staff privileges');
  const stolenIdentity = await rpc('account_status', { user_id: superAdmin.user.id }, ordinary);
  check(stolenIdentity.status === 404, 'Account RPC accepts no target identity');

  for (const [name, args] of [
    ['competition_details', { p_slug: "x'; select * from app.audit_logs;--" }],
    ['competition_details', { p_slug: null }], ['competition_details', { p_slug: 'x'.repeat(101) }],
    ['candidate_profiles', { p_competition_slug: 'public-competition', p_candidate_slug: '../private' }],
    ['published_events', { p_limit: 101 }], ['published_competitions', { p_limit: null }],
    ['candidate_profiles', { p_competition_slug: 'public-competition', p_offset: -1 }],
    ['published_school_pages', { p_page_key: "home' OR true--" }],
  ]) {
    const result = await rpc(name, args);
    check(result.status === 400 && result.data.code === '22023', `Malformed/injection argument rejected for ${name}`);
  }
  check((await rpc('published_events', { p_limit: 'not-an-integer' })).status === 400, 'Wrong argument type rejected');
  const invalidJWT = `${ordinary.access_token.slice(0, -8)}xxxxxxxx`;
  check((await request('/rest/v1/rpc/account_status', { body: {}, token: invalidJWT })).status === 401, 'Forged JWT rejected before RPC');
  for (const name of ['publish_results', 'apply_adjustment', 'bootstrap_super_admin', 'manage_staff']) check((await rpc(name, {}, superAdmin)).status === 404, `Forbidden product endpoint not installed: ${name}`);
  const noSmsVote=await rpc('cast_vote',{p_competition_id:comp,p_candidate_id:candidateZ},superAdmin);
  check(noSmsVote.status===403&&noSmsVote.data.code==='42501','Staff email session cannot use voting without SMS proof');

  for (const user of [undefined, ordinary, admin, superAdmin, inactive]) {
    for (const table of ['staff_roles', 'votes', 'audit_logs', 'vote_adjustments', 'enquiries', 'result_rows', 'school_pages']) {
      const response = await request(`/rest/v1/${table}`, { method: 'GET', token: user?.access_token ?? anon });
      check(response.status === 404, `No API table route: ${table}`);
    }
    const direct = await fetch(`${base}/rest/v1/audit_logs`, { headers: { apikey: anon, Authorization: `Bearer ${user?.access_token ?? anon}`, 'Accept-Profile': 'app' } });
    check(direct.status === 406, 'Private app schema excluded even for staff JWTs');
  }

  sql(`update app.staff_roles set active = false where user_id in (${literal(admin.user.id)},${literal(superAdmin.user.id)});`);
  check((await rpc('require_admin', {}, admin)).status === 403, 'Existing JWT loses Admin access immediately after deactivation');
  check((await rpc('require_super_admin', {}, superAdmin)).status === 403, 'Existing JWT loses Super Admin access immediately after deactivation');
  check((await rpc('account_status', {}, admin)).data[0].staff_role === null, 'Revocation reflected in account status');
  sql(`delete from app.staff_roles where user_id = ${literal(admin.user.id)};`);
  check((await rpc('is_admin', {}, admin)).data === false, 'Revoked/deleted role remains denied');
  const inactiveBootstrap = psql(bootstrap, { bootstrap_user_id: ordinary.user.id, bootstrap_reason: 'Synthetic repeat after deactivation' }, true);
  check(inactiveBootstrap.status !== 0, 'Deactivated first Super Admin does not reopen bootstrap');

  const security = sql(`
    do $$ declare r text; t record; f record; begin
      foreach r in array array['anon','authenticated','service_role'] loop
        if has_schema_privilege(r,'app','USAGE,CREATE') then raise exception 'Client app schema grant'; end if;
        if pg_has_role(r,'nhs_public_reader','MEMBER') or pg_has_role(r,'nhs_identity_reader','MEMBER') then raise exception 'Client owner membership'; end if;
        if pg_has_role(r,'nhs_management_writer','MEMBER') then raise exception 'Client writer membership'; end if;
        for t in select c.oid,a.attnum from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid where n.nspname='app' and a.attnum>0 and not a.attisdropped loop
          if has_column_privilege(r,t.oid,t.attnum,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'Client column privilege'; end if;
        end loop;
      end loop;
      if (select count(*) from pg_policies where schemaname='app') <> 30 then raise exception 'Unexpected policy inventory'; end if;
      if exists(select 1 from pg_policies where schemaname='app' and roles::text[] && array['public','anon','authenticated','service_role']) then raise exception 'Broad client policy'; end if;
      if exists(select 1 from pg_policies where schemaname='app' and cmd<>'SELECT' and roles::text[] not in (array['nhs_management_writer'],array['nhs_sms_proof_owner'],array['nhs_voting_writer'])) then raise exception 'Unexpected writer policy'; end if;
      if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and (not c.relrowsecurity or c.relowner in (select oid from pg_roles where rolname in ('nhs_public_reader','nhs_identity_reader','nhs_management_writer')))) then raise exception 'RLS bypass by owner'; end if;
      if exists(select 1 from pg_roles where rolname in ('nhs_public_reader','nhs_identity_reader','nhs_management_writer') and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls or rolinherit)) then raise exception 'Privileged routine owner'; end if;
      if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api') <> 25 then raise exception 'API inventory'; end if;
      for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api' loop
        if not f.prosecdef or not ('search_path=""' = any(f.proconfig)) then raise exception 'Unsafe API function configuration'; end if;
        if f.proowner not in (select oid from pg_roles where rolname in ('nhs_public_reader','nhs_identity_reader','nhs_management_writer','nhs_sms_proof_owner','nhs_voting_writer')) then raise exception 'Unexpected function owner'; end if;
        if exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0) then raise exception 'PUBLIC function execute'; end if;
      end loop;
      if has_schema_privilege('anon','api','CREATE') or has_schema_privilege('nhs_public_reader','api','CREATE') or has_schema_privilege('nhs_identity_reader','app','CREATE') then raise exception 'Leaked CREATE grant'; end if;
      raise notice 'PASS: column grants, owner membership, RLS policies, safe ownership/search_path and function ACLs';
    end; $$;
  `);
  check(security === 'DO', 'Catalog security audit completed');
  const direct = psql(`begin; set local role authenticated; select * from app.audit_logs; rollback;`, {}, true);
  check(direct.status !== 0 && direct.stderr.includes('permission denied'), 'Real authenticated SQL role cannot read confidential audit');
  // SET ROLE checks session_user membership; model the actual authenticator
  // rather than testing another SET ROLE inside a privileged postgres session.
  const clientSwitch = psql('set session authorization authenticator; set role authenticated; set role nhs_identity_reader;', {}, true);
  check(clientSwitch.status !== 0 && clientSwitch.stderr.includes('permission denied'), 'Actual authenticator cannot assume internal function-owner role');
  const openapi = await request('/rest/v1/', { method: 'GET' });
  check(openapi.status === 200, 'Anonymous API OpenAPI available');
  const paths = Object.keys(openapi.data.paths ?? {});
  check(publicRPCs.every((name) => paths.includes(`/rpc/${name}`)), 'Anonymous OpenAPI lists public entry points');
  check(protectedRPCs.every((name) => !paths.includes(`/rpc/${name}`)), 'Anonymous OpenAPI omits protected entry points');
  console.log(`PASS: ${checks} access-foundation assertions; Phase 2A 35 groups + default/helper checks; real Auth/SQL/PostgREST roles.`);
  const snapshot = sql(`select jsonb_build_object('functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.proowner::regrole::text,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid),p.proacl::text) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','api')),'policies',(select jsonb_agg(to_jsonb(x) order by x.tablename,x.policyname) from pg_policies x where schemaname='app'))::text;`);
  console.log(`Access function/policy catalog SHA256: ${createHash('sha256').update(snapshot).digest('hex')}`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
