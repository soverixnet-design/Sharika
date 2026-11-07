import {readBoundedJson} from './request-body.mjs';

// Sovera Gaddy: independently settled 30s virtual-coin food wheel.
// Cloudflare D1 is the authority; the bundled HTML never draws paid results.
const GAME='sovera-gaddy';
const NAMES=['chicken','fish','hotdog','steak','grapes','lettuce','pepper','melon','salad','pizza'];
const SYMBOLS=['🍗','🐟','🌭','🥩','🍇','🥬','🫑','🍉','🥗','🍕'];
const DEFAULT_WEIGHTS=[20,36,60,90,180,180,180,180,37,37];
const DEFAULT_MULT=[45,25,15,10,5,5,5,5,2,2];
const BET_AMOUNTS=[50,500,2000,10000];
const ROUND_MS=30000,BET_MS=20000,PAY_MS=25000;
const REQ=/^[A-Za-z0-9:_-]{12,80}$/;

const hex=bytes=>[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');
async function digest(value){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))));}
function readArray(source,fallback,length=10){
  try{
    const a=JSON.parse(source);
    if(Array.isArray(a)&&a.length===length&&a.every(x=>Number.isSafeInteger(x)&&x>=1&&x<=100000))return a;
  }catch{}
  return fallback;
}
function config(row){return {
  weights:readArray(row?.weights_json,DEFAULT_WEIGHTS),
  mult:readArray(row?.multipliers_json,DEFAULT_MULT)
};}
function number(now=Date.now()){return Math.floor(now/ROUND_MS);}
function timings(n){return {start:n*ROUND_MS,betEnd:n*ROUND_MS+BET_MS,
  payoutAt:n*ROUND_MS+PAY_MS,end:(n+1)*ROUND_MS};}
