// Greedy Wheel: server-authoritative virtual-coin game for Sharika staging.
// The supplied client's random/demo accounting is deliberately never used.
const ITEMS=['shrimp','fish','chicken','steak','cabbage','carrot','corn','tomato'];
const MULT=[10,15,25,45,5,5,5,5];
const OUTCOMES=[...ITEMS,'salad','pizza'];
// Source game's supplied relative weights, scaled to integer units.
const WEIGHTS=[9694,6396,3758,1999,19388,19388,19388,19388,400,200];
const ROUND_MS=41000,BET_MS=30000,SPIN_MS=6000;
const CHIPS=[1000,10000,100000,1000000,10000000];
const MAX_ROUND_STAKE=1000000000,MAX_BET=100000000;
const REQUEST_ID=/^[A-Za-z0-9:_-]{12,80}$/;
const enc=new TextEncoder();
function hex(bytes){return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function digest(str){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(str)));}
async function sha(str){return hex(await digest(str));}
function roundNumber(now){return Math.floor(now/ROUND_MS);}
function timing(n){const starts_ms=n*ROUND_MS;return {starts_ms,bet_closes_ms:starts_ms+BET_MS,
  settles_ms:starts_ms+BET_MS+SPIN_MS,ends_ms:starts_ms+ROUND_MS};}
async function ensureRound(db,n){
  const id='greedy:'+n;
  let row=await db.prepare('SELECT * FROM sharika_greedy_rounds WHERE id=?').bind(id).first();
  if(row)return row;
  const seed=hex(crypto.getRandomValues(new Uint8Array(32)));
  const t=timing(n),commit=await sha(seed);
  await db.prepare('INSERT OR IGNORE INTO sharika_greedy_rounds '+
    '(id,round_no,starts_ms,bet_closes_ms,settles_ms,ends_ms,seed_hex,commit_sha256) '+
    'VALUES(?,?,?,?,?,?,?,?)').bind(id,n,t.starts_ms,t.bet_closes_ms,t.settles_ms,
    t.ends_ms,seed,commit).run();
  row=await db.prepare('SELECT * FROM sharika_greedy_rounds WHERE id=?').bind(id).first();
  if(!row)throw Error('greedy_round_unavailable');
  return row;
}
export async function greedyOutcome(round){
  const bytes=await digest(round.seed_hex+'|'+round.round_no);
  const value=(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)).getUint32(0);
  let choice=value%WEIGHTS.reduce((a,b)=>a+b,0);
  for(let i=0;i<WEIGHTS.length;i++)if((choice-=WEIGHTS[i])<0)return OUTCOMES[i];
  return 'tomato';
}
export function greedyPayout(item,amount,result){
  const i=ITEMS.indexOf(item);
  if(i<0)return 0;
  const wins=result===item||(result==='salad'&&i>=4)||(result==='pizza'&&i<=3);
  return wins?amount*MULT[i]:0;
}
async function wallet(db,uid){return db.prepare('SELECT coins,minor,status,name,pic,public_no FROM sharika_users WHERE auth_uid=?').bind(uid).first();}

// SQL conditional updates + one-time payout triggers handle concurrent callers.
export async function settleGreedyDueBets(db,now=Date.now()){
  const pending=(await db.prepare(
    "SELECT b.id,b.item_id,b.amount,r.seed_hex,r.round_no FROM sharika_greedy_bets b "+
    "JOIN sharika_greedy_rounds r ON r.id=b.round_id WHERE b.status='accepted' "+
    'AND r.settles_ms<=? ORDER BY b.id LIMIT 40').bind(now).all()).results||[];
  const outcomes=new Map();
  for(const bet of pending){
    let result=outcomes.get(bet.round_no);
    if(!result){result=await greedyOutcome(bet);outcomes.set(bet.round_no,result);}
    await db.prepare("UPDATE sharika_greedy_bets SET status='settled',payout=?,result_id=?,"+
      "settled_at=datetime('now') WHERE id=? AND status='accepted'")
      .bind(greedyPayout(bet.item_id,bet.amount,result),result,bet.id).run();
  }
  return pending.length;
}

