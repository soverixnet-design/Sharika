import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SUPERACE_BETS,SUPERACE_SPEC,evaluateSuperAce,simulateRoyalAce,
  superAceTier,superAceTestRng,parseSuperAceConfig} from '../src/superace-spec-v1.mjs';
import {handleRoyalAce} from '../src/royal-ace.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const sql=name=>readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8');
function fixture(){
 const dbSql=new DatabaseSync(':memory:');
 for(const migration of ['0001_initial.sql','0046_admin_game_catalog.sql',
   '0098_royal_ace_deluxe.sql','0099_royal_ace_bonus_buy_10x.sql',
   '0100_superace_owner_spec_v1.sql'])dbSql.exec(sql(migration));
 const users=dbSql.prepare(
  'INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)');
 users.run(10000011,'adult-a','Adult A','1991-01-01',0,1000000);
 users.run(10000012,'minor-b','Minor','2015-01-01',1,1000000);
 users.run(10000013,'adult-c','Adult C','1994-01-01',0,1000000);
 const db={prepare(statement){const stmt=dbSql.prepare(statement);let args=[];
  return {bind(...x){args=x;return this;},
   async first(){return stmt.get(...args)||null;},
   async all(){return {results:stmt.all(...args)};},
   async run(){return {meta:stmt.run(...args)};}}}};
 const reply=(value,status=200)=>Response.json(value,{status});
 const fail=(error,status)=>Response.json({error},{status});
 const route=(action,body=null,uid='adult-a',legacy=false)=>
  handleRoyalAce({request:new Request(
    'https://api.invalid/'+(legacy?'api/v1/royal-ace/':'api/superace/')+action,{
     method:['state','history'].includes(action)?'GET':'POST',
     ...(['state','history'].includes(action)?{}:
       {body:JSON.stringify(body),headers:{'content-type':'application/json'}})
   }),db,uid,action,reply,fail,cors:{}});
 const enable=()=>{dbSql.exec(
   "UPDATE sharika_royal_ace_settings SET enabled=1 WHERE id=1;"+
   "UPDATE sharika_game_catalog SET enabled=1 WHERE id='royal-ace';");};
 const advance=()=>dbSql.exec('UPDATE sharika_royal_ace_rounds SET created_ms=1;');
 return {dbSql,db,route,enable,advance};
}
test('owner Section 12 values, corrected ways and BIG tiers',()=>{
 assert.deepEqual(SUPERACE_BETS,[100,200,500,1000,2000,5000,10000,50000]);
 assert.equal(SUPERACE_SPEC.scatterBps,115);
 assert.equal(SUPERACE_SPEC.goldenPercent,5);
 assert.equal(SUPERACE_SPEC.starPercent,20);
 assert.equal(SUPERACE_SPEC.buyBonusMultiplier,50);
 const grid=Array.from({length:5},()=>Array.from({length:4},()=>({s:8,g:false})));
 grid[0][0].s=0;grid[0][1].s=0;
 grid[1][0].s=0;grid[1][1].s=9;
 grid[2][0].s=0;
 const r=evaluateSuperAce(grid,100);
 assert.equal(r.baseWin,4,'4 ways × 0.5 pay × (100/50)');
 assert.equal(r.stepWin,4);
 assert.deepEqual(r.marks,[0,1,4,5,8]);
 assert.equal(superAceTier(2000,100).tier,'BIG');
 assert.equal(superAceTier(5000,100).tier,'MEGA');
 assert.equal(superAceTier(12000,100).tier,'SUPER');
});
test('cryptographic round output, payout cap, scatter/free rules',()=>{
 for(const bet of [100,1000,50000])for(const free of [false,true]){
  for(let i=0;i<150;i++){
   const round=simulateRoyalAce(bet,free,500000000,superAceTestRng(i+1));
   assert.ok(round.win>=0&&round.win<=bet*10000);
   assert.equal(round.initialGrid.length,5);
   assert.equal(round.finalGrid.length,5);
   assert.ok(round.steps.length>=1&&round.steps.length<=128);
   for(const step of round.steps){
    assert.equal(step.grid.length,5);
    assert.equal(step.nextGrid.length,5);
    assert.ok(Number.isSafeInteger(step.stepWin));
    assert.ok(step.stepWin>=0);
    for(const col of step.grid)assert.equal(col.length,4);
    for(const col of step.nextGrid)assert.equal(col.length,4);
    for(const [reel,row] of step.markCoords){
     assert.ok(step.marks.includes(reel*4+row));
    }
   }
  }
 }
 const allScatter=()=>0;
 assert.equal(simulateRoyalAce(100,false,500000000,allScatter).bonusSpins,10);
 assert.equal(simulateRoyalAce(100,true,500000000,allScatter).bonusSpins,5);
});
test('migration starts disabled and leaves original rounds and coins unchanged',()=>{
 const f=fixture();
 const a=f.dbSql.prepare("SELECT coins FROM sharika_users WHERE auth_uid='adult-a'").get().coins;
 const conf=f.dbSql.prepare('SELECT * FROM sharika_royal_ace_settings WHERE id=1').get();
 assert.equal(conf.enabled,0);
 assert.equal(conf.bets_json,JSON.stringify(SUPERACE_BETS));
 assert.equal(conf.max_win,500000000);
 assert.equal(a,1000000);
 f.dbSql.close();
});
test('owner REST APIs, 50x Buy Bonus, free session persistence, history, exact retries',async()=>{
 const f=fixture();f.enable();
 const state=await(await f.route('state')).json();
 assert.deepEqual(state.bets,SUPERACE_BETS);
 assert.equal(state.history.length,0);
 assert.equal((await f.route('spin',{bet:101,idempotencyKey:'sa_invalid_000001'})).status,400);
 assert.equal((await f.route('spin',{bet:100,idempotencyKey:'sa_minor_000001'},'minor-b')).status,403);
 const paidKey='sa_new_paid_00001',paidInput={bet:100,idempotencyKey:paidKey};
 const paid=await(await f.route('spin',paidInput)).json();
 assert.equal(paid.bet,100);assert.equal(paid.mode,'paid');
 assert.equal(paid.balanceAfter,1000000-100+paid.totalWin);
 assert.equal(paid.balanceBefore,1000000);
 assert.ok(paid.steps.length);
 assert.equal(paid.bigWin?.tier??null,superAceTier(paid.win,paid.bet)?.tier??null);
 // Retry is identical, no second debit or second wallet ledger.
 assert.deepEqual(await(await f.route('spin',paidInput)).json(),paid);
 assert.equal(f.dbSql.prepare("SELECT COUNT(*) n FROM sharika_royal_ace_rounds").get().n,1);
 f.advance();
 const bonusKey='sa_bonus_00000001';
 const buy=await(await f.route('buy-bonus',{bet:100,idempotencyKey:bonusKey})).json();
 assert.equal(buy.mode,'bonus_buy');
 assert.equal(buy.win,0);assert.equal(buy.freeSpins,10);
 assert.equal(buy.balanceAfter,paid.balanceAfter-5000);
 assert.ok(buy.freeGame.sessionId.startsWith('sa_'));
 assert.equal(buy.freeGame.spinsTotal,10);
 assert.deepEqual(await(await f.route('buy-bonus',{bet:100,idempotencyKey:bonusKey})).json(),buy);
 assert.equal((await f.route('spin',{bet:100,idempotencyKey:'sa_block_free_00001'})).status,409);
 f.advance();
 const sessionId=buy.freeGame.sessionId;
 const idempotencyKey='sa_free_game_0001';
 const free=await(await f.route('freespin',{sessionId,idempotencyKey})).json();
 assert.equal(free.isFree,true);
 assert.equal(free.balanceBefore,buy.balanceAfter);
 assert.equal(free.balanceAfter,buy.balanceAfter+free.win);
 assert.equal(free.freeGame.spinsDone,1);
 assert.ok(free.freeGame.spinsLeft>=9);
 assert.deepEqual(await(await f.route('freespin',{sessionId,idempotencyKey})).json(),free);
 assert.equal((await f.route('freespin',{sessionId:'sa_wrong_0000',idempotencyKey:'sa_bad_session001'})).status,409);
 const rounds=(await(await f.route('history')).json()).history;
 assert.equal(rounds.length,3);
 assert.equal(f.dbSql.prepare("SELECT COUNT(*) n FROM sharika_wallet_ledger WHERE reason='royal_ace_bonus'").get().n,1);
 assert.equal(f.dbSql.prepare("SELECT COUNT(*) n FROM sharika_royal_ace_sessions WHERE status='open'").get().n,1);
 // A concurrent old/new client cannot mint a second independent coin ledger.
 const [again,other]=await Promise.all([
  f.route('spin',{bet:100,idempotencyKey:paidKey}),
  f.route('spin',{bet:100,idempotencyKey:'sa_racing_000001'})]);
 assert.equal(again.status,200);
 assert.ok([409,429].includes(other.status));
 assert.equal(f.dbSql.prepare('SELECT COUNT(*) n FROM sharika_royal_ace_rounds').get().n,3);
 f.dbSql.close();
});
test('legacy staging API remains compatible without changing previous payouts',async()=>{
 const f=fixture();f.enable();
 const input={bet:1000,requestId:'ra_legacy_000001',buy:false};
 const result=await(await f.route('spin',input,'adult-a',true)).json();
 assert.equal(result.balance,1000000-1000+result.win);
 assert.deepEqual(await(await f.route('spin',input,'adult-a',true)).json(),result);
 f.dbSql.close();
});

