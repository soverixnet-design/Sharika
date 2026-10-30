// Verified Sharika daily check-in and read-only task activity.
// D1 unique UTC day, immutable receipt, wallet credit and ledger commit as one batch.
const MAX_BALANCE=1_000_000_000_000;
const CONFIG_FIELDS=['day1','day2','day3','day4','day5','day6','day7'];
function dayText(now){return now.toISOString().slice(0,10);}
function previousDay(now){return dayText(new Date(Date.UTC(
  now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-1)));}
function rewardsOf(row){return CONFIG_FIELDS.map(k=>Number(row[k]));}
function safeConfig(row){
  const rewards=rewardsOf(row||{});
  if(rewards.length!==7||rewards.some(n=>!Number.isSafeInteger(n)||n<1||n>1000))
    throw new Error('daily_rewards_not_configured');
  return rewards;
}
function receipt(row){return row?{utc_day:row.utc_day,streak:Number(row.streak),
  reward_coins:Number(row.reward_coins)}:null;}
async function config(db){
  return await db.prepare('SELECT day1,day2,day3,day4,day5,day6,day7,updated_at '+
    "FROM sharika_daily_reward_config WHERE key='standard'").first();
}
async function lastClaim(db,uid){
  return await db.prepare(
    'SELECT utc_day,streak,reward_coins FROM sharika_daily_checkins '+
    'WHERE auth_uid=? ORDER BY utc_day DESC LIMIT 1'
  ).bind(uid).first();
}
function nextStreak(last,now){
  return last&&last.utc_day===previousDay(now)?(Number(last.streak)%7)+1:1;
}
export async function handleDailyApp({request,env,uid,path,cors,reply,fail,now=new Date()}){
  if(path!=='/api/v1/daily'&&path!=='/api/v1/daily/check-in')
    return null;
  const user=await env.DB.prepare(
    "SELECT auth_uid,public_no,coins,status FROM sharika_users WHERE auth_uid=?"
  ).bind(uid).first();
  if(!user||user.status!=='active')return fail('profile_unavailable',403,cors);
  const today=dayText(now);
  if(path==='/api/v1/daily'&&request.method==='GET'){
    const [settings,last,follow,gift]=await Promise.all([
      config(env.DB),lastClaim(env.DB,uid),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM sharika_follows '+
        'WHERE follower_uid=? AND created_at>=? AND created_at<?'
      ).bind(uid,today+' 00:00:00',nextDayText(now)+' 00:00:00').first(),
      env.DB.prepare(
        'SELECT COUNT(*) AS n FROM sharika_gift_events '+
        'WHERE sender_uid=? AND sender_uid<>recipient_uid '+
        'AND created_at>=? AND created_at<?'
      ).bind(uid,today+' 00:00:00',nextDayText(now)+' 00:00:00').first()
    ]);
    const rewards=safeConfig(settings),claimed=last?.utc_day===today;
    const index=claimed?Number(last.streak):nextStreak(last,now);
    return reply({utc_day:today,claimed_today:claimed,
      streak:claimed?Number(last.streak):last?.utc_day===previousDay(now)?Number(last.streak):0,
      next_day:index,rewards,claimed:claimed?receipt(last):null,
      tasks:[{key:'follow',title:'Follow a new friend today',completed:Number(follow?.n||0)>0,count:Number(follow?.n)||0,reward_enabled:false},
        {key:'gift',title:'Send a gift to another user today',completed:Number(gift?.n||0)>0,count:Number(gift?.n)||0,reward_enabled:false}],
      wallet_coins:Number(user.coins)||0,day_boundary:'UTC',
      invite_code:String(user.public_no).padStart(8,'0'),invite_rewards_enabled:false
    },200,cors);
  }
  if(path==='/api/v1/daily/check-in'&&request.method==='POST'){
    const [settings,last]=await Promise.all([config(env.DB),lastClaim(env.DB,uid)]);
    if(last?.utc_day===today)
      return reply({duplicate:true,claimed:receipt(last),
        wallet_coins:Number(user.coins)},200,cors);
    const index=nextStreak(last,now),reward=safeConfig(settings)[index-1];
    if(Number(user.coins)>MAX_BALANCE-reward)
      return fail('wallet_balance_limit',409,cors);
    await env.DB.batch([
      env.DB.prepare(
        'INSERT INTO sharika_daily_checkins(auth_uid,utc_day,streak,reward_coins) '+
        'VALUES(?,?,?,?)'
      ).bind(uid,today,index,reward),
      env.DB.prepare(
        "UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?"
      ).bind(MAX_BALANCE-reward,reward,uid),
      env.DB.prepare(
        'INSERT INTO sharika_wallet_ledger(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),'daily_checkin',?)"
      ).bind(uid,reward,uid,'daily:'+today)
    ]);
    const updated=await env.DB.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?')
      .bind(uid).first();
    return reply({duplicate:false,claimed:{utc_day:today,streak:index,reward_coins:reward},
      wallet_coins:Number(updated?.coins)||0},201,cors);
  }
  return fail('daily_method_not_allowed',405,cors);
}
function nextDayText(now){
  return dayText(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)));
}
export async function handleDailyAdmin({request,env,uid,actor,operation,cors,reply,fail}){
  if(operation!=='daily')return null;
  if(!['super','finance'].includes(actor.role))
    return fail('admin_permission_denied',403,cors);
  const settings=await config(env.DB);
  if(request.method==='GET'){
    const counts=await env.DB.prepare(
      'SELECT COUNT(*) AS claims,COALESCE(SUM(reward_coins),0) AS total_coins '+
      'FROM sharika_daily_checkins WHERE utc_day=?'
    ).bind(dayText(new Date())).first();
    return reply({rewards:safeConfig(settings),utc_day:dayText(new Date()),
      claims_today:Number(counts?.claims)||0,coins_awarded_today:Number(counts?.total_coins)||0,
      read_only:actor.role!=='super',day_boundary:'UTC'},200,cors);
  }
  if(request.method==='PATCH'&&actor.role==='super'){
    let payload;
    try{
      const raw=await request.text();
      if(raw.length>4096)return fail('daily_body_too_large',413,cors);
      payload=JSON.parse(raw);
    }catch(_){return fail('invalid_daily_json',400,cors);}
    const rewards=payload?.rewards;
    if(!Array.isArray(rewards)||rewards.length!==7||
      rewards.some(n=>!Number.isSafeInteger(n)||n<1||n>1000))
      return fail('invalid_daily_rewards',400,cors);
    const old=safeConfig(settings);
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE sharika_daily_reward_config SET day1=?,day2=?,day3=?,day4=?,day5=?,'+
        "day6=?,day7=?,updated_by=?,updated_at=datetime('now') WHERE key='standard'"
      ).bind(...rewards,uid),
      env.DB.prepare(
        'INSERT INTO sharika_daily_config_audit(actor_uid,old_rewards,new_rewards) VALUES(?,?,?)'
      ).bind(uid,JSON.stringify(old),JSON.stringify(rewards))
    ]);
    return reply({updated:true,rewards},200,cors);
  }
  return fail('admin_permission_denied',403,cors);
}
