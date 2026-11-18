// Royal Ace Deluxe: server-side virtual coins; client is a read-only animator.
// Based on the user's 5x4, 1024-ways, Golden/Joker, scatter and cascade rules.
const PAY=[[2.5,1.5,.5],[2,1.2,.4],[1.5,.9,.3],[1,.6,.2],[.5,.3,.1],[.5,.3,.1],[.25,.15,.05],[.25,.15,.05]];
const MULT=[[1,2,3,5,10],[2,4,6,10,20]];
const WT=[6,7,8,9,10,10,11,11];
const INT=n=>Number.isSafeInteger(n)&&n>=0;
const ID=/^[a-zA-Z0-9_-]{12,100}$/;
const TOTAL=WT.reduce((a,b)=>a+b,0);
function secureInt(max){
  if(!INT(max)||max<1||max>4294967295)throw Error('invalid_random_range');
  const a=new Uint32Array(1),range=4294967296,limit=range-range%max;
  do{crypto.getRandomValues(a);}while(a[0]>=limit);
  return a[0]%max;
}
function draw(c){
  let s=8;
  if(secureInt(1000)>=18){let n=secureInt(TOTAL);for(let i=0;i<WT.length;i++){
    n-=WT[i];if(n<0){s=i;break;}
  }}
  return {s,g:s<8&&c>=1&&c<=3&&secureInt(10)===0};
}
const makeGrid=()=>Array.from({length:5},(_,c)=>Array.from({length:4},()=>draw(c)));
const copy=grid=>grid.map(col=>col.map(x=>({s:x.s,g:!!x.g})));
function evaluate(grid,bet,free,combo){
  const marks=new Set();let raw=0;
  for(let s=0;s<8;s++){
    const counts=[];
    for(let c=0;c<5;c++){
      let count=0;for(let r=0;r<4;r++)if(grid[c][r].s===s||grid[c][r].s>=9)count++;
      if(!count)break;counts.push(count);
    }
    if(counts.length<3)continue;
    const ways=counts.reduce((a,b)=>a*b,1);
    raw+=PAY[s][5-counts.length]*ways*bet;
    for(let c=0;c<counts.length;c++)for(let r=0;r<4;r++)
      if(grid[c][r].s===s||grid[c][r].s>=9)marks.add(c*4+r);
  }
  return {win:Math.floor(raw*MULT[free?1:0][Math.min(combo,4)]),marks:[...marks]};
}
function cascade(grid,marks,combo){
  let bigJokers=0;
  for(const k of marks){
    const c=Math.floor(k/4),r=k%4,x=grid[c][r];
    if(x.g){
      const big=secureInt(2)===0;
      if(big)bigJokers++;
      // Golden cards transform into a big/little Joker and stay in place.
      grid[c][r]={s:big?9:10,g:false};
    }else grid[c][r]=null;
  }
  for(let c=0;c<5;c++){
    const remaining=grid[c].filter(Boolean);
    grid[c]=Array.from({length:4-remaining.length},()=>draw(c)).concat(remaining);
  }
  // The original Big Joker replicates 1 to 4 times on reels 2–5.
  for(let n=0;n<Math.min(bigJokers,12);n++){
    const copies=1+secureInt(4);
    for(let i=0;i<copies;i++){
      const c=1+secureInt(4),r=secureInt(4);
      if(grid[c][r].s<8)grid[c][r]={s:9,g:false};
    }
  }
  // Original Star Card may trigger after combos 2–4 and always after combo 5.
  if(combo>=1&&(combo>=4||secureInt(100)<45)){
    let changed=0;
    for(let tries=0;tries<12&&changed<3;tries++){
      const c=1+secureInt(3),r=secureInt(4),x=grid[c][r];
      if(x.s<8&&!x.g){grid[c][r].g=true;changed++;}
    }
  }
  return grid;
}
export function simulateRoyalAce(bet,free=false,maxWin=100000000){
  if(!INT(bet)||bet<1||!INT(maxWin)||maxWin<1)throw Error('invalid_royal_round');
  // Tuned staging economics: future spins pay 7.5% of the original ways-table gross.
  // Each round also caps credited winnings at 10x the stake; no historical ledgers change.
  // Keep these limits mirrored in the client Rules panel.
  const payoutBps=750,cap=Math.min(maxWin,bet*10);
  const g=makeGrid(),steps=[{grid:copy(g),marks:[],combo:0,multiplier:MULT[free?1:0][0]}];
  let total=0;
  for(let combo=0;combo<8;combo++){
    const result=evaluate(g,bet,free,combo);
    if(!result.marks.length)break;
    total=Math.min(Math.ceil(cap*10000/payoutBps),total+result.win);
    steps[steps.length-1].marks=result.marks;
    steps[steps.length-1].payout=Math.min(cap,Math.floor(result.win*payoutBps/10000));
    if(Math.floor(total*payoutBps/10000)>=cap)break;
    cascade(g,result.marks,combo);
    steps.push({grid:copy(g),marks:[],combo:Math.min(combo+1,4),
      multiplier:MULT[free?1:0][Math.min(combo+1,4)]});
  }
  let scatters=0;for(const col of g)for(const x of col)if(x.s===8)scatters++;
  return {steps,win:Math.floor(Math.min(cap,total*payoutBps/10000)),bonusSpins:scatters>=3?(free?5:10):0};
}
async function getState(db,uid){
  const [u,conf,fs]=await Promise.all([
    db.prepare("SELECT coins,minor,status FROM sharika_users WHERE auth_uid=?").bind(uid).first(),
    db.prepare("SELECT enabled,bets_json,max_win FROM sharika_royal_ace_settings WHERE id=1").first(),
    db.prepare("SELECT remaining,bet FROM sharika_royal_ace_free WHERE user_uid=?").bind(uid).first()
  ]);
  return {u,conf,fs};
}
async function savedRound(db,uid,id){return db.prepare(
  "SELECT * FROM sharika_royal_ace_rounds WHERE user_uid=? AND request_id=?"
).bind(uid,id).first();}
function output(r){return {
  requestId:r.request_id,bet:Number(r.bet),mode:r.mode,
  win:Number(r.win),balance:Number(r.balance_after),
  freeSpins:Number(r.free_after),bonusSpins:Number(r.bonus_spins),
  steps:JSON.parse(r.steps_json),virtual_coins_only:true,settled:true
};}
export async function handleRoyalAce({request,db,uid,action,reply,fail,cors}){
  if(action==='state'&&request.method==='GET'){
    const s=await getState(db,uid);
    if(!s.u||s.u.status!=='active'||s.u.minor)return fail('game_not_eligible',403,cors);
    if(!s.conf||!s.conf.enabled)return fail('game_disabled',403,cors);
    return reply({balance:Number(s.u.coins),bets:JSON.parse(s.conf.bets_json),
      freeSpins:Number(s.fs?.remaining||0),lockedBet:Number(s.fs?.bet||0),
      virtual_coins_only:true},200,cors);
  }
  if(action!=='spin'||request.method!=='POST')return fail('method_not_allowed',405,cors);
  let b;try{const t=await request.text();if(t.length>512)throw Error('too_large');b=JSON.parse(t);}catch{
    return fail('invalid_spin_request',400,cors);
  }
  if(!b||!INT(b.bet)||b.bet===0||typeof b.requestId!=='string'||!ID.test(b.requestId)||
      typeof b.buy!=='boolean')return fail('invalid_spin_request',400,cors);
  const old=await savedRound(db,uid,b.requestId);
  if(old)return Number(old.bet)===b.bet&&
    (old.mode==='bonus_buy')===b.buy?reply(output(old),200,cors):
    fail('request_id_conflict',409,cors);
  const s=await getState(db,uid);
  if(!s.u||s.u.status!=='active'||s.u.minor)return fail('game_not_eligible',403,cors);
  if(!s.conf||!s.conf.enabled)return fail('game_disabled',403,cors);
  const bets=JSON.parse(s.conf.bets_json);
  if(!bets.includes(b.bet))return fail('invalid_bet',400,cors);
  const hasFree=Number(s.fs?.remaining||0)>0;
  if(hasFree&&b.buy)return fail('free_spins_active',409,cors);
  if(hasFree&&Number(s.fs.bet)!==b.bet)return fail('free_spin_bet_locked',409,cors);
  const mode=b.buy?'bonus_buy':hasFree?'free':'paid',cost=b.buy?b.bet*50:hasFree?0:b.bet;
  if(!INT(cost)||Number(s.u.coins)<cost)return fail('not_enough_balance',409,cors);
  const game=b.buy?{steps:[],win:0,bonusSpins:10}:
    simulateRoyalAce(b.bet,hasFree,Number(s.conf.max_win));
  // Trigger performs atomic wallet debit, payout, free-spin update and ledger.
  for(let tries=0;tries<3;tries++){
    try{
      await db.prepare('INSERT INTO sharika_royal_ace_rounds '+
        '(user_uid,request_id,bet,mode,cost,steps_json,win,bonus_spins,created_ms) '+
        'VALUES(?,?,?,?,?,?,?,?,?)')
        .bind(uid,b.requestId,b.bet,mode,cost,JSON.stringify(game.steps),game.win,
          game.bonusSpins,Date.now()).run();
      const row=await savedRound(db,uid,b.requestId);
      if(!row)throw Error('royal_missing_settlement');
      return reply(output(row),200,cors);
    }catch(e){
      const previous=await savedRound(db,uid,b.requestId);
      if(previous)return Number(previous.bet)===b.bet&&
        (previous.mode==='bonus_buy')===b.buy?reply(output(previous),200,cors):
        fail('request_id_conflict',409,cors);
      const detail=String(e?.message||e);
      if(detail.includes('royal_insufficient'))return fail('not_enough_balance',409,cors);
      if(detail.includes('royal_rate_limited'))return fail('spin_rate_limited',429,cors);
      if(detail.includes('royal_locked_bet'))return fail('free_spin_bet_locked',409,cors);
      if(detail.includes('royal_disabled'))return fail('game_disabled',403,cors);
      if(detail.includes('royal_mode_conflict'))return fail('free_spin_conflict',409,cors);
      throw e;
    }
  }
  return fail('spin_conflict_retry',409,cors);
}
