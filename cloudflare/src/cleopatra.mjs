// Cleopatra's Gold Deluxe — server-authoritative, virtual-coin-only slot.
// The bundled HTML NEVER decides payout, balance, jackpot or free spins.
const PAY=Object.freeze({
 H:[25,10,5],E:[20,9,4],L:[18,8,3],A:[16,6,2],K:[14,5,1.5],
 Q:[12,4,1],J:[8,3,0.8],T:[6,2,0.6],N:[4,1,0.4]
});
const LINES=[
 [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
 [0,1,2,1,0],[2,1,0,1,2],[1,0,0,0,1],
 [1,2,2,2,1],[0,0,1,2,2],[2,2,1,0,0]
];
const KEYS=['H','E','L','A','K','Q','J','T','N','W','B','P'];
const safeInteger=n=>Number.isSafeInteger(n)&&n>=0;
function parseConfig(row){
 const bets=JSON.parse(row.bets_json);
 const weights=JSON.parse(row.weights_json);
 if(!Array.isArray(bets)||!bets.length||
    bets.some(n=>!safeInteger(n)||n===0)||
    KEYS.some(k=>typeof weights[k]!=='number'||!Number.isFinite(weights[k])||weights[k]<=0))
   throw Error('cleopatra_invalid_settings');
 return {bets,weights,payout_scale:Number(row.payout_scale),
   max_win:Number(row.max_win),version:Number(row.version)};
}
function secureInt(max){
 if(!safeInteger(max)||max<1||max>4294967295)throw Error('invalid_rng_weight');
 const range=4294967296,limit=range-range%max,data=new Uint32Array(1);
 do{crypto.getRandomValues(data)}while(data[0]>=limit);
 return data[0]%max;
}
function drawGrid(weights){
 const parts=KEYS.map(k=>Math.round(weights[k]*1000));
 const total=parts.reduce((a,b)=>a+b,0);
 if(parts.some(p=>p<1)||total>4294967295)throw Error('invalid_rng_weights');
 function pick(){let n=secureInt(total);for(let i=0;i<KEYS.length;i++){
   n-=parts[i];if(n<0)return KEYS[i];
 }return KEYS[KEYS.length-1];}
 return Array.from({length:5},()=>[pick(),pick(),pick()]);
}
export function evaluateCleopatra(grid,bet,pool,config,freeSpin=false){
 if(!Array.isArray(grid)||grid.length!==5||
   grid.some(r=>!Array.isArray(r)||r.length!==3||r.some(s=>!KEYS.includes(s))))
   throw Error('invalid_grid');
 const all=grid.flat(),pyramids=all.filter(x=>x==='P').length;
 const scarabs=all.filter(x=>x==='B').length;
 if(pyramids>=3)return {win:Math.min(config.max_win,Math.floor(bet*pool/100000)),
   jackpot:true,bonus:false,bonusSpins:0};
 if(scarabs>=3)return {win:0,jackpot:false,bonus:true,bonusSpins:10};
 let total=0;
 for(const line of LINES){
   const symbols=line.map((row,reel)=>grid[reel][row]);
   let base=symbols.find(s=>s!=='W')||'H';
   if(base==='B'||base==='P')continue;
   let consecutive=0;
   for(const k of symbols){if(k===base||k==='W')consecutive++;else break;}
   if(consecutive>=3)total+=PAY[base][5-consecutive];
 }
 const multiplier=freeSpin?2:1;
 const amount=Math.floor(total*bet*config.payout_scale*multiplier);
 return {win:Math.max(0,Math.min(config.max_win,amount)),
   jackpot:false,bonus:false,bonusSpins:0};
}
async function readSaved(db,uid,requestId){
 return db.prepare('SELECT * FROM sharika_cleopatra_rounds WHERE user_uid=? AND request_id=?')
  .bind(uid,requestId).first();
}
async function resultFor(db,uid,row){
 const free=await db.prepare('SELECT remaining FROM sharika_cleopatra_free_spins WHERE user_uid=?')
  .bind(uid).first();
 const pool=await db.prepare('SELECT pool FROM sharika_cleopatra_jackpot WHERE id=1').first();
 return {requestId:row.request_id,grid:JSON.parse(row.grid_json),win:Number(row.win),
   balance:Number(row.balance_after),freeSpins:Number(free?.remaining||0),
   jackpot:Number(pool?.pool||0),isFreeSpin:!!row.is_free_spin,
   jackpotHit:!!row.jackpot_hit,bonusHit:!!row.bonus_spins};
}
async function state(db,uid){
 const user=await db.prepare(
  "SELECT name,pic,coins,minor,status FROM sharika_users WHERE auth_uid=?").bind(uid).first();
 if(!user||user.status!=='active'||user.minor)return null;
 const cfg=await db.prepare('SELECT * FROM sharika_cleopatra_settings WHERE id=1').first();
 const pool=await db.prepare('SELECT pool FROM sharika_cleopatra_jackpot WHERE id=1').first();
 const free=await db.prepare('SELECT remaining,bet FROM sharika_cleopatra_free_spins WHERE user_uid=?')
   .bind(uid).first();
 const last=await db.prepare('SELECT bet,win,created_at FROM sharika_cleopatra_rounds '+
  'WHERE user_uid=? ORDER BY id DESC LIMIT 25').bind(uid).all();
 const now=Date.now(),utc=new Date(),day=Date.UTC(utc.getUTCFullYear(),utc.getUTCMonth(),utc.getUTCDate());
 const week=day-((utc.getUTCDay()+6)%7)*86400000;
 const sql="SELECT u.name,SUM(r.win) AS coins FROM sharika_cleopatra_rounds r "+
   "JOIN sharika_users u ON u.auth_uid=r.user_uid "+
   "WHERE r.created_ms>=? AND u.status='active' GROUP BY r.user_uid "+
   "HAVING coins>0 ORDER BY coins DESC LIMIT 10";
 const [daily,weekly]=await Promise.all([db.prepare(sql).bind(day).all(),
    db.prepare(sql).bind(week).all()]);
 return {balance:Number(user.coins),bets:JSON.parse(cfg.bets_json),
   jackpot:Number(pool?.pool||0),freeSpins:Number(free?.remaining||0),lockedBet:Number(free?.bet||0),
   user:{name:user.name,avatar:user.pic||''},
   rank:{daily:(daily.results||[]).map(r=>[r.name,Number(r.coins)]),
     weekly:(weekly.results||[]).map(r=>[r.name,Number(r.coins)])},
   history:(last.results||[]).map(x=>x.created_at+' • Bet '+x.bet+' • Win '+x.win),
   virtual_coins_only:true};
}
export async function handleCleopatra({request,db,uid,action,reply,fail,cors}){
 if(action==='state'&&request.method==='GET'){
   const settings=await db.prepare('SELECT enabled FROM sharika_cleopatra_settings WHERE id=1').first();
   if(!settings||!settings.enabled)return fail('game_disabled',403,cors);
   const data=await state(db,uid);
   return data?reply(data,200,cors):fail('game_not_eligible',403,cors);
 }
 if(action!=='spin'||request.method!=='POST')return fail('cleopatra_method_not_allowed',405,cors);
 let body;
 try{const raw=await request.text();if(raw.length>512)throw Error('size');body=JSON.parse(raw);}
 catch{return fail('invalid_spin_request',400,cors);}
 const bet=body?.bet,requestId=body?.requestId;
 if(!safeInteger(bet)||bet===0||typeof requestId!=='string'||
    !/^[A-Za-z0-9_-]{8,120}$/.test(requestId))
   return fail('invalid_spin_request',400,cors);
 const previous=await readSaved(db,uid,requestId);
 if(previous)return Number(previous.bet)===bet?reply(await resultFor(db,uid,previous),200,cors):
   fail('request_id_conflict',409,cors);
 for(let attempt=0;attempt<4;attempt++){
   const [configRow,free,pool,user]=await Promise.all([
     db.prepare('SELECT * FROM sharika_cleopatra_settings WHERE id=1').first(),
     db.prepare('SELECT remaining,bet,settings_json,settings_version FROM sharika_cleopatra_free_spins WHERE user_uid=?').bind(uid).first(),
     db.prepare('SELECT pool,version FROM sharika_cleopatra_jackpot WHERE id=1').first(),
     db.prepare("SELECT coins,minor,status FROM sharika_users WHERE auth_uid=?").bind(uid).first()
   ]);
   if(!configRow||!configRow.enabled)return fail('game_disabled',403,cors);
   if(!user||user.status!=='active'||user.minor)return fail('game_not_eligible',403,cors);
   const isFree=Number(free?.remaining||0)>0;
   const config=isFree?JSON.parse(free.settings_json):parseConfig(configRow);
   if(!config.bets||!config.weights)throw Error('cleopatra_invalid_free_snapshot');
   if(isFree?bet!==Number(free.bet):!config.bets.includes(bet))
     return fail(isFree?'free_spin_bet_locked':'invalid_bet',400,cors);
   if(!isFree&&Number(user.coins)<bet)return fail('not_enough_balance',409,cors);
   const grid=drawGrid(config.weights);
   const result=evaluateCleopatra(grid,bet,Number(pool.pool),config,isFree);
   const snapshot=JSON.stringify(config);
   try{
     await db.prepare('INSERT INTO sharika_cleopatra_rounds '+
       '(user_uid,request_id,bet,is_free_spin,grid_json,settings_json,win,bonus_spins,'+
       'jackpot_hit,settings_version,jackpot_version,created_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
       .bind(uid,requestId,bet,isFree?1:0,JSON.stringify(grid),snapshot,
         result.win,result.bonusSpins,result.jackpot?1:0,config.version,
         Number(pool.version),Date.now()).run();
     const saved=await readSaved(db,uid,requestId);
     if(!saved)throw Error('cleopatra_result_missing');
     return reply(await resultFor(db,uid,saved),200,cors);
   }catch(error){
     const saved=await readSaved(db,uid,requestId);
     if(saved)return Number(saved.bet)===bet?reply(await resultFor(db,uid,saved),200,cors):
       fail('request_id_conflict',409,cors);
     const message=String(error?.message||error);
     if(/cleopatra_(jackpot_changed|settings_changed|free_spin_mismatch)/.test(message))continue;
     if(message.includes('cleopatra_spin_rate_limited'))return fail('spin_rate_limited',429,cors);
     if(message.includes('cleopatra_insufficient_balance'))return fail('not_enough_balance',409,cors);
     if(message.includes('cleopatra_locked_bet'))return fail('free_spin_bet_locked',409,cors);
     if(message.includes('cleopatra_disabled'))return fail('game_disabled',403,cors);
     throw error;
   }
 }
 return fail('spin_conflict_retry',409,cors);
}
export async function handleCleopatraAdmin({request,db,uid,role,reply,fail,cors}){
 if(!['super','finance'].includes(role))return fail('admin_permission_denied',403,cors);
 const row=await db.prepare('SELECT * FROM sharika_cleopatra_settings WHERE id=1').first();
 const pool=await db.prepare('SELECT pool FROM sharika_cleopatra_jackpot WHERE id=1').first();
 if(request.method==='GET')return reply({settings:row,jackpot:Number(pool?.pool||0),
   read_only:role!=='super'},200,cors);
 if(role!=='super')return fail('admin_permission_denied',403,cors);
 if(request.method!=='PATCH')return fail('method_not_allowed',405,cors);
 let body;
 try{const raw=await request.text();if(raw.length>4000)throw Error('size');body=JSON.parse(raw);}
 catch{return fail('invalid_cleopatra_settings',400,cors);}
 if(!body||typeof body!=='object'||Array.isArray(body))return fail('invalid_cleopatra_settings',400,cors);
 const editable=['enabled','bets','weights','payout_scale','contribution_bps','max_win'];
 if(Object.keys(body).some(k=>!editable.includes(k)))return fail('invalid_cleopatra_settings',400,cors);
 let next;
 try{
   next={
     enabled:typeof body.enabled==='boolean'?(body.enabled?1:0):row.enabled,
     bets:body.bets??JSON.parse(row.bets_json),weights:body.weights??JSON.parse(row.weights_json),
     payout_scale:body.payout_scale??row.payout_scale,
     contribution_bps:body.contribution_bps??row.contribution_bps,
     max_win:body.max_win??row.max_win
   };
   if(!Array.isArray(next.bets)||!next.bets.length||next.bets.length>20||
     next.bets.some(v=>!safeInteger(v)||v<100||v>10000000)||new Set(next.bets).size!==next.bets.length||
     Object.keys(next.weights).length!==KEYS.length||
     KEYS.some(k=>typeof next.weights[k]!=='number'||next.weights[k]<0.1||next.weights[k]>100)||
     typeof next.payout_scale!=='number'||next.payout_scale<0.1||next.payout_scale>2||
     !Number.isInteger(next.contribution_bps)||next.contribution_bps<0||next.contribution_bps>1000||
     !safeInteger(next.max_win)||next.max_win===0||next.max_win>1000000000)throw Error('limits');
 }catch{return fail('invalid_cleopatra_settings',400,cors);}
 await db.batch([
   db.prepare('UPDATE sharika_cleopatra_settings SET enabled=?,bets_json=?,weights_json=?,'+
    "payout_scale=?,contribution_bps=?,max_win=?,version=version+1,updated_by=?,updated_at=datetime('now') WHERE id=1")
    .bind(next.enabled,JSON.stringify(next.bets),JSON.stringify(next.weights),
       next.payout_scale,next.contribution_bps,next.max_win,uid),
   db.prepare('INSERT INTO sharika_admin_audit(actor_id,action,details_json) VALUES(?,?,?)')
    .bind(uid,'cleopatra_settings_update',JSON.stringify({before:row,after:next}))
 ]);
 return reply({updated:true,audited:true,version:Number(row.version)+1},200,cors);
}
