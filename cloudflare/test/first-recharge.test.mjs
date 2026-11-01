import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {firstRechargeBonusCoins,firstRechargeBonusStatements,
  RECHARGE_COINS_PER_USD,FIRST_RECHARGE_BONUS_PERCENT} from '../src/first-recharge.mjs';

function mock({oldSeller=false,oldManual=false,oldClaim=false}={}){
  const queries=[];
  const db={prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this;},
    async first(){queries.push({sql,args:this.args});
      if(sql.includes('sharika_coin_seller_transfers'))return oldSeller?{one:1}:null;
      if(sql.includes('sharika_manual_recharge_reviews'))return oldManual?{one:1}:null;
      if(sql.includes('sharika_first_recharge_bonuses'))return oldClaim?{one:1}:null;
      return null;
    }};}};
  return {db,queries};
}

test('USD one equivalent is exactly 500,000 coins and first recharge adds 200,000',async()=>{
  const f=mock();
  assert.equal(RECHARGE_COINS_PER_USD,500000);
  assert.equal(FIRST_RECHARGE_BONUS_PERCENT,40);
  assert.equal(firstRechargeBonusCoins(500000),200000);
  assert.equal(firstRechargeBonusCoins(1000000),400000);
  assert.equal(firstRechargeBonusCoins(19),7);
  const bonus=await firstRechargeBonusStatements({db:f.db,
    recipientUid:'new-user',kind:'seller',reference:'seller-id:ref-123',
    coins:500000,balance:100000});
  assert.equal(bonus.bonus,200000);
  assert.equal(bonus.statements.length,3);
  assert.match(bonus.statements[0].sql,/INSERT INTO sharika_first_recharge_bonuses/);
  assert.deepEqual(bonus.statements[0].args,
    ['new-user','seller','seller-id:ref-123',500000,200000]);
  assert.equal(bonus.statements[1].args[1],200000);
  assert.equal(bonus.statements[2].args[1],200000);
  assert.match(bonus.statements[2].sql,/first_recharge_bonus/);
  assert.equal(f.queries.length,3);
});

test('prior approved manual recharge, seller recharge or previous bonus blocks another chest',async()=>{
  for(const option of [{oldSeller:true},{oldManual:true},{oldClaim:true}]){
    const f=mock(option);
    const x=await firstRechargeBonusStatements({db:f.db,
      recipientUid:'new-user',kind:'manual',reference:'71',coins:500000,balance:2000});
    assert.equal(x.bonus,0);
    assert.equal(x.statements.length,0);
  }
});

test('first recharge bonus never overflows the verified user wallet',async()=>{
  const f=mock();
  await assert.rejects(firstRechargeBonusStatements({db:f.db,
    recipientUid:'new-user',kind:'seller',reference:'seller-id:ref-123',
    coins:500000,balance:1_000_000_000_000}),/recipient_balance_limit/);
  assert.equal(firstRechargeBonusCoins(0),0);
  assert.equal(firstRechargeBonusCoins(1),0);
  assert.equal(firstRechargeBonusCoins(Number.MAX_SAFE_INTEGER+1),0);
});

test('isolated migration enforces one first-recharge bonus and one USD earning per referred user',()=>{
  const sql=readFileSync(new URL('../migrations/0032_invite_cash_and_first_recharge.sql',
    import.meta.url),'utf8');
  assert.match(sql,/sharika_first_recharge_bonuses\s*\(\s*recipient_uid TEXT PRIMARY KEY/i);
  assert.match(sql,/sharika_invite_usd_earnings\s*\(\s*referred_uid TEXT PRIMARY KEY/i);
  assert.match(sql,/CHECK\(amount_cents IN \(5000,10000\)\)/);
  assert.match(sql,/status IN \('pending','paid','rejected'\)/);
});
