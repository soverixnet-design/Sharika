// Verified manual coin recharge review. The app only submits a support request;
// money is NEVER inferred from a client message or an unverified receipt.
// Explicit finance/admin verification is required before one atomic coin grant.
import { rechargeReferralStatements } from './invites.mjs';
import { firstRechargeBonusStatements } from './first-recharge.mjs';
import {readInviteRules} from './invite-rules.mjs';
const MAX_RECHARGE=1_000_000;
const MAX_BALANCE=1_000_000_000_000;
const PUBLIC_ID=n=>String(n).padStart(8,'0');
const MONEY_ROLES=new Set(['super','finance']);
const PAYMENT_METHOD=/^[a-zA-Z0-9 ._-]{2,40}$/;
const PAYMENT_REFERENCE=/^[a-zA-Z0-9/_:.\\-]{6,120}$/;
const rechargeQuery=
  "FROM sharika_support_messages m JOIN sharika_users u ON u.auth_uid=m.user_id "+
  "WHERE m.sender_role='user' AND m.body LIKE 'Recharge request · %'";
async function json(request){
  const raw=await request.text();
  if(raw.length>4096)throw new Error('body_too_large');
  const data=JSON.parse(raw||'{}');
  if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('invalid_body');
  return data;
}
async function getRequest(db,id){
  return db.prepare(
    'SELECT m.id,m.user_id,u.public_no,u.name,u.coins,u.status,m.body,m.created_at '+
    rechargeQuery+' AND m.id=?'
  ).bind(id).first();
}
async function getReview(db,id){
  return db.prepare('SELECT support_message_id,user_uid,status,coins,payment_method,payment_reference '+
    'FROM sharika_manual_recharge_reviews WHERE support_message_id=?'
  ).bind(id).first();
}
async function duplicateStatus(db,id,uid,coins,method,reference,reply,fail,cors){
  const review=await getReview(db,id);
  if(!review)return null;
  if(review.status==='approved'&&review.user_uid===uid&&Number(review.coins)===coins&&
    review.payment_method.toLowerCase()===method.toLowerCase()&&
    review.payment_reference.toLowerCase()===reference.toLowerCase())
    return reply({duplicate:true,approved:true,request_id:id,coins,referral_bonus_new:0},200,cors);
  return fail('recharge_already_reviewed',409,cors);
}
export async function handleRechargeAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(!operation.startsWith('recharges'))return null;
  if(!MONEY_ROLES.has(actor.role))return fail('admin_permission_denied',403,cors);
  if(operation==='recharges'&&request.method==='GET'){
    const rows=(await env.DB.prepare(
      'SELECT m.id AS request_id,u.public_no,u.name,m.body,m.created_at,'+
      "COALESCE(r.status,'pending') AS status,r.coins,r.payment_method,r.payment_reference,r.created_at AS reviewed_at "+
      'FROM sharika_support_messages m JOIN sharika_users u ON u.auth_uid=m.user_id '+
      'LEFT JOIN sharika_manual_recharge_reviews r ON r.support_message_id=m.id '+
      "WHERE m.sender_role='user' AND m.body LIKE 'Recharge request · %' "+
      'ORDER BY m.id DESC LIMIT 100'
    ).all()).results||[];
    return reply({requests:rows.map(x=>({
      request_id:x.request_id,public_id:PUBLIC_ID(x.public_no),name:x.name,
      request_text:x.body,requested_at:x.created_at,status:x.status,
      reviewed_coins:x.coins??null,payment_method:x.payment_method||null,
      payment_reference:x.payment_reference||null,reviewed_at:x.reviewed_at||null
    })),limit:100,manual_verification_required:true},200,cors);
  }
  if(operation==='recharges/approve'&&request.method==='POST'){
    let data;
    try{data=await json(request);}catch(_){return fail('invalid_json',400,cors);}
    const id=data.support_message_id,coins=data.coins;
    const method=typeof data.payment_method==='string'?data.payment_method.trim():'';
    const reference=typeof data.payment_reference==='string'?data.payment_reference.trim():'';
    if(!Number.isSafeInteger(id)||id<1||
       !Number.isSafeInteger(coins)||coins<1||coins>MAX_RECHARGE||
       !PAYMENT_METHOD.test(method)||!PAYMENT_REFERENCE.test(reference)||
       data.confirm_payment_verified!==true)
      return fail('verified_payment_required',400,cors);
    const target=await getRequest(env.DB,id);
    if(!target)return fail('recharge_request_not_found',404,cors);
    if(target.user_id===uid)return fail('cannot_review_own_recharge',403,cors);
    const duplicate=await duplicateStatus(env.DB,id,target.user_id,coins,method,reference,reply,fail,cors);
    if(duplicate)return duplicate;
    if(target.status!=='active')return fail('recipient_unavailable',403,cors);
    if(Number(target.coins)>MAX_BALANCE-coins)return fail('recipient_balance_limit',409,cors);
    // Reject a receipt reused for ANY prior approved request, even another user.
    const used=await env.DB.prepare(
      "SELECT support_message_id FROM sharika_manual_recharge_reviews "+
      "WHERE status='approved' AND lower(payment_method)=lower(?) "+
      "AND lower(payment_reference)=lower(?)"
    ).bind(method,reference).first();
    if(used)return fail('payment_reference_already_used',409,cors);
    let referral,firstRecharge;
    try{
      const rules=await readInviteRules(env.DB);
      referral=await rechargeReferralStatements({
        db:env.DB,recipientUid:target.user_id,sellerUid:'manual',
        requestId:String(id),amount:coins,rules
      });
      firstRecharge=await firstRechargeBonusStatements({
        db:env.DB,recipientUid:target.user_id,kind:'manual',reference:String(id),
        coins,balance:target.coins,rules
      });
    }catch(error){
      if(error.message==='inviter_balance_limit')return fail('inviter_balance_limit',409,cors);
      if(error.message==='recipient_balance_limit')return fail('recipient_balance_limit',409,cors);
      throw error;
    }
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sharika_manual_recharge_reviews '+
        '(support_message_id,user_uid,admin_uid,status,coins,payment_method,payment_reference) '+
        "VALUES(?,?,?,'approved',?,?,?)"
      ).bind(id,target.user_id,uid,coins,method,reference),
      env.DB.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
      ).bind(MAX_BALANCE-coins,coins,target.user_id),
      env.DB.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'manual_recharge',?)"
      ).bind(target.user_id,coins,target.user_id,'manual-recharge:'+id),
      ...firstRecharge.statements,
      ...referral.statements,
      env.DB.prepare(
        "INSERT INTO sharika_support_messages(user_id,sender_uid,sender_role,body,request_id) "+
        "VALUES(?,?,'admin',?,?)"
      ).bind(target.user_id,uid,
        'Recharge request #'+id+' approved. '+coins+' coins were added to your wallet.',
        'manual-recharge-approved:'+id),
      env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'manual_recharge_approved',JSON.stringify({
          request_id:id,target_public_id:PUBLIC_ID(target.public_no),
          coins,method,referral_bonus_coins:referral.bonus,
          first_recharge_bonus_coins:firstRecharge.bonus
        }))
    ]);
    return reply({approved:true,duplicate:false,request_id:id,
      recipient_public_id:PUBLIC_ID(target.public_no),credited_coins:coins,
      referral_bonus_coins:referral.bonus,
      first_recharge_bonus_coins:firstRecharge.bonus},201,cors);
  }
  if(operation==='recharges/reject'&&request.method==='POST'){
    let data;
    try{data=await json(request);}catch(_){return fail('invalid_json',400,cors);}
    const id=data.support_message_id,note=typeof data.note==='string'?data.note.trim():'';
    if(!Number.isSafeInteger(id)||id<1||note.length<8||note.length>250)
      return fail('rejection_reason_required',400,cors);
    const target=await getRequest(env.DB,id);
    if(!target)return fail('recharge_request_not_found',404,cors);
    if(target.user_id===uid)return fail('cannot_review_own_recharge',403,cors);
    if(await getReview(env.DB,id))return fail('recharge_already_reviewed',409,cors);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sharika_manual_recharge_reviews '+
        "(support_message_id,user_uid,admin_uid,status,coins,note) VALUES(?,?,?,'rejected',0,?)"
      ).bind(id,target.user_id,uid,note),
      env.DB.prepare(
        "INSERT INTO sharika_support_messages(user_id,sender_uid,sender_role,body,request_id) "+
        "VALUES(?,?,'admin',?,?)"
      ).bind(target.user_id,uid,
        'Recharge request #'+id+' was rejected. Reason: '+note,
        'manual-recharge-rejected:'+id),
      env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
        .bind(uid,'manual_recharge_rejected',JSON.stringify({
          request_id:id,target_public_id:PUBLIC_ID(target.public_no),note
        }))
    ]);
    return reply({rejected:true,request_id:id,coins_credited:0},201,cors);
  }
  return fail('recharge_method_not_allowed',405,cors);
}
