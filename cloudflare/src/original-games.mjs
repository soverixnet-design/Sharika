// Three original Sharika games, with *server-owned* virtual coin balances.
// The uploaded HTML's localStorage balances, bots and random payouts are never used.
// Round seed is committed in D1 before bets; clients see it only after the round ends.
const GAMES={
  'sovera-food':{name:'Sovera Food Wheel',symbols:['🍗','🐟','🌭','🥩','🍇','🥬','🫑','🍉'],mult:[45,25,15,10,5,5,5,5],chips:[50,500,2000,10000]},
  'night-food':{name:'Night Food Wheel',symbols:['🌭','🍢','🍗','🥩','🥕','🌽','🥬','🍅'],mult:[10,15,25,45,5,5,5,5,1.2,4],chips:[1000,10000,100000,1000000,10000000]},
  'jackpot-fruit':{name:'Jackpot Fruit',symbols:['🍋','🍇','🥝','🍑','🍓','🍌','🍉','🍒'],mult:[5,5,5,5,10,10,20,40],chips:[1000,10000,100000,1000000,10000000]}
};
export const ORIGINAL_ROUND_MS=40000;
const BET_MS=28000,MAX_STAKE=100000000,ID=/^[A-Za-z0-9:_-]{12,80}$/;
const VALID_ACTIONS=new Set(['state','bet','history','stats','rankings']);
function hex(bytes){return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function sha(s){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
function failText(e){return String(e?.message||e||'unknown_error');}
function roundNo(now){return Math.floor(now/ORIGINAL_ROUND_MS);}
function clock(n){return {round_no:n,starts_ms:n*ORIGINAL_ROUND_MS,bet_closes_ms:n*ORIGINAL_ROUND_MS+BET_MS,closes_ms:(n+1)*ORIGINAL_ROUND_MS};}
async function ensureRound(db,game,n){
  const existing=await db.prepare('SELECT * FROM sharika_original_game_rounds WHERE game=? AND round_no=?').bind(game,n).first();
  if(existing)return existing;
  const seed=hex(crypto.getRandomValues(new Uint8Array(32))),commit=await sha(seed),t=clock(n);
  await db.prepare('INSERT OR IGNORE INTO sharika_original_game_rounds(id,game,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) VALUES(?,?,?,?,?,?,?,?)')
    .bind(game+':'+n,game,n,t.starts_ms,t.bet_closes_ms,t.closes_ms,seed,commit).run();
  return db.prepare('SELECT * FROM sharika_original_game_rounds WHERE game=? AND round_no=?').bind(game,n).first();
}
async function indexFrom(seed,suffix,game){
  const h=await sha(seed+'|'+suffix);
  const v=parseInt(h.slice(0,8),16);
  const weights=GAMES[game].mult.slice(0,8).map(m=>Math.round(3600/m));
  let r=v%weights.reduce((a,b)=>a+b,0);
  for(let i=0;i<weights.length;i++)if((r-=weights[i])<0)return i;
  return 7;
}
export async function originalOutcome(row){
  const {game,seed_hex:seed}=row;
  const result=await indexFrom(seed,'result',game);
  const positions=[result],roll=parseInt((await sha(seed+'|bonus')).slice(0,8),16)%1000;
  let bonus='';
  if(game==='jackpot-fruit'){
    bonus=roll<900?'':roll<940?'+1':roll<960?'+2':roll<985?'x2':roll<995?'x3':'JP';
    if(bonus==='+1'||bonus==='+2')positions.push(await indexFrom(seed,'extra1',game));
    if(bonus==='+2')positions.push(await indexFrom(seed,'extra2',game));
  }
  return {index:result,positions,bonus,seed_hex:seed,commit_sha256:row.commit_sha256,
    symbols:positions.map(i=>GAMES[game].symbols[i])};
}
export function originalPayout(bet,answer,budget,total){
  const g=GAMES[bet.game];
  let base=0;
  for(const idx of answer.positions){
    if(bet.pick_index===idx)base+=bet.amount*g.mult[idx];
    if(bet.game==='night-food'&&bet.pick_index===8&&idx>=4)base+=bet.amount*1.2;
    if(bet.game==='night-food'&&bet.pick_index===9&&idx<4)base+=bet.amount*4;
  }
  if(answer.bonus==='x2')base*=2;
  if(answer.bonus==='x3')base*=3;
  if(answer.bonus==='JP'&&total>0)base+=Math.floor(budget*(bet.amount/total));
  return Math.floor(base);
}
async function jackpotBudget(db,row,answer){
  if(row.game!=='jackpot-fruit'||answer.bonus!=='JP')return {budget:0,total:0};
  const total=await db.prepare('SELECT SUM(amount) AS n FROM sharika_original_game_bets WHERE round_id=?')
    .bind(row.id).first();
  if(!Number(total?.n))return {budget:0,total:0};
  const pool=await db.prepare("SELECT coins FROM sharika_original_game_pools WHERE game='jackpot-fruit'").first();
  // Reserved once, atomically deducted by the migration trigger. All wagers in
  // the same round share this one budget. This is NOT a minted demo jackpot.
  await db.prepare('INSERT OR IGNORE INTO sharika_original_jackpot_budgets(round_id,budget,total_stake) VALUES(?,?,?)')
    .bind(row.id,Math.floor(Number(pool?.coins||0)/2),Number(total.n)).run();
  const saved=await db.prepare('SELECT budget,total_stake AS total FROM sharika_original_jackpot_budgets WHERE round_id=?')
    .bind(row.id).first();
  return saved||{budget:0,total:0};
}
export async function settleOriginalDueBets(db){
  const rows=await db.prepare(
    "SELECT b.*,r.seed_hex,r.commit_sha256,r.closes_ms FROM sharika_original_game_bets b "+
    "JOIN sharika_original_game_rounds r ON r.id=b.round_id "+
    "WHERE b.status='accepted' AND r.closes_ms<=? ORDER BY r.closes_ms,b.id LIMIT 120")
    .bind(Date.now()).all();
  const cache=new Map();
  let count=0;
  for(const b of rows.results||[]){
    let item=cache.get(b.round_id);
    if(!item){
      const row={id:b.round_id,game:b.game,seed_hex:b.seed_hex,commit_sha256:b.commit_sha256};
      const answer=await originalOutcome(row);
      const jp=await jackpotBudget(db,row,answer);
      item={answer,jp};cache.set(b.round_id,item);
    }
    const payout=originalPayout(b,item.answer,Number(item.jp.budget||0),Number(item.jp.total||0));
    // A conditional update + D1 AFTER UPDATE trigger performs payout and one
    // immutable ledger entry. A duplicate settle never credits twice.
    await db.prepare("UPDATE sharika_original_game_bets SET status='settled',payout=?,result_json=?,settled_at=datetime('now') "+
      "WHERE id=? AND status='accepted'")
      .bind(payout,JSON.stringify({positions:item.answer.positions,bonus:item.answer.bonus}),b.id).run();
    count++;
  }
  return count;
}
async function userCoins(db,uid){
  const user=await db.prepare('SELECT coins,minor,status FROM sharika_users WHERE auth_uid=?').bind(uid).first();
  return user||null;
}
async function currentState(db,uid,game){
  await settleOriginalDueBets(db);
  const now=Date.now(),n=roundNo(now),r=await ensureRound(db,game,n),t=clock(n);
  const bets=await db.prepare(
    'SELECT id,round_no,pick_index,amount,status,payout,result_json,created_at FROM sharika_original_game_bets '+
    'WHERE user_uid=? AND game=? AND round_no>=? ORDER BY id DESC LIMIT 100')
    .bind(uid,game,n-1).all();
  const prev=await db.prepare('SELECT * FROM sharika_original_game_rounds WHERE game=? AND closes_ms<=? ORDER BY round_no DESC LIMIT 1')
    .bind(game,now).first();
  let previous=null;
  if(prev){
    // Real winners only. Never manufacture leaderboard names or balances.
    const winners=await db.prepare(
      "SELECT u.public_no,u.name,u.pic,SUM(b.payout) AS total_win FROM sharika_original_game_bets b "+
      "JOIN sharika_users u ON u.auth_uid=b.user_uid WHERE b.round_id=? "+
      "AND b.status='settled' AND b.payout>0 GROUP BY b.user_uid "+
      "ORDER BY total_win DESC,u.public_no LIMIT 3").bind(prev.id).all();
    previous={round_no:prev.round_no,...await originalOutcome(prev),
      top_winners:(winners.results||[]).map(u=>({
        public_id:String(u.public_no).padStart(8,'0'),name:u.name,pic:u.pic,total_win:u.total_win
      }))};
  }
  const wallet=await userCoins(db,uid);
  const pool=game==='jackpot-fruit'
    ?await db.prepare("SELECT coins FROM sharika_original_game_pools WHERE game='jackpot-fruit'").first():null;
  const myBets=(bets.results||[]).map(b=>({...b,result:b.result_json?JSON.parse(b.result_json):null,result_json:undefined}));
  const today=await stats(db,uid,game);
  return {game,name:GAMES[game].name,virtual_coins_only:true,
    server_time:now,round:{round_no:n,starts_ms:t.starts_ms,bet_closes_ms:t.bet_closes_ms,
      closes_ms:t.closes_ms,commit_sha256:r.commit_sha256,phase:now<t.bet_closes_ms?'bet':'spin'},
    symbols:GAMES[game].symbols,multipliers:GAMES[game].mult,
    chips:GAMES[game].chips,coins:wallet?.coins??0,my_bets:myBets,previous_result:previous,
    today_won:today.won,today_wagered:today.wagered,
    jackpot_pool:pool?.coins??0};
}
async function history(db,game){
  const now=Date.now();
  const rows=await db.prepare('SELECT * FROM sharika_original_game_rounds WHERE game=? AND closes_ms<=? ORDER BY round_no DESC LIMIT 30')
    .bind(game,now).all();
  const results=[];
  for(const row of rows.results||[])results.push({round_no:row.round_no,...await originalOutcome(row)});
  return results;
}
async function stats(db,uid,game){
  const date=new Date().toISOString().slice(0,10);
  const r=await db.prepare("SELECT COUNT(*) AS bets,COALESCE(SUM(amount),0) AS wagered,"+
    "COALESCE(SUM(CASE WHEN status='settled' THEN payout ELSE 0 END),0) AS won "+
    "FROM sharika_original_game_bets WHERE user_uid=? AND game=? AND created_at>=?")
    .bind(uid,game,date).first();
  return {today_utc:date,bets:r?.bets||0,wagered:r?.wagered||0,won:r?.won||0,
    net:(r?.won||0)-(r?.wagered||0)};
}
async function ranking(db,game,period){
  const when=period==='monthly'?"datetime('now','start of month')":
    period==='weekly'?"datetime('now','-7 days')":"datetime('now','start of day')";
  const rows=await db.prepare('SELECT u.public_no,u.name,COUNT(*) AS bets,SUM(b.payout) AS total_win FROM sharika_original_game_bets b '+
    'JOIN sharika_users u ON u.auth_uid=b.user_uid WHERE b.game=? AND b.status=\'settled\' AND b.settled_at>='+when+
    ' GROUP BY b.user_uid ORDER BY total_win DESC,u.public_no LIMIT 20').bind(game).all();
  return (rows.results||[]).map(u=>({...u,public_id:String(u.public_no).padStart(8,'0'),public_no:undefined}));
}
export async function handleOriginalGameRequest({request,db,uid,game,action,reply,fail,cors}){
  if(!GAMES[game]||!VALID_ACTIONS.has(action))return fail('original_game_not_found',404,cors);
  if(action==='state'&&request.method==='GET')
    return reply(await currentState(db,uid,game),200,cors);
  if(action==='history'&&request.method==='GET')
    return reply({game,rounds:await history(db,game)},200,cors);
  if(action==='stats'&&request.method==='GET'){
    await settleOriginalDueBets(db);
    return reply({game,...await stats(db,uid,game)},200,cors);
  }
  if(action==='rankings'&&request.method==='GET'){
    const period=new URL(request.url).searchParams.get('period')||'daily';
    if(!['daily','weekly','monthly'].includes(period))return fail('invalid_period',400,cors);
    await settleOriginalDueBets(db);
    return reply({game,period,rankings:await ranking(db,game,period)},200,cors);
  }
  if(action==='bet'&&request.method==='POST'){
    const wallet=await userCoins(db,uid);
    if(!wallet||wallet.status!=='active')return fail('profile_required',403,cors);
    if(wallet.minor)return fail('game_adult_only',403,cors);
    let b;try{b=await request.json();}catch{return fail('invalid_json',400,cors);}
    if(!b||typeof b!=='object'||Array.isArray(b)||
      !Number.isSafeInteger(b.round_no)||b.round_no<0||
      !Number.isSafeInteger(b.pick)||b.pick<0||b.pick>(game==='night-food'?9:7)||
      !Number.isSafeInteger(b.amount)||b.amount<1||b.amount>MAX_STAKE||
      !ID.test(b.request_id||''))return fail('invalid_bet',400,cors);
    // Network retries must be idempotent even if the accepted round has
    // already closed. Look up the original request before checking the clock.
    const prior=await db.prepare('SELECT * FROM sharika_original_game_bets WHERE user_uid=? AND request_id=?')
      .bind(uid,b.request_id).first();
    if(prior){
      if(prior.game!==game||prior.round_no!==b.round_no||
         prior.pick_index!==b.pick||prior.amount!==b.amount)
        return fail('idempotency_conflict',409,cors);
      return reply({bet_id:prior.id,duplicate:true,coins:(await userCoins(db,uid)).coins,
        round_no:prior.round_no},200,cors);
    }
    const n=roundNo(Date.now()),t=clock(n);
    if(b.round_no!==n||Date.now()>=t.bet_closes_ms)
      return fail('betting_closed',409,cors);
    const round=await ensureRound(db,game,n);
    try{
      await db.prepare('INSERT INTO sharika_original_game_bets(game,round_no,round_id,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?,?)')
        .bind(game,n,round.id,uid,b.pick,b.amount,b.request_id).run();
    }catch(e){
      const detail=failText(e);
      const collision=await db.prepare('SELECT * FROM sharika_original_game_bets WHERE user_uid=? AND request_id=?').bind(uid,b.request_id).first();
      if(collision){
        if(collision.game!==game||collision.round_no!==n||collision.pick_index!==b.pick||collision.amount!==b.amount)
          return fail('idempotency_conflict',409,cors);
        return reply({bet_id:collision.id,duplicate:true,coins:(await userCoins(db,uid)).coins,round_no:n},200,cors);
      }
      if(detail.includes('insufficient')||detail.includes('CHECK constraint'))return fail('insufficient_coins',409,cors);
      if(detail.includes('closed'))return fail('betting_closed',409,cors);
      if(detail.includes('ineligible'))return fail('game_adult_only',403,cors);
      throw e;
    }
    const bet=await db.prepare('SELECT id FROM sharika_original_game_bets WHERE user_uid=? AND request_id=?')
      .bind(uid,b.request_id).first();
    return reply({bet_id:bet.id,duplicate:false,coins:(await userCoins(db,uid)).coins,
      round_no:n,pick:b.pick,amount:b.amount},201,cors);
  }
  return fail('method_not_allowed',405,cors);
}