async function ensureRound(db,n){
  const id=GAME+':'+n;
  let r=await db.prepare('SELECT * FROM sharika_gaddy_rounds WHERE id=?').bind(id).first();
  if(r)return r;
  const conf=await db.prepare('SELECT * FROM sharika_gaddy_config WHERE id=1').first();
  const c=config(conf),seed=hex(crypto.getRandomValues(new Uint8Array(32))),commit=await digest(seed);
  const t=timings(n);
  await db.prepare('INSERT OR IGNORE INTO sharika_gaddy_rounds(id,round_no,starts_ms,bet_closes_ms,closes_ms,seed_hex,commit_sha256,weights_json,multipliers_json) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id,n,t.start,t.betEnd,t.end,seed,commit,JSON.stringify(c.weights),JSON.stringify(c.mult)).run();
  r=await db.prepare('SELECT * FROM sharika_gaddy_rounds WHERE id=?').bind(id).first();
  return r;
}
export async function gaddyOutcome(r){
  const {weights}=config(r);
  const hash=await digest(r.seed_hex+'|sovera-gaddy|'+r.round_no);
  let choose=BigInt('0x'+hash)%BigInt(weights.reduce((a,b)=>a+b,0));
  let result=9;
  for(let i=0;i<weights.length;i++){
    choose-=BigInt(weights[i]);
    if(choose<0n){result=i;break;}
  }
  const hits=result===8?[4,5,6,7]:result===9?[0,1,2,3]:[result];
  const position=hits[Number(BigInt('0x'+hash.slice(0,8))%BigInt(hits.length))];
  return {item:NAMES[result],result_index:result,visual:hits.map(i=>NAMES[i]),
    target_index:position,seed_hex:r.seed_hex,commit_sha256:r.commit_sha256};
}
export function gaddyPayout(bet,result,r){
  const mult=config(r).mult;
  if(result.result_index===8)return bet.pick_index>=4?bet.amount*mult[8]:0;
  if(result.result_index===9)return bet.pick_index<4?bet.amount*mult[9]:0;
  return bet.pick_index===result.result_index?bet.amount*mult[result.result_index]:0;
}
export async function settleGaddyDueBets(db,now=Date.now()){
  const due=await db.prepare('SELECT b.*,r.seed_hex,r.commit_sha256,r.weights_json,r.multipliers_json FROM sharika_gaddy_bets b JOIN sharika_gaddy_rounds r ON r.id=b.round_id WHERE b.status=\'accepted\' AND r.starts_ms+?<=? ORDER BY b.id LIMIT 120').bind(PAY_MS,now).all();
  const outcomes=new Map();let processed=0;
  for(const bet of due.results||[]){
    let result=outcomes.get(bet.round_id);
    if(!result){result=await gaddyOutcome(bet);outcomes.set(bet.round_id,result);}
    // Conditional D1 update triggers one credit and immutable wallet ledger.
    const payout=gaddyPayout(bet,result,bet);
    await db.prepare('UPDATE sharika_gaddy_bets SET status=\'settled\',payout=?,result_key=?,settled_at=datetime(\'now\') WHERE id=? AND status=\'accepted\'')
      .bind(payout,result.item,bet.id).run();
    processed++;
  }
  return processed;
}
async function user(db,uid){return db.prepare('SELECT coins,public_no,name,pic,minor,status FROM sharika_users WHERE auth_uid=?').bind(uid).first();}
function card(u){return u?{name:u.name||'Player',id:String(u.public_no).padStart(8,'0'),avatar:u.pic||''}:null;}
async function previous(db,n,now){
  const row=await db.prepare('SELECT * FROM sharika_gaddy_rounds WHERE round_no=?').bind(n).first();
  if(!row||now<row.starts_ms+PAY_MS)return null;
  const answer=await gaddyOutcome(row);
  const winning=await db.prepare('SELECT u.name,u.public_no,u.pic,SUM(b.payout) AS total_win FROM sharika_gaddy_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid WHERE b.round_id=? AND b.status=\'settled\' AND b.payout>0 GROUP BY b.user_uid ORDER BY total_win DESC,u.public_no LIMIT 3').bind(row.id).all();
  return {round_no:n,...answer,top_winners:(winning.results||[]).map(x=>({
    name:x.name,public_id:String(x.public_no).padStart(8,'0'),pic:x.pic,total_win:x.total_win
  }))};
}
async function state(db,uid,now=Date.now()){
  await settleGaddyDueBets(db,now);
  const n=number(now),t=timings(n),r=await ensureRound(db,n),u=await user(db,uid);
  // Own request IDs let a slow/reconnected client reconcile an uncertain bet
  // without sending a different ID and accidentally paying twice.
  const bets=await db.prepare('SELECT round_no,pick_index,amount,request_id,status,payout,created_at FROM sharika_gaddy_bets WHERE user_uid=? AND round_no>=? ORDER BY id DESC LIMIT 100').bind(uid,n-1).all();
  const prior=await previous(db,n-1,now);
  const current=now>=t.betEnd?await previous(db,n,now):null;
  const myBets=bets.results||[];
  const daily=await db.prepare("SELECT COALESCE(SUM(payout),0) AS won,COALESCE(SUM(amount),0) AS wagered FROM sharika_gaddy_bets WHERE user_uid=? AND date(created_at,'+6 hours')=date('now','+6 hours')")
    .bind(uid).first();
  return {game:GAME,name:'Sovera Gaddy Game',virtual_coins_only:true,
    server_time:now,coins:u?.coins||0,user:card(u),chips:BET_AMOUNTS,
    today_won:daily?.won||0,today_wagered:daily?.wagered||0,
    multipliers:config(r).mult,symbols:SYMBOLS,round:{round_no:n,starts_ms:t.start,
      bet_closes_ms:t.betEnd,closes_ms:t.end,payout_at_ms:t.payoutAt,
      commit_sha256:r.commit_sha256,phase:now<t.betEnd?'bet':now<t.payoutAt?'spin':'result'},
    my_bets:myBets,spin:now>=t.betEnd?await gaddyOutcome(r):null,
    current_result:current,previous_result:prior};
}
async function ranking(db,uid){
  await settleGaddyDueBets(db);
  const list=await db.prepare("SELECT u.name,u.public_no,u.pic,SUM(b.amount) AS total FROM sharika_gaddy_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid WHERE date(b.created_at,'+6 hours')=date('now','+6 hours') GROUP BY b.user_uid ORDER BY total DESC,u.public_no LIMIT 100").all();
  const me=await db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM sharika_gaddy_bets WHERE user_uid=? AND date(created_at,'+6 hours')=date('now','+6 hours')").bind(uid).first();
  const u=await user(db,uid);
  const players=(list.results||[]).map(x=>({...card(x),total:x.total}));
  const idx=players.findIndex(x=>x.id===String(u?.public_no).padStart(8,'0'));
  return {list:players,me:{rank:idx>=0?idx+1:null,total:me?.total||0}};
}
export async function handleSoveraGaddy({request,db,uid,action,reply,fail,cors}){
  if(action==='state'&&request.method==='GET')return reply(await state(db,uid),200,cors);
  if(action==='history'&&request.method==='GET'){
    await settleGaddyDueBets(db);
    const rows=await db.prepare('SELECT * FROM sharika_gaddy_rounds WHERE closes_ms<=? ORDER BY round_no DESC LIMIT 30').bind(Date.now()).all();
    const rounds=[];for(const r of rows.results||[])rounds.push({round_no:r.round_no,...await gaddyOutcome(r)});
    const history=await db.prepare('SELECT round_no,pick_index,amount,status,payout,result_key,created_at FROM sharika_gaddy_bets WHERE user_uid=? ORDER BY id DESC LIMIT 60').bind(uid).all();
    return reply({game:GAME,rounds,bets:history.results||[]},200,cors);
  }
  if(action==='rankings'&&request.method==='GET')return reply(await ranking(db,uid),200,cors);
  if(action==='stats'&&request.method==='GET'){
    await settleGaddyDueBets(db);
    const rows=await db.prepare("SELECT COUNT(*) AS bets,COALESCE(SUM(amount),0) AS wagered,COALESCE(SUM(payout),0) AS won FROM sharika_gaddy_bets WHERE user_uid=? AND date(created_at,'+6 hours')=date('now','+6 hours')").bind(uid).first();
    return reply({game:GAME,bets:rows?.bets||0,wagered:rows?.wagered||0,won:rows?.won||0},200,cors);
  }
  if(action!=='bet'||request.method!=='POST')return fail('gaddy_route_not_found',404,cors);
  const u=await user(db,uid);
  if(!u||u.status!=='active'||u.minor)return fail('game_adult_only',403,cors);
  let b;try{b=await readBoundedJson(request);}catch{return fail('invalid_json',400,cors);}
  if(!b||!Number.isSafeInteger(b.round_no)||b.round_no<0||
    !Number.isSafeInteger(b.pick)||b.pick<0||b.pick>7||
    !BET_AMOUNTS.includes(b.amount)||typeof b.request_id!=='string'||
    !REQ.test(b.request_id))return fail('invalid_bet',400,cors);
  const prior=await db.prepare('SELECT * FROM sharika_gaddy_bets WHERE user_uid=? AND request_id=?').bind(uid,b.request_id).first();
  if(prior){
    if(prior.round_no!==b.round_no||prior.pick_index!==b.pick||prior.amount!==b.amount)
      return fail('idempotency_conflict',409,cors);
    return reply({duplicate:true,bet_id:prior.id,coins:(await user(db,uid)).coins},200,cors);
  }
  const now=Date.now(),n=number(now),t=timings(n);
  if(b.round_no!==n||now>=t.betEnd)return fail('betting_closed',409,cors);
  if(u.coins<b.amount)await settleGaddyDueBets(db,now);
  const r=await ensureRound(db,n);
  try{
    await db.prepare('INSERT INTO sharika_gaddy_bets(round_id,round_no,user_uid,pick_index,amount,request_id) VALUES(?,?,?,?,?,?)')
      .bind(r.id,n,uid,b.pick,b.amount,b.request_id).run();
  }catch(e){
    const collision=await db.prepare('SELECT * FROM sharika_gaddy_bets WHERE user_uid=? AND request_id=?').bind(uid,b.request_id).first();
    if(collision){
      if(collision.round_no!==n||collision.pick_index!==b.pick||collision.amount!==b.amount)
        return fail('idempotency_conflict',409,cors);
      return reply({duplicate:true,bet_id:collision.id,coins:(await user(db,uid)).coins},200,cors);
    }
    const message=String(e?.message||e);
    if(message.includes('insufficient')||message.includes('CHECK constraint'))return fail('insufficient_coins',409,cors);
    if(message.includes('closed'))return fail('betting_closed',409,cors);
    if(message.includes('ineligible'))return fail('game_adult_only',403,cors);
    throw e;
  }
  const accepted=await db.prepare('SELECT id FROM sharika_gaddy_bets WHERE user_uid=? AND request_id=?').bind(uid,b.request_id).first();
  return reply({duplicate:false,bet_id:accepted?.id,coins:(await user(db,uid)).coins,
    round_no:n},201,cors);
}
