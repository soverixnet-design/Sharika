import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { roundResult, handleGameRequest, settleDueBets } from '../src/games.mjs';
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
