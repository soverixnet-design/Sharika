// Verified Sharika referral records: real 8-digit inviter IDs only.
// A referral is created once, atomically with the new registered user's profile.
// All signup/referral bonuses use the existing verified D1 wallet ledger.
const PUBLIC_ID=/^[0-9]{8}$/;
const showId=n=>String(n).padStart(8,'0');
// Amounts are promotional Sharika coins, not cash. Verified signups are one-time.
export const INVITER_SIGNUP_COINS=5000;
export const INVITEE_SIGNUP_COINS=10000;
export const STANDARD_SIGNUP_COINS=2000;
// A newly registered member may attach one referral after account creation.
// The owner previously requested a two-day grace period; keep it explicit
// until the reference screenshot's 24-hour rule is confirmed.
export const INVITE_REDEEM_WINDOW_HOURS=48;
const MAX_USER_COINS=1_000_000_000_000;
export function inviteExpiryMs(createdAt){
  if(typeof createdAt!=='string')return 0;
  const plain=createdAt.trim().replace(' ','T');
  const normalized=/([zZ]|[+-][0-9]{2}:[0-9]{2})$/.test(plain)?plain:plain+'Z';
  const parsed=Date.parse(normalized);
  return Number.isFinite(parsed)?parsed+INVITE_REDEEM_WINDOW_HOURS*3600_000:0;
}
export function inviteRedeemEligible({created_at,invited_by},now=Date.now()){
  const expiry=inviteExpiryMs(created_at);
  return !invited_by&&expiry>now;
}
export const signupCoins=hasInviter=>hasInviter?INVITEE_SIGNUP_COINS:STANDARD_SIGNUP_COINS;
export function signupReferralStatements({db,uid,inviterUid}){
  return [
    db.prepare('INSERT INTO sharika_referrals(referred_uid,inviter_uid) VALUES(?,?)')
      .bind(uid,inviterUid),
    db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
      "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
      .bind(MAX_USER_COINS-INVITER_SIGNUP_COINS,INVITER_SIGNUP_COINS,inviterUid),
    db.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'referral_signup',?)")
      .bind(inviterUid,INVITER_SIGNUP_COINS,inviterUid,'referral-signup:'+uid)
  ];
}
export function rechargeBonusCoins(amount){
  if(!Number.isSafeInteger(amount)||amount<1)return 0;
  return Math.floor(amount*5/100);
}
export async function rechargeReferralStatements({db,recipientUid,sellerUid,requestId,amount}){
  const bonus=rechargeBonusCoins(amount);
  if(bonus<1)return {bonus:0,statements:[]};
  const inviter=await db.prepare(
    'SELECT u.auth_uid,u.status,u.coins FROM sharika_referrals r '+
    'JOIN sharika_users u ON u.auth_uid=r.inviter_uid WHERE r.referred_uid=?'
  ).bind(recipientUid).first();
  if(!inviter||inviter.status!=='active')return {bonus:0,statements:[]};
  if(Number(inviter.coins)>MAX_USER_COINS-bonus)
    throw new Error('inviter_balance_limit');
  return {bonus,statements:[
    db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
      "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
      .bind(MAX_USER_COINS-bonus,bonus,inviter.auth_uid),
    db.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'referral_recharge',?)")
      .bind(inviter.auth_uid,bonus,inviter.auth_uid,'referral-recharge:'+sellerUid+':'+requestId)
  ]};
}

