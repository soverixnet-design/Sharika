import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {ORIGINAL_ROUND_MS,originalOutcome,originalPayout} from '../src/original-games.mjs';

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
