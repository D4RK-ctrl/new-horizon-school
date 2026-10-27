// Actual local Auth, gateway, PostgREST and separate PostgreSQL connections.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
let checks=0,races=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
const lit=x=>`'${String(x).replaceAll("'","''")}'`;
function command(binary,args,input,allowFailure=false){const r=spawnSync(binary,args,{input,encoding:'utf8',maxBuffer:8*1024*1024});if(!allowFailure&&r.status!==0)throw new Error(`Local SQL/tool failed: ${r.stderr}`);return r;}
const psql=['exec','-i','supabase_db_nhs-phase2a-verification','psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const sql=q=>command('docker',psql,q).stdout.trim();
check(!existsSync('supabase/.temp/project-ref'),'No remote link');
check(readFileSync('supabase/config.toml','utf8').includes('project_id = "nhs-phase2a-verification"'),'Dedicated project');
const status=JSON.parse(command(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'status','-o','json']).stdout);
check(status.API_URL==='http://127.0.0.1:55431','Loopback API only');
const anon=status.ANON_KEY,service=status.SERVICE_ROLE_KEY;
const gateway=spawn(process.execPath,['server/local-sms-gateway.mjs'],{env:{...process.env,SMS_SUPABASE_URL:status.API_URL,
 SMS_ANON_KEY:anon,SMS_SERVICE_KEY:service,SMS_RATE_SECRET:randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
let gatewayOutput='';gateway.stdout.on('data',x=>gatewayOutput+=x);gateway.stderr.on('data',x=>gatewayOutput+=x);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,label,ms=10000){const until=Date.now()+ms;while(!await fn()){if(Date.now()>until)throw new Error(label);await pause(30);}}
async function request(path,body,token=anon,method='POST'){
 const r=await fetch(status.API_URL+path,{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Connection:'close',
 ...(path.startsWith('/rest/')?{'Accept-Profile':'api','Content-Profile':'api'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});
 const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null,headers:r.headers};
}
const rpc=(name,args={},session)=>request(`/rest/v1/rpc/${name}`,args,session?.access_token??anon);
const claims=s=>JSON.parse(Buffer.from(s.access_token.split('.')[1],'base64url').toString());
const context=s=>lit(JSON.stringify({role:'authenticated',sub:claims(s).sub,session_id:claims(s).session_id}));
const phone=n=>`9199990000${String(n).padStart(2,'0')}`;
async function sms(n){
 sql('delete from app.sms_verification_limits;'); // Disposable test fixture, no product reset API.
 check((await request('/auth/v1/otp',{phone:phone(n),channel:'sms'})).status===200,'Synthetic SMS delivery request');
 const r=await fetch('http://127.0.0.1:55439/verify-sms',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',Connection:'close'},body:JSON.stringify({phone:`+${phone(n)}`,code:'624810'})});
 const data=await r.json();check(r.status===200&&data.access_token,'Real gateway SMS proof');return data;
}
const fixtures=[];
let owner;
function competition(n=2,size=4,options={}){
 const id=randomUUID(),candidates=Array.from({length:size},()=>randomUUID());fixtures.push(id);
 const {start="clock_timestamp()-interval '1 minute'",end="clock_timestamp()+interval '20 minutes'",published=true,enabled=true,paused=false,archived=false}=options;
 sql(`insert into app.competitions(id,slug,title,max_votes_per_voter,starts_at,ends_at,published_by,published_at,enabled,paused,archived_at,created_by,updated_by)
 values(${lit(id)},${lit('vote-'+id)},'Synthetic voting',${n},${start},${end},${published?lit(owner):'null'},${published?"clock_timestamp()-interval '2 minutes'":'null'},${enabled&&published&&!archived},${paused},${archived?'clock_timestamp()':'null'},${lit(owner)},${lit(owner)});
 insert into app.candidates(id,competition_id,slug,display_name,created_by,updated_by) values
 ${candidates.map((x,i)=>`(${lit(x)},${lit(id)},'candidate-${i}','Synthetic candidate',${lit(owner)},${lit(owner)})`).join(',')};`);
 return {id,candidates,n};
}
const rows=c=>Number(sql(`select count(*) from app.votes where competition_id=${lit(c.id)};`));
const guards=c=>Number(sql(`select count(*) from app.competition_voters where competition_id=${lit(c.id)};`));
const cast=(c,i,s)=>rpc('cast_vote',{p_competition_id:c.id,p_candidate_id:c.candidates[i]},s);
async function accepted(c,i,s,replayed=false){const r=await cast(c,i,s);check(r.status===200&&r.data.length===1&&r.data[0].replayed===replayed,`Vote receipt ${replayed?'replay':'acceptance'} (${r.status}/${r.data?.code??''})`);check(r.headers.get('cache-control')==='no-store','Own receipt cannot be cached');return r.data[0];}
async function denied(c,i,s,code){const before=rows(c),r=await cast(c,i,s);check(r.status>=400&&r.data.code===code,`Vote rejection ${code} (${r.status}/${r.data?.code??''})`);check(rows(c)===before,'Rejected vote inserts nothing');return r;}
async function own(c,s){const r=await rpc('own_voting_state',{p_competition_id:c.id},s);check(r.status===200&&r.data.length===1,'Own state returns one row');check(r.headers.get('cache-control')==='no-store','Own state cannot be cached');return r.data[0];}
function invariant(){check(sql(`select count(*) from (select v.competition_id,v.voter_id from app.votes v join app.competitions c on c.id=v.competition_id
 where v.competition_id in (${fixtures.map(lit).join(',')}) group by v.competition_id,v.voter_id,c.max_votes_per_voter having count(*)>c.max_votes_per_voter) x;`)==='0','Every persisted voter/competition count is <= N');}
async function hold(before,seconds=1.4){
 const child=spawn('docker',psql,{stdio:['pipe','pipe','pipe']});let out='',err='';let ready;
 const started=new Promise(r=>{ready=r;});child.stdout.on('data',x=>{out+=x;if(out.includes('LOCK-READY'))ready();});child.stderr.on('data',x=>err+=x);
 const done=new Promise((resolveDone,reject)=>{child.on('error',reject);child.on('close',code=>{ready();code===0?resolveDone():reject(new Error(`Local holder failed: ${err}`));});});
 if(seconds===null)child.stdin.write(`begin; ${before}; select 'LOCK-READY';\n`);
 else child.stdin.end(`begin; ${before}; select 'LOCK-READY'; select pg_sleep(${seconds}); commit;`);
 await started;check(out.includes('LOCK-READY'),'Independent PostgreSQL lock-holder session acquired lock');
 if(seconds===null){let released=false;return {get done(){if(!released){released=true;child.stdin.end('commit;\n\\q\n');}return done;}};}
 return {done};
}
async function observed(name='cast_vote',count=1){await pause(50);await waitFor(()=>Number(sql(`select count(*) from pg_stat_activity where pid<>pg_backend_pid() and state='active' and wait_event_type='Lock' and query like ${lit('%'+name+'%')};`))>=count,'Expected actual API lock wait',1400);check(true,`Observed ${count} actual authenticated SQL request(s) waiting`);}
async function gated(comps,fn){
 const key=190327;sql(`create function app.voting_test_gate() returns trigger language plpgsql set search_path='' as $$ begin
 if new.competition_id in (${comps.map(c=>lit(c.id)).join(',')}) then perform pg_catalog.pg_advisory_xact_lock_shared(${key}); end if; return new; end $$;
 create trigger voting_test_gate before insert on app.votes for each row execute function app.voting_test_gate();`);
 const lock=await hold(`select pg_advisory_xact_lock(${key})`,null);
 try{return await fn(lock);}finally{await lock.done;sql('drop trigger voting_test_gate on app.votes; drop function app.voting_test_gate();');invariant();races++;}
}
const protectedDigest=()=>createHash('sha256').update(sql(`select jsonb_build_array(
 (select jsonb_agg(to_jsonb(x) order by id) from app.vote_adjustments x),
 (select jsonb_agg(to_jsonb(x) order by id) from app.result_publications x),
 (select jsonb_agg(to_jsonb(x) order by publication_id,candidate_id) from app.result_rows x))::text;`)).digest('hex');
try{
 await waitFor(()=>gatewayOutput.includes('Local SMS gateway ready'),'Gateway ready');
 const beforeProtected=protectedDigest();
 const address=`voting-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-9Aa!`;
 const seeded=await request('/auth/v1/admin/users',{email:address,email_confirm:true,phone:phone(11),phone_confirm:true,password},service);
 check(seeded.status===200,'Synthetic email/phone account through supported Auth Admin');
 const emailLink=await request('/auth/v1/admin/generate_link',{email:address,type:'magiclink'},service);
 const email=await request('/auth/v1/verify',{email:address,token:emailLink.data.email_otp,type:'email'});
 const pw=await request('/auth/v1/token?grant_type=password',{email:address,password});
 check(email.status===200&&pw.status===200&&email.data.user.phone_confirmed_at,'Genuine email OTP/password sessions with confirmed Indian phone');
 const A=await sms(11),B=await sms(8);let C=await sms(3);owner=claims(A).sub;
 const adminSignup=await request('/auth/v1/signup',{email:`vote-admin-${randomUUID()}@example.test`,password:`Synthetic-${randomUUID()}-9Aa!`});
 check(adminSignup.status===200&&adminSignup.data.access_token,'Real email Admin fixture');const admin=adminSignup.data;
 sql(`insert into app.staff_roles(user_id,role,active) values(${lit(admin.user.id)},'admin',true);`);
 const c=competition(2);
 const first=await accepted(c,0,A);check(first.accepted_vote_count===1&&first.remaining_allowance===1,'N>1 first usage');
 check((await accepted(c,0,A,true)).vote_id===first.vote_id&&rows(c)===1,'Duplicate/network retry returns identical receipt, one row');
 await accepted(c,1,A);await denied(c,2,A,'54000');
 const adjustmentRequest=randomUUID();
 const adjusted=sql(`begin;
 insert into app.vote_adjustment_requests(id,competition_id,candidate_id,delta,reason,proposed_by,proposed_at,state,reviewed_by,reviewed_at)
 values(${lit(adjustmentRequest)},${lit(c.id)},${lit(c.candidates[0])},7,'Synthetic rollback-only usage fixture',${lit(owner)},clock_timestamp()-interval '1 second','approved',${lit(owner)},clock_timestamp());
 insert into app.vote_adjustments(competition_id,candidate_id,request_id,delta,reason,applied_by)
 values(${lit(c.id)},${lit(c.candidates[0])},${lit(adjustmentRequest)},7,'Synthetic rollback-only usage fixture',${lit(owner)});
 set local role authenticated; set local request.jwt.claims=${context(A)};
 select accepted_vote_count,remaining_allowance from api.own_voting_state(${lit(c.id)}); rollback;`);
 check(adjusted.includes('2|0')&&adjusted.endsWith('ROLLBACK'),'Applied adjustment fixture cannot alter original vote usage; fixture rolled back');
 check((await own(c,A)).receipts.length===2,'Own receipts include only accepted choices');
 check((await own(c,B)).accepted_vote_count===0&&(await own(c,B)).receipts.length===0,'Different voter cannot see A history');
 for(const s of [undefined,email.data,pw.data,{access_token:service}]){const r=await cast(c,2,s);check(r.status>=400,'Missing JWT/email/password/service role denied');check((await rpc('own_voting_state',{p_competition_id:c.id},s)).status>=400,'Own receipts require live SMS identity');}
 const bad=A.access_token.split('.');bad[1]=Buffer.from(JSON.stringify({...claims(A),sub:claims(B).sub})).toString('base64url');
 check((await request('/rest/v1/rpc/cast_vote',{p_competition_id:c.id,p_candidate_id:c.candidates[2]},bad.join('.'))).status===401,'Forged JWT identity denied');
 check((await rpc('cast_vote',{p_competition_id:c.id,p_candidate_id:c.candidates[2],p_voter_id:claims(B).sub},A)).status===404,'Caller-selected voter cannot bind RPC');
 check((await rpc('own_voting_state',{p_competition_id:c.id,p_voter_id:claims(A).sub},B)).status===404,'Own state accepts no target-user identifier');
 check((await rpc('cast_vote',{p_competition_id:null,p_candidate_id:null},A)).data.code==='22023','Null arguments denied');
 const one=competition(1);await accepted(one,0,A);await denied(one,1,A,'54000');
 const wide=competition(8,2);await accepted(wide,0,A);await accepted(wide,1,A);check((await own(wide,A)).remaining_allowance===6,'N can exceed eligible count without duplicate usage');
 const other=competition(2);await accepted(other,0,A);check((await own(other,A)).accepted_vote_count===1,'Independent competition allowance');
 const foreign={id:other.id,candidates:c.candidates};await denied(foreign,0,B,'P0002');
 const ineligible=competition();sql(`update app.candidates set eligible=false where id=${lit(ineligible.candidates[0])};`);await denied(ineligible,0,A,'P0002');
 const missing={id:randomUUID(),candidates:[randomUUID()]};check((await cast(missing,0,A)).data.code==='P0002','Unknown competition denied');
 await denied({id:other.id,candidates:[randomUUID()]},0,A,'P0002');
 for(const [state,options] of [['draft',{published:false}],['disabled',{enabled:false}],['paused',{paused:true}],['archived',{archived:true}],['upcoming',{start:"clock_timestamp()+interval '1 minute'"}],['closed',{end:"clock_timestamp()-interval '1 second'"}]]){
  const closed=competition(2,2,options);await denied(closed,0,A,state==='draft'?'P0002':'55000');
  if(state==='draft')check((await rpc('own_voting_state',{p_competition_id:closed.id},A)).data.code==='P0002','Unpublished config is not disclosed');
  else check((await own(closed,A)).availability===state,'Availability state is explicit');
  check(guards(closed)===0,'Rejected first attempt rolls guard back');
 }
 const deadline=competition(2,2,{end:"clock_timestamp()+interval '2 seconds'"});const old=await accepted(deadline,0,A);await pause(2200);
 check((await accepted(deadline,0,A,true)).vote_id===old.vote_id&&rows(deadline)===1,'After-deadline retry returns historical receipt');await denied(deadline,0,email.data,'42501');await denied(deadline,1,A,'55000');
 check((await own(deadline,A)).availability==='closed'&&(await own(deadline,A)).receipts.length===1,'Historical own receipts survive closure');
 for(const patch of ['paused=true','enabled=false','enabled=false,archived_at=clock_timestamp()']){sql(`update app.competitions set ${patch} where id=${lit(deadline.id)};`);check((await accepted(deadline,0,A,true)).vote_id===old.vote_id,'Historical replay survives nonaccepting published states');}
 console.log('PASS: voting identity, allowance, lifecycle and own-receipt rules.');

 const duplicate=competition(2);await gated([duplicate],async lock=>{const tasks=[cast(duplicate,0,A),cast(duplicate,0,A)];await observed('cast_vote',2);await lock.done;const r=await Promise.all(tasks);check(r.every(x=>x.status===200)&&r.filter(x=>x.data[0].replayed===false).length===1,'Concurrent same-candidate first vote is idempotent');check(r[0].data[0].vote_id===r[1].data[0].vote_id&&rows(duplicate)===1,'Duplicate race persists one immutable row');});
 const last=competition(1);await gated([last],async lock=>{const tasks=[cast(last,0,A),cast(last,1,A)];await observed('cast_vote',2);await lock.done;const r=await Promise.all(tasks);check(r.filter(x=>x.status===200).length===1&&r.filter(x=>x.data.code==='54000').length===1&&rows(last)===1,'Two candidates cannot exceed final allowance');});
 const many=competition(3,6);await gated([many],async lock=>{const tasks=many.candidates.map((_,i)=>cast(many,i,A));await observed('cast_vote',3);await lock.done;const r=await Promise.all(tasks);check(r.filter(x=>x.status===200).length===3&&r.filter(x=>x.data.code==='54000').length===3&&rows(many)===3,'Six real submissions persist exactly N=3');});
 const users=competition(1);await gated([users],async lock=>{const tasks=[cast(users,0,A),cast(users,0,B)];await observed('cast_vote',2);await lock.done;check((await Promise.all(tasks)).every(x=>x.status===200)&&rows(users)===2,'Independent voters concurrently reach insertion and each persist one');});
 const d1=competition(1),d2=competition(1);await gated([d1,d2],async lock=>{const tasks=[cast(d1,0,A),cast(d2,0,A)];await observed('cast_vote',2);await lock.done;check((await Promise.all(tasks)).every(x=>x.status===200)&&rows(d1)===1&&rows(d2)===1,'Same voter can process different competition guards concurrently');});
 const racingPause=competition(2);await gated([racingPause],async lock=>{const vote=cast(racingPause,0,A);await observed();const changing=rpc('set_competition_paused',{p_competition_id:racingPause.id,p_paused:true},admin);await observed('set_competition_paused');await lock.done;check((await vote).status===200&&(await changing).status===200&&rows(racingPause)===1,'Actual Admin pause waits for accepted shared-lock vote');check(sql(`select paused from app.competitions where id=${lit(racingPause.id)};`)==='t','Actual Admin pause persisted');await denied(racingPause,1,A,'55000');});
 for(const [name,mutation,expected] of [
  ['admin-first',"paused=true",'55000'],
  ['start',"starts_at=clock_timestamp()+interval '700 milliseconds'",null],
  ['deadline',"ends_at=clock_timestamp()+interval '700 milliseconds'",'55000'],
 ]){
  const waiting=competition(2);const holder=await hold(`update app.competitions set ${mutation} where id=${lit(waiting.id)}`,null);const task=cast(waiting,0,A);
  try{await observed();if(name!=='admin-first')await pause(800);}finally{await holder.done;}const result=await task;
  check(expected?result.data.code===expected:result.status===200,`Post-lock ${name} state/time rechecked`);check(rows(waiting)===(expected?0:1),`Persisted rows after ${name} boundary`);if(expected)check(guards(waiting)===0,'Boundary rejection rolls initial guard back');invariant();races++;
 }
 const locked=competition(1);const blocking=await hold(`select id from app.competitions where id=${lit(locked.id)} for update`,null);const timed=cast(locked,0,A);
 try{await observed();const timeout=await timed;check(timeout.data.code==='55P03'&&rows(locked)===0&&guards(locked)===0,'2-second lock timeout rolls everything back');}finally{await blocking.done;}
 await accepted(locked,0,A);invariant();races++;
 const expiry=competition(1);sql(`insert into app.competition_voters(competition_id,voter_id) values(${lit(expiry.id)},${lit(claims(C).sub)});`);
 const gate=await hold(`select competition_id from app.competition_voters where competition_id=${lit(expiry.id)} and voter_id=${lit(claims(C).sub)} for update`,null);const expired=cast(expiry,0,C);
 try{await observed();sql(`update app.sms_session_attestations set expires_at=clock_timestamp()+interval '100 milliseconds' where session_id=${lit(claims(C).session_id)};`);await pause(150);}finally{await gate.done;}
 check((await expired).data.code==='42501'&&rows(expiry)===0,'Proof expiry during own-guard wait is denied');invariant();races++;
 check((await rpc('own_voting_state',{p_competition_id:c.id},C)).data.code==='42501','Expired proof cannot retrieve history');
 C=await sms(3);check((await request(`/auth/v1/admin/users/${claims(C).sub}`,{ban_duration:'1h'},service,'PUT')).status===200,'Supported Auth account ban');await denied(other,1,C,'42501');
 check((await request(`/auth/v1/admin/users/${claims(C).sub}`,{ban_duration:'none'},service,'PUT')).status===200,'Supported Auth unban');
 check((await request('/auth/v1/logout?scope=local',{},C.access_token)).status===204,'Supported Auth session revocation');await denied(other,1,C,'42501');
 C=await sms(3);check((await request(`/auth/v1/admin/users/${claims(C).sub}`,{phone:'919999001234',phone_confirm:true},service,'PUT')).status===200,'Supported synthetic verified phone change, no delivery');await denied(other,1,C,'42501');
 console.log('PASS: real database duplicate/allowance/independent-voter/Admin/start/deadline/proof-expiry races.');

 const failing=competition(1);sql(`create function app.voting_test_failure() returns trigger language plpgsql set search_path='' as $$ begin
 if new.competition_id=${lit(failing.id)}::uuid then raise exception 'Synthetic voting failure' using errcode='P0001'; end if; return new; end $$;
 create trigger voting_test_failure before insert on app.votes for each row execute function app.voting_test_failure();`);
 try{await denied(failing,0,A,'P0001');check(guards(failing)===0,'Injected failure rolls new guard back');}finally{sql('drop trigger voting_test_failure on app.votes; drop function app.voting_test_failure();');}
 const committed=await accepted(failing,0,A);check((await accepted(failing,0,A,true)).vote_id===committed.vote_id&&rows(failing)===1,'Retry after rollback then committed receipt never duplicates');invariant();races++;
 const slow=competition(1);sql(`create function app.voting_test_slow() returns trigger language plpgsql set search_path='' as $$ begin
 if new.competition_id=${lit(slow.id)}::uuid then perform pg_catalog.pg_sleep(9); end if; return new; end $$;
 create trigger voting_test_slow before insert on app.votes for each row execute function app.voting_test_slow();`);
 try{const began=Date.now();await denied(slow,0,A,'57014');check(Date.now()-began>=7500&&Date.now()-began<14000,'Actual PostgREST timeout occurs around configured 8 seconds');check(guards(slow)===0,'Hoisted 8-second statement timeout rolls guard back');}finally{sql('drop trigger voting_test_slow on app.votes; drop function app.voting_test_slow();');}races++;invariant();
 for(const statement of [`update app.votes set accepted_at=accepted_at where id=${lit(first.vote_id)}`,`delete from app.votes where id=${lit(first.vote_id)}`,'truncate app.votes']){
  const deniedMutation=command('docker',psql,`begin; ${statement}; rollback;`,true);check(deniedMutation.status!==0&&deniedMutation.stderr.includes('55000')&&deniedMutation.stderr.includes('append-only'),'Operator UPDATE/DELETE/TRUNCATE rejected by original immutable trigger');
 }
 for(const role of ['anon','authenticated','service_role']){
  const deniedWrite=command('docker',psql,`begin; set local role ${role}; insert into app.votes(competition_id,voter_id,candidate_id) values(${lit(c.id)},${lit(claims(A).sub)},${lit(c.candidates[2])}); rollback;`,true);
  check(deniedWrite.status!==0&&deniedWrite.stderr.includes('permission denied'),'Browser/service direct ledger INSERT denied');
 }
 for(const statement of [`update app.competitions set id=id where id=${lit(c.id)}`,`update app.competition_voters set voter_id=voter_id where competition_id=${lit(c.id)}`]){
  const deniedUpdate=command('docker',psql,`begin; set local role nhs_voting_writer; set local request.jwt.claims=${context(A)}; ${statement}; rollback;`,true);
  check(deniedUpdate.status!==0&&deniedUpdate.stderr.includes('row-level security'),'Lock-only UPDATE grant cannot perform actual row mutation');
 }
 const security=sql(`do $$ declare r text; t record; begin
  foreach r in array array['anon','authenticated','service_role','authenticator'] loop
   if pg_has_role(r,'nhs_voting_writer','MEMBER') or has_function_privilege(r,'app.require_voting_identity()','EXECUTE') then raise exception 'Voting owner/bridge leaked'; end if;
  end loop;
  if exists(select 1 from pg_roles where rolname='nhs_voting_writer' and (rolcanlogin or rolinherit or rolsuper or rolbypassrls or rolcreatedb or rolcreaterole or rolreplication)) then raise exception 'Unsafe voting owner'; end if;
  if has_schema_privilege('nhs_voting_writer','auth','USAGE') or has_any_column_privilege('nhs_voting_writer','app.sms_session_attestations','SELECT') or has_any_column_privilege('nhs_voting_writer','app.sms_proof_key','SELECT') or has_table_privilege('nhs_voting_writer','app.votes','UPDATE,DELETE,TRUNCATE') then raise exception 'Voting owner excessive grants'; end if;
  if has_table_privilege('nhs_voting_writer','app.audit_logs','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('nhs_voting_writer','app.vote_adjustments','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Other ledger privilege'; end if;
  for t in select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' loop
   if not t.relrowsecurity or t.relowner='nhs_voting_writer'::regrole then raise exception 'Voting RLS bypass'; end if;
  end loop;
 end $$;`);check(security==='DO','Effective owner/bridge/schema/ledger/RLS permissions verified');
 const isolation=command('docker',psql,`begin isolation level repeatable read; set local role authenticated; set local request.jwt.claims=${context(A)}; select * from api.cast_vote(${lit(other.id)},${lit(other.candidates[1])}); rollback;`,true);
 check(isolation.status!==0&&isolation.stderr.includes('READ COMMITTED required'),'Unsafe repeatable-read caller refused');
 const ownResult=await own(c,A);check(Object.keys(ownResult).sort().join(',')==='accepted_vote_count,availability,competition_id,max_votes_per_voter,receipts,remaining_allowance','Own response omits other voter IDs, phones, adjustments, totals and audits');
 sql(`update app.sms_session_attestations set expires_at=clock_timestamp()-interval '1 second' where session_id=${lit(claims(A).session_id)};`);
 await denied(deadline,0,A,'42501');
 check(protectedDigest()===beforeProtected,'Adjustments and immutable result snapshots unchanged');
 invariant();console.log(`PASS: ${checks} voting assertions; ${races} real connection race/failure scenarios; 0 failed, 0 skipped.`);
 const catalog=sql(`select jsonb_build_object('routines',(select jsonb_agg(pg_get_functiondef(p.oid) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','api') and (p.proowner='nhs_voting_writer'::regrole or p.proname='require_voting_identity')),'policies',(select jsonb_agg(to_jsonb(x) order by tablename,policyname) from pg_policies x where schemaname='app' and roles::text[]=array['nhs_voting_writer']))::text;`);
 console.log(`Voting catalog SHA256: ${createHash('sha256').update(catalog).digest('hex')}`);
}catch(error){console.error(gatewayOutput.trim());throw error;}finally{gateway.kill();}
