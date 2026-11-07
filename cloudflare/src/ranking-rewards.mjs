import {verifiedRankingWindow,VERIFIED_GAME_CODES} from './verified-rankings.mjs';
import {recordUserEvent} from './transaction-notices.mjs';

// Rules are versioned, never overwritten. Every publication takes effect at
// the NEXT complete UTC period; existing rankings and wallet history are safe.
const KINDS={sending:'gift_sent',recharge:'recharge_approved',game:'game_settled'};
const SCORES={wins:'SUM(CASE WHEN e.payout_coins>0 THEN 1 ELSE 0 END)',
  stake:'SUM(e.amount_coins)',payout:'SUM(e.payout_coins)'};
const MAX_BALANCE=1_000_000_000_000;
const GRACE_MS=10*60_000;
const pad=n=>String(n).padStart(8,'0');
const stamp=date=>date.toISOString().slice(0,19).replace('T',' ');

export function rewardBoardKey({kind,period,metric,game}){
  if(!Object.hasOwn(KINDS,kind)||!verifiedRankingWindow(period))return null;
  if(kind==='game'){
    if(!Object.hasOwn(SCORES,metric)||
      (game!==null&&game!==undefined&&!VERIFIED_GAME_CODES.has(game)))return null;
    return `game:${period}:${metric}:${game||'all'}`;
  }
  if(metric!==undefined&&metric!==null&&metric!=='coins'||game!==null&&game!==undefined)
    return null;
  return `${kind}:${period}:coins:all`;
}

function boardInput(input){
  const kind=input.kind??'sending',period=input.period??'weekly';
  const metric=input.metric??(kind==='game'?'wins':'coins');
  const game=input.game??null;
  const key=rewardBoardKey({kind,period,metric,game});
  return key?{kind,period,metric,game,key}:null;
}

function completeWindow(period,now){
  const current=verifiedRankingWindow(period,now);
  if(!current)return null;
  const previous=verifiedRankingWindow(period,current.start.getTime()-1);
  return {start:previous.start,end:current.start};
}

async function activePolicy(db,key,start){
  return db.prepare('SELECT * FROM sharika_ranking_reward_policies '+
    'WHERE policy_key=? AND effective_from<=? ORDER BY effective_from DESC,id DESC LIMIT 1')
    .bind(key,start.toISOString()).first();
}

async function latestPolicy(db,key){
  return db.prepare('SELECT * FROM sharika_ranking_reward_policies '+
    'WHERE policy_key=? ORDER BY effective_from DESC,id DESC LIMIT 1').bind(key).first();
}

function serializePolicy(row){
  return row?{id:Number(row.id),kind:row.kind,period:row.period,metric:row.metric,
    game:row.game_code,enabled:Boolean(row.enabled),auto_award:Boolean(row.auto_award),
    targets:JSON.parse(row.targets_json),prizes:JSON.parse(row.prizes_json),
    effective_from:row.effective_from,created_at:row.created_at}:null;
}

export async function rankedRewardCandidates(db,board,window){
  // The key and SQL score expression are selected from server-owned enums.
  const score=board.kind==='game'?SCORES[board.metric]:'SUM(e.amount_coins)';
  const filter=board.game?' AND e.game_code=?':'';
  const params=[KINDS[board.kind],stamp(window.start),stamp(window.end)];
  if(board.game)params.push(board.game);
  const result=await db.prepare('SELECT e.user_uid,u.public_no,u.coins,'+
    "(SELECT s.special_id FROM sharika_special_ids s WHERE s.auth_uid=u.auth_uid "+
    "AND (s.expires_at IS NULL OR s.expires_at>datetime('now')) LIMIT 1) AS special_id,"+
    'CAST('+score+' AS TEXT) AS score FROM sharika_verified_activity_events e '+
    'JOIN sharika_users u ON u.auth_uid=e.user_uid '+
    "WHERE u.status='active' AND e.event_type=? AND e.occurred_at>=? "+
    'AND e.occurred_at<?'+filter+' GROUP BY e.user_uid HAVING '+score+'>0 '+
    'ORDER BY '+score+' DESC,u.public_no ASC LIMIT 7').bind(...params).all();
  return (result.results||[]).map((row,i)=>({rank:i+1,user_uid:row.user_uid,
    display_id:row.special_id===null?pad(row.public_no):String(row.special_id),
    score:String(row.score),balance:Number(row.coins)}));
}