export async function resolveInviter({db,uid,inviteCode,fail,cors}){
  if(inviteCode===undefined||inviteCode===null||inviteCode==='')return {inviter:null};
  if(typeof inviteCode!=='string'||!PUBLIC_ID.test(inviteCode))
    return {error:fail('invalid_invite_code',400,cors)};
  const inviter=await db.prepare(
    "SELECT auth_uid,public_no,status FROM sharika_users WHERE public_no=?"
  ).bind(Number(inviteCode)).first();
  if(!inviter||inviter.status!=='active')
    return {error:fail('invite_code_not_found',404,cors)};
  if(inviter.auth_uid===uid)
    return {error:fail('cannot_invite_self',403,cors)};
  return {inviter};
}
export async function handleInviteApp({request,env,uid,path,cors,reply,fail}){
  if(!['/api/v1/invites','/api/v1/invites/redeem','/api/v1/invites/rankings'].includes(path))return null;
  if(path==='/api/v1/invites/redeem'&&request.method==='POST'){
    const member=await env.DB.prepare(
      "SELECT auth_uid,public_no,created_at,coins,status FROM sharika_users WHERE auth_uid=?"
    ).bind(uid).first();
    if(!member||member.status!=='active')return fail('profile_unavailable',403,cors);
    const linked=await env.DB.prepare(
      'SELECT inviter_uid FROM sharika_referrals WHERE referred_uid=?'
    ).bind(uid).first();
    if(linked)return fail('invite_already_linked',409,cors);
    if(!inviteRedeemEligible({created_at:member.created_at,invited_by:null}))
      return fail('invite_window_expired',409,cors);
    let input;
    try{input=await request.json();}catch(_){return fail('invalid_invite_code',400,cors);}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       typeof input.invite_code!=='string')return fail('invalid_invite_code',400,cors);
    const verified=await resolveInviter({db:env.DB,uid,inviteCode:input.invite_code,fail,cors});
    if(verified.error)return verified.error;
    if(!verified.inviter)return fail('invalid_invite_code',400,cors);
    // Registration already credited the standard 2,000 welcome coins.
    // Complete only the difference to the existing 10,000 invitee signup
    // total, plus the existing 5,000 inviter reward. One unique referral row
    // guards the entire atomic D1 batch against duplicate / concurrent claims.
    const extra=INVITEE_SIGNUP_COINS-STANDARD_SIGNUP_COINS;
    if(extra<0||Number(member.coins)>MAX_USER_COINS-extra)
      return fail('invitee_balance_limit',409,cors);
    const statements=[...signupReferralStatements({
      db:env.DB,uid,inviterUid:verified.inviter.auth_uid
    }),env.DB.prepare(
      "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
      "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
    ).bind(MAX_USER_COINS-extra,extra,uid),env.DB.prepare(
      "INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'referral_claim',?)"
    ).bind(uid,extra,uid,'referral-claim:'+uid)];
    try{await env.DB.batch(statements);}
    catch(error){
      // Re-reading protects a successful concurrent claim from a second grant.
      const existing=await env.DB.prepare(
        'SELECT inviter_uid FROM sharika_referrals WHERE referred_uid=?'
      ).bind(uid).first();
      return fail(existing?'invite_already_linked':'invite_claim_unavailable',409,cors);
    }
    return reply({claimed:true,invited_by:showId(verified.inviter.public_no),
      inviter_reward:INVITER_SIGNUP_COINS,invitee_extra_coins:extra,
      invitee_total_signup_coins:INVITEE_SIGNUP_COINS},201,cors);
  }
  if(path==='/api/v1/invites/rankings'&&request.method==='GET'){
    const member=await env.DB.prepare(
      "SELECT 1 AS active FROM sharika_users WHERE auth_uid=? AND status='active'"
    ).bind(uid).first();
    if(!member)return fail('profile_unavailable',403,cors);
    const rows=await env.DB.prepare(
      "SELECT u.public_no,u.name,COUNT(r.referred_uid) AS invites "+
      "FROM sharika_referrals r JOIN sharika_users u ON u.auth_uid=r.inviter_uid "+
      "WHERE r.created_at>=datetime('now','start of month') AND u.status='active' "+
      'GROUP BY u.auth_uid ORDER BY invites DESC,u.public_no ASC LIMIT 10'
    ).all();
    return reply({period:'monthly',leaders:(rows.results||[]).map((r,i)=>({
      rank:i+1,id:showId(r.public_no),name:r.name,total_invites:Number(r.invites)||0
    })),prize_status:'not_configured'},200,cors);
  }
  if(path!=='/api/v1/invites'||request.method!=='GET')
    return fail('invite_method_not_allowed',405,cors);
  const user=await env.DB.prepare(
    "SELECT public_no,created_at FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!user)return fail('profile_unavailable',403,cors);
  const [count,rows,invitedBy,rewards]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM sharika_referrals WHERE inviter_uid=?')
      .bind(uid).first(),
    env.DB.prepare(
      'SELECT u.public_no,u.name,r.created_at FROM sharika_referrals r '+
      'JOIN sharika_users u ON u.auth_uid=r.referred_uid '+
      'WHERE r.inviter_uid=? ORDER BY r.created_at DESC LIMIT 50'
    ).bind(uid).all(),
    env.DB.prepare(
      'SELECT u.public_no FROM sharika_referrals r '+
      'JOIN sharika_users u ON u.auth_uid=r.inviter_uid WHERE r.referred_uid=?'
    ).bind(uid).first(),
    env.DB.prepare("SELECT "+
      "COALESCE(SUM(CASE WHEN reason='referral_signup' THEN delta ELSE 0 END),0) AS signup_bonus_coins,"+
      "COALESCE(SUM(CASE WHEN reason='referral_recharge' THEN delta ELSE 0 END),0) AS recharge_bonus_coins "+
      "FROM sharika_wallet_ledger WHERE auth_uid=? AND currency='coins'").bind(uid).first()
  ]);
  return reply({invite_code:showId(user.public_no),
    new_user:inviteExpiryMs(user.created_at)>Date.now(),
    claim_window_hours:INVITE_REDEEM_WINDOW_HOURS,
    claim_expires_at_ms:inviteExpiryMs(user.created_at),
    claim_eligible:inviteRedeemEligible({created_at:user.created_at,invited_by:invitedBy}),
    total_invites:Number(count?.n)||0,
    referrals:(rows.results||[]).map(r=>({
      public_id:showId(r.public_no),name:r.name,joined_at:r.created_at
    })),
    invited_by:invitedBy?showId(invitedBy.public_no):null,
    signup_bonus_coins:Number(rewards?.signup_bonus_coins)||0,
    recharge_bonus_coins:Number(rewards?.recharge_bonus_coins)||0,
    signup_inviter_reward:INVITER_SIGNUP_COINS,
    signup_invitee_reward:INVITEE_SIGNUP_COINS,recharge_bonus_percent:5,
    bonus_enabled:true,
    note:'Each verified referral registration rewards 5,000 inviter coins and 10,000 new-user coins; approved coin-seller recharges reward 5% to inviter.'
  },200,cors);
}
export async function handleInviteAdmin({request,env,actor,operation,cors,reply,fail}){
  if(operation!=='invites')return null;
  if(!['super','finance'].includes(actor.role))
    return fail('admin_permission_denied',403,cors);
  if(request.method!=='GET')
    return fail('admin_permission_denied',403,cors);
  const [total,rows,bonuses]=await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM sharika_referrals').first(),
    env.DB.prepare(
      'SELECT a.public_no AS inviter_no,b.public_no AS referred_no,'+
      'r.created_at FROM sharika_referrals r '+
      'JOIN sharika_users a ON a.auth_uid=r.inviter_uid '+
      'JOIN sharika_users b ON b.auth_uid=r.referred_uid '+
      'ORDER BY r.created_at DESC LIMIT 100'
    ).all(),
    env.DB.prepare("SELECT reason,COALESCE(SUM(delta),0) AS coins,COUNT(*) AS n "+
      "FROM sharika_wallet_ledger WHERE reason IN ('referral_signup','referral_recharge') "+
      "GROUP BY reason").all()
  ]);
  return reply({total_invites:Number(total?.n)||0,
    bonus_enabled:true,read_only:true,
    signup_inviter_reward:INVITER_SIGNUP_COINS,signup_invitee_reward:INVITEE_SIGNUP_COINS,
    recharge_bonus_percent:5,
    bonus_totals:(bonuses.results||[]).map(r=>({reason:r.reason,coins:Number(r.coins)||0,count:Number(r.n)||0})),
    referrals:(rows.results||[]).map(r=>({
      inviter_public_id:showId(r.inviter_no),referred_public_id:showId(r.referred_no),
      joined_at:r.created_at
    }))},200,cors);
}
