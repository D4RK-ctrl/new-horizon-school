// Trusted Node server code. Never import from the Vite/browser bundle.
import { createHmac } from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createSmsGateway({supabaseUrl,anonKey,serviceKey,rateSecret,allowedOrigin,reportEvent=()=>{}}) {
  const target=new URL(supabaseUrl);
  if(target.username||target.password||target.search||target.hash||target.pathname!=='/'||
    (target.protocol!=='https:'&&!(target.protocol==='http:'&&target.hostname==='127.0.0.1'))||
    !anonKey||!serviceKey||typeof rateSecret!=='string'||rateSecret.length<32||!allowedOrigin||new URL(allowedOrigin).origin!==allowedOrigin) {
    throw new Error('Invalid SMS gateway server configuration');
  }
  async function upstream(path,body,token=anonKey,method='POST',profile=false) {
    const response=await fetch(new URL(path,target),{method,redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{apikey:anonKey,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Connection:'close',
        ...(profile?{'Accept-Profile':'api','Content-Profile':'api'}:{})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();
    return {ok:response.ok,status:response.status,data:text?JSON.parse(text):null};
  }
  const rpc=(name,body)=>upstream(`/rest/v1/rpc/${name}`,body,serviceKey,'POST',true);
  return async function verifySms(req,res) {
    res.setHeader('Cache-Control','no-store');res.setHeader('Pragma','no-cache');
    res.setHeader('X-Content-Type-Options','nosniff');
    const send=(status,error)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error}));};
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(405,'Method not allowed');}
    if(req.headers.origin!==allowedOrigin)return send(403,'Origin denied');
    if(req.headers.authorization||req.headers['content-type']?.split(';')[0]!=='application/json')return send(400,'Invalid request');
    let lease,stage='request';
    try {
      let bytes=0;const chunks=[];
      // This endpoint expects a raw Node request stream, not a parsed body.
      for await(const chunk of req.iterator({destroyOnReturn:false})){
        bytes+=Buffer.byteLength(chunk);if(bytes>512){res.setHeader('Connection','close');req.resume();return send(413,'Request too large');}chunks.push(chunk);
      }
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return send(400,'Invalid request');}
      if(!body||Array.isArray(body)||Object.keys(body).sort().join(',')!=='code,phone'||
        typeof body.phone!=='string'||!/^\+?91[0-9]{10}$/.test(body.phone)||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))return send(400,'Invalid request');
      const phone=body.phone.replace(/^\+/,'');
      // Socket address is trusted by the local Node adapter. Forwarded headers
      // are deliberately ignored; production proxy trust needs separate review.
      if(!req.socket.remoteAddress)return send(503,'Verification unavailable');
      const networkKey=createHmac('sha256',rateSecret).update(req.socket.remoteAddress).digest('hex');
      stage='reservation';
      const reserved=await rpc('reserve_sms_verification',{p_phone:phone,p_network_key:networkKey});
      if(!reserved.ok){reportEvent(stage);return send(reserved.data?.code==='P0001'?429:503,'Verification unavailable');}
      lease=reserved.data;
      if(!lease)return send(401,'Verification failed');
      stage='sms-exchange';
      const verified=await upstream('/auth/v1/verify',{phone,token:body.code,type:'sms'});
      if(!verified.ok)return send(401,'Verification failed');
      const session=verified.data;
      if(typeof session.access_token!=='string'||typeof session.refresh_token!=='string')return send(503,'Verification unavailable');
      // Auth verifies the issued JWT signature. Decode only AFTER this succeeds,
      // then cross-check every identity/session field used in the proof request.
      stage='session-validation';
      const current=await upstream('/auth/v1/user',undefined,session.access_token,'GET');
      if(!current.ok)return send(401,'Verification failed');
      const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString('utf8'));
      const user=current.data,now=Math.floor(Date.now()/1000);
      if(!uuid.test(user.id)||!uuid.test(claims.session_id)||claims.sub!==user.id||session.user?.id!==user.id||
        user.phone!==phone||session.user?.phone!==phone||!user.phone_confirmed_at||user.is_anonymous||
        claims.phone!==phone||claims.role!=='authenticated'||claims.aud!=='authenticated'||
        claims.iss!==new URL('/auth/v1',target).href||!Number.isInteger(claims.exp)||claims.exp<=now||
        !Number.isInteger(claims.iat)||claims.iat>now+5||claims.iat<now-30||
        !Array.isArray(claims.amr)||!claims.amr.some(x=>x.method==='otp'))return send(401,'Verification failed');
      stage='attestation';
      const proof=await rpc('attest_sms_session',{p_lease_id:lease,p_session_id:claims.session_id});
      if(!proof.ok){reportEvent(stage);return send(503,'Verification unavailable');}
      lease=undefined;
      res.statusCode=200;res.setHeader('Content-Type','application/json');
      res.end(JSON.stringify({access_token:session.access_token,refresh_token:session.refresh_token,
        token_type:'bearer',expires_at:claims.exp,expires_in:Math.max(0,claims.exp-now),sms_proof_expires_at:proof.data}));
    }catch{reportEvent(stage);return send(503,'Verification unavailable');}
    finally {if(lease){try{await rpc('cancel_sms_verification',{p_lease_id:lease});}catch{/* Fail closed: lease expires in 30 seconds. */}}}
  };
}
