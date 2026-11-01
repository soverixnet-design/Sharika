// Sharika invite extension: device-bound referral attribution and manual USD redemption.
// Cash rewards are promotional, OFF by default, and never execute a bank transfer.
import {notifyUser,deliverNotification} from './notifications.mjs';
const ID = /^[0-9]{8}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const textEncoder = new TextEncoder();
const MONEY_MAX = 100_000_000;
export const INVITE_DEFAULTS = Object.freeze({
  enabled:1,claim_hours:48,inviter_coins:5000,invitee_total_coins:10000,
  recharge_percent:5,cash_enabled:0,inviter_cash_cents:0,
  invitee_cash_cents:0,withdrawals_enabled:0,min_withdraw_cents:100
});
const int = value => Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
const pad = n => String(n).padStart(8,'0');
const iso = date => date.replace(' ','T')+'Z';
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const rows = result => result?.results||[];
const parse = async request => {
  const raw=await request.text();
  if(raw.length>4096)throw Error('body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body || typeof body!=='object' || Array.isArray(body))throw Error('invalid_body');
  return body;
};
export async function inviteSettings(db){
  const row=await db.prepare('SELECT * FROM sharika_invite_settings WHERE id=1').first();
  if(!row)throw Error('invite_settings_unavailable');
  return {...INVITE_DEFAULTS,...row};
}
export async function deviceDigest(request,env){
  // Android native shell injects ANDROID_ID; JavaScript cannot supply this header
  // through the privileged allowlisted bridge. Server-side Play Integrity is still
  // required for stronger resistance to modified clients / emulators.
  const device=request.headers.get('x-sharika-device');
  if(!device||!/^[a-f0-9]{16}$/i.test(device))return null;
  const input=textEncoder.encode('sharika-referral-device-v1:'+device.toLowerCase());
  if(env.REFERRAL_DEVICE_HMAC_KEY){
    const key=await crypto.subtle.importKey('raw',
      textEncoder.encode(env.REFERRAL_DEVICE_HMAC_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return hex(new Uint8Array(await crypto.subtle.sign('HMAC',key,input)));
  }
  // No raw Android identifier is ever persisted. This fallback isn't attestation.
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',input)));
}
export async function deviceAllowed(db,uid,digest){
  if(!digest)return false;
  const row=await db.prepare('SELECT device_hash,owner_uid FROM sharika_referral_devices WHERE device_hash=? OR owner_uid=?')
    .bind(digest,uid).all();
  return rows(row).every(r=>r.owner_uid===uid && r.device_hash===digest);
}
export const deviceRegistrationStatement=(db,uid,digest)=>
  db.prepare('INSERT OR IGNORE INTO sharika_referral_devices(device_hash,owner_uid) VALUES(?,?)')
    .bind(digest,uid);
export function signupCashStatements({db,uid,inviterUid,config,inviterMinor,inviteeMinor}){
  if(!Number(config.cash_enabled))return [];
  const out=[];
  const add=(target,amount,kind,key)=>{
    if(amount>0)out.push(db.prepare(
      'INSERT INTO sharika_invite_cash_ledger(auth_uid,delta_cents,kind,request_key) VALUES(?,?,?,?)'
    ).bind(target,amount,kind,key));
  };
  if(!inviterMinor)add(inviterUid,int(config.inviter_cash_cents),'inviter_bonus','inviter:'+uid);
  if(!inviteeMinor)add(uid,int(config.invitee_cash_cents),'invitee_bonus','invitee:'+uid);
  return out;
}
async function balance(db,uid){
  const result=await db.prepare(
    'SELECT COALESCE(SUM(delta_cents),0) AS cents FROM sharika_invite_cash_ledger WHERE auth_uid=?'
  ).bind(uid).first();
  return Number(result?.cents)||0;
}
function publicLink(request,code){
  const url=new URL(request.url);
  // Staging worker hosts an install/open landing page; real Play referral works
  // only once the app is published on Play with the matching package ID.
  return url.origin+'/i/'+code;
}
export async function inviteOverview({request,env,uid}){
  const settings=await inviteSettings(env.DB);
  const user=await env.DB.prepare(
    "SELECT created_at,minor FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!user)return {};
  const invited=await env.DB.prepare(
    'SELECT 1 AS yes FROM sharika_referrals WHERE referred_uid=?'
  ).bind(uid).first();
  const cashouts=await env.DB.prepare(
    'SELECT id,amount_cents,bank_last4,status,created_at,reviewed_at FROM sharika_invite_withdrawals '+
    'WHERE auth_uid=? ORDER BY created_at DESC LIMIT 20'
  ).bind(uid).all();
  const digest=await deviceDigest(request,env);
  const eligibleDevice=await deviceAllowed(env.DB,uid,digest);
  const deadline=Date.parse(iso(user.created_at))+int(settings.claim_hours)*3600000;
  const eligible=Boolean(settings.enabled && !invited && eligibleDevice && Date.now()<=deadline);
  const profile=await env.DB.prepare(
    'SELECT public_no FROM sharika_users WHERE auth_uid=?'
  ).bind(uid).first();
  return {
    share_url:publicLink(request,pad(profile.public_no)),
    settings:{claim_hours:int(settings.claim_hours),
      inviter_coins:int(settings.inviter_coins),invitee_total_coins:int(settings.invitee_total_coins),
      recharge_percent:int(settings.recharge_percent),
      cash_enabled:Boolean(settings.cash_enabled),
      inviter_cash_cents:int(settings.inviter_cash_cents),
      invitee_cash_cents:int(settings.invitee_cash_cents),
      withdrawals_enabled:Boolean(settings.withdrawals_enabled),
      min_withdraw_cents:int(settings.min_withdraw_cents)},
    claim_deadline:new Date(deadline).toISOString(),
    can_claim:eligible,claim_requires_device:!eligibleDevice,
    already_invited:Boolean(invited),
    cash_balance_cents:await balance(env.DB,uid),
    cashouts:rows(cashouts),
    cashout_requires_adult:Boolean(user.minor)
  };
}
export async function claimInvite({request,env,uid,cors,reply,fail}){
  if(request.method!=='POST')return fail('invite_method_not_allowed',405,cors);
  const settings=await inviteSettings(env.DB);
  if(!Number(settings.enabled))return fail('invites_disabled',403,cors);
  const user=await env.DB.prepare(
    "SELECT created_at,minor,coins FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!user)return fail('profile_unavailable',403,cors);
  if(Date.now()>Date.parse(iso(user.created_at))+int(settings.claim_hours)*3600000)
    return fail('invite_window_expired',403,cors);
  if(await env.DB.prepare('SELECT 1 FROM sharika_referrals WHERE referred_uid=?').bind(uid).first())
    return fail('invite_already_claimed',409,cors);
  const digest=await deviceDigest(request,env);
  if(!await deviceAllowed(env.DB,uid,digest))
    return fail('device_reward_already_used',403,cors);
  const body=await parse(request);
  if(typeof body.invite_code!=='string'||!ID.test(body.invite_code))
    return fail('invalid_invite_code',400,cors);
  const inviter=await env.DB.prepare(
    "SELECT auth_uid,status,minor,coins FROM sharika_users WHERE public_no=?"
  ).bind(Number(body.invite_code)).first();
  if(!inviter||inviter.status!=='active')return fail('invite_code_not_found',404,cors);
  if(inviter.auth_uid===uid)return fail('cannot_invite_self',403,cors);
  const inviterCoins=int(settings.inviter_coins);
  const extraCoins=Math.max(0,int(settings.invitee_total_coins)-2000);
  if(Number(inviter.coins)>1000000000000-inviterCoins ||
     Number(user.coins)>1000000000000-extraCoins)
    return fail('invite_balance_limit',409,cors);
  const statements=[
    deviceRegistrationStatement(env.DB,uid,digest),
    env.DB.prepare('INSERT INTO sharika_referrals(referred_uid,inviter_uid) VALUES(?,?)')
      .bind(uid,inviter.auth_uid)
  ];
  const coinCredit=(target,amount,reason,key)=>{
    if(!amount)return;
    statements.push(env.DB.prepare(
      "UPDATE sharika_users SET coins=coins+?,updated_at=datetime('now') "+
      "WHERE auth_uid=? AND status='active' AND coins<=?"
    ).bind(amount,target,1000000000000-amount));
    statements.push(env.DB.prepare(
      "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),?,?)"
    ).bind(target,amount,target,reason,key));
  };
  coinCredit(inviter.auth_uid,inviterCoins,'referral_signup','referral-signup:'+uid);
  coinCredit(uid,extraCoins,'referral_claim','referral-claim:'+uid);
  statements.push(...signupCashStatements({
    db:env.DB,uid,inviterUid:inviter.auth_uid,config:settings,
    inviterMinor:!!inviter.minor,inviteeMinor:!!user.minor
  }));
  try{await env.DB.batch(statements);}
  catch(error){
    if(/UNIQUE|CONSTRAINT|referral/i.test(error.message||''))
      return fail('invite_already_claimed_or_device_used',409,cors);
    throw error;
  }
  return reply({claimed:true,invited_by:body.invite_code,
    inviter_coins:inviterCoins,invitee_coins:extraCoins,
    cash_balance_cents:await balance(env.DB,uid)},200,cors);
}
async function encryptionKey(env){
  const source=env.REFERRAL_PAYOUT_KEY;
  if(typeof source!=='string')return null;
  let raw;
  try{raw=unb64(source);}catch(_){return null;}
  if(raw.length!==32)return null;
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptBank(env,bank){
  const key=await encryptionKey(env);
  if(!key)return null;
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const payload=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,
    textEncoder.encode(JSON.stringify(bank)));
  return {bank_ciphertext:b64(new Uint8Array(payload)),bank_iv:b64(iv)};
}
async function decryptBank(env,row){
  const key=await encryptionKey(env);
  if(!key)throw Error('payout_encryption_unavailable');
  const plaintext=await crypto.subtle.decrypt(
    {name:'AES-GCM',iv:unb64(row.bank_iv)},key,unb64(row.bank_ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}
async function notifyPayoutAdmins(env,uid,requestId,ctx){
  // Financial details are available only from the authenticated admin inbox.
  // A notification alerts the owner without leaking bank account information.
  try{
    const admins=rows(await env.DB.prepare(
      'SELECT r.auth_uid FROM sharika_admin_roles r JOIN sharika_users u ON u.auth_uid=r.auth_uid '+
      "WHERE r.role='super' AND u.status='active' LIMIT 10"
    ).all());
    for(const admin of admins){
      try{
        const {notification,created}=await notifyUser(env.DB,{
          recipientUid:admin.auth_uid,kind:'system',
          title:'Bank withdrawal request',
          body:'A member requested a USD bank payout. Review the Invites & USD Payouts admin inbox.',
          dedupeKey:'invite-cashout:'+requestId,createdBy:uid
        });
        if(created && ctx?.waitUntil){
          ctx.waitUntil(deliverNotification(env,notification).catch(error=>
            console.error('invite_payout_push',String(error.message||error))));
        }
      }catch(error){console.error('invite_payout_notice',String(error.message||error));}
    }
  }catch(error){console.error('invite_payout_notice_lookup',String(error.message||error));}
}
export async function requestCashout({request,env,uid,cors,reply,fail,ctx}){
  if(request.method!=='POST')return fail('invite_method_not_allowed',405,cors);
  const settings=await inviteSettings(env.DB);
  if(!Number(settings.withdrawals_enabled)||!Number(settings.cash_enabled))
    return fail('withdrawals_disabled',403,cors);
  const profile=await env.DB.prepare(
    "SELECT minor FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!profile||profile.minor)return fail('withdrawal_not_eligible',403,cors);
  const body=await parse(request),amount=int(body.amount_cents);
  if(!UUID.test(String(body.request_id||'')))return fail('invalid_request_id',400,cors);
  const existing=await env.DB.prepare(
    'SELECT id,auth_uid,amount_cents,status FROM sharika_invite_withdrawals WHERE id=?'
  ).bind(body.request_id).first();
  if(existing){
    if(existing.auth_uid!==uid||Number(existing.amount_cents)!==amount)
      return fail('request_id_conflict',409,cors);
    return reply({id:existing.id,status:existing.status,duplicate:true},200,cors);
  }
  if(!Number.isSafeInteger(amount)||amount<int(settings.min_withdraw_cents)||amount>MONEY_MAX)
    return fail('invalid_withdraw_amount',400,cors);
  const bank={
    bank_name:String(body.bank_name||'').trim(),
    account_name:String(body.account_name||'').trim(),
    account_number:String(body.account_number||'').trim(),
    payout_country:String(body.payout_country||'').trim().toUpperCase()
  };
  if(bank.bank_name.length<2||bank.bank_name.length>90||
     bank.account_name.length<2||bank.account_name.length>100||
     !/^[A-Za-z0-9 \-]{6,48}$/.test(bank.account_number)||
     !/^[A-Z]{2}$/.test(bank.payout_country))
    return fail('invalid_bank_details',400,cors);
  const encrypted=await encryptBank(env,bank);
  if(!encrypted)return fail('payout_encryption_unavailable',503,cors);
  try{
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sharika_invite_withdrawals(id,auth_uid,amount_cents,bank_ciphertext,'+
        'bank_iv,bank_last4) VALUES(?,?,?,?,?,?)'
      ).bind(body.request_id,uid,amount,encrypted.bank_ciphertext,
        encrypted.bank_iv,bank.account_number.slice(-4)),
      env.DB.prepare(
        "INSERT INTO sharika_invite_cash_ledger(auth_uid,delta_cents,kind,request_key) "+
        "VALUES(?,?,'cashout_hold',?)"
      ).bind(uid,-amount,'hold:'+body.request_id)
    ]);
  }catch(error){
    if(/invite_cash_insufficient/i.test(error.message||''))
      return fail('insufficient_invite_dollars',409,cors);
    if(/UNIQUE|CONSTRAINT/i.test(error.message||''))
      return fail('cashout_conflict',409,cors);
    throw error;
  }
  await notifyPayoutAdmins(env,uid,body.request_id,ctx);
  return reply({id:body.request_id,status:'pending',
    amount_cents:amount,cash_balance_cents:await balance(env.DB,uid)},201,cors);
}
export async function handleInviteUpgrade({request,env,uid,path,cors,reply,fail,ctx}){
  if(path==='/api/v1/invites/claim')
    return claimInvite({request,env,uid,cors,reply,fail});
  if(path==='/api/v1/invites/withdrawals')
    return requestCashout({request,env,uid,cors,reply,fail,ctx});
  return null;
}
const CONFIG_LIMITS={
  enabled:[0,1],claim_hours:[1,168],inviter_coins:[0,1000000],
  invitee_total_coins:[2000,1000000],recharge_percent:[0,100],
  cash_enabled:[0,1],inviter_cash_cents:[0,100000],
  invitee_cash_cents:[0,100000],withdrawals_enabled:[0,1],
  min_withdraw_cents:[100,1000000]
};
export async function adminInviteExtras({env}){
  const config=await inviteSettings(env.DB);
  const count=await env.DB.prepare(
    "SELECT COUNT(*) AS pending FROM sharika_invite_withdrawals WHERE status='pending'"
  ).first();
  const cash=await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE WHEN delta_cents>0 THEN delta_cents ELSE 0 END),0) AS awarded_cents "+
    'FROM sharika_invite_cash_ledger'
  ).first();
  return {settings:Object.fromEntries(Object.keys(CONFIG_LIMITS).map(k=>[k,int(config[k])])),
    pending_withdrawals:Number(count?.pending)||0,
    cash_awarded_cents:Number(cash?.awarded_cents)||0};
}
export async function handleInviteAdminUpgrade({request,env,uid,actor,operation,cors,reply,fail}){
  if(!operation.startsWith('invites'))return null;
  if(!['super','finance'].includes(actor.role))
    return fail('admin_permission_denied',403,cors);
  if(operation==='invites'&&request.method==='PATCH'){
    if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
    const data=await parse(request);
    if(Object.keys(data).length!==Object.keys(CONFIG_LIMITS).length ||
       Object.keys(CONFIG_LIMITS).some(k=>
         !Object.hasOwn(data,k)||!Number.isSafeInteger(data[k])||
         data[k]<CONFIG_LIMITS[k][0]||data[k]>CONFIG_LIMITS[k][1]))
      return fail('invalid_invite_settings',400,cors);
    // Never allow a real-dollar campaign or withdrawal inbox to be enabled
    // before bank data can be encrypted with a configured server-side key.
    if((data.withdrawals_enabled ||
        (data.cash_enabled && (data.inviter_cash_cents||data.invitee_cash_cents))) &&
       !await encryptionKey(env))
      return fail('payout_encryption_unavailable',503,cors);
    const keys=Object.keys(CONFIG_LIMITS);
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE sharika_invite_settings SET '+keys.map(k=>k+'=?').join(',')+
        ",updated_at=datetime('now'),updated_by=? WHERE id=1"
      ).bind(...keys.map(k=>data[k]),uid),
      env.DB.prepare(
        'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
      ).bind(uid,'invite_settings_updated',JSON.stringify(data))
    ]);
    return reply({saved:true,...await adminInviteExtras({env})},200,cors);
  }
  if(operation==='invites/withdrawals'&&request.method==='GET'){
    const result=await env.DB.prepare(
      'SELECT w.id,u.public_no,u.name,w.amount_cents,w.bank_last4,w.status,'+
      'w.created_at,w.reviewed_at,w.transfer_reference,w.review_note,w.bank_iv,w.bank_ciphertext '+
      'FROM sharika_invite_withdrawals w JOIN sharika_users u ON u.auth_uid=w.auth_uid '+
      "ORDER BY CASE w.status WHEN 'pending' THEN 0 ELSE 1 END,w.created_at DESC LIMIT 100"
    ).all();
    const withdrawals=[];
    for(const r of rows(result)){
      const {bank_iv,bank_ciphertext,...safe}=r;
      let bank=null;
      if(r.status==='pending'){
        try{bank=await decryptBank(env,r);}
        catch(_){bank={error:'payout_encryption_unavailable'};}
      }
      withdrawals.push({...safe,public_id:pad(r.public_no),bank});
    }
    return reply({withdrawals},200,cors);
  }
  const match=/^invites\/withdrawals\/([a-f0-9-]{36})\/decision$/i.exec(operation);
  if(match&&request.method==='POST'){
    if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
    const body=await parse(request),action=body.action;
    if(!['paid','rejected'].includes(action))return fail('invalid_decision',400,cors);
    const reference=String(body.transfer_reference||'').trim();
    const note=String(body.note||'').trim();
    if(reference.length>120||note.length>400||
       action==='paid' && reference.length<4)
      return fail('transfer_reference_required',400,cors);
    const row=await env.DB.prepare(
      'SELECT id,auth_uid,amount_cents,status FROM sharika_invite_withdrawals WHERE id=?'
    ).bind(match[1]).first();
    if(!row)return fail('withdrawal_not_found',404,cors);
    if(row.status===action)return reply({id:row.id,status:row.status,duplicate:true},200,cors);
    if(row.status!=='pending')return fail('withdrawal_already_reviewed',409,cors);
    const statements=[
      env.DB.prepare(
        "UPDATE sharika_invite_withdrawals SET status=?,transfer_reference=?,review_note=?,"+
        "reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'"
      ).bind(action,reference||null,note||null,uid,row.id)
    ];
    if(action==='rejected')statements.push(env.DB.prepare(
      "INSERT INTO sharika_invite_cash_ledger(auth_uid,delta_cents,kind,request_key) "+
      "VALUES(?,?,'cashout_refund',?)"
    ).bind(row.auth_uid,row.amount_cents,'refund:'+row.id));
    statements.push(env.DB.prepare(
      'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
    ).bind(uid,'invite_withdrawal_'+action,JSON.stringify({id:row.id,reference}))
    );
    let decisionResults;
    try{decisionResults=await env.DB.batch(statements);}
    catch(error){
      if(/UNIQUE|CONSTRAINT/i.test(error.message||''))
        return fail('withdrawal_already_reviewed',409,cors);
      throw error;
    }
    if(!decisionResults?.[0]?.meta?.changes)
      return fail('withdrawal_already_reviewed',409,cors);
    return reply({id:row.id,status:action},200,cors);
  }
  return null;
}