test('migration preserves a historic 10x bonus, wallet ledger, and pending free spins',()=>{
 const old=new DatabaseSync(':memory:');
 for(const migration of ['0001_initial.sql','0046_admin_game_catalog.sql',
  '0098_royal_ace_deluxe.sql','0099_royal_ace_bonus_buy_10x.sql'])
  old.exec(sql(migration));
 old.prepare('INSERT INTO sharika_users(public_no,auth_uid,name,birthdate,minor,coins) VALUES(?,?,?,?,?,?)')
   .run(10000123,'historic-user','Historic','1991-01-01',0,1000000);
 old.exec("UPDATE sharika_royal_ace_settings SET enabled=1 WHERE id=1");
 old.exec("UPDATE sharika_game_catalog SET enabled=1 WHERE id='royal-ace'");
 old.prepare('INSERT INTO sharika_royal_ace_rounds '+
  '(user_uid,request_id,bet,mode,cost,steps_json,win,bonus_spins,created_ms) '+
  'VALUES(?,?,?,?,?,?,?,?,?)')
  .run('historic-user','historic_buy_001',1000,'bonus_buy',10000,'[]',0,10,1);
 const balance=old.prepare("SELECT coins FROM sharika_users WHERE auth_uid='historic-user'").get().coins;
 const ledger=old.prepare("SELECT COUNT(*) n FROM sharika_wallet_ledger WHERE auth_uid='historic-user'").get().n;
 assert.equal(balance,990000);
 assert.equal(old.prepare("SELECT remaining FROM sharika_royal_ace_free WHERE user_uid='historic-user'").get().remaining,10);
 old.exec(sql('0100_superace_owner_spec_v1.sql'));
 assert.equal(old.prepare("SELECT coins FROM sharika_users WHERE auth_uid='historic-user'").get().coins,balance);
 assert.equal(old.prepare("SELECT COUNT(*) n FROM sharika_wallet_ledger WHERE auth_uid='historic-user'").get().n,ledger);
 const prior=old.prepare("SELECT cost,mode,result_json,receipt_json FROM sharika_royal_ace_rounds WHERE user_uid='historic-user'").get();
 assert.equal(prior.cost,10000);
 assert.equal(prior.mode,'bonus_buy');
 assert.equal(prior.result_json,null);
 assert.equal(prior.receipt_json,null);
 const session=old.prepare("SELECT * FROM sharika_royal_ace_sessions WHERE user_uid='historic-user' AND status='open'").get();
 assert.equal(session.bet,1000);
 assert.equal(session.spins_total,10);
 assert.equal(session.spins_done,0);
 assert.equal(old.prepare("SELECT enabled FROM sharika_royal_ace_settings WHERE id=1").get().enabled,0);
 old.close();
});

