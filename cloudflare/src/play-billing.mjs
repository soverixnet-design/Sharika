// Google Play one-time coin packs: ONLY an authenticated Firebase account
// with a verified, PURCHASED Play token can receive wallet coins. Prices
// live exclusively in Google Play Console and are displayed by BillingClient.
// This staging feature is disabled until the Play Console/service account,
// refund reconciliation and two-device purchase QA are approved.
export const PLAY_PACKAGE='com.soverixnet.sharika';
export const PLAY_COIN_PACKS=Object.freeze({
  sharika_coins_500k:500_000,
  sharika_coins_2500k:2_500_000,
  sharika_coins_5000k:5_000_000
});
const MAX_COINS=1_000_000_000_000;
const TOKEN_PATTERN=/^[A-Za-z0-9._~:+/=\-]{20,4096}$/;
const ENCODER=new TextEncoder();
const HEX=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export async function sha256Hex(value){
  return HEX(new Uint8Array(await crypto.subtle.digest('SHA-256',ENCODER.encode(value))));
}
export function billingEnabled(env){
  return env.SHARIKA_PLAY_BILLING_ENABLED==='true'&&
    typeof env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON==='string'&&
    env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.length>30;
}
function base64url(input){
  const raw=input instanceof Uint8Array?input:ENCODER.encode(input);
  let value='';for(const byte of raw)value+=String.fromCharCode(byte);
  return btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
async function googlePublisherAccessToken(env, fetcher=fetch){
  let service;
  try{service=JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);}catch(_){
    throw new Error('play_service_account_invalid');
  }
  if(!service||typeof service.client_email!=='string'||
     !service.client_email.endsWith('.gserviceaccount.com')||
     typeof service.private_key!=='string'||
     !service.private_key.includes('BEGIN PRIVATE KEY'))
    throw new Error('play_service_account_invalid');
  const now=Math.floor(Date.now()/1000);
  const claims={iss:service.client_email,scope:'https://www.googleapis.com/auth/androidpublisher',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+300};
  const header=base64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=base64url(JSON.stringify(claims));
  const pem=service.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  let privateKey;
  try{
    privateKey=await crypto.subtle.importKey('pkcs8',
      Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  }catch(_){throw new Error('play_service_account_invalid');}
  const unsigned=header+'.'+payload;
  const signature=new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',
    privateKey,ENCODER.encode(unsigned)));
  const jwt=unsigned+'.'+base64url(signature);
  let response;
  try{
    response=await fetcher('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:jwt}),signal:AbortSignal.timeout(10000)
    });
  }catch(_){throw new Error('play_verification_unavailable');}
  if(!response.ok)throw new Error('play_verification_unavailable');
  const token=await response.json();
  if(typeof token.access_token!=='string'||token.access_token.length<20)
    throw new Error('play_verification_unavailable');
  return token.access_token;
}
export async function googleProductStatus(env,purchaseToken,fetcher=fetch){
  const accessToken=await googlePublisherAccessToken(env,fetcher);
  const url='https://androidpublisher.googleapis.com/androidpublisher/v3/applications/'+
    PLAY_PACKAGE+'/purchases/productsv2/tokens/'+encodeURIComponent(purchaseToken);
  let response;
  try{
    response=await fetcher(url,{headers:{authorization:'Bearer '+accessToken},
      signal:AbortSignal.timeout(10000)});
  }catch(_){throw new Error('play_verification_unavailable');}
  if(!response.ok)throw new Error('play_purchase_not_verified');
  return response.json();
}
function validPurchase(record,productId,accountHash){
  return record?.purchaseStateContext?.purchaseState==='PURCHASED'&&
    record?.obfuscatedExternalAccountId===accountHash&&
    Array.isArray(record.productLineItem)&&record.productLineItem.length===1&&
    record.productLineItem[0]?.productId===productId;
}
async function creditedReceipt(db,hash){
  return db.prepare('SELECT auth_uid,product_id,coins FROM sharika_play_billing_purchases '+
    'WHERE token_hash=?').bind(hash).first();
}
function duplicateResult(row,uid,sku,reply,fail,cors){
  if(row.auth_uid!==uid||row.product_id!==sku)return fail('play_token_already_used',409,cors);
  return reply({credited:true,duplicate:true,coins:row.coins,product_id:sku},200,cors);
}
export async function handlePlayBilling({request,env,uid,path,cors,reply,fail,
  getStatus=googleProductStatus}){
  if(path==='/api/v1/billing/catalog'&&request.method==='GET'){
    const enabled=billingEnabled(env);
    return reply({enabled,products:enabled?Object.entries(PLAY_COIN_PACKS)
      .map(([id,coins])=>({id,coins})):[],
    ...(enabled?{}:{reason:'play_billing_setup_pending'})},200,cors);
  }
  if(path!=='/api/v1/billing/verify'||request.method!=='POST')
    return fail('billing_route_not_found',404,cors);
  if(!billingEnabled(env))return fail('play_billing_not_configured',503,cors);
  let input;
  try{
    if(Number(request.headers.get('content-length')||0)>6000)
      return fail('billing_request_too_large',413,cors);
    const body=await request.text();
    if(body.length>6000)return fail('billing_request_too_large',413,cors);
    input=JSON.parse(body);
  }catch(_){return fail('invalid_json',400,cors);}
  const sku=input?.product_id,token=input?.purchase_token;
  if(typeof sku!=='string'||!Object.hasOwn(PLAY_COIN_PACKS,sku)||
     typeof token!=='string'||!TOKEN_PATTERN.test(token))
    return fail('invalid_play_purchase',400,cors);
  const hash=await sha256Hex(token);
  const existing=await creditedReceipt(env.DB,hash);
  if(existing)return duplicateResult(existing,uid,sku,reply,fail,cors);
  const user=await env.DB.prepare('SELECT coins,status,minor FROM sharika_users '+
    'WHERE auth_uid=?').bind(uid).first();
  if(!user||user.status!=='active'||Number(user.minor)!==0)
    return fail('billing_account_ineligible',403,cors);
  const amount=PLAY_COIN_PACKS[sku];
  if(!Number.isSafeInteger(Number(user.coins))||Number(user.coins)>MAX_COINS-amount)
    return fail('billing_balance_limit',409,cors);
  let verified;
  try{verified=await getStatus(env,token);}catch(_){
    return fail('play_verification_unavailable',503,cors);
  }
  const accountHash=await sha256Hex(uid);
  if(!validPurchase(verified,sku,accountHash))
    return fail('play_purchase_not_verified',403,cors);
  const orderId=typeof verified.orderId==='string'?verified.orderId.slice(0,160):null;
  // D1 batch is transactional. The UNIQUE token hash prevents a second credit
  // even when two phones submit the same valid receipt concurrently.
  try{
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sharika_play_billing_purchases '+
        '(token_hash,auth_uid,product_id,coins,order_id,test_purchase) '+
        'VALUES(?,?,?,?,?,?)').bind(hash,uid,sku,amount,orderId,
          verified.testPurchaseContext?.fopType==='TEST'?1:0),
      env.DB.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND minor=0 "+
        "AND coins<=? THEN coins+? ELSE -1 END,updated_at=datetime('now') "+
        'WHERE auth_uid=?').bind(MAX_COINS-amount,amount,uid),
      env.DB.prepare('INSERT INTO sharika_wallet_ledger '+
        '(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
        "'google_play_purchase',?)").bind(uid,amount,uid,'play:'+hash)
    ]);
  }catch(_){
    const duplicate=await creditedReceipt(env.DB,hash);
    if(duplicate)return duplicateResult(duplicate,uid,sku,reply,fail,cors);
    return fail('play_credit_unavailable',503,cors);
  }
  return reply({credited:true,duplicate:false,coins:amount,product_id:sku},201,cors);
}
