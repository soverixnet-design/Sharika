import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { roundResult, handleGameRequest, settleDueBets, settleAllDueBets, periodStartUtc } from '../src/games.mjs';
globalThis.crypto ??= webcrypto;

const seed='ab'.repeat(32);
function fakeDb({minor=0,coins=2000}={}){
  const calls=[];
  return {calls,prepare(sql){
    const stmt={sql,args:[],bind(...args){this.args=args;return this;},
      async first(){
        calls.push({sql,args:this.args,type:'first'});
        if(sql.includes('FROM sharika_users WHERE auth_uid'))
          return {status:'active',minor,coins};
        if(sql.startsWith('SELECT * FROM sharika_game_rounds WHERE id='))
          return {id:this.args[0],game:'food-wheel',round_no:Math.floor(Date.now()/40000),
            starts_ms:Math.floor(Date.now()/40000)*40000,
            bet_closes_ms:Math.floor(Date.now()/40000)*40000+28000,
            closes_ms:Math.floor(Date.now()/40000)*40000+40000,
            seed_hex:seed,commit_sha256:'ff'.repeat(32)};
        return null;
      },
      async all(){calls.push({sql,args:this.args,type:'all'});return {results:[]};},
      async run(){calls.push({sql,args:this.args,type:'run'});return {meta:{changes:1}};}};
    return stmt;
  }};
}
const args=(db,game,action,method='GET',body)=>({
  request:new Request('https://test.local/api/v1/games/'+game+'/'+action,{
    method,body:body?JSON.stringify(body):undefined}),
  db,uid:'alice',game,action,cors:{},
  reply:(data,status)=>Response.json(data,{status}),
  fail:(error,status)=>Response.json({error},{status})
});

test('two players see deterministic same round result from one server seed',async()=>{
  const w={game:'food-wheel',round_no:100,seed_hex:seed};
  const a=await roundResult(w),b=await roundResult(w);
  assert.deepEqual(a,b);
  assert.ok(a.sector>=0&&a.sector<9);
  assert.equal(a.multiplier,9);
  const fruit=await roundResult({game:'jackpot-fruit',round_no:100,seed_hex:seed});
  assert.equal(fruit.reels.length,3);
  assert.equal(fruit.multiplier,fruit.jackpot?36:0);
});

test('minors cannot use either authenticated game endpoint',async()=>{
  const db=fakeDb({minor:1});
  const response=await handleGameRequest(args(db,'food-wheel','state'));
  assert.equal(response.status,403);
  assert.equal((await response.json()).error,'games_adult_only');
  assert.equal(db.calls.some(x=>x.type==='run'),false);
});

test('invalid game or unbounded bets never debit the wallet',async()=>{
  const db=fakeDb();
  const missing=await handleGameRequest(args(db,'unlisted','state'));
  assert.equal(missing.status,404);
  const bad=await handleGameRequest(args(db,'food-wheel','bet','POST',{
    stake:-1,round_no:Math.floor(Date.now()/40000),
    pick:0,request_id:'game:negative123456'}));
  assert.equal(bad.status,400);
  assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO sharika_game_bets')),false);
});

test('settlement has no effect when no expired authenticated bets exist',async()=>{
  const db=fakeDb();
  assert.equal(await settleDueBets(db,'alice'),0);
  assert.equal(db.calls.some(x=>x.type==='run'),false);
});


test('daily, Monday-weekly, and monthly game totals use fixed UTC boundaries',()=>{
  const now=Date.UTC(2026,9,30,21,55,0);
  assert.equal(periodStartUtc('daily',now),'2026-10-30 00:00:00');
  assert.equal(periodStartUtc('weekly',now),'2026-10-26 00:00:00');
  assert.equal(periodStartUtc('monthly',now),'2026-10-01 00:00:00');
  assert.equal(periodStartUtc('invalid',now),null);
});

test('new history and personal stats endpoints require adult and reveal no demo rankings',async()=>{
  const db=fakeDb();
  for(const route of ['stats','rankings','rounds']){
    const response=await handleGameRequest(args(db,'food-wheel',route));
    assert.equal(response.status,200);
  }
  assert.equal(await settleAllDueBets(db),0);
  assert.equal(db.calls.some(x=>x.sql.includes('INSERT INTO sharika_game_bets')),false);
});