test('RTP tuning parameters are validated, persisted and affect only future rounds',()=>{
 const f=fixture();
 const config=f.dbSql.prepare('SELECT * FROM sharika_royal_ace_spec_config WHERE id=1').get();
 const defaults=parseSuperAceConfig(config);
 assert.equal(defaults.scatterBps,115);
 assert.equal(defaults.goldenPercent,5);
 assert.equal(defaults.starPercent,20);
 assert.equal(defaults.betDivisor,50);
 assert.deepEqual(defaults.symbolWeights,[6,7,8,9,10,10,11,11]);
 const grid=Array.from({length:5},()=>Array.from({length:4},()=>({s:8,g:false})));
 grid[0][0].s=0;grid[0][1].s=0;grid[1][0].s=0;grid[1][1].s=9;grid[2][0].s=0;
 assert.equal(evaluateSuperAce(grid,100,false,0,defaults).stepWin,4);
 f.dbSql.prepare('UPDATE sharika_royal_ace_spec_config SET bet_divisor=25 WHERE id=1').run();
 const tuned=parseSuperAceConfig(f.dbSql.prepare(
  'SELECT * FROM sharika_royal_ace_spec_config WHERE id=1').get());
 assert.equal(evaluateSuperAce(grid,100,false,0,tuned).stepWin,8);
 assert.throws(()=>parseSuperAceConfig({...config,weights_json:'[0,0,0]'}),/invalid_superace_weights/);
 assert.throws(()=>parseSuperAceConfig({...config,scatter_bps:10001}),/invalid_superace_probabilities/);
 assert.equal(f.dbSql.prepare('SELECT COUNT(*) n FROM sharika_royal_ace_rounds').get().n,0);
 f.dbSql.close();
});
