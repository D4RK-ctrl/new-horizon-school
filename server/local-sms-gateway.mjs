// Explicit local-only adapter. No deployment or browser credentials.
import { createServer } from 'node:http';
import { createSmsGateway } from './sms-gateway.mjs';
const {SMS_SUPABASE_URL,SMS_ANON_KEY,SMS_SERVICE_KEY,SMS_RATE_SECRET}=process.env;
if(SMS_SUPABASE_URL!=='http://127.0.0.1:55431')throw new Error('Dedicated loopback Supabase required');
const handler=createSmsGateway({supabaseUrl:SMS_SUPABASE_URL,anonKey:SMS_ANON_KEY,serviceKey:SMS_SERVICE_KEY,
  rateSecret:SMS_RATE_SECRET,allowedOrigin:'http://127.0.0.1:5173',reportEvent:stage=>process.stdout.write(`SMS gateway failure stage: ${stage}\n`)});
const server=createServer((req,res)=>{
  if(req.url!=='/verify-sms'){res.writeHead(404,{'Cache-Control':'no-store'});res.end();return;}
  void handler(req,res);
});
server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=30;
server.listen(55439,'127.0.0.1',()=>process.stdout.write('Local SMS gateway ready on 127.0.0.1:55439\n'));