function plannedAwards(candidates,policy){
  const targets=JSON.parse(policy.targets_json).map(BigInt);
  const prizes=JSON.parse(policy.prizes_json);
  return candidates.filter(c=>prizes[c.rank-1]>0&&BigInt(c.score)>=targets[c.rank-1])
    .map(c=>({...c,coins:prizes[c.rank-1]}));
}

export async function rankingRewardDashboard(db,query,now=Date.now()){
  const board=boardInput(query);
  if(!board)return null;
  const current=verifiedRankingWindow(board.period,now);
  const last=completeWindow(board.period,now);
  const [latest,effective,control,existing,candidates]=await Promise.all([
    latestPolicy(db,board.key),activePolicy(db,board.key,last.start),
    db.prepare('SELECT paused FROM sharika_ranking_reward_control WHERE id=1').first(),
    db.prepare('SELECT b.policy_id,b.winner_count,b.awarded_coins,b.created_at '+
      'FROM sharika_ranking_reward_batches b WHERE b.policy_key=? AND b.period_start=?')
      .bind(board.key,last.start.toISOString()).first(),
    rankedRewardCandidates(db,board,last)
  ]);
  const prospective=effective?.enabled?plannedAwards(candidates,effective):[];
  return {...board,paused:control?.paused!==0,policy:serializePolicy(latest),
    last_policy:serializePolicy(effective),
    next_effective_from:current.end.toISOString(),
    last_completed:{start_at:last.start.toISOString(),end_at:last.end.toISOString(),
      candidates:candidates.map(({user_uid,balance,...safe})=>safe),
      preview_awards:prospective.map(({user_uid,balance,...safe})=>safe),
      settled:!!existing,settlement:existing?{
        policy_id:Number(existing.policy_id),winner_count:Number(existing.winner_count),
        awarded_coins:Number(existing.awarded_coins),created_at:existing.created_at}:null},
    coverage:'post_migration_only',timezone:'UTC',read_only:true};
}

