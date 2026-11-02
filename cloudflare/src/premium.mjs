// Isolated Sharika VIP / SVIP / Noble entitlements. The verified Worker owns
// status, purchase debits, daily credits, administrative grants and audit.
const RANK={none:0,vip:1,svip:2,noble:3};
const MAX_BALANCE=1_000_000_000_000;
const REQUEST_ID=/^[A-Za-z0-9:_-]{12,80}$/;
const PUBLIC_ID=/^[0-9]{8}$/;
const validSvipLevel=value=>Number.isInteger(value)&&value>=1&&value<=8;
const MS_DAY=86_400_000;
const bool=v=>v===1||v===true;
const day=now=>new Date(now).toISOString().slice(0,10);
const asId=n=>String(n).padStart(8,'0');
const rows=r=>r?.results||[];
const policyKeys=['purchase_enabled','admin_grant_enabled','auto_enabled',
  'auto_by_level','auto_by_gifts'];
const tierKeys=['min_wealth_level','min_gift_coins','price_coins',
  'duration_days','daily_bonus_coins'];
function policyView(row){return Object.fromEntries(policyKeys.map(k=>[k,bool(row?.[k])]));}
function tierView(row){return {tier:row.tier,rank:Number(row.rank),
  min_wealth_level:Number(row.min_wealth_level),
  min_gift_coins:Number(row.min_gift_coins),price_coins:Number(row.price_coins),
  duration_days:Number(row.duration_days),daily_bonus_coins:Number(row.daily_bonus_coins)};}
