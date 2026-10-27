// Real local Auth + PostgREST + HTTP gateway verification. Synthetic data only.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {resolve} from 'node:path';
let checks=0;
const check=(ok,label)=>{assert.ok(ok,label);checks++;};
const literal=x=>`'${String(x).replaceAll("'","''")}'`;
function command(binary,args,input){const r=spawnSync(binary,args,{input,encoding:'utf8',maxBuffer:8*1024*1024});if(r.status!==0)throw new Error(`Local verification command failed: ${r.stderr}`);return r.stdout.trim();}
const sql=q=>command('docker',['exec','-i','supabase_db_nhs-phase2a-verification','psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],q);
assert(!existsSync('supabase/.temp/project-ref'));
assert(readFileSync('supabase/config.toml','utf8').includes('project_id = "nhs-phase2a-verification"'));
const status=JSON.parse(command(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'status','-o','json']));
assert.equal(status.API_URL,'http://127.0.0.1:55431');
const anon=status.ANON_KEY,service=status.SERVICE_ROLE_KEY;
const gateway=spawn(process.execPath,['server/local-sms-gateway.mjs'],{env:{...process.env,
 SMS_SUPABASE_URL:status.API_URL,SMS_ANON_KEY:anon,SMS_SERVICE_KEY:service,SMS_RATE_SECRET:randomBytes(32).toString('hex')},stdio:['ignore','pipe','pipe']});
let output='';gateway.stdout.on('data',x=>output+=x);gateway.stderr.on('data',x=>output+=x);
async function waitFor(test){const until=Date.now()+15000;while(!test()){if(Date.now()>until)throw new Error('Local gateway readiness timeout');await new Promise(r=>setTimeout(r,50));}}
async function request(path,body,token=anon,method='POST'){
 const r=await fetch(status.API_URL+path,{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Connection:'close',
 ...(path.startsWith('/rest/')?{'Accept-Profile':'api','Content-Profile':'api'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();return {status:r.status,data:text?JSON.parse(text):null};
}
const rpc=(name,args={},token=anon)=>request(`/rest/v1/rpc/${name}`,args,token);
const decode=s=>JSON.parse(Buffer.from(s.access_token.split('.')[1],'base64url').toString());
const phone=i=>`9199990000${String(i).padStart(2,'0')}`;
const count=()=>Number(sql('select count(*) from app.sms_session_attestations;'));
const clearLimits=()=>sql('delete from app.sms_verification_limits;'); // Test-only operator fixture.
async function send(i){const r=await request('/auth/v1/otp',{phone:phone(i),channel:'sms'});check(r.status===200,`SMS challenge ${i} requested through supported Auth API`);return r;}
async function verify(i,extra={}){
 const r=await fetch('http://127.0.0.1:55439/verify-sms',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',Connection:'close'},body:JSON.stringify({phone:`+${phone(i)}`,code:'624810',...extra})});
 return {status:r.status,data:await r.json(),headers:r.headers};
}
const state=async session=>{const r=await rpc('sms_session_status',{},session.access_token);check(r.status===200,'Own proof status is available only through narrow RPC');return r.data;};
const ledgerDigest=()=>createHash('sha256').update(sql(`select jsonb_build_array(
 (select jsonb_agg(to_jsonb(x) order by id) from app.votes x),
 (select jsonb_agg(to_jsonb(x) order by competition_id,voter_id) from app.competition_voters x),
 (select jsonb_agg(to_jsonb(x) order by id) from app.audit_logs x),
 (select jsonb_agg(to_jsonb(x) order by id) from app.result_publications x),
 (select jsonb_agg(to_jsonb(x) order by id) from app.vote_adjustments x))::text;`)).digest('hex');
try{
 await waitFor(()=>output.includes('Local SMS gateway ready'));
 const protectedBefore=ledgerDigest();
 await send(1);
 check(sql(`select phone_confirmed_at is null from auth.users where phone=${literal(phone(1))};`)==='t','New phone is initially unverified');
 check(count()===0,'Unverified phone has no proof');
 const first=await verify(1);
 check(first.status===200&&first.data.access_token&&first.data.refresh_token,`Gateway exchanges actual SMS OTP and returns Auth-issued session (HTTP ${first.status}; ${output.trim()})`);
 check(first.headers.get('cache-control')==='no-store','Session response is never cacheable');
 check(count()===1&&await state(first.data)===true,'SMS-verified session has exactly one live proof');
 const firstClaims=decode(first.data),uid=firstClaims.sub,sid=firstClaims.session_id;
 check(sql(`select user_id=${literal(uid)}::uuid from app.sms_session_attestations where session_id=${literal(sid)}::uuid;`)==='t','Proof bound to verified user/session');
 check(sql(`select octet_length(phone_binding)=32 and expires_at<=verified_at+interval '15 minutes' from app.sms_session_attestations where session_id=${literal(sid)}::uuid;`)==='t','Keyed phone binding and bounded database expiry');
 const proofDeadline=first.data.sms_proof_expires_at;
 const refreshed=await request('/auth/v1/token?grant_type=refresh_token',{refresh_token:first.data.refresh_token});
 check(refreshed.status===200&&decode(refreshed.data).session_id===sid&&await state(refreshed.data)===true,'Supported session refresh retains same live binding');
 check(sql(`select expires_at=${literal(proofDeadline)}::timestamptz from app.sms_session_attestations where session_id=${literal(sid)};`)==='t','Refresh does not extend proof lifetime');
 const before=count();
 const retry=await verify(1);check(retry.status===401&&count()===before,'Consumed challenge cannot mint another gateway proof');
 // Auth deliberately accepts repeated fixed codes; direct sessions remain untrusted.
 const direct=await request('/auth/v1/verify',{phone:phone(1),token:'624810',type:'sms'});
 check(direct.status===200,'Direct fixed-code SMS Auth verification succeeds outside gateway');
 check(await state(direct.data)===false&&count()===before,'Direct SMS session cannot create/reuse attestation');
 check(decode(direct.data).session_id!==sid,'Another session on same account cannot reuse first proof');
 const email=`sms-proof-${randomUUID()}@example.test`,password=`Synthetic-${randomUUID()}-9Aa!`;
 const linked=await request(`/auth/v1/admin/users/${uid}`,{email,email_confirm:true,password},service,'PUT');
 check(linked.status===200,'Supported local Auth admin links synthetic email/password');
 const link=await request('/auth/v1/admin/generate_link',{email,type:'magiclink'},service);
 check(link.status===200&&link.data.email_otp,'Supported Auth generates local email OTP');
 const mail=await request('/auth/v1/verify',{email,token:link.data.email_otp,type:'email'});
 check(mail.status===200&&mail.data.user.phone_confirmed_at,'Email OTP session has confirmed Indian phone');
 check(decode(mail.data).amr.some(x=>x.method==='otp')&&await state(mail.data)===false,'Generic email OTP AMR never qualifies');
 const savedCount=count(),consumedLease=sql(`select lease_id from app.sms_verification_challenges where user_id=${literal(uid)} order by sent_at limit 1;`);
 check((await rpc('attest_sms_session',{p_lease_id:randomUUID(),p_session_id:decode(mail.data).session_id},service)).status>=400,'Even server operation rejects a manufactured lease');
 check((await rpc('attest_sms_session',{p_lease_id:consumedLease,p_session_id:decode(mail.data).session_id},service)).status>=400&&count()===savedCount,'Consumed SMS reservation cannot attest an email session');
 const passwordSession=await request('/auth/v1/token?grant_type=password',{email,password});
 check(passwordSession.status===200&&await state(passwordSession.data)===false,'Email/password session rejected as SMS proof');
 for(const token of [anon,mail.data.access_token,passwordSession.data.access_token,direct.data.access_token]){
  for(const [name,args] of [['reserve_sms_verification',{p_phone:phone(1),p_network_key:'a'.repeat(64)}],['attest_sms_session',{p_lease_id:randomUUID(),p_session_id:sid}],['cancel_sms_verification',{p_lease_id:randomUUID()}]]){
   const r=await rpc(name,args,token);check(r.status>=400,`Client denied server operation ${name}`);
  }
  for(const table of ['sms_session_attestations','sms_proof_key','sms_verification_challenges','sms_verification_limits']){
   const r=await request(`/rest/v1/${table}`,undefined,token,'GET');check(r.status>=400,'Private proof storage absent from Data API');
  }
 }
 const modified=await request('/auth/v1/user',{data:{sms_verified:true,session_id:sid,phone_verified:true}},mail.data.access_token,'PUT');
 check(modified.status===200&&await state(mail.data)===false,'User-editable metadata cannot manufacture proof');
 const jwt=mail.data.access_token.split('.');jwt[1]=Buffer.from(JSON.stringify({...decode(mail.data),session_id:sid})).toString('base64url');
 check((await rpc('sms_session_status',{},jwt.join('.'))).status===401,'Forged session ID fails PostgREST JWT validation');
 check([400,413].includes((await verify(1,{access_token:mail.data.access_token})).status),'Gateway refuses existing email JWT as input');
 check((await verify(1,{session_id:sid,user_id:uid})).status===400,'Gateway refuses caller-selected IDs');
 check((await verify(1,{phone:'+12025550123'})).status===400,'Non-Indian number rejected before Auth');
 check((await verify(1,{code:'000000'})).status===401,'Incorrect code cannot mint proof on consumed challenge');
 for(const [label,number,confirmed] of [['unverified',phone(9),false],['foreign','12025550123',true]]){
  const address=`sms-${label}-${randomUUID()}@example.test`,pass=`Synthetic-${randomUUID()}-9Aa!`;
  const created=await request('/auth/v1/admin/users',{email:address,email_confirm:true,phone:number,phone_confirm:confirmed,password:pass},service);
  check(created.status===200,`Supported ${label} phone fixture`);
  const login=await request('/auth/v1/token?grant_type=password',{email:address,password:pass});
  check(login.status===200&&Boolean(login.data.user.phone_confirmed_at)===confirmed&&await state(login.data)===false,`${label} phone session does not qualify`);
 }
 clearLimits();await send(2);
 const badBefore=count();check((await verify(2,{code:'000000'})).status===401&&count()===badBefore,'Incorrect code rejected by actual SMS Auth flow');
 await new Promise(r=>setTimeout(r,150));
 const second=await verify(2);check(second.status===200&&await state(second.data)===true,'Correct code succeeds after failed attempt/lease cancellation');
 check(decode(second.data).sub!==uid&&decode(second.data).session_id!==sid,'Different user has independent proof');
 const foreignBody=await rpc('sms_session_status',{p_session_id:sid},second.data.access_token);
 check(foreignBody.status>=400,'Own-status RPC does not accept another session identifier');
 // Real pending Auth challenge expiry, advanced by the disposable operator.
 await send(3);sql(`update auth.users set confirmation_sent_at=clock_timestamp()-interval '2 minutes' where phone=${literal(phone(3))};`);
 check((await verify(3)).status===401,'Expired pending challenge rejected even with local reusable test code');
 await send(4);
 const parallel=await Promise.all([verify(4),verify(4)]);
 check(parallel.filter(x=>x.status===200).length===1,'Simultaneous same-challenge gateway attempts produce exactly one proof');
 const revocation=parallel.find(x=>x.status===200).data,revocationSid=decode(revocation).session_id;
 check(sql(`select count(*) from app.sms_session_attestations where user_id=(select id from auth.users where phone=${literal(phone(4))});`)==='1','Concurrent proof count stays one');
 clearLimits();await send(5);
 for(let i=0;i<5;i++){await verify(5,{code:'000000'});await new Promise(r=>setTimeout(r,100));}
 check((await verify(5)).status===429,'Durable per-phone limit rejects the sixth attempt');
 clearLimits();
 for(const index of [1,2,3,4,5])for(let attempt=0;attempt<4;attempt++)check((await verify(index,{code:'000000'})).status!==429,'Network bucket permits bounded attempts across distinct phones');
 const networkBlocked=await fetch('http://127.0.0.1:55439/verify-sms',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json',Connection:'close','X-Forwarded-For':'198.51.100.10'},body:JSON.stringify({phone:`+${phone(6)}`,code:'624810'})});
 check(networkBlocked.status===429,'Twenty-attempt network limit cannot be bypassed with forwarded-header forgery');
 // Expire proofs/session, revoke sessions, and change the current phone through
 // supported Auth APIs where available. Trusted SQL only advances fixture time.
 const secondSid=decode(second.data).session_id;
 sql(`update app.sms_session_attestations set verified_at=verified_at-interval '20 minutes',expires_at=expires_at-interval '20 minutes' where session_id=${literal(secondSid)};`);
 check(await state(second.data)===false,'Expired proof rejected while JWT remains authentic');
 check((await request('/auth/v1/logout?scope=local',{},revocation.access_token)).status===204,'Supported local Auth logout invalidates session');
 check(await state(revocation)===false,'Revoked session rejected with existing authentic JWT');
 check(sql(`select count(*) from app.sms_session_attestations where session_id=${literal(revocationSid)};`)==='0','Session deletion cascades removal of proof');
 clearLimits();await send(6);const sixth=await verify(6);check(sixth.status===200,'Fresh proof for phone-change test');
 const sixthUid=decode(sixth.data).sub;
 const changed=await request(`/auth/v1/admin/users/${sixthUid}`,{phone:phone(12),phone_confirm:true},service,'PUT');
 check(changed.status===200&&await state(sixth.data)===false,'Changed verified phone identity invalidates proof');
 await send(7);const seventh=await verify(7);check(seventh.status===200,'Fresh proof for session-expiry test');
 check((await request(`/auth/v1/admin/users/${decode(seventh.data).sub}`,{ban_duration:'1h'},service,'PUT')).status===200,'Supported Auth account ban');
 check(await state(seventh.data)===false,'Banned account immediately loses proof eligibility');
 check((await request(`/auth/v1/admin/users/${decode(seventh.data).sub}`,{ban_duration:'none'},service,'PUT')).status===200,'Supported Auth account unban');
 sql(`update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=${literal(decode(seventh.data).session_id)};`);
 check(await state(seventh.data)===false,'Expired Auth session rejected with live access JWT');
 await send(8);const eighth=await verify(8);check(eighth.status===200,'Fresh proof for account deletion test');
 check((await request(`/auth/v1/admin/users/${decode(eighth.data).sub}`,undefined,service,'DELETE')).status===200,'Supported account deletion succeeds with proof relationships');
 check(await state(eighth.data)===false,'Deleted account cannot reuse proof');
 clearLimits();await send(10);
 sql(`create function app.sms_test_reject_proof() returns trigger language plpgsql as $$ begin raise exception 'Synthetic proof failure'; end $$;
 create trigger sms_test_reject before insert on app.sms_session_attestations for each row execute function app.sms_test_reject_proof();`);
 try{
  const failureCount=count(),failed=await verify(10);
  check(failed.status===503&&!failed.data.access_token&&!failed.data.refresh_token&&count()===failureCount,'Proof storage failure returns no session and no attestation');
 }finally{sql('drop trigger sms_test_reject on app.sms_session_attestations; drop function app.sms_test_reject_proof();');}
 await new Promise(r=>setTimeout(r,1100));await send(10);
 check((await verify(10)).status===200,'Fresh SMS challenge recovers after proof insertion rollback');
 check(sql(`select count(*) from app.sms_session_attestations p where not exists(select 1 from auth.sessions s where s.id=p.session_id and s.user_id=p.user_id);`)==='0','No orphan or cross-user proof');
 const security=sql(`do $$ declare r text; t record; begin
  if exists(select 1 from pg_roles where rolname='nhs_sms_proof_owner' and (rolcanlogin or rolsuper or rolbypassrls or rolinherit or rolcreatedb or rolcreaterole or rolreplication)) then raise exception 'Unsafe owner'; end if;
  foreach r in array array['anon','authenticated','service_role','authenticator'] loop
   if pg_has_role(r,'nhs_sms_proof_owner','MEMBER') then raise exception 'Owner membership'; end if;
  end loop;
  for t in select c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' loop
   if not (select relrowsecurity from pg_class where oid=t.oid) or (select relowner='nhs_sms_proof_owner'::regrole from pg_class where oid=t.oid) then raise exception 'Owner RLS bypass'; end if;
  end loop;
  if has_table_privilege('nhs_sms_proof_owner','app.votes','SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('nhs_sms_proof_owner','app.audit_logs','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Protected ledger rights'; end if;
  if has_any_column_privilege('nhs_sms_proof_owner','auth.users','INSERT,UPDATE,REFERENCES') or has_any_column_privilege('nhs_sms_proof_owner','auth.sessions','INSERT,UPDATE,REFERENCES') then raise exception 'Auth writes'; end if;
  if has_schema_privilege('nhs_sms_proof_owner','auth','USAGE') then raise exception 'Direct Auth schema access'; end if;
  foreach r in array array['anon','authenticated','service_role','nhs_public_reader','nhs_identity_reader','nhs_management_writer'] loop
   if has_function_privilege(r,'app.sms_auth_challenge(text)','EXECUTE') or has_function_privilege(r,'app.sms_auth_session(uuid,uuid)','EXECUTE') then raise exception 'Auth projection exposed'; end if;
  end loop;
  if has_table_privilege('nhs_sms_proof_owner','app.sms_session_attestations','UPDATE,DELETE,TRUNCATE') or has_column_privilege('nhs_sms_proof_owner','app.sms_verification_challenges','user_id','UPDATE') then raise exception 'Mutable proof/identity'; end if;
 end $$;`);
 check(security==='DO','Owner, Auth, ledger and RLS security catalog checks passed');
 check(ledgerDigest()===protectedBefore,'Voting, guards, audit, result and adjustment records unchanged');
 for(const secret of [anon,service,'624810',first.data.access_token,first.data.refresh_token])check(!output.includes(secret),'Gateway output excludes credentials/OTP/tokens');
 console.log(`PASS: ${checks} SMS proof integration assertions; genuine local SMS, email OTP, password, direct Auth bypass, replay and revocation tests.`);
 const catalog=sql(`select string_agg(pg_get_functiondef(p.oid),E'\n' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','api') and p.proowner='nhs_sms_proof_owner'::regrole;`);
 console.log(`SMS proof function catalog SHA256: ${createHash('sha256').update(catalog).digest('hex')}`);
}catch(error){console.error(output.trim());throw error;}finally{gateway.kill();}
