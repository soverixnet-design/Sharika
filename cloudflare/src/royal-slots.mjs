// Server-authoritative Royal Slots: 5x3 grid, 9 lines, 100% virtual coins.
const BETS=[1000,10000,100000,1000000,10000000];
const WEIGHTS=[40,50,60,70,80,90,100,100,110,60,12,5];
const PAY=[[5000,10000,25000],[4000,9000,20000],[3000,8000,18000],
 [2000,6000,16000],[1500,5000,14000],[1000,4000,12000],
 [800,3000,8000],[600,2000,6000],[400,1000,4000]];
const LINES=[[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],
 [2,1,0,1,2],[1,0,0,0,1],[1,2,2,2,1],[0,0,1,2,2],[2,2,1,0,0]];
const REQUEST_ID=/^[A-Za-z0-9_-]{12,100}$/;
const TOTAL=WEIGHTS.reduce((a,b)=>a+b,0);
function secureInt(max){
 if(!Number.isSafeInteger(max)||max<=0)throw Error('invalid_random');
 const size=4294967296,limit=size-size%max,out=new Uint32Array(1);
 do{crypto.getRandomValues(out)}while(out[0]>=limit);
 return out[0]%max;
}
function pick(){let n=secureInt(TOTAL);for(let i=0;i<WEIGHTS.length;i++){
 n-=WEIGHTS[i];if(n<0)return i;}return 8;}
export function generateGrid(){return Array.from({length:5},()=>[pick(),pick(),pick()]);}
export function evaluateGrid(grid,bet,freeSpin,pool,maxWin){
 if(!BETS.includes(bet)||!Array.isArray(grid)||grid.length!==5||
  grid.some(col=>!Array.isArray(col)||col.length!==3||
   col.some(n=>!Number.isInteger(n)||n<0||n>11)))throw Error('invalid_grid');
 let jackpotCount=0,bonusCount=0,total=0;const lines=[];
 for(const col of grid)for(const n of col){if(n===11)jackpotCount++;if(n===10)bonusCount++;}
 for(let i=0;i<LINES.length;i++){
  const symbols=LINES[i].map((r,c)=>grid[c][r]);
  let symbol=symbols.find(x=>x!==9);if(symbol===undefined)symbol=0;
  if(symbol>=10)continue;
  let count=0;while(count<5&&(symbols[count]===symbol||symbols[count]===9))count++;
  if(count>=3){const win=PAY[symbol][count-3]*(bet/1000);
   total+=win;lines.push({line:i+1,symbol,count,win});}
 }
 const cap=Math.min(maxWin,bet*200);
 const jackpotWin=jackpotCount>=3?Math.floor(Math.min(pool,bet*100,cap)):0;
 const freeSpinsAwarded=jackpotCount>=3?0:bonusCount>=3?8:0;
 const totalWin=jackpotCount>=3?jackpotWin:bonusCount>=3?0:
   Math.floor(Math.min(total*(freeSpin?2:1),cap));
 return {grid,lines:jackpotCount>=3||bonusCount>=3?[]:lines,
  totalWin,jackpotWin,freeSpinsAwarded};
}
const validInt=n=>Number.isSafeInteger(n)&&n>=0;
async function existing(db,uid,id){return db.prepare(
 'SELECT * FROM sharika_royal_slots_rounds WHERE user_uid=? AND request_id=?'
 ).bind(uid,id).first();}
