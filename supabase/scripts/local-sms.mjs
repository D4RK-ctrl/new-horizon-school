// Isolated disposable CLI workdir. Never writes tracked config or links remote.
import {readFileSync,existsSync,mkdirSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {stripVTControlCharacters} from 'node:util';
const root=resolve(import.meta.dirname,'../..'),work=resolve(root,'tmp/sms-proof-local');
const action=process.argv[2];
if(!['start','reset','stop'].includes(action))throw new Error('Use local-sms.mjs start|reset|stop');
if(existsSync(resolve(root,'supabase/.temp/project-ref'))||existsSync(resolve(work,'supabase/.temp/project-ref')))throw new Error('Remote-link state forbidden');
if(existsSync(resolve(work,'supabase/config.toml'))&&!readFileSync(resolve(work,'supabase/config.toml'),'utf8').includes('GENERATED LOCAL TEST CONFIGURATION'))throw new Error('Refusing to overwrite an unrelated local workdir');
const original=readFileSync(resolve(root,'supabase/config.toml'),'utf8');
if(!original.includes('project_id = "nhs-phase2a-verification"')||!original.includes('port = 55431'))throw new Error('Dedicated project required');
mkdirSync(resolve(work,'supabase/migrations'),{recursive:true});
// Dummy values satisfy CLI phone-provider validation. Only mapped test numbers
// are used. No paid account exists; Auth short-circuits delivery for these maps.
const phones=Array.from({length:12},(_,i)=>`9199990000${String(i+1).padStart(2,'0')} = "624810"`).join('\n');
writeFileSync(resolve(work,'supabase/config.toml'),original+`
# GENERATED LOCAL TEST CONFIGURATION. Never copy or push to a hosted project.
[auth.sms]
enable_signup = true
enable_confirmations = true
max_frequency = "1s"
[auth.sms.test_otp]
${phones}
[auth.sms.twilio]
enabled = true
account_sid = "LOCAL_TEST_NOT_A_TWILIO_ACCOUNT"
message_service_sid = "LOCAL_TEST_NO_DELIVERY"
auth_token = "LOCAL_TEST_NOT_A_SECRET"
`);
for(const file of readdirSync(resolve(root,'supabase/migrations')).filter(x=>x.endsWith('.sql')))copyFileSync(resolve(root,'supabase/migrations',file),resolve(work,'supabase/migrations',file));
const args=action==='start'?['start','--exclude','realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']:
 action==='reset'?['db','reset','--local','--no-seed','--yes']:['stop','--project-id','nhs-phase2a-verification','--no-backup'];
const child=spawn(process.execPath,[resolve(root,'node_modules/supabase/dist/supabase.js'),...args,'--workdir',work],{stdio:['ignore','pipe','pipe']});
// CLI startup emits credentials. Stream only whitelisted operational lines.
let errorText='';
for(const stream of [child.stdout,child.stderr]){let pending='';stream.on('data',chunk=>{
 if(stream===child.stderr)errorText+=chunk;
 pending+=chunk;const lines=pending.split('\n');pending=lines.pop();
 for(const item of lines){const line=stripVTControlCharacters(item).trim();
  if(/^(Applying migration |Starting database|Initialising schema|Resetting local database|Recreating database|Restarting containers|Finished supabase db reset|ERROR:|Error )/.test(line))process.stdout.write(line+'\n');
 }
});}
const code=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done);});
if(code!==0)for(const line of errorText.split('\n'))if(!/secret|token|key|password|postgres(?:ql)?:\/\/|sb_|eyJ/i.test(line))process.stdout.write(line+'\n');
process.stdout.write(`Disposable local ${action}: exit ${code}\n`);
process.exitCode=code??1;