export function publicInviteLanding(request,path){
  const code=/^\/i\/([0-9]{8})$/.exec(path)?.[1];
  if(!code||request.method!=='GET')return null;
  const play='https://play.google.com/store/apps/details?id=com.soverixnet.sharika&referrer='+
    encodeURIComponent('sharika_invite='+code);
  const deep='sharika://invite/'+code;
  const markup='<!doctype html><html lang="en"><head><meta charset="UTF-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta name="robots" content="noindex">'+
    '<title>Sharika · Invite '+code+'</title><style>body{font-family:system-ui,sans-serif;'+
    'background:radial-gradient(circle at top,#583ca2,#170d33 70%);color:#fff;'+
    'min-height:100vh;display:grid;place-items:center;margin:0}main{max-width:360px;'+
    'text-align:center;padding:32px;border:1px solid #ffffff4f;border-radius:24px;'+
    'background:#ffffff13}a{display:block;background:#f4cf6d;color:#201337;padding:15px;'+
    'border-radius:12px;margin-top:14px;text-decoration:none;font-weight:700}'+
    'small{display:block;margin-top:18px;color:#d8ccef}</style></head><body><main>'+
    '<h1>🤝 Join me on Sharika!</h1><p>Invite code: <strong>'+code+'</strong></p>'+
    '<a href="'+deep+'">Open Sharika app</a>'+
    '<a href="'+play+'">Install from Google Play</a>'+
    '<small>Use the code within the allowed time after registration. Rewards depend on eligibility '+
    'and current app settings. If Play is not yet published, install options may be unavailable.</small>'+
    '</main></body></html>';
  return new Response(markup,{status:200,headers:{
    'content-type':'text/html; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer'
  }});
}
