// Manual real-RPC suite for the dedicated disposable LOCAL Supabase project.
// Run verify-access.mjs first after a clean replay; no product role API is used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
const container = 'supabase_db_nhs-phase2a-verification';
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const digest = (value) => createHash('sha256').update(value).digest('hex');
function command(binary, args, input) {
  const result = spawnSync(binary,args,{input,encoding:'utf8',maxBuffer:8*1024*1024});
  if (result.status !== 0) throw new Error(`Local verification command failed: ${result.stderr}`);
  return result.stdout.trim();
}
const psqlArgs = ['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'];
const sql = (input) => command('docker',psqlArgs,input);
const auditCount = () => Number(sql('select count(*) from app.audit_logs;'));
const mutableDigest = () => digest(sql(`select jsonb_build_array(
 (select jsonb_agg(to_jsonb(c) order by c.id) from app.competitions c),
 (select jsonb_agg(to_jsonb(c) order by c.id) from app.candidates c))::text;`));
const ledgerDigest = () => digest(sql(`select jsonb_build_array(
 (select jsonb_agg(to_jsonb(v) order by v.id) from app.votes v),
 (select jsonb_agg(to_jsonb(g) order by g.competition_id,g.voter_id) from app.competition_voters g),
 (select jsonb_agg(to_jsonb(a) order by a.id) from app.vote_adjustment_requests a),
 (select jsonb_agg(to_jsonb(a) order by a.id) from app.vote_adjustments a),
 (select jsonb_agg(to_jsonb(r) order by r.id) from app.result_publications r),
 (select jsonb_agg(to_jsonb(r) order by r.publication_id,r.candidate_id) from app.result_rows r))::text;`));
async function hold(sqlBeforeSleep, seconds = 2) {
  const child = spawn('docker',psqlArgs,{stdio:['pipe','pipe','pipe']});
  let out='',err='';
  let ready;
  const readyPromise = new Promise((resolveReady) => { ready=resolveReady; });
  child.stdout.on('data',(chunk) => { out+=chunk; if(out.includes('LOCK-READY')) ready(); });
  child.stderr.on('data',(chunk) => { err+=chunk; });
  const done = new Promise((resolveDone,reject) => { child.on('error',reject); child.on('close',(code)=>{
    ready(); if(code===0) resolveDone(); else reject(new Error(`Local lock holder failed: ${err}`));
  }); });
  child.stdin.end(`begin; ${sqlBeforeSleep}; select 'LOCK-READY'; select pg_sleep(${seconds}); commit;`);
  await readyPromise;
  check(out.includes('LOCK-READY'),'Concurrent transaction acquired its lock');
  return { done };
}