function validConfig(config){
  if(!config||typeof config!=='object'||!config.policy||!Array.isArray(config.tiers)||
     config.tiers.length!==3||policyKeys.some(k=>typeof config.policy[k]!=='boolean'))return false;
  const sorted=[...config.tiers].sort((a,b)=>RANK[a.tier]-RANK[b.tier]);
  if(sorted.some((t,i)=>!t||t.tier!==['vip','svip','noble'][i]||
    tierKeys.some(k=>!Number.isSafeInteger(t[k]))||
    t.min_wealth_level<1||t.min_wealth_level>500||
    t.min_gift_coins<1||t.min_gift_coins>MAX_BALANCE||
    t.price_coins<1||t.price_coins>1_000_000_000||
    t.duration_days<1||t.duration_days>365||
    t.daily_bonus_coins<0||t.daily_bonus_coins>10_000))return false;
  for(let i=1;i<sorted.length;i++) {
    if(sorted[i].min_wealth_level<=sorted[i-1].min_wealth_level||
      sorted[i].min_gift_coins<=sorted[i-1].min_gift_coins||
      sorted[i].price_coins<sorted[i-1].price_coins||
      sorted[i].daily_bonus_coins<sorted[i-1].daily_bonus_coins)return false;
  }
  return true;
}
async function settings(db){
  const [row,list]=await Promise.all([
    db.prepare("SELECT * FROM sharika_premium_policy WHERE key='standard'").first(),
    db.prepare('SELECT * FROM sharika_premium_tiers ORDER BY rank').all()
  ]);
  if(!row||rows(list).length!==3)throw Error('premium_not_configured');
  return {policy:policyView(row),tiers:rows(list).map(tierView)};
}
export function selectPremiumTier({policy,tiers,wealthLevel,giftCoins,manual,nowMs}){
  let tier='none',source='none',expires_at_ms=null;
  if(manual?.tier&&RANK[manual.tier]&&Number(manual.expires_at_ms)>nowMs){
    tier=manual.tier;source=manual.source;expires_at_ms=Number(manual.expires_at_ms);
  }
  if(policy.auto_enabled){
    for(const item of tiers){
      const level=policy.auto_by_level&&wealthLevel>=item.min_wealth_level;
      const gifts=policy.auto_by_gifts&&giftCoins>=item.min_gift_coins;
      if((level||gifts)&&RANK[item.tier]>RANK[tier]){
        tier=item.tier;source=level?'automatic_level':'automatic_gifts';
        expires_at_ms=null;
      }
    }
  }
  const selected=tiers.find(t=>t.tier===tier);
  const svip_level=tier==='svip'?
    (manual?.tier==='svip'&&Number(manual.expires_at_ms)>nowMs&&
      validSvipLevel(Number(manual.svip_level))?Number(manual.svip_level):1):0;
  return {tier,rank:RANK[tier],source,expires_at_ms,svip_level,
    daily_bonus_coins:Number(selected?.daily_bonus_coins||0),
    active_benefits:tier==='none'?[]:tier==='svip'?
      ['profile_badge','daily_coins','premium_frame','animated_medal','nameplate','room_badge','room_entry_banner']:
      ['profile_badge','daily_coins'],
    planned_benefits:tier==='none'?[]:tier==='vip'?
      ['profile_badge','entry_effect','chat_style','daily_coins']:
      tier==='svip'?
      ['profile_badge','entry_effect','chat_style','daily_coins','premium_frame','support_priority']:
      ['profile_badge','entry_effect','chat_style','daily_coins','premium_frame',
        'support_priority','premium_background','bonus_xp','noble_presence']};
}
async function profileStatus(db,uid,nowMs,configuration=null){
  const cfg=configuration||await settings(db);
  const [user,manual,volume,claim]=await Promise.all([
    db.prepare('SELECT auth_uid,public_no,coins,wealth_level,status FROM sharika_users WHERE auth_uid=?')
      .bind(uid).first(),
    db.prepare('SELECT tier,source,starts_at_ms,expires_at_ms,svip_level FROM sharika_premium_memberships WHERE auth_uid=?')
      .bind(uid).first(),
    db.prepare('SELECT COALESCE(SUM(CAST(quantity AS INTEGER)*CAST(price_coins AS INTEGER)),0) AS gift_coins '+
      'FROM sharika_gift_events WHERE sender_uid=? AND recipient_uid<>sender_uid').bind(uid).first(),
    db.prepare('SELECT tier,reward_coins FROM sharika_premium_daily_claims WHERE auth_uid=? AND utc_day=?')
      .bind(uid,day(nowMs)).first()
  ]);
  if(!user||user.status!=='active')return null;
  const wealthLevel=Number(user.wealth_level)||1,giftCoins=Number(volume?.gift_coins)||0;
  const selected=selectPremiumTier({policy:cfg.policy,tiers:cfg.tiers,wealthLevel,
    giftCoins,manual,nowMs});
  return {...selected,wealth_level:wealthLevel,gift_coins:giftCoins,
    public_id:asId(user.public_no),wallet_coins:Number(user.coins)||0,
    utc_day:day(nowMs),claimed_today:!!claim,
    claimed_reward_coins:Number(claim?.reward_coins)||0};
}
async function payload(request,limit=4096){
  const raw=await request.text();
  if(raw.length>limit)throw Error('premium_body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_premium_body');
  return body;
}
const readError=(fail,cors,error)=>fail(error.message==='premium_body_too_large'
  ?'premium_body_too_large':'invalid_premium_body',400,cors);

