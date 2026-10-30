import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ORIGINAL_ROUND_MS,originalOutcome,originalPayout,handleOriginalGameRequest} from '../src/original-games.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const seed='0123456789abcdef'.repeat(4);
const commit=createHash('sha256').update(seed).digest('hex');

test('original three games share deterministic, auditable 40-second rounds',async()=>{
  assert.equal(ORIGINAL_ROUND_MS,40000);
  for(const game of ['sovera-food','night-food','jackpot-fruit']){
    const row={game,seed_hex:seed,commit_sha256:commit};
    const a=await originalOutcome(row),b=await originalOutcome(row);
    assert.deepEqual(a,b);
    assert.equal(a.commit_sha256,commit);
    assert.ok(a.index>=0&&a.index<8);
    assert.ok(a.positions.every(i=>Number.isInteger(i)&&i>=0&&i<8));
    if(game!=='jackpot-fruit')assert.equal(a.bonus,'');
  }
});
test('original Food Wheel pays only the exact selected food',()=>{
  const answer={index:0,positions:[0],bonus:''};
  assert.equal(originalPayout({game:'sovera-food',pick_index:0,amount:50},answer,0,0),2250);
  assert.equal(originalPayout({game:'sovera-food',pick_index:7,amount:50},answer,0,0),0);
});
test('Night Food Wheel salad and pizza are distinct wager types',()=>{
  const salad={index:4,positions:[4],bonus:''};
  const pizza={index:0,positions:[0],bonus:''};
  const bet=(pick_index)=>({game:'night-food',pick_index,amount:100});
  assert.equal(originalPayout(bet(8),salad,0,0),120);
  assert.equal(originalPayout(bet(8),pizza,0,0),0);
  assert.equal(originalPayout(bet(9),pizza,0,0),400);
  assert.equal(originalPayout(bet(9),salad,0,0),0);
});
test('Jackpot bonuses are authoritative and pool bonuses cannot mint unlimited currency',()=>{
  const base={game:'jackpot-fruit',pick_index:7,amount:100};
  assert.equal(originalPayout(base,{index:7,positions:[7],bonus:''},0,0),4000);
  assert.equal(originalPayout(base,{index:7,positions:[7],bonus:'x2'},0,0),8000);
  assert.equal(originalPayout(base,{index:7,positions:[7],bonus:'x3'},0,0),12000);
  assert.equal(originalPayout(base,{index:7,positions:[7,7],bonus:'+1'},0,0),8000);
  const budget=199,total=700,answer={index:0,positions:[0],bonus:'JP'};
  const amounts=[100,200,400];
  const paid=amounts.reduce((sum,amount)=>sum+originalPayout({
    game:'jackpot-fruit',pick_index:7,amount},answer,budget,total),0);
  assert.ok(paid<=budget);
  assert.ok(paid>=budget-amounts.length);
});
test('real history and winners never arise from local Math.random',()=>{
  const source=originalOutcome.toString()+originalPayout.toString();
  assert.doesNotMatch(source,/Math\.random|localStorage|fake.*winner/i);
});
test('accepted original-game bets survive a retry after the round closes',async()=>{
  const round=Math.floor(Date.now()/ORIGINAL_ROUND_MS)-1;
  const existing={id:76,game:'sovera-food',round_no:round,pick_index:2,
    amount:500,request_id:'original-retry-test-12345'};
  const queries=[];
  let prior=existing;
  const db={prepare(sql){
    return {
      bind(...args){this.args=args;return this;},
      async first(){
        queries.push(sql);
        if(sql.startsWith('SELECT coins,minor,status FROM sharika_users'))
          return {coins:750,minor:0,status:'active'};
        if(sql.startsWith('SELECT * FROM sharika_original_game_bets WHERE user_uid=?'))
          return prior;
        throw Error('Unexpected read: '+sql);
      },
      async run(){throw Error('A retry must never insert another bet');}
    };
  }};
  const reply=(body,status)=>Response.json(body,{status});
  const fail=(error,status)=>Response.json({error},{status});
  const call=body=>handleOriginalGameRequest({
    request:new Request('https://sharika.test/api/v1/original-games/sovera-food/bet',{
      method:'POST',body:JSON.stringify(body),
      headers:{'content-type':'application/json'}
    }),db,uid:'verified-user',game:'sovera-food',action:'bet',reply,fail,cors:{}
  });
  const payload={round_no:round,pick:2,amount:500,request_id:existing.request_id};
  const replay=await call(payload);
  assert.equal(replay.status,200);
  assert.deepEqual(await replay.json(),{
    bet_id:76,duplicate:true,coins:750,round_no:round
  });
  const conflict=await call({...payload,amount:501});
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).error,'idempotency_conflict');
  prior=null;
  const stale=await call({...payload,request_id:'original-stale-new-1234'});
  assert.equal(stale.status,409);
  assert.equal((await stale.json()).error,'betting_closed');
  assert.ok(queries.some(sql=>sql.includes('sharika_original_game_bets')));
});


