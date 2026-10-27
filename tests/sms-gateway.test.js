import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {createSmsGateway} from '../server/sms-gateway.mjs';
const config={supabaseUrl:'http://127.0.0.1:55431',anonKey:'synthetic-anon',serviceKey:'synthetic-server',rateSecret:'x'.repeat(32),allowedOrigin:'http://127.0.0.1:5173'};
test('SMS gateway rejects unsafe server configuration',()=>{
 for(const patch of [{supabaseUrl:'http://remote.example.test'},{supabaseUrl:'https://user:pass@example.test/'},{supabaseUrl:'https://example.test/?token=x'},{rateSecret:'short'},{serviceKey:''},{allowedOrigin:'*'}])assert.throws(()=>createSmsGateway({...config,...patch}));
});
test('SMS gateway bounds and validates untrusted requests before contacting Auth',async()=>{
 const server=createServer(createSmsGateway(config));server.listen(0,'127.0.0.1');await once(server,'listening');
 const url=`http://127.0.0.1:${server.address().port}/verify-sms`;
 try{
  for(const [method,origin,body,status] of [
   ['GET',config.allowedOrigin,undefined,405],['POST','https://attacker.example.test','{}',403],
   ['POST',config.allowedOrigin,'not-json',400],['POST',config.allowedOrigin,'null',400],
   ['POST',config.allowedOrigin,JSON.stringify({phone:'+12025550123',code:'123456'}),400],
   ['POST',config.allowedOrigin,JSON.stringify({phone:'+919999000001',code:'123456',session_id:'chosen'}),400],
   ['POST',config.allowedOrigin,JSON.stringify({phone:'+919999000001',code:'123456',access_token:'email-token'}),400],
   ['POST',config.allowedOrigin,'x'.repeat(513),413]]){
   let r;try{r=await fetch(url,{method,headers:{Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body})});}
   catch(error){throw new Error(`HTTP rejection fixture ${status}, body length ${body?.length??0}: ${error.cause?.code??error.message}`);}
   assert.equal(r.status,status);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.deepEqual(Object.keys(await r.json()),['error']);
  }
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