// Must be invoked on a completed window; this intentionally never scans
// historical periods, including any period before policy publication.
export async function settleLastRankingPeriod(db,env,boardQuery,now=Date.now(),{
  automatic=true,issuer='system',ctx=null
}={}){
  const board=boardInput(boardQuery);
  if(!board)return {skipped:'invalid_board'};
  const window=completeWindow(board.period,now);
  if(now<window.end.getTime()+GRACE_MS)return {skipped:'grace_period'};
  const policy=await activePolicy(db,board.key,window.start);
  if(!policy||!policy.enabled)return {skipped:'no_published_rule'};
  if(automatic&&(!policy.auto_award||env?.SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED!=='true'))
    return {skipped:'automatic_disabled'};
  const control=await db.prepare('SELECT paused FROM sharika_ranking_reward_control WHERE id=1').first();
  if(!control||control.paused!==0)return {skipped:'paused'};
  const prior=await db.prepare('SELECT id,winner_count,awarded_coins '+
    'FROM sharika_ranking_reward_batches WHERE policy_key=? AND period_start=?')
    .bind(board.key,window.start.toISOString()).first();
  if(prior)return {duplicate:true,winner_count:Number(prior.winner_count),
    awarded_coins:Number(prior.awarded_coins)};
  const candidates=await rankedRewardCandidates(db,board,window);
  const awards=plannedAwards(candidates,policy);
  if(awards.some(a=>!Number.isSafeInteger(a.balance)||a.balance>MAX_BALANCE-a.coins))
    return {skipped:'wallet_preflight_failed'};
  const total=awards.reduce((n,a)=>n+a.coins,0);
  const start=window.start.toISOString(),end=window.end.toISOString();
  const work=[db.prepare('INSERT INTO sharika_ranking_reward_batches '+
    '(policy_key,policy_id,period_start,period_end,winner_count,awarded_coins,issued_by) '+
    'VALUES(?,?,?,?,?,?,?)').bind(board.key,policy.id,start,end,awards.length,total,issuer)];
  for(const award of awards){
    const batchId='(SELECT id FROM sharika_ranking_reward_batches WHERE policy_key=? AND period_start=?)';
    const requestId=`rankreward:${policy.id}:${start.slice(0,10)}:${award.rank}`;
    work.push(db.prepare('INSERT INTO sharika_ranking_reward_awards '+
      '(batch_id,rank,user_uid,score,coins) VALUES('+batchId+',?,?,?,?)')
      .bind(board.key,start,award.rank,award.user_uid,award.score,award.coins));
    work.push(db.prepare('UPDATE sharika_users SET coins=CASE WHEN status=\'active\' '+
      'AND coins<=? THEN coins+? ELSE -1 END,updated_at=datetime(\'now\') WHERE auth_uid=?')
      .bind(MAX_BALANCE-award.coins,award.coins,award.user_uid));
    work.push(db.prepare('INSERT INTO sharika_wallet_ledger '+
      '(auth_uid,currency,delta,balance_after,reason,request_id) '+
      "VALUES(?,'coins',?,(SELECT coins FROM sharika_users WHERE auth_uid=?),"+
      "'verified_ranking_reward',?)")
      .bind(award.user_uid,award.coins,award.user_uid,requestId));
  }
  work.push(db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
    "VALUES(?,'ranking_reward_period_settled',?)")
    .bind(policy.created_by,JSON.stringify({policy_id:policy.id,policy_key:board.key,
      period_start:start,automatic,issuer,winner_count:awards.length,coins:total})));
  try{await db.batch(work);}
  catch(error){
    const done=await db.prepare('SELECT winner_count,awarded_coins '+
      'FROM sharika_ranking_reward_batches WHERE policy_key=? AND period_start=?')
      .bind(board.key,start).first();
    if(done)return {duplicate:true,winner_count:Number(done.winner_count),
      awarded_coins:Number(done.awarded_coins)};
    throw error;
  }
  for(const award of awards){
    try{await recordUserEvent({db,env,ctx,recipientUid:award.user_uid,
      kind:'reward',title:`Sharika ${board.kind} ranking · TOP ${award.rank}`,
      body:`Your verified ${board.period} ranking earned ${award.coins} coins.`,
      dedupeKey:`rankreward:${board.key}:${start}:${award.rank}`});}
    catch(error){console.error('ranking_reward_notice_error',String(error?.message||error));}
  }
  return {awarded:true,policy_id:Number(policy.id),winner_count:awards.length,
    awarded_coins:total,period_start:start};
}

async function bodyJson(request){
  const raw=await request.text();
  if(raw.length>4096)throw Error('body_too_large');
  const body=JSON.parse(raw||'{}');
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid_body');
  return body;
}