export async function handlePremiumApp({request,env,uid,path,cors,reply,fail,nowMs=Date.now()}){
  if(!['/api/v1/premium','/api/v1/premium/purchase',
    '/api/v1/premium/daily/claim'].includes(path))return null;
  const cfg=await settings(env.DB);
  const status=await profileStatus(env.DB,uid,nowMs,cfg);
  if(!status)return fail('profile_unavailable',403,cors);
  if(path==='/api/v1/premium'&&request.method==='GET')
    return reply({status,config:cfg,day_boundary:'UTC'},200,cors);
  if(path==='/api/v1/premium/purchase'&&request.method==='POST'){
    if(!cfg.policy.purchase_enabled)return fail('premium_purchase_disabled',403,cors);
    let body;
    try{body=await payload(request);}catch(error){return readError(fail,cors,error);}
    const chosen=cfg.tiers.find(t=>t.tier===body.tier),requestId=body.request_id;
    if(!chosen||typeof requestId!=='string'||!REQUEST_ID.test(requestId))
      return fail('invalid_premium_purchase',400,cors);
    const existing=await env.DB.prepare(
      'SELECT tier,price_coins,expires_at_ms FROM sharika_premium_purchases WHERE auth_uid=? AND request_id=?'
    ).bind(uid,requestId).first();
    if(existing){
      if(existing.tier!==chosen.tier)return fail('premium_request_conflict',409,cors);
      return reply({duplicate:true,tier:existing.tier,price_coins:Number(existing.price_coins),
        expires_at_ms:Number(existing.expires_at_ms)},200,cors);
    }
    if(status.rank>chosen.rank)return fail('premium_downgrade_not_allowed',409,cors);
    if(status.wallet_coins<chosen.price_coins)return fail('wallet_insufficient',409,cors);
    const prior=await env.DB.prepare(
      'SELECT tier,expires_at_ms FROM sharika_premium_memberships WHERE auth_uid=?'
    ).bind(uid).first();
    const beginning=nowMs,expiration=(prior?.tier===chosen.tier
      ?Math.max(nowMs,Number(prior.expires_at_ms)||0):nowMs)+chosen.duration_days*MS_DAY;
    const ledgerId='premium:purchase:'+requestId;
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sharika_premium_purchases(auth_uid,tier,request_id,price_coins,starts_at_ms,expires_at_ms) '+
        'VALUES(?,?,?,?,?,?)'
      ).bind(uid,chosen.tier,requestId,chosen.price_coins,beginning,expiration),
      env.DB.prepare(
        "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins>=? THEN coins-? ELSE -1 END,"+
        "updated_at=datetime('now') WHERE auth_uid=?"
      ).bind(chosen.price_coins,chosen.price_coins,uid),
      env.DB.prepare(
        'INSERT INTO sharika_premium_memberships(auth_uid,tier,source,starts_at_ms,expires_at_ms,granted_by,svip_level) '+
        "VALUES(?,?,'purchase',?,?,NULL,1) ON CONFLICT(auth_uid) DO UPDATE SET "+
        "svip_level=CASE WHEN sharika_premium_memberships.tier='svip' AND excluded.tier='svip' "+
        "THEN sharika_premium_memberships.svip_level ELSE 1 END,"+
        "tier=excluded.tier,source='purchase',starts_at_ms=excluded.starts_at_ms,"+
        "expires_at_ms=excluded.expires_at_ms,granted_by=NULL,updated_at=datetime('now')"
      ).bind(uid,chosen.tier,beginning,expiration),
      env.DB.prepare(
        'INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'premium_purchase',?)"
      ).bind(uid,-chosen.price_coins,uid,ledgerId)
    ]);
    return reply({duplicate:false,tier:chosen.tier,price_coins:chosen.price_coins,
      expires_at_ms:expiration},201,cors);
  }
  if(path==='/api/v1/premium/daily/claim'&&request.method==='POST'){
    if(status.tier==='none')return fail('premium_membership_required',403,cors);
    if(status.claimed_today){
      return reply({duplicate:true,utc_day:status.utc_day,
        reward_coins:status.claimed_reward_coins},200,cors);
    }
    const reward=status.daily_bonus_coins;
    if(!Number.isSafeInteger(reward)||reward<=0)return fail('premium_bonus_disabled',403,cors);
    if(status.wallet_coins>MAX_BALANCE-reward)return fail('wallet_balance_limit',409,cors);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sharika_premium_daily_claims(auth_uid,utc_day,tier,reward_coins) VALUES(?,?,?,?)'
      ).bind(uid,status.utc_day,status.tier,reward),
      env.DB.prepare(
        "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
      ).bind(MAX_BALANCE-reward,reward,uid),
      env.DB.prepare(
        'INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'premium_daily_bonus',?)"
      ).bind(uid,reward,uid,'premium:daily:'+status.utc_day)
    ]);
    return reply({duplicate:false,utc_day:status.utc_day,tier:status.tier,
      reward_coins:reward},201,cors);
  }
  return fail('premium_method_not_allowed',405,cors);
}

