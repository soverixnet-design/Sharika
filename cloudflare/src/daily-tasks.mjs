// Server-verified repeatable daily tasks, independent from the 7-day login streak.
// UTC calendar date is the boundary; receipts and wallet ledger are immutable.
const MAX_BALANCE=1_000_000_000_000;
const TITLES={follow:'Follow a new friend today',gift:'Send a gift to another user today'};
const KEYS=Object.keys(TITLES);
const dayText=now=>now.toISOString().slice(0,10);
function nextDay(now){
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));
}
export function validTaskRewards(value){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    KEYS.every(key=>Number.isSafeInteger(value[key])&&value[key]>=1&&value[key]<=1000);
}
export async function taskConfig(db){
  const row=await db.prepare(
    "SELECT follow_coins,gift_coins FROM sharika_daily_task_config WHERE key='standard'"
  ).first();
  if(!row||!validTaskRewards({follow:Number(row.follow_coins),gift:Number(row.gift_coins)}))
    throw new Error('daily_task_rewards_not_configured');
  return {follow:Number(row.follow_coins),gift:Number(row.gift_coins)};
}
export async function taskCount(db,uid,key,now){
  const from=dayText(now)+' 00:00:00',to=dayText(nextDay(now))+' 00:00:00';
  if(key==='follow'){
    const row=await db.prepare('SELECT COUNT(*) AS n FROM sharika_follows '+
      'WHERE follower_uid=? AND created_at>=? AND created_at<?')
      .bind(uid,from,to).first();
    return Number(row?.n)||0;
  }
  if(key==='gift'){
    const row=await db.prepare('SELECT COUNT(*) AS n FROM sharika_gift_events '+
      'WHERE sender_uid=? AND sender_uid<>recipient_uid AND created_at>=? AND created_at<?')
      .bind(uid,from,to).first();
    return Number(row?.n)||0;
  }
  throw new Error('invalid_daily_task');
}
async function receipt(db,uid,day,key){
  return db.prepare('SELECT task_key,reward_coins FROM sharika_daily_task_claims '+
    'WHERE auth_uid=? AND utc_day=? AND task_key=?').bind(uid,day,key).first();
}
export async function dailyTaskStatus(db,uid,now){
  const today=dayText(now);
  const [rewards,follow,gift,claims]=await Promise.all([
    taskConfig(db),taskCount(db,uid,'follow',now),taskCount(db,uid,'gift',now),
    db.prepare('SELECT task_key,reward_coins FROM sharika_daily_task_claims '+
      'WHERE auth_uid=? AND utc_day=?').bind(uid,today).all()
  ]);
  const collected=new Set((claims?.results||[]).map(x=>x.task_key));
  return {
    task_rewards:rewards,
    tasks:KEYS.map(key=>({
      key,title:TITLES[key],
      count:key==='follow'?follow:gift,
      completed:(key==='follow'?follow:gift)>0,
      claimed:collected.has(key),
      reward_enabled:true,
      reward_coins:rewards[key]
    })),
    next_reset_utc:nextDay(now).toISOString(),day_boundary:'UTC'
  };
}
export async function claimDailyTask({request,env,uid,now,user,cors,reply,fail}){
  let body;
  try{
    const raw=await request.text();
    if(raw.length>256)return fail('invalid_daily_task',400,cors);
    body=JSON.parse(raw||'{}');
  }catch(_){return fail('invalid_daily_task',400,cors);}
  const key=body?.task_key;
  if(typeof key!=='string'||!KEYS.includes(key))return fail('invalid_daily_task',400,cors);
  const today=dayText(now),old=await receipt(env.DB,uid,today,key);
  if(old)return reply({duplicate:true,task_key:key,reward_coins:Number(old.reward_coins),
    wallet_coins:Number(user.coins),utc_day:today},200,cors);
  if(await taskCount(env.DB,uid,key,now)<1)
    return fail('daily_task_not_completed',409,cors);
  const rewards=await taskConfig(env.DB),reward=rewards[key];
  if(Number(user.coins)>MAX_BALANCE-reward)
    return fail('wallet_balance_limit',409,cors);
  try{
    // D1 batch runs transactionally. Unique day/key receipt is inserted first;
    // any second simultaneous claim rolls the entire batch back, including coins.
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sharika_daily_task_claims '+
        '(auth_uid,utc_day,task_key,reward_coins) VALUES(?,?,?,?)')
        .bind(uid,today,key,reward),
      env.DB.prepare("UPDATE sharika_users SET coins=CASE WHEN status='active' AND coins<=? "+
        "THEN coins+? ELSE -1 END,updated_at=datetime('now') WHERE auth_uid=?")
        .bind(MAX_BALANCE-reward,reward,uid),
      env.DB.prepare('INSERT INTO sharika_wallet_ledger '+
        '(auth_uid,currency,delta,balance_after,reason,request_id) '+
        "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),?,?)")
        .bind(uid,reward,uid,'daily_task_'+key,'daily-task:'+today+':'+key)
    ]);
  }catch(error){
    // A concurrent identical request may already have committed; reflect the
    // immutable receipt, never issue another credit.
    const committed=await receipt(env.DB,uid,today,key);
    if(!committed)throw error;
    const wallet=await env.DB.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?')
      .bind(uid).first();
    return reply({duplicate:true,task_key:key,reward_coins:Number(committed.reward_coins),
      wallet_coins:Number(wallet?.coins)||0,utc_day:today},200,cors);
  }
  const wallet=await env.DB.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?')
    .bind(uid).first();
  return reply({duplicate:false,task_key:key,reward_coins:reward,
    wallet_coins:Number(wallet?.coins)||0,utc_day:today},201,cors);
}
export async function dailyTaskAdminStatus(db,now=new Date()){
  const [rewards,tally]=await Promise.all([
    taskConfig(db),
    db.prepare('SELECT COUNT(*) AS claims,COALESCE(SUM(reward_coins),0) AS coins '+
      'FROM sharika_daily_task_claims WHERE utc_day=?').bind(dayText(now)).first()
  ]);
  return {task_rewards:rewards,task_claims_today:Number(tally?.claims)||0,
    task_coins_awarded_today:Number(tally?.coins)||0};
}
export async function saveDailyTaskConfig(db,actor,values){
  if(!validTaskRewards(values))throw new Error('invalid_daily_task_rewards');
  const previous=await taskConfig(db);
  await db.batch([
    db.prepare('UPDATE sharika_daily_task_config SET follow_coins=?,gift_coins=?,updated_by=?,'+
      "updated_at=datetime('now') WHERE key='standard'")
      .bind(values.follow,values.gift,actor),
    db.prepare('INSERT INTO sharika_daily_task_config_audit '+
      '(actor_uid,old_rewards,new_rewards) VALUES(?,?,?)')
      .bind(actor,JSON.stringify(previous),JSON.stringify(values))
  ]);
  return values;
}
