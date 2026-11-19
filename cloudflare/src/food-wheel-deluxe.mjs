import {settleTapBatch} from './round-tap-batch.mjs';
// Food Wheel Deluxe — uploaded 8-food art with server-authoritative coin settlement.
// Isolated from legacy sovera-food sessions; no modification of historical rules.
const MULT=Object.freeze([5,10,15,25,5,5,5,45]);
const NAMES=Object.freeze(['Strawberry','Burger','Shrimp','Puffer Fish','Banana','Orange','Cherry','Steak']);
const CHIPS=Object.freeze([100,1000,5000,10000,50000]);
export const FOOD_DELUXE_ROUND_MS=25000;
const BET_MS=15000,RESULT_MS=20000,MAX_STAKE=100000000;
const ID=/^[A-Za-z0-9:_-]{12,80}$/;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function sha(text){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
 return hex(new Uint8Array(digest));
}
function clock(n){
 const starts_ms=n*FOOD_DELUXE_ROUND_MS;
 return {round_no:n,starts_ms,bet_closes_ms:starts_ms+BET_MS,
  result_ms:starts_ms+RESULT_MS,closes_ms:starts_ms+FOOD_DELUXE_ROUND_MS};
}
function roundNumber(ms){return Math.floor(ms/FOOD_DELUXE_ROUND_MS);}
async function ensureRound(db,n){
 const exists=await db.prepare('SELECT * FROM sharika_food_deluxe_rounds WHERE round_no=?').bind(n).first();
 if(exists)return exists;
 const seed=hex(crypto.getRandomValues(new Uint8Array(32)));
 const commit=await sha(seed),t=clock(n);
 await db.prepare('INSERT OR IGNORE INTO sharika_food_deluxe_rounds '+
  '(id,round_no,starts_ms,bet_closes_ms,result_ms,closes_ms,seed_hex,commit_sha256) '+
  'VALUES(?,?,?,?,?,?,?,?)')
  .bind('food-deluxe:'+n,n,t.starts_ms,t.bet_closes_ms,t.result_ms,t.closes_ms,seed,commit).run();
 return db.prepare('SELECT * FROM sharika_food_deluxe_rounds WHERE round_no=?').bind(n).first();
}
// Seed is committed before the first bet. No Math.random or client-supplied result.
export async function foodDeluxeOutcome(seed){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(seed+'|food-wheel-result'));
 const bytes=new Uint8Array(digest),v=(bytes[0]*16777216+bytes[1]*65536+bytes[2]*256+bytes[3])>>>0;
 const weights=MULT.map(m=>Math.round(36000/m)),total=weights.reduce((a,b)=>a+b,0);
 let n=v%total;
 for(let i=0;i<weights.length;i++){n-=weights[i];if(n<0)return i;}
 return 7;
}
function stakesFromJSON(value){const a=JSON.parse(value);
 if(!Array.isArray(a)||a.length!==8)return Array(8).fill(0);
 return a.map(n=>Number(n)||0);
}
export function foodDeluxePayout(stakes,index){
 return stakes[index]*MULT[index];
}
async function settleFoodDueBets(db,now=Date.now()){
 const bets=await db.prepare('SELECT b.*,r.seed_hex,r.result_ms FROM sharika_food_deluxe_bets b '+
  'JOIN sharika_food_deluxe_rounds r ON r.id=b.round_id '+
  "WHERE b.status='accepted' AND r.result_ms<=? ORDER BY r.round_no,b.id LIMIT 150")
  .bind(now).all();
 const outcomeCache=new Map();
 for(const b of bets.results||[]){
  let idx=outcomeCache.get(b.round_id);
  if(idx===undefined){
   idx=await foodDeluxeOutcome(b.seed_hex);outcomeCache.set(b.round_id,idx);
   await db.prepare('UPDATE sharika_food_deluxe_rounds SET winning_index=? '+
     'WHERE id=? AND winning_index IS NULL').bind(idx,b.round_id).run();
  }
  const pay=foodDeluxePayout(stakesFromJSON(b.stakes_json),idx);
  await db.prepare("UPDATE sharika_food_deluxe_bets SET status='settled',winning_index=?,payout=?,"+
    "settled_at=datetime('now') WHERE id=? AND status='accepted'")
   .bind(idx,pay,b.id).run();
 }
 return (bets.results||[]).length;
}
async function user(db,uid){return db.prepare(
  'SELECT coins,minor,status,name,pic,public_no FROM sharika_users WHERE auth_uid=?')
  .bind(uid).first();}