async function roundAmounts(db,roundId,uid){
  const rows=(await db.prepare('SELECT item_id,user_uid,amount,payout,status FROM sharika_greedy_bets WHERE round_id=?')
    .bind(roundId).all()).results||[];
  const myBets=ITEMS.map(item=>rows.filter(b=>b.user_uid===uid&&b.item_id===item)
    .reduce((n,b)=>n+b.amount,0));
  const totals=ITEMS.map(item=>rows.filter(b=>b.item_id===item).reduce((n,b)=>n+b.amount,0));
  const mine=rows.filter(b=>b.user_uid===uid);
  return {myBets,totals,online:new Set(rows.map(b=>b.user_uid)).size,
    myBet:mine.reduce((n,b)=>n+b.amount,0),myWin:mine.reduce((n,b)=>n+b.payout,0)};
}
async function recentHistory(db,now){
  const rows=(await db.prepare('SELECT * FROM sharika_greedy_rounds WHERE settles_ms<=? '+
    'ORDER BY round_no DESC LIMIT 20').bind(now).all()).results||[];
  const history=[];
  for(const row of rows)history.push({round:row.round_no,itemId:await greedyOutcome(row)});
  return history;
}
async function topWinners(db,roundId){
  const rows=(await db.prepare('SELECT u.auth_uid,u.public_no,u.name,u.pic,SUM(b.payout) AS win '+
    'FROM sharika_greedy_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid '+
    "WHERE b.round_id=? AND b.status='settled' AND b.payout>0 "+
    'GROUP BY b.user_uid ORDER BY win DESC,u.public_no LIMIT 3').bind(roundId).all()).results||[];
  return rows.map(row=>({userId:String(row.public_no).padStart(8,'0'),name:row.name,
    avatar:row.pic||'',win:row.win}));
}
async function records(db,uid){
  const rows=(await db.prepare('SELECT b.round_no AS round,b.result_id AS itemId, '+
    'SUM(b.amount) AS bet,SUM(b.payout) AS win '+
    'FROM sharika_greedy_bets b WHERE b.user_uid=? AND b.status=\'settled\' '+
    'GROUP BY b.round_no,b.result_id ORDER BY b.round_no DESC LIMIT 50').bind(uid).all()).results||[];
  return {list:rows};
}
async function currentState(db,uid){
  const now=Date.now();
  await settleGreedyDueBets(db,now);
  const row=await ensureRound(db,roundNumber(now));
  const user=await wallet(db,uid),amounts=await roundAmounts(db,row.id,uid);
  const phase=now<row.bet_closes_ms?'betting':now<row.settles_ms?'spinning':'result';
  const state={round:row.round_no,phase,
    endsAt:phase==='betting'?row.bet_closes_ms:phase==='spinning'?row.settles_ms:row.ends_ms,
    totals:amounts.totals,online:amounts.online};
  const response={serverTime:now,balance:user.coins,
    user:{id:String(user.public_no).padStart(8,'0'),name:user.name,avatar:user.pic||''},
    config:{chips:CHIPS,maxBetPerRound:MAX_ROUND_STAKE},
    state,myBets:amounts.myBets,history:await recentHistory(db,now)};
  if(phase!=='betting')state.resultId=await greedyOutcome(row);
  if(phase==='result'){
    response.result={round:row.round_no,resultId:state.resultId,endsAt:row.ends_ms,
      seed:row.seed_hex,hash:row.commit_sha256,
      you:{bet:amounts.myBet,win:amounts.myWin,balance:user.coins},
      top:await topWinners(db,row.id)};
  }
  return response;
}

export async function handleGreedyRequest({request,db,uid,action,reply,fail,cors}){
  if(!['state','bet','records'].includes(action))return fail('greedy_route_not_found',404,cors);
  const user=await wallet(db,uid);
  if(!user||user.status!=='active')return fail('profile_unavailable',403,cors);
  if(user.minor)return fail('games_adult_only',403,cors);
  if(action==='state'&&request.method==='GET')return reply(await currentState(db,uid),200,cors);
  if(action==='records'&&request.method==='GET'){
    await settleGreedyDueBets(db);
    return reply(await records(db,uid),200,cors);
  }
  if(action!=='bet'||request.method!=='POST')return fail('method_not_allowed',405,cors);
  let b;try{b=await request.json();}catch{return fail('invalid_json',400,cors);}
  if(!b||typeof b!=='object'||Array.isArray(b)||
    !Number.isSafeInteger(b.round)||b.round<0||!ITEMS.includes(b.itemId)||
    !Number.isSafeInteger(b.amount)||b.amount<1||b.amount>MAX_BET||
    !REQUEST_ID.test(b.request_id||''))return fail('invalid_bet',400,cors);
  let prior=await db.prepare('SELECT * FROM sharika_greedy_bets WHERE user_uid=? AND request_id=?')
    .bind(uid,b.request_id).first();
  if(prior){
    if(prior.round_no!==b.round||prior.item_id!==b.itemId||prior.amount!==b.amount)
      return fail('idempotency_conflict',409,cors);
  }else{
    const now=Date.now(),n=roundNumber(now),t=timing(n);
    if(n!==b.round||now>=t.bet_closes_ms)return fail('BETTING_CLOSED',409,cors);
    const round=await ensureRound(db,n);
    try{
      await db.prepare('INSERT INTO sharika_greedy_bets '+
        '(round_id,round_no,user_uid,item_id,amount,request_id) VALUES(?,?,?,?,?,?)')
        .bind(round.id,n,uid,b.itemId,b.amount,b.request_id).run();
    }catch(e){
      prior=await db.prepare('SELECT * FROM sharika_greedy_bets WHERE user_uid=? AND request_id=?')
        .bind(uid,b.request_id).first();
      if(!prior){
        const error=String(e?.message||e);
        if(error.includes('insufficient'))return fail('INSUFFICIENT_BALANCE',409,cors);
        if(error.includes('closed'))return fail('BETTING_CLOSED',409,cors);
        if(error.includes('round_limit'))return fail('MAX_BET',409,cors);
        if(error.includes('ineligible'))return fail('games_adult_only',403,cors);
        throw e;
      }
      if(prior.round_no!==b.round||prior.item_id!==b.itemId||prior.amount!==b.amount)
        return fail('idempotency_conflict',409,cors);
    }
  }
  const row=await db.prepare('SELECT id FROM sharika_greedy_rounds WHERE round_no=?').bind(b.round).first();
  const amounts=await roundAmounts(db,row.id,uid);
  return reply({round:b.round,itemId:b.itemId,amount:b.amount,
    balance:(await wallet(db,uid)).coins,myBets:amounts.myBets,
    totals:amounts.totals,online:amounts.online,duplicate:!!prior},200,cors);
}
