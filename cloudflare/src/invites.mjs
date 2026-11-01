// Verified Sharika referral records: real 8-digit inviter IDs only.
// A referral is created once, atomically with the new registered user's profile.
// All signup/referral bonuses use the existing verified D1 wallet ledger.
const PUBLIC_ID=/^[0-9]{8}$/;
const REQUEST_ID=/^[A-Za-z0-9:_-]{12,80}$/;
const showId=n=>String(n).padStart(8,'0');
// Amounts are promotional Sharika coins, not cash. Verified signups are one-time.
export const INVITER_SIGNUP_COINS=100_000;
export const INVITEE_SIGNUP_COINS=100_000;
export const STANDARD_SIGNUP_COINS=2000;
// Proposed USD 1 per ten *verified* new accounts. Amounts are integer cents,
// not virtual coins. A finance reviewer must approve each claim before cash
// becomes withdrawable; this code NEVER transfers real money.
export const INVITE_USD_CENTS_PER_VERIFIED_USER=10;
export const INVITE_WITHDRAWAL_OPTIONS_CENTS=[5000,10000];
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
      .bind(inviterUid,INVITER_SIGNUP_COINS,inviterUid,'referral-signup:'+uid),
    db.prepare('INSERT INTO sharika_invite_usd_earnings '+
      '(referred_uid,inviter_uid,amount_cents) VALUES(?,?,?)')
      .bind(uid,inviterUid,INVITE_USD_CENTS_PER_VERIFIED_USER)
  ];
}
async function inviteCashBalance(db,uid){
  const [earned,spent]=await Promise.all([
    db.prepare("SELECT "+
      "COALESCE(SUM(CASE WHEN status='pending' THEN amount_cents ELSE 0 END),0) AS pending_cents,"+
      "COALESCE(SUM(CASE WHEN status='approved' THEN amount_cents ELSE 0 END),0) AS approved_cents "+
      'FROM sharika_invite_usd_earnings WHERE inviter_uid=?').bind(uid).first(),
    db.prepare("SELECT "+
      "COALESCE(SUM(CASE WHEN status IN ('pending','paid') THEN amount_cents ELSE 0 END),0) AS reserved_cents,"+
      "COALESCE(SUM(CASE WHEN status='paid' THEN amount_cents ELSE 0 END),0) AS paid_cents "+
      'FROM sharika_invite_withdrawals WHERE inviter_uid=?').bind(uid).first()
  ]);
  const approved=Number(earned?.approved_cents)||0;
  const reserved=Number(spent?.reserved_cents)||0;
  return {pending_cents:Number(earned?.pending_cents)||0,
    approved_cents:approved,available_cents:Math.max(0,approved-reserved),
    paid_cents:Number(spent?.paid_cents)||0};
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
  if(!['/api/v1/invites','/api/v1/invites/redeem',
    '/api/v1/invites/rankings','/api/v1/invites/withdrawals'].includes(path))return null;
  if(path==='/api/v1/invites/withdrawals'){
    const member=await env.DB.prepare(
      "SELECT auth_uid,minor FROM sharika_users WHERE auth_uid=? AND status='active'"
    ).bind(uid).first();
    if(!member)return fail('profile_unavailable',403,cors);
    if(request.method==='GET'){
      const [balance,rows]=await Promise.all([
        inviteCashBalance(env.DB,uid),env.DB.prepare(
          'SELECT id,amount_cents,status,created_at,reviewed_at FROM sharika_invite_withdrawals '+
          'WHERE inviter_uid=? ORDER BY id DESC LIMIT 30'
        ).bind(uid).all()
      ]);
      return reply({balance,requests:rows.results||[],
        options_cents:INVITE_WITHDRAWAL_OPTIONS_CENTS,
        manual_review_required:true,external_payout_automated:false,
        can_request:!member.minor},200,cors);
    }
    if(request.method!=='POST')return fail('invite_method_not_allowed',405,cors);
    if(member.minor)return fail('withdrawal_adult_only',403,cors);
    let input;
    try{
      const raw=await request.text();if(raw.length>4096)throw Error();
      input=JSON.parse(raw);
    }catch(_){return fail('invalid_withdrawal_request',400,cors);}
    const amount=input?.amount_cents,requestId=input?.request_id;
    if(!INVITE_WITHDRAWAL_OPTIONS_CENTS.includes(amount)||
       typeof requestId!=='string'||!REQUEST_ID.test(requestId))
      return fail('invalid_withdrawal_request',400,cors);
    const existing=await env.DB.prepare('SELECT id,amount_cents,status FROM '+
      'sharika_invite_withdrawals WHERE request_id=? AND inviter_uid=?')
      .bind(requestId,uid).first();
    if(existing)return Number(existing.amount_cents)===amount?
      reply({duplicate:true,request:existing},200,cors):fail('idempotency_conflict',409,cors);
    // A single conditional insert checks the latest approved dollar earnings
    // and reserves the withdrawal, so simultaneous requests cannot overdraw.
    const insert=env.DB.prepare('INSERT INTO sharika_invite_withdrawals '+
      '(inviter_uid,amount_cents,request_id) SELECT ?,?,? WHERE '+
      '(SELECT COALESCE(SUM(amount_cents),0) FROM sharika_invite_usd_earnings '+
      "WHERE inviter_uid=? AND status='approved')-"+
      '(SELECT COALESCE(SUM(amount_cents),0) FROM sharika_invite_withdrawals '+
      "WHERE inviter_uid=? AND status IN ('pending','paid'))>=?")
      .bind(uid,amount,requestId,uid,uid,amount);
    try{
      const created=await insert.run();
      if(Number(created.meta?.changes)!==1)
        return fail('withdrawal_balance_insufficient',409,cors);
    }catch(error){
      const duplicate=await env.DB.prepare('SELECT id,amount_cents,status FROM '+
        'sharika_invite_withdrawals WHERE request_id=? AND inviter_uid=?')
        .bind(requestId,uid).first();
      if(duplicate&&Number(duplicate.amount_cents)===amount)
        return reply({duplicate:true,request:duplicate},200,cors);
      return fail('withdrawal_request_unavailable',409,cors);
    }
    const saved=await env.DB.prepare('SELECT id,amount_cents,status,created_at FROM '+
      'sharika_invite_withdrawals WHERE request_id=? AND inviter_uid=?')
      .bind(requestId,uid).first();
    return reply({requested:true,request:saved,
      note:'Manual identity and external payout verification are required.'},201,cors);
  }
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
    try{
      const raw=await request.text();if(raw.length>4096)throw Error();
      input=JSON.parse(raw);
    }catch(_){return fail('invalid_invite_code',400,cors);}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       typeof input.invite_code!=='string')return fail('invalid_invite_code',400,cors);
    const verified=await resolveInviter({db:env.DB,uid,inviteCode:input.invite_code,fail,cors});
    if(verified.error)return verified.error;
    if(!verified.inviter)return fail('invalid_invite_code',400,cors);
    // Registration already credited the standard 2,000 welcome coins.
    // Complete only the difference to the 100,000 invitee signup
    // total, plus the 100,000 inviter reward. One unique referral row
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
      rank:i+1,id:showId(r.public_no),name:r.name,total_invites:Number(r.invites)||0,
      estimated_usd_cents:(Number(r.invites)||0)*INVITE_USD_CENTS_PER_VERIFIED_USER
    })),prize_status:'not_configured'},200,cors);
  }
  if(path!=='/api/v1/invites'||request.method!=='GET')
    return fail('invite_method_not_allowed',405,cors);
  const user=await env.DB.prepare(
    "SELECT public_no,created_at FROM sharika_users WHERE auth_uid=? AND status='active'"
  ).bind(uid).first();
  if(!user)return fail('profile_unavailable',403,cors);
  const [count,rows,invitedBy,rewards,cash,withdrawals]=await Promise.all([
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
      "FROM sharika_wallet_ledger WHERE auth_uid=? AND currency='coins'").bind(uid).first(),
    inviteCashBalance(env.DB,uid),
    env.DB.prepare('SELECT id,amount_cents,status,created_at FROM '+
      'sharika_invite_withdrawals WHERE inviter_uid=? ORDER BY id DESC LIMIT 10')
      .bind(uid).all()
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
    invite_usd_cents_per_verified_user:INVITE_USD_CENTS_PER_VERIFIED_USER,
    cash_balance:cash,withdrawal_options_cents:INVITE_WITHDRAWAL_OPTIONS_CENTS,
    withdrawals:withdrawals.results||[],
    recharge_coins_per_usd:500000,first_recharge_bonus_percent:40,
    bonus_enabled:true,
    note:'Every verified referral rewards 100,000 coins to each party; USD 0.10 per referral remains pending until review. The first verified recharge rewards 40% extra coins to the buyer; eligible referral recharges reward 5% to inviter.'
  },200,cors);
}
export async function handleInviteAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='invites'&&!operation.startsWith('invites/'))return null;
  if(!['super','finance'].includes(actor.role))
    return fail('admin_permission_denied',403,cors);
  if(operation==='invites/earnings'&&request.method==='GET'){
    const rows=await env.DB.prepare('SELECT e.referred_uid,'+
      'a.public_no AS inviter_no,b.public_no AS referred_no,e.amount_cents,e.status,'+
      'e.created_at,e.reviewed_at FROM sharika_invite_usd_earnings e '+
      'JOIN sharika_users a ON a.auth_uid=e.inviter_uid '+
      'JOIN sharika_users b ON b.auth_uid=e.referred_uid '+
      "ORDER BY CASE WHEN e.status='pending' THEN 0 ELSE 1 END,e.created_at DESC LIMIT 100").all();
    return reply({earnings:(rows.results||[]).map(x=>({
      inviter_id:showId(x.inviter_no),referred_id:showId(x.referred_no),
      amount_cents:x.amount_cents,status:x.status,created_at:x.created_at,
      reviewed_at:x.reviewed_at
    })),manual_review_required:true},200,cors);
  }
  if(operation==='invites/earnings/verify'&&request.method==='POST'){
    let input;
    try{const raw=await request.text();if(raw.length>4096)throw Error();input=JSON.parse(raw);}
    catch(_){return fail('invalid_earning_review',400,cors);}
    if(typeof input?.referred_public_id!=='string'||
       !PUBLIC_ID.test(input.referred_public_id)||typeof input.approved!=='boolean')
      return fail('invalid_earning_review',400,cors);
    const earning=await env.DB.prepare('SELECT e.referred_uid,e.inviter_uid,e.status,'+
      'a.status AS inviter_status,b.status AS referred_status '+
      'FROM sharika_invite_usd_earnings e '+
      'JOIN sharika_users a ON a.auth_uid=e.inviter_uid '+
      'JOIN sharika_users b ON b.auth_uid=e.referred_uid WHERE b.public_no=?')
      .bind(Number(input.referred_public_id)).first();
    if(!earning)return fail('earning_not_found',404,cors);
    if(earning.status!=='pending')return fail('earning_already_reviewed',409,cors);
    if(uid===earning.inviter_uid||uid===earning.referred_uid)
      return fail('cannot_review_own_earning',403,cors);
    if(input.approved&&(
      earning.inviter_status!=='active'||earning.referred_status!=='active'))
      return fail('referral_not_qualified',409,cors);
    await env.DB.batch([
      env.DB.prepare('UPDATE sharika_invite_usd_earnings SET status=?,reviewed_by=?,'+
        "reviewed_at=datetime('now') WHERE referred_uid=? AND status='pending'")
        .bind(input.approved?'approved':'rejected',uid,earning.referred_uid),
      env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        'VALUES(?,?,?)').bind(uid,'invite_cash_earning_review',JSON.stringify({
          referred_public_id:input.referred_public_id,approved:input.approved
        }))
    ]);
    return reply({reviewed:true,approved:input.approved},200,cors);
  }
  if(operation==='invites/withdrawals'&&request.method==='GET'){
    const rows=await env.DB.prepare('SELECT w.id,u.public_no,u.name,w.amount_cents,'+
      'w.status,w.created_at,w.reviewed_at,w.payment_reference '+
      'FROM sharika_invite_withdrawals w '+
      'JOIN sharika_users u ON u.auth_uid=w.inviter_uid '+
      "ORDER BY CASE WHEN w.status='pending' THEN 0 ELSE 1 END,w.id DESC LIMIT 100").all();
    return reply({withdrawals:(rows.results||[]).map(x=>({
      id:x.id,public_id:showId(x.public_no),name:x.name,
      amount_cents:x.amount_cents,status:x.status,created_at:x.created_at,
      reviewed_at:x.reviewed_at,payment_reference:x.payment_reference
    })),external_payment_required:true},200,cors);
  }
  if(operation==='invites/withdrawals/review'&&request.method==='POST'){
    let input;
    try{const raw=await request.text();if(raw.length>4096)throw Error();input=JSON.parse(raw);}
    catch(_){return fail('invalid_withdrawal_review',400,cors);}
    const paid=input?.status==='paid',rejected=input?.status==='rejected';
    const reference=typeof input?.payment_reference==='string'?
      input.payment_reference.trim():'';
    if(!Number.isSafeInteger(input?.withdrawal_id)||input.withdrawal_id<1||
       (!paid&&!rejected)||(paid&&(
         input.confirm_external_payment!==true||input.confirm_identity_verified!==true||
         !/^[A-Za-z0-9:/._-]{8,120}$/.test(reference))))
      return fail('verified_external_payment_required',400,cors);
    const row=await env.DB.prepare('SELECT id,inviter_uid,status FROM '+
      'sharika_invite_withdrawals WHERE id=?').bind(input.withdrawal_id).first();
    if(!row)return fail('withdrawal_not_found',404,cors);
    if(row.status!=='pending')return fail('withdrawal_already_reviewed',409,cors);
    if(uid===row.inviter_uid)return fail('cannot_review_own_withdrawal',403,cors);
    if(paid){
      const used=await env.DB.prepare('SELECT id FROM sharika_invite_withdrawals '+
        "WHERE payment_reference=? AND status='paid'").bind(reference).first();
      if(used)return fail('payment_reference_already_used',409,cors);
    }
    await env.DB.batch([
      env.DB.prepare('UPDATE sharika_invite_withdrawals SET status=?,payment_reference=?,'+
        "reviewed_by=?,reviewed_at=datetime('now') WHERE id=? AND status='pending'")
        .bind(input.status,paid?reference:null,uid,input.withdrawal_id),
      env.DB.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        'VALUES(?,?,?)').bind(uid,'invite_withdrawal_review',JSON.stringify({
          withdrawal_id:input.withdrawal_id,status:input.status,
          payment_reference:paid?reference:null
        }))
    ]);
    return reply({reviewed:true,status:input.status,
      note:paid?'External payment attested by finance reviewer.':'Reserved earnings released.'},200,cors);
  }
  if(operation!=='invites')return fail('invite_admin_route_not_found',404,cors);
  if(request.method!=='GET')
    return fail('admin_permission_denied',403,cors);
  const [total,rows,bonuses,usd]=await Promise.all([
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
      "GROUP BY reason").all(),
    env.DB.prepare('SELECT status,COUNT(*) AS n,COALESCE(SUM(amount_cents),0) AS cents '+
      'FROM sharika_invite_usd_earnings GROUP BY status').all()
  ]);
  return reply({total_invites:Number(total?.n)||0,
    bonus_enabled:true,read_only:true,
    signup_inviter_reward:INVITER_SIGNUP_COINS,signup_invitee_reward:INVITEE_SIGNUP_COINS,
    recharge_bonus_percent:5,
    invite_usd_cents_per_verified_user:INVITE_USD_CENTS_PER_VERIFIED_USER,
    withdrawal_options_cents:INVITE_WITHDRAWAL_OPTIONS_CENTS,
    usd_earning_totals:(usd.results||[]).map(x=>({
      status:x.status,count:Number(x.n)||0,cents:Number(x.cents)||0
    })),
    bonus_totals:(bonuses.results||[]).map(r=>({reason:r.reason,coins:Number(r.coins)||0,count:Number(r.n)||0})),
    referrals:(rows.results||[]).map(r=>({
      inviter_public_id:showId(r.inviter_no),referred_public_id:showId(r.referred_no),
      joined_at:r.created_at
    }))},200,cors);
}
