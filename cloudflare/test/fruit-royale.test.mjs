import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {
  FRUIT_V2, FRUIT_BONUSES, FRUIT_ROUND_MS, fruitOutcome, fruitPayout
} from '../src/fruit-royale.mjs';

if(!globalThis.crypto)globalThis.crypto=webcrypto;

test('approved fruit and bonus weights are exact and Fruit +3 is off',()=>{
  assert.equal(FRUIT_ROUND_MS,40_000);
  assert.equal(FRUIT_V2.length,8);
  assert.equal(FRUIT_V2.reduce((n,f)=>n+f.weight,0),78);
  assert.deepEqual(FRUIT_V2.map(x=>x.multiplier),[4,4,4,20,15,10,6,6]);
  assert.deepEqual(FRUIT_V2.map(x=>x.weight),[15,15,15,3,4,6,10,10]);
  assert.equal(FRUIT_BONUSES.reduce((n,b)=>n+b.weight,0),1000);
  assert.deepEqual(FRUIT_BONUSES.map(x=>[x.id,x.weight]),[
    ['none',920],['fruit+1',30],['fruit+2',10],['x2',20],['x3',10],['jackpot',10]
  ]);
  assert.ok(!FRUIT_BONUSES.some(x=>x.id==='fruit+3'));
});

test('server outcomes are deterministic from private seed and within committed weights',async()=>{
  const seed='ab'.repeat(32);
  const first=await fruitOutcome(seed);
  const again=await fruitOutcome(seed);
  assert.deepEqual(first,again);
  assert.ok(['none','fruit+1','fruit+2','x2','x3','jackpot'].includes(first.bonus));
  assert.ok([1,2,3].includes(first.positions.length));
  for(const p of first.positions)assert.ok(Number.isInteger(p)&&p>=0&&p<8);
});

test('base fruit, added fruit, bonus multiplier and funded jackpot calculations',()=>{
  const cherry={pick_index:3,amount:1000};
  assert.equal(fruitPayout(cherry,{positions:[3],multiplier:1}),20000);
  assert.equal(fruitPayout(cherry,{positions:[3,1,3],multiplier:1}),40000);
  assert.equal(fruitPayout(cherry,{positions:[3],multiplier:3}),60000);
  assert.equal(fruitPayout(cherry,{positions:[1],multiplier:1},4000),4000);
  assert.equal(fruitPayout(cherry,{positions:[1],multiplier:1}),0);
});
test('all invalid and overflow payout inputs are rejected',()=>{
  const simple={positions:[3],multiplier:1};
  assert.throws(()=>fruitPayout({pick_index:-1,amount:1000},simple));
  assert.throws(()=>fruitPayout({pick_index:3,amount:-1},simple));
  assert.throws(()=>fruitPayout({pick_index:3,amount:1.5},simple));
  assert.throws(()=>fruitPayout({pick_index:3,amount:1000},simple,-1));
  assert.throws(()=>fruitPayout({pick_index:3,amount:Number.MAX_SAFE_INTEGER},simple));
});
