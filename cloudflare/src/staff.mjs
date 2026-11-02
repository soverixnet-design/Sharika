// Sharika staging: granular staff access and immutable direct coin credits.
// Firebase owns email/password authentication. Never store staff passwords in D1.
import { verifyFirebaseToken } from './auth.mjs';

export const STAFF_SCOPES=Object.freeze([
  'view_users','view_rooms','view_sellers','view_ledger','support_reply','coin_recharge'
]);
const SCOPE_SET=new Set(STAFF_SCOPES);
const PUBLIC_ID=/^[0-9]{8}$/;
const RECHARGE_ID=/^[0-9]{4,8}$/;
const REQUEST_ID=/^[a-zA-Z0-9:_-]{12,80}$/;
const MAX_STAFF_GRANT=1_000_000;
const MAX_SUPER_GRANT=1_000_000_000_000;
const MAX_USER_BALANCE=1_000_000_000_000;
const uidId=n=>String(n).padStart(8,'0');

function scopes(value){
  if(!Array.isArray(value) || value.length>STAFF_SCOPES.length) return null;
  if(value.some(p=>typeof p!=='string'||!SCOPE_SET.has(p))||
    new Set(value).size!==value.length)return null;
  return value;
}
export function hasStaffScope(actor,scope){
  return actor?.role==='staff'&&actor.active===true&&
    Array.isArray(actor.permissions)&&actor.permissions.includes(scope);
}
export function staffProxyRole(actor,method,operation){
  if(actor?.role!=='staff')return actor?.role||null;
  if(method==='GET'){
    if(operation==='users'&&hasStaffScope(actor,'view_users'))return 'super';
    if(operation==='rooms'&&hasStaffScope(actor,'view_rooms'))return 'support';
    if(['sellers','sellers/transfers','sellers/allocations'].includes(operation)&&
       hasStaffScope(actor,'view_sellers'))return 'finance';
    if(operation==='ledger'&&hasStaffScope(actor,'view_ledger'))return 'finance';
    if((operation==='support'||/^support\/[0-9]{8}$/.test(operation))&&
       hasStaffScope(actor,'support_reply'))return 'support';
  }
  if(method==='POST'&&/^support\/[0-9]{8}\/reply$/.test(operation)&&
     hasStaffScope(actor,'support_reply'))return 'support';
  return null;
}
export async function lookupStaffActor(db,uid) {
  const row=await db.prepare(
    'SELECT id,login_email,display_name,permissions_json,daily_coin_limit,active '+
    'FROM sharika_admin_staff_accounts WHERE auth_uid=?'
  ).bind(uid).first();
  if(!row||!row.active)return null;
  let permissions;
  try {permissions=scopes(JSON.parse(row.permissions_json));}
  catch(_){return null;}
  if(!permissions)return null;
  return {role:'staff',name:row.display_name,email:row.login_email,
    permissions,active:true,daily_coin_limit:Number(row.daily_coin_limit)||0};
}
async function bodyJson(request){
  const raw=await request.text();
  if(raw.length>8192)throw new Error('admin_body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))
    throw new Error('invalid_staff_body');
  return body;
}
function normalizeSettings(data) {
  const permissions=scopes(data.permissions);
  const daily_coin_limit=data.daily_coin_limit;
  if(!permissions||!Number.isSafeInteger(daily_coin_limit)||
     daily_coin_limit<0||daily_coin_limit>10_000_000||
     (permissions.includes('coin_recharge')&&daily_coin_limit<1))
    return null;
  return {permissions,daily_coin_limit};
}
const rows=r=>r.results||[];

export async function handleStaffAdmin({request,env,uid,actor,operation,cors,reply,fail,
  verifyNewStaffToken=verifyFirebaseToken}) {
  const isStaffRoute=operation==='staff'||/^staff\/[1-9][0-9]{0,9}$/.test(operation);
  if(isStaffRoute){
    if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
    if(operation==='staff'&&request.method==='GET'){
      const found=rows(await env.DB.prepare(
        'SELECT id,login_email,display_name,permissions_json,daily_coin_limit,active,created_at '+
        'FROM sharika_admin_staff_accounts ORDER BY id DESC LIMIT 100'
      ).all());
      return reply({staff:found.map(row=>({
        id:row.id,email:row.login_email,name:row.display_name,
        permissions:scopes(JSON.parse(row.permissions_json))||[],
        daily_coin_limit:row.daily_coin_limit,active:!!row.active,
        created_at:row.created_at
      })),read_only:true},200,cors);
    }
    if(operation==='staff'&&request.method==='POST'){
      let body;
      try{body=await bodyJson(request);}
      catch(error){return fail(error.message==='admin_body_too_large'?error.message:'invalid_staff_json',400,cors);}
      const name=typeof body.name==='string'?body.name.trim():'';
      const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
      const token=typeof body.new_staff_id_token==='string'?body.new_staff_id_token:'';
      const settings=normalizeSettings(body);
      if(!name||name.length>80||email.length>254||
         !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||
         token.length<200||token.length>8192||!settings)
        return fail('invalid_staff_account',400,cors);
      const child=await verifyNewStaffToken('Bearer '+token,env.FIREBASE_PROJECT_ID);
      if(!child||!child.uid.startsWith('firebase:'+env.FIREBASE_PROJECT_ID+':')||
         child.uid===uid||child.email.toLowerCase()!==email)
        return fail('staff_identity_unverified',403,cors);
      const alreadyAdmin=await env.DB.prepare(
        'SELECT role FROM sharika_admin_roles WHERE auth_uid=?'
      ).bind(child.uid).first();
      if(alreadyAdmin)return fail('protected_admin_account',409,cors);
      const exists=await env.DB.prepare(
        'SELECT id FROM sharika_admin_staff_accounts WHERE auth_uid=? OR login_email=?'
      ).bind(child.uid,email).first();
      if(exists)return fail('staff_already_exists',409,cors);
      const result=await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO sharika_admin_staff_accounts'+
          '(auth_uid,login_email,display_name,permissions_json,daily_coin_limit,active,created_by) '+
          'VALUES(?,?,?,?,?,1,?)'
        ).bind(child.uid,email,name,JSON.stringify(settings.permissions),settings.daily_coin_limit,uid),
        env.DB.prepare(
          'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
        ).bind(uid,'staff_create',JSON.stringify({email,name,permissions:settings.permissions,
          daily_coin_limit:settings.daily_coin_limit}))
      ]);
      return reply({created:true,id:result[0]?.meta?.last_row_id||null,
        email,permissions:settings.permissions,requires_email_verification:true},201,cors);
    }
    const matched=/^staff\/([1-9][0-9]{0,9})$/.exec(operation);
    if(matched&&request.method==='PATCH'){
      let body;
      try{body=await bodyJson(request);}
      catch(error){return fail(error.message==='admin_body_too_large'?error.message:'invalid_staff_json',400,cors);}
      if(typeof body.active!=='boolean')return fail('invalid_staff_active',400,cors);
      const settings=normalizeSettings(body);
      if(!settings)return fail('invalid_staff_permissions',400,cors);
      const existing=await env.DB.prepare(
        'SELECT id,login_email FROM sharika_admin_staff_accounts WHERE id=?'
      ).bind(Number(matched[1])).first();
      if(!existing)return fail('staff_not_found',404,cors);
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE sharika_admin_staff_accounts SET permissions_json=?,daily_coin_limit=?,'+
          "active=?,updated_at=datetime('now') WHERE id=?"
        ).bind(JSON.stringify(settings.permissions),settings.daily_coin_limit,
          body.active?1:0,Number(matched[1])),
        env.DB.prepare(
          'INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)'
        ).bind(uid,'staff_update',JSON.stringify({staff_id:existing.id,email:existing.login_email,
          active:body.active,permissions:settings.permissions,
          daily_coin_limit:settings.daily_coin_limit}))
      ]);
      return reply({updated:true,staff_id:existing.id,active:body.active},200,cors);
    }
    return fail('staff_method_not_allowed',405,cors);
  }

  if(operation==='recharge-user'){
    const canRecharge=actor.role==='super'||hasStaffScope(actor,'coin_recharge');
    if(!canRecharge)return fail('admin_permission_denied',403,cors);
    if(request.method==='GET'){
      const staff=actor.role==='staff';
      const stmt=env.DB.prepare(
        'SELECT g.id,g.coins,g.reason,g.balance_after,g.created_at,'+
        'u.public_no AS recipient_no,s.login_email AS staff_email,'+
        'a.public_no AS admin_no FROM sharika_admin_direct_recharges g '+
        'JOIN sharika_users u ON u.auth_uid=g.recipient_uid '+
        'LEFT JOIN sharika_admin_staff_accounts s ON s.auth_uid=g.actor_uid '+
        'LEFT JOIN sharika_users a ON a.auth_uid=g.actor_uid '+
        (staff?'WHERE g.actor_uid=? ':'')+'ORDER BY g.id DESC LIMIT 100'
      );
      const records=rows(await (staff?stmt.bind(uid):stmt).all());
      return reply({grants:records.map(row=>({
        id:row.id,recipient_id:uidId(row.recipient_no),coins:row.coins,
        reason:row.reason,balance_after:row.balance_after,
        staff_email:row.staff_email||null,
        sender_id:row.admin_no==null?null:uidId(row.admin_no),created_at:row.created_at
      })),read_only:true,limited_to:100,
        ...(staff?{daily_coin_limit:actor.daily_coin_limit}:{})},200,cors);
    }
    if(request.method!=='POST')return fail('admin_method_not_allowed',405,cors);
    let body;
    try{body=await bodyJson(request);}
    catch(error){return fail(error.message==='admin_body_too_large'?error.message:'invalid_staff_json',400,cors);}
    const amount=body.coins,publicId=body.target_public_id;
    const requestId=body.request_id,reason=typeof body.reason==='string'?body.reason.trim():'';
    if(typeof publicId!=='string'||!RECHARGE_ID.test(publicId)||
       !Number.isSafeInteger(amount)||amount<1||amount>(actor.role==='super'?MAX_SUPER_GRANT:MAX_STAFF_GRANT)||
       typeof requestId!=='string'||!REQUEST_ID.test(requestId)||
       reason.length<8||reason.length>200)
      return fail('invalid_direct_recharge',400,cors);
    // Resolve the visible Special ID to the canonical recipient before
    // comparing immutable request receipts. Only active Special IDs resolve.
    const target=await env.DB.prepare(
      'SELECT auth_uid,coins,status,public_no FROM sharika_users WHERE public_no=? '+
      'OR auth_uid=(SELECT auth_uid FROM sharika_special_ids WHERE special_id=? '+
      "AND (expires_at IS NULL OR expires_at>datetime('now'))) LIMIT 1"
    ).bind(Number(publicId),publicId).first();
    if(!target)return fail('recipient_unavailable',404,cors);
    const canonicalId=uidId(target.public_no);
    const existing=await env.DB.prepare(
      'SELECT g.id,g.coins,g.reason,u.public_no,g.balance_after '+
      'FROM sharika_admin_direct_recharges g '+
      'JOIN sharika_users u ON u.auth_uid=g.recipient_uid '+
      'WHERE g.actor_uid=? AND g.request_id=?'
    ).bind(uid,requestId).first();
    if(existing){
      if(Number(existing.coins)!==amount||uidId(existing.public_no)!==canonicalId||
        existing.reason!==reason)return fail('idempotency_conflict',409,cors);
      return reply({duplicate:true,transaction_id:existing.id,recipient_id:canonicalId,
        coins:amount,balance_after:existing.balance_after},200,cors);
    }
    if(target.status!=='active')return fail('recipient_unavailable',404,cors);
    if(actor.role==='staff'&&target.auth_uid===uid)return fail('staff_cannot_recharge_self',403,cors);
    if(Number(target.coins)>MAX_USER_BALANCE-amount)
      return fail('recipient_balance_limit',409,cors);
    if(actor.role==='staff'&&amount>actor.daily_coin_limit)
      return fail('staff_daily_limit_exceeded',409,cors);
    try{
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE sharika_users SET coins=CASE WHEN status=\'active\' AND coins<=? '+
          "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
        ).bind(MAX_USER_BALANCE-amount,amount,target.auth_uid),
        env.DB.prepare(
          'INSERT INTO sharika_admin_direct_recharges'+
          '(actor_uid,recipient_uid,coins,reason,request_id,balance_after) '+
          'VALUES(?,?,?,?,?,(SELECT coins FROM sharika_users WHERE auth_uid=?))'
        ).bind(uid,target.auth_uid,amount,reason,requestId,target.auth_uid),
        env.DB.prepare(
          'INSERT INTO sharika_wallet_ledger'+
          '(auth_uid,currency,delta,balance_after,reason,request_id) '+
          "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
          "'admin_direct_recharge',?)"
        ).bind(target.auth_uid,amount,target.auth_uid,'admin-credit:'+uid+':'+requestId)
      ]);
    }catch(error){
      // D1 may commit then lose the response. Recheck the immutable transaction
      // using the same request ID before classifying the operation as failed.
      const saved=await env.DB.prepare(
        'SELECT g.id,g.coins,g.reason,g.balance_after,u.public_no '+
        'FROM sharika_admin_direct_recharges g '+
        'JOIN sharika_users u ON u.auth_uid=g.recipient_uid '+
        'WHERE g.actor_uid=? AND g.request_id=?'
      ).bind(uid,requestId).first();
      if(saved){
        if(Number(saved.coins)!==amount||uidId(saved.public_no)!==canonicalId||
           saved.reason!==reason)return fail('idempotency_conflict',409,cors);
        return reply({duplicate:true,transaction_id:saved.id,recipient_id:canonicalId,
          coins:amount,balance_after:saved.balance_after},200,cors);
      }
      if(/staff_daily_limit_exceeded|staff_recharge_disabled/.test(String(error.message)))
        return fail('staff_daily_limit_exceeded',409,cors);
      if(/CHECK constraint|recipient_balance_limit/.test(String(error.message)))
        return fail('recipient_balance_limit',409,cors);
      throw error;
    }
    const saved=await env.DB.prepare(
      'SELECT id,balance_after FROM sharika_admin_direct_recharges '+
      'WHERE actor_uid=? AND request_id=?'
    ).bind(uid,requestId).first();
    if(!saved)return fail('recharge_commit_unconfirmed',503,cors);
    return reply({duplicate:false,transaction_id:saved.id,
      recipient_id:canonicalId,coins:amount,balance_after:saved.balance_after},201,cors);
  }
  return null;
}
