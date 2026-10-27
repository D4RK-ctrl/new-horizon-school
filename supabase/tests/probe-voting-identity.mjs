// Manual prerequisite diagnostic, not a voting-engine integration test.
// Dedicated clean local stack only. No Auth SQL writes or external delivery.
// Operator keys, passwords, OTPs and session tokens stay in process memory.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const container='supabase_db_nhs-phase2a-verification';
function command(binary,args,input){const r=spawnSync(binary,args,{input,encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(r.status,0,`Local command failed: ${r.stderr}`);return r.stdout.trim();}
const sql=q=>command('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'],q);
assert(!existsSync('supabase/.temp/project-ref'));
assert(readFileSync('supabase/config.toml','utf8').includes('project_id = "nhs-phase2a-verification"'));
assert(readFileSync('supabase/config.toml','utf8').includes('schemas = ["api"]'));
assert.equal(sql('select count(*) from auth.users;'),'0','Run only on the freshly reset dedicated disposable database');
const local=JSON.parse(command(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'status','-o','json']));
assert.equal(local.API_URL,'http://127.0.0.1:55431');
const anon=local.ANON_KEY,operator=local.SERVICE_ROLE_KEY;
assert(anon&&operator);
let checks=0;
function check(ok,label){assert(ok,label);checks++;console.log(`PASS ${label}`);}
async function req(path,body,token=anon,method='POST'){
 const r=await fetch(`${local.API_URL}${path}`,{method,headers:{apikey:anon,Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(path.startsWith('/rest/')?{'Content-Profile':'api','Accept-Profile':'api'}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await r.json();return {status:r.status,data};
}
function claims(session){return JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());}
const email=`voting-identity-${randomUUID()}@example.test`,phone='919999000001',password=`Synthetic-${randomUUID()}-9Aa!`;
const account=await req('/auth/v1/admin/users',{email,phone,password,email_confirm:true,phone_confirm:true},operator);
check(account.status===200&&account.data.id,'supported local admin provisioning of synthetic confirmed account');
const sent=await req('/auth/v1/otp',{phone,channel:'sms',create_user:false});
console.log(JSON.stringify({sms_request_status:sent.status,error_code:sent.data.error_code??sent.data.code,message:sent.data.msg??sent.data.message}));
let sms;
if(sent.status===200){
 sms=await req('/auth/v1/verify',{phone,token:'624810',type:'sms'});
 check(sms.status===200&&sms.data.access_token,'Auth-issued SMS verification session');
}else{
 check(sent.data.error_code==='phone_provider_disabled','provider-disabled failure explicitly identified; no SMS-session success claimed');
}
const generated=await req('/auth/v1/admin/generate_link',{type:'magiclink',email},operator);
check(generated.status===200&&generated.data.email_otp,'supported local Auth-generated email OTP without delivery');
const emailOtp=await req('/auth/v1/verify',{email,token:generated.data.email_otp,type:'email'});
check(emailOtp.status===200&&emailOtp.data.access_token,'Auth-issued email OTP session for same phone-confirmed account');
const passwordSession=await req('/auth/v1/token?grant_type=password',{email,password});
check(passwordSession.status===200&&passwordSession.data.access_token,'Auth-issued password session for same phone-confirmed account');
for(const [label,result] of [...(sms?[['sms',sms]]:[]),['email_otp',emailOtp],['password',passwordSession]]){
 const c=claims(result.data);
 check(c.sub===account.data.id,`${label}: same synthetic account identity`);
 check(result.data.user.phone===phone&&!!result.data.user.phone_confirmed_at,`${label}: confirmed current +91 phone`);
 const verified=await req('/auth/v1/user',undefined,result.data.access_token,'GET');
 check(verified.status===200&&verified.data.id===account.data.id,`${label}: token accepted by Auth verifier`);
 const api=await req('/rest/v1/rpc/account_status',{},result.data.access_token);
 check(api.status===200,`${label}: token accepted by PostgREST verifier`);
 const amr=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('method',authentication_method)),'[]'::jsonb) from auth.mfa_amr_claims where session_id='${c.session_id}'::uuid;`));
 check(amr.length>0,`${label}: provider-created session AMR persisted`);
 console.log(JSON.stringify({flow:label,aal:c.aal,jwt_amr:c.amr.map(x=>({method:x.method,provider:x.provider??null})),database_amr:amr,app_metadata:c.app_metadata,top_level_keys:Object.keys(c).sort()}));
}
const emailClaims=claims(emailOtp.data),passwordClaims=claims(passwordSession.data);
check(emailClaims.amr.some(x=>x.method==='otp'),'email OTP alone produces generic otp AMR on confirmed-phone account');
check(!emailClaims.amr.some(x=>x.provider),'email OTP AMR supplies no channel/provider discriminator');
check(emailClaims.phone===phone,'email OTP JWT contains confirmed account phone despite no SMS verification in that session');
check(passwordClaims.amr.some(x=>x.method==='password'),'password AMR can be distinguished');
check(JSON.stringify(passwordClaims.app_metadata)===JSON.stringify(emailClaims.app_metadata),'app_metadata reflects same account, not authentication channel');
if(sms){const smsClaims=claims(sms.data);check(smsClaims.session_id!==emailClaims.session_id,'SMS/email OTP distinct sessions');check(smsClaims.amr.some(x=>x.method==='otp'),'SMS also produces generic otp AMR');}
console.log('SESSION_COLUMNS '+sql("select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='auth' and table_name='sessions';"));
console.log('AMR_COLUMNS '+sql("select string_agg(column_name,',' order by ordinal_position) from information_schema.columns where table_schema='auth' and table_name='mfa_amr_claims';"));
const parts=emailOtp.data.access_token.split('.');
parts[1]=Buffer.from(JSON.stringify({...emailClaims,amr:[{method:'sms',timestamp:emailClaims.iat}],user_metadata:{sms_verified:true}})).toString('base64url');
const forged=await req('/rest/v1/rpc/account_status',{},parts.join('.'));
check(forged.status===401,'fabricated channel claim fails JWT signature verification');
check(sql('select count(*) from app.votes;')==='0','original vote ledger remains empty');
console.log(`Identity probe: ${checks} diagnostic assertions passed. SMS verification was ${sms?'executed':'NOT executable: phone provider disabled'}. No voting engine was implemented.`);