function receipt(row){return {
 requestId:row.request_id,bet:Number(row.bet),freeSpin:row.mode==='free',
 grid:JSON.parse(row.grid_json),lines:JSON.parse(row.lines_json),
 totalWin:Number(row.total_win),jackpotWin:Number(row.jackpot_win),
 freeSpinsAwarded:Number(row.free_awarded),freeSpinsLeft:Number(row.free_after),
 balance:Number(row.balance_after),jackpot:Number(row.jackpot_after),
 settled:true,virtual_coins_only:true
};}
async function state(db,uid){
 const [user,settings,free]=await Promise.all([
  db.prepare('SELECT coins,minor,status FROM sharika_users WHERE auth_uid=?').bind(uid).first(),
  db.prepare('SELECT enabled,bets_json,max_win,jackpot_pool FROM sharika_royal_slots_settings WHERE id=1').first(),
  db.prepare('SELECT remaining,bet FROM sharika_royal_slots_free WHERE user_uid=?').bind(uid).first()
 ]);
 return {user,settings,free};
}
export async function handleRoyalSlots({request,db,uid,action,reply,fail,cors}){
 if(action==='state'&&request.method==='GET'){
  const s=await state(db,uid);
  if(!s.user||s.user.status!=='active'||s.user.minor)return fail('game_not_eligible',403,cors);
  if(!s.settings?.enabled)return fail('game_disabled',403,cors);
  return reply({balance:Number(s.user.coins),bets:JSON.parse(s.settings.bets_json),
   freeSpins:Number(s.free?.remaining||0),lockedBet:Number(s.free?.bet||0),
   jackpot:Number(s.settings.jackpot_pool),virtual_coins_only:true},200,cors);
 }
 if(action!=='spin'||request.method!=='POST')return fail('method_not_allowed',405,cors);
 let b;try{const t=await request.text();if(t.length>512)throw Error('big');
  b=JSON.parse(t);}catch{return fail('invalid_spin_request',400,cors);}
 if(!b||!BETS.includes(b.bet)||typeof b.freeSpin!=='boolean'||
  typeof b.requestId!=='string'||!REQUEST_ID.test(b.requestId))
  return fail('invalid_spin_request',400,cors);
 const first=await existing(db,uid,b.requestId);
 if(first)return Number(first.bet)===b.bet&&(first.mode==='free')===b.freeSpin?
  reply(receipt(first),200,cors):fail('request_id_conflict',409,cors);
 for(let attempt=0;attempt<3;attempt++){
  const s=await state(db,uid);
  if(!s.user||s.user.status!=='active'||s.user.minor)
   return fail('game_not_eligible',403,cors);
  if(!s.settings?.enabled)return fail('game_disabled',403,cors);
  if(!JSON.parse(s.settings.bets_json).includes(b.bet))return fail('invalid_bet',400,cors);
  const hasFree=Number(s.free?.remaining||0)>0;
  if(hasFree!==b.freeSpin)return fail('free_spin_mode_conflict',409,cors);
  if(hasFree&&Number(s.free.bet)!==b.bet)return fail('free_spin_bet_locked',409,cors);
  if(!hasFree&&Number(s.user.coins)<b.bet)return fail('not_enough_balance',409,cors);
  const maxWin=Number(s.settings.max_win),pool=Number(s.settings.jackpot_pool);
  if(!validInt(maxWin)||!validInt(pool))return fail('game_settings_invalid',503,cors);
  const spin=evaluateGrid(generateGrid(),b.bet,b.freeSpin,pool,maxWin);
  try{
   await db.prepare('INSERT INTO sharika_royal_slots_rounds '+
    '(user_uid,request_id,bet,mode,cost,grid_json,lines_json,total_win,jackpot_win,free_awarded,created_ms) '+
    'VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(uid,b.requestId,b.bet,b.freeSpin?'free':'paid',
      b.freeSpin?0:b.bet,JSON.stringify(spin.grid),JSON.stringify(spin.lines),
      spin.totalWin,spin.jackpotWin,spin.freeSpinsAwarded,Date.now()).run();
   const row=await existing(db,uid,b.requestId);
   if(!row)throw Error('missing_slot_receipt');
   return reply(receipt(row),200,cors);
  }catch(e){
   const old=await existing(db,uid,b.requestId);
   if(old)return Number(old.bet)===b.bet&&(old.mode==='free')===b.freeSpin?
     reply(receipt(old),200,cors):fail('request_id_conflict',409,cors);
   const reason=String(e?.message||e);
   if(reason.includes('slots_insufficient'))return fail('not_enough_balance',409,cors);
   if(reason.includes('slots_rate_limited'))return fail('spin_rate_limited',429,cors);
   if(reason.includes('slots_locked_bet'))return fail('free_spin_bet_locked',409,cors);
   if(reason.includes('slots_disabled'))return fail('game_disabled',403,cors);
   if(reason.includes('slots_mode_conflict'))return fail('free_spin_mode_conflict',409,cors);
   if(reason.includes('slots_ineligible'))return fail('game_not_eligible',403,cors);
   if(reason.includes('slots_pool_conflict'))continue;
   throw e;
  }
 }
 return fail('slot_spin_conflict_retry',409,cors);
}