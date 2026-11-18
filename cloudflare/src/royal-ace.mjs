// Super Ace Deluxe: authenticated server settlement over Sharika's non-cash coins.
// New owner-spec endpoints are /api/superace/*. Old /api/v1/royal-ace
// requests remain compatible with existing staging clients.
import {simulateRoyalAce,superAceTier,SUPERACE_BETS,SUPERACE_SPEC} from './superace-spec-v1.mjs';
export {simulateRoyalAce} from './superace-spec-v1.mjs';
const INT=x=>Number.isSafeInteger(x)&&x>=0;
const ID=/^[A-Za-z0-9:_-]{12,100}$/;
const BASE='/api/superace/';
const success=(value,reply,cors,status=200)=>reply(value,status,cors);
function info(r,session){
  // Historical retry must be byte-for-byte value-equivalent even when the
  // player's Free Session later advances or closes.
  if(r.receipt_json)return JSON.parse(r.receipt_json);
  const financial=Number(r.balance_after);
  const win=Number(r.win),cost=Number(r.cost),bet=Number(r.bet);
  const raw=r.result_json?JSON.parse(r.result_json):null;
  const result=raw||{initialGrid:[],steps:JSON.parse(r.steps_json),
    finalGrid:[],scatterCount:0,bigWin:superAceTier(win,bet)};
  const freeGame=session&&session.status==='open'?{
    sessionId:session.id,spinsTotal:Number(session.spins_total),
    spinsDone:Number(session.spins_done),
    spinsLeft:Math.max(0,Number(session.spins_total)-Number(session.spins_done)),
    totalWin:Number(session.total_win),bet:Number(session.bet),
    triggered:r.mode==='paid'&&Number(r.bonus_spins)===10,
    extraSpins:r.mode==='free'?Number(r.bonus_spins):0
  }:null;
  const round={
    roundId:'superace-'+r.id,requestId:r.request_id,
    bet,isFree:r.mode==='free',mode:r.mode,initialGrid:result.initialGrid,
    steps:result.steps,totalWin:win,win,finalGrid:result.finalGrid,
    scatterCount:Number(result.scatterCount)||0,
    bigWin:result.bigWin||null,freeGame,
    balanceBefore:financial+cost-win,balanceAfter:financial,
    balance:financial,freeSpins:Number(r.free_after)||0,
    bonusSpins:Number(r.bonus_spins)||0,virtual_coins_only:true,
    settled:true,specVersion:SUPERACE_SPEC.version
  };
  return round;
}
async function userState(db,uid){
  const [u,conf,fs,session]=await Promise.all([
    db.prepare("SELECT coins,minor,status FROM sharika_users WHERE auth_uid=?").bind(uid).first(),
    db.prepare("SELECT enabled,bets_json,max_win FROM sharika_royal_ace_settings WHERE id=1").first(),
    db.prepare("SELECT remaining,bet FROM sharika_royal_ace_free WHERE user_uid=?").bind(uid).first(),
    db.prepare("SELECT * FROM sharika_royal_ace_sessions WHERE user_uid=? AND status='open'").bind(uid).first()
  ]);
  return {u,conf,fs,session};
}
async function readRound(db,uid,key){
  return db.prepare("SELECT * FROM sharika_royal_ace_rounds WHERE user_uid=? AND request_id=?")
    .bind(uid,key).first();
}
async function history(db,uid,limit=30){
  const rows=await db.prepare(
    "SELECT id,bet,mode,win,cost,created_at,balance_after,free_after,bonus_spins "+
    "FROM sharika_royal_ace_rounds WHERE user_uid=? ORDER BY id DESC LIMIT ?")
    .bind(uid,limit).all();
  return (rows.results||[]).map(r=>({
    roundId:'superace-'+r.id,bet:Number(r.bet),isFree:r.mode==='free',
    mode:r.mode,totalWin:Number(r.win),win:Number(r.win),
    time:r.created_at,balanceAfter:Number(r.balance_after),
    freeSpins:Number(r.free_after),bonusSpins:Number(r.bonus_spins)
  }));
}
function isEligible(s){return s.u&&s.u.status==='active'&&!s.u.minor}
function toFree(session,fs){
  return session&&session.status==='open'?{
    sessionId:session.id,bet:Number(session.bet),
    spinsTotal:Number(session.spins_total),
    spinsDone:Number(session.spins_done),
    spinsLeft:Number(fs?.remaining)||0,totalWin:Number(session.total_win),
    triggered:true,extraSpins:0
  }:null;
}
export async function handleRoyalAce({request,db,uid,action,reply,fail,cors}){
  const isLegacy=new URL(request.url).pathname.startsWith('/api/v1/royal-ace/');
  if(!['state','spin','freespin','buy-bonus','history'].includes(action))
    return fail('method_not_allowed',405,cors);
  if(action==='state'||action==='history'){
    if(request.method!=='GET')return fail('method_not_allowed',405,cors);
    const s=await userState(db,uid);
    if(!isEligible(s))return fail('game_not_eligible',403,cors);
    if(!s.conf?.enabled)return fail('game_disabled',403,cors);
    if(action==='history'){
      const n=Number(new URL(request.url).searchParams.get('limit')||30);
      return success({history:await history(db,uid,INT(n)&&n>0?Math.min(n,30):30)},reply,cors);
    }
    return success({
      balance:Number(s.u.coins),bets:JSON.parse(s.conf.bets_json),
      freeSpins:Number(s.fs?.remaining)||0,lockedBet:Number(s.fs?.bet)||0,
      freeGame:toFree(s.session,s.fs),history:await history(db,uid),
      specVersion:SUPERACE_SPEC.version,virtual_coins_only:true
    },reply,cors);
  }
  if(request.method!=='POST')return fail('method_not_allowed',405,cors);
  let b;
  try{const raw=await request.text();if(raw.length>512)throw Error('too_large');b=JSON.parse(raw);}
  catch{return fail('invalid_spin_request',400,cors)}
  if(!b||typeof b!=='object'||Array.isArray(b))
    return fail('invalid_spin_request',400,cors);
  const key=isLegacy?b.requestId:b.idempotencyKey;
  if(typeof key!=='string'||!ID.test(key))
    return fail('invalid_spin_request',400,cors);
  const old=await readRound(db,uid,key);
  // Do not allow the same idempotency key to authorize a different action.
  let desiredMode=action==='buy-bonus'?'bonus_buy':action==='freespin'?'free':'paid';
  let s=await userState(db,uid);
  if(!isEligible(s))return fail('game_not_eligible',403,cors);
  if(!s.conf?.enabled)return fail('game_disabled',403,cors);
  const open=Number(s.fs?.remaining)||0;
  if(isLegacy){
    if(typeof b.buy!=='boolean')return fail('invalid_spin_request',400,cors);
    desiredMode=b.buy?'bonus_buy':open?'free':'paid';
  }
  if(old){
    if(old.mode!==desiredMode || (desiredMode!=='free'&&Number(old.bet)!==b.bet))
      return fail('request_id_conflict',409,cors);
    const session=await db.prepare(
      "SELECT * FROM sharika_royal_ace_sessions WHERE user_uid=? AND status='open'")
      .bind(uid).first();
    return success(info(old,session),reply,cors);
  }
  if(action==='freespin'){
    if(!s.session||!open||typeof b.sessionId!=='string'||
       s.session.id!==b.sessionId)return fail('FREE_GAME_OPEN',409,cors);
  }else if(!isLegacy&&open)return fail('FREE_GAME_OPEN',409,cors);
  if(desiredMode==='free'&&!open)return fail('FREE_GAME_OPEN',409,cors);
  const bet=desiredMode==='free'?Number(s.fs?.bet):b.bet;
  if(!INT(bet)||bet<1||!SUPERACE_BETS.includes(bet))
    return fail('INVALID_BET',400,cors);
  if(desiredMode==='free'&&isLegacy&&b.bet!==bet)
    return fail('free_spin_bet_locked',409,cors);
  if(!s.conf||!JSON.parse(s.conf.bets_json).includes(bet))
    return fail('INVALID_BET',400,cors);
  const cost=desiredMode==='bonus_buy'?bet*SUPERACE_SPEC.buyBonusMultiplier
    :desiredMode==='free'?0:bet;
  if(!INT(cost)||Number(s.u.coins)<cost)return fail('INSUFFICIENT_BALANCE',409,cors);
  const result=desiredMode==='bonus_buy'?
    {initialGrid:[],steps:[],finalGrid:[],scatterCount:0,win:0,totalWin:0,
     bonusSpins:10,bigWin:null,specVersion:SUPERACE_SPEC.version}
     :simulateRoyalAce(bet,desiredMode==='free',Number(s.conf.max_win));
  // The INSERT trigger atomically validates mode, balance, price, user, rate,
  // D1 wallet debit, payout, free session and wallet ledger. Never trust client results.
  try{
    await db.prepare("INSERT INTO sharika_royal_ace_rounds "+
      "(user_uid,request_id,bet,mode,cost,steps_json,win,bonus_spins,result_json,created_ms) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind(uid,key,bet,desiredMode,cost,JSON.stringify(result.steps),
        result.win,result.bonusSpins,JSON.stringify(result),Date.now()).run();
  }catch(error){
    const duplicate=await readRound(db,uid,key);
    if(duplicate){
      if(duplicate.mode!==desiredMode||Number(duplicate.bet)!==bet)
        return fail('request_id_conflict',409,cors);
      const s2=await userState(db,uid);
      return success(info(duplicate,s2.session),reply,cors);
    }
    const detail=String(error?.message||error);
    if(detail.includes('royal_insufficient'))return fail('INSUFFICIENT_BALANCE',409,cors);
    if(detail.includes('royal_rate_limited'))return fail('SPIN_IN_PROGRESS',429,cors);
    if(detail.includes('royal_locked_bet'))return fail('free_spin_bet_locked',409,cors);
    if(detail.includes('royal_disabled'))return fail('game_disabled',403,cors);
    if(detail.includes('royal_mode_conflict'))return fail('FREE_GAME_OPEN',409,cors);
    if(detail.includes('royal_invalid_payout'))return fail('invalid_payout_guard',409,cors);
    throw error;
  }
  const row=await readRound(db,uid,key),now=await userState(db,uid);
  if(!row||!INT(Number(row.balance_after)))return fail('missing_round_settlement',503,cors);
  const receipt=info(row,now.session);
  await db.prepare("UPDATE sharika_royal_ace_rounds SET receipt_json=? "+
    "WHERE user_uid=? AND request_id=? AND receipt_json IS NULL")
    .bind(JSON.stringify(receipt),uid,key).run();
  return success(receipt,reply,cors);
}
