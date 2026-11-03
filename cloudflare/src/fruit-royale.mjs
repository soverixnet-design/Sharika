// Fruit Royale V2: isolated, versioned virtual-coin game. Legacy Jackpot Fruit is untouched.
// Server owns round entropy, wallet debits, payouts, and immutable history.
import {activeSpecialSelect} from './special-ids.mjs';

export const FRUIT_ROUND_MS=40000;
const BET_MS=28000,MAX_BET=1000000000000;
const REQUEST_ID=/^[A-Za-z0-9:_-]{12,80}$/;
export const FRUIT_V2=Object.freeze([
  {id:'lemon',name:'Lemon',emoji:'🍋',multiplier:4,weight:15},
  {id:'strawberry',name:'Strawberry',emoji:'🍓',multiplier:4,weight:15},
  {id:'kiwi',name:'Kiwi',emoji:'🥝',multiplier:4,weight:15},
  {id:'cherry',name:'Cherry',emoji:'🍒',multiplier:20,weight:3},
  {id:'plum',name:'Plum',emoji:'🫐',multiplier:15,weight:4},
  {id:'watermelon',name:'Watermelon',emoji:'🍉',multiplier:10,weight:6},
  {id:'mango',name:'Mango',emoji:'🥭',multiplier:6,weight:10},
  {id:'apple',name:'Apple',emoji:'🍎',multiplier:6,weight:10}
]);
export const FRUIT_BONUSES=Object.freeze([
  {id:'none',weight:920},{id:'fruit+1',weight:30},
  {id:'fruit+2',weight:10},{id:'x2',weight:20},
  {id:'x3',weight:10},{id:'jackpot',weight:10}
]);
const WEIGHTS=FRUIT_V2.map(x=>x.weight), BONUS_WEIGHTS=FRUIT_BONUSES.map(x=>x.weight);
const ROUND_ID_PREFIX='fruit-royale:';
const safeNumber=x=>Number.isSafeInteger(Number(x))?Number(x):0;
const roundNo=now=>Math.floor(now/FRUIT_ROUND_MS);
const clock=n=>({id:ROUND_ID_PREFIX+n,round_no:n,starts_ms:n*FRUIT_ROUND_MS,
  bet_closes_ms:n*FRUIT_ROUND_MS+BET_MS,closes_ms:(n+1)*FRUIT_ROUND_MS});
