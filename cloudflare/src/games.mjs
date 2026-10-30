// Sharika isolated D1 virtual-coin games. Never enable on a cash-out wallet.
// All players share UTC 40s rounds. Round entropy is committed before bets,
// and the seed is revealed only after the round closes.
const TYPES = {
  'food-wheel': {symbols:['🍅','🦐','🐟','🍗','🥩','🍕','🥬','🥕','🌽'],multiplier:9},
  'jackpot-fruit': {symbols:['🍒','🍋','🍇','🍉','🍓','🍊'],multiplier:36}
};
const ROUND_MS=40000, BETTING_MS=28000;
const REQUEST_ID=/^[A-Za-z0-9:_-]{12,80}$/;
const MAX_STAKE=Math.floor(Number.MAX_SAFE_INTEGER/36);

function hex(bytes){return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function digest(value){
  return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
}
async function digestHex(value){return hex(await digest(value));}
async function draw(seed,game,roundNo,count,options){
  const choices=[],max=Math.floor(256/options)*options;
  for(let counter=0;choices.length<count;counter++){
    const bytes=await digest(seed+'|'+game+'|'+roundNo+'|outcome|'+counter);
    for(const b of bytes){
      if(b<max)choices.push(b%options);
      if(choices.length===count)break;
    }
  }
  return choices;
}
export async function roundResult(row){
  const spec=TYPES[row.game];
  const numbers=await draw(row.seed_hex,row.game,row.round_no,
    row.game==='food-wheel'?1:3,spec.symbols.length);
  if(row.game==='food-wheel'){
    return {sector:numbers[0],symbol:spec.symbols[numbers[0]],multiplier:spec.multiplier};
  }
  const jackpot=numbers.every(x=>x===numbers[0]);
  return {reels:numbers.map(x=>spec.symbols[x]),reel_indices:numbers,
    jackpot,multiplier:jackpot?spec.multiplier:0};
}
function publicRound(row){
  return {id:row.id,round_no:row.round_no,starts_ms:row.starts_ms,
    bet_closes_ms:row.bet_closes_ms,closes_ms:row.closes_ms,
    commit_sha256:row.commit_sha256};
}
async function ensureRound(db,game,now){
  const number=Math.floor(now/ROUND_MS),id=game+':'+number;
  let round=await db.prepare('SELECT * FROM sharika_game_rounds WHERE id=?')
    .bind(id).first();
  if(round)return round;
  const seed=hex(crypto.getRandomValues(new Uint8Array(32)));
  const commit=await digestHex(seed+'|'+game+'|'+number);
  const start=number*ROUND_MS;
  await db.prepare('INSERT OR IGNORE INTO sharika_game_rounds '+
    '(id,game,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256) '+
    'VALUES(?,?,?,?,?,?,?,?)')
    .bind(id,game,number,start,start+BETTING_MS,start+ROUND_MS,seed,commit).run();
  round=await db.prepare('SELECT * FROM sharika_game_rounds WHERE id=?').bind(id).first();
  if(!round)throw Error('game_round_unavailable');
  return round;
}
function safeBet(row){
  if(!row)return null;
  return {id:row.id,round_no:row.round_no,stake:row.stake,pick:row.pick_index,
    status:row.status,payout:row.payout,created_at:row.created_at,
    result:row.result_json?JSON.parse(row.result_json):null};
}
export async function settleDueBets(db,uid,now=Date.now()){
  const pending=(await db.prepare(
    "SELECT b.id,b.game,b.round_no,b.pick_index,b.stake,r.seed_hex "+
    "FROM sharika_game_bets b JOIN sharika_game_rounds r ON r.id=b.round_id "+
    "WHERE b.user_uid=? AND b.status='accepted' AND r.closes_ms<=? "+
    'ORDER BY b.id LIMIT 50'
  ).bind(uid,now).all()).results||[];
  let resolved=0;
  for(const bet of pending){
    const result=await roundResult(bet);
    const win=bet.game==='food-wheel'
      ? bet.pick_index===result.sector : result.jackpot;
    const payout=win?bet.stake*TYPES[bet.game].multiplier:0;
    const updated=await db.prepare(
      "UPDATE sharika_game_bets SET status='settled',payout=?,result_json=?,settled_at=datetime('now') "+
      "WHERE id=? AND user_uid=? AND status='accepted'"
    ).bind(payout,JSON.stringify(result),bet.id,uid).run();
    if(updated.meta?.changes===1)resolved++;
  }
  return resolved;
}
// Credits expired game bets even when their owners have not reopened the app.
// A small per-request cap bounds Worker work; the storage trigger guarantees
// every winning bet is credited at most once across concurrent requests.
export async function settleAllDueBets(db,now=Date.now()){
  const pending=(await db.prepare(
    "SELECT b.id,b.user_uid,b.game,b.round_no,b.pick_index,b.stake,r.seed_hex "+
    "FROM sharika_game_bets b JOIN sharika_game_rounds r ON r.id=b.round_id "+
    "WHERE b.status='accepted' AND r.closes_ms<=? ORDER BY b.id LIMIT 25"
  ).bind(now).all()).results||[];
  let resolved=0;
  for(const bet of pending){
    const result=await roundResult(bet);
    const won=bet.game==='food-wheel'
      ? bet.pick_index===result.sector : result.jackpot;
    const payout=won?bet.stake*TYPES[bet.game].multiplier:0;
    const updated=await db.prepare(
      "UPDATE sharika_game_bets SET status='settled',payout=?,result_json=?,settled_at=datetime('now') "+
      "WHERE id=? AND user_uid=? AND status='accepted'"
    ).bind(payout,JSON.stringify(result),bet.id,bet.user_uid).run();
    if(updated.meta?.changes===1)resolved++;
  }
  return resolved;
}

export function periodStartUtc(period,now=Date.now()){
  if(!['daily','weekly','monthly'].includes(period))return null;
  const d=new Date(now);
  d.setUTCHours(0,0,0,0);
  if(period==='weekly')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  if(period==='monthly')d.setUTCDate(1);
  return d.toISOString().slice(0,19).replace('T',' ');
}

// Top finishers are derived from the seed-confirmed result, never from fake
// client animations or whether a user's wallet was queried after round end.
async function roundWinners(db,round){
  if(!round)return [];
  const result=round.outcome;
  if(round.game==='jackpot-fruit'&&!result.jackpot)return [];
  const extra=round.game==='food-wheel'?' AND b.pick_index=?':'';
  const args=[round.game,round.round_no];
  if(round.game==='food-wheel')args.push(result.sector);
  const winners=(await db.prepare(
    'SELECT u.public_no,u.name,b.stake FROM sharika_game_bets b '+
    'JOIN sharika_users u ON u.auth_uid=b.user_uid '+
    'WHERE b.game=? AND b.round_no=?'+extra+
    ' ORDER BY b.stake DESC,b.id ASC LIMIT 3'
  ).bind(...args).all()).results||[];
  return winners.map((r,i)=>({rank:i+1,user_id:r.public_no,name:r.name,
    payout:r.stake*TYPES[round.game].multiplier}));
}

async function finishedRound(db,game,roundNo,now){
  const row=await db.prepare('SELECT * FROM sharika_game_rounds WHERE game=? AND round_no=?')
    .bind(game,roundNo).first();
  if(!row||now<row.closes_ms)return null;
  return {...publicRound(row),seed_hex:row.seed_hex,outcome:await roundResult(row)};
}
export async function handleGameRequest({request,db,uid,game,action,reply,fail,cors}){
  const spec=TYPES[game];if(!spec)return fail('game_not_found',404,cors);
  const now=Date.now();
  // All game endpoints are for verified active adult user profiles only.
  const user=await db.prepare('SELECT coins,minor,status FROM sharika_users WHERE auth_uid=?')
    .bind(uid).first();
  if(!user||user.status!=='active')return fail('profile_unavailable',403,cors);
  if(user.minor)return fail('games_adult_only',403,cors);
  await settleDueBets(db,uid,now);
  await settleAllDueBets(db,now);
  if(action==='history'&&request.method==='GET'){
    const rows=(await db.prepare(
      'SELECT id,round_no,stake,pick_index,status,payout,result_json,created_at '+
      'FROM sharika_game_bets WHERE user_uid=? AND game=? ORDER BY id DESC LIMIT 30'
    ).bind(uid,game).all()).results||[];
    return reply({game,history:rows.map(safeBet)},200,cors);
  }
  if(action==='stats'&&request.method==='GET'){
    const from=periodStartUtc('daily',now);
    const totals=await db.prepare(
      "SELECT COUNT(*) AS plays, COALESCE(SUM(stake),0) AS staked, "+
      "COALESCE(SUM(payout),0) AS won, "+
      "COALESCE(SUM(CASE WHEN payout>0 THEN 1 ELSE 0 END),0) AS wins "+
      "FROM sharika_game_bets WHERE game=? AND user_uid=? "+
      "AND status='settled' AND settled_at>=?"
    ).bind(game,uid,from).first();
    return reply({game,period:'daily',since_utc:from,timezone:'UTC',
      plays:totals?.plays||0,wins:totals?.wins||0,
      total_won:totals?.won||0,total_staked:totals?.staked||0,
      net_coins:(totals?.won||0)-(totals?.staked||0)},200,cors);
  }
  if(action==='rankings'&&request.method==='GET'){
    const period=new URL(request.url).searchParams.get('period')||'daily';
    const from=periodStartUtc(period,now);
    if(!from)return fail('invalid_ranking_period',400,cors);
    const rows=(await db.prepare(
      "SELECT u.public_no,u.name,COUNT(*) AS plays, "+
      "COALESCE(SUM(b.payout),0) AS total_won, "+
      "COALESCE(SUM(b.stake),0) AS total_staked, "+
      "COALESCE(SUM(CASE WHEN b.payout>0 THEN 1 ELSE 0 END),0) AS wins "+
      "FROM sharika_game_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid "+
      "WHERE b.game=? AND b.status='settled' AND b.settled_at>=? "+
      "GROUP BY b.user_uid HAVING SUM(b.payout)>0 "+
      "ORDER BY total_won DESC,wins DESC,u.public_no ASC LIMIT 20"
    ).bind(game,from).all()).results||[];
    return reply({game,period,since_utc:from,timezone:'UTC',
      ranking:rows.map((r,i)=>({rank:i+1,user_id:r.public_no,name:r.name,
        plays:r.plays,wins:r.wins,total_won:r.total_won,
        total_staked:r.total_staked}))},200,cors);
  }
  if(action==='rounds'&&request.method==='GET'){
    const rows=(await db.prepare(
      'SELECT * FROM sharika_game_rounds WHERE game=? AND closes_ms<=? '+
      'ORDER BY round_no DESC LIMIT 30'
    ).bind(game,now).all()).results||[];
    const rounds=[];
    for(const row of rows){
      const item={...publicRound(row),seed_hex:row.seed_hex,
        outcome:await roundResult(row)};
      rounds.push({...item,top_three:await roundWinners(db,{...item,game})});
    }
    return reply({game,rounds,timezone:'UTC'},200,cors);
  }
  if(action!=='state'&&action!=='bet')return fail('game_route_not_found',404,cors);
  const round=await ensureRound(db,game,now);
  if(action==='state'&&request.method==='GET'){
    const [own,previous,previousBet]=await Promise.all([
      db.prepare('SELECT * FROM sharika_game_bets WHERE user_uid=? AND round_id=?')
        .bind(uid,round.id).first(),
      finishedRound(db,game,round.round_no-1,now),
      db.prepare('SELECT * FROM sharika_game_bets WHERE user_uid=? AND game=? AND round_no=?')
        .bind(uid,game,round.round_no-1).first()
    ]);
    const current=await db.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').bind(uid).first();
    const previousWinners=await roundWinners(db,previous?{...previous,game}:null);
    return reply({game,round:publicRound(round),phase:now<round.bet_closes_ms?'betting':'waiting',
      server_time:now,symbols:spec.symbols,payout_multiplier:spec.multiplier,
      rules:game==='food-wheel'?'Pick one of 9 equal sectors; winning pick pays 9x the stake.':
        'Three matching fruits pay 36x the stake; all other results pay zero.',
      one_bet_per_round:true,coins:current?.coins||0,
      my_bet:safeBet(own),previous_result:previous,
      previous_winners:previousWinners,previous_bet:safeBet(previousBet),
      virtual_coins_only:true},200,cors);
  }
  if(action==='bet'&&request.method==='POST'){
    let input;try{
      const raw=await request.text();
      if(raw.length>1024)return fail('invalid_game_bet',400,cors);
      input=JSON.parse(raw);
    }catch(_){return fail('invalid_game_bet',400,cors);}
    const stake=input?.stake,pick=input?.pick,requestId=input?.request_id,roundNo=input?.round_no;
    if(!Number.isSafeInteger(stake)||stake<1||stake>MAX_STAKE||
       !Number.isSafeInteger(roundNo)||roundNo<0||
       typeof requestId!=='string'||!REQUEST_ID.test(requestId)||
       (game==='food-wheel'&&(!Number.isInteger(pick)||pick<0||pick>=spec.symbols.length))||
       (game==='jackpot-fruit'&&pick!==undefined&&pick!==null))
      return fail('invalid_game_bet',400,cors);
    // A closed round must not hide a previously accepted request from a
    // client retry. The unique request ID is scoped to the verified user.
    const existing=await db.prepare('SELECT * FROM sharika_game_bets WHERE user_uid=? AND request_id=?')
      .bind(uid,requestId).first();
    if(existing){
      if(existing.game!==game||existing.round_no!==roundNo||
         existing.stake!==stake||
         existing.pick_index!==(game==='food-wheel'?pick:null))
        return fail('idempotency_conflict',409,cors);
      return reply({bet:safeBet(existing),duplicate:true},200,cors);
    }
    if(roundNo!==round.round_no||Date.now()>=round.bet_closes_ms)
      return fail('betting_closed',409,cors);
    if(user.coins<stake)return fail('insufficient_coins',409,cors);
    try{
      await db.prepare('INSERT INTO sharika_game_bets '+
        '(game,round_no,round_id,user_uid,stake,pick_index,request_id) '+
        'VALUES(?,?,?,?,?,?,?)')
        .bind(game,round.round_no,round.id,uid,stake,
          game==='food-wheel'?pick:null,requestId).run();
    }catch(e){
      if(/insufficient|ineligible/i.test(e.message||''))return fail('insufficient_coins',409,cors);
      if(/UNIQUE|constraint/i.test(e.message||'')){
        // Another identical request may have won the INSERT race. The UNIQUE
        // constraint already prevents a second debit; confirm it was identical.
        const collision=await db.prepare('SELECT * FROM sharika_game_bets WHERE user_uid=? AND request_id=?')
          .bind(uid,requestId).first();
        if(collision){
          if(collision.game!==game||collision.round_no!==roundNo||
             collision.stake!==stake||
             collision.pick_index!==(game==='food-wheel'?pick:null))
            return fail('idempotency_conflict',409,cors);
          return reply({bet:safeBet(collision),duplicate:true},200,cors);
        }
        return fail('bet_already_placed',409,cors);
      }
      throw e;
    }
    const saved=await db.prepare('SELECT * FROM sharika_game_bets WHERE user_uid=? AND request_id=?')
      .bind(uid,requestId).first();
    const wallet=await db.prepare('SELECT coins FROM sharika_users WHERE auth_uid=?').bind(uid).first();
    return reply({bet:safeBet(saved),coins:wallet?.coins,server_time:Date.now(),
      round:publicRound(round)},201,cors);
  }
  return fail('game_method_not_allowed',405,cors);
}