async function readRoundResult(db,r,uid){
 if(!r||Date.now()<r.result_ms)return null;
 const index=await foodDeluxeOutcome(r.seed_hex);
 // The seed becomes public only after betting has closed and results are final.
 const winners=await db.prepare('SELECT u.public_no,u.name,u.pic,SUM(b.payout) AS total_win '+
  'FROM sharika_food_deluxe_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid '+
  "WHERE b.round_id=? AND b.status='settled' AND b.payout>0 GROUP BY b.user_uid "+
  'ORDER BY total_win DESC,u.public_no LIMIT 3').bind(r.id).all();
 const own=await db.prepare('SELECT COALESCE(SUM(payout),0) AS payout FROM sharika_food_deluxe_bets '+
  "WHERE round_id=? AND user_uid=? AND status='settled'").bind(r.id,uid).first();
 return {round_no:r.round_no,index,multiplier:MULT[index],seed_hex:r.seed_hex,
  commit_sha256:r.commit_sha256,my_payout:Number(own?.payout||0),
  top_winners:(winners.results||[]).map(u=>({
   public_id:String(u.public_no).padStart(8,'0'),name:u.name,pic:u.pic,total_win:Number(u.total_win)
  }))};
}
async function userStakes(db,uid,roundId){
 const rows=await db.prepare('SELECT stakes_json FROM sharika_food_deluxe_bets '+
  'WHERE user_uid=? AND round_id=? ORDER BY id').bind(uid,roundId).all();
 const totals=Array(8).fill(0);
 for(const row of rows.results||[])stakesFromJSON(row.stakes_json).forEach((x,i)=>totals[i]+=x);
 return totals;
}
async function state(db,uid){
 await settleFoodDueBets(db);
 const now=Date.now(),n=roundNumber(now),r=await ensureRound(db,n),u=await user(db,uid);
 const t=clock(n);
 const prev=await db.prepare('SELECT * FROM sharika_food_deluxe_rounds WHERE result_ms<=? '+
  'ORDER BY round_no DESC LIMIT 1').bind(now).first();
 const lastWager=await db.prepare('SELECT round_id FROM sharika_food_deluxe_bets '+
  'WHERE user_uid=? AND round_no<? ORDER BY id DESC LIMIT 1').bind(uid,n).first();
 const hist=await db.prepare('SELECT * FROM sharika_food_deluxe_rounds '+
  'WHERE result_ms<=? ORDER BY round_no DESC LIMIT 15').bind(now).all();
 const recent=[];
 for(const item of hist.results||[])recent.push(await foodDeluxeOutcome(item.seed_hex));
 const stamp=new Date().toISOString().slice(0,10);
 const daily=await db.prepare('SELECT COALESCE(SUM(total),0) AS wagered,'+
  "COALESCE(SUM(CASE WHEN status='settled' THEN payout ELSE 0 END),0) AS won "+
  'FROM sharika_food_deluxe_bets WHERE user_uid=? AND created_at>=?').bind(uid,stamp).first();
 const currentResult=now>=r.result_ms?await readRoundResult(db,r,uid):null;
 return {game:'food-deluxe',virtual_coins_only:true,server_time:now,round_ms:FOOD_DELUXE_ROUND_MS,
  round:{...t,phase:now<t.bet_closes_ms?'bet':now<t.result_ms?'spin':'result',commit_sha256:r.commit_sha256},
  balance:Number(u?.coins||0),chips:CHIPS,multipliers:MULT,symbols:NAMES,
  my_stakes:await userStakes(db,uid,r.id),
  last_stakes:lastWager?await userStakes(db,uid,lastWager.round_id):Array(8).fill(0),
  history:recent,result:currentResult,
  previous_result:prev?await readRoundResult(db,prev,uid):null,
  today_wagered:Number(daily?.wagered||0),today_won:Number(daily?.won||0)};
}
async function ranking(db,period){
 const when=period==='monthly'?"datetime('now','start of month')":
 period==='weekly'?"datetime('now','-7 days')":"datetime('now','start of day')";
 const r=await db.prepare('SELECT u.public_no,u.name,u.pic,SUM(b.payout) AS coins FROM '+
  'sharika_food_deluxe_bets b JOIN sharika_users u ON u.auth_uid=b.user_uid '+
  "WHERE b.status='settled' AND b.settled_at>="+when+
  ' GROUP BY b.user_uid HAVING coins>0 ORDER BY coins DESC,u.public_no LIMIT 20').all();
 return (r.results||[]).map(u=>({
  public_id:String(u.public_no).padStart(8,'0'),name:u.name,pic:u.pic||'',total_win:Number(u.coins)
 }));
}
export async function handleFoodDeluxe({request,db,uid,action,reply,fail,cors}){
 const u=await user(db,uid);
 if(!u||u.status!=='active'||u.minor)return fail('game_not_eligible',403,cors);
 if(request.method==='GET'&&action==='state')return reply(await state(db,uid),200,cors);
 if(request.method==='GET'&&action==='history')return reply({
  rounds:(await state(db,uid)).history,read_only:true
 },200,cors);
 if(request.method==='GET'&&action==='rankings'){
  const period=new URL(request.url).searchParams.get('period')||'daily';
  if(!['daily','weekly','monthly'].includes(period))return fail('invalid_period',400,cors);
  await settleFoodDueBets(db);
  return reply({period,rankings:await ranking(db,period),verified:true},200,cors);
 }
 if(request.method!=='POST'||action!=='bet')return fail('method_not_allowed',405,cors);
 let b;
 try{
  const raw=await request.text();if(raw.length>8192)throw Error('too_large');
  b=JSON.parse(raw);
 }catch{return fail('invalid_bet',400,cors);}
 if(b?.taps)return settleTapBatch({db,uid,game:'food-deluxe',body:b,currentRound:roundNumber(Date.now()),
  ensure:()=>ensureRound(db,b.round_no),validAmount:a=>Number.isSafeInteger(a)&&a>=100&&a<=MAX_STAKE,reply,fail,cors});
 if(!b||!Number.isSafeInteger(b.round_no)||b.round_no<0||!ID.test(b.request_id||'')||
  !Array.isArray(b.stakes)||b.stakes.length!==8||
  b.stakes.some(a=>!Number.isSafeInteger(a)||a<0||a>MAX_STAKE||a%100!==0))
  return fail('invalid_bet',400,cors);
 const total=b.stakes.reduce((a,c)=>a+c,0);
 if(!Number.isSafeInteger(total)||total<100||total>MAX_STAKE)return fail('invalid_bet',400,cors);
 const prior=await db.prepare('SELECT * FROM sharika_food_deluxe_bets '+
  'WHERE user_uid=? AND request_id=?').bind(uid,b.request_id).first();
 if(prior){
  if(prior.round_no!==b.round_no||prior.stakes_json!==JSON.stringify(b.stakes))
   return fail('idempotency_conflict',409,cors);
  return reply({duplicate:true,round_no:prior.round_no,
   balance:Number((await user(db,uid)).coins),stakes:b.stakes},200,cors);
 }
 const n=roundNumber(Date.now()),t=clock(n);
 if(b.round_no!==n||Date.now()>=t.bet_closes_ms)return fail('betting_closed',409,cors);
 const round=await ensureRound(db,n);
 try{
  await db.prepare('INSERT INTO sharika_food_deluxe_bets '+
   '(round_id,round_no,user_uid,stakes_json,total,request_id) VALUES(?,?,?,?,?,?)')
   .bind(round.id,n,uid,JSON.stringify(b.stakes),total,b.request_id).run();
 }catch(e){
  const collision=await db.prepare('SELECT * FROM sharika_food_deluxe_bets '+
   'WHERE user_uid=? AND request_id=?').bind(uid,b.request_id).first();
  if(collision){
   if(collision.round_no!==n||collision.stakes_json!==JSON.stringify(b.stakes))
    return fail('idempotency_conflict',409,cors);
   return reply({duplicate:true,round_no:n,
    balance:Number((await user(db,uid)).coins),stakes:b.stakes},200,cors);
  }
  const detail=String(e?.message||e);
  if(detail.includes('food_betting_closed'))return fail('betting_closed',409,cors);
  if(detail.includes('food_insufficient_coins'))return fail('insufficient_coins',409,cors);
  if(detail.includes('food_user_ineligible'))return fail('game_not_eligible',403,cors);
  if(detail.includes('food_invalid_stakes'))return fail('invalid_bet',400,cors);
  throw e;
 }
 return reply({accepted:true,round_no:n,stake_total:total,
  balance:Number((await user(db,uid)).coins),stakes:b.stakes},201,cors);
}
export {settleFoodDueBets};