const hex=a=>[...a].map(b=>b.toString(16).padStart(2,'0')).join('');
async function sha(value){
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));
}
// Hash-and-reject eliminates modulo bias, with a stable server-only committed seed.
async function draw(seed,label,weights){
  const total=weights.reduce((s,n)=>s+n,0);
  const limit=Math.floor(4294967296/total)*total;
  for(let i=0;i<100;i++){
    const hash=await sha(seed+'|'+label+'|'+i);
    const value=parseInt(hash.slice(0,8),16);
    if(value>=limit)continue;
    let target=value%total;
    for(let j=0;j<weights.length;j++){
      if(target<weights[j])return j;
      target-=weights[j];
    }
  }
  throw Error('fruit_entropy_unavailable');
}
export async function fruitOutcome(seed){
  const bonus=FRUIT_BONUSES[await draw(seed,'bonus',BONUS_WEIGHTS)].id;
  const draws=bonus==='fruit+1'?2:bonus==='fruit+2'?3:1;
  const positions=[];
  for(let i=0;i<draws;i++)positions.push(await draw(seed,'fruit:'+i,WEIGHTS));
  return {positions,fruitIds:positions.map(i=>FRUIT_V2[i].id),bonus,
    multiplier:bonus==='x2'?2:bonus==='x3'?3:1};
}
export function fruitPayout(bet,outcome,jackpotAward=0){
  if(!Number.isSafeInteger(bet.amount)||bet.amount<0||
     !Number.isInteger(bet.pick_index)||bet.pick_index<0||bet.pick_index>=FRUIT_V2.length||
     !Number.isSafeInteger(jackpotAward)||jackpotAward<0)throw Error('invalid_payout_input');
  const hits=outcome.positions.filter(x=>x===bet.pick_index).length;
  const won=bet.amount*FRUIT_V2[bet.pick_index].multiplier*hits*outcome.multiplier+jackpotAward;
  if(!Number.isSafeInteger(won)||won<0)throw Error('fruit_payout_overflow');
  return won;
}
async function ensureRound(db,n){
  const t=clock(n);
  let row=await db.prepare('SELECT * FROM sharika_fruit_royale_rounds WHERE id=?').bind(t.id).first();
  if(row)return row;
  const seed=hex(crypto.getRandomValues(new Uint8Array(32)));
  const commit=await sha(seed+'|'+t.id);
  await db.prepare('INSERT OR IGNORE INTO sharika_fruit_royale_rounds '+
    '(id,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) VALUES(?,?,?,?,?,?,?)')
    .bind(t.id,n,t.starts_ms,t.bet_closes_ms,t.closes_ms,seed,commit).run();
  row=await db.prepare('SELECT * FROM sharika_fruit_royale_rounds WHERE id=?').bind(t.id).first();
  if(!row)throw Error('fruit_round_unavailable');
  return row;
}
async function reserveJackpot(db,row,outcome){
  if(outcome.bonus!=='jackpot')return {budget:0,total_stake:0,awards:new Map()};
  const stake=await db.prepare('SELECT COALESCE(SUM(amount),0) AS stake '+
    'FROM sharika_fruit_royale_bets WHERE round_id=?').bind(row.round_id).first();
  if(!stake||safeNumber(stake.stake)<1)return {budget:0,total_stake:0,awards:new Map()};
  const pool=await db.prepare("SELECT coins FROM sharika_fruit_royale_pool WHERE id='main'").first();
  const tentative=Math.floor(safeNumber(pool?.coins)/2);
  await db.prepare('INSERT OR IGNORE INTO sharika_fruit_royale_jackpots '+
    '(round_id,budget,total_stake) VALUES(?,?,?)').bind(row.round_id,tentative,stake.stake).run();
  const saved=await db.prepare('SELECT budget,total_stake FROM sharika_fruit_royale_jackpots WHERE round_id=?')
    .bind(row.round_id).first();
  const awards=new Map();
  const all=await db.prepare('SELECT id,amount FROM sharika_fruit_royale_bets '+
    'WHERE round_id=? ORDER BY id ASC').bind(row.round_id).all();
  const total=BigInt(saved.total_stake),budget=BigInt(saved.budget);
  let prefix=0n;
  for(const bet of all.results||[]){
    const before=prefix*budget/total;
    prefix+=BigInt(bet.amount);
    awards.set(bet.id,Number(prefix*budget/total-before));
  }
  return {...saved,awards};
}
export async function settleFruitDueBets(db,now=Date.now()){
  const rows=await db.prepare(
    "SELECT b.*,r.seed_hex,r.commit_sha256,r.closes_ms FROM sharika_fruit_royale_bets b "+
    "JOIN sharika_fruit_royale_rounds r ON r.id=b.round_id "+
    "WHERE b.status='accepted' AND r.closes_ms<=? ORDER BY r.closes_ms,b.id LIMIT 120"
  ).bind(now).all();
  const cache=new Map();let settled=0;
  for(const bet of rows.results||[]){
    let info=cache.get(bet.round_id);
    if(!info){
      const outcome=await fruitOutcome(bet.seed_hex);
      const jackpot=await reserveJackpot(db,bet,outcome);
      info={outcome,jackpot};cache.set(bet.round_id,info);
    }
    const jackpotAward=info.jackpot.awards.get(bet.id)||0;
    const payout=fruitPayout(bet,info.outcome,jackpotAward);
    const result=JSON.stringify({positions:info.outcome.positions,bonus:info.outcome.bonus,
      jackpotAward,seed_hex:bet.seed_hex,commit_sha256:bet.commit_sha256});
    const update=await db.prepare(
      "UPDATE sharika_fruit_royale_bets SET status='settled',payout=?,result_json=?,"+
      "settled_at=datetime('now') WHERE id=? AND status='accepted'"
    ).bind(payout,result,bet.id).run();
    if(update.meta?.changes===1)settled++;
  }
  return settled;
}
function moneyUser(db,uid){
  return db.prepare('SELECT u.auth_uid,u.public_no,u.name,u.pic,u.coins,u.status,u.minor,'+
    activeSpecialSelect('u')+' FROM sharika_users u WHERE u.auth_uid=?').bind(uid).first();
}
async function readState(db,uid){
  await settleFruitDueBets(db);
  const now=Date.now(),n=roundNo(now);
  const round=await ensureRound(db,n);
  const user=await moneyUser(db,uid);
  if(!user||user.status!=='active')throw Error('profile_required');
  const bets=(await db.prepare('SELECT id,round_id,round_no,pick_index,amount,request_id,'+
    'status,payout,result_json,created_at FROM sharika_fruit_royale_bets '+
    'WHERE user_uid=? AND round_no>=? ORDER BY id DESC LIMIT 100')
    .bind(uid,n-1).all()).results||[];
  const mine=bets.map(b=>({...b,result:b.result_json?JSON.parse(b.result_json):null,result_json:undefined}));
  const pool=await db.prepare("SELECT coins FROM sharika_fruit_royale_pool WHERE id='main'").first();
  const previous=await db.prepare('SELECT * FROM sharika_fruit_royale_rounds '+
    'WHERE closes_ms<=? ORDER BY round_no DESC LIMIT 1').bind(now).first();
  let previousResult=null;
  if(previous){
    const result=await fruitOutcome(previous.seed_hex);
    const previousBets=mine.filter(b=>b.round_no===previous.round_no&&b.status==='settled');
    const totalBet=previousBets.reduce((s,b)=>s+b.amount,0);
    const payout=previousBets.reduce((s,b)=>s+b.payout,0);
    let topWinners=[];
    if(now-previous.closes_ms<=10000){
      const leaders=await db.prepare('SELECT u.public_no,u.name,u.pic,'+
        activeSpecialSelect('u')+',SUM(b.payout) AS total_win '+
        'FROM sharika_fruit_royale_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid '+
        "WHERE b.round_id=? AND b.status='settled' AND b.payout>0 "+
        'GROUP BY b.user_uid ORDER BY total_win DESC,u.public_no LIMIT 3')
        .bind(previous.id).all();
      topWinners=(leaders.results||[]).map(w=>({public_id:w.special_id||String(w.public_no).padStart(8,'0'),
        name:w.name,pic:w.pic||null,total_win:w.total_win}));
    }
    previousResult={roundId:previous.id,round_no:previous.round_no,top_winners:topWinners,
      fruitIds:result.fruitIds,bonus:result.bonus,
      multiplier:result.multiplier,totalBet,payout,balance:user.coins,
      jackpot:pool?.coins||0,settledAt:previous.closes_ms,
      jackpotAward:previousBets.reduce((s,b)=>s+safeNumber(b.result?.jackpotAward),0),
      seed_hex:previous.seed_hex,commit_sha256:previous.commit_sha256};
  }
  const publicId=user.special_id||String(user.public_no).padStart(8,'0');
  return {game:'fruit-royale',serverNow:now,server_time:now,balance:user.coins,
    jackpot:pool?.coins||0,round:{id:round.id,
      status:now<round.bet_closes_ms?'open':'settling',
      closesAt:round.bet_closes_ms,settlesAt:round.closes_ms,
      commit_sha256:round.commit_sha256},
    bets:mine.filter(b=>b.round_id===round.id).map(b=>({id:b.id,
      requestId:b.request_id,roundId:b.round_id,fruitId:FRUIT_V2[b.pick_index].id,amount:b.amount})),
    fruits:FRUIT_V2.map(({id,name,emoji,multiplier})=>({id,name,emoji,multiplier})),
    user:{id:publicId,name:user.name,pic:user.pic||null},
    limits:{minBet:1,maxBet:MAX_BET},
    previous_result:previousResult,
    policy:{version:'v2',publicOdds:FRUIT_V2.map(f=>({
      fruitId:f.id,weight:f.weight,totalWeight:78})),
      bonusOdds:FRUIT_BONUSES.map(b=>({bonus:b.id,weight:b.weight,totalWeight:1000})),
      poolContributionPercent:5}
  };
}
async function personalHistory(db,uid){
  const rows=await db.prepare(
    "SELECT round_id AS roundId,CAST(strftime('%s',MAX(settled_at)) AS INTEGER)*1000 AS settledAt,"+
    "SUM(amount) AS totalBet,SUM(payout) AS payout,"+
    "COALESCE(MAX(json_extract(result_json,'$.bonus')),'none') AS bonus "+
    "FROM sharika_fruit_royale_bets WHERE user_uid=? AND status='settled' "+
    "GROUP BY round_id ORDER BY MAX(settled_at) DESC,round_id DESC LIMIT 50"
  ).bind(uid).all();
  return (rows.results||[]).map(r=>({...r,profitLoss:r.payout-r.totalBet}));
}
async function fruitRankings(db,period,metric){
  const since=period==='monthly'?"datetime('now','start of month')":
    period==='weekly'?"datetime('now','-7 days')":"datetime('now','start of day')";
  const sorts={totalWin:'totalWin',totalBet:'totalBet',
    profitLoss:'profitLoss',winCount:'winCount'};
  if(!Object.prototype.hasOwnProperty.call(sorts,metric))throw Error('invalid_ranking_metric');
  const query=
    'SELECT u.public_no,u.name,u.pic,'+activeSpecialSelect('u')+','+
    'COALESCE(SUM(b.payout),0) AS totalWin,'+
    'COALESCE(SUM(b.amount),0) AS totalBet,'+
    'COALESCE(SUM(b.payout-b.amount),0) AS profitLoss,'+
    'COUNT(DISTINCT CASE WHEN b.payout>0 THEN b.round_id END) AS winCount '+
    'FROM sharika_fruit_royale_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid '+
    "WHERE b.status='settled' AND b.settled_at>="+since+
    ' GROUP BY b.user_uid ORDER BY '+sorts[metric]+' DESC,u.public_no LIMIT 20';
  const rows=await db.prepare(query).all();
  return (rows.results||[]).map(row=>({
    userId:row.special_id||String(row.public_no).padStart(8,'0'),
    name:row.name,avatarUrl:row.pic||null,
    totalWin:row.totalWin,totalBet:row.totalBet,
    profitLoss:row.profitLoss,winCount:row.winCount
  }));
}
async function acceptBet({request,db,uid,reply,fail,cors}){
  const user=await moneyUser(db,uid);
  if(!user||user.status!=='active')return fail('profile_required',403,cors);
  if(user.minor)return fail('game_adult_only',403,cors);
  let b;
  try{
    const raw=await request.text();
    if(raw.length>2048)return fail('invalid_bet_body',413,cors);
    b=JSON.parse(raw||'{}');
  }catch{return fail('invalid_json',400,cors);}
  if(!b||typeof b!=='object'||Array.isArray(b)||
     typeof b.roundId!=='string'||!/^fruit-royale:[0-9]+$/.test(b.roundId)||
     !FRUIT_V2.some(f=>f.id===b.fruitId)||
     !Number.isSafeInteger(b.amount)||b.amount<1||b.amount>MAX_BET||
     !REQUEST_ID.test(b.requestId||''))return fail('invalid_bet',400,cors);
  const idx=FRUIT_V2.findIndex(f=>f.id===b.fruitId);
  const original=await db.prepare('SELECT * FROM sharika_fruit_royale_bets '+
    'WHERE user_uid=? AND request_id=?').bind(uid,b.requestId).first();
  const response=async row=>({
    id:row.id,requestId:row.request_id,roundId:row.round_id,
    fruitId:FRUIT_V2[row.pick_index].id,amount:row.amount,
    acceptedAt:Date.parse(row.created_at+'Z'),balance:(await moneyUser(db,uid)).coins
  });
  if(original){
    if(original.round_id!==b.roundId||original.pick_index!==idx||original.amount!==b.amount)
      return fail('idempotency_conflict',409,cors);
    return reply(await response(original),200,cors);
  }
  const n=roundNo(Date.now()),expected=clock(n);
  if(expected.id!==b.roundId||Date.now()>=expected.bet_closes_ms)
    return fail('betting_closed',409,cors);
  if(user.coins<b.amount)await settleFruitDueBets(db);
  await ensureRound(db,n);
  try{
    await db.prepare('INSERT INTO sharika_fruit_royale_bets '+
      '(round_id,round_no,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?)')
      .bind(b.roundId,n,uid,idx,b.amount,b.requestId).run();
  }catch(e){
    const collision=await db.prepare('SELECT * FROM sharika_fruit_royale_bets '+
      'WHERE user_uid=? AND request_id=?').bind(uid,b.requestId).first();
    if(collision){
      if(collision.round_id!==b.roundId||collision.pick_index!==idx||collision.amount!==b.amount)
        return fail('idempotency_conflict',409,cors);
      return reply(await response(collision),200,cors);
    }
    const msg=String(e?.message||e);
    if(msg.includes('fruit_insufficient_coins'))return fail('insufficient_coins',409,cors);
    if(msg.includes('fruit_betting_closed'))return fail('betting_closed',409,cors);
    if(msg.includes('fruit_user_ineligible'))return fail('game_adult_only',403,cors);
    return fail('bet_unavailable',503,cors);
  }
  const saved=await db.prepare('SELECT * FROM sharika_fruit_royale_bets '+
    'WHERE user_uid=? AND request_id=?').bind(uid,b.requestId).first();
  return reply(await response(saved),201,cors);
}
export async function handleFruitRoyaleRequest({request,db,uid,action,reply,fail,cors}){
  if(action==='state'&&request.method==='GET')
    return reply(await readState(db,uid),200,cors);
  if(action==='bet'&&request.method==='POST')
    return acceptBet({request,db,uid,reply,fail,cors});
  if(action==='history'&&request.method==='GET'){
    await settleFruitDueBets(db);
    return reply(await personalHistory(db,uid),200,cors);
  }
  if(action==='rankings'&&request.method==='GET'){
    const url=new URL(request.url);
    const period=url.searchParams.get('period')||'daily';
    const metric=url.searchParams.get('metric')||'totalWin';
    if(!['daily','weekly','monthly'].includes(period))return fail('invalid_period',400,cors);
    if(!['totalWin','totalBet','profitLoss','winCount'].includes(metric))
      return fail('invalid_ranking_metric',400,cors);
    await settleFruitDueBets(db);
    return reply(await fruitRankings(db,period,metric),200,cors);
  }
  if(action==='stats'&&request.method==='GET'){
    await settleFruitDueBets(db);
    const rows=await db.prepare(
      "SELECT COUNT(*) AS totalBets,COALESCE(SUM(amount),0) AS totalBet,"+
      "COALESCE(SUM(CASE WHEN status='settled' THEN payout ELSE 0 END),0) AS totalWin "+
      "FROM sharika_fruit_royale_bets WHERE user_uid=? AND created_at>=datetime('now','start of day')"
    ).bind(uid).first();
    return reply({...rows,profitLoss:rows.totalWin-rows.totalBet},200,cors);
  }
  return fail('fruit_royale_route_not_found',404,cors);
}