async function main() {
  check(!existsSync('supabase/.temp/project-ref'),'No remote-link state');
  check(readFileSync('supabase/config.toml','utf8').includes('project_id = "nhs-phase2a-verification"'),'Dedicated disposable project');
  const status=JSON.parse(command(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'status','-o','json']));
  check(status.API_URL==='http://127.0.0.1:55431','Loopback target only');
  const beforeLedger=ledgerDigest();
  async function request(path,body,user,method='POST',profile=true) {
    const headers={apikey:status.ANON_KEY,Authorization:`Bearer ${user?.access_token??status.ANON_KEY}`,'Content-Type':'application/json'};
    if(profile){headers['Accept-Profile']='api';headers['Content-Profile']='api';}
    const response=await fetch(`${status.API_URL}${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  }
  const rpc=(name,args={},user)=>request(`/rest/v1/rpc/${name}`,args,user);
  async function identity(label) {
    const result=await request('/auth/v1/signup',{email:`management-${label}-${randomUUID()}@example.test`,password:`Synthetic-${randomUUID()}-9Aa!`,data:{role:'super_admin'}},undefined,'POST',false);
    check(result.status===200&&result.data.user?.id&&result.data.access_token,`Synthetic ${label} identity`);
    return result.data;
  }
  const ordinary=await identity('ordinary'),admin=await identity('admin'),superAdmin=await identity('super'),inactive=await identity('inactive');
  sql(`insert into app.staff_roles(user_id,role,active,granted_by) values
   (${literal(admin.user.id)},'admin',true,${literal(superAdmin.user.id)}),
   (${literal(superAdmin.user.id)},'super_admin',true,${literal(superAdmin.user.id)}),
   (${literal(inactive.user.id)},'admin',false,${literal(superAdmin.user.id)});`);
  async function success(name,args,user=admin,mutating=true) {
    const before=auditCount();
    const result=await rpc(name,args,user);
    check(result.status===200,`${name} succeeds: ${JSON.stringify(result.data)}`);
    if(mutating){
      check(auditCount()===before+1,`${name} has exactly one atomic audit`);
      const audit=JSON.parse(sql(`select jsonb_build_object('actor',actor_id,'role',actor_role,'target',target_id,'action',action) from app.audit_logs order by recorded_at desc,id desc limit 1;`));
      check(audit.actor===user.user.id&&audit.role===(user===superAdmin?'super_admin':'admin')&&audit.target===result.data&&audit.action===name,`${name} audit identity/action/target are trusted`);
    } else check(auditCount()===before,`${name} read creates no mutation audit`);
    return result.data;
  }
  async function failure(name,args,code,user=admin) {
    const before=auditCount();
    const result=await rpc(name,args,user);
    check(result.status>=400&&result.data.code===code,`${name} rejected as ${code}: ${JSON.stringify(result.data)}`);
    check(auditCount()===before,`${name} failure has no committed audit`);
  }
  const draftArgs=(overrides={})=>({p_slug:`synthetic-${randomUUID()}`,p_title:'Synthetic competition',p_description:'DO-NOT-AUDIT-DESCRIPTION',
    p_starts_at:new Date(Date.now()+86400000).toISOString(),p_ends_at:new Date(Date.now()+172800000).toISOString(),p_max_votes_per_voter:3,...overrides});
  const updateArgs=(id,overrides={})=>{const value=draftArgs();return {p_competition_id:id,p_title:value.p_title,p_description:value.p_description,
    p_starts_at:value.p_starts_at,p_ends_at:value.p_ends_at,p_max_votes_per_voter:2,...overrides};};
  const addArgs=(id,overrides={})=>({p_competition_id:id,p_slug:'candidate-one',p_display_name:'DO-NOT-AUDIT-STUDENT-NAME',p_description:'DO-NOT-AUDIT-DESCRIPTION',p_eligible:true,p_youtube_video_id:'jNQXAC9IVRw',p_video_start_seconds:3,...overrides});
  const candidateUpdate=(id,candidate,overrides={})=>({p_competition_id:id,p_candidate_id:candidate,p_display_name:'DO-NOT-AUDIT-STUDENT-NAME',p_description:'DO-NOT-AUDIT-DESCRIPTION',p_eligible:true,p_youtube_video_id:'jNQXAC9IVRw',p_video_start_seconds:5,...overrides});
  const visibility=(id,overrides={})=>({p_competition_id:id,p_show_vote_totals:true,p_show_live_counts:true,p_show_rankings:true,...overrides});
  const baseArgs=draftArgs();
  const draft=await success('create_competition',baseArgs);
  const candidate=await success('add_candidate',addArgs(draft));
  const managementCalls=[['create_competition',draftArgs()],['update_draft_competition',updateArgs(draft)],['set_competition_visibility',visibility(draft)],
    ['publish_competition',{p_competition_id:draft}],['set_competition_paused',{p_competition_id:draft,p_paused:true}],
    ['add_candidate',addArgs(draft,{p_slug:'unauthorized'})],['update_candidate',candidateUpdate(draft,candidate)],
    ['managed_competitions',{p_competition_id:draft}],['managed_candidates',{p_competition_id:draft}]];
  for(const user of [ordinary,inactive]) for(const [name,args] of managementCalls) await failure(name,args,'42501',user);
  // Anonymous execution has no default staff identity.
  for(const [name,args] of managementCalls){const result=await rpc(name,args);check(result.status>=400&&result.data.code==='42501',`Anonymous ${name} denied`);}
  check((await rpc('create_competition',{...draftArgs(),p_actor_id:superAdmin.user.id},ordinary)).status===404,'No actor override argument');
  for(const [field,value] of [['p_slug',"x';drop table app.votes;--"],['p_title','   '],['p_title','x'.repeat(201)],['p_description','x'.repeat(10001)],
    ['p_starts_at',null],['p_starts_at','infinity'],['p_max_votes_per_voter',0],['p_max_votes_per_voter',-1],['p_max_votes_per_voter',1001],['p_max_votes_per_voter',null]])
    await failure('create_competition',draftArgs({[field]:value}),'22023');
  await failure('create_competition',draftArgs({p_ends_at:baseArgs.p_starts_at,p_starts_at:baseArgs.p_starts_at}),'22023');
  await failure('create_competition',draftArgs({p_starts_at:baseArgs.p_ends_at,p_ends_at:baseArgs.p_starts_at}),'22023');
  await failure('create_competition',baseArgs,'23505',superAdmin);
  await failure('add_candidate',addArgs(draft),'23505');
  for(const overrides of [{p_youtube_video_id:'https://youtube.com/watch?v=x'},{p_youtube_video_id:'!!!!!!!!!!!'},{p_video_start_seconds:-1},
    {p_video_start_seconds:null},{p_eligible:null},{p_youtube_video_id:null,p_video_start_seconds:1}])
    await failure('update_candidate',candidateUpdate(draft,candidate,overrides),'22023');
  await failure('update_candidate',candidateUpdate(draft,candidate,{p_video_start_seconds:1.5}),'22P02');
  await failure('set_competition_visibility',visibility(draft,{p_show_vote_totals:false}),'22023');
  await failure('set_competition_visibility',visibility(draft,{p_show_rankings:null}),'22023');
  await failure('update_candidate',candidateUpdate(randomUUID(),candidate),'P0002');
  const other=await success('create_competition',draftArgs(),superAdmin);
  await failure('update_candidate',candidateUpdate(other,candidate),'P0002');
  check(sql(`select competition_id from app.candidates where id=${literal(candidate)};`)===draft,'Candidate competition identity unchanged');
  const unchanged=mutableDigest();
  await failure('update_draft_competition',updateArgs(draft,{p_max_votes_per_voter:0}),'22023');
  check(mutableDigest()===unchanged,'Failed config update rolled back');
  for(const user of [admin,superAdmin]){
    const args=draftArgs();const id=await success('create_competition',args,user);
    const child=await success('add_candidate',addArgs(id),user);
    const view=await success('managed_competitions',{p_competition_id:id},user,false);
    check(view.length===1&&view[0].published_at===null,'Staff can inspect draft management details');
    check((await rpc('competition_details',{p_slug:args.p_slug})).data.length===0,'Public projection hides new draft');
    await success('update_draft_competition',updateArgs(id),user);
    await success('update_candidate',candidateUpdate(id,child,{p_eligible:false,p_youtube_video_id:null,p_video_start_seconds:0}),user);
    await success('update_candidate',candidateUpdate(id,child),user);
    await success('set_competition_visibility',visibility(id),user);
    await success('publish_competition',{p_competition_id:id},user);
    check((await rpc('competition_details',{p_slug:args.p_slug})).data.length===1,'Published listing becomes public');
    await failure('publish_competition',{p_competition_id:id},'55000',user);
    await failure('update_draft_competition',updateArgs(id),'55000',user);
    await failure('add_candidate',addArgs(id,{p_slug:'late-addition'}),'55000',user);
    await failure('set_competition_paused',{p_competition_id:id,p_paused:true},'55000',user);
    await success('update_candidate',candidateUpdate(id,child),user);
    await success('set_competition_visibility',visibility(id,{p_show_live_counts:false}),user);
    sql(`update app.competitions set starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '1 day' where id=${literal(id)};`);
    const window=sql(`select starts_at::text||'/'||ends_at::text from app.competitions where id=${literal(id)};`);
    await failure('set_competition_visibility',visibility(id),'55000',user);
    await failure('update_candidate',candidateUpdate(id,child,{p_eligible:false}),'55000',user);
    await success('set_competition_paused',{p_competition_id:id,p_paused:true},user);
    await failure('set_competition_paused',{p_competition_id:id,p_paused:true},'55000',user);
    await success('set_competition_paused',{p_competition_id:id,p_paused:false},user);
    check(sql(`select starts_at::text||'/'||ends_at::text from app.competitions where id=${literal(id)};`)===window,'Pause/resume preserves original window');
    sql(`update app.competitions set ends_at=clock_timestamp()-interval '1 second',paused=true where id=${literal(id)};`);
    await failure('set_competition_paused',{p_competition_id:id,p_paused:false},'55000',user);
    await failure('set_competition_paused',{p_competition_id:id,p_paused:true},'55000',user);
    sql(`update app.competitions set archived_at=clock_timestamp(),enabled=false where id=${literal(id)};`);
    await failure('update_candidate',candidateUpdate(id,child),'55000',user);
    const children=await success('managed_candidates',{p_competition_id:id},user,false);
    check(children.length===1&&children[0].candidate_id===child,'Authorized candidate listing remains available');
  }
  sql(`update app.competitions set starts_at=clock_timestamp()-interval '1 second' where id=${literal(other)};`);
  await failure('update_draft_competition',updateArgs(other),'55000');
  await failure('publish_competition',{p_competition_id:other},'55000');
  await failure('add_candidate',addArgs(other),'55000');

  // Inject an audit INSERT failure only in this disposable test database.
  const faultDraft=await success('create_competition',draftArgs());
  const faultCandidate=await success('add_candidate',addArgs(faultDraft));
  const faultOpen=await success('create_competition',draftArgs());
  await success('publish_competition',{p_competition_id:faultOpen});
  sql(`update app.competitions set starts_at=clock_timestamp()-interval '1 minute' where id=${literal(faultOpen)};
   create function app.test_reject_audit_insert() returns trigger language plpgsql security invoker set search_path='' as $$ begin raise exception 'Synthetic audit failure' using errcode='P0001'; end; $$;
   create trigger test_reject_audit_insert before insert on app.audit_logs for each statement execute function app.test_reject_audit_insert();`);
  try {
    const before=mutableDigest();
    for(const [name,args] of [['create_competition',draftArgs()],['update_draft_competition',updateArgs(faultDraft)],['set_competition_visibility',visibility(faultDraft)],
      ['publish_competition',{p_competition_id:faultDraft}],['add_candidate',addArgs(faultDraft,{p_slug:'audit-failure'})],
      ['update_candidate',candidateUpdate(faultDraft,faultCandidate,{p_display_name:'Changed but must roll back'})],
      ['set_competition_paused',{p_competition_id:faultOpen,p_paused:true}]]) await failure(name,args,'P0001');
    check(mutableDigest()===before,'Every mutation rolled back when audit insertion failed');
  } finally { sql('drop trigger test_reject_audit_insert on app.audit_logs; drop function app.test_reject_audit_insert();'); }
  const auditText=sql("select coalesce(jsonb_agg(details),'[]')::text from app.audit_logs where action in ('create_competition','update_draft_competition','add_candidate','update_candidate');");
  check(!auditText.includes('DO-NOT-AUDIT-STUDENT-NAME')&&!auditText.includes('DO-NOT-AUDIT-DESCRIPTION'),'Audits omit candidate names and free-text descriptions');

  // Compatible with future voters taking FOR SHARE on the competition.
  const shared=await success('create_competition',draftArgs());
  let holder=await hold(`select id from app.competitions where id=${literal(shared)} for share`,2);
  let done=false;let pending=rpc('set_competition_visibility',visibility(shared),admin).then((r)=>{done=true;return r;});
  await new Promise((resolveWait)=>setTimeout(resolveWait,150));
  check(!done,'FOR SHARE future-voter lock blocks management mutation');
  await holder.done;check((await pending).status===200,'Management proceeds after shared lock releases');
  const crossing=await success('create_competition',draftArgs());
  holder=await hold(`update app.competitions set starts_at=clock_timestamp()+interval '0.4 seconds' where id=${literal(crossing)}`,1.5);
  pending=rpc('set_competition_visibility',visibility(crossing),admin);
  await holder.done;check((await pending).data.code==='55000','Lock wait crossing voting start enforces wall-clock freeze');
  const closing=await success('create_competition',draftArgs());await success('publish_competition',{p_competition_id:closing});
  holder=await hold(`update app.competitions set starts_at=clock_timestamp()-interval '1 minute',ends_at=clock_timestamp()+interval '0.4 seconds' where id=${literal(closing)}`,1.5);
  pending=rpc('set_competition_paused',{p_competition_id:closing,p_paused:true},admin);
  await holder.done;check((await pending).data.code==='55000','Lock wait crossing deadline cannot pause or reopen closed voting');
  const concurrent=await success('create_competition',draftArgs());const auditsBefore=auditCount();
  const publishes=await Promise.all([rpc('publish_competition',{p_competition_id:concurrent},admin),rpc('publish_competition',{p_competition_id:concurrent},superAdmin)]);
  check(publishes.filter(r=>r.status===200).length===1&&publishes.filter(r=>r.data.code==='55000').length===1,'Concurrent publication serializes to one success');
  check(auditCount()===auditsBefore+1,'Concurrent publication commits one audit');
  const revokeWait=await success('create_competition',draftArgs());
  holder=await hold(`select id from app.competitions where id=${literal(revokeWait)} for update`,3);
  pending=rpc('set_competition_visibility',visibility(revokeWait),admin);
  await new Promise((resolveWait)=>setTimeout(resolveWait,150));
  sql(`update app.staff_roles set active=false where user_id=${literal(admin.user.id)};`);
  await holder.done;check((await pending).data.code==='42501','Authority rechecked after lock wait with old JWT');
  for(const [name,args] of managementCalls) await failure(name,args,'42501',admin);
  sql(`update app.staff_roles set active=false where user_id=${literal(superAdmin.user.id)};`);
  await failure('create_competition',draftArgs(),'42501',superAdmin);
  for(const user of [undefined,ordinary,admin,superAdmin,inactive]){
    const response=await request('/rest/v1/competitions',{},user);
    check(response.status===404,'No client base-table mutation endpoint');
  }
  check(ledgerDigest()===beforeLedger,'Original votes, guards, adjustments and result ledgers unchanged');
  sql(`do $$ declare r text; t text; begin
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_schema_privilege(r,'app','USAGE,CREATE') or pg_has_role(r,'nhs_management_writer','MEMBER') then raise exception 'Client management privilege'; end if;
    end loop;
    foreach t in array array['votes','competition_voters','staff_roles','vote_adjustments','vote_adjustment_requests','result_publications','result_rows','media_assets'] loop
      if has_table_privilege('nhs_management_writer','app.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') then raise exception 'Writer reaches protected table %',t; end if;
    end loop;
    if has_table_privilege('nhs_management_writer','app.audit_logs','SELECT,UPDATE,DELETE,TRUNCATE') then raise exception 'Audit access exceeds INSERT'; end if;
    if has_column_privilege('nhs_management_writer','app.competitions','archived_at','UPDATE') or has_column_privilege('nhs_management_writer','app.competitions','slug','UPDATE')
      or has_column_privilege('nhs_management_writer','app.candidates','competition_id','UPDATE') then raise exception 'Destructive or identity update grant'; end if;
    if exists(select 1 from pg_roles where rolname='nhs_management_writer' and (rolcanlogin or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication or rolinherit)) then raise exception 'Unsafe writer role'; end if;
  end; $$;`);
  check(true,'Writer and client permission audit passed');
  console.log(`PASS: ${checks} competition-management assertions including real RPC authorization, lifecycle/locks, audit rollback and protected-ledger checks.`);
  const catalog=sql(`select jsonb_build_object('routines',(select jsonb_agg(jsonb_build_array(p.proname,p.proowner::regrole::text,pg_get_functiondef(p.oid),p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','api')),'policies',(select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname) from pg_policies p where schemaname='app'))::text;`);
  console.log(`Management catalog SHA256: ${digest(catalog)}`);
}
main().catch((error)=>{console.error(error.message);process.exitCode=1;});
