import { inviteSettings, inviteOverview, handleInviteUpgrade, adminInviteExtras,
  handleInviteAdminUpgrade } from './invite-upgrade.mjs';
// Verified Sharika referral records: real 8-digit inviter IDs only.
// A referral is created once, atomically with the new registered user's profile.
// Referral coin bonuses are intentionally disabled; no wallet mutation occurs here.
const PUBLIC_ID=/^[0-9]{8}$/;
const showId=n=>String(n).padStart(8,'0');
// Amounts are promotional Sharika coins, not cash. Verified signups are one-time.
export const INVITER_SIGNUP_COINS=5000;
export const INVITEE_SIGNUP_COINS=10000;
export const STANDARD_SIGNUP_COINS=2000;
const MAX_USER_COINS=1_000_000_000_000;
export const signupCoins=(hasInviter,config)=>hasInviter?
  Number(config?.invitee_total_coins??INVITEE_SIGNUP_COINS):STANDARD_SIGNUP_COINS;
export function signupReferralStatements({db,uid,inviterUid,config}){
  const reward=Number(config?.inviter_coins??INVITER_SIGNUP_COINS);
  const statements=[
    db.prepare('INSERT INTO sharika_referrals(referred_uid,inviter_uid) VALUES(?,?)')
      .bind(uid,inviterUid),
  ];
  if(reward>0){
    statements.push(db.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
      "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
      .bind(MAX_USER_COINS-reward,reward,inviterUid));
    statements.push(db.prepare("INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) "+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'referral_signup',?)")
      .bind(inviterUid,reward,inviterUid,'referral-signup:'+uid));
  }
  return statements;
}
export function rechargeBonusCoins(amount,percent=5){
  if(!Number.isSafeInteger(amount)||amount<1||!Number.isSafeInteger(percent)||percent<0||percent>100)return 0;
  return Math.floor(amount*percent/100);
}
export async function rechargeReferralStatements({db,recipientUid,sellerUid,requestId,amount}){
  const settings=await inviteSettings(db);
  if(!Number(settings.enabled))return {bonus:0,statements:[]};
  const bonus=rechargeBonusCoins(amount,Number(settings.recharge_percent));
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
export async function handleInviteApp({request,env,uid,path,cors,reply,fail,ctx}){
  if(path!=='/api/v1/invites')return handleInviteUpgrade({request,env,uid,path,cors,reply,fail,ctx});
  if(request.method!=='GET')return fail('invite_method_not_allowed',405,cors);
  const user=await env.DB.prepare(
    "SELECT public_no FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!user)return fail('profile_unavailable',403,cors);
  const config=await inviteSettings(env.DB);
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
    total_invites:Number(count?.n)||0,
    referrals:(rows.results||[]).map(r=>({
      public_id:showId(r.public_no),name:r.name,joined_at:r.created_at
    })),
    invited_by:invitedBy?showId(invitedBy.public_no):null,
    signup_bonus_coins:Number(rewards?.signup_bonus_coins)||0,
    recharge_bonus_coins:Number(rewards?.recharge_bonus_coins)||0,
    signup_inviter_reward:Number(config.inviter_coins),
    signup_invitee_reward:Number(config.invitee_total_coins),
    recharge_bonus_percent:Number(config.recharge_percent),
    bonus_enabled:Boolean(config.enabled),
    note:'Invite settings are controlled by the verified admin panel.',
    ...await inviteOverview({request,env,uid})
  },200,cors);
}
export async function handleInviteAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  const action=await handleInviteAdminUpgrade({request,env,uid,actor,operation,cors,reply,fail});
  if(action)return action;
  if(operation!=='invites')return null;
  if(!['super','finance'].includes(actor.role))
    return fail('admin_permission_denied',403,cors);
  if(request.method!=='GET')
    return fail('admin_permission_denied',403,cors);
  const config=await inviteSettings(env.DB);
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
    bonus_enabled:Boolean(config.enabled),read_only:actor.role!=='super',
    signup_inviter_reward:Number(config.inviter_coins),
    signup_invitee_reward:Number(config.invitee_total_coins),
    recharge_bonus_percent:Number(config.recharge_percent),
    bonus_totals:(bonuses.results||[]).map(r=>({reason:r.reason,coins:Number(r.coins)||0,count:Number(r.n)||0})),
    ...await adminInviteExtras({env}),
    referrals:(rows.results||[]).map(r=>({
      inviter_public_id:showId(r.inviter_no),referred_public_id:showId(r.referred_no),
      joined_at:r.created_at
    }))},200,cors);
}