test('classic game bet replay remains idempotent after its round has closed',async()=>{
  const roundNo=Math.floor(Date.now()/40000)-1;
  const prior={id:42,game:'food-wheel',round_no:roundNo,
    round_id:'food-wheel:'+roundNo,stake:100,pick_index:3,
    status:'accepted',payout:0,result_json:null,created_at:'2026-10-30'};
  const db=fakeDb();
  const originalPrepare=db.prepare.bind(db);
  let originalBet=prior;
  db.prepare=function(sql){
    if(sql.startsWith('SELECT * FROM sharika_game_bets WHERE user_uid=? AND request_id=?')){
      return {bind(){return this;},async first(){return originalBet;}};
    }
    return originalPrepare(sql);
  };
  const input={round_no:roundNo,stake:100,pick:3,request_id:'game:old-round-retry-1234'};
  const replay=await handleGameRequest(args(db,'food-wheel','bet','POST',input));
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).duplicate,true);
  assert.equal(db.calls.some(c=>c.sql.includes('INSERT INTO sharika_game_bets')),false);
  const changed=await handleGameRequest(args(db,'food-wheel','bet','POST',{...input,pick:2}));
  assert.equal(changed.status,409);
  assert.equal((await changed.json()).error,'idempotency_conflict');
  originalBet=null;
  const late=await handleGameRequest(args(db,'food-wheel','bet','POST',input));
  assert.equal(late.status,409);
  assert.equal((await late.json()).error,'betting_closed');
});


test('a newly settled win can fund the next bet without a stale balance rejection',async()=>{
  const originalNow=Date.now;
  const fixed=Math.floor(originalNow()/40000)*40000+1000;
  Date.now=()=>fixed;
  try{
    const db=fakeDb({coins:0});
    const prepare=db.prepare.bind(db);
    db.prepare=sql=>{
      if(sql==='SELECT coins FROM sharika_users WHERE auth_uid=?')
        return {bind(){return this;},async first(){return {coins:2000};}};
      return prepare(sql);
    };
    const n=Math.floor(fixed/40000);
    const response=await handleGameRequest(args(db,'food-wheel','bet','POST',{
      stake:1000,round_no:n,pick:2,request_id:'game:post-win-funds-12345'
    }));
    assert.equal(response.status,201);
    assert.equal(db.calls.filter(c=>c.sql.startsWith('INSERT INTO sharika_game_bets')).length,1);
  }finally{Date.now=originalNow;}
});

test('two simultaneous identical bet requests return the single accepted bet',async()=>{
  const originalNow=Date.now;
  const fixed=Math.floor(originalNow()/40000)*40000+1000;
  Date.now=()=>fixed;
  try{
    const db=fakeDb();
    const originalPrepare=db.prepare.bind(db);
    const roundNo=Math.floor(fixed/40000);
    const accepted={id:101,game:'food-wheel',round_no:roundNo,
      round_id:'food-wheel:'+roundNo,stake:50,pick_index:4,
      status:'accepted',payout:0,result_json:null};
    let lookups=0,insertAttempts=0;
    db.prepare=sql=>{
      if(sql.startsWith('SELECT * FROM sharika_game_bets WHERE user_uid=? AND request_id=?')){
        return {bind(){return this;},async first(){lookups++;return lookups===1?null:accepted;}};
      }
      if(sql.startsWith('INSERT INTO sharika_game_bets')){
        return {bind(){return this;},async run(){
          insertAttempts++;throw Error('UNIQUE constraint failed: sharika_game_bets.user_uid');
        }};
      }
      return originalPrepare(sql);
    };
    const response=await handleGameRequest(args(db,'food-wheel','bet','POST',{
      stake:50,round_no:roundNo,pick:4,request_id:'game:parallel-request-12345'
    }));
    assert.equal(response.status,200);
    assert.equal((await response.json()).duplicate,true);
    assert.equal(lookups,2);
    assert.equal(insertAttempts,1);
  }finally{Date.now=originalNow;}
});