export async function handleRankingRewardAdmin({request,env,uid,actor,operation,cors,reply,fail,ctx}){
  if(!['ranking-rewards','ranking-rewards/pause','ranking-rewards/settle'].includes(operation))return null;
  if(!['super','finance'].includes(actor.role))return fail('admin_permission_denied',403,cors);
  const db=env.DB,url=new URL(request.url);
  if(operation==='ranking-rewards'&&request.method==='GET'){
    const result=await rankingRewardDashboard(db,{
      kind:url.searchParams.get('kind')||'sending',period:url.searchParams.get('period')||'weekly',
      metric:url.searchParams.get('metric')||undefined,game:url.searchParams.get('game')||undefined});
    return result?reply({...result,read_only:actor.role!=='super'},200,cors):
      fail('invalid_ranking_reward_filter',400,cors);
  }
  if(actor.role!=='super')return fail('admin_permission_denied',403,cors);
  if(operation==='ranking-rewards'&&request.method==='PATCH'){
    let body;try{body=await bodyJson(request);}catch{return fail('invalid_ranking_reward_json',400,cors);}
    const board=boardInput(body);
    if(!Object.hasOwn(body,'kind')||!Object.hasOwn(body,'period')||
      !board||typeof body.enabled!=='boolean'||typeof body.auto_award!=='boolean'||
      body.auto_award&&!body.enabled||!Array.isArray(body.targets)||body.targets.length!==7||
      !Array.isArray(body.prizes)||body.prizes.length!==7||
      body.targets.some(n=>!Number.isSafeInteger(n)||n<0||n>1_000_000_000_000)||
      body.prizes.some(n=>!Number.isSafeInteger(n)||n<0||n>1_000_000)||
      body.enabled&&!body.prizes.some(n=>n>0))return fail('invalid_ranking_reward_rule',400,cors);
    const effective=verifiedRankingWindow(board.period,Date.now()).end.toISOString();
    const results=await db.batch([
      db.prepare('INSERT INTO sharika_ranking_reward_policies '+
        '(policy_key,kind,period,metric,game_code,targets_json,prizes_json,enabled,auto_award,effective_from,created_by) '+
        'VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(board.key,board.kind,board.period,
          board.metric,board.game,JSON.stringify(body.targets),JSON.stringify(body.prizes),
          Number(body.enabled),Number(body.auto_award),effective,uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        "VALUES(?,'ranking_reward_rule_published',?)").bind(uid,JSON.stringify({
          key:board.key,effective_from:effective,enabled:body.enabled,auto_award:body.auto_award,
          targets:body.targets,prizes:body.prizes}))
    ]);
    return reply({published:true,policy_id:Number(results[0]?.meta?.last_row_id),
      effective_from:effective,automatic_payout_requires_environment_flag:true},200,cors);
  }
  if(operation==='ranking-rewards/pause'&&request.method==='POST'){
    let body;try{body=await bodyJson(request);}catch{return fail('invalid_ranking_reward_json',400,cors);}
    if(typeof body.paused!=='boolean'||body.confirm!==true)return fail('confirmation_required',400,cors);
    await db.batch([
      db.prepare("UPDATE sharika_ranking_reward_control SET paused=?,updated_by=?,updated_at=datetime('now') WHERE id=1")
        .bind(Number(body.paused),uid),
      db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) '+
        "VALUES(?,'ranking_rewards_paused_changed',?)").bind(uid,JSON.stringify({paused:body.paused}))
    ]);
    return reply({paused:body.paused},200,cors);
  }
  if(operation==='ranking-rewards/settle'&&request.method==='POST'){
    let body;try{body=await bodyJson(request);}catch{return fail('invalid_ranking_reward_json',400,cors);}
    if(body.confirm!==true)return fail('confirmation_required',400,cors);
    const board=boardInput(body);
    if(!Object.hasOwn(body,'kind')||!Object.hasOwn(body,'period')||!board)
      return fail('invalid_ranking_reward_filter',400,cors);
    try{return reply(await settleLastRankingPeriod(db,env,board,Date.now(),{
      automatic:false,issuer:uid,ctx}),200,cors);}
    catch(error){console.error('manual_ranking_reward_failed',String(error?.message||error));
      return fail('ranking_reward_settlement_failed',409,cors);}
  }
  return fail('ranking_reward_method_not_allowed',405,cors);
}

export async function settleAutomaticRankingRewards(db,env,now=Date.now(),ctx=null){
  if(env?.SHARIKA_AUTOMATIC_RANKING_REWARDS_ENABLED!=='true')return {skipped:'flag_disabled'};
  const rows=(await db.prepare('SELECT DISTINCT policy_key,kind,period,metric,game_code '+
    'FROM sharika_ranking_reward_policies WHERE enabled=1 AND auto_award=1 '+
    'ORDER BY policy_key LIMIT 100').all()).results||[];
  const seen=new Set(),out=[];
  for(const row of rows){
    if(seen.has(row.policy_key))continue;
    seen.add(row.policy_key);
    const result=await settleLastRankingPeriod(db,env,{kind:row.kind,period:row.period,
      metric:row.metric,game:row.game_code},now,{automatic:true,ctx});
    out.push({policy_key:row.policy_key,...result});
  }
  return {boards:out};
}
