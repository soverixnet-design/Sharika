// A privacy-minimizing ONE-PHONE participation gate for the official Android
// staging client. Never persist the platform identifier or client digest raw.
// Client-provided identifiers can be forged on modified/rooted devices; real
// cash payout still requires human screening and Play Integrity attestation.
const DEVICE_PROOF=/^[a-f0-9]{64}$/;
const encoder=new TextEncoder();
const hex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function inviteDeviceDigest(request,env){
  const supplied=request.headers.get('x-sharika-device-proof')||'';
  if(!DEVICE_PROOF.test(supplied)||typeof env.INVITE_DEVICE_PEPPER!=='string'||
     env.INVITE_DEVICE_PEPPER.length<32)return null;
  const key=await crypto.subtle.importKey('raw',encoder.encode(env.INVITE_DEVICE_PEPPER),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(supplied))));
}
export async function inviteDeviceBinding(db,uid,digest){
  if(!digest)return {eligible:false,statements:[],reason:'device_proof_required'};
  const bound=await db.prepare('SELECT device_digest,invite_eligible FROM '+
    'sharika_invite_devices WHERE user_uid=?').bind(uid).first();
  if(bound)return {eligible:bound.device_digest===digest&&bound.invite_eligible===1,
    statements:[],reason:bound.device_digest===digest&&bound.invite_eligible===1?
      null:'device_already_bound_or_ineligible'};
  const previous=await db.prepare('SELECT user_uid FROM sharika_invite_devices '+
    'WHERE device_digest=? AND invite_eligible=1').bind(digest).first();
  const eligible=!previous;
  return {eligible,reason:eligible?null:'device_already_used',statements:[
    db.prepare('INSERT INTO sharika_invite_devices(user_uid,device_digest,invite_eligible) '+
      'VALUES(?,?,?)').bind(uid,digest,eligible?1:0)
  ]};
}