export async function handlePremiumAdmin({request,env,uid,actor,operation,cors,reply,fail,nowMs=Date.now()}){
  if(operation!=='premium'&&operation!=='premium/grant')return null;
  if(!['super','finance','support'].includes(actor.role))
    return fail('admin_permission_denied',403,cors);
  const cfg=await settings(env.DB);
  if(operation==='premium'&&request.method==='GET'){
    const rawId=new URL(request.url).searchParams.get('public_id');
    let member=null;
    if(rawId!==null){
      if(!PUBLIC_ID.test(rawId))return fail('invalid_premium_user',400,cors);
      const target=await env.DB.prepare('SELECT auth_uid FROM sharika_users WHERE public_no=?')
        .bind(Number(rawId)).first();
      if(!target)return fail('user_not_found',404,cors);
      member=await profileStatus(env.DB,target.auth_uid,nowMs,cfg);
    }
    const counts=await env.DB.prepare(
      'SELECT tier,COUNT(*) AS users FROM sharika_premium_memberships WHERE expires_at_ms>? GROUP BY tier'
    ).bind(nowMs).all();
    return reply({config:cfg,member,active_grants:rows(counts),
      read_only:actor.role!=='super'},200,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='premium'&&request.method==='PATCH'){
    let body;
    try{body=await payload(request,8192);}catch(error){return readError(fail,cors,error);}
    if(!validConfig(body))return fail('invalid_premium_configuration',400,cors);
    const current=JSON.stringify(cfg);
    await env.DB.batch([
      env.DB.prepare('UPDATE sharika_premium_policy SET purchase_enabled=?,admin_grant_enabled=?,auto_enabled=?,'+
        'auto_by_level=?,auto_by_gifts=?,updated_by=?,updated_at=datetime(\'now\') WHERE key=\'standard\'')
        .bind(...policyKeys.map(k=>Number(body.policy[k])),uid),
      ...body.tiers.map(t=>env.DB.prepare(
        'UPDATE sharika_premium_tiers SET min_wealth_level=?,min_gift_coins=?,price_coins=?,'+
        'duration_days=?,daily_bonus_coins=? WHERE tier=?'
      ).bind(...tierKeys.map(k=>t[k]),t.tier)),
      env.DB.prepare('INSERT INTO sharika_premium_audit(actor_uid,target_uid,action,details_json) '+
        "VALUES(?,NULL,'policy_update',?)").bind(uid,JSON.stringify({before:current,after:body}))
    ]);
    return reply({updated:true,config:body},200,cors);
  }
  if(operation==='premium/grant'&&request.method==='POST'){
    let body;
    try{body=await payload(request);}catch(error){return readError(fail,cors,error);}
    if(!PUBLIC_ID.test(body.public_id)||!['vip','svip','noble','none'].includes(body.tier)||
       (body.tier!=='none'&&(!Number.isInteger(body.duration_days)||
        body.duration_days<1||body.duration_days>365)))
      return fail('invalid_premium_grant',400,cors);
    const level=body.tier==='svip'?Number(body.svip_level??1):1;
    if(!validSvipLevel(level))return fail('invalid_svip_level',400,cors);
    if(body.tier!=='none'&&!cfg.policy.admin_grant_enabled)
      return fail('premium_admin_grants_disabled',403,cors);
    const user=await env.DB.prepare(
      'SELECT auth_uid,status FROM sharika_users WHERE public_no=?'
    ).bind(Number(body.public_id)).first();
    if(!user||user.status!=='active')return fail('user_not_found',404,cors);
    const previous=await env.DB.prepare(
      'SELECT tier,source,expires_at_ms,svip_level FROM sharika_premium_memberships WHERE auth_uid=?'
    ).bind(user.auth_uid).first();
    const statement=body.tier==='none'
      ?env.DB.prepare('DELETE FROM sharika_premium_memberships WHERE auth_uid=?').bind(user.auth_uid)
      :env.DB.prepare(
        'INSERT INTO sharika_premium_memberships(auth_uid,tier,source,starts_at_ms,expires_at_ms,granted_by,svip_level) '+
        "VALUES(?,?,'admin',?,?,?,?) ON CONFLICT(auth_uid) DO UPDATE SET tier=excluded.tier,"+
        "source='admin',starts_at_ms=excluded.starts_at_ms,expires_at_ms=excluded.expires_at_ms,"+
        "granted_by=excluded.granted_by,svip_level=excluded.svip_level,updated_at=datetime('now')"
      ).bind(user.auth_uid,body.tier,nowMs,nowMs+body.duration_days*MS_DAY,uid,level);
    await env.DB.batch([
      statement,
      env.DB.prepare('INSERT INTO sharika_premium_audit(actor_uid,target_uid,action,details_json) '+
        'VALUES(?,?,?,?)').bind(uid,user.auth_uid,
        body.tier==='none'?'revoke':'grant',JSON.stringify({before:previous,
          tier:body.tier,svip_level:body.tier==='svip'?level:0,duration_days:body.duration_days||0}))
    ]);
    return reply({updated:true,public_id:body.public_id,tier:body.tier,
      svip_level:body.tier==='svip'?level:0,expires_at_ms:body.tier==='none'?null:nowMs+body.duration_days*MS_DAY},200,cors);
  }
  return fail('premium_method_not_allowed',405,cors);
}

/**
 * A public SVIP level is always computed from verified premium rules.
 * Manual paid/admin levels 1..8 take precedence, automatic SVIP is level 1,
 * and higher Noble eligibility suppresses the SVIP ornament.
 */
export function publicSvipSelect(alias='u'){
  if(!/^[a-z][a-z0-9_]*$/.test(alias))throw Error('invalid_sql_alias');
  const gifts='COALESCE((SELECT SUM(CAST(g.quantity AS INTEGER)*CAST(g.price_coins AS INTEGER)) '+
    'FROM sharika_gift_events g WHERE g.sender_uid='+alias+'.auth_uid AND g.recipient_uid<>g.sender_uid),0)';
  const automatic=tier=>'(EXISTS(SELECT 1 FROM sharika_premium_policy p '+
    'JOIN sharika_premium_tiers t ON t.tier=\''+tier+'\' WHERE p.key=\'standard\' '+
    'AND p.auto_enabled=1 AND ((p.auto_by_level=1 AND '+alias+'.wealth_level>=t.min_wealth_level) '+
    'OR (p.auto_by_gifts=1 AND '+gifts+'>=t.min_gift_coins))))';
  const active='(p.expires_at_ms>CAST(unixepoch(\'now\') AS INTEGER)*1000)';
  const member='(SELECT COALESCE(p.svip_level,1) FROM sharika_premium_memberships p '+
    'WHERE p.auth_uid='+alias+'.auth_uid AND p.tier=\'svip\' AND '+active+' LIMIT 1)';
  const noble='EXISTS(SELECT 1 FROM sharika_premium_memberships p '+
    'WHERE p.auth_uid='+alias+'.auth_uid AND p.tier=\'noble\' AND '+active+')';
  return 'CASE WHEN '+noble+' OR '+automatic('noble')+' THEN 0 '+
    'WHEN '+automatic('svip')+' THEN COALESCE('+member+',1) '+
    'ELSE COALESCE('+member+',0) END AS svip_level';
}
export async function readSvipLevel(db,uid){
  const row=await db.prepare('SELECT '+publicSvipSelect('u')+
    ' FROM sharika_users u WHERE u.auth_uid=?').bind(uid).first();
  return Number(row?.svip_level)||0;
}