test('Night Food and Jackpot Fruit advertise 1k chips for small verified wallets',async()=>{
  // A staging account may have only 1,425 coins; the old 10k minimum
  // prevented any manual wager while Sovera Food Wheel appeared to work.
  const now=Date.now();
  const currentRound=Math.floor(now/ORIGINAL_ROUND_MS);
  const db={prepare(sql){
    const stmt={
      bind(...values){this.values=values;return this;},
      async all(){return {results:[]};},
      async first(){
        if(sql.startsWith('SELECT * FROM sharika_original_game_rounds WHERE game=? AND round_no=?'))
          return {id:'round',game:this.values[0],round_no:currentRound,
            commit_sha256:commit,seed_hex:seed};
        if(sql.startsWith('SELECT * FROM sharika_original_game_rounds WHERE game=? AND closes_ms<=?'))
          return null;
        if(sql.startsWith('SELECT coins,minor,status FROM sharika_users'))
          return {coins:1425,minor:0,status:'active'};
        if(sql.includes('FROM sharika_original_game_bets WHERE user_uid=? AND game=?'))
          return null;
        if(sql.includes('FROM sharika_original_game_pools'))
          return {coins:0};
        if(sql.includes('COUNT(*) AS bets'))
          return {bets:0,wagered:0,won:0};
        throw Error('Unexpected SQL query '+sql);
      },
      async run(){throw Error('Read-only game catalog may not write fake balance');}
    };
    return stmt;
  }};
  const reply=(body,status)=>Response.json(body,{status});
  const fail=(error,status)=>Response.json({error},{status});
  for(const game of ['night-food','jackpot-fruit']){
    const res=await handleOriginalGameRequest({
      request:new Request('https://sharika.test/api/v1/original-games/'+game+'/state'),
      db,uid:'verified-user',game,action:'state',reply,fail,cors:{}
    });
    assert.equal(res.status,200);
    const state=await res.json();
    assert.equal(state.coins,1425);
    assert.deepEqual(state.chips,[1000,10000,100000,1000000,10000000]);
    assert.equal(state.virtual_coins_only,true);
  }
});


test('both offline game layouts use the matching server-backed wager chips',()=>{
  for(const [page,token] of [
    ['night-food-wheel.html','const chips=[1000,10000,100000,1000000,10000000];'],
    ['jackpot-fruit.html','CH=[1000,10000,100000,1000000,10000000];']
  ]){
    const html=readFileSync(new URL('../../android-staging/app/src/main/assets/original-games/'+page,import.meta.url),'utf8');
    assert.ok(html.includes(token),page+' must offer the 1k wallet-compatible chip');
    assert.match(html,/sharika:original-request/);
    assert.match(html,/sharika:original-response/);
    assert.doesNotMatch(html,/https?:\/\/[^\s"'<>]+/);
  }
});
